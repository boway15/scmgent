import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

export function SkuInventoryPlanningPage() {
  const { skuId = '' } = useParams<{ skuId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseCode = searchParams.get('warehouse')?.trim() || undefined;

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: api.getWarehouses,
  });
  const planning = useQuery({
    queryKey: ['inventory-planning', skuId, warehouseCode],
    queryFn: () => api.getSkuPlanning(skuId, warehouseCode),
    enabled: Boolean(skuId),
  });

  if (planning.isLoading) return <p className="text-text-sub">加载库存规划中...</p>;
  if (planning.isError || !planning.data) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-red-600">
          {planning.error instanceof Error ? planning.error.message : '库存规划加载失败'}
        </CardContent>
      </Card>
    );
  }

  const item = planning.data;
  const coverageLabel = Number.isFinite(item.coverageDays)
    ? `${item.coverageDays} 天`
    : '无消耗';

  return (
    <div className="space-y-6">
      <PageHeader title={`SKU 库存规划 · ${item.skuCode}`}>
        <Link
          to={`/pmc/suggestions?sku=${encodeURIComponent(item.skuCode)}`}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm text-text-main hover:bg-muted"
        >
          返回补货建议
        </Link>
      </PageHeader>

      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <label className="text-sm text-text-sub" htmlFor="planning-warehouse">
            目标仓
          </label>
          <select
            id="planning-warehouse"
            className="h-10 rounded-md border border-border bg-white px-3 font-mono text-sm"
            value={item.warehouseCode}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set('warehouse', event.target.value);
              setSearchParams(next);
            }}
          >
            {(warehouses.data ?? []).map((warehouse) => (
              <option key={warehouse.code} value={warehouse.code}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
          <InventoryHealthBadge health={item.healthStatus} />
          <span className="text-sm text-text-sub">
            需求口径：{item.demandSource === 'forecast' ? '已发布销售预测' : '历史销量回退'}
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="有效供给" value={item.position.effectiveQty} hint="同健康灯库存位置口径" />
        <MetricCard label="日均需求" value={item.avgDaily.toFixed(2)} hint="件 / 天" />
        <MetricCard label="覆盖天数" value={coverageLabel} hint={`安全库存 ${item.safetyStockDays} 天`} />
        <MetricCard label="建议补货量" value={item.suggestedQty} hint={`建议下单 ${item.suggestedDate}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>库存位置拆分</CardTitle>
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
            <CardTitle>供应链提前期</CardTitle>
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

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>库存消耗与补给节点</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <p className="font-mono text-text-main">{item.etaAvailableNearest ?? '暂无跟单补给'}</p>
            </div>
            <div>
              <p className="text-text-sub">再订货点</p>
              <p className="font-mono text-text-main">{item.reorderPoint ?? '暂无'}</p>
            </div>
          </div>
          <p className="text-xs text-text-hint">
            简化说明：库存按日均需求持续消耗；到预计可售日时，开放跟单补给进入可售节点。预计断货日未做断货期销量修正。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
