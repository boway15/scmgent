import { eq, and, inArray } from 'drizzle-orm';
import { db, salesForecastMonthly, inventoryHealthSnapshots } from '@scm/db';
import { getForecastVersionById } from './forecast-version.js';
import { aggregateForecastRows } from './forecast-demand.js';

export type ForecastImpactPreview = {
  versionId: string;
  versionName: string;
  station: string | null;
  skuCount: number;
  forecastRowCount: number;
  lowConfidenceCount: number;
  redSkuCount: number;
  yellowSkuCount: number;
  pendingSuggestionCount: number;
  summary: string;
};

export async function buildForecastImpactPreview(versionId: string): Promise<ForecastImpactPreview> {
  const version = await getForecastVersionById(versionId);
  if (!version) throw new Error('Forecast version not found');

  const forecastRows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      confidenceLevel: salesForecastMonthly.confidenceLevel,
    })
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.versionId, versionId));

  const skuIds = [...new Set(forecastRows.map((r) => r.skuId))];
  const lowConfidenceCount = forecastRows.filter(
    (r) => r.confidenceLevel === 'low',
  ).length;

  let redSkuCount = 0;
  let yellowSkuCount = 0;
  if (skuIds.length) {
    const healthRows = await db
      .select({
        skuId: inventoryHealthSnapshots.skuId,
        healthStatus: inventoryHealthSnapshots.healthStatus,
        computedAt: inventoryHealthSnapshots.computedAt,
      })
      .from(inventoryHealthSnapshots)
      .where(inArray(inventoryHealthSnapshots.skuId, skuIds))
      .orderBy(inventoryHealthSnapshots.computedAt);

    const latestBySku = new Map<string, string>();
    for (const row of healthRows) {
      latestBySku.set(row.skuId, row.healthStatus);
    }
    for (const status of latestBySku.values()) {
      if (status === 'red') redSkuCount++;
      if (status === 'yellow') yellowSkuCount++;
    }
  }

  const stationSet = new Set(forecastRows.map((r) => r.station));
  const summaryLines = [
    `版本「${version.versionName}」将影响 ${skuIds.length} 个 SKU 的补货需求口径。`,
    `预测明细 ${forecastRows.length} 行，低置信度 ${lowConfidenceCount} 行。`,
    `关联库存健康：红灯 ${redSkuCount} SKU，黄灯 ${yellowSkuCount} SKU。`,
    '发布后请运行补货预测任务以刷新建议。',
  ];

  return {
    versionId,
    versionName: version.versionName,
    station: version.station,
    skuCount: skuIds.length,
    forecastRowCount: forecastRows.length,
    lowConfidenceCount,
    redSkuCount,
    yellowSkuCount,
    pendingSuggestionCount: 0,
    summary: summaryLines.join('\n'),
  };
}

/** 对比两版本预测差异（用于发布前预览） */
export async function compareForecastDemandChange(params: {
  versionId: string;
  baselineVersionId: string;
  station?: string;
}): Promise<{ changedSkuCount: number; avgDeltaPct: number }> {
  const loadMap = async (versionId: string) => {
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
        params.station
          ? and(
              eq(salesForecastMonthly.versionId, versionId),
              eq(salesForecastMonthly.station, params.station),
            )
          : eq(salesForecastMonthly.versionId, versionId),
      );

    const bySku = new Map<string, number[]>();
    for (const row of rows) {
      const map = aggregateForecastRows([
        {
          forecastYear: row.forecastYear,
          month: row.month,
          forecastDailyAvg: Number(row.forecastDailyAvg),
          platform: row.platform,
        },
      ]);
      const avg =
        map.size > 0
          ? [...map.values()].reduce((s, v) => s + v, 0) / map.size
          : 0;
      const list = bySku.get(row.skuId) ?? [];
      list.push(avg);
      bySku.set(row.skuId, list);
    }
    const result = new Map<string, number>();
    for (const [skuId, vals] of bySku) {
      result.set(skuId, vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    return result;
  };

  const [nextMap, baseMap] = await Promise.all([
    loadMap(params.versionId),
    loadMap(params.baselineVersionId),
  ]);

  let changed = 0;
  let deltaSum = 0;
  for (const [skuId, nextAvg] of nextMap) {
    const baseAvg = baseMap.get(skuId) ?? 0;
    if (baseAvg <= 0 && nextAvg <= 0) continue;
    const delta = baseAvg > 0 ? Math.abs(nextAvg - baseAvg) / baseAvg : 1;
    if (delta > 0.05) changed++;
    deltaSum += delta;
  }

  return {
    changedSkuCount: changed,
    avgDeltaPct: changed > 0 ? deltaSum / changed : 0,
  };
}
