import { Fragment } from 'react';
import type { AssistantMessage } from '../../services/api';
import { citationNumber } from '../sources/sourceUtils';

interface AnswerTextProps {
  message: AssistantMessage;
  activeCitation?: number | null;
  onCite?: (n: number) => void;
}

/**
 * Renders the answer. When the backend sends claims (Engine claims → evidence_ids), each claim is
 * followed by its citation markers, numbered by position in the source list. Without claims the
 * plain `content` is shown. All text is rendered as React text nodes.
 */
export function AnswerText({ message, activeCitation, onCite }: AnswerTextProps) {
  const showCitations = message.route === 'retrieval' && message.claims.length > 0 && message.sources.length > 0;
  if (!showCitations) return <div className="answer-text">{message.content}</div>;

  return (
    <div className="answer-text">
      {message.claims.map((claim, i) => {
        const numbers = [...new Set(claim.evidenceIds.map((id) => citationNumber(message, id)).filter((n): n is number => n !== null))];
        const text = claim.text.trim();
        const punctuated = /[.!?:]$/.test(text);
        return (
          <Fragment key={claim.claimId}>
            {i > 0 && ' '}
            {text}
            {numbers.map((n) => (
              <button
                key={n}
                type="button"
                className={`cite${activeCitation === n ? ' is-active' : ''}`}
                onClick={() => onCite?.(n)}
                aria-label={`Abrir fonte ${n}`}
              >
                {n}
              </button>
            ))}
            {!punctuated && '.'}
          </Fragment>
        );
      })}
    </div>
  );
}
