import { stockoutDateFromBandDays } from './alert-action.js';
import {
  capCoverageDays,
  coverageDaysFromQty,
  MAX_COVERAGE_DAYS,
  type HorizonDemand,
  horizonDemand,
} from './alert-horizon-demand.js';
import { meanOfLastThreePositive } from './demand-plan-resolve.js';
import { getForecastDailyForDate, type ForecastHorizonContext } from './forecast-demand.js';
import type { PublishedForecastEntry } from './forecast-published-resolve.js';
import { addDaysIso } from './inventory-iso-date.js';
import { SINGLE_REPLENISHMENT_COVER_DAYS } from './inventory-timeline.js';
import { isIsoWeekPeriod, isoWeekMondayUtc } from './planning-calendar.js';

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
export function forecastDailyOnDate(
  forecast: Map<string, number>,
  ymd: string,
  horizon?: ForecastHorizonContext | null,
): number {
  const date = utcDateFromYmd(ymd);
  if (!date || !forecast.size) return 0;
  const daily = getForecastDailyForDate(forecast, date, 0, horizon);
  return Number.isFinite(daily) && daily > 0 ? daily : 0;
}

/** 预测曲线最后一个有值周期的结束日。月 key 取月末，ISO 周取周日。 */
export function forecastHorizonEndYmd(forecast: Map<string, number>): string | null {
  let end: string | null = null;
  for (const key of forecast.keys()) {
    let keyEnd: string | null = null;
    if (isIsoWeekPeriod(key)) {
      keyEnd = addDaysIso(isoWeekMondayUtc(key).toISOString().slice(0, 10), 6);
    } else {
      const match = /^(\d{4})-(\d{2})$/.exec(key);
      if (!match) continue;
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month < 1 || month > 12) continue;
      keyEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    }
    if (keyEnd && (end == null || keyEnd > end)) end = keyEnd;
  }
  return end;
}

/** 预测期之外的日均：最近 3 个正值周期的均值。全部为 0 时返回 0，调用方保持「零消耗封顶」。 */
export function horizonFallbackDaily(forecast: Map<string, number>): number {
  return meanOfLastThreePositive(forecast);
}

const DAY_MS = 86_400_000;

type PreparedForecastCurve = {
  forecast: Map<string, number>;
  horizonEnd: string | null;
  fallbackDaily: number;
  horizon?: ForecastHorizonContext | null;
};

function prepareForecastCurve(
  forecast: Map<string, number>,
  horizon?: ForecastHorizonContext | null,
): PreparedForecastCurve {
  return {
    forecast,
    horizonEnd: forecastHorizonEndYmd(forecast),
    fallbackDaily: horizonFallbackDaily(forecast),
    horizon,
  };
}

function demandDailyOnPreparedDate(
  curve: PreparedForecastCurve,
  ymd: string,
  dateObj?: Date,
): number {
  if (curve.horizonEnd != null && ymd > curve.horizonEnd) {
    return curve.fallbackDaily;
  }
  if (!curve.forecast.size) return 0;
  const date = dateObj ?? utcDateFromYmd(ymd);
  if (!date) return 0;
  const daily = getForecastDailyForDate(curve.forecast, date, 0, curve.horizon);
  return Number.isFinite(daily) && daily > 0 ? daily : 0;
}

export function sumForecastDemand(
  forecast: Map<string, number>,
  startYmd: string,
  days: number,
  horizon?: ForecastHorizonContext | null,
): number {
  if (days <= 0 || !forecast.size) return 0;
  const curve = prepareForecastCurve(forecast, horizon);
  const startDate = utcDateFromYmd(startYmd);
  if (!startDate) return 0;
  const baseMs = startDate.getTime();
  let sum = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const d = new Date(baseMs + offset * DAY_MS);
    const ymd = d.toISOString().slice(0, 10);
    sum += demandDailyOnPreparedDate(curve, ymd, d);
  }
  return Math.round(sum);
}

function sumMultipleForecastWindows(
  curve: PreparedForecastCurve,
  startYmd: string,
  coverDays: number,
): {
  d30: number;
  d45: number;
  d60: number;
  d90: number;
  d120: number;
  d150: number;
  dCover: number;
} {
  const maxDays = Math.max(150, coverDays);
  const startDate = utcDateFromYmd(startYmd);
  if (!startDate || !curve.forecast.size) {
    return { d30: 0, d45: 0, d60: 0, d90: 0, d120: 0, d150: 0, dCover: 0 };
  }
  const baseMs = startDate.getTime();
  let running = 0;
  let s30 = 0;
  let s45 = 0;
  let s60 = 0;
  let s90 = 0;
  let s120 = 0;
  let s150 = 0;
  let sCover = 0;

  for (let offset = 0; offset < maxDays; offset += 1) {
    const d = new Date(baseMs + offset * DAY_MS);
    const ymd = d.toISOString().slice(0, 10);
    running += demandDailyOnPreparedDate(curve, ymd, d);
    const dayCount = offset + 1;
    if (dayCount === SINGLE_REPLENISHMENT_COVER_DAYS) s30 = running;
    if (dayCount === 45) s45 = running;
    if (dayCount === 60) s60 = running;
    if (dayCount === 90) s90 = running;
    if (dayCount === 120) s120 = running;
    if (dayCount === 150) s150 = running;
    if (dayCount === coverDays) sCover = running;
  }

  return {
    d30: Math.round(s30),
    d45: Math.round(s45),
    d60: Math.round(s60),
    d90: Math.round(s90),
    d120: Math.round(s120),
    d150: Math.round(s150),
    dCover: Math.round(sCover),
  };
}

function walkPreparedCoverage(
  qty: number,
  startYmd: string,
  curve: PreparedForecastCurve,
  maxDays = COVERAGE_WALK_MAX_DAYS,
): { coverageDays: number | null; stockoutDate: string | null } {
  if (qty <= 0) {
    return { coverageDays: 0, stockoutDate: startYmd.slice(0, 10) };
  }
  if (!curve.forecast.size) return { coverageDays: null, stockoutDate: null };

  const startDate = utcDateFromYmd(startYmd);
  if (!startDate) return { coverageDays: null, stockoutDate: null };
  const baseMs = startDate.getTime();

  let remaining = qty;
  let consumed = false;
  for (let dayIndex = 0; dayIndex < maxDays; dayIndex += 1) {
    const d = new Date(baseMs + dayIndex * DAY_MS);
    const ymd = d.toISOString().slice(0, 10);
    const daily = demandDailyOnPreparedDate(curve, ymd, d);
    if (daily <= 0) continue;
    consumed = true;
    if (remaining <= daily) {
      const coverageDays = dayIndex + remaining / daily;
      return {
        coverageDays,
        stockoutDate: addDaysIso(startYmd, Math.floor(coverageDays)),
      };
    }
    remaining -= daily;
  }
  if (!consumed) {
    return {
      coverageDays: MAX_COVERAGE_DAYS,
      stockoutDate: addDaysIso(startYmd, MAX_COVERAGE_DAYS),
    };
  }
  return {
    coverageDays: MAX_COVERAGE_DAYS,
    stockoutDate: addDaysIso(startYmd, MAX_COVERAGE_DAYS),
  };
}

/**
 * 从业务日起逐日扣减预测。日均随月份变化；跨月的周按每一天所属月份（或 ISO 周）取值，
 * 不用「当月一个日均」覆盖整段可售期。
 * 晚于预测期末的日子用最近 3 个正值周期的均值继续扣，避免期外零消耗把可售天数放大。
 * 预测期内日均为 0 的周期仍跳过，不扣库存。
 */
export function coverageAlongForecast(input: {
  qty: number;
  startYmd: string;
  forecast: Map<string, number>;
  maxDays?: number;
  horizon?: ForecastHorizonContext | null;
}): { coverageDays: number | null; stockoutDate: string | null } {
  if (input.qty <= 0) {
    return { coverageDays: 0, stockoutDate: input.startYmd.slice(0, 10) };
  }
  if (!input.forecast.size) return { coverageDays: null, stockoutDate: null };
  const curve = prepareForecastCurve(input.forecast, input.horizon);
  return walkPreparedCoverage(
    input.qty,
    input.startYmd,
    curve,
    input.maxDays ?? COVERAGE_WALK_MAX_DAYS,
  );
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
  /** 建议件数覆盖天数。缺省 150。 */
  coverDays?: number;
  /** 已发布预测的分层。需求计划曲线不要传，避免在共识需求上再乘缓冲。 */
  profileClass?: string | null;
  forecastP90Daily?: Record<string, number> | null;
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
  const series = input.forecastDaily ?? null;
  const forecast = series && Object.keys(series).length ? new Map(Object.entries(series)) : null;
  const horizon = horizonFromCoverageInput(input);
  const preparedCurve = forecast ? prepareForecastCurve(forecast, horizon) : null;
  const onHandTransit = resolveOnHandTransitPrepared(input, preparedCurve);

  if (qty == null) {
    return {
      coverageDays: null,
      stockoutDate: null,
      horizons: null,
      onHandTransitCoverageDays: onHandTransit.coverageDays,
      onHandTransitStockoutDate: null,
    };
  }

  const coverDays =
    input.coverDays != null && input.coverDays > 0 ? Math.ceil(input.coverDays) : 150;
  if (preparedCurve) {
    const walked = walkPreparedCoverage(qty, input.today, preparedCurve);
    const coverageDays = finiteCoverageDays(walked.coverageDays);
    const demandQty = sumMultipleForecastWindows(preparedCurve, input.today, coverDays);
    const horizons = horizonDemand({
      coverageDays: walked.coverageDays,
      avgDaily: null,
      overseasQty: input.overseasQty ?? 0,
      localQty: input.localQty ?? 0,
      inTransitQty: input.inTransitQty ?? 0,
      inTransitWithin45: input.inTransitWithin45 ?? 0,
      inTransitWithin60: input.inTransitWithin60 ?? 0,
      coverDays,
      demandQty,
    });
    return {
      coverageDays,
      stockoutDate: walked.stockoutDate,
      horizons,
      onHandTransitCoverageDays: onHandTransit.coverageDays,
      onHandTransitStockoutDate: onHandTransit.stockoutDate,
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
      coverDays,
    }),
    onHandTransitCoverageDays: onHandTransit.coverageDays,
    onHandTransitStockoutDate: onHandTransit.stockoutDate,
  };
}

function horizonFromCoverageInput(input: {
  today: string;
  profileClass?: string | null;
  forecastP90Daily?: Record<string, number> | null;
}): ForecastHorizonContext | null {
  if (!input.profileClass) return null;
  return {
    profileClass: input.profileClass,
    p90: input.forecastP90Daily ? new Map(Object.entries(input.forecastP90Daily)) : null,
    asOf: utcDateFromYmd(input.today) ?? undefined,
  };
}

function resolveOnHandTransitPrepared(
  input: {
    today: string;
    overseasQty: number | null | undefined;
    inTransitQty: number | null | undefined;
    flatDaily: number | null | undefined;
  },
  preparedCurve: PreparedForecastCurve | null,
): { coverageDays: number | null; stockoutDate: string | null } {
  if (input.overseasQty == null && input.inTransitQty == null) {
    return { coverageDays: null, stockoutDate: null };
  }
  const qty = Math.max(0, input.overseasQty ?? 0) + Math.max(0, input.inTransitQty ?? 0);
  if (preparedCurve) {
    const walked = walkPreparedCoverage(qty, input.today, preparedCurve);
    return {
      coverageDays: finiteCoverageDays(walked.coverageDays),
      stockoutDate: walked.stockoutDate,
    };
  }
  const rawDays = coverageDaysFromQty(qty, input.flatDaily);
  return {
    coverageDays: finiteCoverageDays(rawDays),
    stockoutDate: stockoutDateFromBandDays(input.today, rawDays),
  };
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
