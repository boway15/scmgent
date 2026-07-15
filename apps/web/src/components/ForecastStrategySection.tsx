import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ListPagination';
import {
  FORECAST_HORIZON_FUTURE_MONTH_OPTIONS,
  MAX_FORECAST_MONTH_COUNT,
} from '@/lib/forecast-horizon-meta';
import { formatForecastVersionTitle } from '@/lib/forecast-version-utils';

type SectionTab = 'strategy' | 'trends';
type TrendType = 'category' | 'project_group';
type TrendView = 'future' | 'history' | 'detail';

const SECTION_TAB_LABEL: Record<SectionTab, string> = {
  strategy: '算法口径',
  trends: '品类趋势系数',
};

const TREND_TYPE_LABEL: Record<TrendType, string> = {
  category: '类目',
  project_group: '项目组',
};

const formatFactor = (value: number) => value.toFixed(2);
const mutationErrorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败');

const LIST_PAGE_SIZE = 15;

type Props = {
  active: boolean;
};

const ALL_CATEGORY_V41_TIERS = [
  ['T1', '核心稳定高销量', 'A/C: AMAZON d6≥20；B: AMAZON d6≥18；近6月全动销、近2月连续动销、cv6≤0.65~0.70', '0.15*d2 + 0.55*d6 + 0.30*d12，再做趋势/月份/保守系数与上下限截断', '核心 KPI：WMAPE≤20%，Bias±10%'],
  ['T2', '核心高销量', 'A/U: d6门槛更高；B/C: AMAZON d6≥8~10；active6≥5、active2=2、cv6≤0.80~0.90', '0.25*d3 + 0.55*d6 + 0.20*d12，再做趋势/月份/保守系数与上下限截断', '核心 KPI：WMAPE≤25%，Bias±10%'],
  ['T3', '中高销量稳定层', 'A/B/C: AMAZON 中等销量且连续动销；cv6≤0.95~1.05；用于扩大覆盖但不牺牲核心准确率', '0.35*d3 + 0.50*d6 + 0.15*d12，再做趋势/月份/保守系数与上下限截断', '主预测 KPI：WMAPE≤35%，Bias±15%'],
  ['T3P', '非 AMAZON 优质稳定层', '仅 B/C 的 UNKNOWN/WALMART/TEMU/TIKTOK，要求 d6≥6~8、active6=6、active2=2、cv6≤0.50~0.55', '0.45*d3 + 0.45*d6 + 0.10*d12，非核心渠道更偏近3/6月', '主预测 KPI：WMAPE≤35%，Bias±15%'],
  ['T4A', 'AMAZON 边界可预测层', 'A/B/C: 仅 AMAZON，销量较低但仍有连续性；V4.1 对 B/C 要求 active2=2；D 仅极少稳定品可进 T4A', '0.50*d3 + 0.45*d6 + 0.05*d12，低置信并设置更宽 P10/P90', '边界 KPI：WMAPE≤40%，Bias±20%'],
  ['T4B', '稳定连续保底层', '未进 T1–T4A：长历史 active12≥8；新品/短历史近2月连续有销且 active6≥2', '长历史 0.35*d3+0.45*d6+0.20*d12；短历史 0.55*d3+0.45*d6', '保底 KPI：WMAPE≤50%，不计入主准确率'],
  ['T99', '异常/低规律/不预测层', '连续性不足、cv 过高或近端断销；系统不做点预测', '系统预测写入 0.00，待 AI 辅助或人工校准后更新', '不计入主准确率统计'],
] as const;

function AllCategoryV41StrategySummary() {
  const { data: versions } = useQuery({
    queryKey: ['sales-forecast-versions', 'draft'],
    queryFn: () => api.getSalesForecastVersions({ status: 'draft' }),
  });
  const latestDraft = versions?.[0];

  return (
    <div className="mb-6 space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      <div>
        <h3 className="text-base font-semibold text-text-main">当前生效策略：全品类 V4.1 分层 KPI + T4B 保底 + T99 不预测</h3>
        <p className="mt-1 leading-relaxed text-text-sub">
          运行时默认 <span className="font-medium text-text-main">FORECAST_ALGO_MODE=allcat_v41</span>。
          T1–T4A 按 d2/d3/d6/d12 加权生成系统预测；T4B 对连续有销但未达主层门槛的 SKU 给出保守保底预测；T99 写入 0.00 待校准。
          选择「全平台」生成时，按 V4.1 支持渠道分别写入预测行，列表查询 ALL 为分渠道汇总，不写入 platform=ALL 物理行。销量导入无站点维度，预测统一 station=ALL（全站合并）。
          模型标识 <span className="font-medium text-text-main">allcat_kpi_corefirst_v41</span>。
          {latestDraft ? (
            <>
              {' '}
              当前最新草稿版本{' '}
              <span className="font-medium text-text-main">
                {formatForecastVersionTitle(latestDraft.versionNo, latestDraft.versionName)}
              </span>
              。
            </>
          ) : (
            <span> 生成预测后将写入新的草稿版本。</span>
          )}
        </p>
      </div>

      <div className="rounded-md border border-border bg-background p-3">
        <p className="font-medium text-text-main">T99 与 Dify 单条辅助预测</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
          <li>T99：波动大、连续性不足或近端断销 — 系统不做点预测；T4B 连续有销 SKU 由系统直接给保守保底数。</li>
          <li>版本详情 → 复核与发布：矩阵中 T99 行显示 0.00，点击 SKU 可触发 Dify 工作流或人工校准，入参含近 24 月销、品类趋势、预测周期。</li>
          <li>LLM 输出写入草稿版 sales_forecast_monthly（source=dify），可在 SKU 抽屉查看 rationale 并手工校准。</li>
          <li>SKU 抽屉提供三种辅助：<strong>AI 自动</strong>（直调 Dify）、<strong>AI+人工</strong>（外生因素：调价/投广告等）、<strong>系统运算</strong>（单 SKU 本地算法重算）。</li>
          <li>工作流 DSL：<code className="text-xs">docs/dify/workflows/single-sku-forecast.yml</code></li>
        </ul>
      </div>

      <div className="rounded-md border border-border bg-background p-3">
        <p className="font-medium text-text-main">品类趋势系数（保守口径，供 Dify / legacy 辅助）</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
          <li>季节：近 6 月品类月均 ÷ 去年同 6 月均值（样本月≥2，月销门槛）。</li>
          <li>趋势：近 3 月均 ÷ 前 3 月均（非单月 MoM，降低噪声）。</li>
          <li>综合 clip [0.85, 1.15]；超出区间则不应用（系数=1）。</li>
          <li>Rebuild 前对 SKU 月销做大促/缺货清洗后再聚合到品类。</li>
        </ul>
      </div>

      <div className="rounded-md border border-border bg-background p-3">
        <p className="font-medium text-text-main">指标定义：active / CV</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
          <li>
            <span className="font-medium text-text-main">activeN</span>
            （如 active2 / active6 / active12）：目标月之前最近 N 个自然月中，月销量 qty_sold &gt; 0 的月份个数。例如 active2=2 表示近 2 月连续动销；active6≥5 表示近 6 月至少 5 个月有销。
          </li>
          <li>
            <span className="font-medium text-text-main">cv6（CV）</span>
            ：近 6 个月<strong>有销月份</strong>月销量的变异系数 = 样本标准差 ÷ 均值。有销月 ≥2 时按上式计算；仅 1 个有销月时 cv6=0；无有销月时取高值 9（视为不稳定）。数值越小越稳定，分层准入用 cv6≤阈值过滤波动过大的 SKU。
          </li>
        </ul>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-background p-3">
          <p className="font-medium text-text-main">走步与评估</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
            <li>每个预测月仅使用目标月之前历史（walk-forward）。</li>
            <li>准确率复盘 actual_daily_avg 仅用于事后评估，不进入预测公式。</li>
            <li>T4B / T99 不计入主准确率 KPI 统计。</li>
          </ul>
        </div>
        <div className="rounded-md border border-border bg-background p-3">
          <p className="font-medium text-text-main">V4.1 主算法</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
            <li>d2/d3/d6/d12 = 目标月前 2/3/6/12 个月折算日均。</li>
            <li>base_daily 按 T 层加权 → 趋势衰减（growth 用 recent30/90）→ 近端月渐减 → 层级保守系数 → 上下限 → 近端地板。</li>
          </ul>
        </div>
      </div>

      <div className="overflow-auto rounded-md border border-border bg-background">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 font-medium text-text-main">层级</th>
              <th className="px-3 py-2 font-medium text-text-main">定位</th>
              <th className="px-3 py-2 font-medium text-text-main">准入规则摘要</th>
              <th className="px-3 py-2 font-medium text-text-main">算法</th>
              <th className="px-3 py-2 font-medium text-text-main">KPI/统计</th>
            </tr>
          </thead>
          <tbody>
            {ALL_CATEGORY_V41_TIERS.map((row) => (
              <tr key={row[0]} className="border-b border-border/50 align-top">
                {row.map((cell, idx) => (
                  <td key={idx} className={idx === 0 ? 'whitespace-nowrap px-3 py-2 font-medium text-text-main' : 'px-3 py-2 text-text-sub'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export function ForecastStrategySection({ active }: Props) {
  const qc = useQueryClient();
  const [sectionTab, setSectionTab] = useState<SectionTab>('strategy');
  const [trendType, setTrendType] = useState<TrendType>('category');
  const [trendView, setTrendView] = useState<TrendView>('future');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [monthCount, setMonthCount] = useState(MAX_FORECAST_MONTH_COUNT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LIST_PAGE_SIZE);

  const rebuildTrends = useMutation({
    mutationFn: () => api.rebuildSalesForecastTrends(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-trends-horizon'] });
    },
  });

  const trendsActive = active && sectionTab === 'trends';

  const { data: horizon, isLoading } = useQuery({
    queryKey: ['sales-forecast-trends-horizon', trendType, appliedSearch, page, pageSize, monthCount, trendView],
    queryFn: () =>
      api.getSalesForecastTrendsHorizon({
        dimensionType: trendType,
        search: appliedSearch || undefined,
        page,
        pageSize,
        monthCount: trendView === 'history' ? undefined : monthCount,
        historyMonthCount: trendView === 'future' ? 0 : monthCount,
      }),
    enabled: trendsActive,
  });

  const applySearch = () => {
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['strategy', 'trends'] as SectionTab[]).map((t) => (
          <Button
            key={t}
            variant={sectionTab === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSectionTab(t)}
          >
            {SECTION_TAB_LABEL[t]}
          </Button>
        ))}
      </div>

      {sectionTab === 'strategy' && (
        <Card>
          <CardHeader>
            <CardTitle>预测策略（V4.1 + T99 + Dify）</CardTitle>
            <p className="text-sm text-text-sub">
              主预测为全品类 V4.1 分层 KPI；T99 走复核 + 可选 Dify LLM 单条预测。品类趋势系数见「品类趋势系数」Tab。
            </p>
          </CardHeader>
          <CardContent>
            <AllCategoryV41StrategySummary />
          </CardContent>
        </Card>
      )}

      {sectionTab === 'trends' && (
        <Card>
          <CardHeader>
            <CardTitle>品类趋势系数</CardTitle>
            <p className="text-sm text-text-sub">
              从 SKU 月表聚合品类/项目组销量，按保守公式计算季节×趋势系数（6 月季节窗、3v3 趋势、clip 0.85–1.15）。
              点击「从销量月表刷新」写入 sales_forecast_seasonality；Dify 单条预测与 legacy 模式会引用此数据。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {horizon?.sourceBatch && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-text-sub">
                最近汇总批次 {horizon.sourceBatch.batchNo} · 销量月表{' '}
                {horizon.sourceBatch.monthlyStartMonth ?? '-'} ~ {horizon.sourceBatch.monthlyEndMonth ?? '-'} · SKU{' '}
                {horizon.sourceBatch.skuCount?.toLocaleString() ?? '-'} · 更新于{' '}
                {new Date(horizon.sourceBatch.createdAt).toLocaleString()}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <select
                className="h-9 rounded-md border border-border bg-card px-3 text-sm"
                value={trendType}
                onChange={(e) => {
                  setTrendType(e.target.value as TrendType);
                  setPage(1);
                }}
              >
                <option value="category">{TREND_TYPE_LABEL.category}</option>
                <option value="project_group">{TREND_TYPE_LABEL.project_group}</option>
              </select>
              <Input
                className="h-9 w-48"
                placeholder="筛选维度名称"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              />
              <Button size="sm" variant="outline" onClick={applySearch}>
                筛选
              </Button>
              <select
                className="h-9 rounded-md border border-border bg-card px-3 text-sm"
                value={monthCount}
                onChange={(e) => {
                  setMonthCount(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[...FORECAST_HORIZON_FUTURE_MONTH_OPTIONS].map((n) => (
                  <option key={n} value={n}>
                    {trendView === 'future'
                      ? `未来 ${n} 个月`
                      : trendView === 'history'
                        ? `历史 ${n} 个月`
                        : `各 ${n} 个月`}
                  </option>
                ))}
              </select>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={trendView === 'future' ? 'default' : 'outline'}
                  onClick={() => setTrendView('future')}
                >
                  未来
                </Button>
                <Button
                  size="sm"
                  variant={trendView === 'history' ? 'default' : 'outline'}
                  onClick={() => setTrendView('history')}
                >
                  历史
                </Button>
                <Button
                  size="sm"
                  variant={trendView === 'detail' ? 'default' : 'outline'}
                  onClick={() => setTrendView('detail')}
                >
                  明细
                </Button>
              </div>
              <Button size="sm" variant="outline" disabled={rebuildTrends.isPending} onClick={() => rebuildTrends.mutate()}>
                {rebuildTrends.isPending ? '刷新中…' : '从销量月表刷新'}
              </Button>
            </div>

            {rebuildTrends.isSuccess && (
              <p className="text-sm text-text-sub">
                已写入 {rebuildTrends.data.factorCount.toLocaleString()} 条系数（来源{' '}
                {rebuildTrends.data.sourceMonthCount.toLocaleString()} 个月度汇总点）
              </p>
            )}
            {rebuildTrends.isError && (
              <p className="text-sm text-destructive">{mutationErrorMessage(rebuildTrends.error)}</p>
            )}

            {isLoading ? (
              <p className="text-text-sub">加载中…</p>
            ) : !horizon || horizon.total === 0 ? (
              <p className="text-sm text-text-sub">暂无趋势数据。请先在「销量历史」导入月表数据，再点击「从销量月表刷新」。</p>
            ) : trendView === 'future' ? (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="sticky left-0 z-10 bg-card p-2 font-normal">维度</th>
                      {(horizon.horizon ?? []).map((col) => (
                        <th key={col.monthLabel} className="p-2 font-normal whitespace-nowrap">
                          {col.monthLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {horizon.items.map((row) => (
                      <tr key={`${row.dimensionType}:${row.dimensionValue}`} className="border-b border-border/60">
                        <td className="sticky left-0 z-10 bg-card p-2 max-w-[200px] truncate" title={row.dimensionValue}>
                          {row.dimensionValue}
                        </td>
                        {row.months.map((cell) => (
                          <td
                            key={cell.monthLabel}
                            className={`p-2 font-numeric text-center ${cell.wasClipped ? 'text-amber-700 dark:text-amber-300' : ''}`}
                            title={`季节 ${formatFactor(cell.seasonalityFactor)} × 趋势 ${formatFactor(cell.trendFactor)}${cell.wasClipped ? '（已裁剪）' : ''}`}
                          >
                            {formatFactor(cell.combinedFactor)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : trendView === 'history' ? (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="sticky left-0 z-10 bg-card p-2 font-normal">维度</th>
                      {(horizon.historyHorizon ?? []).map((col) => (
                        <th key={col.monthLabel} className="p-2 font-normal whitespace-nowrap">
                          {col.monthLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {horizon.items.map((row) => (
                      <tr key={`hist-${row.dimensionType}:${row.dimensionValue}`} className="border-b border-border/60">
                        <td className="sticky left-0 z-10 bg-card p-2 max-w-[200px] truncate" title={row.dimensionValue}>
                          {row.dimensionValue}
                        </td>
                        {(row.historyMonths ?? []).map((cell) => (
                          <td
                            key={cell.monthLabel}
                            className={`p-2 font-numeric text-center ${cell.wasClipped ? 'text-amber-700 dark:text-amber-300' : ''}`}
                            title={`季节 ${formatFactor(cell.seasonalityFactor)} × 趋势 ${formatFactor(cell.trendFactor)}${cell.wasClipped ? '（已裁剪）' : ''}`}
                          >
                            {formatFactor(cell.combinedFactor)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="p-2 font-normal">时段</th>
                      <th className="p-2 font-normal">维度</th>
                      <th className="p-2 font-normal">绝对月</th>
                      <th className="p-2 font-normal">季节系数</th>
                      <th className="p-2 font-normal">趋势系数</th>
                      <th className="p-2 font-normal">综合系数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {horizon.items.flatMap((row) => [
                      ...(row.historyMonths ?? []).map((cell) => (
                        <tr key={`hist-${row.dimensionValue}-${cell.monthLabel}`} className="border-b border-border/60">
                          <td className="p-2 text-text-sub">历史</td>
                          <td className="p-2 max-w-[180px] truncate" title={row.dimensionValue}>
                            {row.dimensionValue}
                          </td>
                          <td className="p-2 font-numeric whitespace-nowrap">{cell.monthLabel}</td>
                          <td className="p-2 font-numeric">{formatFactor(cell.seasonalityFactor)}</td>
                          <td className="p-2 font-numeric">{formatFactor(cell.trendFactor)}</td>
                          <td
                            className={`p-2 font-numeric ${cell.wasClipped ? 'text-amber-700 dark:text-amber-300' : ''}`}
                          >
                            {formatFactor(cell.combinedFactor)}
                          </td>
                        </tr>
                      )),
                      ...row.months.map((cell) => (
                        <tr key={`fut-${row.dimensionValue}-${cell.monthLabel}`} className="border-b border-border/60">
                          <td className="p-2 text-text-sub">未来</td>
                          <td className="p-2 max-w-[180px] truncate" title={row.dimensionValue}>
                            {row.dimensionValue}
                          </td>
                          <td className="p-2 font-numeric whitespace-nowrap">{cell.monthLabel}</td>
                          <td className="p-2 font-numeric">{formatFactor(cell.seasonalityFactor)}</td>
                          <td className="p-2 font-numeric">{formatFactor(cell.trendFactor)}</td>
                          <td
                            className={`p-2 font-numeric ${cell.wasClipped ? 'text-amber-700 dark:text-amber-300' : ''}`}
                          >
                            {formatFactor(cell.combinedFactor)}
                          </td>
                        </tr>
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            )}

            {horizon && horizon.total > 0 && (
              <ListPagination
                page={page}
                pageSize={pageSize}
                total={horizon.total}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
