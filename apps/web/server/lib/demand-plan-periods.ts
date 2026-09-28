import { addIsoWeeks } from './planning-calendar.js';

export function buildDemandPlanPeriodColumns(version: {
  startWeek?: string | null;
  horizonWeeks?: number | null;
  startMonth: string;
  horizonMonths?: number | null;
}): string[] {
  if (version.startWeek && version.horizonWeeks) {
    return Array.from({ length: version.horizonWeeks }, (_, index) =>
      addIsoWeeks(version.startWeek!, index),
    );
  }
  const [year, month] = version.startMonth.split('-').map(Number);
  const count = version.horizonMonths ?? 6;
  const periods: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const cursor = new Date(Date.UTC(year, month - 1 + index, 1));
    periods.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  return periods;
}
