import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFeishuSalesDailyWindow,
  mapFeishuSalesDailyRecords,
} from './feishu-sales-daily-mapper.js';

describe('mapFeishuSalesDailyRecords', () => {
  it('splits platform and site from the composite station label', () => {
    const mapped = mapFeishuSalesDailyRecords([
      record({
        Sku: 'DJ502897',
        '付款日期(站点)': '2026-10-19',
        站点: 'Amazon德国',
        销量: '2',
        SKU名称: '浴室柜',
        品类: '浴室',
        首单时间: '2023-09-08T18:18:51.000Z',
      }),
      record({
        Sku: 'DJ503897_1_WF',
        '付款日期(站点)': '2026-10-18',
        站点: 'wayfair',
        销量: '1',
      }),
      record({
        Sku: 'DJ1',
        '付款日期(站点)': '2026-10-18',
        站点: 'wayfair英国',
        销量: '4',
      }),
      record({
        Sku: 'DJ2',
        '付款日期(站点)': '2026-10-18',
        站点: 'wayfair欧洲',
        销量: '1',
      }),
      record({
        Sku: 'DJ3',
        '付款日期(站点)': '2026-10-17',
        站点: '沃尔玛',
        销量: '0',
      }),
      record({
        Sku: 'DJ4',
        '付款日期(站点)': '2026-10-17',
        站点: 'TEMU-US',
        销量: '3',
      }),
      record({
        Sku: 'DJ5',
        '付款日期(站点)': '2026-10-17',
        站点: 'Amazon比利时',
        销量: '1',
      }),
      record({
        Sku: 'DJ6',
        '付款日期(站点)': '2026-10-17',
        站点: 'manomano-France',
        销量: '1',
      }),
    ]);

    const bySku = Object.fromEntries(mapped.rows.map((row) => [row.skuCode, row]));
    assert.equal(bySku.DJ502897.platformRaw, '亚马逊');
    assert.equal(bySku.DJ502897.station, 'Amazon德国');
    assert.equal(bySku.DJ502897.qtySold, 2);
    assert.equal(bySku.DJ502897.skuName, '浴室柜');
    assert.equal(bySku.DJ503897_1_WF.platformRaw, 'wayfair');
    assert.equal(bySku.DJ503897_1_WF.station, 'wayfair');
    assert.equal(bySku.DJ1.station, 'wayfair英国');
    assert.equal(bySku.DJ2.station, 'wayfair欧洲');
    assert.equal(bySku.DJ3.platformRaw, '沃尔玛');
    assert.equal(bySku.DJ3.station, '沃尔玛');
    assert.equal(bySku.DJ3.qtySold, 0);
    assert.equal(bySku.DJ4.platformRaw, 'TEMU');
    assert.equal(bySku.DJ4.station, 'TEMU-US');
    assert.equal(bySku.DJ5.station, 'Amazon比利时');
    assert.equal(bySku.DJ6.platformRaw, 'manomano');
    assert.equal(bySku.DJ6.station, 'manomano-France');
    assert.deepEqual(mapped.dates, ['2026-10-17', '2026-10-18', '2026-10-19']);
  });

  it('reads channel from the 平台 field and keeps station from 站点', () => {
    const mapped = mapFeishuSalesDailyRecords([
      record({
        Sku: 'ETSY-1',
        '付款日期(站点)': '2026-10-19',
        站点: '美国',
        平台: 'Etsy',
        销量: '2',
      }),
      record({
        Sku: 'ETSY-2',
        '付款日期(站点)': '2026-10-19',
        站点: 'Amazon德国',
        平台: 'etsy美国',
        销量: '1',
      }),
      {
        record_id: 'rec-select',
        fields: {
          Sku: 'EBAY-1',
          '付款日期(站点)': '2026-10-19',
          站点: '英国',
          平台: { name: 'eBay' },
          销量: '3',
        },
      },
    ]);

    const bySku = Object.fromEntries(mapped.rows.map((row) => [row.skuCode, row]));
    assert.equal(bySku['ETSY-1'].platformRaw, 'etsy');
    assert.equal(bySku['ETSY-1'].station, '美国');
    assert.equal(bySku['ETSY-2'].platformRaw, 'etsy');
    assert.equal(bySku['ETSY-2'].station, 'Amazon德国');
    assert.equal(bySku['EBAY-1'].platformRaw, 'eBay');
    assert.equal(bySku['EBAY-1'].station, '英国');
  });

  it('skips rows without sku, date, or a numeric qty', () => {
    const mapped = mapFeishuSalesDailyRecords([
      record({ Sku: '', '付款日期(站点)': '2026-10-19', 站点: 'Amazon美国', 销量: '1' }),
      record({ Sku: 'DJ1', '付款日期(站点)': '', 站点: 'Amazon美国', 销量: '1' }),
      record({ Sku: 'DJ1', '付款日期(站点)': '2026-10-19', 站点: 'Amazon美国', 销量: '' }),
      record({ Sku: 'DJ1', '付款日期(站点)': 'not-a-date', 站点: 'Amazon美国', 销量: '1' }),
    ]);
    assert.equal(mapped.rows.length, 0);
    assert.equal(mapped.skipped, 4);
  });
});

describe('assertFeishuSalesDailyWindow', () => {
  it('accepts a window whose newest date is at least three days behind today', () => {
    assert.doesNotThrow(() =>
      assertFeishuSalesDailyWindow(['2026-10-16', '2026-10-18', '2026-10-17'], '2026-10-21'),
    );
  });

  it('rejects an empty pull and a stale newest date', () => {
    assert.throws(() => assertFeishuSalesDailyWindow([], '2026-10-21'), /没有付款日期/);
    assert.throws(
      () => assertFeishuSalesDailyWindow(['2026-10-16', '2026-10-17'], '2026-10-21'),
      /疑似未刷新/,
    );
  });
});

function record(fields: Record<string, string>) {
  return { record_id: 'rec', fields };
}
