import { and, eq, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';
import {
  aggregateForecastRows,
  mapForecastDailyFields,
} from './forecast-demand.js';
import { FORECAST_GLOBAL_STATION } from './forecast-station-scope.js';

export type PublishedForecastEntry = {
  map: Map<string, number>;
  lifecycle?: string;
  versionId: string | null;
};

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

export async function resolvePublishedVersionIdBySkuIds(
  skuIds: string[],
  station: string = FORECAST_GLOBAL_STATION,
): Promise<Map<string, string>> {
  if (!skuIds.length) return new Map();

  const rows = await db
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
        inArray(salesForecastMonthly.skuId, skuIds),
        eq(salesForecastMonthly.station, station),
      ),
    );

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
    const rows = await db
      .select({
        skuId: salesForecastMonthly.skuId,
        forecastYear: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
        forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
        manualDailyAvg: salesForecastMonthly.manualDailyAvg,
        lifecycle: salesForecastMonthly.lifecycle,
        platform: salesForecastMonthly.platform,
      })
      .from(salesForecastMonthly)
      .where(
        and(
          eq(salesForecastMonthly.versionId, versionId),
          eq(salesForecastMonthly.station, station),
          inArray(salesForecastMonthly.skuId, ids),
        ),
      );

    const rowsBySku = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = rowsBySku.get(row.skuId) ?? [];
      list.push(row);
      rowsBySku.set(row.skuId, list);
    }

    for (const skuId of ids) {
      const skuRows = rowsBySku.get(skuId) ?? [];
      const lifecycle = skuRows.find((r) => r.lifecycle)?.lifecycle ?? undefined;
      const map = aggregateForecastRows(
        skuRows.map((r) => {
          const daily = mapForecastDailyFields({
            forecastDailyAvg: r.forecastDailyAvg,
            manualDailyAvg: r.manualDailyAvg,
          });
          return {
            forecastYear: r.forecastYear,
            month: r.month,
            forecastDailyAvg: daily.effectiveDailyAvg,
            platform: r.platform,
          };
        }),
      );
      result.set(skuId, { map, lifecycle, versionId });
    }
  }

  return result;
}
