import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateSafetyStockValues } from './safety-stock.js';

const recentDate = new Date().toISOString().slice(0, 10);

describe('calculateSafetyStockValues', () => {
  it('uses coverage days when coverage_days is selected', () => {
    const result = calculateSafetyStockValues({
      sales: [{ qtySold: 180, saleDate: recentDate }],
      leadTimeDays: 30,
      unitCost: 1,
      method: 'coverage_days',
      safetyStockDays: 14,
    });

    assert.equal(result.safetyStockQty, 28);
    assert.equal(result.reorderPoint, 88);
    assert.equal(result.safetyStockMethod, 'coverage_days');
    assert.equal(result.serviceLevel, null);
  });

  it('uses sales standard deviation when z_demand has no stored sigma', () => {
    const result = calculateSafetyStockValues({
      sales: [
        { qtySold: 2, saleDate: recentDate },
        { qtySold: 8, saleDate: recentDate.replace(/.$/, (day) => String(Math.max(0, Number(day) - 1))) },
      ],
      leadTimeDays: 4,
      unitCost: 1,
      method: 'z_demand',
      serviceLevel: 0.95,
    });

    assert.equal(result.demandStdDev, 3);
    assert.equal(result.safetyStockQty, 10);
    assert.equal(result.safetyStockMethod, 'z_demand');
    assert.equal(result.serviceLevel, 0.95);
  });

  it('uses the provided sigma for z_demand_leadtime', () => {
    const result = calculateSafetyStockValues({
      sales: [{ qtySold: 90, saleDate: recentDate }],
      leadTimeDays: 4,
      unitCost: 1,
      method: 'z_demand_leadtime',
      serviceLevel: 0.99,
      demandStdDev: 5,
      leadTimeStdDev: 2,
    });

    assert.equal(result.demandStdDev, 5);
    assert.equal(result.leadTimeStdDev, 2);
    assert.equal(result.safetyStockQty, 24);
  });
});
