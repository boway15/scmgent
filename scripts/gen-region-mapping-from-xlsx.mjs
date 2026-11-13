/**
 * 从「站点、仓库对应区域.xlsx」生成：
 * - docs/samples/station-sales-region-map.csv
 * - docs/samples/warehouse-fulfillment-region-map.csv
 * - packages/db/drizzle/0146_region_mapping_full_seed.sql（可选 --sql）
 *
 * 站点键 = SiteNameCN（与销量导入 station 一致）；仓库键 = StoreName（与库存仓码一致）。
 * 业务表中的 OT / 未纳入 MAPPABLE_REGIONS 的区域码 → OTHER。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const XLSX = require('xlsx');
const MAPPABLE = new Set(['US', 'CA', 'EU', 'UK', 'MX', 'BR', 'OTHER']);

const defaultXlsx = path.join(
  process.env.USERPROFILE ?? '',
  'Desktop',
  '站点、仓库对应区域.xlsx',
);
const writeSql = process.argv.includes('--sql');
const xlsxArg = process.argv.slice(2).find((a) => a !== '--sql' && !a.startsWith('-'));
const xlsxPath = xlsxArg ? path.resolve(xlsxArg) : defaultXlsx;

function mapRegion(raw) {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (code === 'OT') return 'OTHER';
  if (MAPPABLE.has(code)) return code;
  return 'OTHER';
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function readSheet(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`工作表不存在: ${name}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

if (!fs.existsSync(xlsxPath)) {
  console.error('找不到 Excel:', xlsxPath);
  process.exit(1);
}

const wb = XLSX.readFile(xlsxPath);
const stationRows = readSheet(wb, '站点区域');
const warehouseRows = readSheet(wb, '仓库区域');

const stations = [];
const stationSeen = new Set();
for (const row of stationRows) {
  const station = String(row.SiteNameCN ?? '').trim();
  if (!station || stationSeen.has(station)) continue;
  stationSeen.add(station);
  stations.push({ station, sales_region: mapRegion(row.RegionNameEn) });
}
stations.sort((a, b) => a.station.localeCompare(b.station, 'zh'));

const warehouses = [];
const warehouseSeen = new Set();
for (const row of warehouseRows) {
  const warehouse_code = String(row.StoreName ?? '').trim();
  if (!warehouse_code || warehouseSeen.has(warehouse_code)) continue;
  warehouseSeen.add(warehouse_code);
  warehouses.push({
    warehouse_code,
    fulfillment_region: mapRegion(row.RegionNameEn),
  });
}
warehouses.sort((a, b) => a.warehouse_code.localeCompare(b.warehouse_code, 'zh'));

const stationCsv =
  'station,sales_region\n' +
  stations.map((r) => `${csvCell(r.station)},${r.sales_region}`).join('\n') +
  '\n';
const warehouseCsv =
  'warehouse_code,fulfillment_region\n' +
  warehouses.map((r) => `${csvCell(r.warehouse_code)},${r.fulfillment_region}`).join('\n') +
  '\n';

const samplesDir = path.join(root, 'docs/samples');
fs.mkdirSync(samplesDir, { recursive: true });
fs.writeFileSync(path.join(samplesDir, 'station-sales-region-map.csv'), stationCsv, 'utf8');
fs.writeFileSync(path.join(samplesDir, 'warehouse-fulfillment-region-map.csv'), warehouseCsv, 'utf8');

if (writeSql) {
  const sqlPath = path.join(root, 'packages/db/drizzle/0146_region_mapping_full_seed.sql');
  const stationVals = stations
    .map((r) => `  (${sqlQuote(r.station)}, ${sqlQuote(r.sales_region)})`)
    .join(',\n');
  const warehouseVals = warehouses
    .map((r) => `  (${sqlQuote(r.warehouse_code)}, ${sqlQuote(r.fulfillment_region)})`)
    .join(',\n');
  const sql = `-- 全量站点/仓库区域映射（来源：站点、仓库对应区域.xlsx）
INSERT INTO "station_sales_region_maps" ("station", "sales_region")
VALUES
${stationVals}
ON CONFLICT ("station") DO UPDATE SET
  "sales_region" = EXCLUDED."sales_region",
  "updated_at" = now();

INSERT INTO "warehouse_fulfillment_region_maps" ("warehouse_code", "fulfillment_region")
VALUES
${warehouseVals}
ON CONFLICT ("warehouse_code") DO UPDATE SET
  "fulfillment_region" = EXCLUDED."fulfillment_region",
  "updated_at" = now();
`;
  fs.writeFileSync(sqlPath, sql, 'utf8');
  console.log('wrote', sqlPath);
}

console.log('xlsx', xlsxPath);
console.log('stations', stations.length, 'warehouses', warehouses.length);
console.log(
  'station OTHER',
  stations.filter((r) => r.sales_region === 'OTHER').length,
  'warehouse OTHER',
  warehouses.filter((r) => r.fulfillment_region === 'OTHER').length,
);
