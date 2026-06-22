import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOB_FEE_RULE_SEEDS } from '../src/seed-fob-rules.js';

function esc(value: string | undefined | null): string {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

const lines: string[] = [
  `-- FOB fee rules seed: ${FOB_FEE_RULE_SEEDS.length} rows`,
  '-- Table: fob_fee_allocation_rules',
  '-- Prerequisite: 0012_fob_multi_allocation.sql',
  '-- Idempotent: skips rows that already exist (same source_bill_type + fee_type or match_pattern)',
  '',
];

for (const rule of FOB_FEE_RULE_SEEDS) {
  const fee = esc(rule.feeType);
  const pat = esc(rule.matchPattern);
  const remark = esc(rule.remark);
  const exists =
    rule.feeType != null
      ? `EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = ${esc(rule.sourceBillType)} AND r.fee_type = ${fee} AND r.match_pattern IS NULL)`
      : `EXISTS (SELECT 1 FROM fob_fee_allocation_rules r WHERE r.source_bill_type = ${esc(rule.sourceBillType)} AND r.match_pattern = ${pat} AND r.fee_type IS NULL)`;

  lines.push(`INSERT INTO fob_fee_allocation_rules (fee_type, source_bill_type, match_pattern, allocation_method, default_stage, priority, is_active, remark)`);
  lines.push(
    `SELECT ${fee}, ${esc(rule.sourceBillType)}, ${pat}, ${esc(rule.allocationMethod)}, ${esc(rule.defaultStage)}, ${rule.priority}, true, ${remark}`,
  );
  lines.push(`WHERE NOT ${exists};`);
  lines.push('');
}

const outPath = resolve(import.meta.dirname, '../../../docs/sql/seed-fob-fee-rules.sql');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${FOB_FEE_RULE_SEEDS.length} rules to ${outPath}`);
