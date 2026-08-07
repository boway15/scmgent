import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOM_EXPORT_HEADERS, buildBomXlsx } from './export-bom.js';

describe('buildBomXlsx', () => {
  it('includes expected headers', async () => {
    const buf = await buildBomXlsx([
      {
        category: '板材',
        materialName: '多层板',
        spec: '18mm',
        unit: '张',
        qtyNet: 1,
        lossRate: 0.08,
        qtyGross: 1.08,
        sourceRef: 'p1',
        confidence: 'high',
        notes: '',
      },
    ]);
    assert.ok(buf.byteLength > 0);
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    assert.deepEqual(rows[0], Array.from(BOM_EXPORT_HEADERS));
  });
});
