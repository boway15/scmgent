import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';

config({ path: resolve(import.meta.dirname, '../../../.env') });

const { db, reorderSuggestions, skus } = await import('@scm/db');
const { runReplenishmentForecast } = await import('../server/tasks/replenishmentForecast.js');

const SAMPLE_WITH_SUGGESTIONS = 300;
const SAMPLE_OTHERS = 200;

async function pickSampleSkuIds(): Promise<string[]> {
  const suggested = await db
    .selectDistinct({ id: skus.id, generatedAt: reorderSuggestions.generatedAt })
    .from(reorderSuggestions)
    .innerJoin(skus, eq(reorderSuggestions.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(desc(reorderSuggestions.generatedAt));
  const withSuggestions = [...new Set(suggested.map((r) => r.id))].slice(0, SAMPLE_WITH_SUGGESTIONS);
  const others = await db
    .select({ id: skus.id })
    .from(skus)
    .where(
      withSuggestions.length
        ? and(eq(skus.isActive, true), notInArray(skus.id, withSuggestions))
        : eq(skus.isActive, true),
    )
    .orderBy(asc(skus.code))
    .limit(SAMPLE_OTHERS);
  return [...withSuggestions, ...others.map((r) => r.id)];
}

type Row = Record<string, string | number | boolean>;

function keyOf(row: Row): string {
  return `${row.skuCode}::${row.warehouseCode}`;
}

function sortRows<T extends Row>(rows: T[]): T[] {
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function diffRows(name: string, base: Row[], next: Row[]): string[] {
  const out: string[] = [];
  const baseMap = new Map(base.map((r) => [keyOf(r), r]));
  const nextMap = new Map(next.map((r) => [keyOf(r), r]));
  for (const [key, row] of baseMap) {
    const other = nextMap.get(key);
    if (!other) {
      out.push(`[${name}] 缺失 ${key}`);
      continue;
    }
    for (const field of Object.keys(row)) {
      if (row[field] !== other[field]) {
        out.push(`[${name}] ${key} ${field}: ${row[field]} → ${other[field]}`);
      }
    }
  }
  for (const key of nextMap.keys()) {
    if (!baseMap.has(key)) out.push(`[${name}] 新增 ${key}`);
  }
  return out;
}

type Baseline = {
  /** null 表示全量 */
  skuIds: string[] | null;
  suggestions: Row[];
  health: Row[];
};

async function main() {
  const args = process.argv.slice(2);
  const full = args.includes('--full');
  const [mode, file] = args.filter((a) => !a.startsWith('--'));
  if ((mode !== 'export' && mode !== 'compare') || !file) {
    console.error('用法: tsx scripts/replenishment-baseline.ts <export|compare> <file.json> [--full]');
    process.exit(2);
  }
  const base = mode === 'compare' ? (JSON.parse(readFileSync(file, 'utf8')) as Baseline) : null;
  const skuIds = base ? base.skuIds : full ? null : await pickSampleSkuIds();
  const started = Date.now();
  const result = await runReplenishmentForecast({ dryRun: true, ...(skuIds ? { skuIds } : {}) });
  const current: Baseline = {
    skuIds,
    suggestions: sortRows(result.dry?.suggestions ?? []),
    health: sortRows(result.dry?.health ?? []),
  };
  const seconds = Math.round((Date.now() - started) / 1000);
  if (mode === 'export') {
    writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
    console.log(
      `已导出 ${skuIds ? `${skuIds.length} 个 SKU` : '全量'}：${current.suggestions.length} 条建议、${current.health.length} 条健康行，用时 ${seconds}s → ${file}`,
    );
    process.exit(0);
  }
  if (!base) process.exit(2);
  const diffs = [
    ...diffRows('suggestions', base.suggestions, current.suggestions),
    ...diffRows('health', base.health, current.health),
  ];
  if (diffs.length) {
    console.error(diffs.slice(0, 200).join('\n'));
    console.error(`共 ${diffs.length} 处差异`);
    process.exit(1);
  }
  console.log(`与基线一致（用时 ${seconds}s）`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
