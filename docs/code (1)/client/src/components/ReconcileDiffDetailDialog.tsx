import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ReconcileDiffDetailDialog({
  open,
  onOpenChange,
  warnings,
  diffCny,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warnings: string[];
  diffCny: number;
}) {
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
        className="flex max-h-[min(75vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-text-main">差额详情</h3>
            <p className="mt-0.5 text-sm text-text-sub">
              共 {warnings.length} 项 · 总差额 ¥{diffCny.toFixed(2)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-text-sub">
          {warnings.map((w) => (
            <li key={w} className="border-b border-border/40 py-2 last:border-0">
              {w}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
