const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcCalendarDay(value: string | Date): number {
  if (value instanceof Date) {
    return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function calcMilestoneDelayDays(
  plannedAt: string | null,
  actualAt: string | null,
  today: Date,
): number | null {
  if (!plannedAt) return null;

  const plannedDay = toUtcCalendarDay(plannedAt);
  const endDay = actualAt ? toUtcCalendarDay(actualAt) : toUtcCalendarDay(today);
  if (!Number.isFinite(plannedDay) || !Number.isFinite(endDay)) return null;

  return Math.max(0, Math.round((endDay - plannedDay) / DAY_MS));
}
