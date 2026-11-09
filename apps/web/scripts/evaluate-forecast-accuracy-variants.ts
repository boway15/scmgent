/**
 * 走步版本精度对比：基线 vs 高优先衰减优化。
 *
 * 基线：原 V4.1 / 满幅影子 / 满幅重塑(影子)
 * 优化：衰减影子 / 近端衰减重塑(衰减影子)
 *
 * pnpm --filter @scm/web exec tsx scripts/evaluate-forecast-accuracy-variants.ts
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, forecastAccuracyMonthly, salesForecastMonthly, skus } from '@scm/db';
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

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const VERSIONS: Array<{ id: string; label: string; asOfSi: string }> = [
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
];

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

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

type Metrics = {
  rows: number;
  actualQty: number;
  predQty: number;
  absErr: number;
};

function emptyMetrics(): Metrics {
  return { rows: 0, actualQty: 0, predQty: 0, absErr: 0 };
}

function addMetrics(m: Metrics, predDaily: number, actualDaily: number, days: number) {
  const pred = predDaily * days;
  const actual = actualDaily * days;
  m.rows += 1;
  m.actualQty += actual;
  m.predQty += pred;
  m.absErr += Math.abs(pred - actual);
}

function fmtBias(m: Metrics): string {
  if (!(m.actualQty > 0)) return '—';
  return `${(((m.predQty - m.actualQty) / m.actualQty) * 100).toFixed(1)}%`;
}

function fmtWmape(m: Metrics): string {
  if (!(m.actualQty > 0)) return '—';
  return `${((m.absErr / m.actualQty) * 100).toFixed(1)}%`;
}

type VariantKey = 'v41' | 'shadow' | 'reshapeShadow' | 'shadowOpt' | 'reshapeShadowOpt';

function emptyVariantBag(): Record<VariantKey, Metrics> {
  return {
    v41: emptyMetrics(),
    shadow: emptyMetrics(),
    reshapeShadow: emptyMetrics(),
    shadowOpt: emptyMetrics(),
    reshapeShadowOpt: emptyMetrics(),
  };
}

async function evaluateVersion(version: (typeof VERSIONS)[number]) {
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

  type RowWork = {
    groupKey: string;
    station: string;
    year: number;
    month: number;
    days: number;
    actual: number;
    v41: number;
    shadow: number | null;
    horizonIndex: number;
  };

  const workDraft: Array<Omit<RowWork, 'horizonIndex'>> = [];
  for (const row of forecastRows) {
    if (row.platform === 'ALL') continue;
    const actual = actualByKey.get(`${row.skuId}|${row.platform}|${row.year}|${row.month}`);
    if (actual == null || actual < 0) continue;
    const v41 = Number(row.forecastDailyAvg);
    if (!(v41 > 0)) continue;
    const shadow = shadowDaily(unwrapFactors(row.horizonFactors));
    const station = resolveSkuSeasonStation({
      salesCountry: row.salesCountry,
      projectGroup: row.projectGroup,
    });
    const groupKey = `${row.projectGroup?.trim() || `站点-${station}`}@@${station}`;
    workDraft.push({
      groupKey,
      station,
      year: row.year,
      month: row.month,
      days: daysInMonth(row.year, row.month),
      actual,
      v41,
      shadow,
    });
  }

  const horizonByMonth = buildHorizonIndexByMonthKey(
    workDraft.map((row) => ({ year: row.year, month: row.month })),
  );
  const work: RowWork[] = workDraft.map((row) => ({
    ...row,
    horizonIndex: horizonByMonth.get(monthKey(row.year, row.month)) ?? 0,
  }));

  function buildScales(
    getter: (row: RowWork) => number,
    applyHorizonDamp: boolean,
  ): Map<string, number> {
    const byGroupMonth = new Map<string, number>();
    for (const row of work) {
      const daily = getter(row);
      if (!(daily > 0)) continue;
      const key = `${row.groupKey}||${monthKey(row.year, row.month)}`;
      byGroupMonth.set(key, (byGroupMonth.get(key) ?? 0) + daily);
    }
    const scales = new Map<string, number>();
    const groups = [...new Set([...byGroupMonth.keys()].map((key) => key.split('||')[0]!))];
    for (const group of groups) {
      const station = group.split('@@')[1] ?? 'ALL';
      const monthEntries = [...byGroupMonth.entries()].filter(([key]) => key.startsWith(`${group}||`));
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
        applyHorizonDamp,
      });
      for (const plan of plans) scales.set(plan.key, plan.scale);
    }
    return scales;
  }

  // 优化顺序与线上一致：满幅影子 → 近端衰减重塑 → 地平线衰减（旺季满幅）。
  const scalesFullShadow = buildScales((row) => row.shadow ?? row.v41, false);
  const scalesOptFromFull = buildScales((row) => row.shadow ?? row.v41, true);

  const variants = emptyVariantBag();
  const peak = emptyVariantBag();
  const byMonth = new Map<string, Record<VariantKey, Metrics>>();
  const firstTwo = emptyVariantBag();

  let shadowCoverage = 0;
  for (const row of work) {
    const mk = monthKey(row.year, row.month);
    let bucket = byMonth.get(mk);
    if (!bucket) {
      bucket = emptyVariantBag();
      byMonth.set(mk, bucket);
    }

    const scaleKey = `${row.groupKey}||${mk}`;
    const baseShadow = row.shadow ?? row.v41;
    if (row.shadow != null) shadowCoverage += 1;
    const shadowOpt =
      row.shadow == null
        ? row.v41
        : blendShadowWithHorizonDecay(row.v41, row.shadow, row.horizonIndex, damp.shadowDecay, {
            calendarMonth: row.month,
            peakMonths: damp.reshape.reshapePeakMonthsFull,
          });
    const reshapedShadow = baseShadow * (scalesFullShadow.get(scaleKey) ?? 1);
    const reshapedFullWithDamp = baseShadow * (scalesOptFromFull.get(scaleKey) ?? 1);
    const reshapeShadowOpt = blendShadowWithHorizonDecay(
      row.v41,
      reshapedFullWithDamp,
      row.horizonIndex,
      damp.shadowDecay,
      {
        calendarMonth: row.month,
        peakMonths: damp.reshape.reshapePeakMonthsFull,
      },
    );

    const preds: Record<VariantKey, number> = {
      v41: row.v41,
      shadow: baseShadow,
      reshapeShadow: reshapedShadow,
      shadowOpt,
      reshapeShadowOpt,
    };

    for (const key of Object.keys(preds) as VariantKey[]) {
      addMetrics(variants[key], preds[key], row.actual, row.days);
      addMetrics(bucket[key], preds[key], row.actual, row.days);
      if (row.month === 11 || row.month === 12) {
        addMetrics(peak[key], preds[key], row.actual, row.days);
      }
      if (row.horizonIndex <= 1) {
        addMetrics(firstTwo[key], preds[key], row.actual, row.days);
      }
    }
  }

  return {
    version,
    siAvailable: siByStationMonth.size > 0,
    rows: work.length,
    shadowCoverage,
    variants,
    peak,
    firstTwo,
    byMonth,
    damp,
  };
}

function line(
  label: string,
  bag: Record<VariantKey, Metrics>,
): string {
  return `| ${label} | ${bag.v41.rows} | ${Math.round(bag.v41.actualQty)} | ${fmtBias(bag.v41)} / ${fmtWmape(bag.v41)} | ${fmtBias(bag.shadow)} / ${fmtWmape(bag.shadow)} | ${fmtBias(bag.reshapeShadow)} / ${fmtWmape(bag.reshapeShadow)} | ${fmtBias(bag.shadowOpt)} / ${fmtWmape(bag.shadowOpt)} | ${fmtBias(bag.reshapeShadowOpt)} / ${fmtWmape(bag.reshapeShadowOpt)} |`;
}

async function main() {
  const sections: string[] = [
    '# 预测精度对比：基线 vs 高优先衰减优化',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '指标说明：偏差 = (预测月量 − 实际月量) / 实际；WMAPE = Σ|预测−实际| / Σ实际。月量 = 日均 × 当月天数。',
    '',
    '优化口径：',
    '- **衰减影子**：`base + α(h)·(shadow−base)`，α 默认 `[1, 1, 0.85, 0.7, 0.6, 0.55]`（已放宽远端）；11/12 强制满幅',
    '- **优化重塑口径**：满幅影子 → 近端衰减重塑（非 11/12 且 h&lt;2 时 scale 向 1 收 50%）→ 地平线衰减',
    '',
  ];

  const summaryRows: string[] = [];

  for (const version of VERSIONS) {
    const result = await evaluateVersion(version);
    sections.push(`## ${result.version.label}`);
    sections.push('');
    sections.push(
      `版本 \`${result.version.id}\` · SI as_of=${result.version.asOfSi}（快照${result.siAvailable ? '有' : '无'}）· 可比行 ${result.rows} · 含影子 ${result.shadowCoverage}`,
    );
    sections.push('');
    sections.push(
      '| 范围 | 行数 | 实际月量 | 原V4.1 | 满幅影子 | 满幅重塑(影子) | 衰减影子 | 优化重塑(衰减影子) |',
    );
    sections.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    sections.push(line('全部', result.variants));
    sections.push(line('近端2月', result.firstTwo));
    sections.push(line('11–12月', result.peak));
    for (const [mk, bucket] of [...result.byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      sections.push(line(mk, bucket));
    }
    sections.push('');

    summaryRows.push(
      `| ${result.version.label} | ${fmtBias(result.variants.v41)} / ${fmtWmape(result.variants.v41)} | ${fmtBias(result.variants.reshapeShadow)} / ${fmtWmape(result.variants.reshapeShadow)} | ${fmtBias(result.variants.reshapeShadowOpt)} / ${fmtWmape(result.variants.reshapeShadowOpt)} | ${fmtBias(result.firstTwo.reshapeShadow)} / ${fmtWmape(result.firstTwo.reshapeShadow)} | ${fmtBias(result.firstTwo.reshapeShadowOpt)} / ${fmtWmape(result.firstTwo.reshapeShadowOpt)} | ${fmtBias(result.peak.reshapeShadow)} | ${fmtBias(result.peak.reshapeShadowOpt)} |`,
    );
  }

  sections.push('## 总览（补货推荐口径：重塑(影子)）');
  sections.push('');
  sections.push(
    '| 截止点 | 全期 原V4.1 | 全期 满幅重塑影子 | 全期 优化重塑 | 近端2月 满幅 | 近端2月 优化 | Q4 满幅 | Q4 优化 |',
  );
  sections.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  sections.push(...summaryRows);
  sections.push('');
  sections.push('## 结论');
  sections.push('');
  sections.push(
    [
      '1. **衰减影子**：相对满幅影子，远端正偏应收敛，Q4（地平线靠前）纠偏应基本保留。',
      '2. **近端衰减重塑**：目标是减轻非 Q4 截止点首月低估加深；11/12 仍满幅保形状。',
      '3. **采纳条件**：近端 2 月偏差不恶化（相对满幅重塑），全期 WMAPE 不恶化超过约 1pp，含 Q4 走步的 11–12 偏差不明显回退。',
      '4. **开关**：算法仍保持 `seasonalIndex.mode=shadow`；落地系统日均与重塑已接入上述衰减参数。',
    ].join('\n'),
  );
  sections.push('');

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'accuracy-variants-conclusion.md');
  const report = sections.join('\n');
  writeFileSync(outPath, report, 'utf8');
  console.log(report);
  console.log(`\n已写入 ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
