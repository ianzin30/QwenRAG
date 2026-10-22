import { Icon } from '../../components/icons/Icon';
import { useCollectionToggles } from './useCollectionsView';

/** Desktop header: one toggle chip per collection. */
export function CollectionChips() {
  const toggles = useCollectionToggles();
  return (
    <div className="chips" role="group" aria-label="Coleções ativas">
      {toggles.map((t) => (
        <button key={t.name} type="button" className={`chip${t.active ? ' is-on' : ''}`} aria-pressed={t.active} onClick={t.toggle}>
          <Icon name="folder" size={13} />
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** Mobile sheet body: one switch per collection. */
export function CollectionSwitchList() {
  const toggles = useCollectionToggles();
  return (
    <div className="option-list">
      {toggles.map((t) => (
        <button key={t.name} type="button" role="switch" aria-checked={t.active} className="option" onClick={t.toggle}>
          <span className="option__text">
            <span className="option__label">{t.name}</span>
            <span className="option__sub mono">{t.documentCount} arquivos</span>
          </span>
          <span className={`switch${t.active ? ' is-on' : ''}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
