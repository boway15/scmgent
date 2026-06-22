/**
 * 校验 docs/samples/imports 三类 FOB 模板可被解析器识别
 * 用法: cd apps/web && pnpm exec tsx server/scripts/verify-fob-import-templates.ts
 */
import XLSX from 'xlsx';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseEdVolumeSheet,
  parseSimplifiedTruckingSheet,
  parseSimplifiedFreightSheet,
  isSenweiTruckingSheet,
  isSimplifiedTruckingSheet,
  isHuamaoFreightSheet,
  isSimplifiedFreightSheet,
} from '../lib/fob-bill-parsers.js';
import { buildFobImportTemplate } from '../lib/fob-import-templates.js';

const dir = join(import.meta.dirname, '../../../../docs/samples/imports');

async function main() {
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.xlsx'))
    .sort()) {
    const wb = XLSX.readFile(join(dir, f));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown[][];

    if (f.startsWith('1')) {
      const r = parseEdVolumeSheet(rows);
      const byContainer = new Map<string, { rows: number; vol: number }>();
      for (const item of r.items) {
        const cur = byContainer.get(item.containerNo) ?? { rows: 0, vol: 0 };
        cur.rows++;
        cur.vol += item.volumeCbm;
        byContainer.set(item.containerNo, cur);
      }
      console.log(f, 'items:', r.items.length, 'skipped:', r.skippedRows, 'errors:', r.errors.length);
      for (const [c, v] of byContainer) console.log(' ', c, 'rows:', v.rows, 'vol:', v.vol.toFixed(2));
      const billContainers = ['WHSU8817230', 'TLLU8928846', 'TLLU8926666', 'TLLU8928888'];
      const missing = billContainers.filter((c) => !byContainer.has(c));
      if (missing.length) console.log('  MISSING volume for bill containers:', missing.join(', '));
    } else if (f.startsWith('2')) {
      console.log(f, 'senwei:', isSenweiTruckingSheet(rows), 'simplified:', isSimplifiedTruckingSheet(rows));
      const r = parseSimplifiedTruckingSheet(rows);
      console.log(
        '  items:',
        r.items.length,
        'containers:',
        new Set(r.items.map((i) => i.containerNo)).size,
        'errors:',
        r.errors.length,
      );
    } else {
      console.log(f, 'huamao:', isHuamaoFreightSheet(rows), 'simplified:', isSimplifiedFreightSheet(rows));
      const r = parseSimplifiedFreightSheet(rows, 7.25);
      console.log(
        '  items:',
        r.items.length,
        'containers:',
        new Set(r.items.map((i) => i.containerNo)).size,
        'errors:',
        r.errors.length,
      );
    }
  }

  for (const type of ['volume', 'trucking', 'freight'] as const) {
    const { buffer, filename } = await buildFobImportTemplate(type);
    console.log('generated', filename, buffer.length, 'bytes');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
