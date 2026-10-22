import type {
  AppConfig,
  AskRequest,
  Collection,
  ConversationSummary,
  DocumentMeta,
  Message,
  TurnEvent,
  UploadProgress,
  UploadResult,
} from './types';

/**
 * The single seam between UI and backend. Components never call fetch directly;
 * they go through an implementation of this interface (HTTP or mock).
 */
export interface RagApi {
  readonly mode: 'http' | 'mock';

  getConfig(signal?: AbortSignal): Promise<AppConfig>;
  listCollections(signal?: AbortSignal): Promise<Collection[]>;

  listConversations(signal?: AbortSignal): Promise<ConversationSummary[]>;
  createConversation(input: { collections: string[]; modelId: string }): Promise<ConversationSummary>;
  deleteConversation(id: string): Promise<void>;
  getMessages(conversationId: string, signal?: AbortSignal): Promise<Message[]>;

  /** Streams one turn. The iterator ends after a `completed` or `failed` event, or throws on abort/transport error. */
  ask(request: AskRequest, signal: AbortSignal): AsyncIterable<TurnEvent>;
  /** Best-effort server-side cancellation; the client also aborts the stream. */
  cancelTurn?(turnId: string): Promise<void>;

  listDocuments(collection?: string, signal?: AbortSignal): Promise<DocumentMeta[]>;
  /** Raw Markdown extracted at ingestion time. Treated as untrusted text by the UI. */
  getDocumentContent(documentId: string, signal?: AbortSignal): Promise<string>;
  deleteDocument(documentId: string): Promise<void>;

  uploadDocuments(
    input: { collection: string; files: File[] },
    onProgress: (progress: UploadProgress[]) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult>;
  importFromDrive?(
    input: { collection: string },
    onProgress: (progress: UploadProgress[]) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult>;
}
