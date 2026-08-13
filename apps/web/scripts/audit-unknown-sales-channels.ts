/**
 * 盘点 sales_history(_monthly) 中 UNKNOWN 渠道占比，并打印可映射建议。
 * Usage: pnpm --filter @scm/web exec tsx scripts/audit-unknown-sales-channels.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  assessUnknownChannelShare,
  normalizeSalesPlatformSync,
} from '../server/lib/sales-platform.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

function q(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'scm-agent-postgres-1', 'psql', '-U', 'scm', '-d', 'scm_dev', '-t', '-A', '-F', '|', '-c', sql],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).trim();
}

function main() {
  console.log('=== UNKNOWN 渠道盘点（2026-07 月表）===\n');
  const summary = q(`
    SELECT
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE channel = 'UNKNOWN')::int,
      COALESCE(SUM(qty_sold),0)::bigint,
      COALESCE(SUM(qty_sold) FILTER (WHERE channel = 'UNKNOWN'),0)::bigint
    FROM sales_history_monthly
    WHERE sale_year = 2026 AND month = 7
  `);
  const [totalRows, unknownRows, totalQty, unknownQty] = summary.split('|').map(Number);
  const assessed = assessUnknownChannelShare({ totalRows, unknownRows });
  console.log(`行数: ${unknownRows}/${totalRows} (${(assessed.ratio * 100).toFixed(1)}%)`);
  console.log(`销量: ${unknownQty}/${totalQty}`);
  if (assessed.warning) console.log(`告警: ${assessed.warning}`);

  console.log('\n静态别名自检（常见脏值）:');
  for (const raw of ['Amazon US', 'TikTok Shop', 'AMZ', 'WM', 'Shopify', '独立站', '乱七八糟平台']) {
    console.log(`  ${raw} -> ${normalizeSalesPlatformSync(raw)}`);
  }

  console.log('\n回刷命令: pnpm --filter @scm/web exec tsx scripts/backfill-sales-history-channel.ts [--dry-run]');
  console.log('若仍有 UNKNOWN：向 sales_platform_aliases 补 alias 后重跑回刷。');
}

main();
