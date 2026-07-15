import {
  calcCoverageReplenishment,
  calcLatestOrderDays,
  calcInventoryHealth,
  calcSuggestedOrderDate,
  type CoverageReplenishmentResult,
} from './replenishment-coverage.js';

export function resolveEffectiveForecastDailyAvg(
  forecastDailyAvg: number,
  manualDailyAvg?: number | null,
): number {
  if (manualDailyAvg != null && Number.isFinite(manualDailyAvg) && manualDailyAvg >= 0) {
    return manualDailyAvg;
  }
  return forecastDailyAvg;
}

export function mapForecastDailyFields(input: {
  forecastDailyAvg: number | string;
  manualDailyAvg?: number | string | null;
}) {
  const systemForecastDailyAvg = Number(input.forecastDailyAvg);
  const manual =
    input.manualDailyAvg != null && input.manualDailyAvg !== ''
      ? Number(input.manualDailyAvg)
      : null;
  const manualDailyAvg =
    manual != null && Number.isFinite(manual) && manual >= 0 ? manual : null;
  return {
    forecastDailyAvg: systemForecastDailyAvg,
    manualDailyAvg,
    effectiveDailyAvg: resolveEffectiveForecastDailyAvg(systemForecastDailyAvg, manualDailyAvg),
  };
}

/** 多平台预测行按日历月汇总生效日均（manual 优先于系统值） */
export function sumEffectiveForecastDailyAcrossPlatforms(
  rows: Array<{ forecastDailyAvg: number | string; manualDailyAvg?: number | string | null }>,
): number {
  let sum = 0;
  for (const row of rows) {
    sum += mapForecastDailyFields(row).effectiveDailyAvg;
  }
  return Math.round(sum * 10_000) / 10_000;
}

export type MonthlyForecastRow = {
  forecastYear: number;
  month: number;
  forecastDailyAvg: number;
  platform?: string;
};

const PLATFORM_ALIASES: Record<string, string> = {
  亚马逊: 'AMAZON',
  沃尔玛: 'WALMART',
  独立站: 'DTC',
  全平台: 'ALL',
  ALL: 'ALL',
  AMAZON: 'AMAZON',
  WALMART: 'WALMART',
  EBAY: 'EBAY',
  SHOPIFY: 'SHOPIFY',
  DTC: 'DTC',
  TEMU: 'TEMU',
  TIKTOK: 'TIKTOK',
};

/** 在售平台编码归一化；空值表示 ALL（全平台汇总行） */
export function normalizeSalesPlatform(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'ALL';
  const upper = trimmed.toUpperCase();
  return PLATFORM_ALIASES[trimmed] ?? PLATFORM_ALIASES[upper] ?? upper.replace(/\s+/g, '_');
}

/**
 * 将多平台预测行聚合为日历月 Map。
 * - 若存在分平台行，则按年月求和（同一站点多平台销量叠加）
 * - 若仅有 ALL 行，则直接使用 ALL
 * - 禁止 ALL 与分平台混用，混用时只取分平台求和
 */
export function aggregateForecastRows(
  rows: Array<MonthlyForecastRow & { platform?: string }>,
): Map<string, number> {
  const specific = rows.filter((r) => normalizeSalesPlatform(r.platform) !== 'ALL');
  const source = specific.length ? specific : rows;

  const map = new Map<string, number>();
  for (const row of source) {
    const key = forecastMonthKey(row.forecastYear, row.month);
    map.set(key, (map.get(key) ?? 0) + row.forecastDailyAvg);
  }
  return map;
}

export function stationForWarehouse(regionGroup: string, countryCode?: string | null): string {
  const cc = countryCode?.toUpperCase();
  if (cc === 'DE') return 'DE';
  if (cc === 'GB' || cc === 'UK') return 'UK';
  if (regionGroup === 'US') return 'US';
  if (regionGroup === 'EU') return 'DE';
  return regionGroup || 'US';
}

export function forecastMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function resolveHorizonConsumptionDaily(input: {
  forecastDailyAvg: number;
  effectiveDailyAvg?: number;
  forecastDailyP90?: number | null;
  horizonMonthIndex: number;
  profileClass?: string | null;
  useP90ForVolatile?: boolean;
}): number {
  const k = Math.max(0, Math.floor(input.horizonMonthIndex));
  const base =
    k <= 2 && input.effectiveDailyAvg != null && input.effectiveDailyAvg > 0
      ? input.effectiveDailyAvg
      : input.forecastDailyAvg;

  if (
    input.useP90ForVolatile !== false &&
    input.profileClass === 'B' &&
    input.forecastDailyP90 != null &&
    input.forecastDailyP90 > 0
  ) {
    return input.forecastDailyP90;
  }

  return base;
}

export function horizonMonthIndexFromDate(forecastDate: Date, asOf = new Date()): number {
  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;
  const y = forecastDate.getUTCFullYear();
  const m = forecastDate.getUTCMonth() + 1;
  return (y - asOfYear) * 12 + (m - asOfMonth);
}

export function getForecastDailyForHorizon(
  forecasts: Map<string, number>,
  date: Date,
  fallbackDaily: number,
  opts?: {
    p90Forecasts?: Map<string, number>;
    profileClass?: string | null;
    asOf?: Date;
  },
): number {
  const key = forecastMonthKey(date.getFullYear(), date.getMonth() + 1);
  const daily = forecasts.get(key) ?? fallbackDaily;
  const k = horizonMonthIndexFromDate(date, opts?.asOf ?? new Date());
  const p90 = opts?.p90Forecasts?.get(key);
  return resolveHorizonConsumptionDaily({
    forecastDailyAvg: daily,
    forecastDailyP90: p90,
    horizonMonthIndex: k,
    profileClass: opts?.profileClass,
  });
}

/** API/页面展示用预测月份 */
export function formatForecastMonth(year: number, month: number): string {
  return forecastMonthKey(year, month);
}

export function parseForecastMonth(value: string): { year: number; month: number } | null {
  const m = value.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function buildForecastMap(rows: MonthlyForecastRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(forecastMonthKey(row.forecastYear, row.month), row.forecastDailyAvg);
  }
  return map;
}

export function getForecastDailyForDate(
  forecasts: Map<string, number>,
  date: Date,
  fallbackDaily = 0,
): number {
  const key = forecastMonthKey(date.getFullYear(), date.getMonth() + 1);
  const value = forecasts.get(key);
  if (value != null && value > 0) return value;

  // 跨年兜底：若未维护下一年同月预测，复用已有年份的同月日均（季节性近似）
  const month = date.getMonth() + 1;
  const monthSuffix = `-${String(month).padStart(2, '0')}`;
  let seasonalFallback: number | null = null;
  for (const [k, v] of forecasts) {
    if (k.endsWith(monthSuffix) && v > 0) {
      seasonalFallback = v;
      break;
    }
  }
  if (seasonalFallback != null) return seasonalFallback;

  return fallbackDaily;
}

/** 未来 N 天按月度预测日均的加权平均 */
export function calcForwardAvgDaily(
  forecasts: Map<string, number>,
  startDate: Date,
  days: number,
  fallbackDaily = 0,
): number {
  if (days <= 0) return fallbackDaily;
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    sum += getForecastDailyForDate(forecasts, d, fallbackDaily);
  }
  return sum / days;
}

/** 按日预测模拟库存耗尽，得到覆盖天数（支持季节性） */
export function calcCoverageDaysWithForecast(
  effectiveQty: number,
  forecasts: Map<string, number>,
  startDate: Date,
  fallbackDaily: number,
  maxDays = 730,
): number {
  if (effectiveQty <= 0) return 0;
  let remaining = effectiveQty;
  for (let day = 0; day < maxDays; day++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + day);
    const daily = getForecastDailyForDate(forecasts, d, fallbackDaily);
    if (daily <= 0) return Number.POSITIVE_INFINITY;
    remaining -= daily;
    if (remaining <= 0) return day + remaining / daily;
  }
  return Number.POSITIVE_INFINITY;
}

export function sumForecastDemand(
  forecasts: Map<string, number>,
  startDate: Date,
  days: number,
  fallbackDaily: number,
): number {
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    sum += getForecastDailyForDate(forecasts, d, fallbackDaily);
  }
  return sum;
}

const MONTH_FORECAST_KEY =
  /^(?:(\d{1,2})月预测日均|forecast_(?:daily_)?m?(\d{1,2})|month_(\d{1,2})|m(\d{1,2})_forecast_daily)$/i;

/** 从宽表行解析 1-12 月预测日均列 */
export function parseMonthlyForecastFromRow(
  row: Record<string, string>,
): Array<{ month: number; daily: number }> {
  const out: Array<{ month: number; daily: number }> = [];

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = rawKey.trim();
    const normalized = key.replace(/\s+/g, '');
    let month: number | null = null;

    const cnMatch = normalized.match(/^(\d{1,2})月预测日均$/);
    if (cnMatch) {
      month = parseInt(cnMatch[1], 10);
    } else {
      const enMatch = normalized.match(MONTH_FORECAST_KEY);
      if (enMatch) {
        month = parseInt(enMatch[1] ?? enMatch[2] ?? enMatch[3] ?? enMatch[4], 10);
      }
    }

    if (month == null || month < 1 || month > 12) continue;
    const daily = parseFloat(String(rawValue).replace(/,/g, '').trim());
    if (!Number.isFinite(daily) || daily < 0) continue;
    out.push({ month, daily });
  }

  return out.sort((a, b) => a.month - b.month);
}

export function calcCoverageReplenishmentFromForecast(params: {
  effectiveQty: number;
  forecasts: Map<string, number>;
  historicalAvgDaily: number;
  productionDays: number;
  shippingDays: number;
  inboundBufferDays?: number;
  safetyStockDays?: number;
  targetCoverageDays?: number;
  overstockThresholdDays?: number;
  moq?: number;
  lifecycle?: string | null;
  today?: Date;
}): CoverageReplenishmentResult & { demandSource: 'forecast' | 'historical' } {
  const today = params.today ?? new Date();
  const fallback = params.historicalAvgDaily;
  const base = calcCoverageReplenishment({
    effectiveQty: params.effectiveQty,
    avgDaily: fallback,
    productionDays: params.productionDays,
    shippingDays: params.shippingDays,
    inboundBufferDays: params.inboundBufferDays,
    safetyStockDays: params.safetyStockDays,
    targetCoverageDays: params.targetCoverageDays,
    overstockThresholdDays: params.overstockThresholdDays,
    moq: params.moq,
    lifecycle: params.lifecycle,
    today,
  });

  if (!params.forecasts.size) {
    return { ...base, demandSource: 'historical' };
  }

  const coverageDays = calcCoverageDaysWithForecast(
    params.effectiveQty,
    params.forecasts,
    today,
    fallback,
  );
  const forwardAvg = calcForwardAvgDaily(params.forecasts, today, 90, fallback);
  const latestOrderDays = calcLatestOrderDays({
    coverageDays,
    totalLeadDays: base.leadTime.totalLeadDays,
    safetyStockDays: base.safetyStockDays,
  });
  const healthStatus = calcInventoryHealth({
    coverageDays,
    totalLeadDays: base.leadTime.totalLeadDays,
    safetyStockDays: base.safetyStockDays,
    overstockThresholdDays: base.overstockThresholdDays,
    lifecycle: params.lifecycle,
    effectiveQty: params.effectiveQty,
    avgDaily: forwardAvg,
  });

  let suggestedQty = 0;
  if (healthStatus === 'red' || healthStatus === 'yellow') {
    const targetDemand = sumForecastDemand(
      params.forecasts,
      today,
      base.targetCoverageDays,
      fallback,
    );
    const raw = Math.max(0, Math.ceil(targetDemand) - params.effectiveQty);
    const moq = params.moq ?? 0;
    suggestedQty = moq > 0 ? Math.max(raw, moq) : raw;
  }

  return {
    ...base,
    coverageDays,
    latestOrderDays,
    healthStatus,
    suggestedQty,
    suggestedDate: calcSuggestedOrderDate(latestOrderDays, today),
    needsReplenishment:
      (healthStatus === 'red' || healthStatus === 'yellow') && suggestedQty > 0,
    demandSource: 'forecast' as const,
  };
}
