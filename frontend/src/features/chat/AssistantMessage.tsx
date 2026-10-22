import { useEffect, useId, useRef, useState } from 'react';
import type { AssistantMessage as AssistantMessageModel } from '../../services/api';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { IconButton } from '../../components/ui/Button';
import { SectionLabel } from '../../components/ui/Primitives';
import { Icon } from '../../components/icons/Icon';
import { formatSeconds } from '../../lib/format';
import { AnswerText } from './AnswerText';
import { SourceCard } from '../sources/SourceCard';
import { SourceDetail, SourceDetailHeading } from '../sources/SourceDetail';
import { highlightFor, isLegacy, resolveDocument } from '../sources/sourceUtils';

interface AssistantMessageProps {
  message: AssistantMessageModel;
  variant: 'desktop' | 'mobile';
  /** Mobile: citations open the bottom sheet owned by the shell. */
  onOpenSource?: (message: AssistantMessageModel, n: number) => void;
  onRegenerate?: () => void;
}

const STATE_NOTES: Partial<Record<AssistantMessageModel['state'], string>> = {
  partial: 'Resposta parcial — parte da pergunta não foi coberta pelos documentos.',
  clarification_required: 'O assistente precisa de mais detalhes para responder.',
};

export function AssistantMessage({ message, variant, onOpenSource, onRegenerate }: AssistantMessageProps) {
  const { config, documents } = useAppState();
  const { openDocument } = useActions();
  const [openN, setOpenN] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const detailId = useId();
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const legacy = isLegacy(message);
  const showSources = message.route === 'retrieval' && message.sources.length > 0;
  const previewChars = config?.excerptChars ?? 900;
  const openSource = openN ? message.sources[openN - 1] : undefined;
  const citationLabel = legacy ? 'Fonte histórica' : 'Fonte citada';

  const cite = (n: number) => {
    if (variant === 'mobile') onOpenSource?.(message, n);
    else setOpenN(n);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the button simply does nothing.
    }
  };

  const meta = [message.model?.label, formatSeconds(message.durationMs), showSources ? `${message.sources.length} fontes` : null].filter(Boolean).join(' · ');

  return (
    <article className={`assistant-msg assistant-msg--${variant} anim-rise`} aria-label="Resposta do assistente">
      <AnswerText message={message} activeCitation={variant === 'desktop' ? openN : null} onCite={cite} />

      {STATE_NOTES[message.state] && <p className="assistant-msg__note">{STATE_NOTES[message.state]}</p>}
      {legacy && <p className="assistant-msg__note">Resposta legada — modelo e execução não registrados.</p>}
      {message.warnings.map((w) => (
        <p key={w} className="assistant-msg__warning" role="note">
          <Icon name="alert" size={14} /> {w}
        </p>
      ))}

      <div className="assistant-msg__actions">
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copiado' : 'Copiar resposta'} size={variant === 'mobile' ? 'touch' : 'sm'} className={copied ? 'is-success' : undefined} onClick={copy} />
        {onRegenerate && <IconButton icon="refresh" label="Gerar novamente" size={variant === 'mobile' ? 'touch' : 'sm'} onClick={onRegenerate} />}
        {variant === 'desktop' && message.execution && (
          <IconButton icon="info" label="Detalhes da execução" size="sm" aria-expanded={showDetails} aria-controls={detailId} onClick={() => setShowDetails((v) => !v)} />
        )}
        {meta && <span className="assistant-msg__meta mono">{meta}</span>}
      </div>

      {showDetails && message.execution && (
        <dl id={detailId} className="exec-details mono anim-expand">
          <div>
            <dt>turn_id</dt>
            <dd>{message.turnId ?? '—'}</dd>
          </div>
          <div>
            <dt>coleção</dt>
            <dd>{message.collections.join(', ') || '—'}</dd>
          </div>
          <div className="exec-details__wide">
            <dt>modelo</dt>
            <dd>{message.model?.id ?? '—'}</dd>
          </div>
          <div>
            <dt>tempo</dt>
            <dd>{formatSeconds(message.durationMs) || '—'}</dd>
          </div>
          <div>
            <dt>rota</dt>
            <dd>{message.route}</dd>
          </div>
          {Object.entries(message.execution)
            .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      )}

      {showSources && variant === 'desktop' && (
        <section className="sources" aria-label="Fontes">
          <div className="sources__head">
            <SectionLabel>Fontes</SectionLabel>
            <span className="sources__rule" />
          </div>
          <div className="sources__grid">
            {message.sources.map((s, i) => (
              <SourceCard
                key={s.sourceId}
                source={s}
                n={i + 1}
                variant="grid"
                previewChars={previewChars}
                active={openN === i + 1}
                controls={`${detailId}-src`}
                onSelect={() => setOpenN(openN === i + 1 ? null : i + 1)}
              />
            ))}
          </div>
          {openSource && openN && (
            <div id={`${detailId}-src`} key={openSource.sourceId} className="source-panel anim-expand">
              <div className="source-panel__head">
                <SourceDetailHeading source={openSource} n={openN} citationLabel={citationLabel} />
                <IconButton icon="close" label="Fechar fonte" size="sm" onClick={() => setOpenN(null)} />
              </div>
              <SourceDetail
                source={openSource}
                previewChars={previewChars}
                canOpenDocument={!!resolveDocument(openSource, documents)}
                onOpenDocument={() => {
                  const doc = resolveDocument(openSource, documents);
                  if (doc) openDocument(doc.id, highlightFor(openSource, openN));
                }}
              />
            </div>
          )}
        </section>
      )}

      {showSources && variant === 'mobile' && (
        <div className="source-rail" role="list" aria-label="Fontes">
          {message.sources.map((s, i) => (
            <div role="listitem" key={s.sourceId}>
              <SourceCard source={s} n={i + 1} variant="rail" previewChars={previewChars} onSelect={() => onOpenSource?.(message, i + 1)} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
