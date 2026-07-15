/**
 * 走步回测 CSV：模拟 A/B/C/D 分类下的窗口 WMAPE（6 个月口径）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyVolumeTier } from '../server/lib/forecast-eligibility.js';
import { computeWeightedMape, type AccuracyRowInput } from '../server/lib/forecast-accuracy-tier.js';

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'] as const;

type ProfileClass = 'A' | 'B' | 'C' | 'D';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function classifyProfile(acts: number[]): ProfileClass {
  const n = acts.length;
  const continuity = acts.filter((x) => x > 0).length / n;
  const mean = acts.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(acts.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const cv = mean > 0 ? std / mean : 999;
  if (continuity > 0.75 && cv < 1) return 'A';
  if (continuity > 0.75 && cv >= 1) return 'B';
  if (continuity < 0.75 && cv < 1.5) return 'C';
  return 'D';
}

function fmt(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function main() {
  const ROOT = resolve(import.meta.dirname, '../../..');
  const csvPath =
    readArg('--csv') ??
    resolve(ROOT, 'apps/web/docs/samples/forecast-backtest/walkforward-2026-01-01-6m-v3.csv');

  const text = readFileSync(csvPath, 'utf8');
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .slice(1)
    .map((line) => {
      const p = line.split(',');
      const month = p[3] ?? '';
      return {
        sku: p[0] ?? '',
        month,
        fc: Number(p[4]),
        act: Number(p[5]),
        k: MONTHS.indexOf(month as (typeof MONTHS)[number]),
      };
    });

  const bySku = new Map<string, { acts: number[]; avgDaily: number }>();
  for (const r of rows) {
    const agg = bySku.get(r.sku) ?? { acts: [], avgDaily: 0 };
    agg.acts.push(r.act);
    bySku.set(r.sku, agg);
  }
  for (const agg of bySku.values()) {
    agg.avgDaily = agg.acts.reduce((s, x) => s + x, 0) / agg.acts.length;
  }

  const classBySku = new Map<string, ProfileClass>(
    [...bySku.entries()].map(([sku, agg]) => [sku, classifyProfile(agg.acts)]),
  );

  const counts: Record<ProfileClass, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const c of classBySku.values()) counts[c]++;

  console.log(`文件: ${csvPath}`);
  console.log('ABCD 分布 (6 月口径):', counts);

  function toAccuracy(sub: typeof rows): AccuracyRowInput[] {
    return sub.map((r) => ({
      skuCode: r.sku,
      actualDaily: r.act,
      forecastDaily: r.fc,
      mape: null,
      biasRate: null,
    }));
  }

  for (const cls of ['A', 'B', 'C', 'D'] as ProfileClass[]) {
    const skuSet = new Set(
      [...classBySku.entries()].filter(([, c]) => c === cls).map(([s]) => s),
    );
    const coreSkus = [...skuSet].filter(
      (s) => classifyVolumeTier(bySku.get(s)!.avgDaily) === 'core',
    );

    for (const [band, label, target] of [
      ['near', 'k=0~2', '15%'],
      ['far', 'k=3~5', '25%'],
    ] as const) {
      const sub = rows.filter(
        (r) => skuSet.has(r.sku) && (band === 'near' ? r.k <= 2 : r.k >= 3),
      );
      const coreSub = sub.filter((r) => coreSkus.includes(r.sku));
      console.log(
        `${cls} ${label} | 目标≤${target} | 全类 WMAPE ${fmt(computeWeightedMape(toAccuracy(sub)))} | 主力 WMAPE ${fmt(computeWeightedMape(toAccuracy(coreSub)))} | SKU ${skuSet.size} (主力 ${coreSkus.length})`,
      );
    }
  }
}

main();
