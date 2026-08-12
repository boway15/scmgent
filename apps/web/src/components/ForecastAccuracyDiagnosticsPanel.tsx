import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ForecastAccuracyMetricLabel,
  ForecastAccuracyMetricsLegend,
} from '@/components/ForecastAccuracyMetricLabel';
import { FORECAST_ACCURACY_DIAGNOSTICS_LEGEND_INTRO } from '@/lib/forecast-accuracy-metrics';
import type {
  ForecastAccuracyDiagnostics,
  ForecastAccuracyMetricSummary,
} from '@/lib/api';

type Props = {
  diagnostics: ForecastAccuracyDiagnostics | undefined;
  isLoading?: boolean;
  error?: unknown;
};

/** V4.1 分层展示顺序：T1 → T99，其余按 key 字母序靠后 */
const PROFILE_SEGMENT_SORT_ORDER: Record<string, number> = {
  T1: 1,
  T2: 2,
  T3: 3,
  T3P: 4,
  T4A: 5,
  T4B: 6,
  T99: 7,
};

const VERSION_SELECTION_LABEL: Record<NonNullable<ForecastAccuracyDiagnostics['scope']['versionSelection']>, string> = {
  explicit: '手动指定版本',
  auto_published: '自动选择已发布版本',
  auto_latest: '自动选择最新可用版本',
};

function fmtPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function formatError(error: unknown): string {
  if (!error) return '';
  return error instanceof Error ? error.message : String(error);
}

function sortProfileSegmentRows(rows: ForecastAccuracyMetricSummary[]): ForecastAccuracyMetricSummary[] {
  return [...rows].sort((a, b) => {
    const keyA = a.key ?? '';
    const keyB = b.key ?? '';
    const orderA = PROFILE_SEGMENT_SORT_ORDER[keyA] ?? 100;
    const orderB = PROFILE_SEGMENT_SORT_ORDER[keyB] ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    return keyA.localeCompare(keyB);
  });
}

function MetricTable({ title, rows }: { title: string; rows: ForecastAccuracyMetricSummary[] }) {
  if (!rows.length) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="border-b border-border bg-muted/30 px-3 py-2 text-sm font-medium text-text-main">{title}</div>
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="p-2 font-normal">分层</th>
            <th className="p-2 font-normal">SKU</th>
            <th className="p-2 font-normal">可比/总行</th>
            <th className="p-2 font-normal">
              <ForecastAccuracyMetricLabel metric="ghostRows" />
            </th>
            <th className="p-2 font-normal">预测总销量</th>
            <th className="p-2 font-normal">实际总销量</th>
            <th className="p-2 font-normal">
              <ForecastAccuracyMetricLabel metric="pooledMape" showShort />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.key ?? row.label ?? title}-${index}`} className="border-b border-border/50 last:border-0">
              <td className="max-w-[280px] truncate p-2" title={row.label ?? row.key ?? '全量'}>
                {row.label ?? row.key ?? '全量'}
              </td>
              <td className="p-2 font-numeric">{fmtNum(row.skuCount)}</td>
              <td className="p-2 font-numeric">
                {fmtNum(row.comparableRows)}/{fmtNum(row.rows)}
              </td>
              <td className="p-2 font-numeric">{fmtNum(row.ghostRows)}</td>
              <td className="p-2 font-numeric">{fmtNum(Math.round(row.forecastQtySum ?? 0))}</td>
              <td className="p-2 font-numeric">{fmtNum(Math.round(row.actualQtySum ?? 0))}</td>
              <td className="p-2 font-numeric font-medium">{fmtPct(row.weightedBias)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastAccuracyDiagnosticsPanel({ diagnostics, isLoading, error }: Props) {
  const scope = diagnostics?.scope;
  const profileSegmentRows = diagnostics
    ? sortProfileSegmentRows(diagnostics.byProfileSegment).slice(0, 8)
    : [];

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">预测准确率诊断</CardTitle>
            <p className="mt-1 text-xs text-text-sub">
              默认优先读取已发布版本；决策窗口 × 画像分层（如 1–3 月 × T1）与分层数据均按全期汇总计算
              预测/实际总销量（日均×当月天数）、
              <ForecastAccuracyMetricLabel metric="pooledMape" className="mx-0.5" />
              、
              <ForecastAccuracyMetricLabel metric="ghostRows" className="mx-0.5" />
              。统计纳入全部预测&gt;0 行（含 T4B / ghost）；MAPE 分母仅实际&gt;0，可与导出 CSV 加总核对。漏报仅在下方明细「漏报」Tab 查看。
            </p>
          </div>
          {scope && (
            <span className="rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
              {VERSION_SELECTION_LABEL[scope.versionSelection ?? 'auto_latest']} · {scope.versionNo ?? scope.versionName ?? scope.versionId}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-text-sub">正在读取准确率诊断…</p>}
        {error ? <p className="text-sm text-destructive">{formatError(error)}</p> : null}

        {diagnostics && (
          <>
            {scope && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-text-sub">
                <p>
                  诊断范围：版本 {scope.versionNo ?? scope.versionName ?? scope.versionId ?? '—'}（{scope.versionStatus ?? '—'}） · 月份{' '}
                  {scope.startMonth ?? '—'} ~ {scope.endMonth ?? '—'} · 平台 {scope.platform ?? 'ALL'}
                </p>
              </div>
            )}

            <ForecastAccuracyMetricsLegend
              className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-text-sub"
              intro={FORECAST_ACCURACY_DIAGNOSTICS_LEGEND_INTRO}
              metrics={['pooledMape', 'ghostRows']}
            />

            <div className="grid gap-3 xl:grid-cols-2">
              <MetricTable title="决策窗口 × 画像分层" rows={diagnostics.byHorizonBand} />
              <MetricTable title="分层数据" rows={profileSegmentRows} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
