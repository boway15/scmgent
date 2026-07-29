import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTriggerReason,
  formatSuggestionExplain,
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
    qtyConfirmedOpen: 5,
    qtyReserved: 20,
  },
};

describe('reorder-suggestion-explain', () => {
  it('formats structured explain from metrics', () => {
    const text = formatSuggestionExplain(fullMetrics, baseItem);
    assert.match(text, /^触发原因：手工备注原因/);
    assert.match(text, /库存位置：135 = 可售 100 \+ 生产 20 \+ 在途 30 \+ 已确认未生产 5 − 已分配 20/);
    assert.match(text, /日均需求：8（销售预测）/);
    assert.match(text, /总提前期：87 = 生产 30 \+ 国内 2 \+ 订舱 3 \+ 海运 40 \+ 清关 5 \+ 入仓 7/);
    assert.match(text, /安全库存天数 14 · 目标覆盖 101 天 · 建议量 200 · 建议下单日 2026-08-01 · 提前期档案 profile-1/);
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
});
