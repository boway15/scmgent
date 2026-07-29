import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createFixtureTransport, loadSapMirrorFixture } from './fixture-transport.js';

describe('fixture-transport', () => {
  const sampleFixture = {
    merchant: [{ vendorId: 'V1', name: 'Vendor 1' }],
    sku: [
      { materialId: 'M1', name: 'SKU 1' },
      { materialId: 'M2', name: 'SKU 2' },
      { materialId: 'M3', name: 'SKU 3' },
    ],
    purchase_order: [{ poId: 'PO1', vendorId: 'V1', lines: [{ lineId: '1', materialId: 'M1', qty: 1 }] }],
  };

  it('loads fixture from in-memory object with pagination', async () => {
    const transport = createFixtureTransport({ fixture: sampleFixture, batchSize: 2 });

    const page1 = await transport.fetchBatch('sku');
    assert.equal(page1.items.length, 2);
    assert.equal(page1.nextCursor, '2');

    const page2 = await transport.fetchBatch('sku', page1.nextCursor);
    assert.equal(page2.items.length, 1);
    assert.equal(page2.nextCursor, undefined);
  });

  it('returns empty batch for unknown entity type', async () => {
    const transport = createFixtureTransport({ fixture: sampleFixture });
    const batch = await transport.fetchBatch('merchant');
    assert.equal(batch.items.length, 1);
    assert.equal(batch.nextCursor, undefined);
  });

  it('loads fixture from JSON file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sap-mirror-fixture-'));
    const path = join(dir, 'fixture.json');
    writeFileSync(path, JSON.stringify(sampleFixture), 'utf8');

    const loaded = loadSapMirrorFixture(path);
    assert.equal(loaded.sku?.length, 3);

    const transport = createFixtureTransport({ fixture: path, batchSize: 10 });
    const batch = await transport.fetchBatch('purchase_order');
    assert.equal(batch.items.length, 1);
    assert.equal((batch.items[0] as { poId: string }).poId, 'PO1');
  });
});
