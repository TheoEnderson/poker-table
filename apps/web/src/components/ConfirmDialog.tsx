import { useEffect, useRef } from 'react';
export function ConfirmDialog({ open, title, description, onCancel, onConfirm, pending }: { open: boolean; title: string; description: string; onCancel: () => void; onConfirm: () => void; pending: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <dialog ref={dialog} aria-labelledby="confirmation-title" onCancel={e => { e.preventDefault(); if (!pending) onCancel(); }}><h2 id="confirmation-title">{title}</h2><p>{description}</p><div className="button-row"><button className="secondary" onClick={onCancel} disabled={pending} autoFocus>Cancelar</button><button className="danger" onClick={onConfirm} disabled={pending}>{pending ? 'Confirmando…' : 'Confirmar'}</button></div></dialog>;
}
