import type { ReactNode } from 'react';
import { useActions } from '../../app/store/StoreProvider';
import { Icon } from '../../components/icons/Icon';
import { useComposerScope } from '../collections/useCollectionsView';

/** Starter questions from the prototypes. They are UI suggestions only; answers always come from the API. */
export const SUGGESTIONS = ['Até quando posso trancar uma disciplina em 2026.1?', 'Como solicito aproveitamento de estudos?', 'Resuma o PPC de Computação'];

export function EmptyState({ variant, composer }: { variant: 'desktop' | 'mobile'; composer?: ReactNode }) {
  const { send } = useActions();
  const scope = useComposerScope();
  const subtitle =
    scope.activeNames.length === 0
      ? variant === 'mobile'
        ? 'Ative uma coleção abaixo para liberar o chat.'
        : 'Ative uma coleção no topo para liberar o chat.'
      : scope.documentCount === 0
        ? 'Envie arquivos para esta coleção para liberar o chat.'
        : `Pergunte ${variant === 'mobile' ? 'sobre' : 'algo sobre'} os ${scope.documentCount} arquivos de ${scope.activeNames.join(' e ')}.`;

  return (
    <div className={`empty-state empty-state--${variant} anim-rise`}>
      <div className="empty-state__copy">
        <h1 className="empty-state__title">
          {variant === 'mobile' ? (
            <>
              Por onde
              <br />
              começamos?
            </>
          ) : (
            'Por onde começamos?'
          )}
        </h1>
        <p className="empty-state__subtitle">{subtitle}</p>
      </div>
      {composer}
      <div className={`suggestions suggestions--${variant}`}>
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="suggestion" disabled={scope.locked} onClick={() => void send(s)}>
            {variant === 'mobile' && <Icon name="arrowRight" size={16} />}
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
