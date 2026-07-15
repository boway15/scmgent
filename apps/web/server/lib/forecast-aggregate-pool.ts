import { roundDaily } from './forecast-baseline.js';
import { classifyVolumeTier, type VolumeTier } from './forecast-eligibility.js';
import {
  classifyForecastProfile,
  type ProfileClass,
} from './forecast-profile-class.js';

export type PoolKey = string;

export type SkuPoolInput = {
  skuId: string;
  skuCode: string;
  category: string | null;
  station: string;
  platform: string;
  monthlyQty: number[];
  recent90DailyAvg: number;
};

export type PoolForecastInput = {
  poolKey: PoolKey;
  station: string;
  platform: string;
  categoryPath: string;
  skuRows: SkuPoolInput[];
  /** 品类池月预测日均（由调用方按近 6 月品类月均或趋势给出） */
  poolDailyForecast: number;
};

export type SkuSplitForecast = {
  skuId: string;
  skuCode: string;
  profileClass: ProfileClass;
  volumeTier: VolumeTier;
  share: number;
  forecastDailyAvg: number;
};

export function buildCategoryPoolKey(
  category: string | null | undefined,
  station: string,
  platform: string,
): PoolKey {
  const raw = category?.trim() ?? '';
  const segments = raw.split(/[|\\/]/).map((p) => p.trim()).filter(Boolean);
  const level2 =
    segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0] ?? '(无品类)';
  return `${level2}::${station.toUpperCase()}::${platform.toUpperCase()}`;
}

export function computeSkuShare6m(monthlyQty: number[]): number {
  const recent = monthlyQty.slice(-6);
  const sum = recent.reduce((s, q) => s + Math.max(0, q), 0);
  return sum;
}

export function splitPoolForecastToSkus(input: PoolForecastInput): SkuSplitForecast[] {
  const poolDaily = Math.max(0, input.poolDailyForecast);
  const shares = input.skuRows.map((row) => ({
    row,
    share: computeSkuShare6m(row.monthlyQty),
  }));
  const shareSum = shares.reduce((s, x) => s + x.share, 0);

  return shares.map(({ row, share }) => {
    const ratio = shareSum > 0 ? share / shareSum : 1 / Math.max(1, shares.length);
    const profileClass = classifyForecastProfile(row.monthlyQty);
    const avgDaily =
      row.monthlyQty.length > 0
        ? row.monthlyQty.reduce((s, q) => s + q, 0) / row.monthlyQty.length
        : row.recent90DailyAvg;
    const volumeTier = classifyVolumeTier(avgDaily);
    return {
      skuId: row.skuId,
      skuCode: row.skuCode,
      profileClass,
      volumeTier,
      share: ratio,
      forecastDailyAvg: roundDaily(poolDaily * ratio),
    };
  });
}

export function groupLongTailSkusByPool(
  rows: SkuPoolInput[],
): Map<PoolKey, SkuPoolInput[]> {
  const map = new Map<PoolKey, SkuPoolInput[]>();
  for (const row of rows) {
    const profile = classifyForecastProfile(row.monthlyQty);
    if (profile !== 'C') continue;
    const key = buildCategoryPoolKey(row.category, row.station, row.platform);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

export function computePoolDailyFromSkus(skuRows: SkuPoolInput[]): number {
  const total = skuRows.reduce((s, row) => s + row.recent90DailyAvg, 0);
  if (total > 0) return roundDaily(total);
  const monthly = skuRows.flatMap((r) => r.monthlyQty.slice(-6));
  if (!monthly.length) return 0;
  return roundDaily(monthly.reduce((s, q) => s + q, 0) / monthly.length / 30);
}
