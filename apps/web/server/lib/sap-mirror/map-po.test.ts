import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapSapPurchaseOrderToMirror } from './map-po.js';

describe('mapSapPurchaseOrderToMirror', () => {
  it('maps PO head and lines for mirror upsert', () => {
    const mapped = mapSapPurchaseOrderToMirror({
      poId: '4500012345',
      poNumber: 'PO-2026-001',
      vendorId: '0000100001',
      merchantCode: 'SUP23111300027',
      orderDate: '2026-07-15',
      status: 'RELEASED',
      version: '0003',
      lines: [
        {
          lineId: '00010',
          materialId: 'MAT-10001',
          qty: 120,
          uom: 'PC',
          deliveryDate: '2026-08-01',
        },
        {
          lineId: '00020',
          materialId: 'MAT-10002',
          qty: 50,
        },
      ],
    });

    assert.equal(mapped.head.sourceSystem, 'sap');
    assert.equal(mapped.head.externalId, '4500012345');
    assert.equal(mapped.head.poNumber, 'PO-2026-001');
    assert.equal(mapped.head.vendorExternalId, '0000100001');
    assert.equal(mapped.head.merchantCode, 'SUP23111300027');
    assert.equal(mapped.head.orderDate, '2026-07-15');
    assert.equal(mapped.head.statusRaw, 'RELEASED');
    assert.equal(mapped.head.externalVersion, '0003');
    assert.equal(mapped.lines.length, 2);
    assert.deepEqual(mapped.lines[0], {
      externalLineId: '00010',
      skuExternalId: 'MAT-10001',
      qty: 120,
      uom: 'PC',
      deliveryDate: '2026-08-01',
      payload: {
        lineId: '00010',
        materialId: 'MAT-10001',
        qty: 120,
        uom: 'PC',
        deliveryDate: '2026-08-01',
      },
    });
    assert.equal(mapped.lines[1].skuExternalId, 'MAT-10002');
    assert.equal(mapped.lines[1].qty, 50);
    assert.ok(mapped.head.payload);
    assert.equal((mapped.head.payload as { poId: string }).poId, '4500012345');
  });

  it('defaults poNumber to poId when omitted', () => {
    const mapped = mapSapPurchaseOrderToMirror({
      poId: '4500012345',
      vendorId: '0000100001',
      lines: [{ lineId: '00010', materialId: 'MAT-1', qty: 1 }],
    });

    assert.equal(mapped.head.poNumber, '4500012345');
  });

  it('throws when required PO fields are missing', () => {
    assert.throws(
      () =>
        mapSapPurchaseOrderToMirror({
          poId: '',
          vendorId: 'V1',
          lines: [{ lineId: '1', materialId: 'M1', qty: 1 }],
        }),
      /poId is required/,
    );
    assert.throws(
      () =>
        mapSapPurchaseOrderToMirror({
          poId: 'P1',
          vendorId: '',
          lines: [{ lineId: '1', materialId: 'M1', qty: 1 }],
        }),
      /vendorId is required/,
    );
    assert.throws(
      () =>
        mapSapPurchaseOrderToMirror({
          poId: 'P1',
          vendorId: 'V1',
          lines: [],
        }),
      /lines must be a non-empty array/,
    );
    assert.throws(
      () =>
        mapSapPurchaseOrderToMirror({
          poId: 'P1',
          vendorId: 'V1',
          lines: [{ lineId: '', materialId: 'M1', qty: 1 }],
        }),
      /lineId is required/,
    );
  });
});
