import type { TurnRuntime } from '../../app/store/state';
import { useActions } from '../../app/store/StoreProvider';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Primitives';
import { Icon } from '../../components/icons/Icon';

/** Live turn: stage list while waiting, then progressive text once deltas arrive. */
export function PendingTurn({ conversationId, turn }: { conversationId: string; turn: TurnRuntime }) {
  if (turn.status === 'failed' || turn.status === 'cancelled') return <TurnNotice conversationId={conversationId} turn={turn} />;
  const activeIndex = turn.stages.findIndex((s) => s.stage === turn.activeStage);

  return (
    <article className="pending-turn anim-rise" aria-live="polite" aria-busy="true">
      {turn.text ? (
        <>
          <div className="pending-turn__status mono anim-fade">
            <Spinner size={10} />
            {turn.stages.find((s) => s.stage === 'generating')?.label ?? 'Redigindo resposta'}
          </div>
          <div className="answer-text">
            {turn.text}
            <span className="stream-caret" aria-hidden="true" />
          </div>
        </>
      ) : (
        <ol className="steps anim-fade" aria-label="Etapas da resposta">
          {turn.stages.map((s, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
            return (
              <li key={s.stage} className={`step step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
                {state === 'done' && <Icon name="check" size={14} className="step__check" />}
                {state === 'active' && <Spinner />}
                {state === 'todo' && <span className="step__dot" />}
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

/** Failure / cancellation notice. "unknown" outcomes are never retried automatically (Turns.run). */
function TurnNotice({ conversationId, turn }: { conversationId: string; turn: TurnRuntime }) {
  const { retry, dismissTurn, reloadMessages } = useActions();
  if (turn.status === 'cancelled') {
    return (
      <div className="turn-notice turn-notice--neutral anim-rise" role="status">
        <Icon name="info" />
        <div className="turn-notice__body">
          <div className="turn-notice__title">Resposta cancelada.</div>
          <div className="turn-notice__text">{turn.text ? 'O texto parcial foi descartado.' : 'Nenhuma resposta foi salva.'}</div>
          <div className="turn-notice__actions">
            <Button variant="primary" size="sm" onClick={() => retry(conversationId)}>
              Perguntar de novo
            </Button>
            <Button size="sm" onClick={() => dismissTurn(conversationId)}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    );
  }
  const unknown = turn.error?.outcome === 'unknown';
  return (
    <div className="turn-notice turn-notice--error anim-rise" role="alert">
      <Icon name="alert" />
      <div className="turn-notice__body">
        <div className="turn-notice__title">{unknown ? 'Não sabemos se a resposta foi concluída.' : 'Não foi possível concluir a resposta.'}</div>
        <div className="turn-notice__text">{turn.error?.message}</div>
        <div className="turn-notice__actions">
          {unknown ? (
            <Button variant="primary" size="sm" onClick={() => reloadMessages(conversationId)}>
              Atualizar histórico
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => retry(conversationId)}>
              Tentar novamente
            </Button>
          )}
          <Button size="sm" onClick={() => dismissTurn(conversationId)}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
