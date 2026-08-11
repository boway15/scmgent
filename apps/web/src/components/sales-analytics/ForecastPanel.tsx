import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  trendSeasonalForecast,
  trendSeasonalPanelTag,
  trendSeasonalRowBasis,
} from '@/lib/sales-analytics-forecast';
import type { SalesAnalyticsGranularity } from '@/lib/sales-analytics-types';
import { cn } from '@/lib/utils';

const CHART_PRIMARY = '#FF5000';
const CHART_FORECAST = '#D97706';

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function fmtPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function pctTone(n: number | null): string {
  if (n == null) return 'text-text-main';
  if (n > 0) return 'text-red-600';
  if (n < 0) return 'text-green-600';
  return 'text-text-main';
}

const MONTH_NAME = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
];

export type FcScope = 'filter' | 'all';

export function ForecastPanel({
  series,
  periods,
  gran,
  scope,
  onScopeChange,
  horizon,
  onHorizonChange,
}: {
  series: number[];
  periods: string[];
  gran: SalesAnalyticsGranularity;
  scope: FcScope;
  onScopeChange: (s: FcScope) => void;
  horizon: number;
  onHorizonChange: (h: number) => void;
}) {
  const isWeek = gran === 'week';
  const granWord = isWeek ? '周' : '月';
  const horizonMin = isWeek ? 20 : 5;
  const horizonMax = isWeek ? 52 : 12;
  const horizonOptions = Array.from(
    { length: horizonMax - horizonMin + 1 },
    (_, i) => horizonMin + i,
  );

  const hasSeries = series.length > 0 && periods.length > 0;
  const f = hasSeries ? trendSeasonalForecast(series, periods, horizon, isWeek) : null;
  const fc = f?.fc ?? [];
  const lastActual = f?.last ?? 0;

  const chartData = [
    ...periods.map((period, i) => ({
      period,
      actual: series[i] ?? 0,
      forecast: i === periods.length - 1 ? lastActual : null,
    })),
    ...fc.map((p) => ({
      period: p.ym,
      actual: null as number | null,
      forecast: p.val,
    })),
  ];

  const tableRows = f
    ? fc.map((p, i) => {
        const prev = i === 0 ? lastActual : fc[i - 1]!.val;
        const mom = prev ? ((p.val - prev) / prev) * 100 : null;
        return {
          ...p,
          mom,
          basis: trendSeasonalRowBasis(f, p.ym, isWeek),
        };
      })
    : [];

  const fcSum = fc.reduce((s, x) => s + x.val, 0);
  const last5 = series.slice(-5);
  const last5avg = last5.length
    ? last5.reduce((s, x) => s + x, 0) / last5.length
    : 0;
  const vsAvg =
    last5avg && fc.length
      ? (fcSum / fc.length - last5avg) / last5avg * 100
      : null;
  const trendWord =
    !f ? '' : f.b > 0 ? '整体呈上升趋势' : f.b < 0 ? '整体呈下降趋势' : '整体基本平稳';
  const scopeWord =
    scope === 'all'
      ? '（整体预测，基于全量数据，不随上方筛选变化）'
      : '（当前筛选预测，随上方筛选动态变化）';
  const reason =
    f && hasSeries
      ? [
          `基于 ${periods[0]} ~ ${periods[periods.length - 1]} 共 ${series.length} 个${granWord}的实际数据，采用「线性趋势${isWeek ? '' : ' + 月度季节性'}」乘法模型拟合。`,
          `① 趋势项：最小二乘斜率 ${(f.b >= 0 ? '+' : '') + f.b.toFixed(1)} 件/期，R²=${f.r2.toFixed(2)}，即 ${trendWord}；`,
          isWeek
            ? '（周度粒度不做月度季节性分解，按线性趋势外推）'
            : `② 季节性：峰值 ${MONTH_NAME[f.peakM - 1]}(因子 ${(f.sIdx[f.peakM] ?? 1).toFixed(2)})、谷值 ${MONTH_NAME[f.troughM - 1]}(因子 ${(f.sIdx[f.troughM] ?? 1).toFixed(2)})；`,
          `③ 预估结果：最新期实际 ${fmtQty(f.last)} 件为起点，未来 ${fc.length} ${granWord}合计约 ${fmtQty(fcSum)} 件` +
            (vsAvg == null ? '。' : `；较近 5 ${granWord}均值 ${vsAvg >= 0 ? '上升' : '下降'} ${fmtPct(Math.abs(vsAvg))}。`),
        ].join('')
      : '';

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-base">未来销量预估</CardTitle>
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as FcScope)}
          >
            <option value="filter">当前筛选预测（随筛选动态变更）</option>
            <option value="all">整体预测（全量，不受筛选影响）</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            value={horizon}
            title={`预测期数（${isWeek ? '周度 20-52' : '月度 5-12'}）`}
            onChange={(e) => onHorizonChange(Number(e.target.value))}
          >
            {horizonOptions.map((h) => (
              <option key={h} value={h}>
                未来 {h} {granWord}
              </option>
            ))}
          </select>
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
            {trendSeasonalPanelTag(isWeek)}
          </span>
        </div>
        <p className="text-sm text-amber-800">
          看板粗估，非系统发布预测
          {scope === 'all' ? ' · 基于全量数据' : ' · 随上方筛选变化'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-72">
          {hasSeries && chartData.some((r) => (r.actual ?? 0) > 0 || (r.forecast ?? 0) > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtQty(Number(v))} />
                <Tooltip
                  formatter={(value, name) =>
                    value == null ? ['—', String(name)] : [`${fmtQty(Number(value))} 件`, String(name)]
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="历史实际"
                  stroke={CHART_PRIMARY}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="模型预估"
                  stroke={CHART_FORECAST}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-text-hint">
              当前无可用序列，无法预估
            </p>
          )}
        </div>

        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-text-sub">预估{granWord}份</th>
                <th className="px-3 py-2 text-right font-medium text-text-sub">预估销量(件)</th>
                <th className="px-3 py-2 text-right font-medium text-text-sub">较上{granWord}环比</th>
                <th className="px-3 py-2 text-left font-medium text-text-sub">依据</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-hint">
                    无预估行
                  </td>
                </tr>
              ) : (
                tableRows.map((r) => (
                  <tr key={r.ym} className="border-t border-border">
                    <td className="px-3 py-2">{r.ym}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.val)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', pctTone(r.mom))}>
                      {fmtPct(r.mom)}
                    </td>
                    <td className="max-w-xl px-3 py-2 text-xs text-text-sub">{r.basis}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {reason && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-text-sub">
            <span className="font-medium text-text-main">模型与依据{scopeWord}：</span>
            {reason}
            <br />
            <span className="text-text-hint">
              说明：预估为统计外推，未计入促销、缺货、上新等突发因素，仅供趋势参考；看板粗估，非系统发布预测。
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
