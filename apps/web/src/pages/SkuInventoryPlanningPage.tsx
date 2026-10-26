import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type ShipmentStatus, type SkuPlanningView } from '@/lib/api';
import {
  formatDemandGateFlags,
  formatHealthStatusLabel,
  formatPlanningWarehouseLabel,
  PLANNING_FIELD_TIPS,
  PLANNING_TERM_LEGEND,
} from '@/lib/inventory-planning-glossary';
import { POOL_DISPLAY_LABEL } from '@/lib/inventory-pool-labels';

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
  ['qtyInTransit', '在途', '+'],
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

const POOL_LABEL = POOL_DISPLAY_LABEL;

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

const FIELD_TIPS = PLANNING_FIELD_TIPS;

function FieldTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="cursor-help border-b border-dotted border-text-sub/50" title={tip}>
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tip,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tip: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-text-sub">
          <FieldTip label={label} tip={tip} />
        </p>
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
            <th className="py-2 pr-2">
              <FieldTip label="确定余额" tip={FIELD_TIPS.confirmedEnding} />
            </th>
            <th className="py-2 pr-2">
              <FieldTip label="预计余额" tip={FIELD_TIPS.expectedEnding} />
            </th>
            <th className="py-2 pr-2">
              <FieldTip label="累计需求" tip={FIELD_TIPS.cumulativeDemand} />
            </th>
            <th className="py-2 pr-2">
              <FieldTip label="管道" tip={FIELD_TIPS.plannedInbound} />
            </th>
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
      <p className="text-xs leading-relaxed text-text-hint">
        {item.scope === 'network'
          ? '数据源：三池开放批次里已到可用日的「确定档」。未完工的在产逻辑仓只在开放批次展示，不进确定线。交期只用生产天数。'
          : '数据源：该仓三池批次。确定线=海外可售+真实预计到仓日的在途；预计线=已达出货交期的未发；计划线（在产/估期）不填近窗、不挡建议量。'}
      </p>
    </>
  );
}

function DecisionMetric({
  label,
  value,
  tip,
}: {
  label: string;
  value: string | number;
  tip: string;
}) {
  return (
    <div className="min-w-[5.5rem]">
      <p className="text-xs text-text-sub">
        <FieldTip label={label} tip={tip} />
      </p>
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
  warehouseLabel,
}: {
  skuCode: string;
  skuId: string;
  warehouseLabel: (code: string) => string;
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
          <p className="mb-3 text-xs leading-relaxed text-text-hint">
            数据源：三池开放批次（跟单、发运、飞书库存周转残差）。可用日是预计海外可售日：在库用周转快照日，在途用发运/跟单预计可售日或飞书「最早在途上架时间」，未发用飞书「采购单最早上架时间」。生产未完成的日期不进入上方时间轴。
          </p>
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
                  <th className="py-1.5 pr-2">
                    <FieldTip label="可用日" tip={FIELD_TIPS.availableAt} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {poolRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-2">{POOL_LABEL[row.pool] ?? row.pool}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">
                      {warehouseLabel(row.warehouseCode)}
                    </td>
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
                  <th className="py-1.5 pr-2">预计可售日</th>
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
                  <th className="py-1.5 pr-2">预计可售日</th>
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

  const warehouseNameByCode = useMemo(
    () => new Map((warehouses.data ?? []).map((w) => [w.code, w.name])),
    [warehouses.data],
  );
  const labelWarehouse = (code: string) =>
    formatPlanningWarehouseLabel(code, warehouseNameByCode.get(code));

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

      <details className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-text-sub shadow-card">
        <summary className="cursor-pointer text-sm font-medium text-text-main">英文术语对照</summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {PLANNING_TERM_LEGEND.map((row) => (
            <div key={row.term}>
              <dt className="font-mono text-text-main">{row.term}</dt>
              <dd className="mt-0.5 leading-relaxed">{row.meaning}</dd>
            </div>
          ))}
        </dl>
      </details>

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
              <span className="text-sm text-text-sub">全网络需求（汇总仓码 ALL）</span>
            )}
            <InventoryHealthBadge health={item.healthStatus} />
            {item.coverageHealthStatus && item.coverageHealthStatus !== item.healthStatus ? (
              <span className="text-xs text-text-hint">
                覆盖天数灯（对照，不驱动下单）：
                {formatHealthStatusLabel(item.coverageHealthStatus)}
              </span>
            ) : null}
            {item.needsManualConfirm ? (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                需人工确认
                {item.demandGateFlags?.length
                  ? `（${formatDemandGateFlags(item.demandGateFlags)}）`
                  : ''}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-6 border-t border-border/60 pt-4">
            <DecisionMetric label="有效供给" value={item.position.effectiveQty} tip={FIELD_TIPS.effectiveQty} />
            <DecisionMetric label="覆盖天数" value={coverageLabel} tip={FIELD_TIPS.coverageDays} />
            <DecisionMetric label="建议补货量" value={item.suggestedQty} tip={FIELD_TIPS.suggestedQty} />
            <DecisionMetric label="断货日" value={stockoutLabel} tip={FIELD_TIPS.stockoutDate} />
            <DecisionMetric label="日均需求" value={item.avgDaily.toFixed(2)} tip={FIELD_TIPS.avgDaily} />
          </div>
          <p className="text-xs leading-relaxed text-text-hint">
            有效供给来自飞书「库存周转」日快照；断货日、覆盖天数、建议量来自时间轴（三池里已入档的批次，不含未完工在产）。日均需求来自需求计划或已发布预测。带虚线的名称可悬停看算法。
          </p>

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
              <span>对照用销售预测缺货日：{item.championStockoutDateConfirmed}</span>
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
          飞书无销售占比，库存记在「海外未定仓合计 OVERSEAS」，本仓确定线与 7/15/30 天预警不可用。
        </p>
      ) : null}
      {(item.unallocatedNetworkQty ?? 0) > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          出货前未定仓 {item.unallocatedNetworkQty} 件（在产 + 海外合计），发运单确定目的仓后计入各仓确定线。
          <Link className="ml-2 underline" to={`/inventory/pools?tab=unallocated&skuId=${encodeURIComponent(item.skuId)}`}>
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
          <MetricCard
            label="未发"
            value={item.supplyPools.localQty}
            hint="数据源：三池未发批次，含在产逻辑仓，不计入有效供给"
            tip={FIELD_TIPS.localQty}
          />
          <MetricCard
            label="在途"
            value={item.supplyPools.inTransitQty}
            hint="数据源：三池在途批次（各仓 + 未定仓）"
            tip={FIELD_TIPS.inTransitQty}
          />
          <MetricCard
            label="在库"
            value={item.supplyPools.overseasQty}
            hint="数据源：三池在库批次"
            tip={FIELD_TIPS.overseasQty}
          />
          <MetricCard
            label="无可用日"
            value={item.supplyPools.dateUnknownQty}
            hint="数据源：开放批次中没有可用日的数量，不进时间轴"
            tip={FIELD_TIPS.dateUnknownQty}
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
            hint="数据源：时间轴确定线（海外可售 + 真实预计到仓日的在途）"
            tip={FIELD_TIPS.stockoutDate}
          />
          <MetricCard
            label="破安全库存日"
            value={item.timeline.safetyBreachDateConfirmed ?? '暂无'}
            hint="数据源：时间轴确定余额首次低于安全库存"
            tip={FIELD_TIPS.safetyBreach}
          />
          <MetricCard
            label="最晚下单日"
            value={item.timeline.reorderDate ?? '暂无'}
            hint="数据源：预计缺货日 − 总交期"
            tip={FIELD_TIPS.reorderDate}
          />
          <MetricCard
            label="交期地平线预计余额"
            value={leadHorizonExpectedEnding(item)}
            hint={`数据源：时间轴交期节点预计余额 · 交期 ${item.leadTime.totalLeadDays} 天`}
            tip={FIELD_TIPS.leadHorizonBalance}
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>{isNetwork ? '网络库存位置（汇总）' : '库存位置拆分'}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs leading-relaxed text-text-hint">
              {isNetwork
                ? '数据源：飞书「库存周转」日快照。可售来自各物理仓；生产中、在途改用三池批次合计。底部有效供给只加各物理仓头寸，不含在产逻辑仓。'
                : '数据源：飞书「库存周转」该仓最新快照。本仓没有可售/在途时，按销售占比拆海外未定仓合计。不叠加采购跟单。'}
            </p>
            <div className="space-y-3 text-sm">
              {POSITION_ROWS.map(([key, label, operator]) => (
                <div key={key} className="flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-text-sub">{operator} {label}</span>
                  <span className="font-mono text-text-main">{item.position[key]}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 font-semibold">
                <span>
                  <FieldTip label="有效供给" tip={FIELD_TIPS.effectiveQty} />
                </span>
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
                {isNetwork
                  ? '数据源：供应商/SKU 生产交期，网络视图只计生产天数'
                  : item.leadTime.profileId
                    ? '数据源：已匹配交期模板（生产/国内/订舱/海运/清关/入仓六段相加）'
                    : '数据源：分层默认交期'}
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
                  <th className="py-2 pr-2">
                    <FieldTip label="健康灯" tip={FIELD_TIPS.warehouseHealth} />
                  </th>
                  <th className="py-2 pr-2">
                    <FieldTip label="有效供给" tip={FIELD_TIPS.warehouseEffective} />
                  </th>
                  <th className="py-2 pr-2">
                    <FieldTip label="最近到货" tip={FIELD_TIPS.nearestArrival} />
                  </th>
                  <th className="py-2 pr-2">
                    <FieldTip label="缺货日" tip={FIELD_TIPS.warehouseStockout} />
                  </th>
                  <th className="py-2 pr-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {item.warehouses.map((row) => (
                  <tr key={row.warehouseCode} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-mono text-xs">{labelWarehouse(row.warehouseCode)}</td>
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
            <p className="mt-3 text-xs leading-relaxed text-text-hint">
              有效供给来自飞书「库存周转」日快照（本仓有量用本仓，否则按销售占比拆海外未定仓合计），不含在产逻辑仓 IN-PRODUCTION。
              最近到货来自三池开放批次里该物理仓的下一笔可用日。
              缺货日本表未按仓计算，固定为「—」；网络确定缺货日见上方四格，单仓缺货日请点「分仓时间轴」。
              健康灯来自每日流水线快照，不是本页重算。
            </p>
          </CardContent>
        </Card>
      ) : null}

      <SupplyChainReadonlySections
        skuCode={item.skuCode}
        skuId={item.skuId}
        warehouseLabel={labelWarehouse}
      />

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
