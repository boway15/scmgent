/**
 * 补齐常见脏渠道别名到 sales_platform_aliases，并可选回刷历史 channel。
 * Usage:
 *   pnpm --filter @scm/web exec tsx scripts/seed-sales-platform-aliases.ts
 *   pnpm --filter @scm/web exec tsx scripts/seed-sales-platform-aliases.ts --backfill
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '@scm/db';
import { clearSalesPlatformCache } from '../server/lib/sales-platform.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const ALIASES: Array<{ alias: string; platformCode: string }> = [
  { alias: 'Amazon US', platformCode: 'AMAZON' },
  { alias: 'Amazon.com', platformCode: 'AMAZON' },
  { alias: 'AMAZON-US', platformCode: 'AMAZON' },
  { alias: 'AMZ', platformCode: 'AMAZON' },
  { alias: 'TikTok Shop', platformCode: 'TIKTOK' },
  { alias: 'Tik Tok', platformCode: 'TIKTOK' },
  { alias: 'TT', platformCode: 'TIKTOK' },
  { alias: 'WM', platformCode: 'WALMART' },
  { alias: 'Wal-Mart', platformCode: 'WALMART' },
];

async function main() {
  for (const row of ALIASES) {
    await db.execute(sql`
      INSERT INTO sales_platform_aliases (alias, platform_code)
      VALUES (${row.alias}, ${row.platformCode})
      ON CONFLICT (alias) DO UPDATE SET platform_code = EXCLUDED.platform_code
    `);
  }
  clearSalesPlatformCache();
  console.log(`seeded ${ALIASES.length} aliases`);

  if (process.argv.includes('--backfill')) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'scripts/backfill-sales-history-channel.ts'],
      { cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', shell: true },
    );
    process.exit(r.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
