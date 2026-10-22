import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { useToast } from '../../app/providers/ToastProvider';
import { Icon } from '../../components/icons/Icon';
import type { ModelOption } from '../../services/api';

export function useModels() {
  const { config, modelId } = useAppState();
  const { selectModel } = useActions();
  const toast = useToast();
  const models = config?.models ?? [];
  const current = models.find((m) => m.id === modelId) ?? models[0];
  const choose = (m: ModelOption) => {
    if (m.id !== modelId) toast(`Modelo: ${m.label}`);
    selectModel(m.id);
  };
  return { models, current, choose };
}

/** Option rows shared by the desktop popover and the mobile sheet. */
export function ModelOptionList({ onChosen, variant }: { onChosen: () => void; variant: 'popover' | 'sheet' }) {
  const { models, current, choose } = useModels();
  const listRef = useRef<HTMLDivElement>(null);

  // Arrow keys move between options (listbox pattern).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div ref={listRef} role="listbox" aria-label="Modelos" className={variant === 'sheet' ? 'option-list' : 'model-list'} onKeyDown={onKeyDown}>
      {models.map((m) => {
        const selected = m.id === current?.id;
        return (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-autofocus={selected ? '' : undefined}
            className={`option${selected ? ' is-selected' : ''}`}
            onClick={() => {
              choose(m);
              onChosen();
            }}
          >
            <span className="option__text">
              <span className="option__label">{m.label}</span>
              <span className="option__sub mono">{m.id}</span>
            </span>
            {variant === 'popover' && m.isDefault && <span className="option__note">Padrão</span>}
            {selected && <Icon name="check" className="option__check" />}
          </button>
        );
      })}
    </div>
  );
}

/** Desktop header pill + popover. Closes on Escape, outside click and selection. */
export function ModelPicker() {
  const { current } = useModels();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!current) return null;
  return (
    <div className="model-picker" ref={root}>
      <button ref={trigger} type="button" className="model-pill" aria-haspopup="listbox" aria-expanded={open} aria-controls={popoverId} onClick={() => setOpen((v) => !v)}>
        <span className="status-dot" aria-hidden="true" />
        {current.label}
        <Icon name="chevronDown" size={14} className="muted" />
      </button>
      {open && (
        <div id={popoverId} className="popover anim-pop">
          <div className="section-label popover__label">Modelo de resposta</div>
          <ModelOptionList
            variant="popover"
            onChosen={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />
          <div className="popover__foot mono">Lista definida em [llm_models] · config.toml</div>
        </div>
      )}
    </div>
  );
}
