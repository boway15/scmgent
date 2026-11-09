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
import {
  DEMAND_PLAN_HORIZON_WEEKS,
  DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE,
  formatDemandPlanVersionTitle,
} from '@/lib/demand-plan-utils';
import { formatForecastVersionTitle } from '@/lib/forecast-version-utils';
import { Link } from 'react-router-dom';

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

export type ForecastStrategyContext = 'monthly' | 'weekly';

type Props = {
  active: boolean;
  /** 月销量预测默认 monthly；周度销量预测传 weekly */
  context?: ForecastStrategyContext;
};

const ALL_CATEGORY_V41_TIERS = [
  ['T1', '核心稳定高销量', 'A/C: AMAZON d6≥20；B: AMAZON d6≥18；近6月全动销、近2月连续动销、cv6≤0.65~0.70', '0.15*d2 + 0.55*d6 + 0.30*d12，再做趋势/月份/保守系数与上下限截断', '核心 KPI：WMAPE≤20%，Bias±10%'],
  ['T2', '核心高销量', 'A/U: d6门槛更高；B/C: AMAZON d6≥8~10；active6≥5、active2=2、cv6≤0.80~0.90', '0.25*d3 + 0.55*d6 + 0.20*d12，再做趋势/月份/保守系数与上下限截断', '核心 KPI：WMAPE≤25%，Bias±10%'],
  ['T3', '中高销量稳定层', 'A/B/C: AMAZON 中等销量且连续动销；cv6≤0.95~1.05；用于扩大覆盖但不牺牲核心准确率', '0.35*d3 + 0.50*d6 + 0.15*d12，再做趋势/月份/保守系数与上下限截断', '主预测 KPI：WMAPE≤35%，Bias±15%'],
  ['T3P', '非 AMAZON 优质稳定层', '仅 B/C 的 UNKNOWN/WALMART/TEMU/TIKTOK，要求 d6≥6~8、active6=6、active2=2、cv6≤0.50~0.55', '0.45*d3 + 0.45*d6 + 0.10*d12，非核心平台更偏近3/6月', '主预测 KPI：WMAPE≤35%，Bias±15%'],
  ['T4A', 'AMAZON 边界可预测层', 'A/B/C: 仅 AMAZON，销量较低但仍有连续性；V4.1 对 B/C 要求 active2=2；D 仅极少稳定品可进 T4A', '0.50*d3 + 0.45*d6 + 0.05*d12，低置信并设置更宽 P10/P90', '边界 KPI：WMAPE≤40%，Bias±20%'],
  ['T4B', '稳定连续保底层', '未进 T1–T4A：长历史 active12≥8；新品/短历史近2月连续有销且 active6≥2', '长历史 0.35*d3+0.45*d6+0.20*d12；短历史 0.55*d3+0.45*d6', '保底 KPI：WMAPE≤50%，不计入主准确率'],
  ['T99', '异常/低规律保守保底层', '连续性不足、cv 过高或近端弱信号；近30≈0 时归零', '近端 max(近30,近90,d3)×1.0，远月×0.8×0.9；不进主 KPI', '不计入主准确率统计'],
] as const;

function WeeklyDemandPlanStrategyPreamble() {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4 text-sm">
      <div>
        <h3 className="text-base font-semibold text-text-main">每一周只做一次加法</h3>
        <p className="mt-1 leading-relaxed text-text-sub">
          未来 {DEMAND_PLAN_HORIZON_WEEKS} 周，每周给出一个「预测每天卖几件」。它由两个数相加，没有第三套周公式。第几周只决定这两个数各占多少。
        </p>
      </div>
      <table className="min-w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium text-text-main">两个数</th>
            <th className="py-2 pr-3 font-medium text-text-main">怎么来</th>
            <th className="py-2 font-medium text-text-main">会不会每周变</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/60 align-top">
            <td className="py-2 pr-3 font-medium text-text-main">最近每天</td>
            <td className="py-2 pr-3 text-text-sub">
              真实销量。60% 是近 14 天每天，40% 是近 30 天和近 90 天（近 90 天更重）。最远 90 天，截止业务日前 2 天。过大或过小，拉回到近 90 天每天的 0.4～2.5 倍。
            </td>
            <td className="py-2 text-text-sub">不变。一个 SKU 共用这一个数。</td>
          </tr>
          <tr className="align-top">
            <td className="py-2 pr-3 font-medium text-text-main">本周月预测</td>
            <td className="py-2 pr-3 text-text-sub">
              SKU 先定一个层，26 周不换。用该层算出未来 6 个月各自每天卖几件，再摊到这一周：7 天在哪个月就用哪个月，跨月按天数平均。层的公式在文末附录，和第几周无关。
            </td>
            <td className="py-2 text-text-sub">会变。淡季的周，这个数更小。</td>
          </tr>
        </tbody>
      </table>
      <div className="overflow-auto">
        <p className="mb-2 font-medium text-text-main">相加时，越往后月预测占得越多</p>
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-y border-border bg-muted/40">
              <th className="px-3 py-2 font-medium text-text-main">周</th>
              <th className="px-3 py-2 font-medium text-text-main">预测每天</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['第 1 周', '最近每天 × 70% + 本周月预测 × 30%'],
              ['第 2 周', '最近每天 × 倍数 × 50% + 本周月预测 × 50%'],
              ['第 3 周', '最近每天 × 倍数 × 30% + 本周月预测 × 70%'],
              ['第 4 周', '最近每天 × 倍数 × 15% + 本周月预测 × 85%'],
              ['第 5 周起', '就等于本周月预测'],
            ].map((row) => (
              <tr key={row[0]} className="border-b border-border/50 align-top">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-text-main">{row[0]}</td>
                <td className="px-3 py-2 text-text-sub">{row[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 leading-relaxed text-text-sub">
          倍数 = 本周月预测 ÷ 第 1 周月预测，最小 0.5、最大 2。第 1 周不用乘。它只让「最近每天」跟着月预测的淡旺走，避免淡季仍按最近高峰卖。
        </p>
      </div>
      <div className="overflow-auto rounded-md border border-border bg-card">
        <p className="border-b border-border px-3 py-2 font-medium text-text-main">代入一次</p>
        <p className="px-3 pt-2 text-text-sub">最近每天 11.2 件。第 1 周月预测 8 件，第 2 周月预测 6 件。</p>
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium text-text-main" />
              <th className="px-3 py-2 font-medium text-text-main">第 1 周</th>
              <th className="px-3 py-2 font-medium text-text-main">第 2 周</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['最近每天', '11.2', '11.2'],
              ['本周月预测', '8', '6'],
              ['倍数', '不用', '6 ÷ 8 = 0.75'],
              ['预测每天', '11.2×70% + 8×30% = 10.24', '11.2×0.75×50% + 6×50% = 7.20'],
            ].map((row) => (
              <tr key={row[0]} className="border-b border-border/50">
                {row.map((cell, index) => (
                  <td key={`${row[0]}-${index}`} className="px-3 py-2 text-text-sub">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-text-sub">第 5 周如果月预测是 5 件，预测每天就是 5 件。矩阵用的是这列结果。</p>
      </div>
    </div>
  );
}

function AllCategoryV41StrategySummary({ context }: { context: ForecastStrategyContext }) {
  const isWeekly = context === 'weekly';
  const { data: forecastDrafts } = useQuery({
    queryKey: ['sales-forecast-versions', 'draft'],
    queryFn: () => api.getSalesForecastVersions({ status: 'draft' }),
    enabled: !isWeekly,
  });
  const { data: demandPlanList } = useQuery({
    queryKey: ['demand-plan-versions', 'draft-strategy'],
    queryFn: () => api.listDemandPlanVersions({ pageSize: 50 }),
    enabled: isWeekly,
  });
  const latestForecastDraft = forecastDrafts?.[0];
  const latestDemandPlanDraft = demandPlanList?.items.find((row) => row.status === 'draft');

  const monthlyReference = (
    <>
      <div>
        <h3 className="text-base font-semibold text-text-main">
          当前生效策略：全品类 V4.1 分层 KPI + 季节影子落地 + 近端乐观抑制
        </h3>
        <p className="mt-1 leading-relaxed text-text-sub">
          {isWeekly ? (
            <>
              这张表只用来算出上面的「本周月预测」。一个 SKU 全程一层，第 2 周不会改成另一层。
            </>
          ) : (
            <>
              运行时默认 <span className="font-medium text-text-main">FORECAST_ALGO_MODE=allcat_v41</span>。
              T1–T4A 按 d2/d3/d6/d12 加权生成系统预测；T4B 对连续有销但未达主层门槛的 SKU 给出保守保底预测；T99
              有近期动销时写保守保底数，近30=0 归零，Dify 可选覆盖。 选择「全平台」生成时，按 V4.1 支持平台分别写入预测行，列表查询
              ALL 为分平台汇总，不写入 platform=ALL 物理行。日销站点按导入原文保存。预测仍按全站合并，station=ALL。 模型标识{' '}
              <span className="font-medium text-text-main">allcat_kpi_corefirst_v41</span>
              ；季节指数默认 <span className="font-medium text-text-main">mode=shadow</span>
              ，基线生成结束后自动跑影子落地全流程。
            </>
          )}
          {isWeekly ? (
            latestDemandPlanDraft ? (
              <>
                {' '}
                当前最新周预测草稿{' '}
                <span className="font-medium text-text-main">
                  {formatDemandPlanVersionTitle(
                    latestDemandPlanDraft.versionNo,
                    latestDemandPlanDraft.versionName,
                  )}
                </span>
                。
              </>
            ) : (
              <span> 生成周预测草稿后将写入新的 demand_plan 版本。</span>
            )
          ) : latestForecastDraft ? (
            <>
              {' '}
              当前最新草稿版本{' '}
              <span className="font-medium text-text-main">
                {formatForecastVersionTitle(latestForecastDraft.versionNo, latestForecastDraft.versionName)}
              </span>
              。
            </>
          ) : (
            <span> 生成预测后将写入新的草稿版本。</span>
          )}
        </p>
      </div>

      {isWeekly ? (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="font-medium text-text-main">T99 与人工校准（周预测）</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
            <li>T99：波动大、连续性不足或近端弱信号 — 系统仍写保守保底数（近30=0 归零）；复核摘要统计待校准 SKU 数。</li>
            <li>版本详情 → 复核矩阵：可按 T99 筛选；长表或 SKU 抽屉改「人工日均」；分平台导出校准表导入后按月形状反算全平台合计。</li>
            <li>发布冻结周预测版本；「发布并采用」仅登记意图，补货仍以月预测为准（见页头说明）。</li>
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-background p-3">
          <p className="font-medium text-text-main">T99 与 Dify 单条辅助预测</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
            <li>T99：波动大、连续性不足或近端弱信号 — 有近期动销时系统写保守保底数（近30=0 归零）；T4B 连续有销 SKU 由系统直接给保守保底数。</li>
            <li>版本详情 → 复核与发布：矩阵中 T99 行展示系统保守数（断销时为 0 且悬停「待校准」），点击 SKU 可触发 Dify 工作流或人工校准，入参含近 24 月销、品类趋势、预测周期。</li>
            <li>LLM 输出写入草稿版 sales_forecast_monthly（source=dify），可在 SKU 抽屉查看 rationale 并手工校准。</li>
            <li>
              SKU 抽屉提供三种辅助：<strong>AI 自动</strong>（直调 Dify）、<strong>AI+人工</strong>（外生因素：调价/投广告等）、
              <strong>系统运算</strong>（单 SKU 本地算法重算）。
            </li>
            <li>工作流 DSL：<code className="text-xs">docs/dify/workflows/single-sku-forecast.yml</code></li>
          </ul>
        </div>
      )}

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
            <li>
              d2/d3/d6/d12 = 目标<strong>自然月</strong>之前 2/3/6/12 个完整自然月的月销合计，再 ÷ 60/91/182/365 得到日均（走步特征，<strong>无 d1</strong>）。
              {isWeekly
                ? ' 这些月销量只用来算出「本周月预测」，不是矩阵上的最终数字。'
                : null}
            </li>
            <li>
              近 30/90 为日销表上滚动 30/90 <strong>日历天</strong>（与 d 不同）；growth / T99 会用到。
              {isWeekly ? ' 周计划近窗截止日为 planningRecentWindowEnd（业务日−2 与最大销日取早），月预测多为 effectiveRecentWindowEnd（常截上月末）。' : null}
            </li>
            <li>base_daily 按 T 层加权 → 趋势衰减（growth 用 recent30/90）→ 近端月渐减 → 层级保守系数 → 上下限 → 近端地板。</li>
          </ul>
        </div>
      </div>

      {!isWeekly ? (
        <>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="font-medium text-text-main">季节影子落地全流程（生成后自动）</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
              <li>
                生成时先写 V4.1 系统日均，并把类目/项目组季节指数的对照值写入 factors（
                <code className="text-xs">seasonalIndex.shadowDaily</code>，mode=shadow）。
              </li>
              <li>
                基线生成结束后<strong>自动</strong>执行：① 满幅影子写入系统日均 → ② 站点 SI 组合重塑（近端 blend≈0.5，11/12
                旺季满幅）→ ③ 地平线衰减 shadowHorizonDecay=[1,1,0.85,0.7,0.6,0.55]（11/12 强制满幅）→ ④ 落地后再帽。
              </li>
              <li>
                因此「再次生成」的草稿与已落地正式版应对齐同一口径；无需再手工跑落地脚本。
              </li>
            </ul>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="font-medium text-text-main">近端乐观抑制（爆款护栏）</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
              <li>
                生成路径：近端 h≤1 且 recent30≥3 时，相对 max(recent30,d6) 抬升帽（平季 ×1.15 / 11–12 月 ×1.25）；次通道（非
                Amazon）弱开局 recent30&lt;5 时 ×1.1。
              </li>
              <li>
                落地后再帽（对准影子抬升回冲）：近端 h≤1 统一 ×1.10；次通道弱开局收紧到 ×1.0。结果写入{' '}
                <code className="text-xs">horizonFactors.postLandingOptimismCap</code>。
              </li>
              <li>
                目标：压住 Top 爆款相对开局 MTD 的过冲；组合层可能略偏保守（尤其次通道），补货时需留意断货风险。
              </li>
            </ul>
          </div>
        </>
      ) : null}

      <div className="overflow-auto rounded-md border border-border bg-background">
        {isWeekly ? (
          <p className="border-b border-border px-3 py-2 text-sm text-text-sub">
            T1 的 SKU 每一周都用 T1 这一行来算月预测，不会在第 2 周改用 T2。
          </p>
        ) : null}
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
    </>
  );

  if (isWeekly) {
    return (
      <div className="space-y-4 text-sm">
        <WeeklyDemandPlanStrategyPreamble />
        <details className="rounded-lg border border-border bg-background p-4">
          <summary className="cursor-pointer font-medium text-text-main">
            附录：月预测的分层公式（和第几周无关，需要时再看）
          </summary>
          <div className="mt-4 space-y-4">{monthlyReference}</div>
        </details>
      </div>
    );
  }

  return <div className="mb-6 space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">{monthlyReference}</div>;
}


export function ForecastStrategySection({ active, context = 'monthly' }: Props) {
  const qc = useQueryClient();
  const isWeekly = context === 'weekly';
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
            <CardTitle>
              {isWeekly ? '周预测口径' : '预测策略（V4.1 + 季节落地 + 乐观抑制）'}
            </CardTitle>
            <p className="text-sm text-text-sub">
              {isWeekly
                ? '每周的预测每天 = 最近每天和本周月预测按比例相加。分层公式在文末附录。'
                : '主预测为全品类 V4.1 分层 KPI；T99 走复核 + 可选 Dify LLM 单条预测。品类趋势系数见「品类趋势系数」Tab。'}
            </p>
          </CardHeader>
          <CardContent>
            <AllCategoryV41StrategySummary context={context} />
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
