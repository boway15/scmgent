import { useEffect, useRef } from 'react';
import type { ImportType } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { IMPORT_TEMPLATES } from './import-templates';
import { ImportPanel } from './ImportPanel';

type Props = {
  open: boolean;
  type: ImportType;
  title?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

export function ImportDrawer({ open, type, title, onClose, onSuccess }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const displayTitle = title ?? IMPORT_TEMPLATES[type].title;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-full max-h-full w-full max-w-2xl border-l border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-lg font-semibold text-text-main">{displayTitle}</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {open ? <ImportPanel type={type} onSuccess={onSuccess} /> : null}
        </div>
      </div>
    </dialog>
  );
}
