import { useState } from 'react';
import { useActions, useAppState } from '../store/StoreProvider';
import { useTheme } from '../providers/ThemeProvider';
import { BrandMark, Icon } from '../../components/icons/Icon';
import { Button, IconButton } from '../../components/ui/Button';
import { Drawer, Sheet } from '../../components/ui/Overlay';
import { ChatView } from '../../features/chat/ChatView';
import { ConversationList } from '../../features/conversations/ConversationList';
import { FilesPanel } from '../../features/documents/FilesPanel';
import { DocumentView } from '../../features/documents/DocumentView';
import { DeleteDocumentConfirm } from '../../features/documents/DeleteDocumentConfirm';
import { CollectionSwitchList } from '../../features/collections/CollectionControls';
import { useComposerScope } from '../../features/collections/useCollectionsView';
import { ModelOptionList, useModels } from '../../features/models/ModelPicker';
import { SourceDetail, SourceDetailHeading } from '../../features/sources/SourceDetail';
import { highlightFor, isLegacy, resolveDocument } from '../../features/sources/sourceUtils';
import type { AssistantMessage, DocumentMeta } from '../../services/api';

type SheetKind = 'drawer' | 'model' | 'scope' | 'source' | null;

export function MobileShell() {
  const state = useAppState();
  const { newConversation, showChat, uploadFiles, openDocument } = useActions();
  const { toggle: toggleTheme, theme } = useTheme();
  const { current: model } = useModels();
  const scope = useComposerScope();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [panel, setPanel] = useState<'chats' | 'files'>('chats');
  const [source, setSource] = useState<{ messageId: string; n: number } | null>(null);
  const [toDelete, setToDelete] = useState<DocumentMeta | null>(null);
  const close = () => setSheet(null);

  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const view = state.view;
  const doc = view.kind === 'document' ? state.documents.find((d) => d.id === view.documentId) : undefined;
  const title = state.view.kind === 'document' ? doc?.name ?? 'Documento' : conversation?.title ?? 'Nova conversa';

  const target = state.activeCollections[0] ?? state.collections[0]?.name ?? '';
  const pickFiles = (files: File[]) => {
    if (!target) return;
    uploadFiles(files, target);
    setPanel('files');
    setSheet('drawer');
  };

  const openSource = (message: AssistantMessage, n: number) => {
    setSource({ messageId: message.id, n });
    setSheet('source');
  };

  const sourceMessage = source
    ? (state.messages[state.activeConversationId ?? '']?.items.find((m) => m.id === source.messageId) as AssistantMessage | undefined)
    : undefined;
  const currentSource = source && sourceMessage ? sourceMessage.sources[source.n - 1] : undefined;
  const sourceDoc = currentSource ? resolveDocument(currentSource, state.documents) : undefined;

  return (
    <div className="mobile-shell">
      <header className="m-header">
        {state.view.kind === 'document' ? (
          <IconButton icon="chevronLeft" label="Voltar ao chat" size="touch" onClick={showChat} />
        ) : (
          <IconButton icon="menu" label="Abrir conversas e arquivos" size="touch" onClick={() => setSheet('drawer')} />
        )}
        <button type="button" className="m-header__title" onClick={() => setSheet('model')} aria-label={`${title}. Modelo: ${model?.label ?? ''}. Trocar modelo`}>
          <span className="m-header__name">{title}</span>
          <span className="m-header__model mono">
            <span className="status-dot status-dot--sm" aria-hidden="true" />
            {model?.label}
            <Icon name="chevronDown" size={12} />
          </span>
        </button>
        <IconButton icon="edit" label="Nova conversa" size="touch" onClick={newConversation} />
      </header>

      {state.view.kind === 'chat' ? (
        <ChatView
          variant="mobile"
          onPickFiles={pickFiles}
          onOpenSource={openSource}
          mobileAccessory={
            <div className="m-scope">
              <button type="button" className="scope-btn" onClick={() => setSheet('scope')}>
                <Icon name="folder" size={14} />
                {scope.shortLabel}
              </button>
            </div>
          }
        />
      ) : (
        <DocumentView variant="mobile" onRequestDelete={setToDelete} />
      )}

      <Drawer open={sheet === 'drawer'} onClose={close} title="Conversas e arquivos">
        <div className="drawer__brand">
          <BrandMark />
          <span className="drawer__name">RAG UFC</span>
          <IconButton icon="moon" label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} size="touch" onClick={toggleTheme} />
          <IconButton icon="close" label="Fechar menu" size="touch" onClick={close} />
        </div>
        <div className="drawer__tabs">
          <div className="segmented segmented--touch" role="tablist" aria-label="Painel">
            <button type="button" role="tab" aria-selected={panel === 'chats'} className={`segmented__tab${panel === 'chats' ? ' is-on' : ''}`} onClick={() => setPanel('chats')}>
              Conversas
            </button>
            <button type="button" role="tab" aria-selected={panel === 'files'} className={`segmented__tab${panel === 'files' ? ' is-on' : ''}`} onClick={() => setPanel('files')}>
              Arquivos
            </button>
          </div>
        </div>
        <div className="drawer__body">
          {panel === 'chats' ? (
            <ConversationList variant="mobile" onPicked={close} />
          ) : (
            <FilesPanel variant="mobile" onRequestDelete={setToDelete} onOpened={close} />
          )}
        </div>
        <div className="drawer__foot mono">
          Workspace local · {state.collections.length} coleções · {state.documents.length} arquivos
        </div>
      </Drawer>

      <Sheet open={sheet === 'model'} onClose={close} title="Modelo de resposta">
        <ModelOptionList variant="sheet" onChosen={close} />
        <div className="sheet__foot mono">Lista definida em [llm_models] · config.toml</div>
      </Sheet>

      <Sheet open={sheet === 'scope'} onClose={close} title="Coleções ativas">
        <p className="sheet__subtitle">As respostas usam só os arquivos das coleções ligadas.</p>
        <CollectionSwitchList />
      </Sheet>

      <Sheet open={sheet === 'source' && !!currentSource} onClose={close} title={currentSource ? `Fonte ${source?.n}` : 'Fonte'} hideTitle className="sheet--tall">
        {currentSource && sourceMessage && source && (
          <>
            <div className="sheet__source-head">
              <SourceDetailHeading source={currentSource} n={source.n} citationLabel={isLegacy(sourceMessage) ? 'Fonte histórica' : 'Fonte citada'} />
              <IconButton icon="close" label="Fechar fonte" size="touch" onClick={close} />
            </div>
            <div className="sheet__scroll" key={currentSource.sourceId}>
              <SourceDetail source={currentSource} previewChars={state.config?.excerptChars ?? 900} size="lg" canOpenDocument={false} onOpenDocument={() => undefined} />
            </div>
            <div className="sheet__nav">
              <Button size="lg" disabled={source.n <= 1} onClick={() => setSource({ ...source, n: source.n - 1 })} aria-label="Fonte anterior">
                ‹ Anterior
              </Button>
              <Button
                size="lg"
                variant="primary"
                disabled={!sourceDoc}
                onClick={() => {
                  if (!sourceDoc) return;
                  openDocument(sourceDoc.id, highlightFor(currentSource, source.n));
                  close();
                }}
              >
                Abrir doc
              </Button>
              <Button size="lg" disabled={source.n >= sourceMessage.sources.length} onClick={() => setSource({ ...source, n: source.n + 1 })} aria-label="Próxima fonte">
                Próxima ›
              </Button>
            </div>
          </>
        )}
      </Sheet>

      <DeleteDocumentConfirm doc={toDelete} variant="mobile" onClose={() => setToDelete(null)} />
    </div>
  );
}
