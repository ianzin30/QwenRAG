import { useMemo, useState } from 'react';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { IconButton } from '../../components/ui/Button';
import { Icon } from '../../components/icons/Icon';
import { SectionLabel, Skeleton } from '../../components/ui/Primitives';
import { groupConversations } from '../../lib/format';

interface ConversationListProps {
  variant: 'desktop' | 'mobile';
  onPicked?: () => void;
}

/** Search + history grouped Hoje / Ontem / Anteriores. A conversation with a live turn shows a spinner. */
export function ConversationList({ variant, onPicked }: ConversationListProps) {
  const { conversations, conversationsStatus, activeConversationId, turns, view } = useAppState();
  const { selectConversation, deleteConversation } = useActions();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupConversations(q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations);
  }, [conversations, query]);

  const iconSize = variant === 'mobile' ? 'touch' : 'sm';

  return (
    <div className={`conversations conversations--${variant}`}>
      <label className="search-field">
        <Icon name="search" size={16} />
        <span className="sr-only">Buscar conversas</span>
        <input type="search" placeholder="Buscar conversas" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <nav aria-label="Histórico de conversas" className="conversations__groups">
        {conversationsStatus === 'loading' && (
          <div className="skeleton-stack">
            <Skeleton width="80%" />
            <Skeleton width="64%" />
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="conversations__group">
            <SectionLabel className="conversations__label">{g.label}</SectionLabel>
            <ul>
              {g.items.map((c) => {
                const active = c.id === activeConversationId && view.kind === 'chat';
                const live = turns[c.id]?.status === 'streaming';
                return (
                  <li key={c.id} className={`history-row${active ? ' is-active' : ''}`}>
                    <button
                      type="button"
                      className="history-row__pick"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        selectConversation(c.id);
                        onPicked?.();
                      }}
                    >
                      {c.title}
                    </button>
                    {live ? (
                      <span className="history-row__live" aria-label="Respondendo">
                        <span className="spinner" />
                      </span>
                    ) : (
                      <IconButton icon="trash" label={`Excluir conversa ${c.title}`} size={iconSize} className="history-row__action" onClick={() => void deleteConversation(c.id)} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {conversationsStatus === 'ready' && groups.length === 0 && <p className="conversations__empty">{query ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}</p>}
      </nav>
    </div>
  );
}
