import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { AssistantMessage as AssistantMessageModel, Message } from '../../services/api';
import type { TurnRuntime } from '../../app/store/state';
import { useActions } from '../../app/store/StoreProvider';
import { AssistantMessage } from './AssistantMessage';
import { PendingTurn } from './PendingTurn';

interface MessageListProps {
  conversationId: string;
  messages: Message[];
  turn?: TurnRuntime;
  variant: 'desktop' | 'mobile';
  onOpenSource?: (message: AssistantMessageModel, n: number) => void;
  footer?: ReactNode;
}

/** Scrollable thread. Follows the bottom while streaming unless the reader scrolled up. */
export function MessageList({ conversationId, messages, turn, variant, onOpenSource, footer }: MessageListProps) {
  const { send } = useActions();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastConversation = useRef(conversationId);

  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastConversation.current !== conversationId) {
      lastConversation.current = conversationId;
      pinned.current = true;
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [conversationId, messages.length, turn?.text, turn?.status, turn?.activeStage]);

  const busy = turn?.status === 'streaming';
  return (
    <div ref={scroller} className="thread" onScroll={onScroll}>
      <div className={`thread__inner thread__inner--${variant}`}>
        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="user-msg anim-rise">
                <div className="user-msg__bubble">{m.content}</div>
              </div>
            );
          }
          const previous = messages[i - 1];
          const question = previous?.role === 'user' ? previous.content : undefined;
          return (
            <AssistantMessage
              key={m.id}
              message={m}
              variant={variant}
              onOpenSource={onOpenSource}
              onRegenerate={question && !busy ? () => void send(question) : undefined}
            />
          );
        })}
        {turn && <PendingTurn conversationId={conversationId} turn={turn} />}
        {footer}
      </div>
    </div>
  );
}
