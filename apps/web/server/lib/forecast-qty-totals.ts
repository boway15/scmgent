import { buildMonthlyForecastHorizon } from './forecast-baseline.js';
import { formatForecastStartMonth, resolveForecastStartMonthAsOf } from './forecast-start-month.js';

export type ForecastQtyTotalsStatus = 'in_progress' | 'empty_actual' | 'ready';

export type ForecastQtyTotalsResult = {
  status: ForecastQtyTotalsStatus;
  forecastQty: number;
  actualQty: number;
  label: string;
};

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function resolveHorizonMonthKeys(input: {
  distinctMonths: string[];
  startMonth: string | null;
  monthCount: number;
  now?: Date;
}): string[] {
  const distinct = [...new Set(input.distinctMonths.filter(Boolean))].sort();
  if (distinct.length > 0) return distinct;

  const start = input.startMonth?.trim();
  const count = Math.max(0, Math.floor(input.monthCount));
  if (!start || count <= 0) return [];

  const asOf = resolveForecastStartMonthAsOf(start);
  return buildMonthlyForecastHorizon(asOf, count).map((h) => monthKey(h.forecastYear, h.month));
}

export function formatQtyTotalsLabel(
  status: ForecastQtyTotalsStatus,
  forecastQty: number,
  actualQty: number,
): string {
  if (status === 'in_progress') return '进行中';
  if (status === 'empty_actual') return '-';
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  return `${fmt(forecastQty)} / ${fmt(actualQty)}`;
}

export function buildForecastQtyTotalsResult(input: {
  horizonMonthKeys: string[];
  forecastQty: number;
  actualQty: number;
  now?: Date;
}): ForecastQtyTotalsResult {
  const now = input.now ?? new Date();
  const currentMonth = formatForecastStartMonth(now);
  const horizon = input.horizonMonthKeys;
  if (horizon.length === 0) {
    return {
      status: 'empty_actual',
      forecastQty: 0,
      actualQty: 0,
      label: formatQtyTotalsLabel('empty_actual', 0, 0),
    };
  }
  if (horizon.some((m) => m >= currentMonth)) {
    return {
      status: 'in_progress',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('in_progress', input.forecastQty, input.actualQty),
    };
  }
  if (input.actualQty <= 0) {
    return {
      status: 'empty_actual',
      forecastQty: input.forecastQty,
      actualQty: input.actualQty,
      label: formatQtyTotalsLabel('empty_actual', input.forecastQty, input.actualQty),
    };
  }
  return {
    status: 'ready',
    forecastQty: input.forecastQty,
    actualQty: input.actualQty,
    label: formatQtyTotalsLabel('ready', input.forecastQty, input.actualQty),
  };
}
