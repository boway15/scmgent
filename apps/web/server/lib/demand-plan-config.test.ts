import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEMAND_PLAN_WAREHOUSE_ALL,
  isProjectGroupInPilot,
  isUnallocatedPlanWarehouse,
  isWarehouseInPilot,
  parseDemandPlanPilotConfig,
} from './demand-plan-config.js';

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

  it('treats empty and ALL as unallocated plan warehouse', () => {
    assert.equal(isUnallocatedPlanWarehouse(DEMAND_PLAN_WAREHOUSE_ALL), true);
    assert.equal(isUnallocatedPlanWarehouse(''), true);
    assert.equal(isUnallocatedPlanWarehouse('US-WEST'), false);
  });

  it('treats empty warehouse list as all warehouses in pilot', () => {
    const config = parseDemandPlanPilotConfig({
      DEMAND_PLAN_PILOT_ENABLED: 'true',
      DEMAND_PLAN_PILOT_PROJECT_GROUPS: '项目6组',
    });
    assert.equal(isWarehouseInPilot('US-WEST', config), true);
    assert.equal(isWarehouseInPilot('US-EAST', config), true);
    assert.equal(isProjectGroupInPilot('项目6组', config), true);
    assert.equal(isProjectGroupInPilot('其他组', config), false);
  });
});
