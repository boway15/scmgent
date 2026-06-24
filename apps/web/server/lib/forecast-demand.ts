import {
  calcCoverageReplenishment,
  calcLatestOrderDays,
  calcInventoryHealth,
  calcSuggestedOrderDate,
  type CoverageReplenishmentResult,
} from './replenishment-coverage.js';

export type MonthlyForecastRow = {
  forecastYear: number;
  month: number;
  forecastDailyAvg: number;
};

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
  return value != null && value > 0 ? value : fallbackDaily;
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
