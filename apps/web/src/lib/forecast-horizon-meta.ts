/** 从当前月起向前生成 monthLabel 列表（与后端 buildMonthlyForecastHorizon 对齐） */
export function buildForwardMonthLabels(monthCount: number, asOf = new Date()): string[] {
  const labels: string[] = [];
  const startYear = asOf.getUTCFullYear();
  const startMonth = asOf.getUTCMonth() + 1;
  for (let i = 0; i < monthCount; i++) {
    const absolute = startMonth + i;
    const year = startYear + Math.floor((absolute - 1) / 12);
    const month = ((absolute - 1) % 12) + 1;
    labels.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return labels;
}

export type HorizonBand = 'precision' | 'flex' | 'strategic';

export const HORIZON_BAND_LABELS: Record<HorizonBand, string> = {
  precision: '1–3 月（精准备货）',
  flex: '3–6 月（生产柔性）',
  strategic: '6–12 月（战略库容）',
};

/** 销量预测向前地平线：最多 12 个自然月 */
export const MAX_FORECAST_MONTH_COUNT = 12;

/** SKU 抽屉固定展示的历史销量月数（与预测月数无关） */
export const DRAWER_HISTORY_MONTH_COUNT = 24;

export const FORECAST_GENERATION_MONTH_OPTIONS = [3, 6, 12] as const;

export const FORECAST_HORIZON_FUTURE_MONTH_OPTIONS = [3, 6, 12] as const;

export const FORECAST_HORIZON_HISTORY_MONTH_OPTIONS = [6, 12, 18, 24] as const;

/** 与后端 forecast-platform-scope FORECAST_V41_PLATFORM_CODES 对齐 */
export const FORECAST_V41_PLATFORM_CODES = [
  'AMAZON',
  'WALMART',
  'TEMU',
  'TIKTOK',
  'UNKNOWN',
] as const;

export const FORECAST_GENERATION_PLATFORM_CODES = new Set<string>([
  'ALL',
  ...FORECAST_V41_PLATFORM_CODES,
]);

const HORIZON_PLATFORM_ALIASES: Record<string, string> = {
  亚马逊: 'AMAZON',
  沃尔玛: 'WALMART',
  独立站: 'DTC',
  全平台: 'ALL',
  全平台汇总: 'ALL',
};

/** 与列表矩阵一致：空 / ALL 表示全渠道汇总，否则为单渠道标准码 */
export function resolveHorizonPlatformScope(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'ALL';
  const alias =
    HORIZON_PLATFORM_ALIASES[trimmed] ??
    HORIZON_PLATFORM_ALIASES[trimmed.toUpperCase()];
  if (alias) return alias;
  const upper = trimmed.toUpperCase();
  return upper === 'ALL' ? 'ALL' : upper;
}
