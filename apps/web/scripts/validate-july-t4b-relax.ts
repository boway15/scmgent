/**
 * T4B+T99 方案 A 常量复盘：用已发布版本 7 月行的 horizon_factors + 新版 T4B/T99 公式，
 * 离线复算系统日均，对比实际销量，输出分层 WMAPE / 偏差报告（不写库）。
 *
 * Usage: pnpm --filter @scm/web exec tsx scripts/validate-july-t4b-relax.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  applyPeerPlatformNearFloor,
  computeAllCatV41BoundedDaily,
  V41_T4B_CONSERVATIVE_FACTOR,
  V41_T4B_NEAR_CONSERVATIVE_FACTOR,
  V41_T4B_RECENT30_CAP,
  V41_T4B_RECENT90_CAP,
  type AllCatV41Metrics,
  type AllCatV41Tier,
} from '../server/lib/forecast-allcat-v41.js';
import { T99_SYSTEM_FLOOR_DISCOUNT } from '../server/lib/forecast-demand.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

type Row = {
  sku_code: string;
  platform: string;
  segment: string;
  abcd: string;
  blend_d: number;
  old_system_d: number;
  actual_m: number;
  factors: string | null;
};

function q(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'scm-agent-postgres-1', 'psql', '-U', 'scm', '-d', 'scm_dev', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

function parseFactors(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const once = JSON.parse(raw);
    if (typeof once === 'string') return JSON.parse(once);
    return once as Record<string, unknown>;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function recompute(row: Row): number {
  const factors = parseFactors(row.factors);
  const tier = (row.segment || 'T4B') as AllCatV41Tier;

  const metrics: AllCatV41Metrics = {
    q1: num(factors?.q1),
    q3: num(factors?.q3),
    q6: num(factors?.q6),
    q12: num(factors?.q12),
    d2: num(factors?.d2, num(factors?.d3)),
    d3: num(factors?.d3),
    d6: num(factors?.d6),
    d12: num(factors?.d12),
    active2: Math.round(num(factors?.active2)),
    active6: Math.round(num(factors?.active6)),
    active12: Math.round(num(factors?.active12)),
    cv6: num(factors?.cv6),
    trendRatio: num(factors?.trendRatio, 1),
  };

  const productCategory = String(factors?.productCategory ?? row.abcd ?? 'C');
  const recent30 = num(factors?.recent30DailyAvg, null as unknown as number);
  const recent90 = num(factors?.recent90DailyAvg, null as unknown as number);
  const baseDaily = row.blend_d > 0 ? row.blend_d : num(factors?.levelDaily, row.old_system_d);

  const bounded = computeAllCatV41BoundedDaily({
    tier,
    baseDaily,
    productCategory,
    forecastMonth: 7,
    horizonIndex: 0,
    metrics,
    recent30DailyAvg: Number.isFinite(recent30) ? recent30 : null,
    recent90DailyAvg: Number.isFinite(recent90) ? recent90 : null,
  });

  // 同 SKU 其他平台近端：用同 sku 在 AMAZON 的实际日均作 peer 近似（复盘用）
  return bounded.forecastDaily;
}

function wmape(rows: Array<{ system: number; actualD: number }>): number | null {
  let abs = 0;
  let act = 0;
  for (const r of rows) {
    if (r.actualD <= 0) continue;
    abs += Math.abs(r.system - r.actualD);
    act += r.actualD;
  }
  return act > 0 ? abs / act : null;
}

function bias(rows: Array<{ system: number; actualM: number }>): number | null {
  let s = 0;
  let a = 0;
  for (const r of rows) {
    s += r.system * 31;
    a += r.actualM;
  }
  return a > 0 ? s / a - 1 : null;
}

function main() {
  console.log('constants', {
    T4B_near: V41_T4B_NEAR_CONSERVATIVE_FACTOR,
    T4B_far: V41_T4B_CONSERVATIVE_FACTOR,
    T4B_r30_cap: V41_T4B_RECENT30_CAP,
    T4B_r90_cap: V41_T4B_RECENT90_CAP,
    T99_discount: T99_SYSTEM_FLOOR_DISCOUNT,
  });

  const json = q(`
    SELECT json_agg(t)
    FROM (
      SELECT
        s.code AS sku_code,
        sfm.platform,
        COALESCE(sfm.profile_segment, '?') AS segment,
        COALESCE(sfm.forecast_profile_class, '?') AS abcd,
        sfm.baseline_daily_avg::float8 AS blend_d,
        sfm.forecast_daily_avg::float8 AS old_system_d,
        COALESCE(act.qty_sold, 0)::float8 AS actual_m,
        sfm.horizon_factors::text AS factors
      FROM sales_forecast_monthly sfm
      JOIN skus s ON s.id = sfm.sku_id
      JOIN sales_forecast_versions v ON v.id = sfm.version_id
      LEFT JOIN sales_history_monthly act
        ON act.sku_id = sfm.sku_id AND act.channel = sfm.platform
       AND act.sale_year = 2026 AND act.month = 7
      WHERE sfm.forecast_year = 2026 AND sfm.month = 7
        AND v.status = 'published'
        AND sfm.forecast_daily_avg::numeric > 0
    ) t
  `);

  const rows = JSON.parse(json) as Row[];
  const rescored = rows.map((row) => {
    const newSystem = recompute(row);
    const actualD = row.actual_m / 31;
    return {
      ...row,
      new_system_d: newSystem,
      actualD,
    };
  });

  const bySeg = new Map<string, typeof rescored>();
  for (const r of rescored) {
    const list = bySeg.get(r.segment) ?? [];
    list.push(r);
    bySeg.set(r.segment, list);
  }

  const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);

  console.log('=== 7 月复盘：旧系统 vs T4B+T99 方案 A（离线重算）===\n');
  console.log(
    [
      '分层'.padEnd(6),
      '行数'.padStart(6),
      '旧WMAPE'.padStart(10),
      '新WMAPE'.padStart(10),
      '旧偏差'.padStart(10),
      '新偏差'.padStart(10),
    ].join(' '),
  );

  for (const [seg, list] of [...bySeg.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const oldW = wmape(list.map((r) => ({ system: r.old_system_d, actualD: r.actualD })));
    const newW = wmape(list.map((r) => ({ system: r.new_system_d, actualD: r.actualD })));
    const oldB = bias(list.map((r) => ({ system: r.old_system_d, actualM: r.actual_m })));
    const newB = bias(list.map((r) => ({ system: r.new_system_d, actualM: r.actual_m })));
    console.log(
      [
        seg.padEnd(6),
        String(list.length).padStart(6),
        pct(oldW).padStart(10),
        pct(newW).padStart(10),
        pct(oldB).padStart(10),
        pct(newB).padStart(10),
      ].join(' '),
    );
  }

  const oldW = wmape(rescored.map((r) => ({ system: r.old_system_d, actualD: r.actualD })));
  const newW = wmape(rescored.map((r) => ({ system: r.new_system_d, actualD: r.actualD })));
  const oldB = bias(rescored.map((r) => ({ system: r.old_system_d, actualM: r.actual_m })));
  const newB = bias(rescored.map((r) => ({ system: r.new_system_d, actualM: r.actual_m })));
  console.log('\n全体', `旧WMAPE=${pct(oldW)} 新WMAPE=${pct(newW)} 旧偏差=${pct(oldB)} 新偏差=${pct(newB)}`);

  // T99 漏报覆盖：系统=0 但仍有实际
  const t99Miss = q(`
    SELECT COUNT(*)::int, COALESCE(SUM(act.qty_sold),0)::bigint
    FROM sales_forecast_monthly sfm
    JOIN sales_forecast_versions v ON v.id = sfm.version_id
    JOIN sales_history_monthly act
      ON act.sku_id = sfm.sku_id AND act.channel = sfm.platform
     AND act.sale_year = 2026 AND act.month = 7
    WHERE sfm.forecast_year = 2026 AND sfm.month = 7 AND v.status = 'published'
      AND sfm.forecast_daily_avg::numeric = 0 AND act.qty_sold > 0
      AND COALESCE(sfm.profile_segment,'') = 'T99'
  `);
  const [t99Rows, t99Qty] = t99Miss.split('|');
  console.log(`\nT99 漏报（系统=0 有实际）: ${t99Rows} 行, 实际月销量 ${t99Qty}（补货侧 t99_fallback 覆盖）`);

  // peer floor smoke on known July underforecast
  const peerDemo = applyPeerPlatformNearFloor({
    forecastDaily: 0.23,
    horizonIndex: 0,
    peerPlatformRecentDaily: 20,
  });
  console.log(`\n跨平台抬底样例: 0.23 + peer20 → ${peerDemo.forecastDaily} (floor=${peerDemo.peerPlatformFloor})`);
}

main();
