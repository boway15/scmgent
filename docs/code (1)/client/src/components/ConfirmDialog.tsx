import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  lines?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  lines,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 backdrop:bg-black/40 open:flex open:items-center open:justify-center"
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        if (e.target === dialogRef.current) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-main">{title}</h3>
        {description ? <p className="mt-2 whitespace-pre-line text-sm text-text-sub">{description}</p> : null}
        {lines && lines.length > 0 ? (
          <ul className="mt-2 max-h-48 overflow-y-auto text-sm text-text-sub">
            {lines.map((line) => (
              <li key={line} className="border-b border-border/40 py-1.5 last:border-0">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {loading ? '处理中...' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
