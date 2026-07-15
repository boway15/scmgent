import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTurnoverWarehouseBuckets } from './turnover-bucket-warehouse.js';

describe('turnover-bucket-warehouse', () => {
  it('parses per-bucket overseas and in-transit without merging', () => {
    const buckets = parseTurnoverWarehouseBuckets({
      海外仓库存_美东: '10',
      海外仓库存_美南: '5',
      调拨在途_美东: '2',
      调拨在途_德国: '3',
    });

    assert.deepEqual(
      buckets.sort((a, b) => a.warehouse.localeCompare(b.warehouse)),
      [
        { warehouse: 'DE', qtyAvailable: 0, qtyInTransit: 3 },
        { warehouse: 'US-EAST', qtyAvailable: 10, qtyInTransit: 2 },
        { warehouse: 'US-SOUTH', qtyAvailable: 5, qtyInTransit: 0 },
      ],
    );
  });
});
