export const DEMAND_PLAN_HORIZON_WEEKS = 26;

/** 周计划近窗相对业务日的销量入库延迟（天） */
export const PLANNING_SALES_LAG_DAYS = 2;

const ISO_WEEK_PERIOD = /^\d{4}-W\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoWeekPeriod(key: string): boolean {
  return ISO_WEEK_PERIOD.test(key);
}

export function isoWeekKeyFromUtcDate(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekMondayUtc(weekKey: string): Date {
  const match = ISO_WEEK_PERIOD.exec(weekKey);
  if (!match) {
    throw new Error(`Invalid ISO week key: ${weekKey}`);
  }
  const year = parseInt(weekKey.slice(0, 4), 10);
  const week = parseInt(weekKey.slice(6, 8), 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
  return monday;
}

export function addIsoWeeks(startWeek: string, offset: number): string {
  const match = ISO_WEEK_PERIOD.exec(startWeek);
  if (!match) {
    throw new Error(`Invalid ISO week key: ${startWeek}`);
  }
  const year = parseInt(startWeek.slice(0, 4), 10);
  const week = parseInt(startWeek.slice(6, 8), 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
  monday.setUTCDate(monday.getUTCDate() + offset * 7);
  return isoWeekKeyFromUtcDate(monday);
}

export function buildIsoWeekHorizon(asOf: Date, count = DEMAND_PLAN_HORIZON_WEEKS): string[] {
  const startWeek = isoWeekKeyFromUtcDate(asOf);
  return Array.from({ length: count }, (_, i) => addIsoWeeks(startWeek, i));
}

export function shanghaiCalendarParts(asOf: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(asOf);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: parseInt(values.year!, 10),
    month: parseInt(values.month!, 10),
    day: parseInt(values.day!, 10),
  };
}

/** 业务日 − lagDays，返回 UTC 日 00:00（不含尚未入库的延迟日） */
export function planningAssumedSalesCutoff(
  asOf: Date,
  lagDays: number = PLANNING_SALES_LAG_DAYS,
): Date {
  const { year, month, day } = shanghaiCalendarParts(asOf);
  const cutoff = new Date(Date.UTC(year, month - 1, day));
  const lag = Number.isFinite(lagDays) ? Math.max(0, Math.floor(lagDays)) : PLANNING_SALES_LAG_DAYS;
  cutoff.setUTCDate(cutoff.getUTCDate() - lag);
  return cutoff;
}

function toDateOnlyKey(value: string | Date): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const key = String(value).slice(0, 10);
  return DATE_ONLY.test(key) ? key : null;
}

export function maxSaleDateKey(rows: Array<{ saleDate: string }>): string | null {
  let max: string | null = null;
  for (const row of rows) {
    const key = toDateOnlyKey(row.saleDate);
    if (!key) continue;
    if (max == null || key > max) max = key;
  }
  return max;
}

export type PlanningRecentWindowEndOptions = {
  /** 相对业务日的延迟天数；默认 PLANNING_SALES_LAG_DAYS（2） */
  lagDays?: number;
  /** 可见最大销日；与假定截止取更早者 */
  maxSaleDate?: string | Date | null;
};

/**
 * 周计划近窗终点 D_max。
 * 默认：上海业务日 − 2；若传入 maxSaleDate 则再与之取 min。
 */
export function planningRecentWindowEnd(
  asOf: Date,
  opts?: PlanningRecentWindowEndOptions,
): Date {
  const assumed = planningAssumedSalesCutoff(asOf, opts?.lagDays ?? PLANNING_SALES_LAG_DAYS);
  const maxKey = opts?.maxSaleDate != null ? toDateOnlyKey(opts.maxSaleDate) : null;
  if (!maxKey) return assumed;
  const assumedKey = assumed.toISOString().slice(0, 10);
  if (maxKey >= assumedKey) return assumed;
  const [y, m, d] = maxKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function monthKeyFromUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** 表头展示：ISO 周对应周一，MM-DD（不含年） */
export function formatIsoWeekMondayMd(weekKey: string): string {
  const monday = isoWeekMondayUtc(weekKey);
  const month = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}
