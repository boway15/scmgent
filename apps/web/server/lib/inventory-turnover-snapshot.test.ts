import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTurnoverSnapshot,
  readSkuPackagingFromEncodingMeta,
  readTurnoverSnapshot,
  resolveCanonicalTurnoverHeader,
} from './inventory-turnover-snapshot.js';
import { getDefaultVisibleColumnIds } from './inventory-overview-views.js';

describe('inventory-turnover-snapshot', () => {
  it('maps normalized import keys to canonical Excel headers (A:GR)', () => {
    const snapshot = extractTurnoverSnapshot({
      sku: '100100201',
      sku名称: 'Sample',
      品类: 'Furniture',
      海外仓库存_美东: '3',
      '3天销量': '9',
      全链条周转天数: '45',
    });

    assert.equal(snapshot['海外仓库存_美东'], '3');
    assert.equal(snapshot['3天销量'], '9');
    assert.equal(snapshot['全链条周转天数'], '45');
    assert.equal(snapshot['品类'], 'Furniture');
    assert.equal(snapshot['SKU'], '100100201');
  });

  it('normalizes legacy snapshot keys on read', () => {
    const snapshot = readTurnoverSnapshot({
      turnoverSnapshot: {
        海外仓库存_美东: '2',
        '3天销量': '1',
      },
    });

    assert.equal(snapshot['海外仓库存_美东'], '2');
    assert.equal(snapshot['3天销量'], '1');
  });

  it('parses jsonb returned as string from raw SQL', () => {
    const snapshot = readTurnoverSnapshot(
      JSON.stringify({
        turnoverSnapshot: {
          海外仓库存_美西: '1',
          海外仓库存_美东: '0',
        },
      }),
    );

    assert.equal(snapshot['海外仓库存_美西'], '1');
    assert.equal(snapshot['海外仓库存_美东'], '0');
  });

  it('resolves SKU header alias', () => {
    assert.equal(resolveCanonicalTurnoverHeader('sku'), 'SKU');
    assert.equal(resolveCanonicalTurnoverHeader('近30天断货天数'), '近30天断货天数');
  });

  it('defaults to replenish view columns', () => {
    const ids = getDefaultVisibleColumnIds();
    assert.ok(ids.length >= 18 && ids.length <= 36);
    assert.equal(ids[0], '品类');
    assert.equal(ids[1], 'SKU');
    assert.ok(ids.includes('近30天断货天数') === false);
    assert.ok(!ids.includes('updatedAt'));
    assert.ok(!ids.includes('dataSource'));
    assert.equal(ids.at(-1), 'inventoryRecordedDate');
  });

  it('reads packaging fields from turnover snapshot', () => {
    const packaging = readSkuPackagingFromEncodingMeta({
      turnoverSnapshot: {
        '包装长宽高cm': '80*60*40',
        '体积（m3）': '0.192',
        '毛重（Kg）': '25.5',
      },
    });

    assert.equal(packaging.packDimensionsCm, '80*60*40');
    assert.equal(packaging.volumeM3, '0.192');
    assert.equal(packaging.grossWeightKg, '25.5');
  });

  it('normalizes halfwidth parens in turnover snapshot keys', () => {
    const snapshot = readTurnoverSnapshot({
      turnoverSnapshot: {
        '体积(m3)': '0.192',
        '毛重(Kg)': '25.5',
      },
    });

    assert.equal(snapshot['体积（m3）'], '0.192');
    assert.equal(snapshot['毛重（Kg）'], '25.5');
  });
});
