/**
 * Wire format of the FastAPI layer in application/api/ (snake_case, as the Python code uses).
 * Field names follow what the Python code produces (Sources.normalize_presentation, Turns.run,
 * Engine source()). Differences from the original proposal: docs/INTEGRATION.md#implementation-notes-fastapi.
 */
import type {
  AnswerState,
  AppConfig,
  AssistantMessage,
  Claim,
  Collection,
  ConversationSummary,
  DocumentMeta,
  Message,
  Source,
} from './types';

export interface ConfigDTO {
  models: { model_name: string; label: string; is_default?: boolean }[];
  upload_types: string[];
  max_upload_bytes: number;
  excerpt_chars?: number;
  title_max_chars?: number;
  features?: { drive_import?: boolean; cancel_turn?: boolean };
}

export interface CollectionDTO {
  name: string;
  document_count: number;
}

export interface DocumentDTO {
  id: string;
  collection: string;
  file_name: string;
  relative_path: string;
  size_bytes?: number;
  updated_at?: string;
  summary?: string;
}

export interface ConversationDTO {
  id: string;
  title: string;
  updated_at: string;
  collection?: string[] | string | null;
  model?: string | null;
}

export interface SourceDTO {
  source_id?: string;
  evidence_id?: string;
  document_name?: string;
  chunk_kind?: string;
  section_title?: string;
  excerpt?: string;
  relative_path?: string;
  provenance?: { page_no?: number | null }[];
  claim_ids?: string[];
  focus_spans?: { start: number; end: number; quote: string; claim_ids?: string[] }[];
  document_id?: string;
}

export interface MessageDTO {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  turn_id?: string;
  /** Also sent on user messages (running/failed/unknown/…); not mapped into the domain yet. */
  turn_state?: string;
  /** User messages of failed/unknown turns: the stored public error. Not mapped yet. */
  error?: string;
  route?: string;
  created_at?: string;
  collection?: string[] | string | null;
  profile?: { llm?: { model?: string; label?: string } };
  claims?: { claim_id: string; text: string; evidence_ids: string[] }[];
  cited_sources?: SourceDTO[];
  sources?: SourceDTO[];
  source_warnings?: string[];
  duration_ms?: number;
  execution?: Record<string, unknown>;
}

const ANSWER_STATES: AnswerState[] = ['answered', 'partial', 'casual', 'abstained', 'clarification_required'];

const asList = (value: string[] | string | null | undefined): string[] =>
  Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];

export function mapConfig(dto: ConfigDTO): AppConfig {
  const models = dto.models.map((m, i) => ({
    id: m.model_name,
    label: m.label || m.model_name,
    isDefault: m.is_default ?? i === 0,
  }));
  return {
    models,
    uploadAccept: dto.upload_types.map((t) => t.replace(/^\./, '').toLowerCase()),
    maxUploadBytes: dto.max_upload_bytes,
    excerptChars: dto.excerpt_chars ?? 900,
    conversationTitleMaxChars: dto.title_max_chars ?? 34,
    features: { driveImport: !!dto.features?.drive_import, cancelTurn: !!dto.features?.cancel_turn },
  };
}

export const mapCollection = (dto: CollectionDTO): Collection => ({ name: dto.name, documentCount: dto.document_count });

export function mapDocument(dto: DocumentDTO): DocumentMeta {
  const ext = dto.file_name.includes('.') ? dto.file_name.split('.').pop() ?? '' : '';
  return {
    id: dto.id,
    collection: dto.collection,
    name: dto.file_name,
    extension: ext.toUpperCase(),
    relativePath: dto.relative_path,
    sizeBytes: dto.size_bytes,
    updatedAt: dto.updated_at,
    summary: dto.summary,
  };
}

export const mapConversation = (dto: ConversationDTO): ConversationSummary => ({
  id: dto.id,
  title: dto.title,
  updatedAt: dto.updated_at,
  collections: asList(dto.collection),
  model: dto.model ?? undefined,
});

export function mapSource(dto: SourceDTO, index: number): Source {
  const pages = [...new Set((dto.provenance ?? []).map((p) => p.page_no).filter((p): p is number => typeof p === 'number'))].sort(
    (a, b) => a - b,
  );
  return {
    sourceId: dto.source_id || `${dto.evidence_id ?? 'src'}-${index}`,
    evidenceId: dto.evidence_id || String(index + 1),
    documentName: dto.document_name || 'documento',
    chunkKind: dto.chunk_kind || 'text',
    sectionTitle: dto.section_title || '',
    excerpt: dto.excerpt || '',
    relativePath: dto.relative_path || '',
    pages,
    claimIds: dto.claim_ids ?? [],
    focusSpans: (dto.focus_spans ?? []).map((s) => ({ start: s.start, end: s.end, quote: s.quote, claimIds: s.claim_ids ?? [] })),
    documentId: dto.document_id,
  };
}

const mapClaim = (c: { claim_id: string; text: string; evidence_ids: string[] }): Claim => ({
  claimId: c.claim_id,
  text: c.text,
  evidenceIds: c.evidence_ids,
});

export function mapMessage(dto: MessageDTO, index: number): Message {
  const createdAt = dto.created_at ?? new Date(0).toISOString();
  const id = dto.id ?? `${dto.turn_id ?? 'm'}-${dto.role}-${index}`;
  if (dto.role === 'user') return { id, role: 'user', content: dto.content, turnId: dto.turn_id, createdAt };
  return mapAssistant(dto, id, createdAt);
}

export function mapAssistant(dto: MessageDTO, id = dto.id ?? `${dto.turn_id}-assistant`, createdAt = dto.created_at ?? new Date().toISOString()): AssistantMessage {
  // Same rule as Sources.displayed_sources(): an explicit cited_sources list wins, even when empty.
  const rawSources = dto.cited_sources !== undefined ? dto.cited_sources : dto.sources ?? [];
  const state = ANSWER_STATES.includes(dto.turn_state as AnswerState) ? (dto.turn_state as AnswerState) : 'answered';
  const modelId = dto.profile?.llm?.model;
  return {
    id,
    role: 'assistant',
    turnId: dto.turn_id,
    content: dto.content,
    claims: (dto.claims ?? []).map(mapClaim),
    sources: rawSources.map(mapSource),
    state,
    route: dto.route ?? 'retrieval',
    model: modelId ? { id: modelId, label: dto.profile?.llm?.label ?? modelId } : undefined,
    collections: asList(dto.collection),
    durationMs: dto.duration_ms,
    warnings: dto.source_warnings ?? [],
    execution: dto.execution,
    createdAt,
  };
}
