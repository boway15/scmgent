import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSuggestionsByUrgency,
  deriveProjectedStockoutDate,
  deriveTriggerReason,
  formatSuggestionExplain,
  isSuggestedOrderOverdue,
} from './reorder-suggestion-explain.js';

const baseItem = {
  reason: '手工备注原因',
  healthStatus: 'red',
  coverageDays: '12.5',
  suggestedQty: 200,
  suggestedDate: '2026-08-01',
  totalLeadDays: 87,
};

const fullMetrics = {
  demandSource: 'forecast',
  avgDaily: 8,
  leadTimeProfileId: 'profile-1',
  productionDays: 30,
  domesticDays: 2,
  bookingDays: 3,
  transitDays: 40,
  customsDays: 5,
  inboundDays: 7,
  totalLeadDays: 87,
  safetyStockDays: 14,
  targetCoverageDays: 101,
  inventoryPosition: {
    effectiveQty: 135,
    qtyAvailable: 100,
    qtyInProduction: 20,
    qtyInTransit: 30,
    qtyConfirmedOpen: 0,
    qtyReserved: 20,
    dedupeMode: 'snapshot_only',
    unassignedOpenQty: 0,
  },
};

describe('reorder-suggestion-explain', () => {
  it('formats structured explain from metrics', () => {
    const text = formatSuggestionExplain(fullMetrics, baseItem);
    assert.match(text, /^触发原因：手工备注原因/);
    assert.match(text, /库存位置：135 = 可售 100 \+ 生产 20 \+ 在途 30 − 已分配 20（飞书快照，不含跟单）/);
    assert.match(text, /日均需求：8（销售预测）/);
    assert.match(text, /总提前期：87 = 生产 30 \+ 国内 2 \+ 订舱 3 \+ 海运 40 \+ 清关 5 \+ 入仓 7/);
    assert.match(text, /安全库存天数 14 · 目标覆盖 101 天 · 建议量 200 · 建议下单日 2026-08-01 · 提前期档案 profile-1/);
    assert.doesNotMatch(text, /跟单仅补/);
    assert.doesNotMatch(text, /未归属仓跟单/);
    assert.match(text, /预计断货日：/);
  });

  it('falls back to reason when metrics incomplete', () => {
    assert.equal(
      formatSuggestionExplain({ demandSource: 'historical' }, baseItem),
      '手工备注原因',
    );
    assert.equal(formatSuggestionExplain(null, baseItem), '手工备注原因');
  });

  it('derives avgDaily from coverage when missing in metrics', () => {
    const { avgDaily: _omit, ...withoutAvg } = fullMetrics;
    const text = formatSuggestionExplain(withoutAvg, baseItem);
    assert.match(text, /日均需求：10\.8（销售预测）/);
  });

  it('labels stockout-adjusted historical demand', () => {
    const text = formatSuggestionExplain(
      {
        ...fullMetrics,
        demandSource: 'historical',
        stockoutAdjusted: true,
        inStockDays: 63,
        demandWindowDays: 90,
      },
      baseItem,
    );
    assert.match(text, /日均需求：8（断货修正历史，63\/90 天有货）/);
  });

  it('derives trigger reason from health when reason empty', () => {
    assert.match(
      deriveTriggerReason({
        ...baseItem,
        reason: '',
      }),
      /覆盖低于总提前期/,
    );
    assert.match(
      deriveTriggerReason({
        ...baseItem,
        reason: '',
        healthStatus: 'yellow',
      }),
      /补货计划窗口/,
    );
  });

  it('derives projected stockout date from coverage days', () => {
    assert.equal(
      deriveProjectedStockoutDate('12.5', new Date('2026-07-01T00:00:00.000Z')),
      '2026-07-14',
    );
    assert.equal(deriveProjectedStockoutDate(null), null);
  });

  it('flags overdue suggested order dates', () => {
    assert.equal(isSuggestedOrderOverdue('2026-01-01', new Date('2026-07-01')), true);
    assert.equal(isSuggestedOrderOverdue('2026-08-01', new Date('2026-07-01')), false);
  });

  it('sorts pending and overdue suggestions first', () => {
    const sorted = [
      { status: 'accepted', suggestedDate: '2026-07-01', coverageDays: '5', healthStatus: 'red' },
      { status: 'pending', suggestedDate: '2026-08-01', coverageDays: '20', healthStatus: 'yellow' },
      { status: 'pending', suggestedDate: '2026-07-10', coverageDays: '8', healthStatus: 'red' },
    ].slice().sort(compareSuggestionsByUrgency);
    assert.equal(sorted[0].suggestedDate, '2026-07-10');
    assert.equal(sorted[1].suggestedDate, '2026-08-01');
    assert.equal(sorted[2].status, 'accepted');
  });
});
