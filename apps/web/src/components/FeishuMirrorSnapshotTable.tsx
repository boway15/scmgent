import type { PointerEvent } from 'react';
import { useMemo } from 'react';
import { InventoryOverviewCell } from '@/components/InventoryOverviewCell';
import { StickyDataTable, type StickyColumnDef } from '@/components/StickyDataTable';
import { feishuMirrorCellClass } from '@/lib/feishu-mirror-column-widths';
import { leadingFreezeColumnIds } from '@/lib/sticky-table-utils';
import { cn } from '@/lib/utils';

export type FeishuMirrorRow = {
  skuCode: string;
  payload: Record<string, string>;
};

type Props = {
  columns: string[];
  items: FeishuMirrorRow[];
  loading?: boolean;
  emptyLabel?: string;
  getWidth: (columnId: string) => number;
  onResizeStart: (
    columnId: string,
    event: Pick<PointerEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>,
  ) => void;
  onRowClick?: (item: FeishuMirrorRow) => void;
  /** 为 false 时仅纵钉表头，不横冻列 */
  freezeLeadingColumn?: boolean;
  layoutKey?: string | number;
};

function isNumericMirrorColumn(columnId: string, value: string): boolean {
  if (/数量|库存|销量|在途|可售|合计|占比|天数/.test(columnId)) return true;
  return /^-?\d+([.,]\d+)?%?$/.test(value.trim());
}

export function FeishuMirrorSnapshotTable({
  columns,
  items,
  loading,
  emptyLabel = '暂无数据',
  getWidth,
  onResizeStart,
  onRowClick,
  freezeLeadingColumn = true,
  layoutKey,
}: Props) {
  const stickyColumns: StickyColumnDef[] = useMemo(
    () =>
      columns.map((id) => ({
        id,
        label: id,
        flexGrow: /名称|品名|品类|分类|备注|说明/.test(id),
      })),
    [columns],
  );

  const frozenColumnIds = useMemo(() => {
    if (!freezeLeadingColumn) return [];
    // 默认列序为「品类, SKU, …」：必须冻连续前缀，不能只冻 SKU（否则品类表头横滚跑掉）
    return leadingFreezeColumnIds(columns);
  }, [columns, freezeLeadingColumn]);

  return (
    <StickyDataTable
      columns={stickyColumns}
      items={items}
      rowKey={(row) => row.skuCode}
      frozenColumnIds={frozenColumnIds}
      getWidth={getWidth}
      onResizeStart={onResizeStart}
      loading={loading}
      emptyLabel={emptyLabel}
      onRowClick={onRowClick}
      layoutKey={layoutKey}
      renderCell={(item, col) => {
        const raw = item.payload[col] ?? (col === 'SKU' ? item.skuCode : '');
        const display = raw?.trim() ? raw : '—';
        const numeric = isNumericMirrorColumn(col, display);
        return (
          <div className={cn(numeric && 'text-right')}>
            <InventoryOverviewCell value={display} className={feishuMirrorCellClass(col, display)} />
          </div>
        );
      }}
    />
  );
}
