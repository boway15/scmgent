import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Link } from 'react-router-dom';
import type { InventoryOverview } from '@/lib/api';
import { ReplenishLightBadge } from '@/components/ReplenishLightBadge';
import { InventoryOverviewCell } from '@/components/InventoryOverviewCell';
import type { OverviewColumnDef } from '@/lib/inventory-overview-columns';
import { LEADING_FROZEN_COLUMN_IDS } from '@/lib/inventory-overview-column-order';
import {
  getOverviewCellValue,
  isNumericOverviewColumn,
} from '@/lib/inventory-overview-cell-value';
import type { OverviewTableDensity } from '@/lib/inventory-overview-density';
import { rowHeightForDensity } from '@/lib/inventory-overview-density';
import { isTurnoverDateColumn } from '@/lib/turnover-date-format';
import { cn } from '@/lib/utils';

export const FROZEN_COLUMN_IDS = LEADING_FROZEN_COLUMN_IDS;

type Props = {
  items: InventoryOverview[];
  visibleColumns: OverviewColumnDef[];
  getColumnWidth: (columnId: string) => number;
  onResizeStart: (columnId: string, event: Pick<PointerEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>) => void;
  onRowClick?: (item: InventoryOverview) => void;
  density?: OverviewTableDensity;
  columnJumpTarget?: string | null;
};

function headerTitle(col: OverviewColumnDef): string {
  const parts: string[] = [];
  if (col.excelCol) parts.push(`Excel ${col.excelCol}`);
  parts.push(col.label);
  return parts.join(' · ');
}

function frozenLeftOffsets(
  visibleColumns: OverviewColumnDef[],
  getColumnWidth: (id: string) => number,
): Map<string, number> {
  const offsets = new Map<string, number>();
  let left = 0;
  for (const col of visibleColumns) {
    if (!FROZEN_COLUMN_IDS.includes(col.id as (typeof FROZEN_COLUMN_IDS)[number])) continue;
    offsets.set(col.id, left);
    left += getColumnWidth(col.id);
  }
  return offsets;
}

function frozenStyle(
  left: number,
  width: number,
  isHeader: boolean,
  frozenIndex: number,
): CSSProperties {
  return {
    position: 'sticky',
    left,
    width,
    minWidth: width,
    maxWidth: width,
    zIndex: isHeader ? 52 - frozenIndex : 32 - frozenIndex,
  };
}

const headerCellClass =
  'relative border-b border-border bg-muted p-0 font-normal shadow-[0_1px_0_0_hsl(var(--border))]';

export function InventoryOverviewTable({
  items,
  visibleColumns,
  getColumnWidth,
  onResizeStart,
  onRowClick,
  density = 'comfortable',
  columnJumpTarget,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = rowHeightForDensity(density);

  const frozenOffsets = useMemo(
    () => frozenLeftOffsets(visibleColumns, getColumnWidth),
    [visibleColumns, getColumnWidth],
  );

  const frozenIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const col of visibleColumns) {
      if (frozenOffsets.has(col.id)) {
        map.set(col.id, idx++);
      }
    }
    return map;
  }, [visibleColumns, frozenOffsets]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  const headerRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!columnJumpTarget || !headerRef.current) return;
    const th = headerRef.current.querySelector(`[data-col-id="${CSS.escape(columnJumpTarget)}"]`);
    th?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [columnJumpTarget]);

  const handleResizePointerDown = (columnId: string, event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onResizeStart(columnId, event);
  };

  const renderResizeHandle = (col: OverviewColumnDef) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整 ${col.label} 列宽`}
      className="absolute -right-1 top-0 z-30 h-full w-3 cursor-col-resize touch-none select-none hover:bg-primary/15"
      onPointerDown={(event) => handleResizePointerDown(col.id, event)}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="absolute right-1 top-0 h-full w-px bg-border/80" />
    </div>
  );

  const renderHeaderCell = (col: OverviewColumnDef) => {
    const width = getColumnWidth(col.id);
    const frozenLeft = frozenOffsets.get(col.id);
    const isFrozen = frozenLeft != null;
    const frozenIdx = frozenIndexById.get(col.id) ?? 0;
    const isLastFrozen = isFrozen && frozenIdx === frozenOffsets.size - 1;

    return (
      <th
        key={col.id}
        data-col-id={col.id}
        className={cn(
          headerCellClass,
          'sticky top-0',
          isFrozen ? '' : 'z-20',
          isLastFrozen && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]',
        )}
        style={
          isFrozen
            ? { ...frozenStyle(frozenLeft, width, true, frozenIdx), top: 0 }
            : { width, minWidth: width, maxWidth: width, top: 0 }
        }
        title={headerTitle(col)}
      >
        <div className="truncate px-2 py-2 pr-4">
          {col.excelCol ? (
            <span className="mr-1 font-mono text-[10px] text-text-hint">{col.excelCol}</span>
          ) : null}
          {col.label}
        </div>
        {renderResizeHandle(col)}
      </th>
    );
  };

  const renderBodyCell = (item: InventoryOverview, col: OverviewColumnDef) => {
    const width = getColumnWidth(col.id);
    const frozenLeft = frozenOffsets.get(col.id);
    const isFrozen = frozenLeft != null;
    const frozenIdx = frozenIndexById.get(col.id) ?? 0;
    const isLastFrozen = isFrozen && frozenIdx === frozenOffsets.size - 1;
    const baseClass = cn(
      'overflow-hidden p-2 align-middle bg-card',
      isLastFrozen && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]',
    );
    const style: CSSProperties = isFrozen
      ? frozenStyle(frozenLeft, width, false, frozenIdx)
      : { width, minWidth: width, maxWidth: width };

    if (col.id === 'replenishLight') {
      return (
        <td key={col.id} className={baseClass} style={style}>
          <ReplenishLightBadge light={item.replenishLight ?? 'red'} />
        </td>
      );
    }

    if (col.id === 'ai') {
      return (
        <td key={col.id} className={baseClass} style={style} onClick={(e) => e.stopPropagation()}>
          <Link
            to={`/ai/chat?sku=${encodeURIComponent(item.code)}&skuId=${item.skuId}`}
            className="text-xs text-primary hover:underline"
          >
            问 AI
          </Link>
        </td>
      );
    }

    const value = getOverviewCellValue(item, col.id);
    const numeric = isNumericOverviewColumn(col.id);
    const mono = col.id === 'SKU' || col.id === '供应商编码';
    const rightAlign = numeric && !isTurnoverDateColumn(col.id);

    return (
      <td
        key={col.id}
        className={cn(baseClass, numeric ? 'font-numeric' : '', mono ? 'font-mono' : '', rightAlign ? 'text-right' : '')}
        style={style}
      >
        <InventoryOverviewCell value={value} />
      </td>
    );
  };

  return (
    <div
      ref={parentRef}
      className="max-h-[calc(100vh-280px)] overflow-auto rounded-md border border-border bg-card"
    >
      <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          {visibleColumns.map((col) => {
            const width = getColumnWidth(col.id);
            return <col key={col.id} style={{ width, minWidth: width }} />;
          })}
        </colgroup>
        <thead ref={headerRef} className="text-left text-text-sub">
          <tr>{visibleColumns.map(renderHeaderCell)}</tr>
        </thead>
        <tbody>
          {items.length > 0 && rowVirtualizer.getVirtualItems()[0]?.start > 0 ? (
            <tr>
              <td
                colSpan={visibleColumns.length}
                style={{ height: rowVirtualizer.getVirtualItems()[0]!.start, padding: 0, border: 0 }}
              />
            </tr>
          ) : null}
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
            if (!item) return null;
            return (
              <tr
                key={item.skuId}
                className="cursor-pointer border-b border-border/60 hover:bg-muted/20"
                style={{ height: rowHeight }}
                onClick={() => onRowClick?.(item)}
              >
                {visibleColumns.map((col) => renderBodyCell(item, col))}
              </tr>
            );
          })}
          {items.length > 0 ? (
            <tr>
              <td
                colSpan={visibleColumns.length}
                style={{
                  height:
                    rowVirtualizer.getTotalSize() -
                    (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                  padding: 0,
                  border: 0,
                }}
              />
            </tr>
          ) : (
            <tr>
              <td colSpan={Math.max(visibleColumns.length, 1)} className="p-4 text-center text-text-hint">
                暂无库存数据，请先导入库存周转表
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
