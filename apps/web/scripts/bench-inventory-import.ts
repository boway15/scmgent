import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { parseXlsxBuffer, importInventoryRows } from '../server/lib/import/handlers.js';
import { db, users } from '@scm/db';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const file = process.argv[2] ?? resolve(ROOT, 'docs/samples/import-fob/库存表-SKU库存周转情况查询-明细6a4227ef43084ca969e19dfe.xlsx');
const limit = Number(process.argv[3] ?? 20);

async function main() {
  const buf = readFileSync(file);
  const t0 = Date.now();
  const rows = await parseXlsxBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  console.log('parse ms', Date.now() - t0, 'rows', rows.length);
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error('no user');
  const slice = rows.slice(0, limit);
  const t1 = Date.now();
  const r = await importInventoryRows(slice, user.id, randomUUID());
  console.log('import', slice.length, 'rows ms', Date.now() - t1, r);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
