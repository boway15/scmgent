import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPlanningExcludedSqlCondition,
  extractCommercialStatusRaw,
  extractProductStatusRaw,
  isPlanningExcluded,
  normalizeCommercialStatus,
  pickStricterCommercialStatusNorm,
  shouldPreferCommercialStatusUpdate,
} from './commercial-status.js';

describe('normalizeCommercialStatus', () => {
  it('maps discontinued and phase-out keywords', () => {
    assert.equal(normalizeCommercialStatus('已停售'), 'discontinued');
    assert.equal(normalizeCommercialStatus('Discontinued SKU'), 'discontinued');
    assert.equal(normalizeCommercialStatus('即将停售'), 'phase_out');
    assert.equal(normalizeCommercialStatus('Clearance'), 'phase_out');
    assert.equal(normalizeCommercialStatus('Active'), 'active');
    assert.equal(normalizeCommercialStatus('在售'), 'active');
    assert.equal(normalizeCommercialStatus('其他状态'), 'unknown');
    assert.equal(normalizeCommercialStatus(''), null);
  });
});

describe('isPlanningExcluded', () => {
  it('respects commercial norm before lifecycle keywords', () => {
    assert.equal(
      isPlanningExcluded({ lifecycle: '新品', commercialStatusNorm: 'discontinued' }),
      true,
    );
    assert.equal(
      isPlanningExcluded({ lifecycle: '停售', commercialStatusNorm: 'active' }),
      false,
    );
    assert.equal(isPlanningExcluded({ lifecycle: '即将停售', commercialStatusNorm: null }), true);
    assert.equal(isPlanningExcluded({ lifecycle: '新品', commercialStatusNorm: 'unknown' }), false);
  });
});

describe('buildPlanningExcludedSqlCondition', () => {
  it('includes commercial_status_norm and lifecycle fallback', () => {
    const sql = buildPlanningExcludedSqlCondition({
      lifecycleColumnSql: 'lifecycle',
      commercialStatusNormColumnSql: 'commercial_status_norm',
    });
    assert.match(sql, /commercial_status_norm/);
    assert.match(sql, /discontinued/);
    assert.match(sql, /phase_out/);
    assert.match(sql, /停售/);
  });
});

describe('extractProductStatusRaw', () => {
  it('reads product status only, not sales lifecycle', () => {
    assert.equal(extractProductStatusRaw({ 产品状态: '停售' }), '停售');
    assert.equal(extractProductStatusRaw({ 生命周期: '间歇', 产品状态: 'Active' }), 'Active');
    assert.equal(extractProductStatusRaw({ 生命周期: '新品' }), null);
  });
});

describe('extractCommercialStatusRaw', () => {
  it('reads lifecycle and product status aliases', () => {
    assert.equal(extractCommercialStatusRaw({ 生命周期: '停售' }), '停售');
    assert.equal(extractCommercialStatusRaw({ 产品状态: 'Active' }), 'Active');
    assert.equal(extractCommercialStatusRaw({ SKU: 'A' }), null);
  });

  it('ignores non-scalar payload fields', () => {
    assert.equal(
      extractCommercialStatusRaw({
        生命周期: { nested: true },
        turnoverExtras: ['x'],
        SKU: 'A1',
      }),
      null,
    );
    assert.equal(extractCommercialStatusRaw({ 产品状态: 0 }), '0');
  });
});

describe('commercial status merge helpers', () => {
  it('picks the stricter norm', () => {
    assert.equal(pickStricterCommercialStatusNorm('active', 'discontinued'), 'discontinued');
    assert.equal(pickStricterCommercialStatusNorm('phase_out', 'active'), 'phase_out');
  });

  it('prefers higher-ranked sources when severity increases', () => {
    assert.equal(
      shouldPreferCommercialStatusUpdate({
        currentSource: 'erp_query',
        nextSource: 'erp_turnover',
        currentNorm: 'active',
        nextNorm: 'discontinued',
      }),
      true,
    );
    assert.equal(
      shouldPreferCommercialStatusUpdate({
        currentSource: 'erp_turnover',
        nextSource: 'erp_query',
        currentNorm: 'discontinued',
        nextNorm: 'active',
      }),
      false,
    );
  });
});
