import { useCallback, useEffect, useRef, useState } from 'react';
import { clampColumnWidth } from '@/lib/column-width-storage';
import {
  COLUMN_WIDTHS_STORAGE_KEY,
  defaultOverviewColumnWidth,
  loadOverviewColumnWidths,
  saveOverviewColumnWidths,
} from '@/lib/inventory-overview-column-widths';

type ResizePointerEvent = Pick<MouseEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>;

type ResizeSession = {
  columnId: string;
  startX: number;
  startWidth: number;
};

export type ResizableColumnWidthsOptions = {
  storageKey: string;
  loadWidths: () => Record<string, number>;
  saveWidths: (widths: Record<string, number>) => void;
  defaultColumnWidth: (columnId: string) => number;
};

const INVENTORY_OVERVIEW_RESIZE_OPTIONS: ResizableColumnWidthsOptions = {
  storageKey: COLUMN_WIDTHS_STORAGE_KEY,
  loadWidths: loadOverviewColumnWidths,
  saveWidths: saveOverviewColumnWidths,
  defaultColumnWidth: defaultOverviewColumnWidth,
};

export function useResizableColumnWidths(
  options: ResizableColumnWidthsOptions = INVENTORY_OVERVIEW_RESIZE_OPTIONS,
) {
  const { loadWidths, saveWidths, defaultColumnWidth } = options;
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths());
  const widthsRef = useRef(widths);
  const resizingRef = useRef<ResizeSession | null>(null);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const getWidth = useCallback(
    (columnId: string) => widths[columnId] ?? defaultColumnWidth(columnId),
    [widths, defaultColumnWidth],
  );

  const onResizeStart = useCallback(
    (columnId: string, event: ResizePointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      resizingRef.current = {
        columnId,
        startX: event.clientX,
        startWidth: getWidth(columnId),
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [getWidth],
  );

  const resetWidths = useCallback(() => {
    setWidths({});
    saveWidths({});
  }, [saveWidths]);

  useEffect(() => {
    const onMove = (event: MouseEvent | PointerEvent) => {
      const session = resizingRef.current;
      if (!session) return;
      const delta = event.clientX - session.startX;
      const next = clampColumnWidth(session.startWidth + delta);
      setWidths((prev) => ({ ...prev, [session.columnId]: next }));
    };

    const onEnd = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveWidths(widthsRef.current);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [saveWidths]);

  return { getWidth, onResizeStart, resetWidths };
}
