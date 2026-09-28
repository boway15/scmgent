import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateByShare,
  parseShareValue,
  parseSharesFromSnapshot,
  parseTransitBuckets,
  resolvePlanningAllocation,
  resolveWarehouseDemandShare,
  scaleDailyMapByShare,
  shouldSkipConfirmedHorizon,
  splitResidualTransit,
  type ShareParseResult,
} from './inventory-share-allocation.js';

function salesShare(weights: Array<{ warehouse: string; weight: number }>, shareSum = 1): ShareParseResult {
  return {
    method: 'sales_share',
    shareSum,
    shareSumWarning: Math.abs(shareSum - 1) > 0.05,
    weights,
  };
}

const unallocated: ShareParseResult = {
  method: 'unallocated',
  shareSum: 0,
  shareSumWarning: false,
  weights: [],
};

describe('parseShareValue', () => {
  it('parses decimals, percents, and empty like the Feishu mapper', () => {
    assert.equal(parseShareValue('0.41'), 0.41);
    assert.equal(parseShareValue('41%'), 0.41);
    assert.equal(parseShareValue(''), 0);
    assert.equal(parseShareValue(null), 0);
    assert.equal(parseShareValue(undefined), 0);
  });
});

describe('parseSharesFromSnapshot', () => {
  it('maps 美西/美东 to US-WEST/US-EAST as sales_share', () => {
    const parsed = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    assert.equal(parsed.method, 'sales_share');
    assert.equal(parsed.shareSum, 1);
    assert.equal(parsed.shareSumWarning, false);
    const byWh = Object.fromEntries(parsed.weights.map((w) => [w.warehouse, w.weight]));
    assert.equal(byWh['US-WEST'], 0.6);
    assert.equal(byWh['US-EAST'], 0.4);
  });

  it('returns unallocated when all share columns are empty', () => {
    const parsed = parseSharesFromSnapshot({});
    assert.equal(parsed.method, 'unallocated');
    assert.equal(parsed.shareSumWarning, false);
    assert.deepEqual(parsed.weights, []);
  });

  it('keeps sales_share with relative normalize when only 美西=0.5', () => {
    const parsed = parseSharesFromSnapshot({ 美西: '0.5' });
    assert.equal(parsed.method, 'sales_share');
    assert.equal(parsed.shareSum, 0.5);
    assert.equal(parsed.shareSumWarning, true);
    assert.equal(parsed.weights.length, 1);
    assert.equal(parsed.weights[0]?.warehouse, 'US-WEST');
    assert.equal(parsed.weights[0]?.weight, 1);
  });
});

describe('allocateByShare', () => {
  it('splits 100 as WEST=60 EAST=40', () => {
    const parsed = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    const allocated = allocateByShare(100, parsed);
    assert.equal(allocated.get('US-WEST'), 60);
    assert.equal(allocated.get('US-EAST'), 40);
  });

  it('returns empty Map for qty 0', () => {
    const parsed = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    const allocated = allocateByShare(0, parsed);
    assert.equal(allocated.size, 0);
  });

  it('returns empty Map for unallocated', () => {
    const allocated = allocateByShare(100, unallocated);
    assert.equal(allocated.size, 0);
  });

  it('makes three equal thirds sum to 10', () => {
    const allocated = allocateByShare(
      10,
      salesShare([
        { warehouse: 'US-WEST', weight: 1 / 3 },
        { warehouse: 'US-EAST', weight: 1 / 3 },
        { warehouse: 'DE', weight: 1 / 3 },
      ]),
    );
    const sum = [...allocated.values()].reduce((acc, n) => acc + n, 0);
    assert.equal(sum, 10);
  });

  it('breaks remainder ties by warehouse localeCompare ascending', () => {
    const allocated = allocateByShare(
      1,
      salesShare([
        { warehouse: 'US-WEST', weight: 0.5 },
        { warehouse: 'US-EAST', weight: 0.5 },
      ]),
    );
    assert.equal(allocated.get('US-EAST'), 1);
    assert.equal(allocated.get('US-WEST') ?? 0, 0);
  });
});

describe('parseTransitBuckets', () => {
  it('parses Feishu 合计 columns and treats invalid as 0', () => {
    assert.deepEqual(
      parseTransitBuckets({
        预计10天上架_合计: '1,040',
        '预计10-20天上架_合计': '20',
        预计超20天上架_合计: 'x',
      }),
      { d5: 1040, d15: 20, d25: 0 },
    );
  });
});

describe('splitResidualTransit', () => {
  it('keeps buckets and leftover undated when bucket sum is below residual', () => {
    const slices = splitResidualTransit({
      residual: 80,
      buckets: { d5: 40, d15: 20, d25: 10 },
      earliestAvailableAt: null,
      today: '2026-09-18',
    });
    assert.deepEqual(slices, [
      { qty: 40, availableAt: '2026-09-23', bucket: 'd5' },
      { qty: 20, availableAt: '2026-10-03', bucket: 'd15' },
      { qty: 10, availableAt: '2026-10-13', bucket: 'd25' },
      { qty: 10, availableAt: null, bucket: 'undated' },
    ]);
  });

  it('scales buckets to residual with largest remainder when bucket sum exceeds residual', () => {
    const slices = splitResidualTransit({
      residual: 50,
      buckets: { d5: 40, d15: 20, d25: 10 },
      earliestAvailableAt: null,
      today: '2026-09-18',
    });
    const sum = slices.reduce((acc, s) => acc + s.qty, 0);
    assert.equal(sum, 50);
    assert.equal(slices.some((s) => s.bucket === 'undated'), false);
    assert.equal(slices.length, 3);
  });

  it('uses earliest date when buckets are empty', () => {
    const slices = splitResidualTransit({
      residual: 30,
      buckets: { d5: 0, d15: 0, d25: 0 },
      earliestAvailableAt: '2026-10-01',
      today: '2026-09-18',
    });
    assert.deepEqual(slices, [{ qty: 30, availableAt: '2026-10-01', bucket: 'earliest' }]);
  });

  it('returns one undated slice when buckets and earliest are missing', () => {
    const slices = splitResidualTransit({
      residual: 30,
      buckets: { d5: 0, d15: 0, d25: 0 },
      earliestAvailableAt: null,
      today: '2026-09-18',
    });
    assert.deepEqual(slices, [{ qty: 30, availableAt: null, bucket: 'undated' }]);
  });
});

describe('resolvePlanningAllocation', () => {
  const base = {
    planningWarehouse: 'US-WEST',
    allocatedQty: 0,
    undatedTransitQty: 0,
    snapshotDate: '2026-09-18' as string | null,
  };

  it('marks unallocated when overseas total exists but shares are empty', () => {
    const result = resolvePlanningAllocation({
      ...base,
      nativeWarehouseQty: 0,
      overseasTotal: 100,
      share: unallocated,
      allocatedQty: 0,
    });
    assert.equal(result.method, 'unallocated');
  });

  it('marks sales_share when shares allocated qty', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    const result = resolvePlanningAllocation({
      ...base,
      nativeWarehouseQty: 0,
      overseasTotal: 100,
      share,
      allocatedQty: 60,
    });
    assert.equal(result.method, 'sales_share');
    assert.equal(result.allocatedQty, 60);
  });

  it('prefers native_warehouse when this warehouse has its own qty', () => {
    const share = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });
    const result = resolvePlanningAllocation({
      ...base,
      nativeWarehouseQty: 12,
      overseasTotal: 100,
      share,
      allocatedQty: 60,
    });
    assert.equal(result.method, 'native_warehouse');
  });
});

describe('shouldSkipConfirmedHorizon', () => {
  it('skips only unallocated', () => {
    assert.equal(shouldSkipConfirmedHorizon('unallocated'), true);
    assert.equal(shouldSkipConfirmedHorizon('sales_share'), false);
    assert.equal(shouldSkipConfirmedHorizon('native_warehouse'), false);
  });
});

describe('resolveWarehouseDemandShare', () => {
  const parsed = parseSharesFromSnapshot({ 美西: '0.6', 美东: '0.4' });

  it('returns normalized share for warehouses with a share column', () => {
    assert.equal(resolveWarehouseDemandShare('US-WEST', parsed), 0.6);
    assert.equal(resolveWarehouseDemandShare('US-SOUTH', parsed), 0);
  });

  it('returns null for warehouses without a share column or SKUs without shares', () => {
    assert.equal(resolveWarehouseDemandShare('UK', parsed), null);
    assert.equal(resolveWarehouseDemandShare('ALL', parsed), null);
    assert.equal(resolveWarehouseDemandShare('US-WEST', parseSharesFromSnapshot({})), null);
  });

  it('scales daily map by share and keeps the original when share is null', () => {
    const map = new Map([['2026-10', 10]]);
    assert.equal(scaleDailyMapByShare(map, 0.6).get('2026-10'), 6);
    assert.equal(scaleDailyMapByShare(map, null), map);
  });
});
