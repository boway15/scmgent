import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type SupplyLotBatchFilters, type SupplyLotRow, type SupplyLotSummaryFilters, type SupplyLotSummaryRow } from '@/lib/api';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope, type ProductScope } from '@/lib/product-scope';

const VIEW_MODES = [
  { id: 'summary' as const, label: '汇总视图' },
  { id: 'batches' as const, label: '批次明细' },
];

const POOL_TABS = [
  { id: 'local' as const, label: '本地库存' },
  { id: 'in_transit' as const, label: '在途库存' },
  { id: 'overseas' as const, label: '海外库存' },
];

const PROD_LABEL: Record<string, string> = {
  in_production: '生产中',
  qc_pending: '待质检',
  completed: '已完成',
};

const DETAIL_POOLS = [
  { id: 'local' as const, label: '本地' },
  { id: 'overseas' as const, label: '在库' },
  { id: 'in_transit' as const, label: '在途' },
];

function sortLotsByAvailableAt(items: SupplyLotRow[]) {
  return [...items].sort((a, b) => {
    const ad = a.availableAt ?? '9999-99-99';
    const bd = b.availableAt ?? '9999-99-99';
    if (ad !== bd) return ad.localeCompare(bd);
    return b.qty - a.qty;
  });
}

function shareSourceLabel(sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (
    sourceId.includes('avail-share') ||
    sourceId.includes('transit-share') ||
    sourceId.includes('prod-share')
  ) {
    return '占比拆仓';
  }
  if (sourceId.endsWith('#share')) return '仓由占比推定';
  return null;
}

function summaryRowKey(row: Pick<SupplyLotSummaryRow, 'skuId' | 'warehouseCode'>) {
  return `${row.skuId}::${row.warehouseCode}`;
}

/** 逻辑仓进网络供应视图；物理仓进分仓规划。 */
function planningTimelineHref(skuId: string, warehouseCode: string): string {
  if (
    warehouseCode === 'OVERSEAS' ||
    warehouseCode === 'IN-PRODUCTION' ||
    warehouseCode === 'ALL'
  ) {
    return `/inventory/planning/${skuId}?scope=network`;
  }
  return `/inventory/planning/${skuId}?scope=warehouse&warehouse=${encodeURIComponent(warehouseCode)}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type AppliedPoolFilters = {
  keyword: string;
  warehouse: string;
  hasOverseas: boolean;
  hasInTransit: boolean;
  hasLocal: boolean;
  hasUndatedTransit: boolean;
  multiTransitBatch: boolean;
  dateUnknownOnly: boolean;
};

const EMPTY_APPLIED_FILTERS: AppliedPoolFilters = {
  keyword: '',
  warehouse: '',
  hasOverseas: false,
  hasInTransit: false,
  hasLocal: false,
  hasUndatedTransit: false,
  multiTransitBatch: false,
  dateUnknownOnly: false,
};

function toSummaryFilters(applied: AppliedPoolFilters): SupplyLotSummaryFilters {
  return {
    q: applied.keyword || undefined,
    warehouse: applied.warehouse || undefined,
    hasOverseas: applied.hasOverseas || undefined,
    hasInTransit: applied.hasInTransit || undefined,
    hasLocal: applied.hasLocal || undefined,
    hasUndatedTransit: applied.hasUndatedTransit || undefined,
    multiTransitBatch: applied.multiTransitBatch || undefined,
  };
}

function toBatchFilters(
  applied: AppliedPoolFilters,
  pool: 'local' | 'in_transit' | 'overseas',
): SupplyLotBatchFilters {
  return {
    pool,
    q: applied.keyword || undefined,
    warehouse: applied.warehouse || undefined,
    dateUnknown: applied.dateUnknownOnly || undefined,
  };
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  );
}

export function InventoryPoolsPage() {
  const { productScope } = useProductScope();
  const [viewMode, setViewMode] = useState<'summary' | 'batches'>('summary');
  const [pool, setPool] = useState<'local' | 'in_transit' | 'overseas'>('local');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [hasOverseas, setHasOverseas] = useState(false);
  const [hasInTransit, setHasInTransit] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [hasUndatedTransit, setHasUndatedTransit] = useState(false);
  const [multiTransitBatch, setMultiTransitBatch] = useState(false);
  const [dateUnknownOnly, setDateUnknownOnly] = useState(false);
  const [applied, setApplied] = useState<AppliedPoolFilters>(EMPTY_APPLIED_FILTERS);
  const [exporting, setExporting] = useState(false);
  const qc = useQueryClient();

  const warehouses = useQuery({
    queryKey: ['inventory-pool-warehouses'],
    queryFn: () => api.getSupplyLotWarehouses(),
  });

  useEffect(() => {
    setPage(1);
  }, [viewMode, pool, applied, productScope]);

  const lots = useQuery({
    queryKey: ['inventory-pools', pool, page, pageSize, applied, productScope],
    queryFn: () =>
      api.getSupplyLots({
        ...toBatchFilters(applied, pool),
        productScope,
        page,
        pageSize,
      }),
    enabled: viewMode === 'batches',
  });

  const summaries = useQuery({
    queryKey: ['inventory-pools-summary', page, pageSize, applied, productScope],
    queryFn: () =>
      api.getSupplyLotSummaries({
        ...toSummaryFilters(applied),
        productScope,
        page,
        pageSize,
      }),
    enabled: viewMode === 'summary',
  });

  const sync = useMutation({
    mutationFn: api.syncSupplyLots,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-pools'] });
      qc.invalidateQueries({ queryKey: ['inventory-pools-summary'] });
      qc.invalidateQueries({ queryKey: ['inventory-pools-row-lots'] });
      qc.invalidateQueries({ queryKey: ['inventory-pool-warehouses'] });
    },
  });

  const updateLot = useMutation({
    mutationFn: (params: {
      id: string;
      productionStatus?: 'in_production' | 'qc_pending' | 'completed';
      shipReadyAt?: string | null;
      latestShipDate?: string | null;
    }) => api.updateSupplyLot(params.id, params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-pools'] });
      qc.invalidateQueries({ queryKey: ['inventory-pools-summary'] });
      qc.invalidateQueries({ queryKey: ['inventory-pools-row-lots'] });
    },
  });

  const batchItems = lots.data?.items ?? [];
  const batchTotal = lots.data?.total ?? 0;
  const dateUnknownCount = lots.data?.dateUnknownCount ?? 0;
  const summaryItems = summaries.data?.items ?? [];
  const summaryTotal = summaries.data?.total ?? 0;
  const loading = viewMode === 'summary' ? summaries.isLoading : lots.isLoading;
  const total = viewMode === 'summary' ? summaryTotal : batchTotal;

  const applyFilters = () => {
    setPage(1);
    setApplied({
      keyword: keyword.trim(),
      warehouse: warehouse.trim(),
      hasOverseas,
      hasInTransit,
      hasLocal,
      hasUndatedTransit,
      multiTransitBatch,
      dateUnknownOnly,
    });
  };

  const resetFilters = () => {
    setKeyword('');
    setWarehouse('');
    setHasOverseas(false);
    setHasInTransit(false);
    setHasLocal(false);
    setHasUndatedTransit(false);
    setMultiTransitBatch(false);
    setDateUnknownOnly(false);
    setPage(1);
    setApplied(EMPTY_APPLIED_FILTERS);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      if (viewMode === 'summary') {
        const blob = await api.exportSupplyLotSummariesCsv({
          ...toSummaryFilters(applied),
          productScope,
        });
        downloadBlob(blob, `inventory-pools-summary-${date}.csv`);
      } else {
        const blob = await api.exportSupplyLotsCsv({
          ...toBatchFilters(applied, pool),
          productScope,
        });
        downloadBlob(blob, `inventory-pools-batches-${pool}-${date}.csv`);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存三池"
        description="汇总视图按 SKU×目的仓展示本地 / 在库 / 在途 / 最近到货，展开可看该行批次明细。单池逐批维护请切换「批次明细」。无可用日不进时间轴。"
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={exporting || !total} onClick={() => void onExport()}>
            {exporting ? '导出中…' : viewMode === 'summary' ? '导出汇总 CSV' : '导出批次 CSV'}
          </Button>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? '同步中...' : '从快照/跟单同步'}
          </Button>
        </div>
      </PageHeader>

      {sync.isSuccess && sync.data && (
        <p className="text-sm text-text-sub">
          已同步 {sync.data.lotCount} 条批次（其中 {sync.data.eligibleCount} 条可进时间轴）。本地无跟单时会投影飞书「供应商订单」。
        </p>
      )}

      <ProductScopeSwitch />

      <div className="flex flex-wrap gap-2">
        {VIEW_MODES.map((mode) => (
          <Button
            key={mode.id}
            variant={viewMode === mode.id ? 'default' : 'outline'}
            onClick={() => setViewMode(mode.id)}
          >
            {mode.label}
          </Button>
        ))}
      </div>

      {viewMode === 'batches' && (
        <div className="flex flex-wrap gap-2">
          {POOL_TABS.map((tab) => (
            <Button
              key={tab.id}
              variant={pool === tab.id ? 'default' : 'outline'}
              onClick={() => {
                setPool(tab.id);
                setPage(1);
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      )}

      {viewMode === 'batches' && dateUnknownCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            当前池有 {dateUnknownCount} 条批次缺少可用日（available_at），已高亮，不会进入时间轴。
            <Link className="ml-2 text-primary underline" to="/inventory/data-issues">
              去数据问题队列
            </Link>
          </CardContent>
        </Card>
      )}
      {viewMode === 'batches' && batchItems.some((row) => row.warehouseCode === 'OVERSEAS') && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            当前池有停在 OVERSEAS 的批次，未确认目的仓前不计入某仓确定线。
            <Link className="ml-2 text-primary underline" to="/inventory/unallocated">
              去未定仓供应
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">目的仓</span>
              <select
                className="flex h-9 min-w-40 rounded-md border border-border bg-white px-3 text-sm"
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                <option value="">全部</option>
                {(warehouses.data?.items ?? []).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">关键词</span>
              <Input
                className="h-9 w-64"
                placeholder="SKU / 名称 / 工厂"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyFilters();
                  }
                }}
              />
            </label>
            <Button onClick={applyFilters}>应用筛选</Button>
            <Button variant="ghost" onClick={resetFilters}>
              重置
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {viewMode === 'summary' ? (
              <>
                <FilterChip
                  active={hasOverseas}
                  label="有在库"
                  onClick={() => setHasOverseas((v) => !v)}
                />
                <FilterChip
                  active={hasInTransit}
                  label="有在途"
                  onClick={() => setHasInTransit((v) => !v)}
                />
                <FilterChip
                  active={multiTransitBatch}
                  label="在途多批"
                  onClick={() => setMultiTransitBatch((v) => !v)}
                />
                <FilterChip
                  active={hasUndatedTransit}
                  label="无期在途"
                  onClick={() => setHasUndatedTransit((v) => !v)}
                />
                <FilterChip active={hasLocal} label="有本地" onClick={() => setHasLocal((v) => !v)} />
              </>
            ) : (
              <FilterChip
                active={dateUnknownOnly}
                label="仅缺可用日"
                onClick={() => setDateUnknownOnly((v) => !v)}
              />
            )}
          </div>
          <p className="text-xs text-text-hint">
            快捷筛选需点击「应用筛选」生效；导出 CSV 会按当前已应用的筛选条件导出全部匹配行。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {viewMode === 'summary'
              ? `SKU×目的仓汇总（${total}）`
              : `${POOL_TABS.find((t) => t.id === pool)?.label}（${total}）`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <p className="text-text-sub">加载中...</p>
          ) : viewMode === 'summary' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="w-8 py-2 pr-1" />
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">目的仓</th>
                  <th className="py-2 pr-3">本地</th>
                  <th className="py-2 pr-3">在库</th>
                  <th className="py-2 pr-3">在途</th>
                  <th className="py-2 pr-3">最近到货</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {summaryItems.map((row) => (
                  <SummaryRow
                    key={summaryRowKey(row)}
                    row={row}
                    productScope={productScope}
                    saving={updateLot.isPending}
                    onSave={(patch) => updateLot.mutate(patch)}
                  />
                ))}
                {!summaryItems.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-text-sub">
                      暂无汇总数据。可点击「从快照/跟单同步」生成。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">目的仓</th>
                  <th className="py-2 pr-3">数量</th>
                  {pool === 'local' && <th className="py-2 pr-3">生产状态</th>}
                  {pool === 'local' && <th className="py-2 pr-3">可出货日</th>}
                  <th className="py-2 pr-3">预计可售日</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {batchItems.map((row) => (
                  <LotRow
                    key={row.id}
                    row={row}
                    pool={pool}
                    onSave={(patch) => updateLot.mutate({ id: row.id, ...patch })}
                    saving={updateLot.isPending}
                  />
                ))}
                {!batchItems.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-text-sub">
                      {pool === 'local'
                        ? '暂无本地批次：当前没有开放跟单，且没有飞书供应商订单（在产）可投影。在途/海外请切换上方标签。'
                        : '暂无批次。可点击「从快照/跟单同步」生成。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {!loading && total > 0 ? (
            <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({
  row,
  productScope,
  onSave,
  saving,
}: {
  row: SupplyLotSummaryRow;
  productScope: ProductScope;
  onSave: (params: {
    id: string;
    productionStatus?: 'in_production' | 'qc_pending' | 'completed';
    shipReadyAt?: string | null;
  }) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lots = useQuery({
    queryKey: ['inventory-pools-row-lots', row.skuId, row.warehouseCode, productScope],
    queryFn: () =>
      api.getSupplyLots({
        skuId: row.skuId,
        warehouse: row.warehouseCode,
        productScope,
        page: 1,
        pageSize: 100,
      }),
    enabled: open,
  });

  return (
    <>
      <tr className="border-b">
        <td className="py-2 pr-1">
          <button
            type="button"
            className="rounded p-1 text-text-sub hover:bg-layout hover:text-text-main"
            aria-expanded={open}
            aria-label={open ? '收起批次明细' : '展开批次明细'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="py-2 pr-3">
          <Link
            className="font-mono text-primary hover:underline"
            to={planningTimelineHref(row.skuId, row.warehouseCode)}
          >
            {row.skuCode}
          </Link>
          <div className="text-xs text-text-hint">{row.skuName}</div>
        </td>
        <td className="py-2 pr-3 font-mono">{row.warehouseCode}</td>
        <td className="py-2 pr-3 font-mono">{row.localQty || '—'}</td>
        <td className="py-2 pr-3 font-mono">{row.overseasQty || '—'}</td>
        <td className="py-2 pr-3 font-mono">
          {row.inTransitQty || '—'}
          {row.undatedTransitQty > 0 ? (
            <div className="text-xs text-amber-700">无期 {row.undatedTransitQty}</div>
          ) : null}
        </td>
        <td className="py-2 pr-3 font-mono">
          {row.nextTransitAt ? (
            <>
              {row.nextTransitAt}
              <span className="ml-1 text-xs text-text-sub">×{row.nextTransitQty}</span>
              {row.nextTransitEstimated ? (
                <span className="ml-1 text-xs text-text-hint">(估)</span>
              ) : null}
            </>
          ) : row.inTransitQty > 0 ? (
            <span className="text-amber-700">待补日期</span>
          ) : (
            '—'
          )}
        </td>
        <td className="py-2 pr-3">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起明细' : `明细 ${row.batchCount}`}
          </button>
          <Link
            className="ml-3 text-xs text-primary hover:underline"
            to={planningTimelineHref(row.skuId, row.warehouseCode)}
          >
            时间轴
          </Link>
        </td>
      </tr>
      {open ? (
        <tr className="border-b bg-layout/60">
          <td colSpan={8} className="px-3 py-3">
            <SummaryLotDetails
              loading={lots.isLoading}
              error={lots.isError}
              items={lots.data?.items ?? []}
              total={lots.data?.total ?? 0}
              onSave={onSave}
              saving={saving}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SummaryLotDetails({
  loading,
  error,
  items,
  total,
  onSave,
  saving,
}: {
  loading: boolean;
  error: boolean;
  items: SupplyLotRow[];
  total: number;
  onSave: (params: {
    id: string;
    productionStatus?: 'in_production' | 'qc_pending' | 'completed';
    shipReadyAt?: string | null;
  }) => void;
  saving: boolean;
}) {
  if (loading) return <p className="text-sm text-text-sub">加载批次明细…</p>;
  if (error) return <p className="text-sm text-amber-700">批次明细加载失败，请重试。</p>;
  if (!items.length) return <p className="text-sm text-text-sub">该 SKU×目的仓没有开放批次。</p>;

  const grouped = DETAIL_POOLS.map((pool) => ({
    ...pool,
    lots: sortLotsByAvailableAt(items.filter((lot) => lot.pool === pool.id)),
  })).filter((group) => group.lots.length > 0);

  return (
    <div className="space-y-3">
      {grouped.map((group) => (
        <div key={group.id}>
          <p className="mb-1 text-xs font-medium text-text-sub">
            {group.label} {group.lots.length} 批
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-text-hint">
                <th className="py-1 pr-3">数量</th>
                <th className="py-1 pr-3">生产状态</th>
                <th className="py-1 pr-3">可出货日</th>
                <th className="py-1 pr-3">预计可售日</th>
                <th className="py-1 pr-3">来源</th>
                <th className="py-1 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {group.lots.map((lot) => (
                <SummaryLotRow key={lot.id} lot={lot} onSave={onSave} saving={saving} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {total > items.length ? (
        <p className="text-xs text-amber-700">
          该行开放批次共 {total} 条，此处展示前 {items.length} 条。完整列表请用「批次明细」。
        </p>
      ) : null}
    </div>
  );
}

function SummaryLotRow({
  lot,
  onSave,
  saving,
}: {
  lot: SupplyLotRow;
  onSave: (params: {
    id: string;
    productionStatus?: 'in_production' | 'qc_pending' | 'completed';
    shipReadyAt?: string | null;
  }) => void;
  saving: boolean;
}) {
  const [shipReadyAt, setShipReadyAt] = useState(lot.shipReadyAt ?? '');
  const [productionStatus, setProductionStatus] = useState(lot.productionStatus ?? 'completed');
  const unknown = lot.dateUnknown || !lot.availableAt;
  const shareLabel = shareSourceLabel(lot.sourceId);
  const editable = false;

  return (
    <tr className={unknown ? 'bg-amber-50/80' : undefined}>
      <td className="py-1 pr-3 font-mono">{lot.qty}</td>
      <td className="py-1 pr-3">
        {editable ? (
          <select
            className="h-7 rounded border border-border bg-white px-2 text-xs"
            value={productionStatus}
            onChange={(e) => setProductionStatus(e.target.value as typeof productionStatus)}
          >
            {Object.entries(PROD_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          '—'
        )}
      </td>
      <td className="py-1 pr-3">
        {editable ? (
          <input
            type="date"
            className="h-7 rounded border border-border px-2 font-mono text-xs"
            value={shipReadyAt}
            onChange={(e) => setShipReadyAt(e.target.value)}
          />
        ) : (
          '—'
        )}
      </td>
      <td className="py-1 pr-3 font-mono">
        {lot.availableAt ?? <span className="text-amber-700">不可计入可售</span>}
        {lot.etaEstimated ? <span className="ml-1 text-text-hint">(估)</span> : null}
      </td>
      <td className="py-1 pr-3 text-text-sub">
        {lot.source}
        {shareLabel ? <span className="ml-1 text-text-hint">{shareLabel}</span> : null}
      </td>
      <td className="py-1 pr-3">
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() =>
              onSave({
                id: lot.id,
                productionStatus,
                shipReadyAt: shipReadyAt || null,
              })
            }
          >
            保存
          </Button>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

function LotRow({
  row,
  pool,
  onSave,
  saving,
}: {
  row: SupplyLotRow;
  pool: 'local' | 'in_transit' | 'overseas';
  onSave: (patch: {
    productionStatus?: 'in_production' | 'qc_pending' | 'completed';
    shipReadyAt?: string | null;
    latestShipDate?: string | null;
  }) => void;
  saving: boolean;
}) {
  const [shipReadyAt, setShipReadyAt] = useState(row.shipReadyAt ?? '');
  const [productionStatus, setProductionStatus] = useState(
    row.productionStatus ?? 'completed',
  );
  const unknown = row.dateUnknown || !row.availableAt;
  const shareLabel = shareSourceLabel(row.sourceId);

  return (
    <tr className={unknown ? 'bg-amber-50/80' : undefined}>
      <td className="py-2 pr-3">
        <Link
          className="font-mono text-primary hover:underline"
          to={planningTimelineHref(row.skuId, row.warehouseCode)}
        >
          {row.skuCode}
        </Link>
        <div className="text-xs text-text-hint">{row.skuName}</div>
      </td>
      <td className="py-2 pr-3 font-mono">
        {row.warehouseCode}
        {shareLabel ? (
          <span className="ml-1 text-xs font-sans text-text-hint">{shareLabel}</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 font-mono">{row.qty}</td>
      {pool === 'local' && (
        <td className="py-2 pr-3 text-text-sub">{PROD_LABEL[productionStatus] ?? productionStatus}</td>
      )}
      {pool === 'local' && (
        <td className="py-2 pr-3 font-mono text-text-sub">{shipReadyAt || '—'}</td>
      )}
      <td className="py-2 pr-3 font-mono">
        {row.availableAt ?? <span className="text-amber-700">不可计入可售</span>}
        {row.etaEstimated ? <span className="ml-1 text-xs text-text-hint">(估)</span> : null}
      </td>
      <td className="py-2 pr-3 text-xs text-text-sub">{row.source}</td>
      <td className="py-2 pr-3">
        <Link
          className="text-xs text-primary hover:underline"
          to={planningTimelineHref(row.skuId, row.warehouseCode)}
        >
          时间轴
        </Link>
      </td>
    </tr>
  );
}
