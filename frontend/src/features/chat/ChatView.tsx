import type { ReactNode } from 'react';
import type { AssistantMessage } from '../../services/api';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Primitives';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { MessageList } from './MessageList';

interface ChatViewProps {
  variant: 'desktop' | 'mobile';
  onAttach?: () => void;
  onPickFiles?: (files: File[]) => void;
  onOpenSource?: (message: AssistantMessage, n: number) => void;
  /** Mobile: controls shown above the composer (collection scope button). */
  mobileAccessory?: ReactNode;
}

/** Thread + composer for the active conversation, with loading, error and empty states. */
export function ChatView({ variant, onAttach, onPickFiles, onOpenSource, mobileAccessory }: ChatViewProps) {
  const { activeConversationId, messages, turns } = useAppState();
  const { reloadMessages } = useActions();
  const slot = activeConversationId ? messages[activeConversationId] : undefined;
  const turn = activeConversationId ? turns[activeConversationId] : undefined;
  const items = slot?.items ?? [];
  const isEmpty = !activeConversationId || (slot?.status === 'ready' && items.length === 0 && !turn);
  const loading = !!activeConversationId && (!slot || (slot.status === 'loading' && items.length === 0));

  const bottomComposer =
    variant === 'mobile' ? null : (
      <div className="composer-dock">
        <div className="composer-dock__inner">
          <Composer variant="desktop" onAttach={onAttach} />
          <div className="composer-dock__hint mono">Enter envia · Shift + Enter quebra linha · respostas citam os documentos ativos</div>
        </div>
      </div>
    );

  let body;
  if (loading) {
    body = (
      <div className="thread" aria-busy="true" aria-label="Carregando conversa">
        <div className={`thread__inner thread__inner--${variant}`}>
          <div className="skeleton-stack">
            <Skeleton width="46%" height={40} className="skeleton--bubble" />
            <Skeleton width="82%" />
            <Skeleton width="74%" />
            <Skeleton width="58%" />
          </div>
        </div>
      </div>
    );
  } else if (slot?.status === 'error' && items.length === 0) {
    body = (
      <div className="thread">
        <div className={`thread__inner thread__inner--${variant}`}>
          <div className="turn-notice turn-notice--error" role="alert">
            <div className="turn-notice__body">
              <div className="turn-notice__title">Não foi possível carregar esta conversa.</div>
              <div className="turn-notice__text">{slot.error}</div>
              <div className="turn-notice__actions">
                <Button variant="primary" size="sm" onClick={() => activeConversationId && reloadMessages(activeConversationId)}>
                  Tentar de novo
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (isEmpty) {
    body = (
      <div className="thread">
        <EmptyState variant={variant} composer={variant === 'desktop' ? <Composer variant="desktop-hero" onAttach={onAttach} autoFocus /> : undefined} />
      </div>
    );
  } else {
    body = <MessageList conversationId={activeConversationId!} messages={items} turn={turn} variant={variant} onOpenSource={onOpenSource} />;
  }

  return (
    <>
      {body}
      {variant === 'desktop' && !isEmpty && bottomComposer}
      {variant === 'mobile' && <MobileComposerDock onPickFiles={onPickFiles} accessory={mobileAccessory} />}
    </>
  );
}

function MobileComposerDock({ onPickFiles, accessory }: { onPickFiles?: (files: File[]) => void; accessory?: ReactNode }) {
  return (
    <div className="composer-dock composer-dock--mobile">
      {accessory}
      <Composer variant="mobile" onPickFiles={onPickFiles} />
    </div>
  );
}
