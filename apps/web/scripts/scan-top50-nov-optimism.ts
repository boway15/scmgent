/**
 * Top50（按 2026-10 销量）vs 11月MTD实际 vs 预测日均，输出乐观度扫描
 * pnpm --filter @scm/web exec tsx scripts/scan-top50-nov-optimism.ts
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const PUBLISHED = process.env.TOP50_BASELINE_VERSION || 'DRAFT-1793959940865';
const DRAFT = process.env.TOP50_COMPARE_VERSION || 'DRAFT-1794197424316';

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function pct(pred: number, base: number): number | null {
  if (!(base > 0) || !Number.isFinite(pred)) return null;
  return ((pred - base) / base) * 100;
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function verdict(vsMtd: number | null, vsOct: number | null): string {
  const a = vsMtd ?? 0;
  const b = vsOct ?? 0;
  if (a >= 30 || (a >= 20 && b >= 30)) return '偏乐观';
  if (a <= -20 || (a <= -15 && b <= -20)) return '偏保守';
  return '大致合理';
}

async function main() {
  const [pub] = await db
    .select({ id: salesForecastVersions.id })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, PUBLISHED))
    .limit(1);
  const [draft] = await db
    .select({ id: salesForecastVersions.id })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, DRAFT))
    .limit(1);
  if (!pub || !draft) throw new Error('versions not found');

  const rows = rowsOf(
    await db.execute(sql`
      WITH top50 AS (
        SELECT sh.sku_id,
          SUM(sh.qty_sold)::numeric AS oct_qty,
          COUNT(DISTINCT sh.sale_date)::int AS oct_days,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS oct_daily
        FROM sales_history sh
        WHERE sh.sale_date >= DATE '2026-10-01'
          AND sh.sale_date < DATE '2026-11-01'
        GROUP BY sh.sku_id
        ORDER BY oct_qty DESC
        LIMIT 50
      ),
      nov AS (
        SELECT sh.sku_id,
          SUM(sh.qty_sold)::numeric AS nov_qty,
          COUNT(DISTINCT sh.sale_date)::int AS nov_days,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS nov_daily
        FROM sales_history sh
        JOIN top50 t ON t.sku_id = sh.sku_id
        WHERE sh.sale_date >= DATE '2026-11-01'
          AND sh.sale_date < DATE '2026-12-01'
        GROUP BY sh.sku_id
      ),
      nov_amz AS (
        SELECT sh.sku_id,
          ROUND(SUM(sh.qty_sold)::numeric / NULLIF(COUNT(DISTINCT sh.sale_date), 0), 2) AS nov_amz_daily
        FROM sales_history sh
        JOIN top50 t ON t.sku_id = sh.sku_id
        WHERE sh.sale_date >= DATE '2026-11-01'
          AND sh.sale_date < DATE '2026-12-01'
          AND UPPER(COALESCE(sh.channel, '')) = 'AMAZON'
        GROUP BY sh.sku_id
      ),
      fc_pub AS (
        SELECT m.sku_id,
          ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS pub_nov_daily,
          ROUND(SUM(CASE WHEN UPPER(m.platform) = 'AMAZON' THEN m.forecast_daily_avg::numeric ELSE 0 END), 2) AS pub_nov_amz
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${pub.id}
          AND m.forecast_year = 2026 AND m.month = 11
          AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      ),
      fc_draft AS (
        SELECT m.sku_id,
          ROUND(SUM(m.forecast_daily_avg::numeric), 2) AS draft_nov_daily,
          ROUND(SUM(CASE WHEN UPPER(m.platform) = 'AMAZON' THEN m.forecast_daily_avg::numeric ELSE 0 END), 2) AS draft_nov_amz,
          ROUND(SUM(CASE WHEN UPPER(m.platform) = 'WALMART' THEN m.forecast_daily_avg::numeric ELSE 0 END), 2) AS draft_nov_walmart
        FROM sales_forecast_monthly m
        JOIN top50 t ON t.sku_id = m.sku_id
        WHERE m.version_id = ${draft.id}
          AND m.forecast_year = 2026 AND m.month = 11
          AND m.platform <> 'ALL'
        GROUP BY m.sku_id
      )
      SELECT
        s.code,
        LEFT(s.name, 40) AS name,
        s.project_group,
        ROUND(t.oct_qty, 0) AS oct_qty,
        t.oct_daily,
        COALESCE(n.nov_days, 0) AS nov_days,
        COALESCE(ROUND(n.nov_qty, 0), 0) AS nov_qty,
        n.nov_daily,
        na.nov_amz_daily,
        fp.pub_nov_daily,
        fp.pub_nov_amz,
        fd.draft_nov_daily,
        fd.draft_nov_amz,
        fd.draft_nov_walmart,
        RANK() OVER (ORDER BY t.oct_qty DESC)::int AS rnk
      FROM top50 t
      JOIN skus s ON s.id = t.sku_id
      LEFT JOIN nov n ON n.sku_id = t.sku_id
      LEFT JOIN nov_amz na ON na.sku_id = t.sku_id
      LEFT JOIN fc_pub fp ON fp.sku_id = t.sku_id
      LEFT JOIN fc_draft fd ON fd.sku_id = t.sku_id
      ORDER BY t.oct_qty DESC
    `),
  );

  type RowOut = {
    rnk: number;
    code: string;
    name: string;
    projectGroup: string;
    octDaily: number;
    novMtdDaily: number | null;
    pubNov: number | null;
    draftNov: number | null;
    vsMtdPub: number | null;
    vsOctPub: number | null;
    vsMtdDraft: number | null;
    vsOctDraft: number | null;
    draftWalmart: number | null;
    verdictPub: string;
    verdictDraft: string;
  };

  const out: RowOut[] = rows.map((r) => {
    const octDaily = Number(r.oct_daily ?? 0);
    const novMtd = r.nov_daily == null ? null : Number(r.nov_daily);
    const pubNov = r.pub_nov_daily == null ? null : Number(r.pub_nov_daily);
    const draftNov = r.draft_nov_daily == null ? null : Number(r.draft_nov_daily);
    const vsMtdPub = pubNov == null || novMtd == null ? null : pct(pubNov, novMtd);
    const vsOctPub = pubNov == null ? null : pct(pubNov, octDaily);
    const vsMtdDraft = draftNov == null || novMtd == null ? null : pct(draftNov, novMtd);
    const vsOctDraft = draftNov == null ? null : pct(draftNov, octDaily);
    return {
      rnk: Number(r.rnk),
      code: String(r.code),
      name: String(r.name ?? ''),
      projectGroup: String(r.project_group ?? ''),
      octDaily,
      novMtdDaily: novMtd,
      pubNov,
      draftNov,
      vsMtdPub,
      vsOctPub,
      vsMtdDraft,
      vsOctDraft,
      draftWalmart: r.draft_nov_walmart == null ? null : Number(r.draft_nov_walmart),
      verdictPub: verdict(vsMtdPub, vsOctPub),
      verdictDraft: verdict(vsMtdDraft, vsOctDraft),
    };
  });

  const summary = {
    n: out.length,
    pub: {
      optimistic: out.filter((x) => x.verdictPub === '偏乐观').length,
      ok: out.filter((x) => x.verdictPub === '大致合理').length,
      conservative: out.filter((x) => x.verdictPub === '偏保守').length,
      missingFc: out.filter((x) => x.pubNov == null).length,
      missingMtd: out.filter((x) => x.novMtdDaily == null).length,
    },
    draft: {
      optimistic: out.filter((x) => x.verdictDraft === '偏乐观').length,
      ok: out.filter((x) => x.verdictDraft === '大致合理').length,
      conservative: out.filter((x) => x.verdictDraft === '偏保守').length,
    },
  };

  const lines: string[] = [];
  lines.push('# Top50 爆款：2026-11 预测 vs 实际开局扫描');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('口径：Top50 = 2026-10 全渠道销量；实际 = 2026-11-01～最大有销日 MTD 日均；预测 = 分平台日均合计（11月）。');
  lines.push(
    `基线：\`${PUBLISHED}\`；对比：\`${DRAFT}\`（影子→重塑→衰减后 + 落地后再帽 max(recent30,d6)×1.10）。`,
  );
  lines.push('');
  lines.push('判定：相对 MTD ≥+30%（或 ≥+20% 且相对10月≥+30%）→ 偏乐观；相对 MTD ≤-20%（或 ≤-15% 且相对10月≤-20%）→ 偏保守；其余大致合理。');
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(`| 版本 | 偏乐观 | 大致合理 | 偏保守 |`);
  lines.push(`|---|---:|---:|---:|`);
  lines.push(
    `| 发布版 | ${summary.pub.optimistic} | ${summary.pub.ok} | ${summary.pub.conservative} |`,
  );
  lines.push(
    `| 新草稿 | ${summary.draft.optimistic} | ${summary.draft.ok} | ${summary.draft.conservative} |`,
  );
  lines.push('');
  lines.push('## 偏乐观清单（按发布版）');
  lines.push('');
  lines.push('| # | SKU | 10月日均 | 11月MTD | 发布预测 | vsMTD | vs10月 | 草稿预测 | vsMTD | 判定 |');
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const x of out.filter((r) => r.verdictPub === '偏乐观')) {
    lines.push(
      `| ${x.rnk} | ${x.code} | ${x.octDaily} | ${x.novMtdDaily ?? '—'} | ${x.pubNov ?? '—'} | ${fmtPct(x.vsMtdPub)} | ${fmtPct(x.vsOctPub)} | ${x.draftNov ?? '—'} | ${fmtPct(x.vsMtdDraft)} | ${x.verdictPub} |`,
    );
  }
  lines.push('');
  lines.push('## 偏保守清单（按发布版）');
  lines.push('');
  lines.push('| # | SKU | 10月日均 | 11月MTD | 发布预测 | vsMTD | vs10月 | 草稿预测 | vsMTD | 判定 |');
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const x of out.filter((r) => r.verdictPub === '偏保守')) {
    lines.push(
      `| ${x.rnk} | ${x.code} | ${x.octDaily} | ${x.novMtdDaily ?? '—'} | ${x.pubNov ?? '—'} | ${fmtPct(x.vsMtdPub)} | ${fmtPct(x.vsOctPub)} | ${x.draftNov ?? '—'} | ${fmtPct(x.vsMtdDraft)} | ${x.verdictPub} |`,
    );
  }
  lines.push('');
  lines.push('## Top50 全表');
  lines.push('');
  lines.push('| # | SKU | 项目组 | 10月日均 | 11月MTD | 发布11月 | vsMTD | vs10月 | 草稿11月 | vsMTD | 发布判定 |');
  lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const x of out) {
    lines.push(
      `| ${x.rnk} | ${x.code} | ${x.projectGroup} | ${x.octDaily} | ${x.novMtdDaily ?? '—'} | ${x.pubNov ?? '—'} | ${fmtPct(x.vsMtdPub)} | ${fmtPct(x.vsOctPub)} | ${x.draftNov ?? '—'} | ${fmtPct(x.vsMtdDraft)} | ${x.verdictPub} |`,
    );
  }
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(
    [
      `1. 基线 Top50：**偏乐观 ${summary.pub.optimistic} / 大致合理 ${summary.pub.ok} / 偏保守 ${summary.pub.conservative}**。`,
      `2. 对比草稿 Top50：**偏乐观 ${summary.draft.optimistic} / 大致合理 ${summary.draft.ok} / 偏保守 ${summary.draft.conservative}**（相对基线乐观数变化：${summary.draft.optimistic - summary.pub.optimistic}）。`,
      '3. 补货建议：仍偏乐观的 SKU 优先人工复核（尤其次通道）；偏保守关注断货。',
      '4. 窗口仍短，黑五前可再扫一轮。',
    ].join('\n'),
  );

  const outDir = resolve(ROOT, 'docs/samples/forecast-backtest');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'top50-nov2026-optimism-scan.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
  console.log(`\n已写入 ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
