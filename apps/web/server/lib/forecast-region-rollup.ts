export type ForecastLeafRow = {
  skuId: string;
  salesRegion: string;
  platform: string;
  forecastYear: number;
  month: number;
  effectiveDailyAvg: number;
};

export type ForecastRollupView =
  | 'region_platform'
  | 'region_all_platforms'
  | 'all_regions_platform'
  | 'all_regions_all_platforms';

export type ForecastRollupRow = {
  skuId: string;
  salesRegion: string | 'ALL';
  platform: string | 'ALL';
  forecastYear: number;
  month: number;
  effectiveDailyAvg: number;
};

function rollupKey(
  leaf: ForecastLeafRow,
  view: ForecastRollupView,
): { skuId: string; salesRegion: string | 'ALL'; platform: string | 'ALL'; forecastYear: number; month: number } {
  switch (view) {
    case 'region_platform':
      return {
        skuId: leaf.skuId,
        salesRegion: leaf.salesRegion,
        platform: leaf.platform,
        forecastYear: leaf.forecastYear,
        month: leaf.month,
      };
    case 'region_all_platforms':
      return {
        skuId: leaf.skuId,
        salesRegion: leaf.salesRegion,
        platform: 'ALL',
        forecastYear: leaf.forecastYear,
        month: leaf.month,
      };
    case 'all_regions_platform':
      return {
        skuId: leaf.skuId,
        salesRegion: 'ALL',
        platform: leaf.platform,
        forecastYear: leaf.forecastYear,
        month: leaf.month,
      };
    case 'all_regions_all_platforms':
      return {
        skuId: leaf.skuId,
        salesRegion: 'ALL',
        platform: 'ALL',
        forecastYear: leaf.forecastYear,
        month: leaf.month,
      };
  }
}

function keyString(key: ReturnType<typeof rollupKey>): string {
  return [key.skuId, key.salesRegion, key.platform, key.forecastYear, key.month].join('\0');
}

export function rollupForecastLeaves(leaves: ForecastLeafRow[], view: ForecastRollupView): ForecastRollupRow[] {
  const usable = leaves.filter((leaf) => leaf.salesRegion !== 'ALL');
  const sums = new Map<string, ForecastRollupRow>();

  for (const leaf of usable) {
    const key = rollupKey(leaf, view);
    const id = keyString(key);
    const existing = sums.get(id);
    if (existing) {
      existing.effectiveDailyAvg += leaf.effectiveDailyAvg;
    } else {
      sums.set(id, { ...key, effectiveDailyAvg: leaf.effectiveDailyAvg });
    }
  }

  return [...sums.values()];
}
