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
  /** 拖拽/落盘上限，默认 640（库存周转）；业务列表建议 360 */
  maxWidth?: number;
  /** 重置时额外清理的旧版 localStorage key */
  legacyStorageKeys?: string[];
  /** 已知列 id；重置时写回默认宽，避免空对象导致布局不刷新 */
  columnIds?: string[];
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
  const {
    loadWidths,
    saveWidths,
    defaultColumnWidth,
    maxWidth = 640,
    legacyStorageKeys = [],
    columnIds,
  } = options;
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths());
  const [layoutKey, setLayoutKey] = useState(0);
  const widthsRef = useRef(widths);
  const resizingRef = useRef<ResizeSession | null>(null);
  const maxWidthRef = useRef(maxWidth);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  useEffect(() => {
    maxWidthRef.current = maxWidth;
  }, [maxWidth]);

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

  const resetWidths = useCallback(
    (overrideColumnIds?: string[]) => {
      // 中断进行中的拖拽，避免 pointerup 用旧宽度覆盖重置结果
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const ids = overrideColumnIds?.length ? overrideColumnIds : columnIds;
      const next: Record<string, number> = {};
      if (ids?.length) {
        for (const id of ids) {
          next[id] = defaultColumnWidth(id);
        }
      }
      setWidths(next);
      widthsRef.current = next;
      saveWidths(next);
      for (const key of legacyStorageKeys) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
      setLayoutKey((k) => k + 1);
    },
    [columnIds, defaultColumnWidth, legacyStorageKeys, saveWidths],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const session = resizingRef.current;
      if (!session) return;
      const delta = event.clientX - session.startX;
      const next = clampColumnWidth(session.startWidth + delta, maxWidthRef.current);
      setWidths((prev) => ({ ...prev, [session.columnId]: next }));
    };

    const onEnd = () => {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveWidths(widthsRef.current);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [saveWidths]);

  return { getWidth, onResizeStart, resetWidths, layoutKey };
}
