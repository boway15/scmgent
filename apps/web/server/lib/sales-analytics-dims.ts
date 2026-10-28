import { extractProjectGroupFromCategory, normalizeCategoryPath } from './sku-category.js';

export type AnalyticsSite = 'US' | 'EU' | 'UK' | '其他';

export const ANALYTICS_SITE_ORDER: AnalyticsSite[] = ['US', 'EU', 'UK', '其他'];

/** Normalize short codes / warehouse stations to US/EU/UK/其他. */
export function bucketAnalyticsSite(
  stationOrRegion: string | null | undefined,
): AnalyticsSite {
  const s = (stationOrRegion ?? '').trim().toUpperCase();
  if (!s) return '其他';
  if (s === 'UK' || s === 'GB') return 'UK';
  if (s === 'US' || s === 'USA') return 'US';
  if (
    s === 'EU' ||
    s === 'DE' ||
    s === 'FR' ||
    s === 'IT' ||
    s === 'ES' ||
    s === 'IE' ||
    s === 'GERMANY'
  ) {
    return 'EU';
  }
  return '其他';
}

/**
 * Classify report「站点」labels (Amazon美国 / Amazon英国 / …) for analytics.
 * Aligns with Workbuddy: US / EU / UK / 其他（德国等归 EU）.
 */
export function classifyAnalyticsSiteFromReport(
  raw: string | null | undefined,
): AnalyticsSite {
  const value = (raw ?? '').trim();
  if (!value) return '其他';

  const canonical = bucketAnalyticsSite(value);
  if (canonical !== '其他') return canonical;

  const upper = value.toUpperCase();
  if (value.includes('英国') || /\bUK\b/.test(upper) || /\bGB\b/.test(upper)) return 'UK';
  if (
    value.includes('德国') ||
    value.includes('法国') ||
    value.includes('意大利') ||
    value.includes('西班牙') ||
    value.includes('爱尔兰') ||
    value.includes('欧洲') ||
    /\bEU\b/.test(upper) ||
    upper.includes('GERMANY')
  ) {
    return 'EU';
  }
  if (
    value.includes('美国') ||
    /\bUS\b/.test(upper) ||
    /\bUSA\b/.test(upper) ||
    value.includes('加拿大') ||
    value.includes('墨西哥') ||
    value.includes('巴西')
  ) {
    return 'US';
  }
  return '其他';
}

/** Infer site from category path tokens like `第一曲线-US` / `第一曲线-EU`. */
export function extractAnalyticsSiteFromCategory(
  category: string | null | undefined,
): AnalyticsSite | null {
  const raw = (category ?? '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  if (raw.includes('英国') || /\bUK\b/.test(upper) || /\bGB\b/.test(upper)) return 'UK';
  if (
    raw.includes('德国') ||
    /\bDE\b/.test(upper) ||
    /\bEU\b/.test(upper) ||
    upper.includes('GERMANY')
  ) {
    return 'EU';
  }
  if (raw.includes('美国') || /\bUS\b/.test(upper) || /\bUSA\b/.test(upper)) return 'US';

  if (/(?:^|[\\/\-_\s])UK(?:$|[\\/\-_\s])/i.test(raw)) return 'UK';
  if (/(?:^|[\\/\-_\s])(?:DE|EU)(?:$|[\\/\-_\s])/i.test(raw)) return 'EU';
  if (/(?:^|[\\/\-_\s])US(?:$|[\\/\-_\s])/i.test(raw)) return 'US';

  return null;
}

/**
 * Resolve cube site:
 * 1) stored/report station  2) category path  3) warehouse→station  4) 其他
 */
export function resolveAnalyticsSite(input: {
  station?: string | null;
  category?: string | null;
  warehouseCode?: string | null;
  warehouseStationByCode?: Map<string, string>;
}): AnalyticsSite {
  if (input.station?.trim()) {
    return classifyAnalyticsSiteFromReport(input.station);
  }

  const fromCat = extractAnalyticsSiteFromCategory(input.category);
  if (fromCat) return fromCat;

  const wh = (input.warehouseCode ?? '').trim();
  if (wh && input.warehouseStationByCode?.has(wh)) {
    const site = bucketAnalyticsSite(input.warehouseStationByCode.get(wh));
    if (site !== '其他') return site;
  }

  return '其他';
}

/** 销售分析项目组，与商品主数据同一口径；无法提炼时显示「(未分组)」。 */
export function extractAnalyticsDept(category: string | null | undefined): string {
  return extractProjectGroupFromCategory(category) ?? '(未分组)';
}

export function extractAnalyticsCategoryLeaf(
  category: string | null | undefined,
): string {
  const normalized = normalizeCategoryPath(category);
  if (!normalized) return '(未分类)';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '(未分类)';
}

export function isoWeekLabel(ymd: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd).trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
