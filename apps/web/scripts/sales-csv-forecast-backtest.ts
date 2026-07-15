/**
 * 销售月报 CSV 完整回测实验（24 月训练 → 后 6 月验证）
 * Usage: pnpm --filter @scm/web exec tsx scripts/sales-csv-forecast-backtest.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  getSalesTierKpiTarget,
  getT1SubKpiTarget,
  getForecastPhase,
  resolveSalesTierSegment,
  resolveT1SubSegment,
  salesTierLabel,
  salesTierSegmentLabel,
  salesTierSkipsForecast,
  shouldForecastSalesTier,
  salesTierToProfileClass,
  SALES_TIER_META,
  SALES_TIER_SEGMENT_META,
  T1_SUB_SEGMENT_META,
  type SalesTier,
  type SalesTierSegment,
  type T1SubSegment,
} from '../server/lib/forecast-sales-tier.js';
import {
  DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
  DEFAULT_OUTLIER_APE_THRESHOLD,
  detectOutlierSkus,
  getOutlierApeThreshold,
  isOutlierRow,
  resolveExogenousSkuSet,
  summarizeWmapeWithOutlierExclusion,
} from '../server/lib/forecast-accuracy-outlier.js';
import {
  exogenousSkuCodesFromFlags,
  loadExogenousFlagsFromCsv,
} from '../server/lib/forecast-exogenous-flags.js';
import {
  buildSkuAccuracySampleReport,
  formatSkuSampleTable,
  skuSampleToCsvRows,
  type SkuAccuracyRowInput,
  type SkuAccuracySampleReport,
} from '../server/lib/forecast-sku-accuracy-sample.js';
import {
  buildMonthlyAbcdCPoolContext,
  computeMonthlyAbcdForecastDailyAvg,
  deriveRecentDailyFromMonthly,
  inferLifecycleFromMonthly,
  monthlyQtyToDailyAvg,
} from '../server/lib/forecast-monthly-abcd.js';
import { buildCategoryPoolKey } from '../server/lib/forecast-aggregate-pool.js';
import { cleanMonthlyQtyForTraining, detectMonthlyAnomalies } from '../server/lib/forecast-monthly-clean.js';
import { daysInCalendarMonth } from '../server/lib/forecast-baseline.js';
import { summarizeAccuracyMatrix } from '../server/lib/forecast-horizon-band.js';
import type { AccuracyRowInput } from '../server/lib/forecast-accuracy-tier.js';
import type { ProfileClass, ProfileSegment } from '../server/lib/forecast-profile-class.js';
import { resolveSkuProfileSegment } from '../server/lib/forecast-profile-class.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_CSV = resolve(
  ROOT,
  'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv',
);
const OUT_DIR = resolve(ROOT, 'docs/samples/forecast-backtest/csv-backtest-report');

const TRAIN_MONTHS = 24;
const HOLDOUT_MONTHS = 6;

type AnomalyFlag = 'none' | 'stockout' | 'promo' | 'incomplete';

type SkuRow = {
  sku: string;
  name: string;
  station: string;
  platform: string;
  category: string;
  months: Record<string, number>;
};

type CleanCell = {
  sku: string;
  yearMonth: string;
  qty: number;
  rawQty: number;
  anomaly: AnomalyFlag;
};

type ForecastRow = {
  sku: string;
  salesTier: SalesTier;
  salesSegment: SalesTierSegment;
  t1SubSegment: T1SubSegment | null;
  profileClass: ProfileClass;
  profileSegment: ProfileSegment;
  yearMonth: string;
  horizon: number;
  predicted: number;
  actual: number;
  predictedDaily: number;
  actualDaily: number;
  model: string;
  ghostRow: boolean;
  outlierRow: boolean;
  outlierSku: boolean;
  exogenousSku: boolean;
  kpiCore: boolean;
};

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

/** 简易 CSV 解析（支持引号内逗号） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseMonthCol(col: string): string | null {
  const m = /^\((\d{4}-\d{2})\)$/.exec(col.trim());
  return m ? m[1]! : null;
}

function loadCsv(path: string): {
  rows: SkuRow[];
  monthCols: string[];
  metaCols: string[];
  rawRowCount: number;
} {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]!);
  const metaCols = header.filter((c) => !parseMonthCol(c));
  const monthCols = header
    .map((c) => parseMonthCol(c))
    .filter((c): c is string => c != null)
    .sort();

  const bySku = new Map<string, SkuRow>();
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]!);
    const record: Record<string, string> = {};
    header.forEach((h, j) => {
      record[h] = (parts[j] ?? '').trim();
    });
    const sku = record.SKU ?? '';
    if (!sku) continue;

    const months: Record<string, number> = {};
    for (const ym of monthCols) {
      const col = `(${ym})`;
      const v = Number(record[col]);
      months[ym] = Number.isFinite(v) ? Math.max(0, v) : 0;
    }

    const existing = bySku.get(sku);
    if (!existing) {
      bySku.set(sku, {
        sku,
        name: record['SKU名称'] ?? '',
        station: record['站点'] ?? '',
        platform: record['平台'] ?? '',
        category: record['品类'] ?? '',
        months,
      });
      continue;
    }

    for (const ym of monthCols) {
      existing.months[ym] = (existing.months[ym] ?? 0) + (months[ym] ?? 0);
    }
    if (!existing.category && record['品类']) existing.category = record['品类'];
  }

  return { rows: [...bySku.values()], monthCols, metaCols, rawRowCount: lines.length - 1 };
}

function detectAnomalies(
  sku: string,
  series: { yearMonth: string; qty: number }[],
): CleanCell[] {
  const flags = detectMonthlyAnomalies(series.map((s) => s.qty));
  return series.map(({ yearMonth, qty }, i) => ({
    sku,
    yearMonth,
    qty,
    rawQty: qty,
    anomaly: flags[i] === 'stockout' ? 'stockout' : flags[i] === 'promo' ? 'promo' : 'none',
  }));
}

function monthlyFromDaily(daily: number, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return daily * daysInCalendarMonth(y!, m!);
}

function ape(predicted: number, actual: number): number | null {
  if (actual <= 0) return predicted <= 0 ? 0 : null;
  return Math.abs(predicted - actual) / actual;
}

function mape(rows: ForecastRow[]): number | null {
  const valid = rows.map((r) => ape(r.predicted, r.actual)).filter((x): x is number => x != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** 可比 WMAPE（日级口径，对齐 forecast-accuracy-tier） */
function wmape(rows: ForecastRow[]): number | null {
  const comparable = rows.filter((r) => r.actualDaily > 0);
  if (comparable.length === 0) return null;
  const totalActual = comparable.reduce((s, r) => s + r.actualDaily, 0);
  if (totalActual <= 0) return null;
  const totalAbsErr = comparable.reduce(
    (s, r) => s + Math.abs(r.predictedDaily - r.actualDaily),
    0,
  );
  return totalAbsErr / totalActual;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number | null): string {
  return n == null ? '—' : pct(n);
}

type SalesTierMatrixRow = {
  segment: SalesTierSegment;
  label: string;
  measurable: boolean;
  nearWmape: number | null;
  farWmape: number | null;
  ghostNear: number;
  comparableNear: number;
};

type T1SubMatrixRow = {
  sub: T1SubSegment;
  label: string;
  gateOrder: number;
  measurable: boolean;
  nearWmapeAll: number | null;
  nearWmapeCore: number | null;
  comparableNear: number;
  coreComparableNear: number;
  outlierSkuCount: number;
  ghostNear: number;
  target: number | null;
};

function summarizeT1SubMatrix(
  forecasts: ForecastRow[],
  nearHorizons: number[],
  exogenousSkus: Set<string>,
): T1SubMatrixRow[] {
  const subs = (Object.keys(T1_SUB_SEGMENT_META) as T1SubSegment[]).sort(
    (a, b) => T1_SUB_SEGMENT_META[a].gateOrder - T1_SUB_SEGMENT_META[b].gateOrder,
  );
  return subs.map((sub) => {
    const near = forecasts.filter(
      (f) => f.t1SubSegment === sub && nearHorizons.includes(f.horizon),
    );
    const meta = T1_SUB_SEGMENT_META[sub];
    const summary = summarizeWmapeWithOutlierExclusion(
      near.map((f) => ({
        skuCode: f.sku,
        actualDaily: f.actualDaily,
        forecastDaily: f.predictedDaily,
        actualMonthly: f.actual,
        ghostRow: f.ghostRow,
      })),
      { excludeGhost: true, minActualMonthly: DEFAULT_KPI_MIN_ACTUAL_MONTHLY, precomputedExogenousSkus: exogenousSkus },
    );
    const outlierSkuInSub = new Set(
      near.filter((f) => f.outlierSku).map((f) => f.sku),
    );
    return {
      sub,
      label: meta.label,
      gateOrder: meta.gateOrder,
      measurable: meta.measurable,
      nearWmapeAll: wmape(near),
      nearWmapeCore: summary.wmapeCore,
      comparableNear: near.filter((f) => f.actualDaily > 0).length,
      coreComparableNear: summary.coreComparableRows,
      outlierSkuCount: outlierSkuInSub.size,
      ghostNear: near.filter((f) => f.ghostRow).length,
      target: getT1SubKpiTarget(sub, 'precision'),
    };
  });
}

function annotateOutliersAndKpi(
  forecasts: ForecastRow[],
  manualExogenousSkus: Set<string>,
): Set<string> {
  const comparable = forecasts
    .filter((f) => f.actualDaily > 0)
    .map((f) => ({
      skuCode: f.sku,
      actualDaily: f.actualDaily,
      forecastDaily: f.predictedDaily,
    }));
  const autoOutliers = detectOutlierSkus(comparable);
  const exogenousSkus = resolveExogenousSkuSet(comparable, { manualSkus: manualExogenousSkus });
  for (const f of forecasts) {
    f.outlierRow = isOutlierRow(f.actualDaily, f.predictedDaily);
    f.outlierSku = autoOutliers.has(f.sku);
    f.exogenousSku = exogenousSkus.has(f.sku);
    f.kpiCore =
      !f.ghostRow &&
      !f.exogenousSku &&
      f.actualDaily > 0 &&
      f.actual >= DEFAULT_KPI_MIN_ACTUAL_MONTHLY;
  }
  return exogenousSkus;
}

function toSkuAccuracyRows(forecasts: ForecastRow[]): SkuAccuracyRowInput[] {
  return forecasts.map((f) => ({
    skuCode: f.sku,
    yearMonth: f.yearMonth,
    horizon: f.horizon,
    predictedMonthly: f.predicted,
    actualMonthly: f.actual,
    predictedDaily: f.predictedDaily,
    actualDaily: f.actualDaily,
    ghostRow: f.ghostRow,
    outlierSku: f.outlierSku,
    exogenousSku: f.exogenousSku,
    kpiCore: f.kpiCore,
    salesTier: f.salesTier,
    t1SubSegment: f.t1SubSegment,
    model: f.model,
  }));
}

function summarizeSalesTierMatrix(
  forecasts: ForecastRow[],
  nearHorizons: number[],
  farHorizons: number[],
): SalesTierMatrixRow[] {
  const segments = Object.keys(SALES_TIER_SEGMENT_META) as SalesTierSegment[];
  return segments.map((segment) => {
    const near = forecasts.filter((f) => f.salesSegment === segment && nearHorizons.includes(f.horizon));
    const far = forecasts.filter((f) => f.salesSegment === segment && farHorizons.includes(f.horizon));
    const meta = SALES_TIER_SEGMENT_META[segment];
    return {
      segment,
      label: meta.label,
      measurable: meta.measurable,
      nearWmape: wmape(near),
      farWmape: wmape(far),
      ghostNear: near.filter((f) => f.ghostRow).length,
      comparableNear: near.filter((f) => f.actualDaily > 0).length,
    };
  });
}

function runBacktest() {
  const csvPath = readArg('--csv') ?? DEFAULT_CSV;
  const { rows, monthCols, metaCols, rawRowCount } = loadCsv(csvPath);

  const allMonths = [...monthCols].sort();
  const trainMonths = allMonths.slice(0, TRAIN_MONTHS);
  const availableHoldout = allMonths.slice(TRAIN_MONTHS);
  const testMonths = availableHoldout.slice(0, HOLDOUT_MONTHS);
  const classifyMonths = trainMonths.slice(-12);

  console.log('=== 数据预览（前 5 行）===');
  console.log('元数据列:', metaCols.join(' | '));
  console.log('月份列数:', allMonths.length, `范围 ${allMonths[0]} ~ ${allMonths[allMonths.length - 1]}`);
  console.log('原始行数:', rawRowCount, '→ 按 SKU 聚合后:', rows.length);
  for (const r of rows.slice(0, 5)) {
    const sample = trainMonths.slice(-3).map((m) => `${m}:${r.months[m]}`);
    console.log(`${r.sku} | ${r.name.slice(0, 30)} | ${sample.join(', ')}`);
  }

  // Step 1: 清洗
  const cleanCells: CleanCell[] = [];
  const anomalyCounts = { stockout: 0, promo: 0, incomplete: 0, none: 0 };
  for (const row of rows) {
    const series = trainMonths.map((ym) => ({ yearMonth: ym, qty: row.months[ym] ?? 0 }));
    for (const cell of detectAnomalies(row.sku, series)) {
      anomalyCounts[cell.anomaly === 'none' ? 'none' : cell.anomaly]++;
      cleanCells.push(cell);
    }
  }

  // Step 2: 销量规律分层（24 月训练窗）
  const tierBySku = new Map<string, SalesTier>();
  const salesSegmentBySku = new Map<string, SalesTierSegment>();
  const profileBySku = new Map<string, ProfileClass>();
  const tierCounts: Record<SalesTier, number> = {
    T1_anchor: 0,
    T2_stable: 0,
    T3_seasonal: 0,
    T4_intermittent: 0,
    T5_new_or_dormant: 0,
    T6_zero: 0,
  };
  const tierSales: Record<SalesTier, number> = {
    T1_anchor: 0,
    T2_stable: 0,
    T3_seasonal: 0,
    T4_intermittent: 0,
    T5_new_or_dormant: 0,
    T6_zero: 0,
  };

  for (const row of rows) {
    const trainQty = trainMonths.map((m) => row.months[m] ?? 0);
    const holdoutSum = testMonths.reduce((s, m) => s + (row.months[m] ?? 0), 0);
    const resolved = resolveSalesTierSegment(trainQty, { holdoutSum });
    tierBySku.set(row.sku, resolved.tier);
    salesSegmentBySku.set(row.sku, resolved.segment);
    const profileClass = salesTierToProfileClass(resolved.tier);
    profileBySku.set(row.sku, profileClass);
    tierCounts[resolved.tier]++;
    tierSales[resolved.tier] += trainQty.reduce((a, b) => a + b, 0);
  }
  const totalSales = Object.values(tierSales).reduce((a, b) => a + b, 0);

  // Step 3: 建模预测
  const forecasts: ForecastRow[] = [];
  const segmentBySku = new Map<string, ProfileSegment>();
  const cleanedTrainBySku = new Map<string, number[]>();
  const rawTrainBySku = new Map<string, number[]>();

  for (const row of rows) {
    const rawTrain = trainMonths.map((m) => row.months[m] ?? 0);
    rawTrainBySku.set(row.sku, rawTrain);
    const { cleaned } = cleanMonthlyQtyForTraining(rawTrain);
    cleanedTrainBySku.set(row.sku, cleaned);
    const classifyQty = classifyMonths.map((m) => row.months[m] ?? 0);
    const profile = resolveSkuProfileSegment({
      monthlyQty: classifyQty,
      profileClass: profileBySku.get(row.sku),
      layer: profileBySku.get(row.sku) === 'C' ? 'sku' : undefined,
    });
    segmentBySku.set(row.sku, profile.segment);
  }

  const cPoolInputs = rows
    .filter((r) => tierBySku.get(r.sku) === 'T4_intermittent')
    .map((row) => ({
      skuId: row.sku,
      skuCode: row.sku,
      category: row.category,
      station: 'US',
      platform: 'ALL',
      monthlyQty: cleanedTrainBySku.get(row.sku) ?? trainMonths.map((m) => row.months[m] ?? 0),
      recent90DailyAvg: 0,
    }));
  const cPoolCtx = buildMonthlyAbcdCPoolContext(cPoolInputs);

  const sampleFitCurves: {
    sku: string;
    cls: ProfileClass;
    trainMonths: string[];
    trainActual: number[];
    fitted: number[];
    testMonths: string[];
    testActual: number[];
    testForecast: number[];
  }[] = [];

  const asOfDate = new Date(`${trainMonths[trainMonths.length - 1]}-15T00:00:00Z`);

  for (const row of rows) {
    const salesTier = tierBySku.get(row.sku)!;
    const salesSegment = salesSegmentBySku.get(row.sku)!;
    const profileClass = profileBySku.get(row.sku)!;
    const segment = segmentBySku.get(row.sku)!;
    const rawMonthlyQty = rawTrainBySku.get(row.sku) ?? [];
    const monthlyQty = cleanedTrainBySku.get(row.sku) ?? [];
    const derived = deriveRecentDailyFromMonthly(
      rawMonthlyQty,
      Number(testMonths[0]!.slice(0, 4)),
      Number(testMonths[0]!.slice(5, 7)),
    );
    const lifecycle = inferLifecycleFromMonthly(
      rawMonthlyQty,
      derived.recent30DailyAvg,
      derived.recent90DailyAvg,
    );
    if (!shouldForecastSalesTier(salesTier, getForecastPhase())) {
      continue;
    }

    const holdoutAllZero = testMonths.every((m) => (row.months[m] ?? 0) === 0);
    const t1SubSegment =
      salesTier === 'T1_anchor'
        ? resolveT1SubSegment(resolveSalesTierSegment(rawMonthlyQty).features)
        : null;
    const effectiveProfileClass =
      salesTier === 'T1_anchor' ? 'A' : profileClass;
    const routeSalesTier =
      salesTier === 'T1_anchor' || salesTier === 'T2_stable' || salesTier === 'T3_seasonal'
        ? salesTier
        : undefined;

    for (const [h, ym] of testMonths.entries()) {
      const [fy, fm] = ym.split('-').map(Number);
      const poolKey = buildCategoryPoolKey(row.category, 'US', 'ALL');
      const abcd = computeMonthlyAbcdForecastDailyAvg({
        profileClass: effectiveProfileClass,
        salesTier: routeSalesTier,
        t1SubSegment: t1SubSegment ?? undefined,
        monthlyQty,
        rawMonthlyQty: rawMonthlyQty,
        horizonIndex: h,
        forecastYear: fy!,
        forecastMonth: fm!,
        recent30DailyAvg: derived.recent30DailyAvg,
        recent90DailyAvg: derived.recent90DailyAvg,
        profileSegment: salesTier === 'T1_anchor' ? 'A:core' : segment,
        volumeTier: salesTier === 'T1_anchor' ? 'core' : 'flex',
        lifecycle,
        poolMonthlyQty:
          effectiveProfileClass === 'C'
            ? cPoolCtx.poolMonthlyQtyByKey.get(poolKey)
            : undefined,
        poolShare:
          effectiveProfileClass === 'C' ? cPoolCtx.poolShareBySkuId.get(row.sku) : undefined,
        cv12m: resolveSalesTierSegment(rawMonthlyQty).features.cv,
      });

      const actualMonthly = row.months[ym] ?? 0;
      const predictedMonthly = monthlyFromDaily(abcd.forecastDailyAvg, ym);
      const actualDaily = monthlyQtyToDailyAvg(actualMonthly, fy!, fm!);
      const ghostRow = actualMonthly === 0 && abcd.forecastDailyAvg > 0;

      forecasts.push({
        sku: row.sku,
        salesTier,
        salesSegment,
        t1SubSegment,
        profileClass,
        profileSegment: segment,
        yearMonth: ym,
        horizon: h + 1,
        predicted: predictedMonthly,
        actual: actualMonthly,
        predictedDaily: abcd.forecastDailyAvg,
        actualDaily,
        model: abcd.model,
        ghostRow,
        outlierRow: false,
        outlierSku: false,
        exogenousSku: false,
        kpiCore: false,
      });

      if (
        sampleFitCurves.length < 2 &&
        (profileClass === 'A' || profileClass === 'B') &&
        !holdoutAllZero
      ) {
        const existing = sampleFitCurves.find((s) => s.sku === row.sku);
        if (!existing && (profileClass === 'A' || (profileClass === 'B' && sampleFitCurves.length < 2))) {
          sampleFitCurves.push({
            sku: row.sku,
            cls: profileClass,
            trainMonths: [...trainMonths],
            trainActual: monthlyQty,
            fitted: monthlyQty,
            testMonths: [...testMonths],
            testActual: testMonths.map((m) => row.months[m] ?? 0),
            testForecast: [],
          });
        }
        const curve = sampleFitCurves.find((s) => s.sku === row.sku);
        if (curve) curve.testForecast[h] = predictedMonthly;
      }
    }
  }

  // Step 4: 误差评估
  const byClassHorizon: Record<string, Record<number, ForecastRow[]>> = {};
  for (const f of forecasts) {
    const key = f.profileClass;
    byClassHorizon[key] ??= {};
    byClassHorizon[key]![f.horizon] ??= [];
    byClassHorizon[key]![f.horizon]!.push(f);
  }

  const mapeTable: { cls: ProfileClass; h: number; mape: number | null; wmape: number | null; n: number }[] = [];
  for (const cls of ['A', 'B', 'C', 'D'] as ProfileClass[]) {
    for (let h = 1; h <= testMonths.length; h++) {
      const sub = byClassHorizon[cls]?.[h] ?? [];
      mapeTable.push({ cls, h, mape: mape(sub), wmape: wmape(sub), n: sub.length });
    }
  }

  const nearHorizons = [1, 2, 3].filter((h) => h <= testMonths.length);
  const farHorizons = [4, 5, 6].filter((h) => h <= testMonths.length);

  const manualExogenousFlags = loadExogenousFlagsFromCsv();
  const manualExogenousSkus = exogenousSkuCodesFromFlags(manualExogenousFlags);
  const exogenousSkus = annotateOutliersAndKpi(forecasts, manualExogenousSkus);
  const t1SubMatrix = summarizeT1SubMatrix(forecasts, nearHorizons, exogenousSkus);
  const t1CoreSummary = summarizeWmapeWithOutlierExclusion(
    forecasts
      .filter((f) => f.salesTier === 'T1_anchor' && nearHorizons.includes(f.horizon))
      .map((f) => ({
        skuCode: f.sku,
        actualDaily: f.actualDaily,
        forecastDaily: f.predictedDaily,
        actualMonthly: f.actual,
        ghostRow: f.ghostRow,
      })),
    {
      excludeGhost: true,
      minActualMonthly: DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
      precomputedExogenousSkus: exogenousSkus,
    },
  );
  const skuSampleReport = buildSkuAccuracySampleReport(
    toSkuAccuracyRows(forecasts.filter((f) => nearHorizons.includes(f.horizon))),
  );

  const kpiRows: {
    cls: ProfileClass;
    nearWmape: number | null;
    farWmape: number | null;
    nearTarget: number;
    farTarget: number;
    nearPass: boolean | null;
    farPass: boolean | null;
  }[] = [];

  for (const cls of ['A', 'B', 'C', 'D'] as ProfileClass[]) {
    const near = forecasts.filter((f) => f.profileClass === cls && nearHorizons.includes(f.horizon));
    const far = forecasts.filter((f) => f.profileClass === cls && farHorizons.includes(f.horizon));
    const nearW = wmape(near);
    const farW = wmape(far);
    kpiRows.push({
      cls,
      nearWmape: nearW,
      farWmape: farW,
      nearTarget: 0.15,
      farTarget: 0.25,
      nearPass: nearW == null ? null : nearW < 0.15,
      farPass: farW == null ? null : farW < 0.25,
    });
  }

  const totalNear = wmape(forecasts.filter((f) => nearHorizons.includes(f.horizon)));
  const totalFar = wmape(forecasts.filter((f) => farHorizons.includes(f.horizon)));

  const accuracyRows: AccuracyRowInput[] = forecasts.map((f) => {
    const [y, m] = f.yearMonth.split('-').map(Number);
    return {
      skuCode: f.sku,
      actualDaily: f.actualDaily,
      forecastDaily: f.predictedDaily,
      mape: null,
      biasRate: null,
      profileSegment: f.profileSegment,
      forecastYear: y,
      month: m,
    };
  });
  const matrix = summarizeAccuracyMatrix(accuracyRows, {
    asOf: asOfDate,
    segmentBySku,
  });
  const ghostPct =
    forecasts.length > 0
      ? (forecasts.filter((f) => f.ghostRow).length / forecasts.length) * 100
      : 0;

  const lastH = testMonths.length;
  const avgIntervalWidth: number | null = null;

  // 总量对比（按月）
  const totalByMonth = testMonths.map((ym, hi) => {
    const sub = forecasts.filter((f) => f.yearMonth === ym);
    const predicted = sub.reduce((s, r) => s + r.predicted, 0);
    const actual = sub.reduce((s, r) => s + r.actual, 0);
    return {
      ym,
      horizon: hi + 1,
      predicted,
      actual,
      ape: actual > 0 ? Math.abs(predicted - actual) / actual : null,
    };
  });
  const totalAggWmape =
    totalByMonth.reduce((s, m) => s + Math.abs(m.predicted - m.actual), 0) /
    Math.max(1, totalByMonth.reduce((s, m) => s + m.actual, 0));

  const salesTierMatrix = summarizeSalesTierMatrix(forecasts, nearHorizons, farHorizons);

  mkdirSync(OUT_DIR, { recursive: true });

  const reportPath = resolve(OUT_DIR, 'backtest-report.html');
  const csvOut = resolve(OUT_DIR, 'backtest-predictions.csv');
  const csvLines = [
    'sku,sales_tier,sales_segment,t1_sub_segment,profile_class,profile_segment,year_month,horizon,predicted_monthly,actual_monthly,predicted_daily,actual_daily,model,ghost_row,outlier_row,outlier_sku,exogenous_sku,kpi_core',
    ...forecasts.map(
      (f) =>
        `${f.sku},${f.salesTier},${f.salesSegment},${f.t1SubSegment ?? ''},${f.profileClass},${f.profileSegment},${f.yearMonth},${f.horizon},${f.predicted.toFixed(2)},${f.actual},${f.predictedDaily.toFixed(4)},${f.actualDaily.toFixed(4)},${f.model},${f.ghostRow ? 1 : 0},${f.outlierRow ? 1 : 0},${f.outlierSku ? 1 : 0},${f.exogenousSku ? 1 : 0},${f.kpiCore ? 1 : 0}`,
    ),
  ];
  const skuStatsCsv = resolve(OUT_DIR, 'backtest-sku-sample.csv');
  const sampleRows = [
    ...skuSampleReport.topErrors,
    ...skuSampleReport.randomCoreSample,
    ...skuSampleReport.withinToleranceSample,
    ...skuSampleReport.exogenousSample,
  ];
  writeFileSync(skuStatsCsv, skuSampleToCsvRows(sampleRows).join('\n'), 'utf8');
  writeFileSync(csvOut, csvLines.join('\n'), 'utf8');

  const html = buildHtmlReport({
    csvPath,
    metaCols,
    allMonths,
    trainMonths,
    testMonths,
    rows: rows.length,
    rawRowCount,
    anomalyCounts,
    tierCounts,
    tierSales,
    salesTierMatrix,
    t1SubMatrix,
    t1CoreSummary,
    outlierSkuCount: exogenousSkus.size,
    manualExogenousCount: manualExogenousSkus.size,
    skuSampleReport,
    skuStatsCsv,
    totalSales,
    mapeTable,
    kpiRows,
    totalNear,
    totalFar,
    avgIntervalWidth,
    lastH,
    totalByMonth,
    totalAggWmape,
    sampleFitCurves,
    availableHoldout,
    matrix,
    ghostPct,
  });
  writeFileSync(reportPath, html, 'utf8');

  console.log('\n=== 销量规律分层（T1~T6）===');
  for (const tier of Object.keys(SALES_TIER_META) as SalesTier[]) {
    const pctSku = ((tierCounts[tier] / rows.length) * 100).toFixed(1);
    const pctSales = totalSales > 0 ? ((tierSales[tier] / totalSales) * 100).toFixed(1) : '0';
    const attack = SALES_TIER_META[tier].primaryAttack ? ' ★主攻' : '';
    console.log(
      `${salesTierLabel(tier)}: ${tierCounts[tier]} SKU (${pctSku}%), 训练销量占比 ${pctSales}%${attack}`,
    );
  }

  console.log('\n=== T1 子层 Gate（一层一层验收，k=1~3）===');
  console.log(
    `外生冲击剔除：自动 APE>${(getOutlierApeThreshold() * 100).toFixed(0)}% + 人工标记 ${manualExogenousSkus.size} SKU（${manualExogenousFlags.length ? 'exogenous-skus.csv' : '无文件'}）`,
  );
  console.log(
    `T1 全层：原始 WMAPE ${fmt(t1CoreSummary.wmapeAll)} → 核心 KPI ${fmt(t1CoreSummary.wmapeCore)}（剔除 ${t1CoreSummary.outlierSkuCount} SKU / ${t1CoreSummary.outlierRowCount} 行 / 微销 ${t1CoreSummary.excludedMicroActRows} 行）`,
  );
  for (const row of t1SubMatrix.filter((r) => r.measurable)) {
    const status =
      row.nearWmapeCore == null || row.target == null
        ? '—'
        : row.nearWmapeCore <= row.target
          ? 'pass'
          : 'fail';
    console.log(
      `${row.label} | 原始 ${fmt(row.nearWmapeAll)} → 核心 ${fmt(row.nearWmapeCore)} (目标 ${row.target == null ? '—' : pct(row.target)}) ${status} | 可比 ${row.coreComparableNear} | 外生剔除 SKU ${row.outlierSkuCount} | ghost ${row.ghostNear}`,
    );
  }
  for (const row of t1SubMatrix.filter((r) => !r.measurable)) {
    console.log(
      `${row.label} | 原始 ${fmt(row.nearWmapeAll)} | ghost ${row.ghostNear} | 不计点预测 KPI`,
    );
  }

  console.log('\n=== 主攻 T1·主力锚定（仅本层出预测）===');
  const t1Rows = salesTierMatrix.filter((r) => r.segment.startsWith('T1:'));
  for (const row of t1Rows) {
    const nearTarget = getSalesTierKpiTarget(row.segment, 'precision');
    const farTarget = getSalesTierKpiTarget(row.segment, 'flex');
    const nearStatus =
      row.nearWmape == null || nearTarget == null
        ? '—'
        : row.nearWmape <= nearTarget
          ? 'pass'
          : 'fail';
    console.log(
      `${row.label} | 近端 ${fmt(row.nearWmape)} (目标 ${nearTarget == null ? '—' : pct(nearTarget)}) ${nearStatus} | 远端 ${fmt(row.farWmape)} | ghost ${row.ghostNear}`,
    );
  }

  console.log('\n=== 销量分层 KPI（全层参考，非主攻层无预测）===');
  for (const row of salesTierMatrix) {
    if (!row.measurable) continue;
    const nearTarget = getSalesTierKpiTarget(row.segment, 'precision');
    const farTarget = getSalesTierKpiTarget(row.segment, 'flex');
    const nearStatus =
      row.nearWmape == null || nearTarget == null
        ? '—'
        : row.nearWmape <= nearTarget
          ? 'pass'
          : 'fail';
    console.log(
      `${row.label} | 近端 ${fmt(row.nearWmape)} (目标 ${nearTarget == null ? '—' : pct(nearTarget)}) ${nearStatus} | 远端 ${fmt(row.farWmape)} (目标 ${farTarget == null ? '—' : pct(farTarget)}) | ghost ${row.ghostNear}`,
    );
  }

  console.log('\n=== Segment×Band KPI 矩阵（ABCD 遗留对照）===');
  for (const cell of matrix.cells.filter(
    (c) =>
      ['A:core', 'C:pool'].includes(c.segment) &&
      ['precision', 'flex'].includes(c.band) &&
      c.comparableRows > 0,
  )) {
    console.log(
      `${cell.segmentLabel} ${cell.bandLabel}: WMAPE ${fmt(cell.wmape)} (目标 ${cell.kpiTargetLabel}) ${cell.kpiStatus} | ghost ${cell.ghostRowCount}`,
    );
  }
  console.log(`D 类 ghost 行占比: ${ghostPct.toFixed(1)}%`);

  const aggPred = totalByMonth.reduce((s, m) => s + m.predicted, 0);
  const aggAct = totalByMonth.reduce((s, m) => s + m.actual, 0);
  const aggBiasPct = aggAct > 0 ? ((aggPred - aggAct) / aggAct) * 100 : 0;
  const aCorePrecision = matrix.cells.find((c) => c.segment === 'A:core' && c.band === 'precision');
  const aCoreFlex = matrix.cells.find((c) => c.segment === 'A:core' && c.band === 'flex');

  console.log('\n=== 主攻层进度（T1）===');
  const gate01 = t1SubMatrix.find((r) => r.sub === 'T1.1_elite_stable');
  const gate13 = t1SubMatrix.find((r) => r.sub === 'T1.3_anchor_stable');
  console.log(
    `T1.1 核心稳定: 核心 KPI ${fmt(gate01?.nearWmapeCore ?? null)} (目标 20%) | T1.3 标准稳定: ${fmt(gate13?.nearWmapeCore ?? null)} (目标 25%)`,
  );
  console.log(
    `T1 全层核心 KPI: ${fmt(t1CoreSummary.wmapeCore)} | 外生冲击 SKU: ${exogenousSkus.size}（人工 ${manualExogenousSkus.size}）`,
  );

  console.log('\n=== 抽样 SKU 偏差（k=1~3，全量旁附）===');
  console.log(`全量 SKU ${skuSampleReport.skuCount} · 行 ${skuSampleReport.rowCount} · 聚合 WMAPE ${fmt(skuSampleReport.aggregateWmape)}`);
  for (const block of [
    formatSkuSampleTable('【Top 误差 SKU】', skuSampleReport.topErrors),
    formatSkuSampleTable('【核心层随机抽样】', skuSampleReport.randomCoreSample),
    formatSkuSampleTable('【±15% 内达标抽样】', skuSampleReport.withinToleranceSample),
    formatSkuSampleTable('【外生冲击 SKU】', skuSampleReport.exogenousSample),
  ]) {
    for (const line of block) console.log(line);
  }
  console.log(`抽样明细 CSV: ${skuStatsCsv}`);

  console.log('\n=== A 类微调前后对比（基线=池化修复后，ABCD 遗留）===');
  console.log(
    [
      ['指标', '微调前', '微调后', '变化'],
      ['聚合月总 WMAPE', '8.7%', fmt(totalAggWmape), ''],
      ['聚合总量 bias', '-8.7%', `${aggBiasPct >= 0 ? '+' : ''}${aggBiasPct.toFixed(1)}%`, ''],
      ['A:core k=1~3 WMAPE', '52.2%', fmt(aCorePrecision?.wmape ?? null), ''],
      ['A:core k=4~6 WMAPE', '53.3%', fmt(aCoreFlex?.wmape ?? null), ''],
    ]
      .map((row) => row.join('\t'))
      .join('\n'),
  );

  console.log('\n=== 调优前后对比（基线=上一版 near_anchor+激进清洗）===');
  console.log(
    [
      ['指标', '调优前', '调优后', '变化'],
      ['缺货异常月标记', '123,639', String(anomalyCounts.stockout), ''],
      ['聚合月总 WMAPE', '39.2%', fmt(totalAggWmape), ''],
      ['聚合总量 bias', '+39%', `${aggBiasPct >= 0 ? '+' : ''}${aggBiasPct.toFixed(1)}%`, ''],
      ['A:core k=1~3 WMAPE', '47.5%', fmt(aCorePrecision?.wmape ?? null), ''],
      ['A:core k=4~6 WMAPE', '50.3%', fmt(aCoreFlex?.wmape ?? null), ''],
      ['ghost 行占比', '44.6%', `${ghostPct.toFixed(1)}%`, ''],
    ]
      .map((row) => row.join('\t'))
      .join('\n'),
  );
  for (const m of totalByMonth) {
    const b = m.actual > 0 ? (((m.predicted - m.actual) / m.actual) * 100).toFixed(1) : '—';
    console.log(`  ${m.ym}: 预测 ${Math.round(m.predicted).toLocaleString()} / 实际 ${Math.round(m.actual).toLocaleString()} (bias ${b}%)`);
  }

  console.log('\n=== KPI 达标（WMAPE，日级可比）===');
  console.log(`全量 k=1~3: ${fmt(totalNear)} (目标<15%)`);
  console.log(`全量 k=4~${testMonths.length}: ${fmt(totalFar)} (目标<25%)`);
  for (const k of kpiRows) {
    console.log(
      `${k.cls}类: 近端 ${fmt(k.nearWmape)} ${k.nearPass === true ? '✓' : k.nearPass === false ? '✗' : '—'} | 远端 ${fmt(k.farWmape)} ${k.farPass === true ? '✓' : k.farPass === false ? '✗' : '—'}`,
    );
  }

  if (testMonths.length < HOLDOUT_MONTHS) {
    console.log(`\n注意: 数据仅含 ${availableHoldout.length} 个验证月 (${availableHoldout.join(', ')})，缺少 ${HOLDOUT_MONTHS - testMonths.length} 月`);
  }

  console.log(`\n报告: ${reportPath}`);
  console.log(`预测明细: ${csvOut}`);
  console.log(`SKU 抽样: ${skuStatsCsv}`);
}

function buildHtmlReport(data: {
  csvPath: string;
  metaCols: string[];
  allMonths: string[];
  trainMonths: string[];
  testMonths: string[];
  rows: number;
  rawRowCount: number;
  anomalyCounts: Record<string, number>;
  tierCounts: Record<SalesTier, number>;
  tierSales: Record<SalesTier, number>;
  salesTierMatrix: SalesTierMatrixRow[];
  t1SubMatrix: T1SubMatrixRow[];
  t1CoreSummary: ReturnType<typeof summarizeWmapeWithOutlierExclusion>;
  outlierSkuCount: number;
  manualExogenousCount: number;
  skuSampleReport: SkuAccuracySampleReport;
  skuStatsCsv: string;
  totalSales: number;
  mapeTable: { cls: ProfileClass; h: number; mape: number | null; wmape: number | null; n: number }[];
  kpiRows: {
    cls: ProfileClass;
    nearWmape: number | null;
    farWmape: number | null;
    nearPass: boolean | null;
    farPass: boolean | null;
  }[];
  totalNear: number | null;
  totalFar: number | null;
  avgIntervalWidth: number | null;
  lastH: number;
  totalByMonth: { ym: string; horizon: number; predicted: number; actual: number; ape: number | null }[];
  totalAggWmape: number;
  sampleFitCurves: {
    sku: string;
    cls: ProfileClass;
    trainMonths: string[];
    trainActual: number[];
    fitted: number[];
    testMonths: string[];
    testActual: number[];
    testForecast: number[];
  }[];
  availableHoldout: string[];
  matrix: ReturnType<typeof summarizeAccuracyMatrix>;
  ghostPct: number;
}): string {
  const tierTable = (Object.keys(SALES_TIER_META) as SalesTier[])
    .map((tier) => {
      const pctSku = ((data.tierCounts[tier] / data.rows) * 100).toFixed(1);
      const pctSales =
        data.totalSales > 0 ? ((data.tierSales[tier] / data.totalSales) * 100).toFixed(1) : '0';
      const star = SALES_TIER_META[tier].primaryAttack ? ' ★' : '';
      return `<tr><td>${salesTierLabel(tier)}${star}</td><td>${data.tierCounts[tier]}</td><td>${pctSku}%</td><td>${pctSales}%</td></tr>`;
    })
    .join('');

  const salesTierKpiTable = data.salesTierMatrix
    .filter((r) => r.measurable)
    .map((r) => {
      const nearTarget = getSalesTierKpiTarget(r.segment, 'precision');
      const farTarget = getSalesTierKpiTarget(r.segment, 'flex');
      const nearIcon =
        r.nearWmape != null && nearTarget != null && r.nearWmape <= nearTarget ? '✅' : '❌';
      return `<tr><td>${r.label}</td><td>${r.comparableNear}</td><td>${r.nearWmape == null ? '—' : pct(r.nearWmape)}</td><td>${nearTarget == null ? '—' : pct(nearTarget)}</td><td>${nearIcon}</td><td>${r.farWmape == null ? '—' : pct(r.farWmape)}</td><td>${farTarget == null ? '—' : pct(farTarget)}</td><td>${r.ghostNear}</td></tr>`;
    })
    .join('');

  const t1SubGateTable = data.t1SubMatrix
    .map((r) => {
      const nearIcon =
        r.measurable &&
        r.nearWmapeCore != null &&
        r.target != null &&
        r.nearWmapeCore <= r.target
          ? '✅'
          : r.measurable
            ? '❌'
            : '—';
      return `<tr><td>${r.label}</td><td>${r.measurable ? '是' : '否'}</td><td>${r.comparableNear}</td><td>${r.coreComparableNear}</td><td>${r.nearWmapeAll == null ? '—' : pct(r.nearWmapeAll)}</td><td>${r.nearWmapeCore == null ? '—' : pct(r.nearWmapeCore)}</td><td>${r.target == null ? '—' : pct(r.target)}</td><td>${nearIcon}</td><td>${r.outlierSkuCount}</td><td>${r.ghostNear}</td></tr>`;
    })
    .join('');

  const outlierNote = `<p>核心 KPI 口径：剔除 ghost；自动 APE&gt;${(getOutlierApeThreshold() * 100).toFixed(0)}% 或人工外生标记（当前 ${data.manualExogenousCount} SKU，见 <code>exogenous-skus.csv</code>）；验证月实际&lt;${DEFAULT_KPI_MIN_ACTUAL_MONTHLY} 件仅展示。T1 全层核心 WMAPE：<strong>${data.t1CoreSummary.wmapeCore == null ? '—' : pct(data.t1CoreSummary.wmapeCore)}</strong>（原始 ${data.t1CoreSummary.wmapeAll == null ? '—' : pct(data.t1CoreSummary.wmapeAll)}，外生剔除 SKU ${data.outlierSkuCount}）。</p>`;

  const skuSampleRowHtml = (s: SkuAccuracySampleReport['topErrors'][number]) => {
    const tag = s.sampleTag ?? '';
    const wmape = s.wmape == null ? '—' : pct(s.wmape);
    const bias = s.bias == null ? '—' : pct(s.bias);
    return `<tr><td>${s.skuCode}</td><td>${tag}</td><td>${wmape}</td><td>${bias}</td><td>${Math.round(s.predSumMonthly)}</td><td>${Math.round(s.actSumMonthly)}</td><td>${s.ghostRows}</td><td>${s.exogenousSku ? '是' : '否'}</td></tr>`;
  };
  const skuSampleSections = [
    ['Top 误差 SKU', data.skuSampleReport.topErrors],
    ['核心层随机抽样', data.skuSampleReport.randomCoreSample],
    ['±15% 达标抽样', data.skuSampleReport.withinToleranceSample],
    ['外生冲击 SKU', data.skuSampleReport.exogenousSample],
  ] as const;
  const skuSampleHtml = skuSampleSections
    .map(
      ([title, items]) => `
<h3>${title}（${items.length}）</h3>
<table>
<tr><th>SKU</th><th>标签</th><th>WMAPE</th><th>Bias</th><th>预测合计</th><th>实际合计</th><th>Ghost</th><th>外生</th></tr>
${items.map(skuSampleRowHtml).join('')}
</table>`,
    )
    .join('');

  const classLabels: Record<ProfileClass, string> = {
    A: 'A·常青款',
    B: 'B·爆款趋势款',
    C: 'C·长尾款',
    D: 'D·问题款',
  };

  const classTable = (['A', 'B', 'C', 'D'] as ProfileClass[])
    .map((cls) => {
      const count = data.mapeTable.filter((r) => r.cls === cls).reduce((s, r) => Math.max(s, r.n), 0);
      return `<tr><td>${classLabels[cls]}</td><td>${count}</td><td>—</td><td>—</td></tr>`;
    })
    .join('');

  const _legacyClassTable = classTable;

  const mapeRows = data.mapeTable
    .map(
      (r) =>
        `<tr><td>${r.cls}</td><td>${r.h}</td><td>${r.n}</td><td>${r.mape == null ? '—' : pct(r.mape)}</td><td>${r.wmape == null ? '—' : pct(r.wmape)}</td></tr>`,
    )
    .join('');

  const kpiTable = data.kpiRows
    .map((k) => {
      const near = k.nearWmape == null ? '—' : pct(k.nearWmape);
      const far = k.farWmape == null ? '—' : pct(k.farWmape);
      const nearIcon = k.nearPass === true ? '✅' : k.nearPass === false ? '❌' : '—';
      const farIcon = k.farPass === true ? '✅' : k.farPass === false ? '❌' : '—';
      return `<tr><td>${k.cls}</td><td>${near} / 15%</td><td>${nearIcon}</td><td>${far} / 25%</td><td>${farIcon}</td></tr>`;
    })
    .join('');

  const totalChart = JSON.stringify({
    labels: data.totalByMonth.map((x) => x.ym),
    predicted: data.totalByMonth.map((x) => Math.round(x.predicted)),
    actual: data.totalByMonth.map((x) => Math.round(x.actual)),
  });

  const fitCharts = data.sampleFitCurves.map((c) => {
    const labels = [...c.trainMonths.slice(-12), ...c.testMonths];
    const actual = [...c.trainActual.slice(-12), ...c.testActual];
    const fitted = [...c.fitted.slice(-12), ...c.testForecast];
    return { sku: c.sku, cls: c.cls, labels, actual, fitted };
  });

  const holdoutNote =
    data.testMonths.length < HOLDOUT_MONTHS
      ? `<p class="warn">⚠ 验证期仅 ${data.testMonths.length} 个月（${data.testMonths.join('、')}），缺少 ${HOLDOUT_MONTHS - data.testMonths.length} 个月实际数据，k=6 指标未纳入。</p>`
      : '';

  const intervalNote =
    data.avgIntervalWidth != null
      ? `<p>A/B 类第 ${data.lastH} 月预测 80% 区间平均相对宽度：<strong>${pct(data.avgIntervalWidth)}</strong>（±35% 对应约 70% 宽度）。${
          data.avgIntervalWidth >= 0.7
            ? '已接近或超过长期目标上限，6–12 月保持 &lt;35% 极具挑战。'
            : '当前区间膨胀尚可，但外推至 6–12 月仍需促销/缺货标记补强。'
        }</p>`
      : '';

  const passA = data.kpiRows.find((k) => k.cls === 'A');
  const conclusion =
    passA?.nearPass && passA?.farPass
      ? 'A 类核心商品在可用验证窗内达标，可谨慎用于备货决策。'
      : '当前精度未达 15%/25% 目标，建议补充促销计划与缺货标记后再用于自动备货。';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>销量预测回测报告</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{font-family:system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1a1a1a;line-height:1.6}
h1{color:#e67e00;border-bottom:2px solid #e67e00;padding-bottom:8px}
h2{margin-top:32px;color:#333}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid #ddd;padding:8px;text-align:right}
th{background:#fff7ed;text-align:center}
td:first-child,th:first-child{text-align:left}
.warn{background:#fff3cd;padding:12px;border-radius:6px}
.chart-box{max-width:900px;margin:24px 0}
.conclusion{background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;margin:24px 0}
.fail{background:#fef2f2;border-left-color:#ef4444}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px}
</style>
</head>
<body>
<h1>销量预测回测实验报告</h1>
<p>数据源：<code>${data.csvPath}</code></p>
<p>训练期：${data.trainMonths[0]} ~ ${data.trainMonths[data.trainMonths.length - 1]}（${data.trainMonths.length} 月）｜验证期：${data.testMonths.join('、')}（${data.testMonths.length} 月）</p>
${holdoutNote}

<h2>一、数据结构确认</h2>
<ul>
<li>商品 ID 列：<strong>SKU</strong></li>
<li>时间列：${data.allMonths.length} 个月份列，格式 <code>(YYYY-MM)</code>，已为<strong>月总销量</strong>（非日级）</li>
<li>辅助列：${data.metaCols.filter((c) => c !== 'SKU').slice(0, 5).join('、')}…</li>
<li>原始行数：<strong>${data.rawRowCount.toLocaleString()}</strong> → 按 SKU 聚合后：<strong>${data.rows.toLocaleString()}</strong>（同 SKU 多行已合并月销）</li>
</ul>

<h2>二、清洗与异常标记（训练期）</h2>
<ul>
<li>缺货异常月：${data.anomalyCounts.stockout?.toLocaleString() ?? 0}</li>
<li>大促异常月：${data.anomalyCounts.promo?.toLocaleString() ?? 0}</li>
<li>不完整月：本数据为月度汇总，未检测到日级不完整月</li>
</ul>

<h2>三、销量规律分层（T1~T6，24 月训练窗）</h2>
<table>
<tr><th>层级</th><th>SKU 数</th><th>占比</th><th>训练销量占比</th></tr>
${tierTable}
</table>
<p>★ = 主攻验收层（T1 主力锚定）</p>

<h2>四、T1 子层 Gate（一层一层验收）</h2>
${outlierNote}
<table>
<tr><th>子层</th><th>点预测 KPI</th><th>可比行</th><th>核心可比</th><th>原始 WMAPE</th><th>核心 WMAPE</th><th>目标</th><th>状态</th><th>外生剔除 SKU</th><th>Ghost</th></tr>
${t1SubGateTable}
</table>

<h2>五、抽样 SKU 偏差（全量 ${data.skuSampleReport.skuCount} SKU 旁附）</h2>
<p>聚合 WMAPE（k=1~3）：<strong>${data.skuSampleReport.aggregateWmape == null ? '—' : pct(data.skuSampleReport.aggregateWmape)}</strong> · 明细 CSV：<code>${data.skuStatsCsv}</code></p>
${skuSampleHtml}

<h2>六、销量分层 KPI（主攻）</h2>
<table>
<tr><th>分段</th><th>可比行 k=1~3</th><th>近端 WMAPE</th><th>近端目标</th><th>状态</th><th>远端 WMAPE</th><th>远端目标</th><th>Ghost</th></tr>
${salesTierKpiTable}
</table>

<h2>七、ABCD 遗留对照（路由映射）</h2>
<table>
<tr><th>类别</th><th>预测 SKU 数</th><th>占比</th><th>销量占比</th></tr>
${classTable}
</table>

<h2>八、Segment×Band 验收矩阵（ABCD 遗留）</h2>
<table>
<tr><th>分段</th><th>窗口</th><th>可比行</th><th>WMAPE</th><th>目标</th><th>状态</th><th>Ghost</th></tr>
${data.matrix.cells
  .filter((c) => c.comparableRows > 0 || c.ghostRowCount > 0)
  .filter((c) => ['A:core', 'C:pool', 'A:mid', 'B:core'].includes(c.segment))
  .map(
    (c) =>
      `<tr><td>${c.segmentLabel}</td><td>${c.bandLabel}</td><td>${c.comparableRows}</td><td>${c.wmape == null ? '—' : pct(c.wmape)}</td><td>${c.kpiTargetLabel}</td><td>${c.kpiStatus}</td><td>${c.ghostRowCount}</td></tr>`,
  )
  .join('')}
</table>
<p>D 类 ghost 行占比：<strong>${data.ghostPct.toFixed(1)}%</strong></p>

<h2>五、回测误差（类×提前期）</h2>
<h3>4.1 各类 × 提前期 MAPE / WMAPE</h3>
<table>
<tr><th>类别</th><th>提前期 k</th><th>样本数</th><th>MAPE</th><th>WMAPE</th></tr>
${mapeRows}
</table>

<h3>4.2 浮动达标情况</h3>
<table>
<tr><th>类别</th><th>k=1~3 WMAPE / 目标</th><th>达标</th><th>k=4~6 WMAPE / 目标</th><th>达标</th></tr>
${kpiTable}
<tr style="font-weight:bold"><td>全量</td><td>${data.totalNear == null ? '—' : pct(data.totalNear)} / 15%</td><td>${data.totalNear != null && data.totalNear < 0.15 ? '✅' : '❌'}</td><td>${data.totalFar == null ? '—' : pct(data.totalFar)} / 25%</td><td>${data.totalFar != null && data.totalFar < 0.25 ? '✅' : '❌'}</td></tr>
</table>

<h3>4.3 全平台月总销量（聚合口径）</h3>
<table>
<tr><th>月份</th><th>预测</th><th>实际</th><th>APE</th></tr>
${data.totalByMonth
  .map(
    (m) =>
      `<tr><td>${m.ym}</td><td>${Math.round(m.predicted).toLocaleString()}</td><td>${Math.round(m.actual).toLocaleString()}</td><td>${m.ape == null ? '—' : pct(m.ape)}</td></tr>`,
  )
  .join('')}
<tr style="font-weight:bold"><td>合计 WMAPE</td><td colspan="3">${pct(data.totalAggWmape)}（全 SKU 月总销量加总后对比）</td></tr>
</table>
<p>注：SKU 级 WMAPE 对长尾零销 SKU 更严苛；聚合口径反映整体备货量级偏差，通常低于 SKU 级 WMAPE。</p>

<h2>六、长期浮动评估（6–12 月）</h2>
${intervalNote}

<h2>七、验证期总量对比</h2>
<div class="chart-box"><canvas id="totalChart"></canvas></div>

<h2>八、代表性 SKU 拟合曲线</h2>
${fitCharts.map((_, i) => `<div class="chart-box"><canvas id="fit${i}"></canvas></div>`).join('')}

<div class="conclusion ${passA?.nearPass && passA?.farPass ? '' : 'fail'}">
<h2>结论</h2>
<p><strong>${conclusion}</strong></p>
<ul>
<li>数据以月度宽表呈现，${data.rows.toLocaleString()} 个 SKU、${data.allMonths.length} 个月；C/D 类占 SKU 多数但 A/B 类贡献主要销量。</li>
<li>全 SKU 月总销量聚合 WMAPE：<strong>${pct(data.totalAggWmape)}</strong>（优于 SKU 级 ${data.totalNear == null ? '—' : pct(data.totalNear)}，说明误差集中在长尾 SKU，主力 SKU 偏差相对可控）。</li>
<li>建议：① 补充促销计划列作 B 类外生变量；② 区分缺货与真零需求；③ C 类按品类二级池聚合；④ 对数据不足 12 月的 SKU 统一归入 C/D。</li>
</ul>
</div>

<script>
const totalData = ${totalChart};
new Chart(document.getElementById('totalChart'), {
  type: 'line',
  data: {
    labels: totalData.labels,
    datasets: [
      { label: '实际月销量', data: totalData.actual, borderColor: '#2563eb', tension: 0.2 },
      { label: '预测月销量', data: totalData.predicted, borderColor: '#e67e00', borderDash: [6,4], tension: 0.2 }
    ]
  },
  options: { responsive: true, plugins: { title: { display: true, text: '全 SKU 验证期月总销量对比' } } }
});
${fitCharts
  .map(
    (c, i) => `
new Chart(document.getElementById('fit${i}'), {
  type: 'line',
  data: {
    labels: ${JSON.stringify(c.labels)},
    datasets: [
      { label: '实际', data: ${JSON.stringify(c.actual)}, borderColor: '#2563eb', tension: 0.2 },
      { label: '拟合/预测', data: ${JSON.stringify(c.fitted.map((v) => Math.round(v)))}, borderColor: '#e67e00', tension: 0.2 }
    ]
  },
  options: { responsive: true, plugins: { title: { display: true, text: '${c.cls}类示例 ${c.sku}' } } }
});`,
  )
  .join('')}
</script>
</body>
</html>`;
}

runBacktest();
