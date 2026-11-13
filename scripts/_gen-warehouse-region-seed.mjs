import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = path.join(root, '映射-区域有哪些仓库.csv');
const outPath = path.join(root, 'packages/db/drizzle/0145_warehouse_fulfillment_region_seed.sql');

const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
const mapRegion = (r) => (r.trim().toUpperCase() === 'OT' ? 'OTHER' : r.trim().toUpperCase());
const vals = [];
for (const line of lines) {
  const idx = line.indexOf(',');
  if (idx < 0) continue;
  const region = mapRegion(line.slice(0, idx));
  let wh = line.slice(idx + 1).trim().replace(/'/g, "''");
  const comma = wh.indexOf(',');
  if (comma > 0) wh = wh.slice(0, comma);
  if (!wh) continue;
  vals.push(`('${wh}','${region}')`);
}

const body = `INSERT INTO "warehouse_fulfillment_region_maps" ("warehouse_code", "fulfillment_region")
VALUES
  ${vals.join(',\n  ')}
ON CONFLICT ("warehouse_code") DO UPDATE SET
  "fulfillment_region" = EXCLUDED."fulfillment_region",
  "updated_at" = now();
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log('wrote', outPath, 'rows', vals.length);
