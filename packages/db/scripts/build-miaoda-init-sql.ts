/**
 * 合并迁移 + seed 为单个 SQL，供妙搭新建应用时一次执行。
 * 产出：docs/sql/miaoda-init-all.sql（随 zip:miaoda 打入 drizzle/）
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const drizzleDir = join(repoRoot, 'packages/db/drizzle');
const docsSqlDir = join(repoRoot, 'docs/sql');
const outPath = join(docsSqlDir, 'miaoda-init-all.sql');

/** 与 docs/miaoda-import-checklist.md 第五节顺序一致 */
const MIGRATION_FILES = [
  '0000_naive_cyclops.sql',
  '0001_purchase_drafts.sql',
  '0002_fob_settlement.sql',
  '0003_plan_merchant_inventory.sql',
  '0004_remove_pmc_import_menu.sql',
  '0005_warehouses_multichannel.sql',
  '0006_product_master_data.sql',
  '0007_product_master_menu.sql',
  '0008_stock_alerts_warehouse.sql',
  '0009_dashboard_compliance_menus.sql',
  '0010_replenish_light.sql',
  '0011_spu_moq.sql',
  '0011_help_center_menu.sql',
  '0012_fob_multi_allocation.sql',
  '0013_fob_settlement_split_v2.sql',
  '0014_p0_ops.sql',
  '0015_drop_fob_bill_format.sql',
  '0016_remove_compliance.sql',
];

const SEED_FILES = ['miaoda-seed-roles-menus.sql', 'seed-fob-fee-rules.sql'];

function readSection(label: string, filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Missing SQL file: ${filePath}`);
  }
  const body = readFileSync(filePath, 'utf8').trim();
  return [
    '',
    '-- ============================================================',
    `-- ${label}`,
    `-- source: ${filePath.replace(repoRoot, '').replace(/\\/g, '/')}`,
    '-- ============================================================',
    '',
    body,
    '',
  ].join('\n');
}

const header = `-- scm-agent 妙搭新建应用 · 数据库一键初始化
-- 生成: pnpm miaoda:init-sql
-- 用法: 妙搭「数据库 → SQL 执行」粘贴本文件全文并运行（约 2–5 分钟）
-- 注意: 仅用于空库首次初始化；已有数据的库勿重复执行
-- 可选演示数据: drizzle/patch_furniture_names.sql（本文件不含）

BEGIN;
`;

const parts: string[] = [header];

for (const name of MIGRATION_FILES) {
  parts.push(readSection(`migration: ${name}`, join(drizzleDir, name)));
}

for (const name of SEED_FILES) {
  parts.push(readSection(`seed: ${name}`, join(docsSqlDir, name)));
}

parts.push(`
COMMIT;

-- 验证（可选，单独执行）:
-- SELECT count(*) FROM roles;
-- SELECT email FROM users WHERE email = 'admin@scm.local';
-- SELECT count(*) FROM fob_fee_allocation_rules;
`);

writeFileSync(outPath, parts.join('\n'), 'utf8');
console.log(`Wrote ${outPath} (${parts.join('\n').length} chars)`);
