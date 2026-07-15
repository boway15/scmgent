/**
 * 走步回测 CSV 汇总：Top 高偏差 SKU、销量分层、品类分层。
 *
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-csv.ts
 *   pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-csv.ts -- --csv path/to.csv --top 30
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import {
  formatTierSummaryLines,
  summarizeAccuracyByTier,
} from '../server/lib/forecast-accuracy-tier.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

type CsvRow = {
  skuCode: string;
  monthLabel: string;
  forecastDaily: number;
  actualDaily: number;
  biasRate: number | null;
  mape: number | null;
};

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function parseCsv(path: string): CsvRow[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  return data.map((line) => {
    const [skuCode, , , , fc, act, bias, mape] = line.split(',');
    return {
      skuCode,
      monthLabel: '',
      forecastDaily: Number(fc),
      actualDaily: Number(act),
      biasRate: bias === '' ? null : Number(bias),
      mape: mape === '' ? null : Number(mape),
    };
  });
}

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

async function main() {
  const csvPath =
    readArg('--csv') ?? resolve(ROOT, 'docs/samples/forecast-backtest/walkforward-2026-01-01-6m.csv');
  const topN = Number(readArg('--top') ?? '25');

  const rows = parseCsv(csvPath);
  console.log(`读取 ${rows.length} 行 ← ${csvPath}\n`);

  const skuCodes = [...new Set(rows.map((r) => r.skuCode))];
  const categoryByCode = new Map<string, string | null>();

  const batchSize = 500;
  for (let i = 0; i < skuCodes.length; i += batchSize) {
    const batch = skuCodes.slice(i, i + batchSize);
    const dbRows = await db
      .select({ code: skus.code, category: skus.category })
      .from(skus)
      .where(inArray(skus.code, batch));
    for (const row of dbRows) {
      categoryByCode.set(row.code, row.category?.trim() || null);
    }
  }

  const accuracyRows = rows.map((r) => ({
    skuCode: r.skuCode,
    category: categoryByCode.get(r.skuCode) ?? null,
    actualDaily: r.actualDaily,
    forecastDaily: r.forecastDaily,
    mape: r.mape,
    biasRate: r.biasRate,
  }));

  const summary = summarizeAccuracyByTier(accuracyRows);
  console.log(formatTierSummaryLines(summary).join('\n'));

  const bySku = new Map<string, { mapeValues: number[]; biasValues: number[]; sumActual: number; months: number }>();
  for (const r of rows) {
    let agg = bySku.get(r.skuCode);
    if (!agg) agg = { mapeValues: [], biasValues: [], sumActual: 0, months: 0 };
    agg.months += 1;
    agg.sumActual += r.actualDaily;
    if (r.actualDaily > 0) {
      if (r.mape != null) agg.mapeValues.push(r.mape);
      if (r.biasRate != null) agg.biasValues.push(r.biasRate);
    }
    bySku.set(r.skuCode, agg);
  }

  console.log(`\n【Top ${topN} 高偏差 SKU】（均实际≥1/日，按均 MAPE 降序）`);
  const topByMape = [...bySku.entries()]
    .map(([skuCode, agg]) => ({
      skuCode,
      avgActual: agg.sumActual / agg.months,
      avgMape:
        agg.mapeValues.length > 0
          ? agg.mapeValues.reduce((s, v) => s + v, 0) / agg.mapeValues.length
          : null,
      avgBias:
        agg.biasValues.length > 0
          ? agg.biasValues.reduce((s, v) => s + v, 0) / agg.biasValues.length
          : null,
    }))
    .filter((s) => s.avgActual >= 1 && s.avgMape != null)
    .sort((a, b) => (b.avgMape ?? 0) - (a.avgMape ?? 0))
    .slice(0, topN);

  for (const s of topByMape) {
    console.log(
      `${s.skuCode} | 均实际 ${s.avgActual.toFixed(2)}/日 | MAPE ${fmtPct(s.avgMape)} | 偏差 ${fmtPct(s.avgBias)}`,
    );
  }

  console.log('\n【品类 Top 15】');
  for (const c of summary.byCategory) {
    console.log(
      `${c.category} | ${c.skuCount} SKU | WMAPE ${fmtPct(c.wmape)} | 偏差 ${fmtPct(c.weightedBias)}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
