import { normalizeCategoryPath } from './sku-category.js';

const DEPT_PAT = /(?:海外)?\s*项目\s*第?\s*([0-9一二三四五六七八九十]+)\s*组/;
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function cn2num(z: string): number {
  if (/^\d+$/.test(z)) return Number.parseInt(z, 10);
  if (z === '十') return 10;
  if (z.includes('十')) return 10;
  return CN_NUM[z] ?? 0;
}

export function bucketAnalyticsSite(
  stationOrRegion: string | null | undefined,
): 'US' | 'EU' | 'UK' | '其他' {
  const s = (stationOrRegion ?? '').trim().toUpperCase();
  if (!s) return '其他';
  if (s === 'UK' || s === 'GB') return 'UK';
  if (s === 'US') return 'US';
  if (s === 'EU' || s === 'DE' || s === 'FR' || s === 'IT' || s === 'ES' || s === 'IE') {
    return 'EU';
  }
  return '其他';
}

export function extractAnalyticsDept(category: string | null | undefined): string {
  const raw = (category ?? '').trim();
  if (!raw) return '(未分组)';
  const m = raw.match(DEPT_PAT);
  if (m) {
    const num = cn2num(m[1]);
    const isHaiwai = raw.includes('海外');
    return `${isHaiwai ? '海外项目' : '项目'}${num}组`;
  }
  const normalized = normalizeCategoryPath(raw);
  const first = normalized.split('/').filter(Boolean)[0];
  return first || '(未分组)';
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
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
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
