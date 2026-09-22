import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import { api, type CostingBomLine } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PriceBookPickerPanel } from '@/components/costing/PriceBookPickerPanel';
import { placeFixedPopover } from '@/components/costing/place-fixed-popover';

type PriceBookBindPopoverProps = {
  projectId: string;
  line: CostingBomLine;
  projectRegionId?: string | null;
  projectFactoryId?: string | null;
  disabled?: boolean;
  onMutate?: () => void;
  onBound: () => void;
  onError?: (message: string) => void;
};

const PANEL_WIDTH = 384;

export function PriceBookBindPopover({
  projectId,
  line,
  projectRegionId,
  projectFactoryId,
  disabled = false,
  onMutate,
  onBound,
  onError,
}: PriceBookBindPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const updatePosition = () => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const panelHeight = panelRef.current?.offsetHeight ?? 280;
    const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 32);
    const next = placeFixedPopover({
      trigger,
      panelWidth,
      panelHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setCoords((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onReposition = () => updatePosition();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onReposition);
    document.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onReposition);
      document.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  const bindMutation = useMutation({
    mutationFn: (priceBookId: string) =>
      api.bindCostingBomLinePriceBook(projectId, line.id, priceBookId),
    onMutate: () => {
      onMutate?.();
    },
    onSuccess: () => {
      setOpen(false);
      onBound();
    },
    onError: (error: Error) => onError?.(error.message),
  });

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        className="text-left text-xs text-primary hover:underline disabled:cursor-not-allowed disabled:text-text-hint disabled:no-underline"
        disabled={disabled || bindMutation.isPending}
        onClick={() => setOpen((value) => !value)}
      >
        选择价目
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-50 w-[min(24rem,calc(100vw-2rem))]"
              style={{ top: coords.top, left: coords.left }}
            >
              <PriceBookPickerPanel
                category={line.category}
                defaultKeyword={line.materialName}
                projectRegionId={projectRegionId}
                projectFactoryId={projectFactoryId}
                selecting={bindMutation.isPending}
                onSelect={(item) => bindMutation.mutate(item.id)}
              />
              <div className="mt-2 flex justify-end rounded-md border border-border bg-card p-2 shadow-card">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  关闭
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
