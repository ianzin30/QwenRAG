import { useState } from 'react';
import { useActions, useAppState } from '../store/StoreProvider';
import { useTheme } from '../providers/ThemeProvider';
import { BrandMark, Icon } from '../../components/icons/Icon';
import { Button, IconButton } from '../../components/ui/Button';
import { ChatView } from '../../features/chat/ChatView';
import { ConversationList } from '../../features/conversations/ConversationList';
import { FilesPanel } from '../../features/documents/FilesPanel';
import { DocumentView } from '../../features/documents/DocumentView';
import { DeleteDocumentConfirm } from '../../features/documents/DeleteDocumentConfirm';
import { useWindowFileDrop } from '../../features/documents/useWindowFileDrop';
import { CollectionChips } from '../../features/collections/CollectionControls';
import { ModelPicker } from '../../features/models/ModelPicker';
import type { DocumentMeta } from '../../services/api';

type Panel = 'chats' | 'files';

export function DesktopShell() {
  const state = useAppState();
  const { newConversation, showChat, uploadFiles } = useActions();
  const { toggle: toggleTheme, theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panel, setPanel] = useState<Panel>('chats');
  const [toDelete, setToDelete] = useState<DocumentMeta | null>(null);

  const dropTarget = state.activeCollections[0] ?? state.collections[0]?.name ?? '';
  const dragging = useWindowFileDrop((files) => {
    setSidebarOpen(true);
    setPanel('files');
    if (dropTarget) uploadFiles(files, dropTarget);
  }, !!dropTarget);

  const conversation = state.conversations.find((c) => c.id === state.activeConversationId);
  const view = state.view;
  const doc = view.kind === 'document' ? state.documents.find((d) => d.id === view.documentId) : undefined;
  const title = state.view.kind === 'document' ? doc?.name ?? 'Documento' : conversation?.title ?? 'Nova conversa';
  const openFiles = () => {
    setSidebarOpen(true);
    setPanel('files');
  };

  return (
    <div className="desktop-shell">
      {sidebarOpen && (
        <aside className="sidebar anim-fade" aria-label="Barra lateral">
          <div className="sidebar__brand">
            <BrandMark />
            <span className="sidebar__name">RAG UFC</span>
            <IconButton icon="sidebar" label="Recolher barra lateral" onClick={() => setSidebarOpen(false)} />
          </div>

          <div className="segmented" role="tablist" aria-label="Painel">
            <button type="button" role="tab" id="tab-chats" aria-selected={panel === 'chats'} aria-controls="panel-chats" className={`segmented__tab${panel === 'chats' ? ' is-on' : ''}`} onClick={() => setPanel('chats')}>
              <Icon name="chat" size={16} />
              Conversas
            </button>
            <button type="button" role="tab" id="tab-files" aria-selected={panel === 'files'} aria-controls="panel-files" className={`segmented__tab${panel === 'files' ? ' is-on' : ''}`} onClick={() => setPanel('files')}>
              <Icon name="folder" size={16} />
              Arquivos
            </button>
          </div>

          {panel === 'chats' ? (
            <div id="panel-chats" role="tabpanel" aria-labelledby="tab-chats" className="sidebar__panel anim-fade">
              <Button icon="plus" className="btn--block btn--start" onClick={newConversation}>
                Nova conversa
              </Button>
              <ConversationList variant="desktop" />
            </div>
          ) : (
            <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" className="sidebar__panel sidebar__panel--scroll anim-fade">
              <FilesPanel variant="desktop" onRequestDelete={setToDelete} />
            </div>
          )}

          <div className="sidebar__foot">
            <span className="avatar" aria-hidden="true">
              <Icon name="user" size={16} />
            </span>
            <span className="sidebar__workspace">
              <span className="sidebar__workspace-name">Workspace local</span>
              <span className="mono muted small">
                {state.collections.length} coleções · {state.documents.length} arquivos
              </span>
            </span>
            <IconButton icon="moon" label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} onClick={toggleTheme} />
          </div>
        </aside>
      )}

      <main className="main" aria-label="Conteúdo">
        <header className="topbar">
          {!sidebarOpen && <IconButton icon="sidebar" label="Abrir barra lateral" className="anim-fade" onClick={() => setSidebarOpen(true)} />}
          {state.view.kind === 'document' && <IconButton icon="chevronLeft" label="Voltar ao chat" onClick={showChat} />}
          <h1 className="topbar__title">{title}</h1>
          {state.view.kind === 'chat' && (
            <div className="hide-sm">
              <CollectionChips />
            </div>
          )}
          <span className="spacer" />
          <ModelPicker />
        </header>

        {state.view.kind === 'chat' ? <ChatView variant="desktop" onAttach={openFiles} /> : <DocumentView variant="desktop" onRequestDelete={setToDelete} />}
      </main>

      {dragging && (
        <div className="drag-overlay anim-fade" aria-hidden="true">
          <div className="drag-overlay__card">
            <Icon name="upload" size={34} />
            <div className="drag-overlay__title">Solte para adicionar a {dropTarget}</div>
            <div className="drag-overlay__hint">Os arquivos são extraídos e indexados automaticamente</div>
          </div>
        </div>
      )}

      <DeleteDocumentConfirm doc={toDelete} variant="desktop" onClose={() => setToDelete(null)} />
    </div>
  );
}
