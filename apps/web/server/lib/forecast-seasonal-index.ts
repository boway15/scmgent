import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, salesForecastSeasonalIndex, salesHistoryMonthly, skus } from '@scm/db';
import {
  loadForecastCalibrationConfig,
  type SeasonalIndexConfig,
} from './forecast-profile-config.js';

export const SEASONAL_INDEX_METHOD = 'like_for_like_chain_v1';
export const SEASONAL_INDEX_LEVELS = ['station', 'project_group', 'category'] as const;
export type SeasonalIndexLevel = (typeof SEASONAL_INDEX_LEVELS)[number] | 'flat';

export type SeasonalSalePoint = {
  skuId: string;
  year: number;
  month: number;
  qty: number;
  category: string;
  projectGroup: string;
  station: string;
};

export type SeasonalIndexSeries = {
  byMonth: Record<number, number>;
  sampleQty: number;
};

export type ResolvedSeasonalIndex = {
  byMonth: Record<number, number>;
  level: SeasonalIndexLevel;
  sampleQty: number;
  dimensionValue: string;
  station: string;
};

type RawSeries = SeasonalIndexSeries & {
  level: Exclude<SeasonalIndexLevel, 'flat'>;
  dimensionValue: string;
  station: string;
};

export type SeasonalIndexContext = {
  historyCapEnd: string;
  asOfMonth: string;
  k: number;
  clipMin: number;
  clipMax: number;
  series: RawSeries[];
  resolve(input: {
    category?: string | null;
    projectGroup?: string | null;
    salesCountry?: string | null;
    station?: string | null;
  }): ResolvedSeasonalIndex;
};

const contextCache = new Map<string, Promise<SeasonalIndexContext>>();

export function clearSeasonalIndexContextCache(): void {
  contextCache.clear();
}

export function flatSeasonalMonths(): Record<number, number> {
  const byMonth: Record<number, number> = {};
  for (let month = 1; month <= 12; month += 1) byMonth[month] = 1;
  return byMonth;
}

export function resolveSkuSeasonStation(input: {
  salesCountry?: string | null;
  projectGroup?: string | null;
  station?: string | null;
}): string {
  const explicit = input.station?.trim().toUpperCase();
  if (explicit && explicit !== 'ALL' && explicit !== 'GLOBAL') return explicit;
  const country = input.salesCountry?.trim().toUpperCase();
  if (country && /^[A-Z]{2,3}$/.test(country)) return country === 'DE' ? 'EU' : country;
  const tail = input.projectGroup?.trim().split('-').pop()?.trim().toUpperCase() ?? '';
  if (tail === 'US' || tail === 'EU' || tail === 'UK' || tail === 'CA') return tail;
  if (tail === 'DE') return 'EU';
  return 'ALL';
}

function clipIndex(value: number, clipMin: number, clipMax: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(clipMax, Math.max(clipMin, value));
}

function roundIndex(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function calendarMonth(index: number): number {
  return (index % 12) + 1;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = monthIndex(year, month) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

type Bucket = { num: number; den: number };

function emptyBuckets(): Bucket[] {
  return Array.from({ length: 13 }, () => ({ num: 0, den: 0 }));
}

function addPoint(buckets: Bucket[], month: number, qty: number, prevQty: number): void {
  const bucket = buckets[month];
  if (!bucket) return;
  bucket.num += qty;
  bucket.den += prevQty;
}

/** 同口径链式季节指数。样本量不足时返回 null。 */
export function computeLikeForLikeSeasonalIndex(
  points: Array<Pick<SeasonalSalePoint, 'skuId' | 'year' | 'month' | 'qty'>>,
  capYear: number,
  capMonth: number,
  options?: { minAgeMonths?: number; forwardMonths?: number; minCoveredMonths?: number },
): SeasonalIndexSeries | null {
  const minAgeMonths = options?.minAgeMonths ?? 3;
  const forwardMonths = options?.forwardMonths ?? 2;
  const minCoveredMonths = options?.minCoveredMonths ?? 8;
  const capIdx = monthIndex(capYear, capMonth);
  const windowStart = capIdx - 23;
  const bySku = new Map<string, Map<number, number>>();

  for (const point of points) {
    const qty = Number(point.qty) || 0;
    if (qty <= 0) continue;
    const idx = monthIndex(point.year, point.month);
    if (idx < windowStart || idx > capIdx) continue;
    const series = bySku.get(point.skuId) ?? new Map<number, number>();
    series.set(idx, (series.get(idx) ?? 0) + qty);
    bySku.set(point.skuId, series);
  }

  const buckets = emptyBuckets();
  for (const series of bySku.values()) {
    let first = Number.POSITIVE_INFINITY;
    for (const idx of series.keys()) first = Math.min(first, idx);
    if (first === windowStart) first = windowStart - minAgeMonths;

    for (let target = windowStart + 1; target <= capIdx - forwardMonths; target += 1) {
      const prev = series.get(target - 1) ?? 0;
      const current = series.get(target) ?? 0;
      const next1 = series.get(target + 1) ?? 0;
      const next2 = series.get(target + 2) ?? 0;
      if (prev <= 0 || current <= 0 || next1 <= 0 || next2 <= 0) continue;
      if (first > target - minAgeMonths) continue;
      addPoint(buckets, calendarMonth(target), current, prev);
    }
  }

  const ratioInto: Record<number, number> = {};
  let covered = 0;
  let sampleQty = 0;
  for (let month = 1; month <= 12; month += 1) {
    const bucket = buckets[month]!;
    sampleQty += bucket.den;
    if (bucket.den > 0 && bucket.num > 0) {
      ratioInto[month] = bucket.num / bucket.den;
      covered += 1;
    }
  }
  if (covered < minCoveredMonths || sampleQty <= 0) return null;

  const raw: Record<number, number> = { 1: 1 };
  for (let month = 2; month <= 12; month += 1) {
    raw[month] = raw[month - 1]! * (ratioInto[month] ?? 1);
  }
  const nextJanuary = raw[12]! * (ratioInto[1] ?? 1);
  const drift = nextJanuary > 0 ? Math.pow(nextJanuary, 1 / 12) : 1;
  const adjusted: Record<number, number> = {};
  let sum = 0;
  for (let month = 1; month <= 12; month += 1) {
    const value = raw[month]! / Math.pow(drift, month - 1);
    adjusted[month] = value > 0 ? value : 1;
    sum += adjusted[month]!;
  }
  const mean = sum / 12 || 1;
  const byMonth: Record<number, number> = {};
  for (let month = 1; month <= 12; month += 1) {
    byMonth[month] = roundIndex(adjusted[month]! / mean);
  }
  return { byMonth, sampleQty: Math.round(sampleQty) };
}

export function shrinkSeasonalIndex(input: {
  child: Record<number, number> | null;
  childSampleQty: number;
  parent: Record<number, number>;
  k: number;
  clipMin: number;
  clipMax: number;
}): Record<number, number> {
  const sample = Math.max(0, input.childSampleQty);
  const weight = input.child && sample > 0 ? sample / (sample + Math.max(1, input.k)) : 0;
  const byMonth: Record<number, number> = {};
  for (let month = 1; month <= 12; month += 1) {
    const child = input.child?.[month] ?? input.parent[month] ?? 1;
    const parent = input.parent[month] ?? 1;
    byMonth[month] = roundIndex(clipIndex(weight * child + (1 - weight) * parent, input.clipMin, input.clipMax));
  }
  return byMonth;
}

function seriesKey(level: string, station: string, dimensionValue: string): string {
  return `${level}::${station}::${dimensionValue}`;
}

export function buildSeasonalIndexSeries(input: {
  points: SeasonalSalePoint[];
  capYear: number;
  capMonth: number;
  minAgeMonths?: number;
  forwardMonths?: number;
}): RawSeries[] {
  const groups = new Map<string, { meta: Omit<RawSeries, 'byMonth' | 'sampleQty'>; points: SeasonalSalePoint[] }>();
  const push = (
    level: Exclude<SeasonalIndexLevel, 'flat'>,
    station: string,
    dimensionValue: string,
    point: SeasonalSalePoint,
  ) => {
    const key = seriesKey(level, station, dimensionValue);
    const group = groups.get(key) ?? {
      meta: { level, station, dimensionValue },
      points: [],
    };
    group.points.push(point);
    groups.set(key, group);
  };

  for (const point of input.points) {
    const station = point.station || 'ALL';
    const projectGroup = point.projectGroup.trim() || '(未分组)';
    const category = point.category.trim() || '(未分类)';
    push('station', station, station, point);
    push('project_group', station, projectGroup, point);
    push('category', station, `${projectGroup}||${category}`, point);
  }

  const series: RawSeries[] = [];
  for (const group of groups.values()) {
    const computed = computeLikeForLikeSeasonalIndex(group.points, input.capYear, input.capMonth, {
      minAgeMonths: input.minAgeMonths,
      forwardMonths: input.forwardMonths,
    });
    if (!computed) continue;
    series.push({ ...group.meta, ...computed });
  }
  return series;
}

export function createSeasonalIndexContext(input: {
  historyCapEnd: Date;
  series: RawSeries[];
  config?: SeasonalIndexConfig;
}): SeasonalIndexContext {
  const config = input.config ?? loadForecastCalibrationConfig().seasonalIndex ?? {};
  const k = config.k ?? 20000;
  const clipMin = config.clipMin ?? 0.6;
  const clipMax = config.clipMax ?? 1.8;
  const cap = monthOf(input.historyCapEnd);
  const lookup = new Map(input.series.map((row) => [seriesKey(row.level, row.station, row.dimensionValue), row]));

  return {
    historyCapEnd: input.historyCapEnd.toISOString().slice(0, 10),
    asOfMonth: `${cap.year}-${String(cap.month).padStart(2, '0')}`,
    k,
    clipMin,
    clipMax,
    series: input.series,
    resolve(sku) {
      const station = resolveSkuSeasonStation(sku);
      const projectGroup = sku.projectGroup?.trim() || '(未分组)';
      const category = sku.category?.trim() || '(未分类)';
      const flat = flatSeasonalMonths();
      const stationRaw = lookup.get(seriesKey('station', station, station));
      const stationMonths = shrinkSeasonalIndex({
        child: stationRaw?.byMonth ?? null,
        childSampleQty: stationRaw?.sampleQty ?? 0,
        parent: flat,
        k,
        clipMin,
        clipMax,
      });
      const projectRaw = lookup.get(seriesKey('project_group', station, projectGroup));
      const projectMonths = shrinkSeasonalIndex({
        child: projectRaw?.byMonth ?? null,
        childSampleQty: projectRaw?.sampleQty ?? 0,
        parent: stationMonths,
        k,
        clipMin,
        clipMax,
      });
      const categoryRaw = lookup.get(seriesKey('category', station, `${projectGroup}||${category}`));
      const categoryMonths = shrinkSeasonalIndex({
        child: categoryRaw?.byMonth ?? null,
        childSampleQty: categoryRaw?.sampleQty ?? 0,
        parent: projectMonths,
        k,
        clipMin,
        clipMax,
      });
      if ((categoryRaw?.sampleQty ?? 0) > 0) {
        return {
          byMonth: categoryMonths,
          level: 'category',
          sampleQty: categoryRaw!.sampleQty,
          dimensionValue: `${projectGroup}||${category}`,
          station,
        };
      }
      if ((projectRaw?.sampleQty ?? 0) > 0) {
        return {
          byMonth: projectMonths,
          level: 'project_group',
          sampleQty: projectRaw!.sampleQty,
          dimensionValue: projectGroup,
          station,
        };
      }
      if ((stationRaw?.sampleQty ?? 0) > 0) {
        return {
          byMonth: stationMonths,
          level: 'station',
          sampleQty: stationRaw!.sampleQty,
          dimensionValue: station,
          station,
        };
      }
      return {
        byMonth: flat,
        level: 'flat',
        sampleQty: 0,
        dimensionValue: station,
        station,
      };
    },
  };
}

export function monthOf(date: Date): { year: number; month: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function historyCapEndFromStartMonth(startMonth: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(startMonth.trim());
  if (!match) throw new Error(`非法开始月: ${startMonth}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 0));
}

export function meanSeasonalIndex(
  byMonth: Record<number, number>,
  endYear: number,
  endMonth: number,
  count: number,
): number {
  let sum = 0;
  let year = endYear;
  let month = endMonth;
  const n = Math.max(1, count);
  for (let i = 0; i < n; i += 1) {
    sum += byMonth[month] ?? 1;
    const prev = shiftMonth(year, month, -1);
    year = prev.year;
    month = prev.month;
  }
  return sum / n;
}

export async function buildSeasonalIndexContext(input: {
  historyCapEnd: Date;
  config?: SeasonalIndexConfig;
}): Promise<SeasonalIndexContext> {
  const config = input.config ?? loadForecastCalibrationConfig().seasonalIndex;
  const cap = monthOf(input.historyCapEnd);
  const cacheKey = [
    cap.year,
    cap.month,
    config?.k ?? 20000,
    config?.clipMin ?? 0.6,
    config?.clipMax ?? 1.8,
    config?.minAgeMonths ?? 3,
    config?.forwardMonths ?? 2,
  ].join('|');
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;

  const pending = loadSeasonalIndexContext(input.historyCapEnd, config).catch((err) => {
    contextCache.delete(cacheKey);
    throw err;
  });
  contextCache.set(cacheKey, pending);
  return pending;
}

async function loadSeasonalIndexContext(
  historyCapEnd: Date,
  config: SeasonalIndexConfig | undefined,
): Promise<SeasonalIndexContext> {
  const cap = monthOf(historyCapEnd);
  const start = shiftMonth(cap.year, cap.month, -23);
  const startKey = start.year * 100 + start.month;
  const endKey = cap.year * 100 + cap.month;
  const rows = await db
    .select({
      skuId: salesHistoryMonthly.skuId,
      year: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qty: sql<number>`sum(${salesHistoryMonthly.qtySold})::int`,
      category: sql<string>`coalesce(nullif(${salesHistoryMonthly.category}, ''), ${skus.category}, '')`,
      projectGroup: sql<string>`coalesce(${skus.projectGroup}, '')`,
      salesCountry: sql<string>`coalesce(${skus.salesCountry}, '')`,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId))
    .where(
      and(
        gte(sql`${salesHistoryMonthly.saleYear} * 100 + ${salesHistoryMonthly.month}`, startKey),
        lte(sql`${salesHistoryMonthly.saleYear} * 100 + ${salesHistoryMonthly.month}`, endKey),
      ),
    )
    .groupBy(
      salesHistoryMonthly.skuId,
      salesHistoryMonthly.saleYear,
      salesHistoryMonthly.month,
      sql`coalesce(nullif(${salesHistoryMonthly.category}, ''), ${skus.category}, '')`,
      skus.projectGroup,
      skus.salesCountry,
    );

  const points: SeasonalSalePoint[] = rows.map((row) => ({
    skuId: row.skuId,
    year: row.year,
    month: row.month,
    qty: Number(row.qty) || 0,
    category: row.category ?? '',
    projectGroup: row.projectGroup ?? '',
    station: resolveSkuSeasonStation({
      salesCountry: row.salesCountry,
      projectGroup: row.projectGroup,
    }),
  }));
  const series = buildSeasonalIndexSeries({
    points,
    capYear: cap.year,
    capMonth: cap.month,
    minAgeMonths: config?.minAgeMonths,
    forwardMonths: config?.forwardMonths,
  });
  return createSeasonalIndexContext({ historyCapEnd, series, config });
}

export async function persistSeasonalIndexSnapshot(context: SeasonalIndexContext): Promise<number> {
  await db
    .delete(salesForecastSeasonalIndex)
    .where(eq(salesForecastSeasonalIndex.asOfMonth, context.asOfMonth));

  const values = context.series.flatMap((series) =>
    Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return {
        asOfMonth: context.asOfMonth,
        dimensionLevel: series.level,
        dimensionValue: series.dimensionValue,
        station: series.station,
        month,
        indexValue: String(series.byMonth[month] ?? 1),
        sampleQty: String(series.sampleQty),
        method: SEASONAL_INDEX_METHOD,
      };
    }),
  );

  const batchSize = 500;
  for (let offset = 0; offset < values.length; offset += batchSize) {
    await db.insert(salesForecastSeasonalIndex).values(values.slice(offset, offset + batchSize));
  }
  return values.length;
}
