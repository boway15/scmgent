import { formatForecastChannelLabel } from '@/lib/forecast-horizon-meta';

export type ForecastPlatformDailyBreakdown = {
  platform: string;
  forecastDailyAvg: number;
  manualDailyAvg: number | null;
  effectiveDailyAvg: number;
};

const fmt = (value: number) => value.toFixed(2);

/** 合计单元格 title：在基础说明下追加各渠道生效/系统/校准 */
export function appendPlatformBreakdownToTitle(
  baseTitle: string,
  breakdown?: ForecastPlatformDailyBreakdown[] | null,
): string {
  if (!breakdown?.length) return baseTitle;
  const lines = breakdown.map((row) => {
    const label = formatForecastChannelLabel(row.platform);
    const parts = [`生效 ${fmt(row.effectiveDailyAvg)}`, `系统 ${fmt(row.forecastDailyAvg)}`];
    if (row.manualDailyAvg != null) {
      parts.push(`校准 ${fmt(row.manualDailyAvg)}`);
    }
    return `${label}：${parts.join(' · ')}`;
  });
  return `${baseTitle}\n—— 分平台 ——\n${lines.join('\n')}`;
}
