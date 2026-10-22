import type { RagApi } from './RagApi';
import type { AskRequest, TurnEvent, UploadProgress, UploadResult } from './types';
import { ApiError, toApiError } from './errors';
import { HttpClient } from './httpClient';
import { readSse, type SseMessage } from './sse';
import {
  mapAssistant,
  mapCollection,
  mapConfig,
  mapConversation,
  mapDocument,
  mapMessage,
  type CollectionDTO,
  type ConfigDTO,
  type ConversationDTO,
  type DocumentDTO,
  type MessageDTO,
} from './dto';

/**
 * Adapter for the FastAPI layer (application/api/) described in docs/INTEGRATION.md.
 * Validated end to end against the real API; Drive import and turn cancel are not implemented server-side.
 */
export class HttpRagApi implements RagApi {
  readonly mode = 'http' as const;
  private readonly http: HttpClient;

  constructor(baseUrl: string) {
    this.http = new HttpClient(baseUrl);
  }

  async getConfig(signal?: AbortSignal) {
    return mapConfig(await this.http.json<ConfigDTO>('/config', { signal }));
  }

  async listCollections(signal?: AbortSignal) {
    return (await this.http.json<CollectionDTO[]>('/collections', { signal })).map(mapCollection);
  }

  async listConversations(signal?: AbortSignal) {
    return (await this.http.json<ConversationDTO[]>('/conversations', { signal })).map(mapConversation);
  }

  async createConversation(input: { collections: string[]; modelId: string }) {
    const dto = await this.http.json<ConversationDTO>('/conversations', {
      method: 'POST',
      body: { collection: input.collections, model: input.modelId },
    });
    return mapConversation(dto);
  }

  async deleteConversation(id: string) {
    await this.http.raw(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async getMessages(conversationId: string, signal?: AbortSignal) {
    const dtos = await this.http.json<MessageDTO[]>(`/conversations/${encodeURIComponent(conversationId)}/messages`, { signal });
    return dtos.map(mapMessage);
  }

  async *ask(request: AskRequest, signal: AbortSignal): AsyncGenerator<TurnEvent> {
    const response = await this.http.raw(`/conversations/${encodeURIComponent(request.conversationId)}/turns`, {
      method: 'POST',
      signal,
      timeoutMs: 0, // a turn can legitimately take minutes; the user cancels instead
      headers: { Accept: 'text/event-stream' },
      body: {
        client_turn_id: request.clientTurnId,
        question: request.question,
        model: request.modelId,
        collection: request.collections,
      },
    });
    if (!response.body) throw new ApiError('protocol', 'O servidor não abriu o fluxo da resposta.');
    let finished = false;
    for await (const message of readSse(response.body, signal)) {
      const event = decodeTurnEvent(message);
      if (!event) continue;
      yield event;
      if (event.type === 'completed' || event.type === 'failed') {
        finished = true;
        break;
      }
    }
    if (!finished) {
      // The connection ended without a terminal event: the server may or may not have finished.
      throw new ApiError('network', 'A conexão terminou antes da resposta final.', { code: 'stream_incomplete' });
    }
  }

  async cancelTurn(turnId: string) {
    await this.http.raw(`/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' });
  }

  async listDocuments(collection?: string, signal?: AbortSignal) {
    const query = collection ? `?collection=${encodeURIComponent(collection)}` : '';
    return (await this.http.json<DocumentDTO[]>(`/documents${query}`, { signal })).map(mapDocument);
  }

  async getDocumentContent(documentId: string, signal?: AbortSignal) {
    return this.http.text(`/documents/${encodeURIComponent(documentId)}/content`, {
      signal,
      headers: { Accept: 'text/markdown, text/plain' },
    });
  }

  async deleteDocument(documentId: string) {
    await this.http.raw(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  }

  async uploadDocuments(
    input: { collection: string; files: File[] },
    onProgress: (progress: UploadProgress[]) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    let progress: UploadProgress[] = input.files.map((f) => ({ fileName: f.name, phase: 'uploading', percent: 0 }));
    onProgress(progress);
    const form = new FormData();
    form.append('collection', input.collection);
    for (const file of input.files) form.append('files', file, file.name);
    // fetch() cannot report upload progress, so the byte transfer uses XMLHttpRequest.
    const { job_id } = await xhrUpload<{ job_id: string }>(this.http.url('/uploads'), form, signal, (fraction) => {
      progress = progress.map((p) => ({ ...p, percent: Math.round(fraction * 30) }));
      onProgress(progress);
    });
    return this.followJob(job_id, progress, onProgress, signal);
  }

  async importFromDrive(input: { collection: string }, onProgress: (progress: UploadProgress[]) => void, signal?: AbortSignal) {
    const { job_id } = await this.http.json<{ job_id: string }>('/integrations/drive/imports', {
      method: 'POST',
      body: { collection: input.collection },
      signal,
    });
    return this.followJob(job_id, [], onProgress, signal);
  }

  /** Server-side extraction/indexing progress for an ingestion job (SSE over GET). */
  private async followJob(
    jobId: string,
    initial: UploadProgress[],
    onProgress: (progress: UploadProgress[]) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    const response = await this.http.raw(`/uploads/${encodeURIComponent(jobId)}/events`, {
      signal,
      timeoutMs: 0,
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.body) throw new ApiError('protocol', 'O servidor não abriu o fluxo de progresso.');
    let progress = initial;
    for await (const message of readSse(response.body, signal)) {
      const data = parseJson(message);
      if (message.event === 'upload.progress' && data && Array.isArray(data.files)) {
        progress = (data.files as Record<string, unknown>[]).map((f) => ({
          fileName: String(f.file_name ?? ''),
          phase: (String(f.phase ?? 'extracting') as UploadProgress['phase']),
          percent: Math.max(0, Math.min(100, Number(f.percent ?? 0))),
          message: typeof f.message === 'string' ? f.message : undefined,
        }));
        onProgress(progress);
      } else if (message.event === 'upload.completed' && data) {
        return {
          saved: ((data.saved as DocumentDTO[]) ?? []).map(mapDocument),
          skipped: ((data.skipped as { file_name: string; reason: string }[]) ?? []).map((s) => ({ fileName: s.file_name, reason: s.reason })),
        };
      } else if (message.event === 'upload.failed') {
        throw new ApiError('http', String(data?.message ?? 'Falha ao processar os arquivos.'), { code: String(data?.code ?? '') });
      }
    }
    throw new ApiError('network', 'A conexão terminou antes do fim do processamento.', { code: 'stream_incomplete' });
  }
}

function parseJson(message: SseMessage): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(message.data);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Maps SSE event names to domain events. Unknown events are ignored for forward compatibility. */
export function decodeTurnEvent(message: SseMessage): TurnEvent | null {
  const data = parseJson(message);
  if (!data) return null;
  switch (message.event) {
    case 'turn.accepted':
      return { type: 'accepted', turnId: String(data.turn_id ?? ''), userMessageId: data.user_message_id ? String(data.user_message_id) : undefined };
    case 'turn.progress':
      return {
        type: 'progress',
        stage: String(data.stage ?? ''),
        label: typeof data.label === 'string' ? data.label : undefined,
        current: typeof data.current === 'number' ? data.current : undefined,
        total: typeof data.total === 'number' ? data.total : undefined,
      };
    case 'answer.delta':
      return typeof data.text === 'string' ? { type: 'delta', text: data.text } : null;
    case 'turn.completed':
      return { type: 'completed', message: mapAssistant(data.message as MessageDTO) };
    case 'turn.failed':
      return {
        type: 'failed',
        error: {
          outcome: data.outcome === 'unknown' ? 'unknown' : 'failed',
          message: String(data.message ?? 'Não foi possível concluir a resposta.'),
          code: typeof data.code === 'string' ? data.code : undefined,
        },
      };
    default:
      return null;
  }
}

function xhrUpload<T>(url: string, body: FormData, signal: AbortSignal | undefined, onFraction: (f: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onFraction(e.loaded / e.total);
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError('http', `Falha no envio (${xhr.status}).`, { status: xhr.status }));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch (error) {
        reject(toApiError(error));
      }
    };
    xhr.onerror = () => reject(new ApiError('network', 'Falha de rede durante o envio.'));
    xhr.onabort = () => reject(new ApiError('aborted', 'Envio cancelado.'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}
