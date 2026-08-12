import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, forecastAccuracyMonthly, salesForecastMonthly, salesHistoryMonthly } from '@scm/db';
import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { formatForecastStartMonth, resolveForecastStartMonthAsOf } from './forecast-start-month.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { getForecastVersionById } from './forecast-version.js';

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

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

const DEFAULT_VERSION_MONTH_COUNT = 6;

/**
 * 解析版本预测地平线内、已结束的自然月（与「按开始月复盘回测」对齐）。
 * 优先用版本预测行去重月份；无行时回退 startMonth + 默认月数。
 */
export async function listVersionCompletedBacktestMonths(
  versionId: string,
  now: Date = new Date(),
): Promise<Array<{ year: number; month: number }>> {
  const version = await getForecastVersionById(versionId);
  if (!version) return [];

  const monthRows = await db
    .selectDistinct({
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId));

  const distinctMonths = monthRows
    .map((r) => monthKey(r.forecastYear, r.month))
    .sort();
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

  return filterCompletedMonthKeys(horizonMonthKeys, now)
    .map(parseMonthKey)
    .filter((row): row is { year: number; month: number } => row != null);
}

function monthSerialConditions(
  yearCol: typeof salesForecastMonthly.forecastYear,
  monthCol: typeof salesForecastMonthly.month,
  completed: Array<{ year: number; month: number }>,
) {
  if (completed.length === 0) return sql`false`;
  return or(
    ...completed.map((m) => and(eq(yearCol, m.year), eq(monthCol, m.month))),
  )!;
}

/**
 * 汇总某预测版本地平线内的预测/实际销量总量。
 * - 版本不存在 → null
 * - horizon 含当前/未来月 → in_progress（提前返回，跳过实际销量扫描）
 * - 已完成月份无实际销量 → empty_actual
 * - 否则 → ready
 * - 实际销量仅累计 forecast>0 行（漏报不进合计）；优先用准确率表，与诊断面板口径对齐
 */
export async function getVersionQtyTotals(
  versionId: string,
  now: Date = new Date(),
): Promise<ForecastQtyTotalsResult | null> {
  const version = await getForecastVersionById(versionId);
  if (!version) return null;

  const monthRows = await db
    .selectDistinct({
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
    })
    .from(salesForecastMonthly)
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    );

  const distinctMonths = monthRows.map((r) => monthKey(r.forecastYear, r.month)).sort();
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

  const completed = filterCompletedMonthKeys(horizonMonthKeys, now)
    .map(parseMonthKey)
    .filter((row): row is { year: number; month: number } => row != null);
  if (completed.length === 0) {
    return preliminary;
  }

  const daysExpr = sql`extract(day from (make_date(${salesForecastMonthly.forecastYear}, ${salesForecastMonthly.month}, 1) + interval '1 month' - interval '1 day'))`;
  const completedCond = monthSerialConditions(
    salesForecastMonthly.forecastYear,
    salesForecastMonthly.month,
    completed,
  );

  // 优先准确率表：仅 forecast>0（漏报不进预测/实际合计），与诊断分层一致
  const accuracyDays = sql`extract(day from (make_date(${forecastAccuracyMonthly.forecastYear}, ${forecastAccuracyMonthly.month}, 1) + interval '1 month' - interval '1 day'))`;
  const accuracyCompleted = monthSerialConditions(
    forecastAccuracyMonthly.forecastYear,
    forecastAccuracyMonthly.month,
    completed,
  );
  const accuracyPredictedOnly = sql`${forecastAccuracyMonthly.forecastDailyAvg}::float8 > 0`;
  const [accuracyAgg] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      forecastQty: sql<number>`coalesce(sum(${forecastAccuracyMonthly.forecastDailyAvg}::float8 * ${accuracyDays}), 0)`,
      actualQty: sql<number>`coalesce(sum(${forecastAccuracyMonthly.actualDailyAvg}::float8 * ${accuracyDays}), 0)`,
    })
    .from(forecastAccuracyMonthly)
    .where(
      and(
        eq(forecastAccuracyMonthly.versionId, versionId),
        accuracyCompleted,
        accuracyPredictedOnly,
      ),
    );

  if ((accuracyAgg?.rows ?? 0) > 0) {
    return buildForecastQtyTotalsResult({
      horizonMonthKeys,
      forecastQty: Math.round(Number(accuracyAgg.forecastQty) || 0),
      actualQty: Math.round(Number(accuracyAgg.actualQty) || 0),
      now,
    });
  }

  // 无准确率行时回退矩阵：预测全量；实际仅 forecast>0（漏报不计）
  const [matrixAgg] = await db
    .select({
      forecastQty: sql<number>`coalesce(sum(${salesForecastMonthly.forecastDailyAvg}::float8 * ${daysExpr}), 0)`,
      actualQty: sql<number>`coalesce(sum(case
        when ${salesForecastMonthly.forecastDailyAvg}::float8 > 0
        then coalesce(${salesHistoryMonthly.qtySold}, 0)::float8
        else 0 end), 0)`,
    })
    .from(salesForecastMonthly)
    .leftJoin(
      salesHistoryMonthly,
      and(
        eq(salesHistoryMonthly.skuId, salesForecastMonthly.skuId),
        eq(salesHistoryMonthly.channel, salesForecastMonthly.platform),
        eq(salesHistoryMonthly.saleYear, salesForecastMonthly.forecastYear),
        eq(salesHistoryMonthly.month, salesForecastMonthly.month),
      ),
    )
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
        completedCond,
      ),
    );

  return buildForecastQtyTotalsResult({
    horizonMonthKeys,
    forecastQty: Math.round(Number(matrixAgg?.forecastQty) || 0),
    actualQty: Math.round(Number(matrixAgg?.actualQty) || 0),
    now,
  });
}
