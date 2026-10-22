import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../providers/ApiProvider';
import { useToast } from '../providers/ToastProvider';
import { reducer } from './reducer';
import { DEFAULT_STAGES, initialState, type AppState, type Highlight, type TurnRuntime } from './state';
import { describeError, isAbortError, type AskRequest, type DocumentMeta, type UploadProgress, type UploadResult } from '../../services/api';
import { fileExtension, newId, truncateTitle } from '../../lib/format';

export interface StoreActions {
  retryBoot(): void;
  selectModel(modelId: string): void;
  toggleCollection(name: string): void;
  selectConversation(id: string): void;
  newConversation(): void;
  deleteConversation(id: string): Promise<void>;
  reloadMessages(conversationId: string): void;
  send(question: string): Promise<void>;
  cancel(conversationId: string): void;
  retry(conversationId: string): void;
  dismissTurn(conversationId: string): void;
  uploadFiles(files: File[], collection: string): void;
  importFromDrive(collection: string): void;
  deleteDocument(doc: DocumentMeta): Promise<void>;
  openDocument(documentId: string, highlight?: Highlight): void;
  showChat(): void;
  askAboutDocument(doc: DocumentMeta): void;
}

const StateContext = createContext<AppState | null>(null);
const ActionsContext = createContext<StoreActions | null>(null);
const DraftContext = createContext<{ seed: { text: string; n: number } | null } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const turnControllers = useRef(new Map<string, AbortController>());
  const loadControllers = useRef(new Map<string, AbortController>());
  const uploadController = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const [draftSeed, setDraftSeedState] = useState<{ text: string; n: number } | null>(null);
  const setDraftSeed = (text: string) => setDraftSeedState({ text, n: Date.now() });

  const actions = useMemo<StoreActions>(() => {
    const loadMessages = (conversationId: string) => {
      loadControllers.current.get(conversationId)?.abort();
      const ctrl = new AbortController();
      loadControllers.current.set(conversationId, ctrl);
      dispatch({ type: 'messages/loading', conversationId });
      api
        .getMessages(conversationId, ctrl.signal)
        .then((messages) => dispatch({ type: 'messages/loaded', conversationId, messages }))
        .catch((error: unknown) => {
          if (!isAbortError(error)) dispatch({ type: 'messages/failed', conversationId, error: describeError(error) });
        })
        .finally(() => {
          if (loadControllers.current.get(conversationId) === ctrl) loadControllers.current.delete(conversationId);
        });
    };

    const refreshLibrary = () => {
      api.listCollections().then((collections) => dispatch({ type: 'collections/loaded', collections })).catch(() => undefined);
      api
        .listDocuments()
        .then((documents) => dispatch({ type: 'documents/loaded', documents }))
        .catch(() => dispatch({ type: 'documents/failed' }));
    };

    const boot = () => {
      dispatch({ type: 'boot/started' });
      Promise.all([api.getConfig(), api.listCollections(), api.listConversations(), api.listDocuments()])
        .then(([config, collections, conversations, documents]) => {
          dispatch({ type: 'boot/succeeded', config, collections, conversations, documents });
          if (conversations[0]) loadMessages(conversations[0].id);
        })
        .catch((error: unknown) => dispatch({ type: 'boot/failed', error: describeError(error) }));
    };

    /** Consumes one turn stream. Only stream events change the answer; nothing is fabricated on failure. */
    const runTurn = async (conversationId: string, clientTurnId: string, request: AskRequest, ctrl: AbortController) => {
      let accepted = false;
      let terminal = false;
      try {
        for await (const event of api.ask(request, ctrl.signal)) {
          accepted = true;
          switch (event.type) {
            case 'accepted':
              dispatch({ type: 'turn/accepted', conversationId, clientTurnId, turnId: event.turnId });
              break;
            case 'progress':
              dispatch({ type: 'turn/progress', conversationId, clientTurnId, stage: event.stage, label: event.label });
              break;
            case 'delta':
              dispatch({ type: 'turn/delta', conversationId, clientTurnId, text: event.text });
              break;
            case 'completed': {
              terminal = true;
              dispatch({ type: 'turn/completed', conversationId, clientTurnId, message: event.message });
              const s = stateRef.current;
              if (s.activeConversationId !== conversationId || s.view.kind !== 'chat') {
                const title = s.conversations.find((c) => c.id === conversationId)?.title ?? 'conversa';
                toast(`Resposta pronta em “${title}”`);
              }
              break;
            }
            case 'failed':
              terminal = true;
              dispatch({ type: 'turn/failed', conversationId, clientTurnId, error: event.error });
              break;
          }
          if (terminal) break;
        }
        if (!terminal) {
          dispatch({ type: 'turn/failed', conversationId, clientTurnId, error: { outcome: 'unknown', message: 'A conexão terminou antes da resposta final.' } });
        }
      } catch (error) {
        if (isAbortError(error) || ctrl.signal.aborted) {
          dispatch({ type: 'turn/cancelled', conversationId, clientTurnId });
        } else {
          // Once the server accepted the turn, a transport error leaves the outcome unknown (Turns.run semantics).
          dispatch({
            type: 'turn/failed',
            conversationId,
            clientTurnId,
            error: { outcome: accepted ? 'unknown' : 'failed', message: describeError(error) },
          });
        }
      } finally {
        if (turnControllers.current.get(conversationId) === ctrl) turnControllers.current.delete(conversationId);
      }
    };

    const send = async (question: string) => {
      const q = question.trim();
      const s = stateRef.current;
      if (!q || sending.current || !s.config || s.activeCollections.length === 0) return;
      let conversationId = s.activeConversationId;
      if (conversationId && s.turns[conversationId]?.status === 'streaming') return; // no duplicate submissions
      sending.current = true;
      try {
        if (!conversationId) {
          const created = await api.createConversation({ collections: s.activeCollections, modelId: s.modelId });
          dispatch({ type: 'conversation/created', conversation: created });
          conversationId = created.id;
        }
        const current = stateRef.current;
        if (current.turns[conversationId]) dispatch({ type: 'turn/dismissed', conversationId, removeQuestion: true });
        const conversation = current.conversations.find((c) => c.id === conversationId);
        const isFirst = (current.messages[conversationId]?.items.length ?? 0) === 0;
        const clientTurnId = newId();
        const runtime: TurnRuntime = {
          clientTurnId,
          question: q,
          userMessageId: `local-${clientTurnId}`,
          status: 'streaming',
          stages: DEFAULT_STAGES.map((st) =>
            st.stage === 'retrieving' ? { ...st, label: `Buscando trechos em ${current.activeCollections.join(', ')}` } : st,
          ),
          activeStage: 'analyzing',
          text: '',
          startedAt: Date.now(),
        };
        const title = isFirst && (!conversation || conversation.title === 'Nova conversa') ? truncateTitle(q, current.config?.conversationTitleMaxChars ?? 34) : undefined;
        dispatch({ type: 'turn/started', conversationId, runtime, title });
        const ctrl = new AbortController();
        turnControllers.current.set(conversationId, ctrl);
        sending.current = false;
        await runTurn(
          conversationId,
          clientTurnId,
          { conversationId, clientTurnId, question: q, modelId: current.modelId, collections: current.activeCollections },
          ctrl,
        );
      } catch (error) {
        toast(describeError(error), 'error');
      } finally {
        sending.current = false;
      }
    };

    return {
      retryBoot: boot,
      selectModel: (modelId) => dispatch({ type: 'model/selected', modelId }),
      toggleCollection: (name) => dispatch({ type: 'collections/toggled', name }),
      selectConversation: (id) => {
        dispatch({ type: 'conversation/selected', id });
        const slot = stateRef.current.messages[id];
        if (!slot || slot.status === 'error') loadMessages(id);
      },
      newConversation: () => {
        // The conversation is created on the server with the first question; until then the empty state shows.
        dispatch({ type: 'conversation/selected', id: null });
      },
      deleteConversation: async (id) => {
        try {
          turnControllers.current.get(id)?.abort();
          await api.deleteConversation(id);
          dispatch({ type: 'conversation/removed', id });
          const next = stateRef.current.activeConversationId;
          if (next && !stateRef.current.messages[next]) loadMessages(next);
          toast('Conversa excluída');
        } catch (error) {
          toast(describeError(error), 'error');
        }
      },
      reloadMessages: (conversationId) => {
        dispatch({ type: 'turn/dismissed', conversationId, removeQuestion: true });
        loadMessages(conversationId);
      },
      send,
      cancel: (conversationId) => {
        const turn = stateRef.current.turns[conversationId];
        turnControllers.current.get(conversationId)?.abort();
        if (turn?.turnId && api.cancelTurn) api.cancelTurn(turn.turnId).catch(() => undefined);
      },
      retry: (conversationId) => {
        const turn = stateRef.current.turns[conversationId];
        if (!turn || turn.status === 'streaming' || turn.error?.outcome === 'unknown') return;
        dispatch({ type: 'turn/dismissed', conversationId, removeQuestion: true });
        void send(turn.question);
      },
      dismissTurn: (conversationId) => dispatch({ type: 'turn/dismissed', conversationId, removeQuestion: true }),

      uploadFiles: (files, collection) => {
        const config = stateRef.current.config;
        if (!config || stateRef.current.upload?.status === 'running') return;
        const accepted: File[] = [];
        const rejected: string[] = [];
        for (const f of files) {
          if (!config.uploadAccept.includes(fileExtension(f.name))) rejected.push(`${f.name}: tipo não suportado`);
          else if (f.size > config.maxUploadBytes) rejected.push(`${f.name}: maior que o limite`);
          else accepted.push(f);
        }
        if (rejected.length) toast(rejected.join(' · '), 'error');
        if (!accepted.length) return;
        startIngest(collection, (onProgress, signal) => api.uploadDocuments({ collection, files: accepted }, onProgress, signal));
      },
      importFromDrive: (collection) => {
        const importer = api.importFromDrive?.bind(api);
        if (!importer || stateRef.current.upload?.status === 'running') return;
        startIngest(collection, (onProgress, signal) => importer({ collection }, onProgress, signal));
      },
      deleteDocument: async (doc) => {
        try {
          await api.deleteDocument(doc.id);
          dispatch({ type: 'document/removed', id: doc.id });
          refreshLibrary();
          toast(`Arquivo “${doc.name}” excluído`);
        } catch (error) {
          toast(describeError(error), 'error');
        }
      },
      openDocument: (documentId, highlight) => dispatch({ type: 'view/changed', view: { kind: 'document', documentId, highlight } }),
      showChat: () => dispatch({ type: 'view/changed', view: { kind: 'chat' } }),
      askAboutDocument: (doc) => {
        dispatch({ type: 'collections/activated', name: doc.collection });
        dispatch({ type: 'view/changed', view: { kind: 'chat' } });
        setDraftSeed(`Sobre ${doc.name}: `);
      },
    };

    function startIngest(
      collection: string,
      run: (onProgress: (items: UploadProgress[]) => void, signal: AbortSignal) => Promise<UploadResult>,
    ) {
      uploadController.current?.abort();
      const ctrl = new AbortController();
      uploadController.current = ctrl;
      const id = newId();
      dispatch({ type: 'upload/started', session: { id, collection, items: [], status: 'running' } });
      run((items) => dispatch({ type: 'upload/progress', id, items }), ctrl.signal)
        .then((result) => {
          dispatch({ type: 'upload/finished', id, saved: result.saved });
          refreshLibraryAfterUpload();
          const n = result.saved.length;
          if (n) toast(`${n} ${n > 1 ? 'arquivos adicionados' : 'arquivo adicionado'} a ${collection}`);
          if (result.skipped.length) toast(`${result.skipped.length} arquivo(s) não processado(s): ${result.skipped.map((s) => s.fileName).join(', ')}`, 'error');
          setTimeout(() => dispatch({ type: 'upload/cleared', id }), result.skipped.length ? 4000 : 1200);
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return dispatch({ type: 'upload/cleared', id });
          dispatch({ type: 'upload/failed', id, error: describeError(error) });
          toast(describeError(error), 'error');
        });
    }

    function refreshLibraryAfterUpload() {
      api.listCollections().then((collections) => dispatch({ type: 'collections/loaded', collections })).catch(() => undefined);
    }
  }, [api, toast]);

  useEffect(() => {
    actions.retryBoot();
    const turns = turnControllers.current;
    const loads = loadControllers.current;
    return () => {
      turns.forEach((c) => c.abort());
      loads.forEach((c) => c.abort());
      uploadController.current?.abort();
    };
  }, [actions]);

  const draft = useMemo(() => ({ seed: draftSeed }), [draftSeed]);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>
        <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>
      </StateContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useAppState(): AppState {
  const value = useContext(StateContext);
  if (!value) throw new Error('useAppState must be used inside <StoreProvider>');
  return value;
}

export function useActions(): StoreActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useActions must be used inside <StoreProvider>');
  return value;
}

/** A one-shot text the composer should adopt (e.g. "Perguntar sobre este arquivo"). */
export function useDraftSeed() {
  const value = useContext(DraftContext);
  if (!value) throw new Error('useDraftSeed must be used inside <StoreProvider>');
  return value.seed;
}
