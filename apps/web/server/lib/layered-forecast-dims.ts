import { normalizeCategoryPath } from './sku-category.js';

export const LAYERED_UNGROUPED = '(未分组)';
export const LAYERED_UNCATEGORIZED = '(未分类)';
export const LAYERED_PLATFORM_ALL = 'ALL';

const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function normalizeProjectGroup(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed || LAYERED_UNGROUPED;
}

export function categoryLeaf(category: string | null | undefined): string {
  const normalized = normalizeCategoryPath(category);
  if (!normalized) return LAYERED_UNCATEGORIZED;
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || LAYERED_UNCATEGORIZED;
}

export function addMonths(period: string, delta: number): string {
  const match = YEAR_MONTH_RE.exec(period.trim());
  if (!match) {
    throw new Error('period 须为 YYYY-MM 格式');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(period: string): number {
  const match = YEAR_MONTH_RE.exec(period.trim());
  if (!match) {
    throw new Error('period 须为 YYYY-MM 格式');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function buildHorizonPeriods(startMonth: string, horizonMonths: number): string[] {
  const periods: string[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    periods.push(addMonths(startMonth, i));
  }
  return periods;
}
