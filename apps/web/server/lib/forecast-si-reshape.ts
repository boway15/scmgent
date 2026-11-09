/**
 * 按站点季节指数重塑版本内地平线系统日均：保留项目组月均水平，按 SI 分配各月。
 * 只改 forecast_daily_avg，不写入人工校准。
 */
import { and, eq } from 'drizzle-orm';
import {
  db,
  salesForecastMonthly,
  salesForecastSeasonalIndex,
  skus,
} from '@scm/db';
import {
  historyCapEndFromStartMonth,
  resolveSkuSeasonStation,
} from './forecast-seasonal-index.js';
import {
  loadForecastCalibrationConfig,
  resolveSeasonalIndexMode,
  type SeasonalIndexMode,
} from './forecast-profile-config.js';
import {
  buildHorizonIndexByMonthKey,
  dampenReshapeScale,
  loadSeasonalDampenFromCalibration,
} from './forecast-seasonal-dampen.js';

export const SI_RESHAPE_SCALE_MIN = 0.72;
export const SI_RESHAPE_SCALE_MAX = 1.45;
export const SI_RESHAPE_MIN_GROUP_DAILY = 20;

export type SiReshapeMonthAgg = {
  key: string;
  month: number;
  sum: number;
};

export type SiReshapeScalePlan = {
  key: string;
  month: number;
  current: number;
  target: number;
  si: number;
  scale: number;
};

export function resolveSeasonalIndexReshapeEnabled(override?: boolean | null): boolean {
  if (override === true || override === false) return override;
  const cfg = loadForecastCalibrationConfig().seasonalIndex;
  if (cfg?.reshapePortfolio === false) return false;
  if (cfg?.reshapePortfolio === true) return true;
  return (cfg?.mode ?? 'shadow') !== 'off';
}

export function clipSiReshapeScale(
  raw: number,
  min = SI_RESHAPE_SCALE_MIN,
  max = SI_RESHAPE_SCALE_MAX,
): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(max, Math.max(min, raw));
}

/** 保月均水平，按 SI 分配；返回各月 scale（已限幅，可选近端衰减）。 */
export function computeSiReshapeScales(input: {
  months: SiReshapeMonthAgg[];
  siByMonth: Record<number, number>;
  minGroupDaily?: number;
  scaleMin?: number;
  scaleMax?: number;
  /** key → 地平线下标；缺省不衰减 */
  horizonIndexByKey?: Map<string, number>;
  nearBlend?: number;
  nearMonths?: number;
  peakMonths?: readonly number[];
  /** false 时跳过近端衰减（回测基线） */
  applyHorizonDamp?: boolean;
}): SiReshapeScalePlan[] {
  const months = input.months.filter((item) => item.sum > 0);
  if (!months.length) return [];
  const avg = months.reduce((sum, item) => sum + item.sum, 0) / months.length;
  if (avg < (input.minGroupDaily ?? SI_RESHAPE_MIN_GROUP_DAILY)) return [];

  const withSi = months.map((item) => ({
    ...item,
    si: input.siByMonth[item.month] ?? 1,
  }));
  const siMean = withSi.reduce((sum, item) => sum + item.si, 0) / withSi.length;
  if (!(siMean > 0)) return [];

  const applyDamp = input.applyHorizonDamp !== false;
  return withSi.map((item) => {
    const target = avg * (item.si / siMean);
    const raw = item.sum > 0 ? target / item.sum : 1;
    let scale = clipSiReshapeScale(raw, input.scaleMin, input.scaleMax);
    if (applyDamp && input.horizonIndexByKey) {
      const horizonIndex = input.horizonIndexByKey.get(item.key) ?? 0;
      scale = dampenReshapeScale(scale, {
        horizonIndex,
        calendarMonth: item.month,
        nearBlend: input.nearBlend,
        nearMonths: input.nearMonths,
        peakMonths: input.peakMonths,
      });
    }
    return {
      key: item.key,
      month: item.month,
      current: item.sum,
      target,
      si: item.si,
      scale,
    };
  });
}

function roundDaily(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function asOfMonthFromHistoryCap(historyCapEnd: Date): string {
  return `${historyCapEnd.getUTCFullYear()}-${String(historyCapEnd.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function loadStationSeasonalIndexByMonth(asOfMonth: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      station: salesForecastSeasonalIndex.station,
      month: salesForecastSeasonalIndex.month,
      indexValue: salesForecastSeasonalIndex.indexValue,
    })
    .from(salesForecastSeasonalIndex)
    .where(
      and(
        eq(salesForecastSeasonalIndex.asOfMonth, asOfMonth),
        eq(salesForecastSeasonalIndex.dimensionLevel, 'station'),
      ),
    );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.station}|${row.month}`, Number(row.indexValue));
  }
  return map;
}

export type ApplySiReshapeResult = {
  changedRows: number;
  groupsTouched: number;
  asOfMonth: string;
  dryRun: boolean;
};

/**
 * 对版本内分平台预测行按「项目组×站点」用站点 SI 重塑系统日均。
 */
export async function applyStationSiPortfolioReshape(input: {
  versionId: string;
  asOfMonth?: string;
  startMonth?: string | null;
  historyCapEnd?: Date;
  /** true 时只计算拟改行数，不写库 */
  dryRun?: boolean;
}): Promise<ApplySiReshapeResult> {
  const asOfMonth =
    input.asOfMonth ??
    (input.historyCapEnd
      ? asOfMonthFromHistoryCap(input.historyCapEnd)
      : input.startMonth
        ? asOfMonthFromHistoryCap(historyCapEndFromStartMonth(input.startMonth))
        : asOfMonthFromHistoryCap(new Date()));

  const siByStationMonth = await loadStationSeasonalIndexByMonth(asOfMonth);
  const dryRun = input.dryRun === true;
  if (!siByStationMonth.size) {
    console.warn(`[forecast] SI reshape skipped: no station index for as_of=${asOfMonth}`);
    return { changedRows: 0, groupsTouched: 0, asOfMonth, dryRun };
  }

  const rows = await db
    .select({
      id: salesForecastMonthly.id,
      platform: salesForecastMonthly.platform,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      projectGroup: skus.projectGroup,
      salesCountry: skus.salesCountry,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(eq(salesForecastMonthly.versionId, input.versionId));

  type Agg = { sum: number; ids: string[]; values: number[] };
  const byGroupMonth = new Map<string, Agg>();
  const rowMeta = new Map<string, { groupKey: string; year: number; month: number; daily: number }>();

  for (const row of rows) {
    if (row.platform === 'ALL') continue;
    const daily = Number(row.forecastDailyAvg);
    if (!(daily > 0)) continue;
    const station = resolveSkuSeasonStation({
      salesCountry: row.salesCountry,
      projectGroup: row.projectGroup,
    });
    const group = `${row.projectGroup?.trim() || `站点-${station}`}@@${station}`;
    const key = `${group}||${monthKey(row.year, row.month)}`;
    const agg = byGroupMonth.get(key) ?? { sum: 0, ids: [], values: [] };
    agg.sum += daily;
    agg.ids.push(row.id);
    agg.values.push(daily);
    byGroupMonth.set(key, agg);
    rowMeta.set(row.id, { groupKey: group, year: row.year, month: row.month, daily });
  }

  const groups = [...new Set([...byGroupMonth.keys()].map((key) => key.split('||')[0]!))];
  const scales = new Map<string, number>();
  let groupsTouched = 0;
  const damp = loadSeasonalDampenFromCalibration();
  const horizonByMonth = buildHorizonIndexByMonthKey(
    [...rowMeta.values()].map((meta) => ({ year: meta.year, month: meta.month })),
  );

  for (const group of groups) {
    const station = group.split('@@')[1] ?? 'ALL';
    const monthEntries = [...byGroupMonth.entries()].filter(([key]) => key.startsWith(`${group}||`));
    const horizonIndexByKey = new Map<string, number>();
    for (const [key] of monthEntries) {
      const mk = key.slice(key.lastIndexOf('||') + 2);
      horizonIndexByKey.set(key, horizonByMonth.get(mk) ?? 0);
    }
    const plans = computeSiReshapeScales({
      months: monthEntries.map(([key, agg]) => ({
        key,
        month: Number(key.slice(-2)),
        sum: agg.sum,
      })),
      siByMonth: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => [
          month,
          siByStationMonth.get(`${station}|${month}`) ??
            siByStationMonth.get(`ALL|${month}`) ??
            1,
        ]),
      ),
      horizonIndexByKey,
      nearBlend: damp.reshape.reshapeNearHorizonBlend,
      nearMonths: damp.reshape.reshapeNearHorizonMonths,
      peakMonths: damp.reshape.reshapePeakMonthsFull,
      applyHorizonDamp: true,
    });
    if (!plans.length) continue;
    groupsTouched += 1;
    for (const plan of plans) scales.set(plan.key, plan.scale);
  }

  const patches: Array<{ id: string; next: number }> = [];
  for (const [id, meta] of rowMeta) {
    const key = `${meta.groupKey}||${monthKey(meta.year, meta.month)}`;
    const scale = scales.get(key);
    if (scale == null || Math.abs(scale - 1) < 0.01) continue;
    const next = roundDaily(meta.daily * scale);
    if (next === roundDaily(meta.daily)) continue;
    patches.push({ id, next });
  }

  if (!dryRun) {
    const chunkSize = 500;
    for (let offset = 0; offset < patches.length; offset += chunkSize) {
      const chunk = patches.slice(offset, offset + chunkSize);
      await Promise.all(
        chunk.map((patch) =>
          db
            .update(salesForecastMonthly)
            .set({
              forecastDailyAvg: String(patch.next),
              updatedAt: new Date(),
            })
            .where(eq(salesForecastMonthly.id, patch.id)),
        ),
      );
    }
  }

  console.info(
    `[forecast] SI portfolio reshape version=${input.versionId} asOf=${asOfMonth} groups=${groupsTouched} rows=${patches.length}${dryRun ? ' (dry-run)' : ''}`,
  );
  return { changedRows: patches.length, groupsTouched, asOfMonth, dryRun };
}

export function shouldRunSiReshapeAfterGenerate(mode?: SeasonalIndexMode | null): boolean {
  if (!resolveSeasonalIndexReshapeEnabled()) return false;
  const resolved = mode ?? resolveSeasonalIndexMode();
  return resolved !== 'off';
}
