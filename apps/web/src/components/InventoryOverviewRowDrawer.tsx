import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type InventoryOverview } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ReplenishLightBadge } from '@/components/ReplenishLightBadge';
import { InventoryOverviewCell } from '@/components/InventoryOverviewCell';
import {
  DRAWER_TAB_GROUPS,
  groupCatalogForDrawer,
} from '@/lib/inventory-overview-views';
import { mergeColumnCatalog, type OverviewColumnDef } from '@/lib/inventory-overview-columns';
import {
  DRAWER_KPI_COLUMN_IDS,
  getDrawerFieldLayout,
  getDrawerSubsectionTitle,
  orderDrawerSections,
} from '@/lib/inventory-overview-groups';
import {
  getOverviewCellValue,
  isNumericOverviewColumn,
} from '@/lib/inventory-overview-cell-value';

type Props = {
  skuId: string | null;
  snapshotDate?: string;
  onClose: () => void;
};

function FieldCard({
  label,
  layout,
  children,
}: {
  label: string;
  layout: ReturnType<typeof getDrawerFieldLayout>;
  children: ReactNode;
}) {
  const span =
    layout === 'wide'
      ? 'col-span-2'
      : layout === 'kpi'
        ? 'col-span-1'
        : layout === 'region'
          ? 'col-span-1'
          : layout === 'id'
            ? 'col-span-1'
            : 'col-span-1';

  const shell =
    layout === 'kpi'
      ? 'rounded-md border border-primary/20 bg-orange-50/40 px-3 py-2.5'
      : layout === 'region'
        ? 'rounded-md bg-muted/30 px-2.5 py-2'
        : layout === 'id'
          ? 'rounded-md bg-muted/20 px-2.5 py-2'
          : 'rounded-md border border-border/50 bg-card px-3 py-2.5';

  return (
    <div className={`${span} ${shell}`}>
      <dt
        className={`text-text-sub ${layout === 'region' || layout === 'id' ? 'text-[11px]' : 'text-xs'}`}
      >
        {label}
      </dt>
      <dd
        className={`mt-1 text-text-main ${
          layout === 'kpi'
            ? 'font-mono text-lg font-semibold tabular-nums leading-tight'
            : layout === 'region'
              ? 'font-mono text-sm tabular-nums'
              : layout === 'id'
                ? 'font-mono text-xs text-text-sub break-all'
                : ''
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

function renderFieldValue(item: InventoryOverview, col: OverviewColumnDef) {
  if (col.id === 'replenishLight') {
    return <ReplenishLightBadge light={item.replenishLight ?? 'red'} />;
  }
  const value = getOverviewCellValue(item, col.id);
  const numeric = isNumericOverviewColumn(col.id) && value !== '-';
  return (
    <InventoryOverviewCell
      value={value}
      wrap
      className={numeric ? 'font-mono tabular-nums' : undefined}
    />
  );
}

export function InventoryOverviewRowDrawer({ skuId, snapshotDate, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [showTrend, setShowTrend] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof DRAWER_TAB_GROUPS)[number]>(
    DRAWER_TAB_GROUPS[0],
  );

  const { data: item, isLoading } = useQuery({
    queryKey: ['inventory-overview-detail', skuId, snapshotDate],
    queryFn: () => api.getInventoryOverviewDetail(skuId!, snapshotDate),
    enabled: Boolean(skuId),
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['inventory-overview-trend', skuId],
    queryFn: () => api.getInventoryOverviewTrend(skuId!),
    enabled: Boolean(skuId) && showTrend,
  });

  const columnCatalog = useMemo(() => mergeColumnCatalog(), []);
  const grouped = useMemo(() => groupCatalogForDrawer(columnCatalog), [columnCatalog]);

  const visibleTabs = useMemo(
    () => DRAWER_TAB_GROUPS.filter((group) => (grouped.get(group) ?? []).length > 0),
    [grouped],
  );

  const defaultTab = useMemo(() => {
    if (!item) return '库存数据';
    const preferred = (['库存数据', '销售与预测', '主数据'] as const).filter((g) =>
      visibleTabs.includes(g),
    );
    for (const group of preferred) {
      const cols = grouped.get(group) ?? [];
      if (
        cols.some((col) => {
          if (col.id === 'ai') return false;
          const v = getOverviewCellValue(item, col.id);
          return v !== '-' && v !== '';
        })
      ) {
        return group;
      }
    }
    return visibleTabs[0] ?? DRAWER_TAB_GROUPS[0];
  }, [grouped, item, visibleTabs]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (skuId) {
      if (!dialog.open) dialog.showModal();
      setActiveTab(defaultTab);
      setShowTrend(false);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [skuId, defaultTab]);

  const activeCols = useMemo(
    () => (grouped.get(activeTab) ?? []).filter((col) => col.id !== 'ai'),
    [activeTab, grouped],
  );

  const sections = useMemo(() => {
    const buckets = new Map<string, OverviewColumnDef[]>();
    const order: string[] = [];
    for (const col of activeCols) {
      const title = getDrawerSubsectionTitle(col.id, activeTab) ?? '';
      if (!buckets.has(title)) {
        buckets.set(title, []);
        order.push(title);
      }
      buckets.get(title)!.push(col);
    }
    const unsorted = order.map((title) => ({ title, cols: buckets.get(title)! }));
    return orderDrawerSections(activeTab, unsorted) as Array<{
      title: string;
      cols: OverviewColumnDef[];
    }>;
  }, [activeCols, activeTab]);

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-full max-h-full w-full max-w-3xl border-l border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm text-text-sub">{item?.code ?? skuId}</p>
                {item ? <ReplenishLightBadge light={item.replenishLight ?? 'red'} /> : null}
              </div>
              <h2 className="mt-1 whitespace-normal break-words text-lg font-semibold leading-snug text-text-main">
                {item?.name ?? '加载中…'}
              </h2>
              {item ? (
                <p className="mt-1 text-xs text-text-hint">
                  {[item.category, item.salesCountry, item.productCategory]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {item ? (
                <Link
                  to={`/ai/chat?sku=${encodeURIComponent(item.code)}&skuId=${item.skuId}`}
                  className="inline-flex h-8 items-center rounded-md px-2 text-sm text-primary hover:underline"
                >
                  问 AI
                </Link>
              ) : null}
              <Button variant="outline" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
          </div>

          {item ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {DRAWER_KPI_COLUMN_IDS.map((id) => {
                const value = getOverviewCellValue(item, id);
                return (
                  <div
                    key={id}
                    className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                  >
                    <p className="text-[11px] leading-tight text-text-sub">{id}</p>
                    <p className="mt-1 font-mono text-base font-semibold tabular-nums text-text-main">
                      {value}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 overflow-x-auto border-b border-border px-4 py-2">
          <div className="flex min-w-max items-center gap-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-primary text-white'
                    : 'bg-muted/40 text-text-sub hover:bg-muted'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
            <Button
              variant={showTrend ? 'default' : 'outline'}
              size="sm"
              className="ml-2 h-7 text-xs"
              onClick={() => setShowTrend((value) => !value)}
            >
              库存变化
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {showTrend ? (
            <section className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-text-main">每日库存变化</h3>
                <span className="text-xs text-text-hint">
                  {trend?.items.length ?? 0} 个归档日期
                </span>
              </div>
              {trendLoading ? <p className="text-sm text-text-sub">加载趋势中…</p> : null}
              {!trendLoading && trend?.items.length ? (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-muted/40 text-text-sub">
                      <tr>
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                          日期
                        </th>
                        {trend.fields.map((field) => (
                          <th
                            key={field}
                            className="whitespace-nowrap px-3 py-2 text-right font-medium"
                          >
                            {field}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trend.items
                        .slice()
                        .reverse()
                        .map((row) => (
                          <tr key={row.snapshotDate} className="border-t border-border/60">
                            <td className="whitespace-nowrap px-3 py-2 text-text-sub">
                              {row.snapshotDate}
                            </td>
                            {trend.fields.map((field) => (
                              <td
                                key={field}
                                className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-text-main"
                              >
                                {row.values[field] ?? '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {!trendLoading && trend && trend.items.length === 0 ? (
                <p className="rounded-md bg-muted/20 px-3 py-3 text-sm text-text-sub">
                  归档数据积累后将在这里显示库存变化。
                </p>
              ) : null}
            </section>
          ) : null}
          {isLoading && <p className="text-text-sub">加载中…</p>}
          {!isLoading && item && (
            <div className="space-y-5">
              {sections.map(({ title, cols }) => {
                const hasRegion = cols.some((c) => getDrawerFieldLayout(c.id) === 'region');
                return (
                  <section key={title || activeTab}>
                    {title ? (
                      <h3 className="mb-2 text-xs font-medium tracking-wide text-text-sub">
                        {title}
                      </h3>
                    ) : null}
                    <dl
                      className={
                        hasRegion
                          ? 'grid grid-cols-2 gap-2 sm:grid-cols-4'
                          : 'grid grid-cols-2 gap-2'
                      }
                    >
                      {cols.map((col) => {
                        const layout = getDrawerFieldLayout(col.id);
                        return (
                          <FieldCard key={col.id} label={col.label} layout={layout}>
                            {renderFieldValue(item, col)}
                          </FieldCard>
                        );
                      })}
                    </dl>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
