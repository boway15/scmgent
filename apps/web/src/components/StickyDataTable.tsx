import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeFrozenLeftOffsets,
  stickyTableCellPosition,
  tableTotalWidth,
} from '@/lib/sticky-table-utils';
import { listTableTdBase, listTableThBase, listTableTr, listTableWrap } from '@/lib/list-table-tokens';
import { cn } from '@/lib/utils';

export type StickyColumnDef = {
  id: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** 容器比列宽总和更宽时，优先把多余宽度分给这些列 */
  flexGrow?: boolean;
};

type ResizeEvent = Pick<PointerEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>;

export type StickyDataTableProps<T> = {
  columns: StickyColumnDef[];
  items: T[];
  rowKey: (row: T) => string;
  renderCell: (row: T, columnId: string) => ReactNode;
  getWidth: (columnId: string) => number;
  onResizeStart: (columnId: string, event: ResizeEvent) => void;
  frozenColumnIds?: string[];
  loading?: boolean;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
  wrapClassName?: string;
  layoutKey?: string | number;
};

/**
 * 列宽只由 colgroup 决定；th/td 不设 width，避免 Grid/Flex 下表头表体列错位（预测版本等）。
 */
export function StickyDataTable<T>({
  columns,
  items,
  rowKey,
  renderCell,
  getWidth,
  onResizeStart,
  frozenColumnIds = [],
  loading,
  emptyLabel = '暂无数据',
  onRowClick,
  wrapClassName,
  layoutKey,
}: StickyDataTableProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutKey]);

  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);

  const baseTotal = useMemo(
    () => tableTotalWidth(columnIds, getWidth),
    [columnIds, getWidth],
  );

  const flexColumnIds = useMemo(() => {
    const marked = columns.filter((c) => c.flexGrow).map((c) => c.id);
    if (marked.length) return marked;
    const frozen = new Set(frozenColumnIds);
    const rest = columnIds.filter((id) => !frozen.has(id));
    return rest.length ? rest : columnIds;
  }, [columns, columnIds, frozenColumnIds]);

  const effectiveWidth = useMemo(() => {
    const extra = Math.max(0, Math.floor(viewportWidth - baseTotal));
    const flexCount = flexColumnIds.length;
    const bonus = flexCount > 0 ? Math.floor(extra / flexCount) : 0;
    const remainder = flexCount > 0 ? extra - bonus * flexCount : 0;
    const bonusById = new Map<string, number>();
    flexColumnIds.forEach((id, index) => {
      bonusById.set(id, bonus + (index === 0 ? remainder : 0));
    });
    return (columnId: string) => getWidth(columnId) + (bonusById.get(columnId) ?? 0);
  }, [viewportWidth, baseTotal, flexColumnIds, getWidth]);

  const frozenOffsets = useMemo(
    () => computeFrozenLeftOffsets(columnIds, frozenColumnIds, effectiveWidth),
    [columnIds, frozenColumnIds, effectiveWidth],
  );

  const frozenIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const id of columnIds) {
      if (frozenOffsets.has(id)) map.set(id, idx++);
    }
    return map;
  }, [columnIds, frozenOffsets]);

  const totalWidth = useMemo(
    () => tableTotalWidth(columnIds, effectiveWidth),
    [columnIds, effectiveWidth],
  );

  const tableWidth = Math.max(totalWidth, viewportWidth || totalWidth);

  const handleResizePointerDown = (columnId: string, event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onResizeStart(columnId, event);
  };

  const alignClass = (align?: StickyColumnDef['align']) =>
    cn(align === 'right' && 'text-right', align === 'center' && 'text-center');

  const renderResizeHandle = (col: StickyColumnDef) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整 ${col.label} 列宽`}
      className="absolute -right-1 top-0 z-[70] h-full w-3 cursor-col-resize touch-none select-none hover:bg-primary/15"
      onPointerDown={(event) => handleResizePointerDown(col.id, event)}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="absolute right-1 top-0 h-full w-px bg-border/80" />
    </div>
  );

  const cellPositionStyle = (colId: string, isHeader: boolean): CSSProperties => {
    const frozenLeft = frozenOffsets.get(colId);
    const stackIndex = frozenIndexById.get(colId) ?? 0;
    return stickyTableCellPosition({ frozenLeft, isHeader, stackIndex });
  };

  const colSpan = Math.max(columns.length, 1);

  return (
    <div ref={scrollerRef} className={wrapClassName ?? listTableWrap} key={layoutKey}>
      <table
        className="table-fixed border-separate border-spacing-0 text-sm"
        style={{ width: tableWidth, minWidth: tableWidth }}
      >
        <colgroup>
          {columns.map((col) => {
            const w = effectiveWidth(col.id);
            return <col key={col.id} style={{ width: w, minWidth: w }} />;
          })}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => {
              const frozenLeft = frozenOffsets.get(col.id);
              const stackIndex = frozenIndexById.get(col.id) ?? 0;
              const isLastFrozen =
                frozenLeft != null && stackIndex === frozenOffsets.size - 1;
              return (
                <th
                  key={col.id}
                  className={cn(
                    listTableThBase,
                    'relative p-0 shadow-[0_1px_0_0_hsl(var(--border))]',
                    alignClass(col.align),
                    isLastFrozen && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]',
                  )}
                  style={{
                    ...cellPositionStyle(col.id, true),
                    backgroundColor: 'hsl(var(--muted))',
                  }}
                  title={col.label}
                >
                  <div
                    className={cn(
                      'truncate px-2 py-2 pr-4',
                      alignClass(col.align),
                    )}
                  >
                    {col.label}
                  </div>
                  {renderResizeHandle(col)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className={cn(listTableTdBase, 'px-3 py-6 text-text-sub')} colSpan={colSpan}>
                加载中…
              </td>
            </tr>
          ) : !items.length ? (
            <tr>
              <td
                className={cn(listTableTdBase, 'px-3 py-6 text-center text-text-hint')}
                colSpan={colSpan}
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            items.map((row, rowIdx) => (
              <tr
                key={`${rowKey(row)}-${rowIdx}`}
                className={cn(listTableTr, onRowClick && 'cursor-pointer')}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => {
                  const frozenLeft = frozenOffsets.get(col.id);
                  const stackIndex = frozenIndexById.get(col.id) ?? 0;
                  const isLastFrozen =
                    frozenLeft != null && stackIndex === frozenOffsets.size - 1;
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        listTableTdBase,
                        'overflow-hidden p-2',
                        frozenLeft != null && 'bg-card group-hover:bg-muted/30',
                        alignClass(col.align),
                        isLastFrozen && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]',
                      )}
                      style={{
                        ...cellPositionStyle(col.id, false),
                        ...(frozenLeft != null ? { backgroundColor: 'hsl(var(--card))' } : null),
                      }}
                    >
                      {renderCell(row, col.id)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
