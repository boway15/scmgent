/**
 * 各层回测数据报告：SKU 数、验证销量、剔除统计、核心 KPI
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/sales-tier-backtest-report.ts
 *   FORECAST_ATTACK_PHASE=full tsx scripts/sales-tier-backtest-report.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_KPI_MIN_ACTUAL_MONTHLY } from '../server/lib/forecast-accuracy-outlier.js';
import {
  getSalesTierKpiTarget,
  getT1SubKpiTarget,
  resolveSalesTierSegment,
  SALES_TIER_META,
  T1_SUB_SEGMENT_META,
  type SalesTier,
  type T1SubSegment,
} from '../server/lib/forecast-sales-tier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_PRED = resolve(
  ROOT,
  'docs/samples/forecast-backtest/csv-backtest-report/backtest-predictions.csv',
);
const DEFAULT_SALES_CSV = resolve(
  ROOT,
  'docs/samples/xiaoshou/产品销售报表-每月6a40a8dac9533e5db3fc8864.csv',
);
const OUT_MD = resolve(
  ROOT,
  'docs/samples/forecast-backtest/csv-backtest-report/tier-backtest-report.md',
);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type PredRow = {
  sku: string;
  tier: SalesTier;
  t1Sub: string;
  h: number;
  pred: number;
  act: number;
  ghost: boolean;
  outlierRow: boolean;
  outlierSku: boolean;
  exogenousSku: boolean;
  kpiCore: boolean;
  model: string;
  yearMonth: string;
};

function wmape(rows: PredRow[]): number | null {
  const c = rows.filter((r) => r.act > 0);
  if (!c.length) return null;
  return c.reduce((s, r) => s + Math.abs(r.pred - r.act), 0) / c.reduce((s, r) => s + r.act, 0);
}

function pct(n: number | null, digits = 1): string {
  return n == null ? '—' : `${(n * 100).toFixed(digits)}%`;
}

function num(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function uniqueSkus(rows: PredRow[]): Set<string> {
  return new Set(rows.map((r) => r.sku));
}

type TierStats = {
  label: string;
  skuCount: number;
  actNear: number;
  predNear: number;
  actAll: number;
  predAll: number;
  rowsNear: number;
  rowsAll: number;
  coreRows: number;
  ghostRows: number;
  zeroActRows: number;
  microActRows: number;
  outlierRowCount: number;
  exoSkuCount: number;
  autoOutlierSkuCount: number;
  manualExoSkuCount: number;
  zeroPredSkuCount: number;
  coreWmape: number | null;
  rawWmape: number | null;
  kpiTarget: number | null;
  kpiStatus: string;
};

function buildTierStats(
  label: string,
  allRows: PredRow[],
  near: PredRow[],
  kpiTarget: number | null,
  manualExoSkus: Set<string>,
): TierStats {
  const skus = uniqueSkus(allRows);
  const exoSkus = uniqueSkus(near.filter((r) => r.exogenousSku));
  const autoOutlierSkus = uniqueSkus(near.filter((r) => r.outlierSku));
  const manualInTier = [...exoSkus].filter((s) => manualExoSkus.has(s)).length;
  const zeroPredSkus = new Set(
    near.filter((r) => r.pred <= 0).map((r) => r.sku),
  );
  const core = near.filter((r) => r.kpiCore);
  const coreW = wmape(core);
  const rawW = wmape(near.filter((r) => r.act > 0));

  return {
    label,
    skuCount: skus.size,
    actNear: near.reduce((s, r) => s + r.act, 0),
    predNear: near.reduce((s, r) => s + r.pred, 0),
    actAll: allRows.reduce((s, r) => s + r.act, 0),
    predAll: allRows.reduce((s, r) => s + r.pred, 0),
    rowsNear: near.length,
    rowsAll: allRows.length,
    coreRows: core.length,
    ghostRows: near.filter((r) => r.ghost).length,
    zeroActRows: near.filter((r) => r.act === 0).length,
    microActRows: near.filter(
      (r) => r.act > 0 && r.act < DEFAULT_KPI_MIN_ACTUAL_MONTHLY,
    ).length,
    outlierRowCount: near.filter((r) => r.outlierRow).length,
    exoSkuCount: exoSkus.size,
    autoOutlierSkuCount: autoOutlierSkus.size,
    manualExoSkuCount: manualInTier,
    zeroPredSkuCount: zeroPredSkus.size,
    coreWmape: coreW,
    rawWmape: rawW,
    kpiTarget,
    kpiStatus:
      kpiTarget == null
        ? '—'
        : coreW != null && coreW <= kpiTarget
          ? 'pass'
          : coreW == null
            ? '—'
            : 'fail',
  };
}

function statsToMarkdownRow(s: TierStats): string {
  const actNearDisplay = s.kpiStatus === 'skip' ? `${num(s.actAll)}*` : num(s.actNear);
  return [
    s.label,
    String(s.skuCount),
    actNearDisplay,
    num(s.predNear),
    String(s.rowsNear),
    String(s.coreRows),
    pct(s.coreWmape),
    s.kpiTarget == null ? '—' : pct(s.kpiTarget, 0),
    s.kpiStatus,
    String(s.ghostRows),
    String(s.exoSkuCount),
    String(s.autoOutlierSkuCount),
    String(s.manualExoSkuCount),
    String(s.microActRows),
    String(s.zeroActRows),
    String(s.zeroPredSkuCount),
  ].join(' | ');
}

function printStats(s: TierStats) {
  console.log(`\n### ${s.label}`);
  console.log(`- SKU 数：${s.skuCount}`);
  if (s.kpiStatus === 'skip') {
    console.log(`- 验证销量（全地平线 6 月）：${num(s.actAll)} 件 | 无点预测（T5/T6 跳过）`);
    console.log(`- 说明：该层不参与回测预测，仅统计验证期实际销量`);
    return;
  }
  console.log(`- 验证销量（近端 h≤3）：${num(s.actNear)} 件 | 预测：${num(s.predNear)} 件`);
  console.log(`- 验证销量（全地平线 6 月）：${num(s.actAll)} 件 | 预测：${num(s.predAll)} 件`);
  console.log(`- 预测行数：近端 ${s.rowsNear} | 全量 ${s.rowsAll}`);
  console.log(`- 核心 KPI：WMAPE ${pct(s.coreWmape)}（目标 ${s.kpiTarget == null ? '—' : pct(s.kpiTarget, 0)}）${s.kpiStatus === 'pass' ? ' ✅' : s.kpiStatus === 'fail' ? ' ❌' : s.kpiStatus === 'skip' ? '（无点预测）' : ''}`);
  console.log(`- 原始 WMAPE（近端 act>0）：${pct(s.rawWmape)}`);
  console.log(`- 剔除统计（近端）：`);
  console.log(`  - 核心可比行：${s.coreRows}`);
  console.log(`  - ghost 行（act=0 且 pred>0）：${s.ghostRows}`);
  console.log(`  - 外生剔除 SKU：${s.exoSkuCount}（自动异常 ${s.autoOutlierSkuCount} | 人工标记 ${s.manualExoSkuCount}）`);
  console.log(`  - 外生冲击行（APE 超阈）：${s.outlierRowCount}`);
  console.log(`  - 微销排除行（0<act<${DEFAULT_KPI_MIN_ACTUAL_MONTHLY}）：${s.microActRows}`);
  console.log(`  - 零销行（act=0）：${s.zeroActRows}`);
  console.log(`  - 零预测 SKU（近端任一月 pred≤0）：${s.zeroPredSkuCount}`);
}

function loadPredictions(path: string): PredRow[] {
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]!);
  const ix = (n: string) => h.indexOf(n);
  const rows: PredRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]!);
    const tier = c[ix('sales_tier')] as SalesTier;
    if (!tier?.startsWith('T')) continue;
    rows.push({
      sku: c[ix('sku')] ?? '',
      tier,
      t1Sub: c[ix('t1_sub_segment')] ?? '',
      h: Number(c[ix('horizon')]),
      pred: Number(c[ix('predicted_monthly')]),
      act: Number(c[ix('actual_monthly')]),
      ghost: c[ix('ghost_row')] === '1',
      outlierRow: c[ix('outlier_row')] === '1',
      outlierSku: c[ix('outlier_sku')] === '1',
      exogenousSku: c[ix('exogenous_sku')] === '1',
      kpiCore: c[ix('kpi_core')] === '1',
      model: c[ix('model')] ?? '',
      yearMonth: c[ix('year_month')] ?? '',
    });
  }
  return rows;
}

function loadManualExoSkus(): Set<string> {
  const path = resolve(ROOT, 'docs/samples/forecast-backtest/exogenous-skus.csv');
  try {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    const skus = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const sku = lines[i]!.split(',')[0]?.trim();
      if (sku) skus.add(sku);
    }
    return skus;
  } catch {
    return new Set();
  }
}

function parseMonthCol(col: string): string | null {
  const m = /^\((\d{4}-\d{2})\)$/.exec(col.trim());
  return m ? m[1]! : null;
}

/** 从月销 CSV 补全 T5/T6 等无预测层的 SKU 与验证销量 */
function loadTierBaselineFromSalesCsv(csvPath: string): Map<SalesTier, { sku: number; testSum: number }> {
  const out = new Map<SalesTier, { sku: number; testSum: number }>();
  try {
    const text = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = parseCsvLine(lines[0]!);
    const months = header
      .map((c) => parseMonthCol(c))
      .filter((c): c is string => c != null)
      .sort();
    const train = months.slice(0, 24);
    const test = months.slice(24, 30);
    const bySku = new Map<string, { train: number[]; test: number }>();
    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]!);
      const rec: Record<string, string> = {};
      header.forEach((h, j) => {
        rec[h] = (parts[j] ?? '').trim();
      });
      const sku = rec.SKU ?? '';
      if (!sku) continue;
      const trainQty = train.map((ym) => Math.max(0, Number(rec[`(${ym})`]) || 0));
      const testSum = test.reduce((s, ym) => s + Math.max(0, Number(rec[`(${ym})`]) || 0), 0);
      const ex = bySku.get(sku);
      if (!ex) bySku.set(sku, { train: trainQty, test: testSum });
      else {
        for (let j = 0; j < train.length; j++) ex.train[j] = (ex.train[j] ?? 0) + (trainQty[j] ?? 0);
        ex.test += testSum;
      }
    }
    for (const [, v] of bySku) {
      const { tier } = resolveSalesTierSegment(v.train, { holdoutSum: v.test });
      const agg = out.get(tier) ?? { sku: 0, testSum: 0 };
      agg.sku += 1;
      agg.testSum += v.test;
      out.set(tier, agg);
    }
  } catch {
    /* optional */
  }
  return out;
}

function emptyTierStats(label: string, skuCount: number, testSum: number): TierStats {
  return {
    label,
    skuCount,
    actNear: 0,
    predNear: 0,
    actAll: testSum,
    predAll: 0,
    rowsNear: 0,
    rowsAll: 0,
    coreRows: 0,
    ghostRows: 0,
    zeroActRows: 0,
    microActRows: 0,
    outlierRowCount: 0,
    exoSkuCount: 0,
    autoOutlierSkuCount: 0,
    manualExoSkuCount: 0,
    zeroPredSkuCount: skuCount,
    coreWmape: null,
    rawWmape: null,
    kpiTarget: null,
    kpiStatus: 'skip',
  };
}

const predPath = process.argv.includes('--pred')
  ? process.argv[process.argv.indexOf('--pred') + 1]!
  : DEFAULT_PRED;

const rows = loadPredictions(predPath);
const near = rows.filter((r) => r.h <= 3);
const manualExo = loadManualExoSkus();
const phase = process.env.FORECAST_ATTACK_PHASE === 'full' ? 'full' : 'attack';
const salesCsvPath = process.argv.includes('--csv')
  ? process.argv[process.argv.indexOf('--csv') + 1]!
  : DEFAULT_SALES_CSV;
const tierBaseline = loadTierBaselineFromSalesCsv(salesCsvPath);

const TIER_TO_SEGMENT: Partial<Record<SalesTier, Parameters<typeof getSalesTierKpiTarget>[0]>> = {
  T2_stable: 'T2:stable',
  T3_seasonal: 'T3:seasonal',
  T4_intermittent: 'T4:intermittent',
};

const tiers = (Object.keys(SALES_TIER_META) as SalesTier[]).filter(
  (t) => rows.some((r) => r.tier === t) || tierBaseline.has(t),
);

const tierStatsList: TierStats[] = tiers.map((tier) => {
  const all = rows.filter((r) => r.tier === tier);
  const subNear = near.filter((r) => r.tier === tier);
  const segKey = TIER_TO_SEGMENT[tier];
  const target = segKey ? getSalesTierKpiTarget(segKey, 'precision') : null;
  if (all.length === 0) {
    const base = tierBaseline.get(tier);
    return emptyTierStats(
      SALES_TIER_META[tier].label,
      base?.sku ?? 0,
      base?.testSum ?? 0,
    );
  }
  return buildTierStats(SALES_TIER_META[tier].label, all, subNear, target, manualExo);
});

const t1SubStats: TierStats[] = (Object.keys(T1_SUB_SEGMENT_META) as T1SubSegment[])
  .filter((sub) => rows.some((r) => r.t1Sub === sub))
  .sort((a, b) => T1_SUB_SEGMENT_META[a].gateOrder - T1_SUB_SEGMENT_META[b].gateOrder)
  .map((sub) => {
    const all = rows.filter((r) => r.t1Sub === sub);
    const subNear = near.filter((r) => r.t1Sub === sub);
    return buildTierStats(
      T1_SUB_SEGMENT_META[sub].label,
      all,
      subNear,
      getT1SubKpiTarget(sub, 'precision'),
      manualExo,
    );
  });

const totalSkus = uniqueSkus(rows).size;
const totalActNear = near.reduce((s, r) => s + r.act, 0);
const totalExoSkus = uniqueSkus(rows.filter((r) => r.exogenousSku)).size;

console.log('=== 分层回测数据报告 ===');
console.log(`数据源：${predPath}`);
console.log(`回测阶段：${phase}（FORECAST_ATTACK_PHASE=${phase}）`);
console.log(`验证窗：6 月 | 近端地平线：h≤3 | 微销下限：${DEFAULT_KPI_MIN_ACTUAL_MONTHLY} 件/月`);
console.log(`全库 SKU：${totalSkus} | 近端验证总销量：${num(totalActNear)} | 外生剔除 SKU（全局）：${totalExoSkus} | 人工标记：${manualExo.size}`);

console.log('\n## T1~T6 各层汇总');
const header =
  '| 层级 | SKU | 验证销量(近端) | 预测(近端) | 行数 | 核心可比 | 核心WMAPE | 目标 | 状态 | ghost | 外生SKU | 自动异常SKU | 人工外生 | 微销排除 | 零销行 | 零预测SKU |';
const sep = '|:---|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|';
console.log(header);
console.log(sep);
for (const s of tierStatsList) {
  console.log('| ' + statsToMarkdownRow(s) + ' |');
}

for (const s of tierStatsList) printStats(s);

console.log('\n## T1 子层明细');
console.log(header);
console.log(sep);
for (const s of t1SubStats) {
  console.log('| ' + statsToMarkdownRow(s) + ' |');
}
for (const s of t1SubStats) printStats(s);

const md = `# 分层回测数据报告

生成时间：${new Date().toISOString()}
数据源：\`${predPath}\`
回测阶段：**${phase}** | 近端 h≤3 | 微销下限 ${DEFAULT_KPI_MIN_ACTUAL_MONTHLY} 件/月

## 全局

| 指标 | 数值 |
|------|-----:|
| 参与回测 SKU | ${totalSkus} |
| 近端验证总销量 | ${num(totalActNear)} |
| 外生剔除 SKU（全局） | ${totalExoSkus} |
| 人工外生标记 | ${manualExo.size} |

## T1~T6 各层

${header}
${sep}
${tierStatsList.map((s) => '| ' + statsToMarkdownRow(s) + ' |').join('\n')}

## T1 子层

${header}
${sep}
${t1SubStats.map((s) => '| ' + statsToMarkdownRow(s) + ' |').join('\n')}

## 口径说明

- **核心可比**：非 ghost、非外生 SKU、验证月 actual≥${DEFAULT_KPI_MIN_ACTUAL_MONTHLY} 件
- **ghost**：验证月 actual=0 且 pred>0
- **外生 SKU**：自动 APE 超阈整单剔除 + \`exogenous-skus.csv\` 人工标记
- **微销排除**：0 < actual < ${DEFAULT_KPI_MIN_ACTUAL_MONTHLY}，仅展示不计 KPI
- **T5/T6**：无点预测；表中验证销量带 * 为全 6 月实际销量
`;

mkdirSync(resolve(ROOT, 'docs/samples/forecast-backtest/csv-backtest-report'), { recursive: true });
writeFileSync(OUT_MD, md, 'utf8');
console.log(`\n已写入：${OUT_MD}`);
