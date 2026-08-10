import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DIM_NAME,
  MATRIX_DIMS,
  MATRIX_MODE_OPTIONS,
  downloadMatrixCsv,
  type MatrixMode,
  type MatrixRow,
} from '@/lib/sales-analytics-matrix';
import { momPct } from '@/lib/sales-analytics-metrics';
import { cn } from '@/lib/utils';

const CHART_PRIMARY = '#FF5000';
const CHART_HIGHLIGHT = '#F59E0B';
const CHART_MOM = '#D97706';

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

export function MatrixSection({
  mode,
  onModeChange,
  rows,
  histPeriods,
  fcLabels,
  pinnedKey,
  onPin,
  onUnpin,
  pinSeries,
  rangeStart,
  rangeEnd,
}: {
  mode: MatrixMode;
  onModeChange: (m: MatrixMode) => void;
  rows: MatrixRow[];
  histPeriods: string[];
  fcLabels: string[];
  pinnedKey: string | null;
  onPin: (key: string) => void;
  onUnpin: () => void;
  pinSeries: number[];
  rangeStart: number;
  rangeEnd: number;
}) {
  const dims = MATRIX_DIMS[mode];
  const dimName = dims.map((d) => DIM_NAME[d]).join(' × ');
  const isPinned = Boolean(pinnedKey);

  const chartRows = histPeriods.map((period, offset) => {
    const i = rangeStart + offset;
    return {
      period,
      qty: pinSeries[i] ?? 0,
      mom: momPct(pinSeries, i),
      isLatest: i === rangeEnd,
    };
  });

  const exportCsv = () => {
    const headers = [
      dimName,
      ...histPeriods,
      ...fcLabels,
      '预测模型',
      '区间累计',
      '最新期环比',
      '最新期同比',
      '峰值(期/值)',
      '谷值(期/值)',
    ];
    const body = rows.map((r) => [
      r.key,
      ...r.hist.map((x) => String(Math.round(x))),
      ...r.fc.map((x) => String(x.val)),
      r.modelLabel,
      String(Math.round(r.cum)),
      r.mom == null ? '' : r.mom.toFixed(1),
      r.yoy == null ? '' : r.yoy.toFixed(1),
      `${r.peak.period} / ${Math.round(r.peak.qty)}`,
      `${r.trough.period} / ${Math.round(r.trough.qty)}`,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadMatrixCsv(`销售分析-明细矩阵-${dimName}-${stamp}.csv`, headers, body);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">明细矩阵表</CardTitle>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={mode}
              onChange={(e) => onModeChange(e.target.value as MatrixMode)}
            >
              {MATRIX_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              导出 CSV
            </Button>
          </div>
          <p className="text-sm text-text-sub">
            粒度：{dimName} · 共 {rows.length} 行（点击行可锁定下方走势图）。预测列为
            <span className="font-medium text-amber-700">看板粗估，非系统发布预测</span>
            。
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-hint">当前筛选无数据</p>
          ) : (
            <div className="max-h-[420px] overflow-auto rounded-md border border-border">
              <table className="w-max min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="sticky left-0 z-20 bg-muted px-2 py-2 text-left font-medium text-text-sub">
                      {dimName}
                    </th>
                    {histPeriods.map((p) => (
                      <th key={p} className="px-2 py-2 text-right font-medium text-text-sub">
                        {p}
                      </th>
                    ))}
                    {fcLabels.map((p) => (
                      <th
                        key={`fc-${p}`}
                        className="bg-amber-50 px-2 py-2 text-right font-medium text-amber-800"
                        title="看板粗估，非系统发布预测"
                      >
                        {p}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-left font-medium text-text-sub">预测模型</th>
                    <th className="px-2 py-2 text-right font-medium text-text-sub">区间累计</th>
                    <th className="px-2 py-2 text-right font-medium text-text-sub">最新期环比</th>
                    <th className="px-2 py-2 text-right font-medium text-text-sub">最新期同比</th>
                    <th className="px-2 py-2 text-right font-medium text-text-sub">峰值(期/值)</th>
                    <th className="px-2 py-2 text-right font-medium text-text-sub">谷值(期/值)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      className={cn(
                        'cursor-pointer border-t border-border hover:bg-muted/60',
                        pinnedKey === r.key && 'bg-amber-50',
                      )}
                      onClick={() => onPin(r.key)}
                      title={r.reason}
                    >
                      <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-left font-medium">
                        {r.key}
                      </td>
                      {r.hist.map((x, i) => (
                        <td key={`${r.key}-h-${i}`} className="px-2 py-1.5 text-right tabular-nums">
                          {x ? fmtQty(x) : ''}
                        </td>
                      ))}
                      {r.fc.map((x) => (
                        <td
                          key={`${r.key}-f-${x.ym}`}
                          className="bg-amber-50/80 px-2 py-1.5 text-right tabular-nums text-amber-900"
                          title={r.reason}
                        >
                          {fmtQty(x.val)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-left" title={r.reason}>
                        {r.modelLabel}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                        {fmtQty(r.cum)}
                      </td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums', pctTone(r.mom))}>
                        {fmtPct(r.mom)}
                      </td>
                      <td className={cn('px-2 py-1.5 text-right tabular-nums', pctTone(r.yoy))}>
                        {fmtPct(r.yoy)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {r.peak.period} / {fmtQty(r.peak.qty)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {r.trough.period} / {fmtQty(r.trough.qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">明细矩阵对应走势（柱=期值，折线=环比%）</CardTitle>
          <p className="text-sm text-text-sub">
            {isPinned ? (
              <>
                已锁定查看：<span className="font-medium text-text-main">{pinnedKey}</span>{' '}
                的走势（点击「查看全部」恢复合计走势）。
              </>
            ) : (
              <>
                当前展示：当前筛选下各组合合计的走势。点击上方明细矩阵任意行可锁定查看该行走势。
              </>
            )}
          </p>
          <p className="text-xs text-text-hint">
            粒度：{dimName} ｜ {isPinned ? pinnedKey : '当前筛选合计'}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-72">
            {chartRows.some((r) => r.qty > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="qty"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => fmtQty(Number(v))}
                  />
                  <YAxis
                    yAxisId="mom"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    unit="%"
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === '环比 MoM %') {
                        return value == null ? '—' : `${Number(value).toFixed(1)}%`;
                      }
                      return `${fmtQty(Number(value ?? 0))} 件`;
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="qty" dataKey="qty" name="期销量" radius={[4, 4, 0, 0]}>
                    {chartRows.map((row) => (
                      <Cell
                        key={row.period}
                        fill={row.isLatest ? CHART_HIGHLIGHT : CHART_PRIMARY}
                      />
                    ))}
                  </Bar>
                  <Line
                    yAxisId="mom"
                    type="monotone"
                    dataKey="mom"
                    name="环比 MoM %"
                    stroke={CHART_MOM}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-text-hint">
                当前无走势数据
              </p>
            )}
          </div>
          {isPinned && (
            <Button type="button" variant="outline" size="sm" onClick={onUnpin}>
              查看全部（取消锁定）
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
