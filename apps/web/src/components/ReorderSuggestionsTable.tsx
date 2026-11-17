import { useState, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { InventoryHealthBadge, type InventoryHealth } from '@/components/InventoryHealthBadge';
import { StickyDataTable, type StickyColumnDef } from '@/components/StickyDataTable';
import {
  deriveProjectedStockoutDate,
  formatSuggestionExplain,
  isSuggestedOrderOverdue,
} from '@/lib/reorder-suggestion-explain';

export type ReorderSuggestionTableRow = {
  id: string;
  fulfillmentRegion?: string | null;
  platform?: string | null;
  warehouseCode?: string | null;
  skuId?: string | null;
  skuCode: string;
  merchantCode?: string | null;
  merchantName?: string | null;
  healthStatus?: string | null;
  suggestedDate: string;
  coverageDays?: number | null;
  suggestedQty: number;
  reason?: string | null;
  metrics?: Record<string, unknown> | null;
  status: string;
  planId?: string | null;
};

/** SKU 紧挨履约区域，保证冻结列为连续前缀（sticky left 才正确） */
const COLUMNS: StickyColumnDef[] = [
  { id: 'fulfillmentRegion', label: '履约区域' },
  { id: 'skuCode', label: 'SKU' },
  { id: 'platform', label: '渠道' },
  { id: 'warehouseCode', label: '网络' },
  { id: 'merchant', label: '商家', flexGrow: true },
  { id: 'healthStatus', label: '健康灯' },
  { id: 'suggestedDate', label: '建议下单日' },
  { id: 'stockoutDate', label: '预计断货日' },
  { id: 'coverageDays', label: '覆盖天数', align: 'right' },
  { id: 'suggestedQty', label: '建议数量', align: 'right' },
  { id: 'demandSource', label: '需求口径' },
  { id: 'explain', label: '口径', flexGrow: true },
  { id: 'status', label: '状态' },
];

const FROZEN = ['fulfillmentRegion', 'skuCode'];

type Props = {
  items: ReorderSuggestionTableRow[];
  getWidth: (columnId: string) => number;
  onResizeStart: (
    columnId: string,
    event: Pick<PointerEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>,
  ) => void;
  emptyLabel?: string;
  layoutKey?: string | number;
};

export function ReorderSuggestionsTable({
  items,
  getWidth,
  onResizeStart,
  emptyLabel = '暂无建议，点击上方「运行补货预测」生成',
  layoutKey,
}: Props) {
  const [expandedReason, setExpandedReason] = useState<Record<string, boolean>>({});

  return (
    <StickyDataTable
      columns={COLUMNS}
      items={items}
      rowKey={(row) => row.id}
      frozenColumnIds={FROZEN}
      getWidth={getWidth}
      onResizeStart={onResizeStart}
      emptyLabel={emptyLabel}
      layoutKey={layoutKey}
      renderCell={(item, columnId) => {
        const stockoutDate = deriveProjectedStockoutDate(item.coverageDays);
        const orderOverdue =
          item.status === 'pending' && isSuggestedOrderOverdue(item.suggestedDate);

        switch (columnId) {
          case 'fulfillmentRegion':
            return (
              <span className="font-mono text-text-main">{item.fulfillmentRegion ?? '—'}</span>
            );
          case 'platform':
            return <span className="font-mono text-text-main">{item.platform ?? '—'}</span>;
          case 'warehouseCode':
            return (
              <span className="font-mono text-primary">
                {item.warehouseCode ?? '网络'}
                {Array.isArray(item.metrics?.triggerWarehouses) &&
                (item.metrics.triggerWarehouses as string[]).length > 0 ? (
                  <span className="ml-1 block font-sans text-sm text-text-sub">
                    触发：{(item.metrics.triggerWarehouses as string[]).join('、')}
                  </span>
                ) : null}
              </span>
            );
          case 'skuCode':
            return item.skuId ? (
              <Link
                to={`/inventory/planning/${item.skuId}`}
                className="font-mono text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {item.skuCode}
              </Link>
            ) : (
              <span className="font-mono text-text-main">{item.skuCode}</span>
            );
          case 'merchant':
            return item.merchantCode ? (
              <span className="font-mono">{item.merchantName ?? item.merchantCode}</span>
            ) : (
              <span className="text-text-hint">—</span>
            );
          case 'healthStatus':
            return item.healthStatus ? (
              <InventoryHealthBadge health={item.healthStatus as InventoryHealth} />
            ) : (
              <span className="text-text-hint">—</span>
            );
          case 'suggestedDate':
            return (
              <span
                className={`font-numeric tabular-nums ${
                  orderOverdue ? 'font-medium text-destructive' : 'text-text-main'
                }`}
              >
                {item.suggestedDate}
                {orderOverdue ? ' · 逾期' : ''}
              </span>
            );
          case 'stockoutDate':
            return (
              <span className="font-numeric tabular-nums text-text-main">
                {stockoutDate ?? '—'}
              </span>
            );
          case 'coverageDays':
            return (
              <span className="font-numeric tabular-nums text-text-main">
                {item.coverageDays ?? '—'}
              </span>
            );
          case 'suggestedQty':
            return (
              <span className="font-numeric tabular-nums font-medium text-primary">
                {item.suggestedQty}
              </span>
            );
          case 'demandSource':
            return (
              <span className="text-sm text-text-sub">
                {(item.metrics?.demandSource as string) === 'forecast' ? '销售预测' : '历史销量'}
              </span>
            );
          case 'explain':
            return (
              <div className="text-text-sub">
                <button
                  type="button"
                  className="text-left text-sm text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedReason((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                  }}
                >
                  {expandedReason[item.id] ? '收起' : '查看口径'}
                </button>
                {expandedReason[item.id] ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-main">
                    {formatSuggestionExplain(item.metrics, {
                      reason: item.reason ?? '',
                      healthStatus: item.healthStatus,
                      coverageDays:
                        item.coverageDays != null ? String(item.coverageDays) : null,
                      suggestedQty: item.suggestedQty,
                      suggestedDate: item.suggestedDate,
                    })}
                  </p>
                ) : null}
              </div>
            );
          case 'status':
            return (
              <span className="text-text-main">
                {item.status}
                {item.planId ? (
                  <>
                    {' · '}
                    <Link
                      to={`/pmc/${item.planId}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      已入计划
                    </Link>
                  </>
                ) : null}
              </span>
            );
          default:
            return null;
        }
      }}
    />
  );
}
