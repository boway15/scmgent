import { and, eq, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly } from '@scm/db';
import { buildMonthlyForecastHorizon, daysInCalendarMonth } from './forecast-baseline.js';
import { formatForecastStartMonth, resolveForecastStartMonthAsOf } from './forecast-start-month.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { getForecastVersionById } from './forecast-version.js';
import { resolveActualMonthlyDailyAvg } from './sales-history-monthly.js';

export type ForecastQtyTotalsStatus = 'in_progress' | 'empty_actual' | 'ready';

export type ForecastQtyTotalsResult = {
  status: ForecastQtyTotalsStatus;
  forecastQty: number;
  actualQty: number;
  label: string;
};

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function resolveHorizonMonthKeys(input: {
  distinctMonths: string[];
  startMonth: string | null;
  monthCount: number;
  now?: Date;
}): string[] {
  const distinct = [...new Set(input.distinctMonths.filter(Boolean))].sort();
  if (distinct.length > 0) return distinct;

  const start = input.startMonth?.trim();
  const count = Math.max(0, Math.floor(input.monthCount));
  if (!start || count <= 0) return [];

  const asOf = resolveForecastStartMonthAsOf(start);
  return buildMonthlyForecastHorizon(asOf, count).map((h) => monthKey(h.forecastYear, h.month));
}

export function formatQtyTotalsLabel(
  status: ForecastQtyTotalsStatus,
  forecastQty: number,
  actualQty: number,
): string {
  if (status === 'in_progress') return '进行中';
  if (status === 'empty_actual') return '-';
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  return `${fmt(forecastQty)} / ${fmt(actualQty)}`;
}

export function buildForecastQtyTotalsResult(input: {
  horizonMonthKeys: string[];
  forecastQty: number;
  actualQty: number;
  now?: Date;
}): ForecastQtyTotalsResult {
  const now = input.now ?? new Date();
  const currentMonth = formatForecastStartMonth(now);
  const horizon = input.horizonMonthKeys;
  if (horizon.length === 0) {
    return {
      status: 'empty_actual',
      forecastQty: 0,
      actualQty: 0,
      label: formatQtyTotalsLabel('empty_actual', 0, 0),
    };
  }
  if (horizon.some((m) => m >= currentMonth)) {
    return {
      status: 'in_progress',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('in_progress', input.forecastQty, input.actualQty),
    };
  }
  if (input.actualQty <= 0) {
    return {
      status: 'empty_actual',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('empty_actual', input.forecastQty, input.actualQty),
    };
  }
  return {
    status: 'ready',
    forecastQty: input.forecastQty,
    actualQty: input.actualQty,
    label: formatQtyTotalsLabel('ready', input.forecastQty, input.actualQty),
  };
}

/** 仅保留严格早于当前 UTC 自然月的 horizon 月份键（已完成月份） */
export function filterCompletedMonthKeys(horizonMonthKeys: string[], now = new Date()): string[] {
  const currentMonth = formatForecastStartMonth(now);
  return horizonMonthKeys.filter((m) => m < currentMonth);
}

const DEFAULT_VERSION_MONTH_COUNT = 6;

/**
 * 汇总某预测版本地平线内的预测/实际销量总量。
 * - 版本不存在 → null
 * - horizon 含当前/未来月 → in_progress（提前返回，跳过实际销量扫描）
 * - 已完成月份无实际销量 → empty_actual
 * - 否则 → ready
 */
export async function getVersionQtyTotals(
  versionId: string,
  now: Date = new Date(),
): Promise<ForecastQtyTotalsResult | null> {
  const version = await getForecastVersionById(versionId);
  if (!version) return null;

  const rows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    );

  const distinctMonths = Array.from(
    new Set(rows.map((r) => monthKey(r.forecastYear, r.month))),
  );
  const monthCount =
    distinctMonths.length > 0
      ? distinctMonths.length
      : version.startMonth
        ? DEFAULT_VERSION_MONTH_COUNT
        : 0;

  const horizonMonthKeys = resolveHorizonMonthKeys({
    distinctMonths,
    startMonth: version.startMonth ?? null,
    monthCount,
    now,
  });

  const preliminary = buildForecastQtyTotalsResult({
    horizonMonthKeys,
    forecastQty: 0,
    actualQty: 0,
    now,
  });
  if (preliminary.status === 'in_progress') {
    return preliminary;
  }

  const completedKeys = new Set(filterCompletedMonthKeys(horizonMonthKeys, now));
  if (completedKeys.size === 0) {
    return preliminary;
  }

  let forecastQty = 0;
  let actualQty = 0;
  for (const row of rows) {
    const key = monthKey(row.forecastYear, row.month);
    if (!completedKeys.has(key)) continue;

    const dim = daysInCalendarMonth(row.forecastYear, row.month);
    forecastQty += Number(row.forecastDailyAvg) * dim;

    const actual = await resolveActualMonthlyDailyAvg({
      skuId: row.skuId,
      channel: row.platform,
      year: row.forecastYear,
      month: row.month,
    });
    actualQty += actual.actualDaily * dim;
  }

  return buildForecastQtyTotalsResult({
    horizonMonthKeys,
    forecastQty: Math.round(forecastQty),
    actualQty: Math.round(actualQty),
    now,
  });
}
