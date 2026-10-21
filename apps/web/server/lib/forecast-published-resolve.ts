import { and, eq, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';
import {
  aggregateForecastP90Rows,
  aggregateForecastRows,
  mapForecastDailyFields,
  resolveT99ReplenishmentFallbackDaily,
  type HorizonDemandSource,
} from './forecast-demand.js';
import { profileClassFromSegment } from './forecast-profile-class.js';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';

export type PublishedForecastEntry = {
  map: Map<string, number>;
  lifecycle?: string;
  versionId: string | null;
  profileSegment?: string;
  /** 分层字母，供第 3–6 月远月缓冲使用。 */
  profileClass?: string | null;
  /** 全站 P90 日均，月 key 与 map 相同。 */
  p90Map?: Map<string, number>;

  /** 若任一 T99 月用了近期动销兜底，标记便于补货审计 */
  demandSource?: HorizonDemandSource;
};

/** 已发布版本无 t99FloorDiscount 时冻结为 0.6，避免静默套用新生成默认 0.8 */
export const T99_PUBLISHED_FALLBACK_LEGACY_DISCOUNT = 0.6;

export function resolveT99FallbackDiscountFromFactors(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return T99_PUBLISHED_FALLBACK_LEGACY_DISCOUNT;
  const discount = Number((raw as Record<string, unknown>).t99FloorDiscount);
  if (Number.isFinite(discount) && discount > 0) return discount;
  return T99_PUBLISHED_FALLBACK_LEGACY_DISCOUNT;
}

function t99FallbackFromHorizonFactors(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const value = raw as Record<string, unknown>;
  const recent30 = Number(value.recent30DailyAvg);
  const recent90 = Number(value.recent90DailyAvg);
  return resolveT99ReplenishmentFallbackDaily({
    recent30DailyAvg: Number.isFinite(recent30) ? recent30 : null,
    recent90DailyAvg: Number.isFinite(recent90) ? recent90 : null,
    discount: resolveT99FallbackDiscountFromFactors(raw),
  });
}

/** 纯函数：同一 SKU 在多个已发布版本中取 publishedAt 最新者 */
export function pickLatestPublishedVersionPerSku(
  rows: Array<{ skuId: string; versionId: string; publishedAt: Date | null }>,
): Map<string, string> {
  const best = new Map<string, { versionId: string; publishedAt: number }>();
  for (const row of rows) {
    const ts = row.publishedAt?.getTime() ?? 0;
    const prev = best.get(row.skuId);
    if (!prev || ts > prev.publishedAt) {
      best.set(row.skuId, { versionId: row.versionId, publishedAt: ts });
    }
  }
  return new Map([...best.entries()].map(([skuId, item]) => [skuId, item.versionId]));
}

const SKU_IN_CHUNK = 2000;

export async function resolvePublishedVersionIdBySkuIds(
  skuIds: string[],
  station: string = FORECAST_GLOBAL_STATION,
): Promise<Map<string, string>> {
  if (!skuIds.length) return new Map();

  const rows: Array<{
    skuId: string;
    versionId: string | null;
    publishedAt: Date | null;
  }> = [];

  for (let offset = 0; offset < skuIds.length; offset += SKU_IN_CHUNK) {
    const chunk = skuIds.slice(offset, offset + SKU_IN_CHUNK);
    const chunkRows = await db
      .selectDistinct({
        skuId: salesForecastMonthly.skuId,
        versionId: salesForecastMonthly.versionId,
        publishedAt: salesForecastVersions.publishedAt,
      })
      .from(salesForecastMonthly)
      .innerJoin(
        salesForecastVersions,
        and(
          eq(salesForecastVersions.id, salesForecastMonthly.versionId),
          eq(salesForecastVersions.status, 'published'),
        ),
      )
      .where(
        and(
          inArray(salesForecastMonthly.skuId, chunk),
          eq(salesForecastMonthly.station, station),
        ),
      );
    rows.push(...chunkRows);
  }

  return pickLatestPublishedVersionPerSku(
    rows
      .filter((row): row is typeof row & { versionId: string } => Boolean(row.versionId))
      .map((row) => ({
        skuId: row.skuId,
        versionId: row.versionId,
        publishedAt: row.publishedAt,
      })),
  );
}

export async function resolvePublishedVersionIdForSku(
  skuId: string,
  station: string = FORECAST_GLOBAL_STATION,
): Promise<string | null> {
  const map = await resolvePublishedVersionIdBySkuIds([skuId], station);
  return map.get(skuId) ?? null;
}

export async function loadMergedPublishedForecastBySkuIds(
  skuIds: string[],
  station: string = FORECAST_GLOBAL_STATION,
): Promise<Map<string, PublishedForecastEntry>> {
  const result = new Map<string, PublishedForecastEntry>();
  if (!skuIds.length) return result;

  const versionBySkuId = await resolvePublishedVersionIdBySkuIds(skuIds, station);
  const empty: PublishedForecastEntry = { map: new Map(), lifecycle: undefined, versionId: null };

  for (const skuId of skuIds) {
    if (!versionBySkuId.has(skuId)) {
      result.set(skuId, empty);
    }
  }

  const skuIdsByVersion = new Map<string, string[]>();
  for (const [skuId, versionId] of versionBySkuId) {
    const list = skuIdsByVersion.get(versionId) ?? [];
    list.push(skuId);
    skuIdsByVersion.set(versionId, list);
  }

  for (const [versionId, ids] of skuIdsByVersion) {
    const rowsBySku = new Map<
      string,
      Array<{
        skuId: string;
        forecastYear: number;
        month: number;
        forecastDailyAvg: string | null;
        manualDailyAvg: string | null;
        lifecycle: string | null;
        platform: string | null;
        profileSegment: string | null;
        horizonFactors: unknown;
        forecastDailyP90: string | null;
      }>
    >();

    for (let offset = 0; offset < ids.length; offset += SKU_IN_CHUNK) {
      const chunk = ids.slice(offset, offset + SKU_IN_CHUNK);
      const rows = await db
        .select({
          skuId: salesForecastMonthly.skuId,
          forecastYear: salesForecastMonthly.forecastYear,
          month: salesForecastMonthly.month,
          forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
          manualDailyAvg: salesForecastMonthly.manualDailyAvg,
          lifecycle: salesForecastMonthly.lifecycle,
          platform: salesForecastMonthly.platform,
          profileSegment: salesForecastMonthly.profileSegment,
          horizonFactors: salesForecastMonthly.horizonFactors,
          forecastDailyP90: salesForecastMonthly.forecastDailyP90,
        })
        .from(salesForecastMonthly)
        .where(
          and(
            eq(salesForecastMonthly.versionId, versionId),
            eq(salesForecastMonthly.station, station),
            inArray(salesForecastMonthly.skuId, chunk),
          ),
        );
      for (const row of rows) {
        const list = rowsBySku.get(row.skuId) ?? [];
        list.push(row);
        rowsBySku.set(row.skuId, list);
      }
    }

    for (const skuId of ids) {
      const skuRows = rowsBySku.get(skuId) ?? [];
      const lifecycle = skuRows.find((r) => r.lifecycle)?.lifecycle ?? undefined;
      const profileSegment = [...skuRows]
        .sort((left, right) => right.forecastYear * 100 + right.month - (left.forecastYear * 100 + left.month))
        .map((row) => row.profileSegment?.trim())
        .find((segment) => segment);
      let usedT99Fallback = false;
      const map = aggregateForecastRows(
        skuRows.map((r) => {
          const daily = mapForecastDailyFields({
            forecastDailyAvg: r.forecastDailyAvg,
            manualDailyAvg: r.manualDailyAvg,
          });
          let forecastDailyAvg = daily.effectiveDailyAvg;
          if (
            forecastDailyAvg <= 0 &&
            (r.profileSegment ?? '').trim().toUpperCase() === 'T99'
          ) {
            const fallback = t99FallbackFromHorizonFactors(r.horizonFactors);
            if (fallback > 0) {
              forecastDailyAvg = fallback;
              usedT99Fallback = true;
            }
          }
          return {
            forecastYear: r.forecastYear,
            month: r.month,
            forecastDailyAvg,
            platform: r.platform,
          };
        }),
      );
      const p90Map = aggregateForecastP90Rows(
        skuRows.map((row) => ({
          forecastYear: row.forecastYear,
          month: row.month,
          forecastDailyP90: Number(row.forecastDailyP90),
          platform: row.platform,
        })),
      );
      result.set(skuId, {
        map,
        lifecycle,
        profileSegment,
        profileClass: profileClassFromSegment(profileSegment),
        p90Map,
        versionId,
        demandSource: usedT99Fallback ? 't99_fallback' : 'forecast',
      });
    }
  }

  return result;
}
