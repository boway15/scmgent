import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcSafetyStockQty, zFromServiceLevel } from './safety-stock-z.js';

describe('zFromServiceLevel', () => {
  it('maps standard service levels to Z scores', () => {
    assert.equal(zFromServiceLevel(0.9), 1.28);
    assert.equal(zFromServiceLevel(0.95), 1.65);
    assert.equal(zFromServiceLevel(0.975), 1.96);
    assert.equal(zFromServiceLevel(0.99), 2.33);
  });

  it('picks nearest Z for unknown service levels', () => {
    assert.equal(zFromServiceLevel(0.92), 1.28);
    assert.equal(zFromServiceLevel(0.97), 1.96);
    assert.equal(zFromServiceLevel(0.985), 2.33);
  });
});

describe('calcSafetyStockQty', () => {
  it('uses coverage_days with ceil(avgDaily * safetyStockDays)', () => {
    const result = calcSafetyStockQty({
      method: 'coverage_days',
      avgDaily: 2.3,
      safetyStockDays: 14,
      demandStdDev: 0,
      totalLeadDays: 30,
    });
    assert.equal(result.method, 'coverage_days');
    assert.equal(result.safetyStockQty, 33);
    assert.equal(result.z, undefined);
  });

  it('returns 0 for coverage_days when avgDaily is missing', () => {
    const result = calcSafetyStockQty({
      method: 'coverage_days',
      safetyStockDays: 14,
      demandStdDev: 0,
      totalLeadDays: 30,
    });
    assert.equal(result.safetyStockQty, 0);
  });

  it('computes z_demand as ceil(Z * sigma_d * sqrt(L))', () => {
    const result = calcSafetyStockQty({
      method: 'z_demand',
      serviceLevel: 0.95,
      demandStdDev: 5,
      totalLeadDays: 30,
    });
    assert.equal(result.method, 'z_demand');
    assert.equal(result.z, 1.65);
    assert.equal(result.safetyStockQty, 46);
  });

  it('defaults service level to 0.95 for z_demand', () => {
    const result = calcSafetyStockQty({
      method: 'z_demand',
      demandStdDev: 5,
      totalLeadDays: 30,
    });
    assert.equal(result.z, 1.65);
    assert.equal(result.safetyStockQty, 46);
  });

  it('computes z_demand_leadtime with demand and lead time variance', () => {
    const result = calcSafetyStockQty({
      method: 'z_demand_leadtime',
      serviceLevel: 0.95,
      demandStdDev: 5,
      totalLeadDays: 30,
      avgDaily: 10,
      leadTimeStdDev: 2,
    });
    assert.equal(result.method, 'z_demand_leadtime');
    assert.equal(result.z, 1.65);
    assert.equal(result.safetyStockQty, 56);
  });

  it('treats missing leadTimeStdDev as zero in z_demand_leadtime', () => {
    const demandOnly = calcSafetyStockQty({
      method: 'z_demand_leadtime',
      serviceLevel: 0.95,
      demandStdDev: 5,
      totalLeadDays: 30,
      avgDaily: 10,
    });
    const zDemand = calcSafetyStockQty({
      method: 'z_demand',
      serviceLevel: 0.95,
      demandStdDev: 5,
      totalLeadDays: 30,
    });
    assert.equal(demandOnly.safetyStockQty, zDemand.safetyStockQty);
  });
});
