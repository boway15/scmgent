import {
  FORECAST_ACCURACY_METRICS,
  type ForecastAccuracyMetricKey,
} from '@/lib/forecast-accuracy-metrics';

type Props = {
  metric: ForecastAccuracyMetricKey;
  /** 表头下展示一行简写公式 */
  showShort?: boolean;
  className?: string;
};

export function ForecastAccuracyMetricLabel({ metric, showShort = false, className }: Props) {
  const def = FORECAST_ACCURACY_METRICS[metric];
  if (!def) {
    return <span className={className}>{metric}</span>;
  }
  return (
    <span className={className}>
      <span
        className={`cursor-help border-b border-dotted border-text-sub/40 ${def.primary ? 'font-medium text-text-main' : ''}`}
        title={def.formula}
      >
        {def.label}
      </span>
      {showShort && def.short ? (
        <span className="mt-0.5 block text-[10px] font-normal leading-tight text-text-sub">{def.short}</span>
      ) : null}
    </span>
  );
}

export function ForecastAccuracyMetricsLegend({
  className,
  metrics,
  intro,
}: {
  className?: string;
  metrics?: ForecastAccuracyMetricKey[];
  intro?: string;
}) {
  const items: ForecastAccuracyMetricKey[] = metrics ?? [
    'monthlyAvgMape',
    'monthlyAvgWmape',
    'rowMape',
    'rowWmape',
    'highMapeRowPct',
    'ghostRows',
    'zeroForecastMiss',
  ];

  return (
    <details className={className ?? 'rounded-lg border border-border bg-muted/20 p-3 text-xs text-text-sub'}>
      <summary className="cursor-pointer text-sm font-medium text-text-main">指标计算说明（MAPE / WMAPE）</summary>
      {intro ? <p className="mt-2 leading-relaxed">{intro}</p> : null}
      <dl className="mt-2 space-y-2">
        {items.map((key) => {
          const def = FORECAST_ACCURACY_METRICS[key];
          return (
            <div key={key}>
              <dt className={`text-text-main ${def.primary ? 'font-semibold' : 'font-medium'}`}>
                {def.label}
                {def.primary ? '（主 KPI）' : ''}
              </dt>
              <dd className="mt-0.5 leading-relaxed">{def.formula}</dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
