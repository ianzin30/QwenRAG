import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApi } from '../../app/providers/ApiProvider';
import { useActions, useAppState } from '../../app/store/StoreProvider';
import { Button } from '../../components/ui/Button';
import { ExtBadge, Skeleton } from '../../components/ui/Primitives';
import { describeError, isAbortError, type DocumentMeta } from '../../services/api';
import { relativeTime } from '../../lib/format';

// GFM tables matter: spreadsheets are ingested as Markdown tables (service/SpreadsheetMarkdown.py).
const REMARK_PLUGINS = [remarkGfm];

type Content = { status: 'loading' } | { status: 'ready'; markdown: string } | { status: 'error'; error: string };

/**
 * Markdown preview of an ingested document. The content is untrusted: react-markdown builds
 * React elements, raw HTML is skipped and unsafe URLs are stripped by its default urlTransform.
 */
export function DocumentView({ variant, onRequestDelete }: { variant: 'desktop' | 'mobile'; onRequestDelete: (doc: DocumentMeta) => void }) {
  const api = useApi();
  const { view, documents } = useAppState();
  const { askAboutDocument } = useActions();
  const documentId = view.kind === 'document' ? view.documentId : null;
  const highlight = view.kind === 'document' ? view.highlight : undefined;
  const doc = documents.find((d) => d.id === documentId);
  const [content, setContent] = useState<Content>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!documentId) return;
    const ctrl = new AbortController();
    setContent({ status: 'loading' });
    api
      .getDocumentContent(documentId, ctrl.signal)
      .then((markdown) => setContent({ status: 'ready', markdown }))
      .catch((error: unknown) => {
        if (!isAbortError(error)) setContent({ status: 'error', error: describeError(error) });
      });
    return () => ctrl.abort();
  }, [api, documentId, attempt]);

  if (!doc) {
    return (
      <div className="doc-view">
        <p className="doc-view__missing">Este documento não está mais na biblioteca.</p>
      </div>
    );
  }

  return (
    <div className={`doc-view doc-view--${variant} anim-fade`}>
      <article className="doc-view__inner">
        <div className="doc-view__bar">
          <ExtBadge ext={doc.extension} />
          <span className="doc-view__meta mono">
            {doc.collection} · Markdown extraído{doc.summary ? ` · ${doc.summary}` : ''}
            {doc.updatedAt ? ` · ${relativeTime(doc.updatedAt)}` : ''}
          </span>
          <span className="spacer" />
          <Button size="sm" onClick={() => askAboutDocument(doc)}>
            Perguntar sobre este arquivo
          </Button>
          <Button size="sm" variant="danger-ghost" onClick={() => onRequestDelete(doc)}>
            Excluir
          </Button>
        </div>

        {highlight && (
          <figure className="doc-view__highlight anim-expand">
            <figcaption className="section-label">Trecho citado · {highlight.sourceLabel}</figcaption>
            <p>
              {highlight.before && '… '}
              {highlight.before}
              <mark>{highlight.quote}</mark>
              {highlight.after}
              {highlight.after && ' …'}
            </p>
          </figure>
        )}

        {content.status === 'loading' && (
          <div className="skeleton-stack" aria-busy="true" aria-label="Carregando documento">
            <Skeleton width="60%" height={28} />
            <Skeleton width="100%" />
            <Skeleton width="94%" />
            <Skeleton width="88%" />
          </div>
        )}
        {content.status === 'error' && (
          <div className="turn-notice turn-notice--error" role="alert">
            <div className="turn-notice__body">
              <div className="turn-notice__title">Não foi possível abrir o documento.</div>
              <div className="turn-notice__text">{content.error}</div>
              <div className="turn-notice__actions">
                <Button variant="primary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                  Tentar de novo
                </Button>
              </div>
            </div>
          </div>
        )}
        {content.status === 'ready' && (
          <div className="markdown">
            <Markdown skipHtml remarkPlugins={REMARK_PLUGINS}>
              {content.markdown}
            </Markdown>
          </div>
        )}
      </article>
    </div>
  );
}
