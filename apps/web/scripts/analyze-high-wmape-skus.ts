/**
 * 分析 SKU 级 WMAPE 偏高商品：按分层、偏差方向、ghost 聚合，辅助定位优化方向。
 *
 * Usage:
 *   pnpm forecast:analyze:high-wmape -- --csv path/to/forecast-accuracy-sku-summary.csv
 *   pnpm forecast:analyze:high-wmape -- --csv path/to/walkforward.csv --format walkforward
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  capSkuWmapeForStats,
  SKU_WMAPE_STAT_CAP,
} from '../server/lib/forecast-accuracy-tier.js';
import { classifyVolumeTier } from '../server/lib/forecast-eligibility.js';
import { segmentLabel } from '../server/lib/forecast-profile-class.js';

type SkuAgg = {
  skuCode: string;
  profileSegment: string;
  comparableRows: number;
  ghostRows: number;
  zeroForecastMissRows: number;
  actualSum: number;
  forecastSum: number;
  rawWmape: number | null;
  wmape: number | null;
  bias: number | null;
};

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function pct(v: number | null, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function parseSkuSummaryCsv(path: string): SkuAgg[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.includes('sku_code')) throw new Error(`unexpected header: ${header}`);
  const cols = header.split(',');
  const idx = (name: string) => cols.indexOf(name);

  return data.map((line) => {
    const parts = line.split(',');
    const actualSum = Number(parts[idx('actual_daily_sum')] ?? 0);
    const forecastSum = Number(parts[idx('forecast_daily_sum')] ?? 0);
    const rawWmapePct = parts[idx('wmape_raw_pct')] ?? parts[idx('wmape_pct')] ?? '';
    const wmapePct = parts[idx('wmape_pct')] ?? '';
    const biasPct = parts[idx('bias_pct')] ?? '';
    const rawWmape = rawWmapePct ? Number(rawWmapePct) / 100 : null;
    const wmape = wmapePct ? Number(wmapePct) / 100 : capSkuWmapeForStats(rawWmape);
    const bias = biasPct ? Number(biasPct) / 100 : null;
    return {
      skuCode: parts[idx('sku_code')] ?? '',
      profileSegment: parts[idx('profile_segment')] ?? '',
      comparableRows: Number(parts[idx('comparable_rows')] ?? 0),
      ghostRows: Number(parts[idx('ghost_rows')] ?? 0),
      zeroForecastMissRows: Number(parts[idx('zero_forecast_miss_rows')] ?? 0),
      actualSum,
      forecastSum,
      rawWmape,
      wmape,
      bias,
    };
  });
}

function parseWalkforwardCsv(path: string): SkuAgg[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('sku_code')) throw new Error(`unexpected header: ${header}`);

  const bySku = new Map<string, SkuAgg & { months: number }>();
  for (const line of data) {
    const parts = line.split(',');
    const skuCode = parts[0] ?? '';
    const forecastDaily = Number(parts[4]);
    const actualDaily = Number(parts[5]);
    const profileSegment = parts[8] ?? '';
    const ghostRow = Number(parts[16] ?? 0);
    let agg = bySku.get(skuCode);
    if (!agg) {
      agg = {
        skuCode,
        profileSegment,
        comparableRows: 0,
        ghostRows: 0,
        zeroForecastMissRows: 0,
        actualSum: 0,
        forecastSum: 0,
        rawWmape: null,
        wmape: null,
        bias: null,
        months: 0,
      };
      bySku.set(skuCode, agg);
    }
    if (!agg.profileSegment && profileSegment) agg.profileSegment = profileSegment;
    agg.months += 1;
    if (forecastDaily > 0) {
      agg.comparableRows += 1;
      if (actualDaily > 0) {
        agg.actualSum += actualDaily;
        agg.forecastSum += forecastDaily;
      } else {
        agg.ghostRows += ghostRow > 0 ? 1 : 1;
      }
    } else if (actualDaily > 0) {
      agg.zeroForecastMissRows += 1;
    }
  }

  return [...bySku.values()].map((agg) => {
    const rawWmape =
      agg.actualSum > 0
        ? Math.abs(agg.forecastSum - agg.actualSum) / agg.actualSum
        : null;
    const bias = agg.actualSum > 0 ? (agg.forecastSum - agg.actualSum) / agg.actualSum : null;
    const { months: _months, ...rest } = agg;
    return {
      ...rest,
      rawWmape,
      wmape: capSkuWmapeForStats(rawWmape),
      bias,
    };
  });
}

function volumeTierLabel(avgDaily: number): string {
  if (avgDaily <= 0) return 'skipped';
  return classifyVolumeTier(avgDaily);
}

function main() {
  const csvPath = readArg('--csv');
  if (!csvPath) {
    console.error('Usage: pnpm forecast:analyze:high-wmape -- --csv <path> [--format sku|walkforward] [--min-wmape 1]');
    process.exit(1);
  }
  const format = readArg('--format') ?? (csvPath.includes('sku-summary') ? 'sku' : 'walkforward');
  const minWmape = Number(readArg('--min-wmape') ?? '1');
  const rows =
    format === 'sku' ? parseSkuSummaryCsv(resolve(csvPath)) : parseWalkforwardCsv(resolve(csvPath));

  const high = rows.filter((r) => (r.wmape ?? 0) >= minWmape);
  const extremeRaw = rows.filter((r) => (r.rawWmape ?? 0) >= 10);
  const cappedCount = rows.filter(
    (r) => r.rawWmape != null && r.rawWmape >= SKU_WMAPE_STAT_CAP && (r.wmape ?? 0) === SKU_WMAPE_STAT_CAP,
  ).length;

  console.log(`\n## 高 WMAPE SKU 分析`);
  console.log(`文件: ${csvPath}`);
  console.log(`SKU 总数: ${rows.length} · WMAPE≥${(minWmape * 100).toFixed(0)}%: ${high.length}`);
  console.log(`原始 WMAPE≥1000%: ${extremeRaw.length} · 统计封顶 ${(SKU_WMAPE_STAT_CAP * 100).toFixed(0)}% 命中: ${cappedCount}`);

  const bySegment = new Map<string, { count: number; sumWmape: number; overForecast: number; underForecast: number; ghost: number }>();
  const byVolume = new Map<string, number>();
  const byIssue = { ghostOnly: 0, overForecast: 0, underForecast: 0, mixed: 0 };

  for (const row of high) {
    const seg = row.profileSegment || 'unclassified';
    const avgDaily = row.comparableRows > 0 ? row.actualSum / row.comparableRows : 0;
    const vol = volumeTierLabel(avgDaily);
    byVolume.set(vol, (byVolume.get(vol) ?? 0) + 1);

    const bucket = bySegment.get(seg) ?? { count: 0, sumWmape: 0, overForecast: 0, underForecast: 0, ghost: 0 };
    bucket.count += 1;
    bucket.sumWmape += row.wmape ?? 0;
    if ((row.bias ?? 0) > 0.1) bucket.overForecast += 1;
    if ((row.bias ?? 0) < -0.1) bucket.underForecast += 1;
    if (row.ghostRows > 0) bucket.ghost += 1;
    bySegment.set(seg, bucket);

    const hasGhost = row.ghostRows > 0;
    const over = (row.bias ?? 0) > 0.1;
    const under = (row.bias ?? 0) < -0.1;
    if (hasGhost && !over && !under) byIssue.ghostOnly += 1;
    else if (over && !under) byIssue.overForecast += 1;
    else if (under && !over) byIssue.underForecast += 1;
    else byIssue.mixed += 1;
  }

  console.log('\n### 按画像分层（WMAPE 偏高 SKU）');
  for (const [seg, stat] of [...bySegment.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const label = segmentLabel(seg);
    console.log(
      `- ${seg}${label !== seg ? `（${label}）` : ''}: ${stat.count} SKU · 均 WMAPE ${pct(stat.count ? stat.sumWmape / stat.count : null)} · 高估 ${stat.overForecast} · 低估 ${stat.underForecast} · 含 ghost ${stat.ghost}`,
    );
  }

  console.log('\n### 按销量分层（实际日均）');
  for (const [vol, count] of [...byVolume.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${vol}: ${count} SKU`);
  }

  console.log('\n### 偏差类型');
  console.log(`- 仅 ghost（有预测无实际）: ${byIssue.ghostOnly}`);
  console.log(`- 系统性高估: ${byIssue.overForecast}`);
  console.log(`- 系统性低估: ${byIssue.underForecast}`);
  console.log(`- 混合/其他: ${byIssue.mixed}`);

  console.log('\n### Top 20 高 WMAPE SKU');
  for (const row of [...high].sort((a, b) => (b.wmape ?? 0) - (a.wmape ?? 0)).slice(0, 20)) {
    console.log(
      `  ${row.skuCode} | ${row.profileSegment || '—'} | WMAPE ${pct(row.wmape)} (raw ${pct(row.rawWmape)}) | Bias ${pct(row.bias)} | ghost ${row.ghostRows} | 实际/预测 ${row.actualSum.toFixed(1)}/${row.forecastSum.toFixed(1)}`,
    );
  }

  console.log('\n### 优化建议（自动归纳）');
  const topSeg = [...bySegment.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (topSeg) {
    console.log(`- 高发分层 ${topSeg[0]} 占 ${topSeg[1].count}/${high.length}，优先检查该层 ghost 闸门与上界折减`);
  }
  if (byIssue.ghostOnly > high.length * 0.3) {
    console.log('- ghost 占比高：加强弱动销/近端零销归零（T3/T4A/T4B）');
  }
  if (byIssue.overForecast > byIssue.underForecast) {
    console.log('- 高估为主：检查 Q2 折减、core/tail 上界 cap、低量 micro-sales 封顶');
  }
  if ((byVolume.get('tail') ?? 0) > high.length * 0.4) {
    console.log('- 长尾 SKU 占比高：考虑 force_forecast 审查或 T99 降级');
  }
}

main();
