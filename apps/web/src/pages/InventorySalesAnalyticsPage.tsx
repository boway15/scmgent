import { useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  InventorySalesAnalyticsOverview,
  InventorySalesAnalyticsRowItem,
  InventorySalesAnalyticsSkuDetail,
  InventorySalesBreakdownBucket,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DataQueryField,
  DataQuerySection,
  DataQuerySubmitButton,
  DataQueryToolbar,
} from '@/components/data-query';
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
  { value: 'none', label: '无主风险' },
];

const COVER_BAND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'd0_14', label: '0–14 天' },
  { value: 'd15_30', label: '15–30 天' },
  { value: 'd31_90', label: '31–90 天' },
  { value: 'd90_plus', label: '90 天以上' },
  { value: 'no_velocity', label: '无动销' },
];

const RISK_LABEL: Record<string, string> = {
  stockout_risk: '缺货风险',
  slow_moving: '滞销',
  imbalance: '仓间失衡',
  unallocated: '未分配',
  none: '无主风险',
};

const RISK_TONE: Record<string, string> = {
  stockout_risk: 'text-red-600',
  slow_moving: 'text-amber-600',
  imbalance: 'text-blue-600',
  unallocated: 'text-purple-600',
};

/** 主表列顺序；title 供鼠标悬停释义 */
const TABLE_COLUMNS: Array<{ key: string; label: string; tip: string }> = [
  { key: 'sku', label: 'SKU', tip: '商品编码；一行代表该 SKU 在某一物理仓的存销快照。' },
  {
    key: 'warehouse',
    label: '仓',
    tip: '物理仓编码（如美东/美西/欧）。无销售占比可拆时可能为 OVERSEAS（未分仓）。',
  },
  {
    key: 'effectiveQty',
    label: '有效供给',
    tip: '该仓可参与规划的供给量（可售+在途等，与库存总览/补货同口径）；覆盖天数的分子。不含国内未发。',
  },
  {
    key: 'qtyDomesticUnshipped',
    label: '国内未发',
    tip: '已下单供应商未发出（IN-PRODUCTION 在产池）。SKU 级数量，同 SKU 各仓行相同；不计入有效供给与预计可售天数。',
  },
  { key: 'sales7d', label: '7d', tip: '近 7 天销量按该仓销售占比分摊后的合计。' },
  { key: 'sales14d', label: '14d', tip: '近 14 天销量按该仓销售占比分摊后的合计。' },
  {
    key: 'sales30d',
    label: '30d',
    tip: '近 30 天销量按该仓销售占比分摊后的合计；同 SKU 各仓之和约等于 SKU 总销量。',
  },
  {
    key: 'avgDaily30d',
    label: '日均',
    tip: '30 日分摊销量 ÷ 30；无动销时为空。覆盖天数的分母。',
  },
  {
    key: 'coverDays',
    label: '覆盖(天)',
    tip: '有效供给 ÷ 日均：按近 30 日卖速还能撑几天。无日均时为空（不显示 0）。',
  },
  {
    key: 'sellThrough30d',
    label: '动销率',
    tip: '30日销 ÷ (30日销 + 有效供给)；越高货转得越快。分母为 0 时为空。',
  },
  {
    key: 'primaryRisk',
    label: '主风险',
    tip: '优先级最高的一条：缺货风险 > 滞销 > 仓间失衡 > 未分配。',
  },
];

type FacetDim = 'risk' | 'warehouse' | 'category' | 'lifecycle' | 'coverBand';

const FACET_TABS: Array<{ key: FacetDim; label: string }> = [
  { key: 'risk', label: '主风险' },
  { key: 'warehouse', label: '物理仓' },
  { key: 'category', label: '品类' },
  { key: 'lifecycle', label: '生命周期' },
  { key: 'coverBand', label: '覆盖组距' },
];

type AppliedFilters = {
  q: string;
  warehouseCodes: string[];
  categories: string[];
  lifecycles: string[];
  salesCountry: string;
  primaryRisk: string;
  coverBand: string;
  /** true=隐藏无库存且无近30d销量；默认 true */
  hideIdle: boolean;
};

type MultiOption = { value: string; label: string };

const MAX_FILTER_MULTI = 50;

function toggleMultiValue(values: string[], key: string): string[] {
  const set = new Set(values);
  if (set.has(key)) set.delete(key);
  else if (set.size < MAX_FILTER_MULTI) set.add(key);
  return [...set];
}

/** 品类/仓库/生命周期多选（与销量分析 DimMultiSelect 同交互）。 */
function FilterMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle),
    );
  }, [options, search]);
  const summary =
    selected.length === 0
      ? '未选'
      : selected.length >= options.length && options.length > 0
        ? '全部'
        : `已选 ${selected.length}`;

  return (
    <div className="relative min-w-[160px]">
      <p className="mb-1 text-sm text-text-sub">{label}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 w-full justify-between font-normal"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{summary}</span>
        <span className="text-text-hint">▾</span>
      </Button>
      {open && (
        <div className="absolute z-30 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-card">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="输入查找…"
            className="mb-2 h-8 text-xs"
          />
          <div className="mb-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                onChange(options.slice(0, MAX_FILTER_MULTI).map((o) => o.value))
              }
            >
              全选
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange([])}
            >
              清空
            </Button>
          </div>
          <div className="max-h-56 overflow-auto">
            {filtered.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(opt.value)}
                  onChange={() => onChange(toggleMultiValue(selected, opt.value))}
                />
                <span className="truncate" title={opt.label}>
                  {opt.label}
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="px-1 py-2 text-xs text-text-hint">无匹配项</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtNum(n: number | null | undefined, suffix = ''): string {
  if (n == null || Number.isNaN(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}${suffix}`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('zh-CN');
}

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
  const [warehouseCodes, setWarehouseCodes] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [lifecycles, setLifecycles] = useState<string[]>([]);
  const [salesCountry, setSalesCountry] = useState('');
  const [primaryRisk, setPrimaryRisk] = useState('');
  const [coverBand, setCoverBand] = useState('');
  const [hideIdle, setHideIdle] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [facetDim, setFacetDim] = useState<FacetDim>('risk');
  const [applied, setApplied] = useState<AppliedFilters>({
    q: '',
    warehouseCodes: [],
    categories: [],
    lifecycles: [],
    salesCountry: '',
    primaryRisk: '',
    coverBand: '',
    hideIdle: true,
  });
  const [drawerSkuId, setDrawerSkuId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const detailDialogRef = useRef<HTMLDialogElement>(null);

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

  const filterParams = {
    q: applied.q || undefined,
    warehouseCodes: applied.warehouseCodes.length ? applied.warehouseCodes : undefined,
    categories: applied.categories.length ? applied.categories : undefined,
    lifecycles: applied.lifecycles.length ? applied.lifecycles : undefined,
    primaryRisk: applied.primaryRisk || undefined,
    salesCountry: applied.salesCountry || undefined,
    coverBand: applied.coverBand || undefined,
    includeIdle: applied.hideIdle ? undefined : true,
    productScope,
  };

  /** 筛选项候选：不受品类/仓/生命周期筛选影响，避免选项被当前选择掏空 */
  const facetOptionsQuery = useQuery({
    queryKey: ['inventory-sales-analytics-facet-options', productScope, applied.hideIdle],
    queryFn: () =>
      api.getInventorySalesAnalyticsOverview({
        productScope,
        includeIdle: applied.hideIdle ? undefined : true,
      }),
  });

  const overviewQuery = useQuery({
    queryKey: ['inventory-sales-analytics-overview', applied, productScope],
    queryFn: () => api.getInventorySalesAnalyticsOverview(filterParams),
  });

  const rowsQuery = useQuery({
    queryKey: ['inventory-sales-analytics-rows', applied, page, pageSize, productScope],
    queryFn: () =>
      api.getInventorySalesAnalyticsRows({
        ...filterParams,
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
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-overview'] });
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-facet-options'] });
    },
    onError: async () => {
      await qc.invalidateQueries({ queryKey: ['inventory-sales-analytics-status'] });
    },
  });

  const syncDraftFromApplied = (next: AppliedFilters) => {
    setQ(next.q);
    setWarehouseCodes(next.warehouseCodes);
    setCategories(next.categories);
    setLifecycles(next.lifecycles);
    setSalesCountry(next.salesCountry);
    setPrimaryRisk(next.primaryRisk);
    setCoverBand(next.coverBand);
    setHideIdle(next.hideIdle);
  };

  const applyFilters = (next?: AppliedFilters) => {
    const payload =
      next ??
      ({
        q,
        warehouseCodes,
        categories,
        lifecycles,
        salesCountry,
        primaryRisk,
        coverBand,
        hideIdle,
      } satisfies AppliedFilters);
    setPage(1);
    setApplied(payload);
    if (next) syncDraftFromApplied(next);
  };

  const onFacetBucket = (dim: FacetDim, bucket: InventorySalesBreakdownBucket) => {
    const next: AppliedFilters = { ...applied };
    if (dim === 'risk') {
      next.primaryRisk = applied.primaryRisk === bucket.key ? '' : bucket.key;
    } else if (dim === 'warehouse') {
      next.warehouseCodes = toggleMultiValue(applied.warehouseCodes, bucket.key);
    } else if (dim === 'category') {
      next.categories = toggleMultiValue(applied.categories, bucket.key);
    } else if (dim === 'lifecycle') {
      next.lifecycles = toggleMultiValue(applied.lifecycles, bucket.key);
    } else {
      next.coverBand = applied.coverBand === bucket.key ? '' : bucket.key;
    }
    applyFilters(next);
  };

  const clearFacetFilters = () => {
    applyFilters({
      ...applied,
      warehouseCodes: [],
      categories: [],
      lifecycles: [],
      primaryRisk: '',
      coverBand: '',
    });
  };

  const warehouseOptions = useMemo<MultiOption[]>(() => {
    const fromMeta = statusQuery.data?.ready?.meta?.warehouses ?? [];
    if (fromMeta.length) return fromMeta.map((code) => ({ value: code, label: code }));
    return (facetOptionsQuery.data?.breakdowns.byWarehouse ?? []).map((b) => ({
      value: b.key,
      label: b.label,
    }));
  }, [statusQuery.data?.ready?.meta?.warehouses, facetOptionsQuery.data]);

  const categoryOptions = useMemo<MultiOption[]>(
    () =>
      (facetOptionsQuery.data?.breakdowns.byCategory ?? []).map((b) => ({
        value: b.key,
        label: b.label,
      })),
    [facetOptionsQuery.data],
  );

  const lifecycleOptions = useMemo<MultiOption[]>(
    () =>
      (facetOptionsQuery.data?.breakdowns.byLifecycle ?? []).map((b) => ({
        value: b.key,
        label: b.label,
      })),
    [facetOptionsQuery.data],
  );

  const onToggleHideIdle = (checked: boolean) => {
    setHideIdle(checked);
    applyFilters({ ...applied, hideIdle: checked });
  };

  const onExport = async () => {
    setExporting(true);
    try {
      await api.exportInventorySalesAnalytics({
        ...filterParams,
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
  const overview = overviewQuery.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="存销分析"
        description="经营指挥台：销量 / 库存 / 覆盖 / 健康 + 五维归类下钻。"
      >
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

      <DataQuerySection>
        <ProductScopeSwitch />
        <DataQueryToolbar>
          <DataQueryField label="SKU（可多个）">
            <Input
              className="h-9 w-56 font-mono"
              placeholder="多个用逗号或空格分隔"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </DataQueryField>
          <FilterMultiSelect
            label="仓库（可多选）"
            options={warehouseOptions}
            selected={warehouseCodes}
            onChange={setWarehouseCodes}
          />
          <FilterMultiSelect
            label="品类（可多选）"
            options={categoryOptions}
            selected={categories}
            onChange={setCategories}
          />
          <FilterMultiSelect
            label="生命周期（可多选）"
            options={lifecycleOptions}
            selected={lifecycles}
            onChange={setLifecycles}
          />
          <DataQueryField label="销售国家">
            <Input
              className="h-9 w-36"
              placeholder="可选"
              value={salesCountry}
              onChange={(e) => setSalesCountry(e.target.value)}
            />
          </DataQueryField>
          <DataQueryField label="主风险">
            <select
              className="flex h-9 w-36 rounded-md border border-border bg-card px-2 text-sm"
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
          </DataQueryField>
          <DataQueryField label="覆盖组距">
            <select
              className="flex h-9 w-36 rounded-md border border-border bg-card px-2 text-sm"
              value={coverBand}
              onChange={(e) => setCoverBand(e.target.value)}
            >
              <option value="">全部</option>
              {COVER_BAND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </DataQueryField>
          <DataQuerySubmitButton onClick={() => applyFilters()} />
          <Button variant="outline" className="shrink-0" onClick={clearFacetFilters}>
            清除归类筛选
          </Button>
          <Button variant="outline" className="shrink-0" disabled={exporting || !hasReady} onClick={onExport}>
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        </DataQueryToolbar>
      </DataQuerySection>

      <CommandTotals overview={overview} loading={overviewQuery.isLoading} />

      <BreakdownPanel
        overview={overview}
        facetDim={facetDim}
        onFacetDimChange={setFacetDim}
        applied={applied}
        onBucketClick={onFacetBucket}
        loading={overviewQuery.isLoading}
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">明细下钻（SKU×仓）</CardTitle>
              <p className="text-xs text-text-hint">
                每一行 = 一个 SKU 在一个物理仓的存销快照。上方「命中行数」与本表分页总数相同，均来自当前筛选下的行计数（不是
                SKU 去重数）。健康监控中的缺货/滞销/失衡/未分配，也是对本表「主风险」列按行汇总。
              </p>
            </div>
            <label
              className="mt-0.5 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-text-hint hover:text-text-sub"
              title="默认隐藏：有效供给=0 且近30日销量=0。取消勾选可调出这些空闲行。"
            >
              <input
                type="checkbox"
                className="size-3.5 rounded border-border accent-muted-foreground"
                checked={hideIdle}
                onChange={(e) => onToggleHideIdle(e.target.checked)}
              />
              隐藏无库存且无动销
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto overscroll-x-contain">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr>
                  {TABLE_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      title={col.tip}
                      className="cursor-help whitespace-nowrap border-b px-3 py-2 text-left font-medium"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsQuery.isLoading ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={11}>
                      加载中…
                    </td>
                  </tr>
                ) : rowsQuery.isError ? (
                  <tr>
                    <td className="px-3 py-6 text-red-600" colSpan={11}>
                      加载失败：
                      {rowsQuery.error instanceof Error ? rowsQuery.error.message : '未知错误'}
                    </td>
                  </tr>
                ) : !data?.items.length ? (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={11}>
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
                      <td className="whitespace-nowrap px-3 py-2">
                        {fmtInt(item.qtyDomesticUnshipped)}
                      </td>
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
                          item.primaryRisk ? (RISK_TONE[item.primaryRisk] ?? '') : '',
                        )}
                      >
                        {item.primaryRisk ? (RISK_LABEL[item.primaryRisk] ?? item.primaryRisk) : '—'}
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

function CommandTotals({
  overview,
  loading,
}: {
  overview?: InventorySalesAnalyticsOverview;
  loading: boolean;
}) {
  const t = overview?.totals;
  const asOf =
    overview?.meta.sourceSalesAsOf ?? overview?.meta.snapshotDate ?? null;
  const asOfLabel = asOf ?? '—';
  const velocityPct =
    t && t.rowCount > 0 ? Math.round((t.withVelocityRowCount / t.rowCount) * 1000) / 10 : null;

  const cards = [
    {
      key: 'sold',
      label: `近30d销量（截至${asOfLabel}）`,
      tip: '当前筛选下，按仓销售占比分摊后的近 30 日销量合计；副文案为同期 7 日 / 14 日窗口。截至日为销量窗口截止日（业务日−2，因当天及昨天销量通常尚未入湖）。',
      value: loading ? '…' : fmtInt(t?.sales30dSum),
      sub: loading ? '' : `7d ${fmtInt(t?.sales7dSum)} · 14d ${fmtInt(t?.sales14dSum)}`,
    },
    {
      key: 'stock',
      label: '当前库存（可售+在途，不含国内工厂未发出）',
      tip: '当前筛选下「有效供给」合计，与库存总览/补货规划同口径：可售 + 在途等；不含国内未发（已下单供应商未发出，见明细列）。命中行数见下方明细表说明。',
      value: loading ? '…' : fmtInt(t?.effectiveQtySum),
      sub: loading ? '' : `命中 ${fmtInt(t?.rowCount)} 行（= 下方明细总行数）`,
    },
    {
      key: 'cover',
      label: '预计可售天数',
      tip: '计算：对「有动销」的行取 cover_days = 有效供给 ÷ 近30日日均，再对这些行做算术平均。无日均（无动销）的行不参与平均，避免当成 0 天。',
      value: loading ? '…' : fmtNum(t?.avgCoverDays ?? null, ' 天'),
      sub: loading
        ? ''
        : velocityPct == null
          ? '无动销样本（近30日分摊销量为 0 或空，无法算覆盖）'
          : `有动销 ${velocityPct}%（${fmtInt(t?.withVelocityRowCount)}/${fmtInt(t?.rowCount)} 行有覆盖天数）`,
    },
    {
      key: 'health',
      label: '健康监控',
      tip: '是的：数字来自下方明细「主风险」列，在同一筛选下按行计数。大数字 = 缺货+滞销+失衡+未分配之和（一行只记一种主风险；无主风险的行不计入）。',
      value: loading
        ? '…'
        : fmtInt(
            (t?.stockoutRisk ?? 0) +
              (t?.slowMoving ?? 0) +
              (t?.imbalance ?? 0) +
              (t?.unallocated ?? 0),
          ),
      sub: loading
        ? ''
        : `缺货 ${fmtInt(t?.stockoutRisk)} · 滞销 ${fmtInt(t?.slowMoving)} · 失衡 ${fmtInt(t?.imbalance)} · 未分配 ${fmtInt(t?.unallocated)}（均来自下方行）`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((kpi) => (
        <Card key={kpi.key} title={kpi.tip} className="cursor-help">
          <CardContent className="pt-6">
            <p className="text-sm leading-snug text-text-sub">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold text-text-main">{kpi.value}</p>
            {kpi.sub ? <p className="mt-1 text-xs text-text-hint">{kpi.sub}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BreakdownPanel({
  overview,
  facetDim,
  onFacetDimChange,
  applied,
  onBucketClick,
  loading,
}: {
  overview?: InventorySalesAnalyticsOverview;
  facetDim: FacetDim;
  onFacetDimChange: (d: FacetDim) => void;
  applied: AppliedFilters;
  onBucketClick: (dim: FacetDim, bucket: InventorySalesBreakdownBucket) => void;
  loading: boolean;
}) {
  const buckets = useMemo(() => {
    const b = overview?.breakdowns;
    if (!b) return [] as InventorySalesBreakdownBucket[];
    if (facetDim === 'risk') return b.byRisk;
    if (facetDim === 'warehouse') return b.byWarehouse;
    if (facetDim === 'category') return b.byCategory;
    if (facetDim === 'lifecycle') return b.byLifecycle;
    return b.byCoverBand;
  }, [overview, facetDim]);

  const activeKeys = useMemo(() => {
    if (facetDim === 'risk') return applied.primaryRisk ? new Set([applied.primaryRisk]) : new Set<string>();
    if (facetDim === 'warehouse') return new Set(applied.warehouseCodes);
    if (facetDim === 'category') return new Set(applied.categories);
    if (facetDim === 'lifecycle') return new Set(applied.lifecycles);
    return applied.coverBand ? new Set([applied.coverBand]) : new Set<string>();
  }, [facetDim, applied]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">五维归类</CardTitle>
          <p className="text-xs text-text-hint">
            同一筛选下互斥分组；仓/品类/生命周期点击可多选叠加，再点取消
          </p>
        </div>
        <nav className="mt-2 flex flex-wrap gap-1 border-b border-border">
          {FACET_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onFacetDimChange(tab.key)}
              className={cn(
                'relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                facetDim === tab.key
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-text-sub hover:text-text-main',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">归类加载中…</p>
        ) : !buckets.length ? (
          <p className="text-sm text-muted-foreground">暂无归类数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-text-sub">
                  <th className="border-b px-2 py-1.5 font-normal">桶</th>
                  <th className="border-b px-2 py-1.5 text-right font-normal">行数</th>
                  <th className="border-b px-2 py-1.5 text-right font-normal">有效供给</th>
                  <th className="border-b px-2 py-1.5 text-right font-normal">30d 销</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((bucket) => {
                  const active = activeKeys.has(bucket.key);
                  return (
                    <tr
                      key={bucket.key}
                      className={cn(
                        'cursor-pointer border-b border-border/60 hover:bg-muted/40',
                        active && 'bg-orange-50',
                      )}
                      onClick={() => onBucketClick(facetDim, bucket)}
                    >
                      <td className="px-2 py-1.5 font-medium text-text-main">{bucket.label}</td>
                      <td className="px-2 py-1.5 text-right">{fmtInt(bucket.rowCount)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtInt(bucket.effectiveQtySum)}</td>
                      <td className="px-2 py-1.5 text-right">{fmtInt(bucket.sales30dSum)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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
                    <th
                      className="cursor-help border-b px-2 py-1 text-left"
                      title="物理仓编码；OVERSEAS 表示销售占比未拆出的未分仓库存。"
                    >
                      仓
                    </th>
                    <th
                      className="cursor-help border-b px-2 py-1 text-right"
                      title="该仓有效供给（与主表同口径）。不含国内未发。"
                    >
                      有效供给
                    </th>
                    <th
                      className="cursor-help border-b px-2 py-1 text-right"
                      title="已下单供应商未发出（国内在产池）；SKU 级，不计入有效供给。"
                    >
                      国内未发
                    </th>
                    <th
                      className="cursor-help border-b px-2 py-1 text-right"
                      title="近 30 天按仓分摊后的销量。"
                    >
                      30d
                    </th>
                    <th
                      className="cursor-help border-b px-2 py-1 text-right"
                      title="有效供给 ÷ 日均：还能撑几天。"
                    >
                      覆盖
                    </th>
                    <th
                      className="cursor-help border-b px-2 py-1 text-left"
                      title="缺货风险 > 滞销 > 仓间失衡 > 未分配。"
                    >
                      主风险
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-2 py-1">{r.warehouseCode}</td>
                      <td className="px-2 py-1 text-right">{fmtInt(r.effectiveQty)}</td>
                      <td className="px-2 py-1 text-right">{fmtInt(r.qtyDomesticUnshipped)}</td>
                      <td className="px-2 py-1 text-right">{fmtInt(r.sales30d)}</td>
                      <td className="px-2 py-1 text-right">{fmtNum(r.coverDays)}</td>
                      <td
                        className={cn(
                          'px-2 py-1',
                          r.primaryRisk ? (RISK_TONE[r.primaryRisk] ?? '') : '',
                        )}
                      >
                        {r.primaryRisk ? (RISK_LABEL[r.primaryRisk] ?? r.primaryRisk) : '—'}
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
              <p className="text-muted-foreground">{queryReconcile?.note ?? '无查询快照'}</p>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
});
