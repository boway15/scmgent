import assert from 'node:assert/strict';
import {
  healthToAlertType,
  healthToExceptionType,
  recommendedActionForException,
} from './inventory-health-service.js';
import { buildInventoryPositionMetrics } from './inventory-position.js';

assert.deepEqual(
  buildInventoryPositionMetrics({
    effectiveQty: 135,
    qtyAvailable: 100,
    qtyInProduction: 20,
    qtyInTransit: 30,
    qtyConfirmedOpen: 5,
    qtyReserved: 20,
    qtyBackorder: 0,
    dedupeMode: 'drafts_fill_gap',
    unassignedOpenQty: 7,
    sources: [
      { source: 'snapshot', bucket: 'available', qty: 100 },
      {
        source: 'purchase_draft',
        bucket: 'confirmedOpen',
        qty: 5,
        draftId: 'draft-1',
      },
    ],
  }),
  {
    inventoryPosition: {
      effectiveQty: 135,
      qtyAvailable: 100,
      qtyInProduction: 20,
      qtyInTransit: 30,
      qtyConfirmedOpen: 5,
      qtyReserved: 20,
      dedupeMode: 'drafts_fill_gap',
      unassignedOpenQty: 7,
      sources: [
        { source: 'snapshot', bucket: 'available', qty: 100 },
        {
          source: 'purchase_draft',
          bucket: 'confirmedOpen',
          qty: 5,
          draftId: 'draft-1',
        },
      ],
    },
  },
);

assert.equal(healthToAlertType('red', 0), 'stockout');
assert.equal(healthToAlertType('red', 5), 'below_rop');
assert.equal(healthToAlertType('yellow', 10), 'below_safety');
assert.equal(healthToAlertType('green', 10), null);

assert.equal(healthToExceptionType('blue', null), 'overstock');
assert.equal(healthToExceptionType('gray', '停售'), 'lifecycle_eol');
assert.equal(healthToExceptionType('gray', null), 'slow_moving');
assert.equal(healthToExceptionType('red', null), null);

assert.ok(recommendedActionForException('overstock').includes('停补'));

console.log('inventory-health-service.test.ts: ok');
