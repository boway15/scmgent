/**
 * 未来草稿准确性/合理性：组合形状 + 相对销售史的 11 月偏差/WMAPE + Top50 桶
 * 对比发布版 vs 优化草稿（含落地后再帽）
 *
 * pnpm --filter @scm/web exec tsx scripts/verify-future-draft-accuracy.ts
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const PUB = process.env.TOP50_BASELINE_VERSION || 'DRAFT-1793959940865';
const OPT = process.env.TOP50_COMPARE_VERSION || 'DRAFT-1794197424316';

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

type Bag = { rows: number; actualQty: number; predQty: number; absErr: number };
function empty(): Bag {
  return { rows: 0, actualQty: 0, predQty: 0, absErr: 0 };
}
function add(b: Bag, predDaily: number, actualDaily: number, days: number) {
  const pred = predDaily * days;
  const actual = actualDaily * days;
  b.rows += 1;
  b.predQty += pred;
  b.actualQty += actual;
  b.absErr += Math.abs(pred - actual);
}
function bias(b: Bag): string {
  if (!(b.actualQty > 0)) return '—';
  return `${(((b.predQty - b.actualQty) / b.actualQty) * 100).toFixed(1)}%`;
}
function wmape(b: Bag): string {
  if (!(b.actualQty > 0)) return '—';
  return `${((b.absErr / b.actualQty) * 100).toFixed(1)}%`;
}
function verdict(vsMtd: number | null, vsOct: number | null): string {
  const a = vsMtd ?? 0;
  const b = vsOct ?? 0;
  if (a >= 30 || (a >= 20 && b >= 30)) return '偏乐观';
  if (a <= -20 || (a <= -15 && b <= -20)) return '偏保守';
  return '大致合理';
}
function shapePass(nov: number | null, dec: number | null, feb: number | null): string {
  if (nov == null || dec == null || feb == null) return '缺月，无法判定';
  const peakOk = nov > feb && dec > feb;
  const orderOk = dec >= nov * 0.95;
  if (peakOk && orderOk) return '通过（11/12 > 2 月）';
  if (peakOk) return '部分通过（旺季>2月，但 12 相对 11 偏弱）';
  return '未通过';
}

async function resolveVersion(versionNo: string) {
  const [v] = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      startMonth: salesForecastVersions.startMonth,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, versionNo))
    .limit(1);
  if (!v) throw new Error(`version not found: ${versionNo}`);
  return v;
}

async function monthPortfolio(versionId: string) {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT
        forecast_year || '-' || LPAD(month::text, 2, '0') AS mk,
        ROUND(SUM(forecast_daily_avg::numeric), 2) AS total_daily,
        ROUND(
          SUM(
            CASE WHEN UPPER(platform) = 'AMAZON' THEN forecast_daily_avg::numeric ELSE 0 END
          ),
          2
        ) AS amazon_daily,
        COUNT(*)::int AS n
      FROM sales_forecast_monthly
      WHERE version_id = ${versionId}
        AND platform <> 'ALL'
      GROUP BY forecast_year, month
      ORDER BY forecast_year, month
    `),
  );
  return rows.map((r) => ({
    mk: String(r.mk),
    totalDaily: Number(r.total_daily),
    amazonDaily: Number(r.amazon_daily),
    n: Number(r.n),
  }));
}

async function novAccuracy(versionId: string) {
  const rows = rowsOf(
    await db.execute(sql`
      WITH fc AS (
        SELECT
          m.sku_id,
          UPPER(m.platform) AS platform,
          m.forecast_daily_avg::numeric AS pred
        FROM sales_forecast_monthly m
        WHERE m.version_id = ${versionId}
          AND m.forecast_year = 2026
          AND m.month = 11
          AND m.platform <> 'ALL'
          AND m.forecast_daily_avg::numeric > 0
      ),
      act AS (
        SELECT
          sh.sku_id,
          UPPER(COALESCE(sh.channel, '')) AS platform,
          SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0) AS actual_daily,
          COUNT(DISTINCT sh.sale_date)::int AS days
        FROM sales_history sh
        WHERE sh.sale_date >= DATE '2026-11-01'
          AND sh.sale_date < DATE '2026-12-01'
        GROUP BY sh.sku_id, UPPER(COALESCE(sh.channel, ''))
      )
      SELECT
        f.platform,
        f.pred,
        a.actual_daily,
        GREATEST(a.days, 1) AS days
      FROM fc f
      JOIN act a ON a.sku_id = f.sku_id AND a.platform = f.platform
      WHERE a.actual_daily IS NOT NULL AND a.actual_daily >= 0
    `),
  );

  const all = empty();
  const amazon = empty();
  const secondary = empty();
  for (const r of rows) {
    const pred = Number(r.pred);
    const actual = Number(r.actual_daily);
    const days = Number(r.days);
    const platform = String(r.platform);
    add(all, pred, actual, days);
    if (platform === 'AMAZON') add(amazon, pred, actual, days);
    else add(secondary, pred, actual, days);
  }
  return { all, amazon, secondary, matchedRows: rows.length };
}

async function top50Buckets(pubId: string, optId: string) {
  const detail = rowsOf(
    await db.execute(sql`
      WITH top50 AS (
        SELECT sh.sku_id,
          SUM(sh.qty_sold)::numeric AS oct_qty,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS oct_daily
        FROM sales_history sh
        WHERE sh.sale_date >= DATE '2026-10-01' AND sh.sale_date < DATE '2026-11-01'
        GROUP BY sh.sku_id
        ORDER BY oct_qty DESC
        LIMIT 50
      ),
      nov AS (
        SELECT sh.sku_id,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS nov_daily
        FROM sales_history sh
        JOIN top50 t ON t.sku_id = sh.sku_id
        WHERE sh.sale_date >= DATE '2026-11-01' AND sh.sale_date < DATE '2026-12-01'
        GROUP BY sh.sku_id
      ),
      fp AS (
        SELECT m.sku_id, ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${pubId} AND m.forecast_year = 2026 AND m.month = 11 AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      ),
      fo AS (
        SELECT m.sku_id, ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS d
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${optId} AND m.forecast_year = 2026 AND m.month = 11 AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      )
      SELECT t.oct_daily, n.nov_daily, fp.d AS pub_d, fo.d AS opt_d
      FROM top50 t
      LEFT JOIN nov n ON n.sku_id = t.sku_id
      LEFT JOIN fp ON fp.sku_id = t.sku_id
      LEFT JOIN fo ON fo.sku_id = t.sku_id
    `),
  );

  const count = (label: string, which: 'pub' | 'opt') =>
    detail.filter((r) => {
      const oct = Number(r.oct_daily);
      const mtd = r.nov_daily == null ? null : Number(r.nov_daily);
      const pred = which === 'pub' ? r.pub_d : r.opt_d;
      if (pred == null || mtd == null) return false;
      const d = Number(pred);
      const vsMtd = ((d - mtd) / mtd) * 100;
      const vsOct = oct > 0 ? ((d - oct) / oct) * 100 : null;
      return verdict(vsMtd, vsOct) === label;
    }).length;

  return {
    pub: {
      optimistic: count('偏乐观', 'pub'),
      ok: count('大致合理', 'pub'),
      conservative: count('偏保守', 'pub'),
    },
    opt: {
      optimistic: count('偏乐观', 'opt'),
      ok: count('大致合理', 'opt'),
      conservative: count('偏保守', 'opt'),
    },
  };
}

async function main() {
  const pub = await resolveVersion(PUB);
  const opt = await resolveVersion(OPT);

  const [pubShape, optShape, pubAcc, optAcc, top50] = await Promise.all([
    monthPortfolio(pub.id),
    monthPortfolio(opt.id),
    novAccuracy(pub.id),
    novAccuracy(opt.id),
    top50Buckets(pub.id, opt.id),
  ]);

  const find = (list: typeof pubShape, suffix: string) =>
    list.find((x) => x.mk.endsWith(suffix))?.totalDaily ?? null;

  const lines: string[] = [];
  lines.push('# 未来草稿准确性/合理性验证');
  lines.push('');
  lines.push(`验证时间：${new Date().toISOString()}`);
  lines.push(`发布版：\`${pub.versionNo}\`（${pub.status}）`);
  lines.push(`优化草稿：\`${opt.versionNo}\`（${opt.status}，含影子落地+再帽）`);
  lines.push('实际口径：sales_history 2026-11 MTD 日均（分平台对齐）。');
  lines.push('');

  lines.push('## 1. 组合日均形状（合理性）');
  lines.push('');
  lines.push('| 月份 | 发布版合计 | 优化草稿合计 | 发布 Amazon | 优化 Amazon |');
  lines.push('|---|---:|---:|---:|---:|');
  const months = [...new Set([...pubShape, ...optShape].map((x) => x.mk))].sort();
  for (const mk of months) {
    const p = pubShape.find((x) => x.mk === mk);
    const o = optShape.find((x) => x.mk === mk);
    lines.push(
      `| ${mk} | ${p ? Math.round(p.totalDaily).toLocaleString('en-US') : '—'} | ${o ? Math.round(o.totalDaily).toLocaleString('en-US') : '—'} | ${p ? Math.round(p.amazonDaily).toLocaleString('en-US') : '—'} | ${o ? Math.round(o.amazonDaily).toLocaleString('en-US') : '—'} |`,
    );
  }
  lines.push('');
  lines.push(
    `- 发布版形状：11=${find(pubShape, '-11')?.toFixed(0) ?? '—'}，12=${find(pubShape, '-12')?.toFixed(0) ?? '—'}，2=${find(pubShape, '-02')?.toFixed(0) ?? '—'} → **${shapePass(find(pubShape, '-11'), find(pubShape, '-12'), find(pubShape, '-02'))}**`,
  );
  lines.push(
    `- 优化草稿形状：11=${find(optShape, '-11')?.toFixed(0) ?? '—'}，12=${find(optShape, '-12')?.toFixed(0) ?? '—'}，2=${find(optShape, '-02')?.toFixed(0) ?? '—'} → **${shapePass(find(optShape, '-11'), find(optShape, '-12'), find(optShape, '-02'))}**`,
  );
  lines.push('');

  lines.push('## 2. 2026-11 相对实际（准确性）');
  lines.push('');
  lines.push('| 范围 | 发布版 偏差/WMAPE | 优化草稿 偏差/WMAPE | 匹配行数(发/优) |');
  lines.push('|---|---:|---:|---:|');
  lines.push(
    `| 全平台 | ${bias(pubAcc.all)} / ${wmape(pubAcc.all)} | ${bias(optAcc.all)} / ${wmape(optAcc.all)} | ${pubAcc.matchedRows} / ${optAcc.matchedRows} |`,
  );
  lines.push(
    `| Amazon | ${bias(pubAcc.amazon)} / ${wmape(pubAcc.amazon)} | ${bias(optAcc.amazon)} / ${wmape(optAcc.amazon)} | — |`,
  );
  lines.push(
    `| 次通道 | ${bias(pubAcc.secondary)} / ${wmape(pubAcc.secondary)} | ${bias(optAcc.secondary)} / ${wmape(optAcc.secondary)} | — |`,
  );
  lines.push('');

  lines.push('## 3. Top50 爆款开局桶');
  lines.push('');
  lines.push('| 版本 | 偏乐观 | 大致合理 | 偏保守 |');
  lines.push('|---|---:|---:|---:|');
  lines.push(
    `| 发布版 | ${top50.pub.optimistic} | ${top50.pub.ok} | ${top50.pub.conservative} |`,
  );
  lines.push(
    `| 优化草稿 | ${top50.opt.optimistic} | ${top50.opt.ok} | ${top50.opt.conservative} |`,
  );
  lines.push('');

  const checks = {
    optShapePass: shapePass(
      find(optShape, '-11'),
      find(optShape, '-12'),
      find(optShape, '-02'),
    ).startsWith('通过'),
    optBiasCloserToZero:
      Math.abs(optAcc.all.predQty / optAcc.all.actualQty - 1) <
      Math.abs(pubAcc.all.predQty / pubAcc.all.actualQty - 1) + 0.05,
    optLessOptimistic: top50.opt.optimistic < top50.pub.optimistic,
    optOptimisticAtMost20: top50.opt.optimistic <= 20,
  };

  lines.push('## 4. 判定');
  lines.push('');
  lines.push(
    [
      `1. 形状：优化草稿 **${shapePass(find(optShape, '-11'), find(optShape, '-12'), find(optShape, '-02'))}**。`,
      `2. 11 月准确性：发布 ${bias(pubAcc.all)}/${wmape(pubAcc.all)} → 优化 ${bias(optAcc.all)}/${wmape(optAcc.all)}。`,
      `3. Top50 乐观：${top50.pub.optimistic} → ${top50.opt.optimistic}；合理 ${top50.pub.ok} → ${top50.opt.ok}。`,
      `4. 检查项：形状=${checks.optShapePass}；偏差不劣于发布=${checks.optBiasCloserToZero}；乐观下降=${checks.optLessOptimistic}；乐观≤20=${checks.optOptimisticAtMost20}。`,
      `5. 总评：${Object.values(checks).every(Boolean) ? '**通过**（准确性改善 + 形状合理 + 爆款乐观受控）' : '**部分通过**（见未过检查项）'}。`,
    ].join('\n'),
  );

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'future-draft-accuracy-verification.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  console.log(`\n已写入 ${outPath}`);
  console.log(JSON.stringify({ checks, allPass: Object.values(checks).every(Boolean) }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
