import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type ShipmentStatus, type SkuPlanningView } from '@/lib/api';

type PlanningView = SkuPlanningView & {
  stockoutAdjusted?: boolean;
  allocation?: {
    method: 'sales_share' | 'native_warehouse' | 'unallocated';
    snapshotDate: string | null;
    overseasTotal: number;
    allocatedQty: number;
    undatedTransitQty: number;
    shareSumWarning: boolean;
  };
};

const POSITION_ROWS = [
  ['qtyAvailable', '可售库存', '+'],
  ['qtyInProduction', '生产中', '+'],
  ['qtyInTransit', '在途库存', '+'],
  ['qtyConfirmedOpen', '已确认开放量', '+'],
  ['qtyReserved', '已分配', '−'],
  ['qtyBackorder', '欠单', '−'],
] as const;

const LEAD_TIME_ROWS = [
  ['productionDays', '生产'],
  ['domesticDays', '国内运输'],
  ['bookingDays', '订舱'],
  ['transitDays', '国际运输'],
  ['customsDays', '清关'],
  ['inboundDays', '入仓'],
] as const;

const POOL_LABEL: Record<'overseas' | 'in_transit' | 'local', string> = {
  local: '本地',
  in_transit: '在途',
  overseas: '海外',
};

const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  booked: '已订舱',
  loaded: '已装柜',
  departed: '已离港',
  arrived_port: '已到港',
  customs: '清关中',
  received_wh: '仓库签收',
  available: '已可售',
  cancelled: '已取消',
};

const CLOSED_PURCHASE_STATUSES = new Set(['received', 'cancelled']);

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-text-sub">{label}</p>
        <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{value}</p>
        {hint && <p className="mt-1 text-xs text-text-hint">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function leadHorizonExpectedEnding(item: PlanningView): string {
  const points = item.timeline?.points;
  if (!points?.length) return '暂无';
  const match = points.find((p) => p.horizonDays === item.leadTime.totalLeadDays);
  const point = match ?? points.reduce((best, p) => (p.horizonDays > best.horizonDays ? p : best));
  return String(Math.round(point.expectedEnding));
}

function timelinePoWarning(timeline: NonNullable<SkuPlanningView['timeline']>): string | null {
  if (timeline.uncoverableByNewPo) return '新计划已来不及覆盖确定缺货。';
  if (timeline.tooLateForNewPo) return '已过最晚下单日，新计划可能赶不上确定缺货。';
  return null;
}

function ScopeToggle({
  scope,
  onChange,
}: {
  scope: 'network' | 'warehouse';
  onChange: (next: 'network' | 'warehouse') => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-white p-0.5 text-sm">
      <button
        type="button"
        className={`rounded px-3 py-1.5 ${
          scope === 'network'
            ? 'bg-primary text-white'
            : 'text-text-sub hover:bg-muted hover:text-text-main'
        }`}
        onClick={() => onChange('network')}
      >
        网络供应
      </button>
      <button
        type="button"
        className={`rounded px-3 py-1.5 ${
          scope === 'warehouse'
            ? 'bg-primary text-white'
            : 'text-text-sub hover:bg-muted hover:text-text-main'
        }`}
        onClick={() => onChange('warehouse')}
      >
        分仓规划
      </button>
    </div>
  );
}

function TimelineTable({ item }: { item: PlanningView }) {
  const poWarning = item.timeline ? timelinePoWarning(item.timeline) : null;
  if (!item.timeline?.points?.length) {
    return (
      <>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-primary via-amber-300 to-emerald-400" />
        <div className="grid gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-text-sub">当前有效供给</p>
            <p className="font-mono text-text-main">{item.position.effectiveQty}</p>
          </div>
          <div>
            <p className="text-text-sub">预计断货日</p>
            <p className="font-mono text-text-main">{item.stockoutDateEstimate ?? '暂无'}</p>
          </div>
          <div>
            <p className="text-text-sub">最近预计可售日</p>
            <p className="font-mono text-text-main">
              {item.etaAvailableNearest ?? '暂无跟单补给'}
            </p>
          </div>
          <div>
            <p className="text-text-sub">再订货点</p>
            <p className="font-mono text-text-main">{item.reorderPoint ?? '暂无'}</p>
          </div>
        </div>
        <p className="text-xs text-text-hint">
          尚未生成供给批次时间轴。请先在「库存三池」同步快照/跟单，或等待每日流水线任务。
        </p>
      </>
    );
  }

  return (
    <>
      {poWarning ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {poWarning}
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-text-sub">
            <th className="py-2 pr-2">节点</th>
            <th className="py-2 pr-2">日期</th>
            <th className="py-2 pr-2">确定余额</th>
            <th className="py-2 pr-2">预计余额</th>
            <th className="py-2 pr-2">累计需求</th>
            <th className="py-2 pr-2">管道</th>
          </tr>
        </thead>
        <tbody>
          {item.timeline.points.map((point) => (
            <tr
              key={point.horizonDays}
              className={
                point.confirmedEnding <= 0 ? 'bg-red-50' : 'border-b border-border/50'
              }
            >
              <td className="py-2 pr-2 font-mono">
                {point.horizonDays === 0 ? '今天' : `${point.horizonDays}天`}
              </td>
              <td className="py-2 pr-2 font-mono">{point.asOf}</td>
              <td
                className={`py-2 pr-2 font-mono font-semibold ${
                  point.confirmedEnding <= 0 ? 'text-red-600' : 'text-text-main'
                }`}
              >
                {Math.round(point.confirmedEnding)}
              </td>
              <td className="py-2 pr-2 font-mono">
                {Math.round(point.expectedEnding)}
              </td>
              <td className="py-2 pr-2 font-mono">
                {Math.round(point.cumulativeDemand)}
              </td>
              <td className="py-2 pr-2 font-mono text-xs text-text-sub">
                {point.plannedInbound > 0 ? `管道 +${point.plannedInbound}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 text-sm md:grid-cols-4">
        <div>
          <p className="text-text-sub">当前有效供给（快照）</p>
          <p className="font-mono text-text-main">{item.position.effectiveQty}</p>
        </div>
        <div>
          <p className="text-text-sub">预计断货日</p>
          <p className="font-mono text-text-main">
            {item.timeline.stockoutDateExpected ?? item.stockoutDateEstimate ?? '暂无'}
          </p>
        </div>
        <div>
          <p className="text-text-sub">最近预计可售日</p>
          <p className="font-mono text-text-main">
            {item.etaAvailableNearest ?? '暂无跟单补给'}
          </p>
        </div>
        <div>
          <p className="text-text-sub">再订货点</p>
          <p className="font-mono text-text-main">{item.reorderPoint ?? '暂无'}</p>
        </div>
      </div>
      <p className="text-xs text-text-hint">
        {item.scope === 'network'
          ? '网络确定线=全仓 open lots（含在产/海外未定仓）投影；交期用地平线为出货前生产段。未定仓不在本系统落仓。'
          : '确定线=海外可售+真实 ETA 在途；预计线=已达出货交期的本地货（可用日=出货交期+剩余物流）；计划线（在产/估期）不填近窗、不挡建议量。'}
      </p>
    </>
  );
}

function DecisionMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-[5.5rem]">
      <p className="text-xs text-text-sub">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-text-main">{value}</p>
    </div>
  );
}

/** Align with server resolvePlanningScope: no warehouse → network. */
function resolveClientPlanningScope(
  scopeParam: string | undefined,
  warehouseParam: string | undefined,
): 'network' | 'warehouse' {
  if (
    scopeParam === 'warehouse' &&
    warehouseParam &&
    warehouseParam !== 'ALL'
  ) {
    return 'warehouse';
  }
  return 'network';
}

function SectionLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="text-xs font-normal text-primary hover:underline">
      {label}
    </Link>
  );
}

/** Network-wide supply-chain lists (always, including warehouse scope). */
function SupplyChainReadonlySections({
  skuCode,
  skuId,
}: {
  skuCode: string;
  skuId: string;
}) {
  const pools = useQuery({
    queryKey: ['sku-cockpit-pools', skuId],
    queryFn: () => api.getSupplyLots({ skuId, page: 1, pageSize: 20 }),
    enabled: Boolean(skuId),
  });
  const purchases = useQuery({
    queryKey: ['sku-cockpit-purchases', skuCode],
    queryFn: () => api.getPurchaseTracking({ q: skuCode, page: 1, pageSize: 20 }),
    enabled: Boolean(skuCode),
  });
  const shipments = useQuery({
    queryKey: ['sku-cockpit-shipments', skuId],
    queryFn: () => api.getShipments({ skuId, page: 1, pageSize: 20 }),
    enabled: Boolean(skuId),
  });

  const poolRows = pools.data?.items ?? [];
  const purchaseRows = (purchases.data?.items ?? []).filter(
    (row) => row.skuCode === skuCode && !CLOSED_PURCHASE_STATUSES.has(row.status),
  );
  const shipmentRows = shipments.data?.items ?? [];

  const q = encodeURIComponent(skuCode);

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">开放批次</CardTitle>
          <SectionLink to={`/inventory/pools?q=${q}`} label="查看全部" />
        </CardHeader>
        <CardContent>
          {pools.isLoading ? (
            <p className="text-sm text-text-sub">加载开放批次…</p>
          ) : pools.isError ? (
            <p className="text-sm text-red-600">开放批次加载失败</p>
          ) : poolRows.length === 0 ? (
            <p className="text-sm text-text-sub">暂无开放批次</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-1.5 pr-2">池</th>
                  <th className="py-1.5 pr-2">仓</th>
                  <th className="py-1.5 pr-2">数量</th>
                  <th className="py-1.5 pr-2">可用日</th>
                </tr>
              </thead>
              <tbody>
                {poolRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">{POOL_LABEL[row.pool] ?? row.pool}</td>
                    <td className="py-1.5 pr-2 font-mono">{row.warehouseCode}</td>
                    <td className="py-1.5 pr-2 font-mono">{row.qty}</td>
                    <td className="py-1.5 pr-2 font-mono">
                      {row.dateUnknown || !row.availableAt ? '—' : row.availableAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">未结跟单</CardTitle>
          <SectionLink to={`/pmc/tracking?q=${q}`} label="查看全部" />
        </CardHeader>
        <CardContent>
          {purchases.isLoading ? (
            <p className="text-sm text-text-sub">加载采购跟单…</p>
          ) : purchases.isError ? (
            <p className="text-sm text-red-600">采购跟单加载失败</p>
          ) : purchaseRows.length === 0 ? (
            <p className="text-sm text-text-sub">暂无未结跟单</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-1.5 pr-2">单号</th>
                  <th className="py-1.5 pr-2">数量</th>
                  <th className="py-1.5 pr-2">ETA</th>
                </tr>
              </thead>
              <tbody>
                {purchaseRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-mono">{row.draftNo}</td>
                    <td className="py-1.5 pr-2 font-mono">
                      {row.remainingQty}/{row.qty}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">
                      {row.etaAvailable ?? row.confirmedDeliveryDate ?? row.expectedDate ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">发运</CardTitle>
          <SectionLink to={`/pmc/shipments?q=${q}`} label="查看全部" />
        </CardHeader>
        <CardContent>
          {shipments.isLoading ? (
            <p className="text-sm text-text-sub">加载发运…</p>
          ) : shipments.isError ? (
            <p className="text-sm text-red-600">发运加载失败</p>
          ) : shipmentRows.length === 0 ? (
            <p className="text-sm text-text-sub">暂无发运</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-1.5 pr-2">单号</th>
                  <th className="py-1.5 pr-2">状态</th>
                  <th className="py-1.5 pr-2">ETA</th>
                </tr>
              </thead>
              <tbody>
                {shipmentRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-mono">{row.shipmentNo}</td>
                    <td className="py-1.5 pr-2">
                      {SHIPMENT_STATUS_LABEL[row.status] ?? row.status}
                    </td>
                    <td className="py-1.5 pr-2 font-mono">{row.etaAvailable ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SkuInventoryPlanningPage() {
  const { skuId = '' } = useParams<{ skuId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseParam = searchParams.get('warehouse')?.trim() || undefined;
  const scopeParam = searchParams.get('scope')?.trim().toLowerCase() || undefined;
  const scope = resolveClientPlanningScope(scopeParam, warehouseParam);
  const warehouseCode = scope === 'warehouse' ? warehouseParam : undefined;

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: api.getWarehouses,
  });
  const planning = useQuery({
    queryKey: ['inventory-planning', skuId, scope, warehouseCode],
    queryFn: () =>
      api.getSkuPlanning(skuId, {
        scope,
        warehouseCode:
          scope === 'warehouse'
            ? warehouseCode ?? warehouses.data?.[0]?.code
            : undefined,
      }),
    enabled: Boolean(skuId) && (scope === 'network' || Boolean(warehouseCode || warehouses.data?.[0]?.code)),
  });

  const setScope = (next: 'network' | 'warehouse') => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'network') {
      nextParams.set('scope', 'network');
      nextParams.delete('warehouse');
    } else {
      nextParams.set('scope', 'warehouse');
      if (!nextParams.get('warehouse')) {
        const fallback =
          warehouses.data?.find((w) => w.code !== 'OVERSEAS' && w.code !== 'IN-PRODUCTION')
            ?.code ?? warehouses.data?.[0]?.code;
        if (fallback) nextParams.set('warehouse', fallback);
      }
    }
    setSearchParams(nextParams);
  };

  if (planning.isLoading || (scope === 'warehouse' && warehouses.isLoading && !warehouseCode)) {
    return <p className="text-text-sub">加载库存规划中...</p>;
  }
  if (planning.isError || !planning.data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-red-600">
          {planning.error instanceof Error ? planning.error.message : '库存规划加载失败'}
        </CardContent>
      </Card>
    );
  }

  const item = planning.data as PlanningView;
  const isNetwork = item.scope === 'network';
  const showStockoutAdjustedNote =
    item.demandSource === 'historical' && item.stockoutAdjusted === true;
  const coverageLabel = Number.isFinite(item.coverageDays)
    ? `${item.coverageDays} 天`
    : '无消耗';
  const stockoutLabel =
    item.timeline?.stockoutDateConfirmed ??
    item.timeline?.stockoutDateExpected ??
    item.stockoutDateEstimate ??
    '暂无';

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            SKU 库存规划 · {item.skuCode}
            {item.isAccessory ? (
              <span className="ml-2 rounded bg-muted px-2 py-0.5 text-sm font-normal text-text-sub">
                配件
              </span>
            ) : null}
          </>
        }
      >
        <Link
          to={`/pmc/suggestions?sku=${encodeURIComponent(item.skuCode)}`}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text-main hover:bg-muted"
        >
          返回补货建议
        </Link>
      </PageHeader>

      {/* 决策条：Scope → 健康灯 → 关键指标 → 需求口径 */}
      <Card className="shadow-card">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <ScopeToggle scope={isNetwork ? 'network' : 'warehouse'} onChange={setScope} />
            {!isNetwork ? (
              <>
                <label className="text-sm text-text-sub" htmlFor="planning-warehouse">
                  目标仓
                </label>
                <select
                  id="planning-warehouse"
                  className="h-10 rounded-md border border-border bg-white px-3 font-mono text-sm"
                  value={item.warehouseCode}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('scope', 'warehouse');
                    next.set('warehouse', event.target.value);
                    setSearchParams(next);
                  }}
                >
                  {(warehouses.data ?? [])
                    .filter(
                      (warehouse) =>
                        warehouse.code !== 'OVERSEAS' &&
                        warehouse.code !== 'IN-PRODUCTION' &&
                        warehouse.code !== 'ALL',
                    )
                    .map((warehouse) => (
                      <option key={warehouse.code} value={warehouse.code}>
                        {warehouse.code} · {warehouse.name}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <span className="text-sm text-text-sub">全网络需求（warehouse=ALL）</span>
            )}
            <InventoryHealthBadge health={item.healthStatus} />
            {item.coverageHealthStatus && item.coverageHealthStatus !== item.healthStatus ? (
              <span className="text-xs text-text-hint">
                覆盖天数灯（影子）：{item.coverageHealthStatus}
              </span>
            ) : null}
            {item.needsManualConfirm ? (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                需人工确认
                {item.demandGateFlags?.length ? `（${item.demandGateFlags.join(', ')}）` : ''}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-6 border-t border-border/60 pt-4">
            <DecisionMetric label="有效供给" value={item.position.effectiveQty} />
            <DecisionMetric label="覆盖天数" value={coverageLabel} />
            <DecisionMetric label="建议补货量" value={item.suggestedQty} />
            <DecisionMetric label="断货日" value={stockoutLabel} />
            <DecisionMetric label="日均需求" value={item.avgDaily.toFixed(2)} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-text-sub">
            <span>
              需求口径：{item.demandSource === 'forecast' ? '已发布销售预测' : '历史销量回退'}
              {item.planningDemandSource ? (
                <span className="ml-2">
                  时间轴需求：
                  {item.planningDemandSource === 'demand_plan' ? '需求计划' : '销售预测'}
                </span>
              ) : null}
              {showStockoutAdjustedNote && (
                <span className="ml-2 text-text-hint">· 日需求已按有库存天数修正</span>
              )}
            </span>
            {item.championStockoutDateConfirmed ? (
              <span>若用预测缺货日：{item.championStockoutDateConfirmed}</span>
            ) : null}
            {item.confirmedCoverageDays != null ? (
              <span className="text-xs text-text-hint">
                确定线{' '}
                {Number.isFinite(item.confirmedCoverageDays)
                  ? `${Number(item.confirmedCoverageDays).toFixed(1)} 天`
                  : '∞'}
                · 安全库存 {item.safetyStockDays} 天
                {item.suggestedQtyGross != null && item.suggestedQtyGross !== item.suggestedQty
                  ? ` · 毛缺口 ${item.suggestedQtyGross}`
                  : ''}
                {item.suggestedDate ? ` · 建议下单 ${item.suggestedDate}` : ''}
              </span>
            ) : (
              <span className="text-xs text-text-hint">
                安全库存 {item.safetyStockDays} 天
                {item.suggestedDate ? ` · 建议下单 ${item.suggestedDate}` : ''}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {!isNetwork && item.allocation?.method === 'unallocated' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          飞书无销售占比，库存记在 OVERSEAS，本仓确定线与 7/15/30 不可用。
        </p>
      ) : null}
      {(item.unallocatedNetworkQty ?? 0) > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          出货前未定仓 {item.unallocatedNetworkQty} 件（在产 + 海外合计），发运单确定目的仓后计入各仓确定线。
          <Link className="ml-2 underline" to={`/inventory/unallocated?skuId=${encodeURIComponent(item.skuId)}`}>
            去待分配
          </Link>
        </p>
      ) : null}
      {!isNetwork && item.allocation?.method === 'sales_share' ? (
        <p className="text-sm text-text-hint">
          按近半年销售占比拆自海外合计；快照日 {item.allocation.snapshotDate ?? '未知'}。
          {item.allocation.shareSumWarning
            ? '占比合计未接近 100%，已按相对权重拆分。'
            : null}
        </p>
      ) : null}
      {!isNetwork && (item.allocation?.undatedTransitQty ?? 0) > 0 ? (
        <p className="text-sm text-text-hint">
          {item.allocation?.undatedTransitQty} 件在途无可用日，未计入时间轴。
        </p>
      ) : null}

      {isNetwork && item.supplyPools ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="在产（local）" value={item.supplyPools.localQty} hint="IN-PRODUCTION 池" />
          <MetricCard
            label="调拨在途"
            value={item.supplyPools.inTransitQty}
            hint="各仓 + 未定仓在途"
          />
          <MetricCard
            label="海外未定仓"
            value={item.supplyPools.overseasQty}
            hint="OVERSEAS 池"
          />
          <MetricCard
            label="无可用日"
            value={item.supplyPools.dateUnknownQty}
            hint="不进时间轴确定线"
          />
        </div>
      ) : null}

      {item.demandUnconstrainedDaily != null ? (
        <p className="text-sm text-text-hint">
          还原近窗日均 {item.demandUnconstrainedDaily.toFixed(2)}
          {item.demandStockoutDays != null ? ` · 疑似缺货约 ${item.demandStockoutDays} 天` : ''}
          {item.demandCapped ? ' · 已打 1.5 倍封顶' : ''}
        </p>
      ) : null}

      {item.latePoActions && item.latePoActions.length > 0 ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>新单来不及时的可选动作（只读）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {item.latePoActions.map((action) => (
              <div key={`${action.kind}-${action.label}`} className="rounded-md border border-border p-3">
                <p className="font-medium text-text-main">{action.label}</p>
                <p className="mt-1 text-text-sub">{action.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {item.timeline?.points?.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="确定缺货日"
            value={item.timeline.stockoutDateConfirmed ?? '暂无'}
          />
          <MetricCard
            label="破安全库存日"
            value={item.timeline.safetyBreachDateConfirmed ?? '暂无'}
          />
          <MetricCard label="最晚下单日" value={item.timeline.reorderDate ?? '暂无'} />
          <MetricCard
            label="交期地平线预计余额"
            value={leadHorizonExpectedEnding(item)}
            hint={`交期 ${item.leadTime.totalLeadDays} 天`}
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{isNetwork ? '网络库存位置（汇总）' : '库存位置拆分'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              {POSITION_ROWS.map(([key, label, operator]) => (
                <div key={key} className="flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-text-sub">{operator} {label}</span>
                  <span className="font-mono text-text-main">{item.position[key]}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 font-semibold">
                <span>有效供给</span>
                <span className="font-mono text-primary">{item.position.effectiveQty}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>
              {isNetwork ? '供应链提前期（出货前生产段）' : '供应链提前期'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              {LEAD_TIME_ROWS.map(([key, label]) => (
                <div key={key} className="rounded-md bg-bg-layout p-3">
                  <p className="text-text-sub">{label}</p>
                  <p className="mt-1 font-mono text-lg text-text-main">{item.leadTime[key]} 天</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-text-sub">
                {item.leadTime.profileId ? '已匹配交期 Profile' : '使用分层默认值'}
              </span>
              <strong className="font-mono text-primary">合计 {item.leadTime.totalLeadDays} 天</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {isNetwork && item.warehouses && item.warehouses.length > 0 ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>分仓一览（下钻）</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-2">仓码</th>
                  <th className="py-2 pr-2">健康灯</th>
                  <th className="py-2 pr-2">有效供给</th>
                  <th className="py-2 pr-2">最近到货</th>
                  <th className="py-2 pr-2">缺货日</th>
                  <th className="py-2 pr-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {item.warehouses.map((row) => (
                  <tr key={row.warehouseCode} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-mono">{row.warehouseCode}</td>
                    <td className="py-2 pr-2">
                      <InventoryHealthBadge health={row.healthStatus} />
                    </td>
                    <td className="py-2 pr-2 font-mono">{row.effectiveQty}</td>
                    <td className="py-2 pr-2 font-mono">
                      {row.nearestAvailableAt ?? '—'}
                    </td>
                    <td className="py-2 pr-2 font-mono">
                      {row.stockoutDateConfirmed ?? '—'}
                    </td>
                    <td className="py-2 pr-2">
                      <Link
                        className="text-primary hover:underline"
                        to={`/inventory/planning/${item.skuId}?scope=warehouse&warehouse=${encodeURIComponent(row.warehouseCode)}`}
                      >
                        分仓时间轴
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-text-hint">
              点击仓行进入该仓确定线。未定仓件数请在迅捷/飞书源修正目的仓，本系统不写落仓分配。
            </p>
          </CardContent>
        </Card>
      ) : null}

      <SupplyChainReadonlySections skuCode={item.skuCode} skuId={item.skuId} />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>
            {isNetwork ? '网络库存时间轴（未来可售投影）' : '库存时间轴（未来可售投影）'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TimelineTable item={item} />
        </CardContent>
      </Card>
    </div>
  );
}
