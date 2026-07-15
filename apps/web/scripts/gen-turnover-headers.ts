import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const sample = resolve(
  import.meta.dirname,
  '../../../docs/samples/kucun/库存表-SKU库存周转情况查询-明细6a4227ef43084ca969e19dfe.xlsx',
);
const wb = XLSX.read(readFileSync(sample));
const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const headers = rows[0] ?? [];

const serverOut = resolve(import.meta.dirname, '../server/lib/inventory-turnover-headers.ts');
const clientOut = resolve(import.meta.dirname, '../src/lib/inventory-turnover-headers.ts');
const body = `/** Auto-aligned with turnover import xlsx sample */\nexport const TURNOVER_IMPORT_HEADERS = ${JSON.stringify(headers, null, 2)} as const;\n`;

writeFileSync(serverOut, body);
writeFileSync(clientOut, body);
console.log(`Wrote ${headers.length} headers to server + client`);
