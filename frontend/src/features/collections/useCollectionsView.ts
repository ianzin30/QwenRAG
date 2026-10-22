import { useActions, useAppState } from '../../app/store/StoreProvider';

export interface CollectionToggle {
  name: string;
  active: boolean;
  documentCount: number;
  toggle: () => void;
}

/** Collections shown as chips (desktop) or switches (mobile). */
export function useCollectionToggles(): CollectionToggle[] {
  const { collections, activeCollections, documents } = useAppState();
  const { toggleCollection } = useActions();
  return collections.map((c) => ({
    name: c.name,
    active: activeCollections.includes(c.name),
    // Prefer the live library count; fall back to the backend's number before documents load.
    documentCount: documents.some((d) => d.collection === c.name) ? documents.filter((d) => d.collection === c.name).length : c.documentCount,
    toggle: () => toggleCollection(c.name),
  }));
}

/** Scope summary under the composer, e.g. "graduacao · 4 arquivos". */
export function useComposerScope() {
  const toggles = useCollectionToggles();
  const active = toggles.filter((t) => t.active);
  const count = active.reduce((n, t) => n + t.documentCount, 0);
  const locked = active.length === 0 || count === 0;
  return {
    locked,
    activeNames: active.map((t) => t.name),
    documentCount: count,
    label: active.length === 0 ? 'nenhuma coleção ativa' : `${active.map((t) => t.name).join(' + ')} · ${count} arquivos`,
    shortLabel: active.length === 0 ? 'Nenhuma coleção' : `${active.map((t) => t.name).join(' + ')} · ${count}`,
    lockedPlaceholder: active.length === 0 ? 'Ative uma coleção para perguntar' : 'Envie arquivos para liberar o chat',
  };
}
