import { parseForecastMonth } from './forecast-demand.js';

export type ForecastDrawerActualCell = {
  monthLabel: string;
  actualDailyAvg: number | null;
  inProgress: boolean;
};

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(year: number, month: number): number {
  return year * 100 + month;
}

export function parseMonthsQuery(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildForecastDrawerActualByMonth(input: {
  monthLabels: string[];
  qtyByMonthLabel: Map<string, number>;
  asOf?: Date;
}): ForecastDrawerActualCell[] {
  const asOf = input.asOf ?? new Date();
  const asOfKey = monthKey(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1);
  const elapsedDays = Math.max(1, asOf.getUTCDate());

  return input.monthLabels.map((monthLabel) => {
    const parsed = parseForecastMonth(monthLabel);
    if (!parsed) {
      return { monthLabel, actualDailyAvg: null, inProgress: false };
    }
    const key = monthKey(parsed.year, parsed.month);
    if (key > asOfKey) {
      return { monthLabel, actualDailyAvg: null, inProgress: false };
    }
    const qty = input.qtyByMonthLabel.get(monthLabel) ?? 0;
    if (key === asOfKey) {
      return {
        monthLabel,
        actualDailyAvg: roundDaily(qty / elapsedDays),
        inProgress: true,
      };
    }
    const days = daysInCalendarMonth(parsed.year, parsed.month);
    return {
      monthLabel,
      actualDailyAvg: days > 0 ? roundDaily(qty / days) : 0,
      inProgress: false,
    };
  });
}
