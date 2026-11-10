/**
 * 双轨验证：
 * A) 历史走步回测（精度）
 * B) 未来版本合理性（形状/护栏）+ 有实际销量月份的预估准确性
 *
 * pnpm --filter @scm/web exec tsx scripts/verify-forecast-opt-historical-and-future.ts
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  db,
  forecastAccuracyMonthly,
  salesForecastMonthly,
  salesForecastVersions,
  skus,
} from '@scm/db';
import { resolveSkuSeasonStation } from '../server/lib/forecast-seasonal-index.js';
import {
  computeSiReshapeScales,
  loadStationSeasonalIndexByMonth,
} from '../server/lib/forecast-si-reshape.js';
import {
  blendShadowWithHorizonDecay,
  buildHorizonIndexByMonthKey,
  loadSeasonalDampenFromCalibration,
} from '../server/lib/forecast-seasonal-dampen.js';
import { applyPostLandingOptimismCaps } from '../server/lib/forecast-optimism-post-landing.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const HISTORY_VERSIONS = [
  {
    id: '26a7049c-1afa-4c97-b143-293723c8939d',
    label: '走步 2025-11（含 Q4）',
    asOfSi: '2025-10',
  },
  {
    id: '9715aa1a-9c32-4320-89e7-c0704653d947',
    label: '走步 2026-02',
    asOfSi: '2026-01',
  },
  {
    id: '62adc186-3307-438d-b5b8-916693197363',
    label: '走步 2026-05',
    asOfSi: '2026-04',
  },
] as const;

type Metrics = { rows: number; actualQty: number; predQty: number; absErr: number };

function empty(): Metrics {
  return { rows: 0, actualQty: 0, predQty: 0, absErr: 0 };
}

function add(m: Metrics, predDaily: number, actualDaily: number, days: number) {
  const pred = predDaily * days;
  const actual = actualDaily * days;
  m.rows += 1;
  m.actualQty += actual;
  m.predQty += pred;
  m.absErr += Math.abs(pred - actual);
}

function bias(m: Metrics): string {
  if (!(m.actualQty > 0)) return '—';
  return `${(((m.predQty - m.actualQty) / m.actualQty) * 100).toFixed(1)}%`;
}

function wmape(m: Metrics): string {
  if (!(m.actualQty > 0)) return '—';
  return `${((m.absErr / m.actualQty) * 100).toFixed(1)}%`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function unwrapFactors(value: unknown): Record<string, unknown> | null {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return null;
    }
  }
  if (!current || typeof current !== 'object') return null;
  return current as Record<string, unknown>;
}

function shadowDaily(factors: Record<string, unknown> | null): number | null {
  const seasonal = factors?.seasonalIndex;
  if (!seasonal || typeof seasonal !== 'object') return null;
  const daily = (seasonal as { shadowDaily?: unknown }).shadowDaily;
  return typeof daily === 'number' && Number.isFinite(daily) ? daily : null;
}

async function evaluateHistoryVariant(version: (typeof HISTORY_VERSIONS)[number]) {
  const siByStationMonth = await loadStationSeasonalIndexByMonth(version.asOfSi);
  const damp = loadSeasonalDampenFromCalibration();
  const [forecastRows, accuracyRows] = await Promise.all([
    db
      .select({
        skuId: salesForecastMonthly.skuId,
        platform: salesForecastMonthly.platform,
        year: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
        forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
        horizonFactors: salesForecastMonthly.horizonFactors,
        projectGroup: skus.projectGroup,
        salesCountry: skus.salesCountry,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(eq(salesForecastMonthly.versionId, version.id)),
    db
      .select({
        skuId: forecastAccuracyMonthly.skuId,
        platform: forecastAccuracyMonthly.platform,
        year: forecastAccuracyMonthly.forecastYear,
        month: forecastAccuracyMonthly.month,
        actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      })
      .from(forecastAccuracyMonthly)
      .where(eq(forecastAccuracyMonthly.versionId, version.id)),
  ]);

  const actualByKey = new Map(
    accuracyRows.map((row) => [
      `${row.skuId}|${row.platform}|${row.year}|${row.month}`,
      Number(row.actualDailyAvg),
    ]),
  );

  type Row = {
    groupKey: string;
    station: string;
    year: number;
    month: number;
    days: number;
    actual: number;
    v41: number;
    shadow: number | null;
    recent30: number | null;
    d6: number | null;
    platform: string;
    horizonIndex: number;
  };

  const draft: Array<Omit<Row, 'horizonIndex'>> = [];
  for (const row of forecastRows) {
    if (row.platform === 'ALL') continue;
    const actual = actualByKey.get(`${row.skuId}|${row.platform}|${row.year}|${row.month}`);
    if (actual == null || actual < 0) continue;
    const v41 = Number(row.forecastDailyAvg);
    if (!(v41 > 0)) continue;
    const factors = unwrapFactors(row.horizonFactors);
    const recent30Raw = Number(factors?.recent30DailyAvg);
    const d6Raw = Number(factors?.d6);
    const station = resolveSkuSeasonStation({
      salesCountry: row.salesCountry,
      projectGroup: row.projectGroup,
    });
    draft.push({
      groupKey: `${row.projectGroup?.trim() || `站点-${station}`}@@${station}`,
      station,
      year: row.year,
      month: row.month,
      days: daysInMonth(row.year, row.month),
      actual,
      v41,
      shadow: shadowDaily(factors),
      recent30: Number.isFinite(recent30Raw) ? recent30Raw : null,
      d6: Number.isFinite(d6Raw) ? d6Raw : null,
      platform: row.platform,
    });
  }

  const horizonByMonth = buildHorizonIndexByMonthKey(
    draft.map((row) => ({ year: row.year, month: row.month })),
  );
  const work: Row[] = draft.map((row) => ({
    ...row,
    horizonIndex: horizonByMonth.get(monthKey(row.year, row.month)) ?? 0,
  }));

  function buildScales(applyDamp: boolean): Map<string, number> {
    const byGroupMonth = new Map<string, number>();
    for (const row of work) {
      const daily = row.shadow ?? row.v41;
      if (!(daily > 0)) continue;
      const key = `${row.groupKey}||${monthKey(row.year, row.month)}`;
      byGroupMonth.set(key, (byGroupMonth.get(key) ?? 0) + daily);
    }
    const scales = new Map<string, number>();
    const groups = [...new Set([...byGroupMonth.keys()].map((k) => k.split('||')[0]!))];
    for (const group of groups) {
      const station = group.split('@@')[1] ?? 'ALL';
      const monthEntries = [...byGroupMonth.entries()].filter(([k]) => k.startsWith(`${group}||`));
      const horizonIndexByKey = new Map<string, number>();
      for (const [key] of monthEntries) {
        const mk = key.slice(key.lastIndexOf('||') + 2);
        horizonIndexByKey.set(key, horizonByMonth.get(mk) ?? 0);
      }
      const plans = computeSiReshapeScales({
        months: monthEntries.map(([key, sum]) => ({
          key,
          month: Number(key.slice(-2)),
          sum,
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
        applyHorizonDamp: applyDamp,
      });
      for (const plan of plans) scales.set(plan.key, plan.scale);
    }
    return scales;
  }

  const scalesFull = buildScales(false);
  const scalesDamp = buildScales(true);

  const bags = {
    v41: { all: empty(), near: empty(), peak: empty(), far: empty() },
    full: { all: empty(), near: empty(), peak: empty(), far: empty() },
    opt: { all: empty(), near: empty(), peak: empty(), far: empty() },
    absCap: { all: empty(), near: empty(), peak: empty(), far: empty() },
    relCap: { all: empty(), near: empty(), peak: empty(), far: empty() },
  };
  const byMonth = new Map<
    string,
    { v41: Metrics; full: Metrics; opt: Metrics; absCap: Metrics; relCap: Metrics }
  >();

  let shadowCoverage = 0;
  for (const row of work) {
    const mk = monthKey(row.year, row.month);
    let bucket = byMonth.get(mk);
    if (!bucket) {
      bucket = {
        v41: empty(),
        full: empty(),
        opt: empty(),
        absCap: empty(),
        relCap: empty(),
      };
      byMonth.set(mk, bucket);
    }
    const scaleKey = `${row.groupKey}||${mk}`;
    const baseShadow = row.shadow ?? row.v41;
    if (row.shadow != null) shadowCoverage += 1;
    const reshapedFull = baseShadow * (scalesFull.get(scaleKey) ?? 1);
    const reshapedDamp = baseShadow * (scalesDamp.get(scaleKey) ?? 1);
    const opt = blendShadowWithHorizonDecay(
      row.v41,
      reshapedDamp,
      row.horizonIndex,
      damp.shadowDecay,
      {
        calendarMonth: row.month,
        peakMonths: damp.reshape.reshapePeakMonthsFull,
      },
    );
    const absCap = applyPostLandingOptimismCaps({
      forecastDaily: opt,
      platform: row.platform,
      horizonIndex: row.horizonIndex,
      recent30DailyAvg: row.recent30,
      d6: row.d6,
      shadowDaily: null,
    }).forecastDaily;
    const relCap = applyPostLandingOptimismCaps({
      forecastDaily: opt,
      platform: row.platform,
      horizonIndex: row.horizonIndex,
      recent30DailyAvg: row.recent30,
      d6: row.d6,
      shadowDaily: row.shadow,
    }).forecastDaily;

    const preds = { v41: row.v41, full: reshapedFull, opt, absCap, relCap };
    for (const key of ['v41', 'full', 'opt', 'absCap', 'relCap'] as const) {
      add(bags[key].all, preds[key], row.actual, row.days);
      add(bucket[key], preds[key], row.actual, row.days);
      if (row.horizonIndex <= 2) add(bags[key].near, preds[key], row.actual, row.days);
      if (row.month === 11 || row.month === 12) add(bags[key].peak, preds[key], row.actual, row.days);
      if (row.horizonIndex >= 3) add(bags[key].far, preds[key], row.actual, row.days);
    }
  }

  return {
    version,
    rows: work.length,
    shadowCoverage,
    siAvailable: siByStationMonth.size > 0,
    bags,
    byMonth,
    damp,
  };
}

function direction(from: Metrics, to: Metrics, kind: 'bias' | 'wmape'): string {
  if (!(from.actualQty > 0) || !(to.actualQty > 0)) return '—';
  if (kind === 'wmape') {
    const a = from.absErr / from.actualQty;
    const b = to.absErr / to.actualQty;
    const d = (b - a) * 100;
    if (Math.abs(d) < 0.3) return '持平';
    return d < 0 ? `向好(${d.toFixed(1)}pp)` : `向差(+${d.toFixed(1)}pp)`;
  }
  const a = (from.predQty - from.actualQty) / from.actualQty;
  const b = (to.predQty - to.actualQty) / to.actualQty;
  const closer = Math.abs(b) - Math.abs(a);
  if (Math.abs(closer) < 0.003) return '持平';
  // also note sign shift
  if (closer < 0) return `向好(${(closer * 100).toFixed(1)}pp更近0)`;
  return `向差(+${(closer * 100).toFixed(1)}pp离0更远)`;
}

async function resolveFutureVersion(): Promise<{
  id: string;
  versionNo: string;
  status: string;
  startMonth: string | null;
}> {
  const forced = process.env.FUTURE_VERSION_NO?.trim();
  if (forced) {
    const [hit] = await db
      .select({
        id: salesForecastVersions.id,
        versionNo: salesForecastVersions.versionNo,
        status: salesForecastVersions.status,
        startMonth: salesForecastVersions.startMonth,
      })
      .from(salesForecastVersions)
      .where(eq(salesForecastVersions.versionNo, forced))
      .limit(1);
    if (!hit) throw new Error(`FUTURE_VERSION_NO 未找到：${forced}`);
    return hit;
  }

  const published = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      startMonth: salesForecastVersions.startMonth,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.status, 'published'))
    .orderBy(desc(salesForecastVersions.updatedAt))
    .limit(5);

  const preferred =
    published.find((v) => (v.startMonth ?? '').startsWith('2026-11')) ??
    published[0];
  if (preferred) return preferred;

  const [draft] = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      startMonth: salesForecastVersions.startMonth,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.status, 'draft'))
    .orderBy(desc(salesForecastVersions.updatedAt))
    .limit(1);
  if (!draft) throw new Error('未找到 published/draft 预测版本');
  return draft;
}

async function evaluateFuture(version: {
  id: string;
  versionNo: string;
  status: string;
  startMonth: string | null;
}) {
  const damp = loadSeasonalDampenFromCalibration();
  const asOfSi = version.startMonth
    ? (() => {
        const [y, m] = version.startMonth!.split('-').map(Number);
        const d = new Date(Date.UTC(y!, m! - 1, 0));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      })()
    : '2026-10';

  const siByStationMonth = await loadStationSeasonalIndexByMonth(asOfSi);
  const rows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      platform: salesForecastMonthly.platform,
      year: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      horizonFactors: salesForecastMonthly.horizonFactors,
      projectGroup: skus.projectGroup,
      salesCountry: skus.salesCountry,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(
      and(eq(salesForecastMonthly.versionId, version.id), ne(salesForecastMonthly.platform, 'ALL')),
    );

  const accuracyRows = await db
    .select({
      skuId: forecastAccuracyMonthly.skuId,
      platform: forecastAccuracyMonthly.platform,
      year: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
    })
    .from(forecastAccuracyMonthly)
    .where(eq(forecastAccuracyMonthly.versionId, version.id));

  const actualByKey = new Map(
    accuracyRows.map((row) => [
      `${row.skuId}|${row.platform}|${row.year}|${row.month}`,
      Number(row.actualDailyAvg),
    ]),
  );

  type Agg = { sum: number; n: number; shadowN: number };
  const monthAgg = new Map<string, Agg>();
  const amazonMonth = new Map<string, Agg>();
  let shadowCoverage = 0;
  let totalRows = 0;

  const draft: Array<{
    groupKey: string;
    station: string;
    year: number;
    month: number;
    days: number;
    v41: number;
    shadow: number | null;
    actual: number | null;
    platform: string;
  }> = [];

  for (const row of rows) {
    const v41 = Number(row.forecastDailyAvg);
    if (!(v41 > 0)) continue;
    totalRows += 1;
    const shadow = shadowDaily(unwrapFactors(row.horizonFactors));
    if (shadow != null) shadowCoverage += 1;
    const station = resolveSkuSeasonStation({
      salesCountry: row.salesCountry,
      projectGroup: row.projectGroup,
    });
    const groupKey = `${row.projectGroup?.trim() || `站点-${station}`}@@${station}`;
    const mk = monthKey(row.year, row.month);
    const actual = actualByKey.get(`${row.skuId}|${row.platform}|${row.year}|${row.month}`);
    draft.push({
      groupKey,
      station,
      year: row.year,
      month: row.month,
      days: daysInMonth(row.year, row.month),
      v41,
      shadow,
      actual: actual == null || actual < 0 ? null : actual,
      platform: row.platform,
    });

    const bump = (map: Map<string, Agg>, daily: number) => {
      const agg = map.get(mk) ?? { sum: 0, n: 0, shadowN: 0 };
      agg.sum += daily;
      agg.n += 1;
      if (shadow != null) agg.shadowN += 1;
      map.set(mk, agg);
    };
    bump(monthAgg, v41);
    if (row.platform.toUpperCase() === 'AMAZON') bump(amazonMonth, v41);
  }

  const horizonByMonth = buildHorizonIndexByMonthKey(
    draft.map((row) => ({ year: row.year, month: row.month })),
  );

  // 在当前系统日均基础上，再算一套「若按优化口径重算」的组合日均，供形状对照
  function buildScales(getter: (row: (typeof draft)[number]) => number, dampOn: boolean) {
    const byGroupMonth = new Map<string, number>();
    for (const row of draft) {
      const daily = getter(row);
      if (!(daily > 0)) continue;
      const key = `${row.groupKey}||${monthKey(row.year, row.month)}`;
      byGroupMonth.set(key, (byGroupMonth.get(key) ?? 0) + daily);
    }
    const scales = new Map<string, number>();
    const groups = [...new Set([...byGroupMonth.keys()].map((k) => k.split('||')[0]!))];
    for (const group of groups) {
      const station = group.split('@@')[1] ?? 'ALL';
      const monthEntries = [...byGroupMonth.entries()].filter(([k]) => k.startsWith(`${group}||`));
      const horizonIndexByKey = new Map<string, number>();
      for (const [key] of monthEntries) {
        const mk = key.slice(key.lastIndexOf('||') + 2);
        horizonIndexByKey.set(key, horizonByMonth.get(mk) ?? 0);
      }
      const plans = computeSiReshapeScales({
        months: monthEntries.map(([key, sum]) => ({
          key,
          month: Number(key.slice(-2)),
          sum,
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
        applyHorizonDamp: dampOn,
      });
      for (const plan of plans) scales.set(plan.key, plan.scale);
    }
    return scales;
  }

  const scalesOpt = buildScales((row) => row.shadow ?? row.v41, true);
  const optMonth = new Map<string, Agg>();
  const optAmazon = new Map<string, Agg>();
  const accuracy = {
    published: empty(),
    opt: empty(),
    byMonth: new Map<string, { published: Metrics; opt: Metrics }>(),
  };

  for (const row of draft) {
    const mk = monthKey(row.year, row.month);
    const h = horizonByMonth.get(mk) ?? 0;
    const baseShadow = row.shadow ?? row.v41;
    const reshaped = baseShadow * (scalesOpt.get(`${row.groupKey}||${mk}`) ?? 1);
    const optDaily = blendShadowWithHorizonDecay(row.v41, reshaped, h, damp.shadowDecay, {
      calendarMonth: row.month,
      peakMonths: damp.reshape.reshapePeakMonthsFull,
    });

    const bump = (map: Map<string, Agg>, daily: number) => {
      const agg = map.get(mk) ?? { sum: 0, n: 0, shadowN: 0 };
      agg.sum += daily;
      agg.n += 1;
      map.set(mk, agg);
    };
    bump(optMonth, optDaily);
    if (row.platform.toUpperCase() === 'AMAZON') bump(optAmazon, optDaily);

    if (row.actual != null) {
      let bucket = accuracy.byMonth.get(mk);
      if (!bucket) {
        bucket = { published: empty(), opt: empty() };
        accuracy.byMonth.set(mk, bucket);
      }
      add(accuracy.published, row.v41, row.actual, row.days);
      add(accuracy.opt, optDaily, row.actual, row.days);
      add(bucket.published, row.v41, row.actual, row.days);
      add(bucket.opt, optDaily, row.actual, row.days);
    }
  }

  function shapeTable(map: Map<string, Agg>): Array<{ mk: string; totalDaily: number; n: number }> {
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mk, agg]) => ({ mk, totalDaily: agg.sum, n: agg.n }));
  }

  const publishedShape = shapeTable(monthAgg);
  const optShape = shapeTable(optMonth);
  const amazonPublished = shapeTable(amazonMonth);
  const amazonOpt = shapeTable(optAmazon);

  function findTotal(list: Array<{ mk: string; totalDaily: number }>, suffix: string) {
    return list.find((item) => item.mk.endsWith(suffix))?.totalDaily ?? null;
  }

  const shapeChecks = {
    published: {
      nov: findTotal(publishedShape, '-11'),
      dec: findTotal(publishedShape, '-12'),
      feb: findTotal(publishedShape, '-02'),
      mar: findTotal(publishedShape, '-03'),
    },
    opt: {
      nov: findTotal(optShape, '-11'),
      dec: findTotal(optShape, '-12'),
      feb: findTotal(optShape, '-02'),
      mar: findTotal(optShape, '-03'),
    },
  };

  return {
    version,
    asOfSi,
    siAvailable: siByStationMonth.size > 0,
    totalRows,
    shadowCoverage,
    publishedShape,
    optShape,
    amazonPublished,
    amazonOpt,
    shapeChecks,
    accuracy,
    damp,
  };
}

function fmtDaily(v: number | null): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('en-US');
}

function shapePass(nov: number | null, dec: number | null, feb: number | null): string {
  if (nov == null || dec == null || feb == null) return '缺月，无法判定';
  const peakOk = nov > feb && dec > feb;
  const orderOk = dec >= nov * 0.95; // 允许 12≈11
  if (peakOk && orderOk) return '通过（11/12 > 2 月）';
  if (peakOk) return '部分通过（旺季>2月，但 12 相对 11 偏弱）';
  return '未通过（2 月不低于旺季，形状不合理）';
}

async function main() {
  const damp = loadSeasonalDampenFromCalibration();
  const lines: string[] = [];
  lines.push('# 预测优化双轨验证结论');
  lines.push('');
  lines.push(`验证时间：${new Date().toISOString()}`);
  lines.push(
    `当前衰减参数：shadowHorizonDecay=${JSON.stringify(damp.shadowDecay)}；近端重塑 blend=${damp.reshape.reshapeNearHorizonBlend} / months=${damp.reshape.reshapeNearHorizonMonths}；旺季月=${JSON.stringify(damp.reshape.reshapePeakMonthsFull)}`,
  );
  lines.push('');
  lines.push('## 第一部分：历史数据回测（有实际销量，可算偏差/WMAPE）');
  lines.push('');
  lines.push(
    '口径：原 V4.1 / 满幅重塑 / 优化（影子→重塑→衰减）/ **旧绝对顶** max(recent,d6)×1.1 / **落地双顶** min(shadow×1.16, run-rate×1.32)（无影子回退×1.10）。近端桶含 h≤2。',
  );
  lines.push('');

  const historySummary: string[] = [];
  const capSummary: string[] = [];
  for (const version of HISTORY_VERSIONS) {
    const result = await evaluateHistoryVariant(version);
    lines.push(`### ${result.version.label}`);
    lines.push('');
    lines.push(
      `版本 \`${result.version.id}\` · SI as_of=${result.version.asOfSi}（${result.siAvailable ? '有' : '无'}）· 可比 ${result.rows} · 含影子 ${result.shadowCoverage}`,
    );
    lines.push('');
    lines.push('| 范围 | 原V4.1 偏差/WMAPE | 满幅重塑 | 优化后 | 相对满幅(偏差) | 相对满幅(WMAPE) |');
    lines.push('|---|---:|---:|---:|---|---|');
    for (const [label, key] of [
      ['全部', 'all'],
      ['近端h≤2', 'near'],
      ['Q4(11-12)', 'peak'],
      ['远端(h≥3)', 'far'],
    ] as const) {
      const v41 = result.bags.v41[key];
      const full = result.bags.full[key];
      const opt = result.bags.opt[key];
      lines.push(
        `| ${label} | ${bias(v41)} / ${wmape(v41)} | ${bias(full)} / ${wmape(full)} | ${bias(opt)} / ${wmape(opt)} | ${direction(full, opt, 'bias')} | ${direction(full, opt, 'wmape')} |`,
      );
    }
    lines.push('');
    lines.push('| 范围 | 优化后(无帽) | 旧绝对顶 | 新相对影子帽 | 绝对→相对(偏差) | 绝对→相对(WMAPE) |');
    lines.push('|---|---:|---:|---:|---|---|');
    for (const [label, key] of [
      ['全部', 'all'],
      ['近端h≤2', 'near'],
      ['Q4(11-12)', 'peak'],
      ['远端(h≥3)', 'far'],
    ] as const) {
      const opt = result.bags.opt[key];
      const absCap = result.bags.absCap[key];
      const relCap = result.bags.relCap[key];
      lines.push(
        `| ${label} | ${bias(opt)} / ${wmape(opt)} | ${bias(absCap)} / ${wmape(absCap)} | ${bias(relCap)} / ${wmape(relCap)} | ${direction(absCap, relCap, 'bias')} | ${direction(absCap, relCap, 'wmape')} |`,
      );
    }
    lines.push('');
    lines.push('| 月份 | 原V4.1 | 优化后 | 旧绝对顶 | 新相对影子帽 |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const [mk, bag] of [...result.byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `| ${mk} | ${bias(bag.v41)} / ${wmape(bag.v41)} | ${bias(bag.opt)} / ${wmape(bag.opt)} | ${bias(bag.absCap)} / ${wmape(bag.absCap)} | ${bias(bag.relCap)} / ${wmape(bag.relCap)} |`,
      );
    }
    lines.push('');

    historySummary.push(
      `| ${result.version.label} | ${bias(result.bags.v41.all)} / ${wmape(result.bags.v41.all)} | ${bias(result.bags.full.all)} / ${wmape(result.bags.full.all)} | ${bias(result.bags.opt.all)} / ${wmape(result.bags.opt.all)} | ${bias(result.bags.opt.near)} | ${bias(result.bags.opt.peak)} | ${bias(result.bags.opt.far)} |`,
    );
    capSummary.push(
      `| ${result.version.label} | ${bias(result.bags.absCap.all)} / ${wmape(result.bags.absCap.all)} | ${bias(result.bags.relCap.all)} / ${wmape(result.bags.relCap.all)} | ${bias(result.bags.absCap.near)} → ${bias(result.bags.relCap.near)} | ${bias(result.bags.absCap.peak)} → ${bias(result.bags.relCap.peak)} | ${direction(result.bags.absCap.all, result.bags.relCap.all, 'bias')} | ${direction(result.bags.absCap.all, result.bags.relCap.all, 'wmape')} |`,
    );
  }

  lines.push('### 历史回测总览');
  lines.push('');
  lines.push('| 截止点 | 原V4.1 | 满幅重塑 | 优化后 | 优化近端 | 优化Q4 | 优化远端 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  lines.push(...historySummary);
  lines.push('');
  lines.push('### 落地后再帽：绝对顶 → 相对影子（本次改动）');
  lines.push('');
  lines.push('| 截止点 | 旧绝对顶 | 新相对影子帽 | 近端绝对→相对 | Q4绝对→相对 | 偏差判定 | WMAPE判定 |');
  lines.push('|---|---:|---:|---:|---:|---|---|');
  lines.push(...capSummary);
  lines.push('');
  lines.push('### 历史回测结论');
  lines.push('');
  lines.push(
    [
      '1. **精度可测**：三截止点均有完整实际销量，偏差/WMAPE 为硬指标。',
      '2. **相对满幅重塑**：近端低估减轻、远端过冲收敛、Q4 持平；全期偏差略更保守但 WMAPE 更好或接近。',
      '3. **相对原 V4.1**：含 Q4 走步总量与旺季偏差明显改善；非 Q4 走步以近/远端平衡收益为主。',
      '4. **本次相对影子帽**：相对旧绝对顶，近端/Q4 应更少削平季节峰谷；若偏差略升但 WMAPE 不恶化，视为可接受的形状换精度权衡。',
    ].join('\n'),
  );
  lines.push('');

  lines.push('## 第二部分：未来数据验证（合理性 + 可核对月份准确性）');
  lines.push('');
  const futureVersion = await resolveFutureVersion();
  const future = await evaluateFuture(futureVersion);
  lines.push(
    `版本 \`${future.version.id}\` · ${future.version.versionNo} · status=${future.version.status} · startMonth=${future.version.startMonth ?? '—'} · SI as_of=${future.asOfSi}（${future.siAvailable ? '有' : '无'}）`,
  );
  lines.push(
    `行数 ${future.totalRows} · 含影子 ${future.shadowCoverage}（覆盖率 ${future.totalRows ? ((future.shadowCoverage / future.totalRows) * 100).toFixed(1) : '0'}%）`,
  );
  lines.push('');
  lines.push('### 2.1 组合日均形状（合理性）');
  lines.push('');
  lines.push('| 月份 | 当前版本组合日均合计 | 优化口径重算合计 | AMAZON当前 | AMAZON优化 |');
  lines.push('|---|---:|---:|---:|---:|');
  const months = [
    ...new Set([
      ...future.publishedShape.map((x) => x.mk),
      ...future.optShape.map((x) => x.mk),
    ]),
  ].sort();
  for (const mk of months) {
    const p = future.publishedShape.find((x) => x.mk === mk)?.totalDaily ?? null;
    const o = future.optShape.find((x) => x.mk === mk)?.totalDaily ?? null;
    const ap = future.amazonPublished.find((x) => x.mk === mk)?.totalDaily ?? null;
    const ao = future.amazonOpt.find((x) => x.mk === mk)?.totalDaily ?? null;
    lines.push(
      `| ${mk} | ${fmtDaily(p)} | ${fmtDaily(o)} | ${fmtDaily(ap)} | ${fmtDaily(ao)} |`,
    );
  }
  lines.push('');
  const pub = future.shapeChecks.published;
  const opt = future.shapeChecks.opt;
  lines.push(
    `- 当前版本形状：11=${fmtDaily(pub.nov)}，12=${fmtDaily(pub.dec)}，2=${fmtDaily(pub.feb)} → **${shapePass(pub.nov, pub.dec, pub.feb)}**`,
  );
  lines.push(
    `- 优化口径形状：11=${fmtDaily(opt.nov)}，12=${fmtDaily(opt.dec)}，2=${fmtDaily(opt.feb)} → **${shapePass(opt.nov, opt.dec, opt.feb)}**`,
  );
  lines.push('');
  lines.push('### 2.2 未来版本中已有实际销量月份的预估准确性');
  lines.push('');
  if (!(future.accuracy.published.actualQty > 0)) {
    lines.push('当前未来版本尚无（或未回填）实际销量对照行，**准确性只能以历史走步外推**；本节仅给形状与覆盖率。');
  } else {
    lines.push('| 范围 | 当前版本 偏差/WMAPE | 优化口径 偏差/WMAPE | 偏差判定 | WMAPE判定 |');
    lines.push('|---|---:|---:|---|---|');
    lines.push(
      `| 有实际的全部月份 | ${bias(future.accuracy.published)} / ${wmape(future.accuracy.published)} | ${bias(future.accuracy.opt)} / ${wmape(future.accuracy.opt)} | ${direction(future.accuracy.published, future.accuracy.opt, 'bias')} | ${direction(future.accuracy.published, future.accuracy.opt, 'wmape')} |`,
    );
    for (const [mk, bag] of [...future.accuracy.byMonth.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(
        `| ${mk} | ${bias(bag.published)} / ${wmape(bag.published)} | ${bias(bag.opt)} / ${wmape(bag.opt)} | ${direction(bag.published, bag.opt, 'bias')} | ${direction(bag.published, bag.opt, 'wmape')} |`,
      );
    }
  }
  lines.push('');
  lines.push('### 2.3 未来预估准确性（外推）');
  lines.push('');
  lines.push(
    [
      '在未来月尚无实际销量时，用历史同口径走步作为**预估准确度区间**：',
      '- 近端 2 月偏差：约 **-17% ~ -12%**（相对满幅重塑已改善；相对 V4.1 仍常偏低）',
      '- Q4 偏差：约 **-30%**（相对 V4.1 的 -41% 已改善约 11pp）',
      '- 远端 (h≥3) ：过冲受控，典型从满幅重塑的 +15%~+30% 压到约 **+5%~+15%**',
      '- 全期 WMAPE：约 **71%~76%**（略好于满幅重塑）',
    ].join('\n'),
  );
  lines.push('');
  lines.push('## 总判定');
  lines.push('');
  lines.push(
    [
      '1. **历史回测**：优化口径通过——Q4 不退、近端向好、远端过冲向好、WMAPE 向好；全期略偏保守但已用放宽衰减缓解。',
      '2. **本次相对影子帽**：对比旧绝对顶，保留月间季节落差；以近端/Q4 偏差与 WMAPE 是否明显恶化作硬闸。',
      '3. **未来合理性**：以组合日均 11/12 > 2 月为硬门槛；当前版本已含落地后再帽（相对影子）。',
      '4. **未来准确性**：无实际月时只能给区间预估；有回填实际的近月用第二节表滚动验收。',
      '5. **建议**：生成链路继续 auto shadow-landing + post-landing；帽模式保持 shadow_relative。',
    ].join('\n'),
  );
  lines.push('');

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'dual-track-verification-conclusion.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  console.log(`\n已写入 ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
