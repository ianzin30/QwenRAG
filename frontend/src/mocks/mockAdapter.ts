/**
 * In-browser mock of the RagApi for design review and frontend development.
 * Timers here simulate network latency and streaming; they never run in the HTTP path.
 *
 * Demo triggers: include "#falha" in a question for a failed turn,
 * "#incerto" for an unknown-outcome turn, and upload a file named "*erro*" for an upload error.
 */
import type { RagApi } from '../services/api/RagApi';
import type {
  AppConfig,
  AskRequest,
  ConversationSummary,
  DocumentMeta,
  Message,
  TurnEvent,
  UploadProgress,
  UploadResult,
} from '../services/api/types';
import { ApiError } from '../services/api/errors';
import { buildAnswer, documentMarkdown, DOCUMENTS, MODELS, pickAnswer, SEED_CONVERSATIONS } from './fixtures';

const UPLOAD_TYPES = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'md', 'txt', 'png', 'jpg', 'jpeg'];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

let seq = 1000;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export class MockRagApi implements RagApi {
  readonly mode = 'mock' as const;
  private conversations: ConversationSummary[];
  private messages = new Map<string, Message[]>();
  private documents: DocumentMeta[] = DOCUMENTS.map((d) => ({ ...d }));

  constructor() {
    const model = MODELS[0]!;
    this.conversations = SEED_CONVERSATIONS.map((c) => {
      const at = new Date(Date.now() - c.ageMs).toISOString();
      this.messages.set(c.id, [
        { id: `${c.id}-u`, role: 'user', content: c.question, turnId: `${c.id}-t`, createdAt: at },
        buildAnswer(c.answer, { id: `${c.id}-a`, turnId: `${c.id}-t`, model, collections: ['graduacao'], createdAt: at }),
      ]);
      return { id: c.id, title: c.title, updatedAt: at, collections: ['graduacao'], model: model.id };
    });
  }

  async getConfig(): Promise<AppConfig> {
    await sleep(120);
    return {
      models: MODELS,
      uploadAccept: UPLOAD_TYPES,
      maxUploadBytes: 200 * 1024 * 1024,
      excerptChars: 900,
      conversationTitleMaxChars: 34,
      features: { driveImport: true, cancelTurn: true },
    };
  }

  async listCollections() {
    await sleep(80);
    const names = [...new Set(this.documents.map((d) => d.collection)), 'graduacao', 'pos_graduacao'];
    return [...new Set(names)].map((name) => ({ name, documentCount: this.documents.filter((d) => d.collection === name).length }));
  }

  async listConversations() {
    await sleep(150);
    return [...this.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createConversation(input: { collections: string[]; modelId: string }) {
    await sleep(60);
    const conv: ConversationSummary = { id: nextId('c'), title: 'Nova conversa', updatedAt: new Date().toISOString(), collections: input.collections, model: input.modelId };
    this.conversations.unshift(conv);
    this.messages.set(conv.id, []);
    return conv;
  }

  async deleteConversation(id: string) {
    await sleep(60);
    this.conversations = this.conversations.filter((c) => c.id !== id);
    this.messages.delete(id);
  }

  async getMessages(conversationId: string, signal?: AbortSignal) {
    await sleep(260, signal);
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async *ask(request: AskRequest, signal: AbortSignal): AsyncGenerator<TurnEvent> {
    const turnId = nextId('t');
    const createdAt = new Date().toISOString();
    const list = this.messages.get(request.conversationId) ?? [];
    list.push({ id: nextId('u'), role: 'user', content: request.question, turnId, createdAt });
    this.messages.set(request.conversationId, list);
    this.touch(request.conversationId, request.question);

    yield { type: 'accepted', turnId };
    const stages: [string, string][] = [
      ['analyzing', 'Analisando a pergunta'],
      ['retrieving', `Buscando trechos em ${request.collections.join(', ')}`],
      ['reranking', 'Reordenando evidências'],
    ];
    for (const [stage, label] of stages) {
      yield { type: 'progress', stage, label };
      await sleep(650, signal);
    }
    if (request.question.includes('#falha')) {
      yield { type: 'failed', error: { outcome: 'failed', message: 'A saída estruturada do modelo não passou na validação após o reparo permitido.', code: 'mock_failed' } };
      return;
    }
    if (request.question.includes('#incerto')) {
      yield { type: 'failed', error: { outcome: 'unknown', message: 'Resultado remoto desconhecido. A pergunta não será repetida automaticamente. Confira a conexão antes de fazer um novo envio.', code: 'mock_unknown' } };
      return;
    }
    yield { type: 'progress', stage: 'generating', label: 'Redigindo resposta' };
    const model = MODELS.find((m) => m.id === request.modelId) ?? MODELS[0]!;
    const answer = buildAnswer(pickAnswer(request.question), { id: nextId('a'), turnId, model, collections: request.collections, createdAt });
    for (let i = 0; i < answer.content.length; i += 3) {
      await sleep(16, signal);
      yield { type: 'delta', text: answer.content.slice(i, i + 3) };
    }
    list.push(answer);
    yield { type: 'completed', message: answer };
  }

  async cancelTurn() {
    await sleep(40);
  }

  async listDocuments(collection?: string) {
    await sleep(140);
    return this.documents.filter((d) => !collection || d.collection === collection);
  }

  async getDocumentContent(documentId: string, signal?: AbortSignal) {
    await sleep(220, signal);
    const doc = this.documents.find((d) => d.id === documentId);
    if (!doc) throw new ApiError('http', 'Documento não encontrado.', { status: 404 });
    return documentMarkdown(doc);
  }

  async deleteDocument(documentId: string) {
    await sleep(100);
    this.documents = this.documents.filter((d) => d.id !== documentId);
  }

  async uploadDocuments(input: { collection: string; files: File[] }, onProgress: (p: UploadProgress[]) => void, signal?: AbortSignal) {
    return this.simulateIngest(input.collection, input.files.map((f) => f.name), onProgress, signal);
  }

  async importFromDrive(input: { collection: string }, onProgress: (p: UploadProgress[]) => void, signal?: AbortSignal) {
    return this.simulateIngest(input.collection, ['atas_colegiado_2026.pdf', 'normas_estagio.docx', 'horarios.xlsx'], onProgress, signal);
  }

  private async simulateIngest(collection: string, names: string[], onProgress: (p: UploadProgress[]) => void, signal?: AbortSignal): Promise<UploadResult> {
    const progress: UploadProgress[] = names.map((fileName) => ({ fileName, phase: 'queued', percent: 0 }));
    onProgress([...progress]);
    const saved: DocumentMeta[] = [];
    const skipped: UploadResult['skipped'] = [];
    for (const [i, name] of names.entries()) {
      for (let p = 4; p <= 100; p += 4) {
        await sleep(40, signal);
        if (name.toLowerCase().includes('erro') && p > 40) {
          progress[i] = { fileName: name, phase: 'error', percent: p, message: 'Falha na extração' };
          skipped.push({ fileName: name, reason: 'Falha na extração do conteúdo.' });
          break;
        }
        progress[i] = { fileName: name, phase: p < 30 ? 'uploading' : p < 70 ? 'extracting' : p < 100 ? 'indexing' : 'done', percent: p };
        onProgress([...progress]);
      }
      onProgress([...progress]);
      if (progress[i]?.phase === 'done') {
        const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
        const doc: DocumentMeta = { id: nextId('d'), collection, name, extension: ext, relativePath: `${collection}/${name}`, updatedAt: new Date().toISOString() };
        this.documents.unshift(doc);
        saved.push(doc);
      }
    }
    return { saved, skipped };
  }

  private touch(conversationId: string, question: string) {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    conv.updatedAt = new Date().toISOString();
    if (conv.title === 'Nova conversa') conv.title = question.length > 34 ? `${question.slice(0, 33)}…` : question;
  }
}
