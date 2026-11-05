/** ISO 周工具（与 server planning-calendar 对齐，供表头展示） */

const ISO_WEEK_PERIOD = /^\d{4}-W\d{2}$/;

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
  const monday = isoWeekMondayUtc(startWeek);
  monday.setUTCDate(monday.getUTCDate() + offset * 7);
  return isoWeekKeyFromUtcDate(monday);
}

export function formatIsoWeekMondayMd(weekKey: string): string {
  const monday = isoWeekMondayUtc(weekKey);
  const month = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(monday.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

export const DEMAND_PLAN_START_WEEK_LOOKBACK = 26;

export function buildDemandPlanStartWeekOptions(
  now = new Date(),
  lookback = DEMAND_PLAN_START_WEEK_LOOKBACK,
): string[] {
  const current = isoWeekKeyFromUtcDate(now);
  return Array.from({ length: lookback + 1 }, (_, offset) => addIsoWeeks(current, -offset));
}

export function isDemandPlanStartWeekBacktest(startWeek: string, now = new Date()): boolean {
  return startWeek.trim() < isoWeekKeyFromUtcDate(now);
}
