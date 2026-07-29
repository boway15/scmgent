import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createMemorySapMirrorStore,
  ingestSapMirrorBatch,
  merchantRowMatchesMapped,
  resolveSyncRunStatus,
  shouldSkipByExternalVersion,
  skuRowMatchesMapped,
} from './ingest.js';

describe('sap mirror ingest helpers', () => {
  it('skips only when both external versions are equal and non-empty', () => {
    assert.equal(shouldSkipByExternalVersion('0003', '0003'), true);
    assert.equal(shouldSkipByExternalVersion('0003', '0004'), false);
    assert.equal(shouldSkipByExternalVersion(null, '0003'), false);
    assert.equal(shouldSkipByExternalVersion('0003', undefined), false);
  });

  it('resolves sync run status from upsert accounting', () => {
    assert.equal(
      resolveSyncRunStatus({ inserted: 1, updated: 0, skipped: 0, errors: [] }),
      'succeeded',
    );
    assert.equal(
      resolveSyncRunStatus({ inserted: 0, updated: 0, skipped: 0, errors: [{ message: 'x' }] }),
      'failed',
    );
    assert.equal(
      resolveSyncRunStatus({ inserted: 1, updated: 0, skipped: 0, errors: [{ message: 'x' }] }),
      'partial',
    );
  });

  it('detects unchanged merchant and sku rows', () => {
    assert.equal(
      merchantRowMatchesMapped(
        { code: 'SUP001', name: 'Acme' },
        { sourceSystem: 'sap', externalId: 'V1', code: 'SUP001', name: 'Acme' },
      ),
      true,
    );
    assert.equal(
      skuRowMatchesMapped(
        { code: 'MAT-1', name: 'Widget', unit: 'EA' },
        { sourceSystem: 'sap', externalId: 'MAT-1', code: 'MAT-1', name: 'Widget', unit: 'EA' },
      ),
      true,
    );
  });
});

describe('ingestSapMirrorBatch', () => {
  it('inserts merchants on first import and skips identical re-import', async () => {
    const store = createMemorySapMirrorStore();
    const item = { vendorId: '0000100001', name: 'Acme Supplies', code: 'SUP001' };

    const first = await ingestSapMirrorBatch({ entityType: 'merchant', items: [item] }, store);
    assert.equal(first.inserted, 1);
    assert.equal(first.updated, 0);
    assert.equal(first.skipped, 0);
    assert.equal(store.merchants.length, 1);
    assert.equal(store.runs[0]?.status, 'succeeded');

    const second = await ingestSapMirrorBatch({ entityType: 'merchant', items: [item] }, store);
    assert.equal(second.inserted, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.skipped, 1);
  });

  it('updates merchant when name changes', async () => {
    const store = createMemorySapMirrorStore();
    await ingestSapMirrorBatch(
      {
        entityType: 'merchant',
        items: [{ vendorId: 'V1', name: 'Old Name', code: 'SUP001' }],
      },
      store,
    );

    const result = await ingestSapMirrorBatch(
      {
        entityType: 'merchant',
        items: [{ vendorId: 'V1', name: 'New Name', code: 'SUP001' }],
      },
      store,
    );

    assert.equal(result.updated, 1);
    assert.equal(store.merchants[0]?.name, 'New Name');
  });

  it('inserts and skips sku batches with upsert accounting', async () => {
    const store = createMemorySapMirrorStore();
    const item = { materialId: 'MAT-10001', name: 'Widget', unit: 'PC' };

    const first = await ingestSapMirrorBatch({ entityType: 'sku', items: [item] }, store);
    assert.equal(first.inserted, 1);

    const second = await ingestSapMirrorBatch({ entityType: 'sku', items: [item] }, store);
    assert.equal(second.skipped, 1);
    assert.equal(store.skus[0]?.unit, 'PC');
  });

  it('upserts PO mirror head/lines and records missing sku as line error', async () => {
    const store = createMemorySapMirrorStore();
    await ingestSapMirrorBatch(
      {
        entityType: 'merchant',
        items: [{ vendorId: '0000100001', name: 'Acme', code: 'SUP001' }],
      },
      store,
    );

    const po = {
      poId: '4500012345',
      poNumber: 'PO-2026-001',
      vendorId: '0000100001',
      version: '0001',
      lines: [{ lineId: '00010', materialId: 'MAT-MISSING', qty: 10 }],
    };

    const first = await ingestSapMirrorBatch({ entityType: 'purchase_order', items: [po] }, store);
    assert.equal(first.inserted, 1);
    assert.equal(first.errors.length, 1);
    assert.match(first.errors[0]?.message ?? '', /sku not found/i);
    assert.equal(store.poMirrors.length, 1);
    assert.equal(store.poMirrors[0]?.merchantCode, 'SUP001');
    assert.equal(store.poLines.length, 1);
    assert.equal(store.poLines[0]?.skuId, null);
    assert.equal(store.runs.at(-1)?.status, 'partial');

    const retry = await ingestSapMirrorBatch({ entityType: 'purchase_order', items: [po] }, store);
    assert.equal(retry.skipped, 1);
    assert.equal(retry.inserted, 0);
    assert.equal(retry.updated, 0);
  });

  it('updates PO mirror when external version changes', async () => {
    const store = createMemorySapMirrorStore();
    await ingestSapMirrorBatch(
      {
        entityType: 'merchant',
        items: [{ vendorId: 'V1', name: 'Vendor', code: 'SUP001' }],
      },
      store,
    );
    await ingestSapMirrorBatch(
      {
        entityType: 'sku',
        items: [{ materialId: 'MAT-1', name: 'Item', unit: 'EA' }],
      },
      store,
    );

    const basePo = {
      poId: 'PO-1',
      vendorId: 'V1',
      version: '0001',
      status: 'OPEN',
      lines: [{ lineId: '10', materialId: 'MAT-1', qty: 5 }],
    };

    await ingestSapMirrorBatch({ entityType: 'purchase_order', items: [basePo] }, store);
    const updated = await ingestSapMirrorBatch(
      {
        entityType: 'purchase_order',
        items: [{ ...basePo, version: '0002', status: 'RELEASED' }],
      },
      store,
    );

    assert.equal(updated.updated, 1);
    assert.equal(store.poMirrors[0]?.externalVersion, '0002');
    assert.equal(store.poMirrors[0]?.statusRaw, 'RELEASED');
    assert.equal(store.poLines[0]?.skuId, store.skus[0]?.id);
  });

  it('records mapping errors without aborting the batch', async () => {
    const store = createMemorySapMirrorStore();
    const result = await ingestSapMirrorBatch(
      {
        entityType: 'merchant',
        items: [
          { vendorId: 'V1', name: 'Good Vendor' },
          { vendorId: '', name: 'Bad Vendor' },
        ],
      },
      store,
    );

    assert.equal(result.inserted, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]?.message ?? '', /vendorId is required/);
    assert.equal(store.runs[0]?.status, 'partial');
  });
});
