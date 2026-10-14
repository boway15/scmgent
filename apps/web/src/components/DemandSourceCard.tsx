import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatDateTimeCst } from '@/lib/utils';

/** 销量按月手动导入：上月数据在月末后约 10 天内应到位 */
const SALES_HISTORY_STALE_DAYS = 40;

function daysSince(dateOnly: string): number {
  const [y, m, d] = dateOnly.slice(0, 10).split('-').map(Number);
  const now = new Date();
  return Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86_400_000,
  );
}

export function DemandSourceCard() {
  const query = useQuery({
    queryKey: ['planning-demand-source'],
    queryFn: api.getPlanningDemandSource,
    staleTime: 60_000,
  });

  if (query.isLoading) return null;
  if (query.isError || !query.data) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-3 text-sm text-text-sub">补货口径加载失败</CardContent>
      </Card>
    );
  }

  const { publishedForecast, demandPlanAdoptions, latestHealth, salesHistoryMaxDate } = query.data;
  const latest = publishedForecast.latest;
  const totalRows = latestHealth.forecastRows + latestHealth.historicalRows;
  const rowHistoricalPct = totalRows > 0 ? (latestHealth.historicalRows / totalRows) * 100 : 0;
  const sellingHistoricalPct =
    latestHealth.sellingSkus > 0
      ? (latestHealth.sellingHistoricalSkus / latestHealth.sellingSkus) * 100
      : 0;
  const salesLagDays = salesHistoryMaxDate ? daysSince(salesHistoryMaxDate) : null;
  const salesStale = salesLagDays == null || salesLagDays > SALES_HISTORY_STALE_DAYS;

  return (
    <Card className="border-primary/20 bg-primary/5 shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">补货当前需求口径</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-text-sub">月度销售预测</p>
          {latest ? (
            <>
              <p className="mt-1 font-medium text-text-main">
                <Link to="/data/forecast" className="hover:underline">
                  {latest.versionName}
                </Link>
              </p>
              <p className="mt-1 text-xs text-text-sub">
                {latest.versionNo}
                {latest.station ? ` · ${latest.station}` : ''}
                {latest.startMonth ? ` · 起始 ${latest.startMonth}` : ''}
                {latest.publishedAt ? ` · 发布于 ${formatDateTimeCst(latest.publishedAt)}` : ''}
              </p>
              {publishedForecast.versionCount > 1 ? (
                <p className="mt-1 text-xs text-text-hint">
                  共 {publishedForecast.versionCount} 个已发布版本，按 SKU 取最新覆盖
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 font-medium text-primary">无已发布版本，补货全部按历史销量</p>
          )}
        </div>

        <div>
          <p className="text-text-sub">周计划采纳</p>
          {demandPlanAdoptions.length ? (
            <ul className="mt-1 space-y-0.5">
              {demandPlanAdoptions.map((row) => (
                <li key={`${row.projectGroup}::${row.warehouseCode}`} className="text-text-main">
                  <span className="font-medium">{row.projectGroup}</span>
                  <span className="text-text-sub"> × {row.warehouseCode}</span>
                  {row.versionName ? (
                    <span className="text-xs text-text-sub"> · {row.versionName}</span>
                  ) : null}
                </li>
              ))}
              <li className="text-xs text-text-hint">以上范围用周计划，其余用月度预测</li>
            </ul>
          ) : (
            <p className="mt-1 text-text-main">未采纳，全部使用月度预测</p>
          )}
        </div>

        <div>
          <p className="text-text-sub">最近一轮补货计算 · 动销 SKU</p>
          {totalRows > 0 ? (
            <>
              <p className="mt-1 text-text-main">
                预测 <span className="font-mono font-medium">{latestHealth.sellingForecastSkus}</span>
                {' · '}
                回退历史销量{' '}
                <span
                  className={
                    sellingHistoricalPct >= 10
                      ? 'font-mono font-medium text-primary'
                      : 'font-mono font-medium'
                  }
                >
                  {latestHealth.sellingHistoricalSkus}
                </span>
                <span className="text-xs text-text-sub">（{sellingHistoricalPct.toFixed(1)}%）</span>
              </p>
              <p className="mt-1 text-xs text-text-hint">
                动销 = 非配件、非停售，且销量截止日前 90 天有销量。全量 SKU×仓共{' '}
                {latestHealth.historicalRows} 行（{rowHistoricalPct.toFixed(0)}%）回退，其余多为休眠 / 停售 / 配件
              </p>
              {latestHealth.computedAt ? (
                <p className="mt-1 text-xs text-text-sub">
                  计算于 {formatDateTimeCst(latestHealth.computedAt)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-text-main">尚未运行补货计算</p>
          )}
        </div>

        <p className={`text-xs sm:col-span-3 ${salesStale ? 'text-primary' : 'text-text-sub'}`}>
          {salesHistoryMaxDate ? (
            <>
              销量历史截至 {salesHistoryMaxDate.slice(0, 10)}（{salesLagDays} 天前）
              {salesStale ? '，已超过一个导入周期，预测与历史口径的近期销量均偏低 · ' : ' · '}
            </>
          ) : (
            '暂无销量历史 · '
          )}
          <Link to="/data/sales?import=1" className="hover:underline">
            去导入销量
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
