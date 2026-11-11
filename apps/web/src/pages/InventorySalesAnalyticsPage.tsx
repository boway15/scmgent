import { useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  InventorySalesAnalyticsRowItem,
  InventorySalesAnalyticsSkuDetail,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useProductScope } from '@/lib/product-scope';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn, formatDateTimeCst } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 20;

const RISK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'stockout_risk', label: '缺货风险' },
  { value: 'slow_moving', label: '滞销' },
  { value: 'imbalance', label: '仓间失衡' },
  { value: 'unallocated', label: '未分配' },
];

const RISK_LABEL: Record<string, string> = {
  stockout_risk: '缺货风险',
  slow_moving: '滞销',
  imbalance: '仓间失衡',
  unallocated: '未分配',
};

const RISK_TONE: Record<string, string> = {
  stockout_risk: 'text-red-600',
  slow_moving: 'text-amber-600',
  imbalance: 'text-blue-600',
  unallocated: 'text-purple-600',
};

function fmtNum(n: number | null | undefined, suffix = ''): string {
  if (n == null || Number.isNaN(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}${suffix}`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('zh-CN');
}

/** 根据当前用户角色返回建议的默认主风险筛选；无角色字段返回 null（不强制默认）。 */
function pickDefaultRisk(roleCode: string | undefined): string | null {
  if (!roleCode) return null;
  if (roleCode === 'pmc_planner') return 'stockout_risk';
  if (roleCode === 'warehouse' || roleCode === 'purchaser') return 'slow_moving';
  return null;
}

export function InventorySalesAnalyticsPage() {
  const qc = useQueryClient();
  const { productScope } = useProductScope();
  const { data: me } = useCurrentUser();

  const [q, setQ] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [category, setCategory] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [salesCountry, setSalesCountry] = useState('');
  const [primaryRisk, setPrimaryRisk] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [applied, setApplied] = useState({
    q: '',
    warehouseCode: '',
    category: '',
    lifecycle: '',
    salesCountry: '',
    primaryRisk: '',
  });
  const [drawerSkuId, setDrawerSkuId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const detailDialogRef = useRef<HTMLDialogElement>(null);

  // 角色驱动的默认风险筛选：仅当角色首次可用时应用一次；用户清空后不再覆盖
  const defaultRiskAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultRiskAppliedRef.current) return;
    if (!me?.role?.code) return;
    const def = pickDefaultRisk(me.role.code);
    if (!def) {
      defaultRiskAppliedRef.current = true;
      return;
    }
    defaultRiskAppliedRef.current = true;
    setPrimaryRisk(def);
    setApplied((prev) => ({ ...prev, primaryRisk: def }));
  }, [me?.role?.code]);

  useEffect(() => {
    const el = detailDialogRef.current;
    if (!el) return;
    if (drawerSkuId) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [drawerSkuId]);

  const statusQuery = useQuery({
    queryKey: ['inventory-sales-analytics-status'],
    queryFn: () => api.getInventorySalesAnalyticsStatus(),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });

  const rowsQuery = useQuery({
    queryKey: [
      'inventory-sales-analytics-rows',
      applied,
      page,
      pageSize,
      productScope,
    ],
    queryFn: () =>
      api.getInventorySalesAnalyticsRows({
        q: applied.q || undefined,
        warehouseCode: applied.warehouseCode || undefined,
        category: applied.category || undefined,
        lifecycle: applied.lifecycle || undefined,
        primaryRisk: applied.primaryRisk || undefined,
        salesCountry: applied.salesCountry || undefined,
        productScope,
        page,
        pageSize,
      }),
  });

  const skuDetailQuery = useQuery({
    queryKey: ['inventory-sales-analytics-sku', drawerSkuId],
    queryFn: () => api.getInventorySalesAnalyticsSku(drawerSkuId as string),
    enabled: !!drawerSkuId,
  });

  useEffect(() => {
    setPage(1);
  }, [productScope]);

  const rebuild = useMutation({
    mutationFn: () => api.rebuildInventorySalesAnalytics(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-status'] });
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-rows'] });
    },
    onError: async () => {
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-status'] });
    },
  });

  const applyFilters = () => {
    setPage(1);
    setApplied({ q, warehouseCode, category, lifecycle, salesCountry, primaryRisk });
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await api.exportInventorySalesAnalytics({
        q: applied.q || undefined,
        warehouseCode: applied.warehouseCode || undefined,
        category: applied.category || undefined,
        lifecycle: applied.lifecycle || undefined,
        primaryRisk: applied.primaryRisk || undefined,
        salesCountry: applied.salesCountry || undefined,
        productScope,
      });
    } finally {
      setExporting(false);
    }
  };

  const status = statusQuery.data;
  const ready = status?.ready;
  const failed = status?.failed;
  const skipped = status?.skipped;
  const running = Boolean(status?.running);
  const busy = rebuild.isPending || running;
  const hasReady = Boolean(ready?.runId);

  const statusBanner = useMemo(() => {
    if (running) return { tone: 'amber', text: '正在重建存销 Cube…' };
    if (skipped) return { tone: 'amber', text: `跳过：${skipped.message ?? '源周转未发布'}` };
    if (failed) return { tone: 'red', text: `上次失败：${failed.errorMessage ?? '未知错误'}` };
    return null;
  }, [running, skipped, failed]);

  const data = rowsQuery.data;
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader title="存销分析" description="按仓拆分的存销 Cube：有效供给、7/14/30 日销量、覆盖天数与主风险。">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-text-sub">
            {ready?.snapshotDate ? `快照 ${ready.snapshotDate}` : '尚未生成'}
            {ready?.finishedAt ? ` · 生成于 ${formatDateTimeCst(ready.finishedAt)}` : ''}
          </p>
          <Button type="button" disabled={busy} onClick={() => rebuild.mutate()}>
            {busy ? '生成中…' : hasReady ? '重建 Cube' : '生成 Cube'}
          </Button>
        </div>
      </PageHeader>

      {statusBanner && (
        <div
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            statusBanner.tone === 'red'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
          role="alert"
        >
          {statusBanner.text}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductScopeSwitch />
          <div className="flex flex-wrap items-end gap-3">
            <Input
              className="w-44"
              placeholder="SKU 编码"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Input
              className="w-36"
              placeholder="仓库编码"
              value={warehouseCode}
              onChange={(e) => setWarehouseCode(e.target.value)}
            />
            <Input
              className="w-36"
              placeholder="品类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              className="w-36"
              placeholder="销售国家"
              value={salesCountry}
              onChange={(e) => setSalesCountry(e.target.value)}
            />
            <Input
              className="w-32"
              placeholder="生命周期"
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
            />
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">主风险</span>
              <select
                className="flex h-9 w-36 rounded-md border border-input bg-transparent px-3 text-sm"
                value={primaryRisk}
                onChange={(e) => setPrimaryRisk(e.target.value)}
              >
                <option value="">全部</option>
                {RISK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={applyFilters}>查询</Button>
            <Button
              variant="outline"
              disabled={exporting || !hasReady}
              onClick={onExport}
            >
              {exporting ? '导出中…' : '导出 CSV'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <KpiGrid summary={summary} rowCount={data?.total} />

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto overscroll-x-contain">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr>
                  {[
                    'SKU',
                    '仓',
                    '有效供给',
                    '7d',
                    '14d',
                    '30d',
                    '日均',
                    '覆盖(天)',
                    '动销率',
                    '主风险',
                  ].map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap border-b px-3 py-2 text-left font-medium"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsQuery.isLoading ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={10}>
                      加载中…
                    </td>
                  </tr>
                ) : rowsQuery.isError ? (
                  <tr>
                    <td className="px-3 py-6 text-red-600" colSpan={10}>
                      加载失败：{rowsQuery.error instanceof Error ? rowsQuery.error.message : '未知错误'}
                    </td>
                  </tr>
                ) : !data?.items.length ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={10}>
                      暂无数据{!hasReady ? '（请先生成 Cube）' : ''}
                    </td>
                  </tr>
                ) : (
                  data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b hover:bg-muted/40"
                      onClick={() => setDrawerSkuId(item.skuId)}
                    >
                      <td className="whitespace-nowrap px-3 py-2">{item.skuCode}</td>
                      <td className="whitespace-nowrap px-3 py-2">{item.warehouseCode}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtInt(item.effectiveQty)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtInt(item.sales7d)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtInt(item.sales14d)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtInt(item.sales30d)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtNum(item.avgDaily30d)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{fmtNum(item.coverDays)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {item.sellThrough30d == null
                          ? '—'
                          : `${(item.sellThrough30d * 100).toFixed(1)}%`}
                      </td>
                      <td
                        className={cn(
                          'whitespace-nowrap px-3 py-2',
                          item.primaryRisk ? RISK_TONE[item.primaryRisk] ?? '' : '',
                        )}
                      >
                        {item.primaryRisk ? RISK_LABEL[item.primaryRisk] ?? item.primaryRisk : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t p-3">
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <SkuDetailDialog
        ref={detailDialogRef}
        loading={skuDetailQuery.isLoading}
        skuId={drawerSkuId}
        rows={skuDetailQuery.data?.rows ?? []}
        queryReconcile={skuDetailQuery.data?.queryReconcile ?? null}
        onClose={() => setDrawerSkuId(null)}
      />
    </div>
  );
}

function KpiGrid({
  summary,
  rowCount,
}: {
  summary?: {
    rowCount: number;
    stockoutRisk: number;
    slowMoving: number;
    imbalance: number;
    unallocated: number;
  };
  rowCount?: number;
}) {
  const cards = [
    { label: '命中行数', value: fmtInt(summary?.rowCount ?? rowCount ?? null) },
    { label: '缺货风险', value: fmtInt(summary?.stockoutRisk ?? null) },
    { label: '滞销', value: fmtInt(summary?.slowMoving ?? null) },
    { label: '仓间失衡', value: fmtInt(summary?.imbalance ?? null) },
    { label: '未分配', value: fmtInt(summary?.unallocated ?? null) },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((kpi) => (
        <Card key={kpi.label}>
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold text-text-main">{kpi.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const SkuDetailDialog = forwardRef<
  HTMLDialogElement,
  {
    loading: boolean;
    skuId: string | null;
    rows: InventorySalesAnalyticsRowItem[];
    queryReconcile: InventorySalesAnalyticsSkuDetail['queryReconcile'];
    onClose: () => void;
  }
>(function SkuDetailDialog({ loading, rows, queryReconcile, onClose }, ref) {
  return (
    <dialog
      ref={ref}
      className="m-0 ml-auto h-full max-h-full w-full max-w-lg border-l border-border bg-card p-0 shadow-lg backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">SKU 各仓对比</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="space-y-4 overflow-y-auto p-4 text-sm">
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : !rows.length ? (
            <p className="text-muted-foreground">暂无数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border-b px-2 py-1 text-left">仓</th>
                    <th className="border-b px-2 py-1 text-right">有效供给</th>
                    <th className="border-b px-2 py-1 text-right">30d</th>
                    <th className="border-b px-2 py-1 text-right">覆盖</th>
                    <th className="border-b px-2 py-1 text-left">主风险</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-2 py-1">{r.warehouseCode}</td>
                      <td className="px-2 py-1 text-right">{fmtInt(r.effectiveQty)}</td>
                      <td className="px-2 py-1 text-right">{fmtInt(r.sales30d)}</td>
                      <td className="px-2 py-1 text-right">{fmtNum(r.coverDays)}</td>
                      <td
                        className={cn(
                          'px-2 py-1',
                          r.primaryRisk ? RISK_TONE[r.primaryRisk] ?? '' : '',
                        )}
                      >
                        {r.primaryRisk ? RISK_LABEL[r.primaryRisk] ?? r.primaryRisk : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 className="mb-2 font-medium">查询快照对账</h3>
            {queryReconcile?.available ? (
              <dl className="space-y-1">
                {Object.entries(queryReconcile.highlights ?? {}).map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[10rem_1fr] gap-2 border-b border-border/60 py-1"
                  >
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-all">{v || '—'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">
                {queryReconcile?.note ?? '无查询快照'}
              </p>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
});



