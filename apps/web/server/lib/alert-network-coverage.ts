import { stockoutDateFromBandDays } from './alert-action.js';
import {
  capCoverageDays,
  coverageDaysFromQty,
  MAX_COVERAGE_DAYS,
  type HorizonDemand,
  horizonDemand,
} from './alert-horizon-demand.js';
import { getForecastDailyForDate } from './forecast-demand.js';
import type { PublishedForecastEntry } from './forecast-published-resolve.js';
import { addDaysIso } from './inventory-iso-date.js';

const COVERAGE_WALK_MAX_DAYS = 1095;

export function finiteCoverageDays(days: number | null | undefined): number | null {
  return capCoverageDays(days);
}

function utcDateFromYmd(ymd: string): Date | null {
  const parts = ymd.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
}

/** 业务日当天的预测日均：月表按所在月，周表按 ISO 周；跨月周内各天分属不同月份。 */
export function forecastDailyOnDate(forecast: Map<string, number>, ymd: string): number {
  const date = utcDateFromYmd(ymd);
  if (!date || !forecast.size) return 0;
  const daily = getForecastDailyForDate(forecast, date, 0);
  return Number.isFinite(daily) && daily > 0 ? daily : 0;
}

export function sumForecastDemand(forecast: Map<string, number>, startYmd: string, days: number): number {
  let sum = 0;
  for (let offset = 0; offset < days; offset += 1) {
    sum += forecastDailyOnDate(forecast, addDaysIso(startYmd, offset));
  }
  return Math.round(sum);
}

/**
 * 从业务日起逐日扣减预测。日均随月份变化；跨月的周按每一天所属月份（或 ISO 周）取值，
 * 不用「当月一个日均」覆盖整段可售期。
 */
export function coverageAlongForecast(input: {
  qty: number;
  startYmd: string;
  forecast: Map<string, number>;
  maxDays?: number;
}): { coverageDays: number | null; stockoutDate: string | null } {
  if (input.qty <= 0) {
    return { coverageDays: 0, stockoutDate: input.startYmd.slice(0, 10) };
  }
  if (!input.forecast.size) return { coverageDays: null, stockoutDate: null };

  const maxDays = input.maxDays ?? COVERAGE_WALK_MAX_DAYS;
  let remaining = input.qty;
  let consumed = false;
  for (let dayIndex = 0; dayIndex < maxDays; dayIndex += 1) {
    const daily = forecastDailyOnDate(input.forecast, addDaysIso(input.startYmd, dayIndex));
    if (daily <= 0) continue;
    consumed = true;
    if (remaining <= daily) {
      const coverageDays = dayIndex + remaining / daily;
      return {
        coverageDays,
        stockoutDate: addDaysIso(input.startYmd, Math.floor(coverageDays)),
      };
    }
    remaining -= daily;
  }
  if (!consumed) {
    return {
      coverageDays: MAX_COVERAGE_DAYS,
      stockoutDate: addDaysIso(input.startYmd, MAX_COVERAGE_DAYS),
    };
  }
  return {
    coverageDays: MAX_COVERAGE_DAYS,
    stockoutDate: addDaysIso(input.startYmd, MAX_COVERAGE_DAYS),
  };
}

export function networkQty(input: {
  localQty: number | null | undefined;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
}): number | null {
  if (input.localQty == null && input.overseasQty == null && input.inTransitQty == null) return null;
  return (input.localQty ?? 0) + (input.overseasQty ?? 0) + (input.inTransitQty ?? 0);
}

export function networkCoverageBandDays(input: {
  localQty: number | null | undefined;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
  avgDaily: number | null | undefined;
}): number | null {
  const qty = networkQty(input);
  if (qty == null) return null;
  return finiteCoverageDays(coverageDaysFromQty(qty, input.avgDaily));
}

export function networkStockoutFromForecast(input: {
  today: string;
  localQty: number | null | undefined;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
  avgDaily: number | null | undefined;
}): string | null {
  const bandDays = networkCoverageBandDays(input);
  return stockoutDateFromBandDays(input.today, bandDays);
}

/** 已发布销售预测优先：按月/周曲线推可售与断货；没有预测曲线时才用单一周转日均。 */
export function resolveNetworkForecastCoverage(input: {
  today: string;
  localQty: number | null | undefined;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
  forecastDaily: Record<string, number> | null | undefined;
  flatDaily: number | null | undefined;
  inTransitWithin45?: number;
  inTransitWithin60?: number;
}): {
  coverageDays: number | null;
  stockoutDate: string | null;
  horizons: HorizonDemand | null;
  /** 在库 + 在途的可售天数，不含本地。预测曲线与全网可售同一条。 */
  onHandTransitCoverageDays: number | null;
  /** 海外在库 + 在途按预测曲线扣减后的预计断货日（不含本地）。 */
  onHandTransitStockoutDate: string | null;
} {
  const qty = networkQty(input);
  const onHandTransitCoverageDays = coverOnHandTransit(input);
  if (qty == null) {
    return {
      coverageDays: null,
      stockoutDate: null,
      horizons: null,
      onHandTransitCoverageDays,
      onHandTransitStockoutDate: null,
    };
  }

  const series = input.forecastDaily ?? null;
  const forecast = series && Object.keys(series).length ? new Map(Object.entries(series)) : null;
  if (forecast) {
    const walked = coverageAlongForecast({ qty, startYmd: input.today, forecast });
    const coverageDays = finiteCoverageDays(walked.coverageDays);
    const horizons = horizonDemand({
      coverageDays: walked.coverageDays,
      avgDaily: null,
      overseasQty: input.overseasQty ?? 0,
      localQty: input.localQty ?? 0,
      inTransitQty: input.inTransitQty ?? 0,
      inTransitWithin45: input.inTransitWithin45 ?? 0,
      inTransitWithin60: input.inTransitWithin60 ?? 0,
      demandQty: {
        d150: sumForecastDemand(forecast, input.today, 150),
        d120: sumForecastDemand(forecast, input.today, 120),
        d90: sumForecastDemand(forecast, input.today, 90),
        d60: sumForecastDemand(forecast, input.today, 60),
        d45: sumForecastDemand(forecast, input.today, 45),
      },
    });
    return {
      coverageDays,
      stockoutDate: walked.stockoutDate,
      horizons,
      onHandTransitCoverageDays,
      onHandTransitStockoutDate: coverOnHandTransitStockout(input),
    };
  }

  const coverageDays = networkCoverageBandDays({
    localQty: input.localQty,
    overseasQty: input.overseasQty,
    inTransitQty: input.inTransitQty,
    avgDaily: input.flatDaily,
  });
  return {
    coverageDays,
    stockoutDate: networkStockoutFromForecast({
      today: input.today,
      localQty: input.localQty,
      overseasQty: input.overseasQty,
      inTransitQty: input.inTransitQty,
      avgDaily: input.flatDaily,
    }),
    horizons: horizonDemand({
      coverageDays,
      avgDaily: input.flatDaily ?? null,
      overseasQty: input.overseasQty ?? 0,
      localQty: input.localQty ?? 0,
      inTransitQty: input.inTransitQty ?? 0,
      inTransitWithin45: input.inTransitWithin45 ?? 0,
      inTransitWithin60: input.inTransitWithin60 ?? 0,
    }),
    onHandTransitCoverageDays,
    onHandTransitStockoutDate: coverOnHandTransitStockout(input),
  };
}

function coverOnHandTransitStockout(input: {
  today: string;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
  forecastDaily: Record<string, number> | null | undefined;
  flatDaily: number | null | undefined;
}): string | null {
  if (input.overseasQty == null && input.inTransitQty == null) return null;
  const qty = Math.max(0, input.overseasQty ?? 0) + Math.max(0, input.inTransitQty ?? 0);
  const series = input.forecastDaily ?? null;
  const forecast = series && Object.keys(series).length ? new Map(Object.entries(series)) : null;
  if (forecast) {
    return coverageAlongForecast({ qty, startYmd: input.today, forecast }).stockoutDate;
  }
  const days = coverageDaysFromQty(qty, input.flatDaily);
  return stockoutDateFromBandDays(input.today, days);
}

function coverOnHandTransit(input: {
  today: string;
  overseasQty: number | null | undefined;
  inTransitQty: number | null | undefined;
  forecastDaily: Record<string, number> | null | undefined;
  flatDaily: number | null | undefined;
}): number | null {
  if (input.overseasQty == null && input.inTransitQty == null) return null;
  const qty = Math.max(0, input.overseasQty ?? 0) + Math.max(0, input.inTransitQty ?? 0);
  const series = input.forecastDaily ?? null;
  const forecast = series && Object.keys(series).length ? new Map(Object.entries(series)) : null;
  if (forecast) {
    return finiteCoverageDays(
      coverageAlongForecast({ qty, startYmd: input.today, forecast }).coverageDays,
    );
  }
  return finiteCoverageDays(coverageDaysFromQty(qty, input.flatDaily));
}

/** 已发布销售预测：业务日所在月（或 ISO 周）的全网生效日均，仅作展示参考。 */
export function publishedNetworkAvgDaily(
  forecast: PublishedForecastEntry | undefined,
  businessDateYmd: string,
): number | null {
  if (!forecast?.map.size) return null;
  const daily = forecastDailyOnDate(forecast.map, businessDateYmd);
  return daily > 0 ? daily : null;
}

export function publishedForecastDailyRecord(
  forecast: PublishedForecastEntry | undefined,
): Record<string, number> | null {
  if (!forecast?.map.size) return null;
  const record: Record<string, number> = {};
  for (const [key, value] of forecast.map) {
    if (Number.isFinite(value) && value > 0) record[key] = value;
  }
  return Object.keys(record).length ? record : null;
}
