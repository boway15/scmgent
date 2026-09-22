/** UTC calendar-day helpers for ISO `YYYY-MM-DD` strings. */

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function subtractDaysIso(isoDate: string, days: number): string {
  return addDaysIso(isoDate, -days);
}

/** Signed calendar-day difference: `to - from` (UTC date parts only). */
export function diffDaysIso(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}
