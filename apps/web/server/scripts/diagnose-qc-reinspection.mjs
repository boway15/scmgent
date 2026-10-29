import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../../../.env') });
config({ path: join(__dirname, '../../.env') });

const { listAllRecords, extractFieldValue } = await import('../integrations/feishu-bitable.js');
const { getQcReinspectionConfig } = await import('../lib/qc-reinspection-sync.js');
const { collectFactoryWhitelist } = await import('../lib/qc-reinspection-plan.js');

const cfg = getQcReinspectionConfig();
console.log('config', cfg);

const textOf = (fields, name) => extractFieldValue(fields[name]);

const [targetRecords, sourceRecords] = await Promise.all([
  listAllRecords(cfg.appToken, cfg.targetTableId, 'qc-reinspection'),
  listAllRecords(cfg.appToken, cfg.sourceTableId, 'qc-reinspection', {
    displayFormulaRef: true,
    viewId: cfg.sourceViewId,
  }),
]);

const fromTarget = collectFactoryWhitelist(
  targetRecords.map((r) => ({
    factoryName: textOf(r.fields, '文本'),
    sourceRecordId: textOf(r.fields, '来源记录ID'),
  })),
);

const placeholders = targetRecords.filter((r) => !textOf(r.fields, '来源记录ID').trim());
const sourceFactories = [
  ...new Set(sourceRecords.map((r) => textOf(r.fields, '工厂名称').trim()).filter(Boolean)),
];

console.log('target total', targetRecords.length);
console.log('placeholder rows (no 来源记录ID)', placeholders.length);
for (const r of placeholders.slice(0, 15)) {
  console.log('--- record', r.record_id);
  console.log('  文本=', JSON.stringify(textOf(r.fields, '文本')));
  const factoryLike = Object.keys(r.fields).filter(
    (k) => k.includes('文本') || k.includes('工厂') || k.includes('名称'),
  );
  for (const k of factoryLike) {
    console.log(`  ${k}=`, JSON.stringify(textOf(r.fields, k)).slice(0, 120));
  }
}
console.log('fromTarget whitelist', fromTarget);
console.log('source view records', sourceRecords.length);
console.log('distinct 工厂名称 in source', sourceFactories.length);
console.log(sourceFactories.join('\n'));
