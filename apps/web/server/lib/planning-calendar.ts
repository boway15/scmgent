export const DEMAND_PLAN_HORIZON_WEEKS = 26;

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

export function planningRecentWindowEnd(asOf: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(asOf);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const y = parseInt(values.year!, 10);
  const m = parseInt(values.month!, 10);
  const d = parseInt(values.day!, 10);
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday;
}

export function monthKeyFromUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
