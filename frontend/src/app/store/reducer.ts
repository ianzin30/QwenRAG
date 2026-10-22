import type { Action, AppState, MessagesSlot, TurnRuntime } from './state';
import type { ConversationSummary, Message } from '../../services/api';

function updateTurn(state: AppState, conversationId: string, clientTurnId: string, patch: (t: TurnRuntime) => TurnRuntime): AppState {
  const turn = state.turns[conversationId];
  // Late events from a turn that was already replaced or dismissed are dropped.
  if (!turn || turn.clientTurnId !== clientTurnId) return state;
  return { ...state, turns: { ...state.turns, [conversationId]: patch(turn) } };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function appendMessage(slot: MessagesSlot | undefined, message: Message): MessagesSlot {
  const items = slot?.items ?? [];
  if (items.some((m) => m.id === message.id)) return slot ?? { status: 'ready', items };
  return { status: slot?.status ?? 'ready', items: [...items, message], error: slot?.error };
}

function touchConversation(list: ConversationSummary[], id: string, patch: Partial<ConversationSummary>): ConversationSummary[] {
  const found = list.find((c) => c.id === id);
  if (!found) return list;
  return [{ ...found, ...patch }, ...list.filter((c) => c.id !== id)];
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'boot/succeeded': {
      const model = action.config.models.find((m) => m.isDefault) ?? action.config.models[0];
      const firstWithDocs = action.collections.find((c) => c.documentCount > 0) ?? action.collections[0];
      return {
        ...state,
        boot: { status: 'ready' },
        config: action.config,
        modelId: model?.id ?? '',
        collections: action.collections,
        activeCollections: firstWithDocs ? [firstWithDocs.name] : [],
        conversations: action.conversations,
        conversationsStatus: 'ready',
        activeConversationId: action.conversations[0]?.id ?? null,
        documents: action.documents,
        documentsStatus: 'ready',
      };
    }
    case 'boot/started':
      return { ...state, boot: { status: 'loading' } };
    case 'boot/failed':
      return { ...state, boot: { status: 'error', error: action.error } };
    case 'model/selected':
      return { ...state, modelId: action.modelId };
    case 'collections/loaded': {
      const names = new Set(action.collections.map((c) => c.name));
      return { ...state, collections: action.collections, activeCollections: state.activeCollections.filter((n) => names.has(n)) };
    }
    case 'collections/toggled':
      return {
        ...state,
        activeCollections: state.activeCollections.includes(action.name)
          ? state.activeCollections.filter((n) => n !== action.name)
          : [...state.activeCollections, action.name],
      };
    case 'collections/activated':
      return state.activeCollections.includes(action.name) ? state : { ...state, activeCollections: [...state.activeCollections, action.name] };
    case 'conversations/loaded':
      return { ...state, conversations: action.conversations, conversationsStatus: 'ready' };
    case 'conversation/created':
      return {
        ...state,
        conversations: [action.conversation, ...state.conversations],
        activeConversationId: action.conversation.id,
        messages: { ...state.messages, [action.conversation.id]: { status: 'ready', items: [] } },
        view: { kind: 'chat' },
      };
    case 'conversation/selected':
      return { ...state, activeConversationId: action.id, view: { kind: 'chat' } };
    case 'conversation/removed': {
      const conversations = state.conversations.filter((c) => c.id !== action.id);
      return {
        ...state,
        conversations,
        messages: withoutKey(state.messages, action.id),
        turns: withoutKey(state.turns, action.id),
        activeConversationId: state.activeConversationId === action.id ? conversations[0]?.id ?? null : state.activeConversationId,
      };
    }
    case 'messages/loading':
      return { ...state, messages: { ...state.messages, [action.conversationId]: { status: 'loading', items: state.messages[action.conversationId]?.items ?? [] } } };
    case 'messages/loaded':
      return { ...state, messages: { ...state.messages, [action.conversationId]: { status: 'ready', items: action.messages } } };
    case 'messages/failed':
      return { ...state, messages: { ...state.messages, [action.conversationId]: { status: 'error', items: state.messages[action.conversationId]?.items ?? [], error: action.error } } };

    case 'turn/started': {
      const { conversationId, runtime } = action;
      const user: Message = { id: runtime.userMessageId, role: 'user', content: runtime.question, createdAt: new Date(runtime.startedAt).toISOString() };
      return {
        ...state,
        turns: { ...state.turns, [conversationId]: runtime },
        messages: { ...state.messages, [conversationId]: appendMessage(state.messages[conversationId], user) },
        conversations: touchConversation(state.conversations, conversationId, {
          updatedAt: new Date(runtime.startedAt).toISOString(),
          ...(action.title ? { title: action.title } : {}),
        }),
      };
    }
    case 'turn/accepted':
      return updateTurn(state, action.conversationId, action.clientTurnId, (t) => ({ ...t, turnId: action.turnId }));
    case 'turn/progress':
      return updateTurn(state, action.conversationId, action.clientTurnId, (t) => {
        const known = t.stages.some((s) => s.stage === action.stage);
        const stages = known
          ? t.stages.map((s) => (s.stage === action.stage && action.label ? { ...s, label: action.label } : s))
          : [...t.stages.slice(0, activeIndex(t) + 1), { stage: action.stage, label: action.label ?? action.stage }, ...t.stages.slice(activeIndex(t) + 1)];
        return { ...t, stages, activeStage: action.stage };
      });
    case 'turn/delta':
      return updateTurn(state, action.conversationId, action.clientTurnId, (t) => ({ ...t, text: t.text + action.text, activeStage: 'generating' }));
    case 'turn/completed': {
      const turn = state.turns[action.conversationId];
      if (!turn || turn.clientTurnId !== action.clientTurnId) return state;
      return {
        ...state,
        turns: withoutKey(state.turns, action.conversationId),
        messages: { ...state.messages, [action.conversationId]: appendMessage(state.messages[action.conversationId], action.message) },
        conversations: touchConversation(state.conversations, action.conversationId, { updatedAt: action.message.createdAt }),
      };
    }
    case 'turn/failed':
      return updateTurn(state, action.conversationId, action.clientTurnId, (t) => ({ ...t, status: 'failed', error: action.error }));
    case 'turn/cancelled':
      return updateTurn(state, action.conversationId, action.clientTurnId, (t) => ({ ...t, status: 'cancelled' }));
    case 'turn/dismissed': {
      const turn = state.turns[action.conversationId];
      if (!turn || turn.status === 'streaming') return state;
      const slot = state.messages[action.conversationId];
      const messages =
        action.removeQuestion && slot
          ? { ...state.messages, [action.conversationId]: { ...slot, items: slot.items.filter((m) => m.id !== turn.userMessageId) } }
          : state.messages;
      return { ...state, turns: withoutKey(state.turns, action.conversationId), messages };
    }

    case 'documents/loaded':
      return { ...state, documents: action.documents, documentsStatus: 'ready' };
    case 'documents/failed':
      return { ...state, documentsStatus: 'error' };
    case 'document/removed':
      return {
        ...state,
        documents: state.documents.filter((d) => d.id !== action.id),
        view: state.view.kind === 'document' && state.view.documentId === action.id ? { kind: 'chat' } : state.view,
      };
    case 'upload/started':
      return { ...state, upload: action.session };
    case 'upload/progress':
      return state.upload?.id === action.id ? { ...state, upload: { ...state.upload, items: action.items } } : state;
    case 'upload/finished':
      if (state.upload?.id !== action.id) return state;
      return {
        ...state,
        upload: { ...state.upload, status: 'done' },
        documents: [...action.saved, ...state.documents.filter((d) => !action.saved.some((s) => s.id === d.id))],
      };
    case 'upload/failed':
      return state.upload?.id === action.id ? { ...state, upload: { ...state.upload, status: 'error', error: action.error } } : state;
    case 'upload/cleared':
      return state.upload?.id === action.id ? { ...state, upload: null } : state;
    case 'view/changed':
      return { ...state, view: action.view };
  }
}

function activeIndex(t: TurnRuntime): number {
  const i = t.stages.findIndex((s) => s.stage === t.activeStage);
  return i === -1 ? -1 : i;
}
