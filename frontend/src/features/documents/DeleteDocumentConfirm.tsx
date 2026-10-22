import { useState } from 'react';
import { useActions } from '../../app/store/StoreProvider';
import { Button } from '../../components/ui/Button';
import { Dialog, Sheet } from '../../components/ui/Overlay';
import type { DocumentMeta } from '../../services/api';

/** Confirmation before deleting a document — dialog on desktop, bottom sheet on mobile. */
export function DeleteDocumentConfirm({ doc, variant, onClose }: { doc: DocumentMeta | null; variant: 'desktop' | 'mobile'; onClose: () => void }) {
  const { deleteDocument } = useActions();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!doc) return;
    setBusy(true);
    await deleteDocument(doc);
    setBusy(false);
    onClose();
  };
  const name = <code className="inline-code">{doc?.name}</code>;

  if (variant === 'mobile') {
    return (
      <Sheet open={!!doc} onClose={onClose} title="Excluir arquivo?" className="sheet--padded">
        <p className="dialog__text">{name} sai da coleção local e só volta se for enviado de novo.</p>
        <div className="dialog__stack">
          <Button variant="danger" size="lg" onClick={confirm} disabled={busy}>
            Excluir
          </Button>
          <Button size="lg" onClick={onClose} data-autofocus="">
            Cancelar
          </Button>
        </div>
      </Sheet>
    );
  }
  return (
    <Dialog open={!!doc} onClose={onClose} title="Excluir arquivo?">
      <p className="dialog__text">Tem certeza que deseja excluir {name}?</p>
      <p className="dialog__hint">O arquivo sai da coleção local e só volta se for enviado ou importado de novo.</p>
      <div className="dialog__grid">
        <Button size="lg" onClick={onClose} data-autofocus="">
          Cancelar
        </Button>
        <Button variant="danger" size="lg" onClick={confirm} disabled={busy}>
          Excluir
        </Button>
      </div>
    </Dialog>
  );
}
