import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDemandPlanPilotConfig } from './demand-plan-config.js';

describe('parseDemandPlanPilotConfig', () => {
  it('defaults to disabled empty lists', () => {
    const c = parseDemandPlanPilotConfig({});
    assert.equal(c.enabled, false);
    assert.deepEqual(c.projectGroups, []);
    assert.deepEqual(c.warehouses, []);
  });

  it('parses true and comma lists with trim', () => {
    const c = parseDemandPlanPilotConfig({
      DEMAND_PLAN_PILOT_ENABLED: 'true',
      DEMAND_PLAN_PILOT_PROJECT_GROUPS: '项目6组, 项目7组',
      DEMAND_PLAN_PILOT_WAREHOUSES: 'US-WEST',
    });
    assert.equal(c.enabled, true);
    assert.deepEqual(c.projectGroups, ['项目6组', '项目7组']);
    assert.deepEqual(c.warehouses, ['US-WEST']);
  });

  it('treats TRUE only as enabled', () => {
    assert.equal(parseDemandPlanPilotConfig({ DEMAND_PLAN_PILOT_ENABLED: '1' }).enabled, false);
  });
});
