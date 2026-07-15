import {
  ForecastAccuracyMetricLabel,
} from '@/components/ForecastAccuracyMetricLabel';

export type WalkForwardMonthTierStat = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  profileSegment: string;
  profileSegmentLabel: string;
  comparableRows: number;
  mape: number | null;
  wmape: number | null;
};

function fmtSignedPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(0)}%`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function scoreClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'text-text-sub';
  if (value <= 0.3) return 'text-emerald-700 dark:text-emerald-300';
  if (value <= 0.6) return 'text-amber-700 dark:text-amber-300';
  return 'text-red-700 dark:text-red-300';
}

type Props = {
  rows: WalkForwardMonthTierStat[];
};

export function WalkForwardMonthTierTable({ rows }: Props) {
  if (!rows.length) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-2 text-sm font-medium text-text-main">
        分月分层统计（T1–T4A KPI 可比）
      </div>
      <p className="border-b border-border bg-muted/20 px-3 py-2 text-xs text-text-sub">
        单月 MAPE = Σ(预测−实际)÷Σ实际；单月 WMAPE = Σ|预测−实际|÷Σ实际（均有符号/绝对误差口径，仅实际&gt;0 行）。
      </p>
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="p-2 font-normal">月份</th>
            <th className="p-2 font-normal">画像分层</th>
            <th className="p-2 font-normal">可比行</th>
            <th className="p-2 font-normal">
              <ForecastAccuracyMetricLabel metric="rowMape" showShort />
            </th>
            <th className="p-2 font-normal">
              <ForecastAccuracyMetricLabel metric="rowWmape" showShort />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.monthLabel}-${row.profileSegment}`}
              className="border-b border-border/50 last:border-0"
            >
              <td className="p-2 font-numeric">{row.monthLabel}</td>
              <td className="p-2">{row.profileSegmentLabel}</td>
              <td className="p-2 font-numeric">{row.comparableRows.toLocaleString('zh-CN')}</td>
              <td className={`p-2 font-numeric font-medium ${scoreClass(row.mape != null ? Math.abs(row.mape) : null)}`}>
                {fmtSignedPct(row.mape)}
              </td>
              <td className={`p-2 font-numeric ${scoreClass(row.wmape)}`}>{fmtPct(row.wmape)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
