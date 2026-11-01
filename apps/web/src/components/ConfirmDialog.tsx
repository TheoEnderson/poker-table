import { useEffect, useRef, useId } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
  pending,
  confirmLabel = 'Confirmar',
}: {
  open: boolean;
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  confirmLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (open) {
      if (el && !el.open) {
        el.showModal();
      }
    } else {
      if (el && el.open) {
        el.close();
      }
    }
    return () => {
      if (el && el.open) {
        el.close();
      }
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      <div className="button-row">
        <button className="secondary" onClick={onCancel} disabled={pending} autoFocus>
          Cancelar
        </button>
        <button className="danger" onClick={onConfirm} disabled={pending}>
          {pending ? 'Confirmando…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
