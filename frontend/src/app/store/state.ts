import type {
  AppConfig,
  AssistantMessage,
  Collection,
  ConversationSummary,
  DocumentMeta,
  Message,
  TurnFailure,
  UploadProgress,
} from '../../services/api';

export interface StageEntry {
  stage: string;
  label: string;
}

/** Live state of one in-flight (or failed) turn. Keyed by conversation so switching chats never loses it. */
export interface TurnRuntime {
  clientTurnId: string;
  turnId?: string;
  question: string;
  userMessageId: string;
  status: 'streaming' | 'failed' | 'cancelled';
  stages: StageEntry[];
  activeStage?: string;
  text: string;
  error?: TurnFailure;
  startedAt: number;
}

export interface MessagesSlot {
  status: 'loading' | 'ready' | 'error';
  items: Message[];
  error?: string;
}

export interface UploadSession {
  id: string;
  collection: string;
  items: UploadProgress[];
  status: 'running' | 'done' | 'error';
  error?: string;
}

export type MainView = { kind: 'chat' } | { kind: 'document'; documentId: string; highlight?: Highlight };

export interface Highlight {
  before: string;
  quote: string;
  after: string;
  sourceLabel: string;
}

export interface AppState {
  boot: { status: 'loading' | 'ready' | 'error'; error?: string };
  config: AppConfig | null;
  modelId: string;
  collections: Collection[];
  activeCollections: string[];
  conversations: ConversationSummary[];
  conversationsStatus: 'loading' | 'ready' | 'error';
  activeConversationId: string | null;
  messages: Record<string, MessagesSlot>;
  turns: Record<string, TurnRuntime>;
  documents: DocumentMeta[];
  documentsStatus: 'loading' | 'ready' | 'error';
  upload: UploadSession | null;
  view: MainView;
}

export const initialState: AppState = {
  boot: { status: 'loading' },
  config: null,
  modelId: '',
  collections: [],
  activeCollections: [],
  conversations: [],
  conversationsStatus: 'loading',
  activeConversationId: null,
  messages: {},
  turns: {},
  documents: [],
  documentsStatus: 'loading',
  upload: null,
  view: { kind: 'chat' },
};

export type Action =
  | { type: 'boot/succeeded'; config: AppConfig; collections: Collection[]; conversations: ConversationSummary[]; documents: DocumentMeta[] }
  | { type: 'boot/started' }
  | { type: 'boot/failed'; error: string }
  | { type: 'model/selected'; modelId: string }
  | { type: 'collections/loaded'; collections: Collection[] }
  | { type: 'collections/toggled'; name: string }
  | { type: 'collections/activated'; name: string }
  | { type: 'conversations/loaded'; conversations: ConversationSummary[] }
  | { type: 'conversation/created'; conversation: ConversationSummary }
  | { type: 'conversation/selected'; id: string | null }
  | { type: 'conversation/removed'; id: string }
  | { type: 'messages/loading'; conversationId: string }
  | { type: 'messages/loaded'; conversationId: string; messages: Message[] }
  | { type: 'messages/failed'; conversationId: string; error: string }
  | { type: 'turn/started'; conversationId: string; runtime: TurnRuntime; title?: string }
  | { type: 'turn/accepted'; conversationId: string; clientTurnId: string; turnId: string }
  | { type: 'turn/progress'; conversationId: string; clientTurnId: string; stage: string; label?: string }
  | { type: 'turn/delta'; conversationId: string; clientTurnId: string; text: string }
  | { type: 'turn/completed'; conversationId: string; clientTurnId: string; message: AssistantMessage }
  | { type: 'turn/failed'; conversationId: string; clientTurnId: string; error: TurnFailure }
  | { type: 'turn/cancelled'; conversationId: string; clientTurnId: string }
  | { type: 'turn/dismissed'; conversationId: string; removeQuestion: boolean }
  | { type: 'documents/loaded'; documents: DocumentMeta[] }
  | { type: 'documents/failed' }
  | { type: 'document/removed'; id: string }
  | { type: 'upload/started'; session: UploadSession }
  | { type: 'upload/progress'; id: string; items: UploadProgress[] }
  | { type: 'upload/finished'; id: string; saved: DocumentMeta[] }
  | { type: 'upload/failed'; id: string; error: string }
  | { type: 'upload/cleared'; id: string }
  | { type: 'view/changed'; view: MainView };

/** Default stage list shown while a turn runs; the backend may send additional stages. */
export const DEFAULT_STAGES: StageEntry[] = [
  { stage: 'analyzing', label: 'Analisando a pergunta' },
  { stage: 'retrieving', label: 'Buscando trechos' },
  { stage: 'reranking', label: 'Reordenando evidências' },
  { stage: 'generating', label: 'Redigindo resposta' },
];
