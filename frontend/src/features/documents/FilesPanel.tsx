import { useMemo, useState } from 'react';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { useApi } from '../../app/providers/ApiProvider';
import { Button, IconButton } from '../../components/ui/Button';
import { Icon } from '../../components/icons/Icon';
import { ExtBadge, ProgressBar, SectionLabel } from '../../components/ui/Primitives';
import { relativeTime } from '../../lib/format';
import type { DocumentMeta, UploadProgress } from '../../services/api';

interface FilesPanelProps {
  variant: 'desktop' | 'mobile';
  onRequestDelete: (doc: DocumentMeta) => void;
  onOpened?: () => void;
}

const PHASE_LABEL: Record<UploadProgress['phase'], string> = {
  queued: 'na fila',
  uploading: 'enviando',
  extracting: 'extraindo',
  indexing: 'indexando',
  done: 'pronto',
  skipped: 'ignorado',
  error: 'erro',
};

function useTargetCollection() {
  const { collections, activeCollections } = useAppState();
  const [chosen, setChosen] = useState<string | null>(null);
  const names = collections.map((c) => c.name);
  const target = chosen && names.includes(chosen) ? chosen : activeCollections[0] ?? names[0] ?? '';
  return { target, setTarget: setChosen, names };
}

export function FilesPanel({ variant, onRequestDelete, onOpened }: FilesPanelProps) {
  const api = useApi();
  const { config, documents, documentsStatus, upload, view } = useAppState();
  const { uploadFiles, importFromDrive, openDocument } = useActions();
  const { target, setTarget, names } = useTargetCollection();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const byCollection = new Map<string, DocumentMeta[]>(names.map((n) => [n, []]));
    for (const d of documents) byCollection.set(d.collection, [...(byCollection.get(d.collection) ?? []), d]);
    return [...byCollection.entries()];
  }, [documents, names]);

  const uploading = upload?.status === 'running';
  const driveEnabled = !!config?.features.driveImport && !!api.importFromDrive;
  const accept = config?.uploadAccept.map((e) => `.${e}`).join(',');
  const maxMb = config ? Math.round(config.maxUploadBytes / 1024 / 1024) : 200;
  const done = upload?.items.filter((i) => i.phase === 'done').length ?? 0;

  return (
    <div className={`files files--${variant}`}>
      <label className={`dropzone dropzone--${variant}${uploading ? ' is-busy' : ''}`}>
        <input
          type="file"
          multiple
          className="sr-only"
          accept={accept}
          disabled={uploading || !target}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) uploadFiles(files, target);
          }}
        />
        <span className="dropzone__icon">
          <Icon name="upload" size={20} />
        </span>
        <span className="dropzone__text">
          <span className="dropzone__title">{variant === 'mobile' ? 'Enviar arquivos' : 'Arraste arquivos ou clique'}</span>
          <span className="dropzone__hint">
            {variant === 'mobile' ? `para ${target} · até ${maxMb} MB` : `PDF, DOCX, PPTX, XLSX, CSV, MD, TXT e imagens · até ${maxMb} MB`}
          </span>
        </span>
      </label>

      {variant === 'desktop' ? (
        <div className="files__row">
          <label className="select-field">
            <span>Enviar para</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {driveEnabled && (
            <Button size="sm" icon="drive" disabled={uploading} onClick={() => importFromDrive(target)}>
              Drive
            </Button>
          )}
        </div>
      ) : (
        <>
          {names.length > 1 && (
            <label className="select-field select-field--touch">
              <span>Enviar para</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          {driveEnabled && (
            <Button size="lg" icon="drive" disabled={uploading} onClick={() => importFromDrive(target)}>
              Importar do Google Drive
            </Button>
          )}
        </>
      )}

      {upload && (
        <div className="upload-queue anim-rise" aria-live="polite">
          <SectionLabel>{upload.status === 'error' ? 'Falha no processamento' : `Processando · ${done} de ${upload.items.length}`}</SectionLabel>
          {upload.error && <p className="upload-queue__error">{upload.error}</p>}
          {upload.items.map((item) => (
            <div key={item.fileName} className="upload-item">
              <div className="upload-item__row">
                <ExtBadge ext={item.fileName.split('.').pop()?.toUpperCase() ?? ''} />
                <span className="upload-item__name">{item.fileName}</span>
                <span className={`upload-item__status mono${item.phase === 'error' ? ' is-error' : ''}`}>
                  {item.phase === 'done' || item.phase === 'queued' || item.phase === 'error' || item.phase === 'skipped'
                    ? PHASE_LABEL[item.phase]
                    : `${PHASE_LABEL[item.phase]} ${Math.round(item.percent)}%`}
                </span>
              </div>
              <ProgressBar percent={item.percent} done={item.phase === 'done'} label={`Progresso de ${item.fileName}`} />
            </div>
          ))}
        </div>
      )}

      <div className="library">
        <div className="library__head">
          <SectionLabel>Biblioteca · {documents.length}</SectionLabel>
        </div>
        {documentsStatus === 'error' && <p className="upload-queue__error">Não foi possível carregar a biblioteca.</p>}
        {groups.map(([collection, docs]) => {
          const open = variant === 'mobile' || !closed[collection];
          const body = (
            <ul className="library__docs">
              {docs.length === 0 && <li className="library__empty">Nenhum arquivo.</li>}
              {docs.map((d) => {
                const active = view.kind === 'document' && view.documentId === d.id;
                return (
                  <li key={d.id} className={`doc-row${active ? ' is-active' : ''}`}>
                    <ExtBadge ext={d.extension} />
                    <button
                      type="button"
                      className="doc-row__pick"
                      onClick={() => {
                        openDocument(d.id);
                        onOpened?.();
                      }}
                    >
                      <span className="doc-row__name">{d.name}</span>
                      <span className="doc-row__meta mono">{[d.summary, relativeTime(d.updatedAt)].filter(Boolean).join(' · ')}</span>
                    </button>
                    <IconButton icon="trash" label={`Excluir arquivo ${d.name}`} size={variant === 'mobile' ? 'touch' : 'sm'} className="doc-row__action" onClick={() => onRequestDelete(d)} />
                  </li>
                );
              })}
            </ul>
          );
          if (variant === 'mobile') {
            return (
              <div key={collection} className="library__group library__group--flat">
                <SectionLabel className="library__flat-label">
                  {collection} · {docs.length}
                </SectionLabel>
                {body}
              </div>
            );
          }
          return (
            <div key={collection} className="library__group">
              <button type="button" className="library__toggle" aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [collection]: open }))}>
                <Icon name="chevronRight" size={14} className={`caret${open ? ' rotate-90' : ''}`} />
                <span className="library__name">{collection}</span>
                <span className="library__count mono">{docs.length} arq.</span>
                <CollectionDot name={collection} />
              </button>
              {open && <div className="anim-expand">{body}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CollectionDot({ name }: { name: string }) {
  const { activeCollections } = useAppState();
  const on = activeCollections.includes(name);
  return <span className={`status-dot status-dot--ring${on ? ' is-on' : ''}`} title={on ? 'Ativa no chat' : 'Inativa no chat'} />;
}
