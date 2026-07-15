import type { CSSProperties } from 'react';
import type { SkuOverview, ReplenishLight } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatOverviewUpdatedAt } from '@/lib/inventory-overview-columns';
import {
  PRODUCT_MASTER_FROZEN_COLUMN_ID,
  PRODUCT_MASTER_SKU_COLUMNS,
  type ProductMasterSkuColumnDef,
} from '@/lib/product-master-sku-columns';
import { cn } from '@/lib/utils';

type Props = {
  items: SkuOverview[];
  getColumnWidth: (columnId: string) => number;
  onResizeStart: (columnId: string, event: React.MouseEvent) => void;
  onEditSku: (sku: SkuOverview) => void;
  onUpdateReplenishLight: (id: string, replenishLight: ReplenishLight) => void;
  updateLightPending: boolean;
};

function headerTitle(col: ProductMasterSkuColumnDef): string {
  const parts: string[] = [];
  if (col.excelCol) parts.push(`Excel ${col.excelCol}`);
  parts.push(col.label);
  return parts.join(' · ');
}

function cellText(sku: SkuOverview, columnId: string): string {
  const value = sku[columnId as keyof SkuOverview];
  if (value == null || value === '') return '-';
  return String(value);
}

function frozenCellStyle(width: number, isHeader: boolean): CSSProperties {
  return {
    position: 'sticky',
    left: 0,
    width,
    minWidth: width,
    maxWidth: width,
    zIndex: isHeader ? 30 : 20,
  };
}

export function ProductMasterSkuTable({
  items,
  getColumnWidth,
  onResizeStart,
  onEditSku,
  onUpdateReplenishLight,
  updateLightPending,
}: Props) {
  const columns = PRODUCT_MASTER_SKU_COLUMNS;

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          {columns.map((col) => {
            const width = getColumnWidth(col.id);
            return <col key={col.id} style={{ width, minWidth: width }} />;
          })}
        </colgroup>
        <thead className="text-left text-text-sub">
          <tr className="border-b border-border">
            {columns.map((col) => {
              const width = getColumnWidth(col.id);
              const isFrozen = col.id === PRODUCT_MASTER_FROZEN_COLUMN_ID;

              return (
                <th
                  key={col.id}
                  className={cn(
                    'relative overflow-hidden border-b border-border p-0 font-normal shadow-[0_1px_0_0_hsl(var(--border))]',
                    isFrozen ? 'bg-muted shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]' : 'bg-muted/30',
                  )}
                  style={isFrozen ? frozenCellStyle(width, true) : { width, maxWidth: width }}
                  title={headerTitle(col)}
                >
                  <div className="truncate px-2 py-2 pr-3">
                    {col.excelCol ? (
                      <span className="mr-1 font-mono text-[10px] text-text-hint">{col.excelCol}</span>
                    ) : null}
                    {col.label}
                  </div>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`调整 ${col.label} 列宽`}
                    className="absolute right-0 top-0 z-40 h-full w-1.5 cursor-col-resize touch-none border-r border-transparent hover:border-primary/50 hover:bg-primary/20"
                    onMouseDown={(event) => onResizeStart(col.id, event)}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((sku) => (
            <tr key={sku.id} className="border-b border-border/60">
              {columns.map((col) => {
                const width = getColumnWidth(col.id);
                const isFrozen = col.id === PRODUCT_MASTER_FROZEN_COLUMN_ID;
                const frozenBase = cn(
                  'overflow-hidden bg-card',
                  isFrozen && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]',
                );
                const cellStyle: CSSProperties = isFrozen
                  ? frozenCellStyle(width, false)
                  : { width, maxWidth: width };

                if (col.kind === 'replenishLight') {
                  return (
                    <td key={col.id} className={cn(frozenBase, 'p-2')} style={cellStyle}>
                      <select
                        className="h-8 w-full min-w-0 rounded-md border border-input bg-card px-2 text-xs text-text-main"
                        value={sku.replenishLight ?? 'red'}
                        disabled={updateLightPending}
                        onChange={(e) =>
                          onUpdateReplenishLight(sku.id, e.target.value as ReplenishLight)
                        }
                      >
                        <option value="red">红灯</option>
                        <option value="yellow">黄灯</option>
                        <option value="green">绿灯</option>
                      </select>
                    </td>
                  );
                }

                if (col.kind === 'actions') {
                  return (
                    <td key={col.id} className={cn(frozenBase, 'p-2')} style={cellStyle}>
                      <Button size="sm" variant="outline" onClick={() => onEditSku(sku)}>
                        编辑
                      </Button>
                    </td>
                  );
                }

                if (col.kind === 'updatedAt') {
                  const value = formatOverviewUpdatedAt(sku.updatedAt);
                  return (
                    <td
                      key={col.id}
                      className={cn(frozenBase, 'truncate p-2 text-text-sub')}
                      style={cellStyle}
                      title={sku.updatedAt ?? undefined}
                    >
                      {value}
                    </td>
                  );
                }

                const value = cellText(sku, col.id);
                const className = cn(
                  frozenBase,
                  'truncate p-2',
                  col.kind === 'numeric' ? 'font-numeric' : '',
                  col.kind === 'mono' ? 'font-mono' : '',
                  col.id === 'category' ? 'text-text-sub' : '',
                );

                return (
                  <td
                    key={col.id}
                    className={className}
                    style={cellStyle}
                    title={value !== '-' ? value : undefined}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={columns.length} className="p-4 text-center text-text-hint">
                暂无 SKU，请新建或点击「导入 SKU」
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
