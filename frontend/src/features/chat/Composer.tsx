import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useActions, useAppState, useDraftSeed } from '../../app/store/StoreProvider';
import { Icon } from '../../components/icons/Icon';
import { IconButton } from '../../components/ui/Button';
import { useComposerScope } from '../collections/useCollectionsView';

interface ComposerProps {
  variant: 'desktop' | 'desktop-hero' | 'mobile';
  /** Desktop: the paperclip opens the files panel. */
  onAttach?: () => void;
  /** Mobile: the "+" button picks files directly. */
  onPickFiles?: (files: File[]) => void;
  autoFocus?: boolean;
}

export function Composer({ variant, onAttach, onPickFiles, autoFocus }: ComposerProps) {
  const { send, cancel } = useActions();
  const { activeConversationId, turns, config } = useAppState();
  const scope = useComposerScope();
  const seed = useDraftSeed();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  const turn = activeConversationId ? turns[activeConversationId] : undefined;
  const streaming = turn?.status === 'streaming';
  const locked = scope.locked;
  const canSend = !locked && !streaming && draft.trim().length > 0;

  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    input.current?.focus();
  }, [seed]);

  const submit = () => {
    if (!canSend) return;
    const question = draft;
    setDraft('');
    void send(question);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = locked ? scope.lockedPlaceholder : variant === 'mobile' ? 'Pergunte sobre os documentos…' : 'Faça uma pergunta sobre os documentos carregados…';

  const action = streaming ? (
    <button type="button" className="send-btn send-btn--stop" onClick={() => activeConversationId && cancel(activeConversationId)} aria-label="Parar resposta">
      <Icon name="stop" size={variant === 'mobile' ? 16 : 18} />
    </button>
  ) : (
    <button type="button" className="send-btn" onClick={submit} disabled={!canSend} aria-label="Enviar pergunta">
      <Icon name="arrowUp" size={18} />
    </button>
  );

  const textarea = (
    <textarea
      ref={input}
      className="composer__input"
      rows={variant === 'desktop-hero' ? 2 : 1}
      aria-label="Pergunta"
      placeholder={placeholder}
      value={draft}
      disabled={locked}
      autoFocus={autoFocus}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );

  if (variant === 'mobile') {
    return (
      <div className="composer composer--mobile">
        <label className="icon-btn icon-btn--round" aria-label="Adicionar arquivos" title="Adicionar arquivos">
          <input
            type="file"
            multiple
            className="sr-only"
            accept={config?.uploadAccept.map((e) => `.${e}`).join(',')}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) onPickFiles?.(files);
            }}
          />
          <Icon name="plus" size={20} />
        </label>
        {textarea}
        {action}
      </div>
    );
  }

  return (
    <div className={`composer composer--${variant}`}>
      {textarea}
      <div className="composer__bar">
        <IconButton icon="paperclip" label="Adicionar arquivos" onClick={onAttach} />
        <span className="composer__scope mono">{scope.label}</span>
        <span className="spacer" />
        {action}
      </div>
    </div>
  );
}
