import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ReplenishLightBadge } from '@/components/ReplenishLightBadge';
import { InventoryOverviewCell } from '@/components/InventoryOverviewCell';
import {
  DRAWER_TAB_GROUPS,
  groupCatalogForDrawer,
} from '@/lib/inventory-overview-views';
import { mergeColumnCatalog } from '@/lib/inventory-overview-columns';
import { getOverviewCellValue, isWideOverviewColumn } from '@/lib/inventory-overview-cell-value';

type Props = {
  skuId: string | null;
  onClose: () => void;
};

export function InventoryOverviewRowDrawer({ skuId, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeTab, setActiveTab] = useState(DRAWER_TAB_GROUPS[0]);

  const { data: item, isLoading } = useQuery({
    queryKey: ['inventory-overview-detail', skuId],
    queryFn: () => api.getInventoryOverviewDetail(skuId!),
    enabled: Boolean(skuId),
  });

  const columnCatalog = useMemo(() => mergeColumnCatalog(), []);
  const grouped = useMemo(() => groupCatalogForDrawer(columnCatalog), [columnCatalog]);

  const defaultTab = useMemo(() => {
    if (!item) return DRAWER_TAB_GROUPS[0];
    for (const group of DRAWER_TAB_GROUPS) {
      const cols = grouped.get(group) ?? [];
      if (
        cols.some((col) => {
          const v = getOverviewCellValue(item, col.id);
          return v !== '-' && v !== '';
        })
      ) {
        return group;
      }
    }
    return DRAWER_TAB_GROUPS[0];
  }, [grouped, item]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (skuId) {
      if (!dialog.open) dialog.showModal();
      setActiveTab(defaultTab);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [skuId, defaultTab]);

  const activeCols = grouped.get(activeTab) ?? [];

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-full max-h-full w-full max-w-2xl border-l border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-sm text-text-sub">{item?.code ?? skuId}</p>
            <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-text-main">
              {item?.name ?? '加载中…'}
            </h2>
          </div>
          <div className="flex shrink-0 gap-2">
            {item ? (
              <Link
                to={`/ai/chat?sku=${encodeURIComponent(item.code)}&skuId=${item.skuId}`}
                className="text-sm text-primary hover:underline"
              >
                问 AI
              </Link>
            ) : null}
            <Button variant="outline" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {DRAWER_TAB_GROUPS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                activeTab === tab ? 'bg-primary text-white' : 'bg-muted/40 text-text-sub hover:bg-muted'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && <p className="text-text-sub">加载中…</p>}
          {!isLoading && item && (
            <dl className="grid gap-2 sm:grid-cols-2">
              {activeCols.map((col) => {
                const value = getOverviewCellValue(item, col.id);
                if (col.id === 'replenishLight') {
                  return (
                    <div key={col.id} className="rounded-md border border-border/60 p-2">
                      <dt className="text-xs text-text-sub">{col.label}</dt>
                      <dd className="mt-1">
                        <ReplenishLightBadge light={item.replenishLight ?? 'red'} />
                      </dd>
                    </div>
                  );
                }
                if (col.id === 'ai') return null;
                return (
                  <div
                    key={col.id}
                    className={`rounded-md border border-border/60 p-2 ${isWideOverviewColumn(col.id) ? 'sm:col-span-2' : ''}`}
                  >
                    <dt className="text-xs text-text-sub">
                      {col.excelCol ? `${col.excelCol} · ` : ''}
                      {col.label}
                    </dt>
                    <dd className="mt-1 text-text-main">
                      <InventoryOverviewCell value={value} wrap />
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </dialog>
  );
}
