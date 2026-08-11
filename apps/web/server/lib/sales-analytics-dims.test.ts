import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bucketAnalyticsSite,
  classifyAnalyticsSiteFromReport,
  extractAnalyticsDept,
  extractAnalyticsCategoryLeaf,
  extractAnalyticsSiteFromCategory,
  isoWeekLabel,
  resolveAnalyticsSite,
} from './sales-analytics-dims.js';

describe('sales-analytics-dims', () => {
  it('buckets site US/EU/UK/其他', () => {
    assert.equal(bucketAnalyticsSite('US'), 'US');
    assert.equal(bucketAnalyticsSite('UK'), 'UK');
    assert.equal(bucketAnalyticsSite('DE'), 'EU');
    assert.equal(bucketAnalyticsSite('EU'), 'EU');
    assert.equal(bucketAnalyticsSite(null), '其他');
    assert.equal(bucketAnalyticsSite(''), '其他');
    assert.equal(bucketAnalyticsSite('APAC'), '其他');
  });

  it('classifies report 站点 labels to US/EU/UK/其他', () => {
    assert.equal(classifyAnalyticsSiteFromReport('Amazon美国'), 'US');
    assert.equal(classifyAnalyticsSiteFromReport('Amazon德国'), 'EU');
    assert.equal(classifyAnalyticsSiteFromReport('Amazon英国'), 'UK');
    assert.equal(classifyAnalyticsSiteFromReport('DE'), 'EU');
    assert.equal(classifyAnalyticsSiteFromReport('US'), 'US');
    assert.equal(classifyAnalyticsSiteFromReport(''), '其他');
  });

  it('extracts site from category path tokens', () => {
    assert.equal(
      extractAnalyticsSiteFromCategory('DJ01\\Amazon项目2组-第一曲线-EU\\卧室-床'),
      'EU',
    );
    assert.equal(
      extractAnalyticsSiteFromCategory('DJ02\\Amazon项目1组-第一曲线-US\\卧室-床'),
      'US',
    );
    assert.equal(extractAnalyticsSiteFromCategory('部\\项目1组\\书桌'), null);
  });

  it('resolves site: station > category > warehouse', () => {
    assert.equal(
      resolveAnalyticsSite({
        station: 'Amazon英国',
        category: '部\\项目1组-US\\床',
        warehouseCode: 'US-WEST',
        warehouseStationByCode: new Map([['US-WEST', 'US']]),
      }),
      'UK',
    );
    assert.equal(
      resolveAnalyticsSite({
        station: '',
        category: '部\\项目1组-第一曲线-EU\\床',
      }),
      'EU',
    );
    assert.equal(
      resolveAnalyticsSite({
        station: '',
        category: null,
        warehouseCode: 'DE-1',
        warehouseStationByCode: new Map([['DE-1', 'DE']]),
      }),
      'EU',
    );
    assert.equal(resolveAnalyticsSite({ station: '', category: null }), '其他');
  });

  it('extracts dept with overseas prefix', () => {
    assert.equal(
      extractAnalyticsDept('DJ02\\Amazon项目1组-第一曲线-US\\卧室-床'),
      '项目1组',
    );
    assert.equal(
      extractAnalyticsDept('海外事业\\海外项目3组-EU\\户外'),
      '海外项目3组',
    );
    assert.equal(extractAnalyticsDept('DJ01-郑州大件\\无项目\\叶子'), 'DJ01-郑州大件');
    assert.equal(extractAnalyticsDept(null), '(未分组)');
  });

  it('extracts category leaf', () => {
    assert.equal(
      extractAnalyticsCategoryLeaf('A\\B\\办公-电脑桌Desks'),
      '办公-电脑桌Desks',
    );
    assert.equal(extractAnalyticsCategoryLeaf(''), '(未分类)');
  });

  it('formats ISO week labels', () => {
    assert.equal(isoWeekLabel('2024-01-01'), '2024-W01');
    assert.equal(isoWeekLabel('bad'), null);
  });
});
