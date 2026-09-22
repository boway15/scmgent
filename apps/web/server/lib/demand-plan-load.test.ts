import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChampionWarehouseRows,
  loadPlanningDemandForSkuWarehouse,
} from './demand-plan-load.js';

const stationForecastMap = new Map<string, number>([
  ['2026-09', 10],
  ['2026-10', 20],
]);

const westMeta = { turnoverSnapshot: { 美西: '1' } };

const pilotEnv = {
  DEMAND_PLAN_PILOT_ENABLED: 'true',
  DEMAND_PLAN_PILOT_PROJECT_GROUPS: '项目6组',
  DEMAND_PLAN_PILOT_WAREHOUSES: 'US-WEST',
};

describe('buildChampionWarehouseRows', () => {
  it('returns empty rows when share is null', () => {
    assert.deepEqual(buildChampionWarehouseRows(stationForecastMap, null), []);
  });

  it('scales each month by warehouse share', () => {
    assert.deepEqual(buildChampionWarehouseRows(stationForecastMap, 0.4), [
      { period: '2026-09', daily: 4 },
      { period: '2026-10', daily: 8 },
    ]);
  });
});

describe('loadPlanningDemandForSkuWarehouse', () => {
  it('does not load published demand rows when pilot is disabled', async () => {
    let publishedCalls = 0;
    let adoptionCalls = 0;
    const result = await loadPlanningDemandForSkuWarehouse(
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        championForecastMap: stationForecastMap,
      },
      {
        env: { DEMAND_PLAN_PILOT_ENABLED: 'false' },
        loadSku: async () => ({
          projectGroup: '项目6组',
          spuId: 'spu-1',
          isActive: true,
          encodingMeta: westMeta,
        }),
        loadSiblingSkus: async () => {
          throw new Error('sibling query should be skipped when disabled');
        },
        loadAdoption: async () => {
          adoptionCalls += 1;
          throw new Error('adoption should not be queried when disabled');
        },
        loadPublishedDemandRows: async () => {
          publishedCalls += 1;
          throw new Error('published demand should not be queried when disabled');
        },
      },
    );
    assert.equal(publishedCalls, 0);
    assert.equal(adoptionCalls, 0);
    assert.equal(result.source, 'forecast');
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, []);
    assert.equal(result.championMap.get('2026-10'), 20);
  });

  it('uses demand rows on pilot hit even when station forecast was passed in', async () => {
    let publishedCalls = 0;
    const result = await loadPlanningDemandForSkuWarehouse(
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        championForecastMap: stationForecastMap,
      },
      {
        env: pilotEnv,
        loadSku: async () => ({
          projectGroup: '项目6组',
          spuId: 'spu-1',
          isActive: true,
          encodingMeta: westMeta,
        }),
        loadSiblingSkus: async () => [
          { skuId: 'sku-1', projectGroup: '项目6组', spuId: 'spu-1', isActive: true },
        ],
        loadAdoption: async () => ({
          source: 'demand_plan',
          demandPlanVersionId: 'version-1',
        }),
        loadPublishedDemandRows: async () => {
          publishedCalls += 1;
          return [
            { period: '2026-W03', systemDailyAvg: '3', manualDailyAvg: null },
            { period: '2026-W04', systemDailyAvg: '5', manualDailyAvg: '8' },
          ];
        },
      },
    );
    assert.equal(publishedCalls, 1);
    assert.equal(result.source, 'demand_plan');
    assert.deepEqual(result.flags, ['pilot_hit']);
    assert.equal(result.demandMap.get('2026-W03'), 3);
    assert.equal(result.demandMap.get('2026-W04'), 8);
    assert.equal(result.championMap.get('2026-10'), 20);
  });

  it('uses forecast when adoption row is missing', async () => {
    let publishedCalls = 0;
    const result = await loadPlanningDemandForSkuWarehouse(
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        championForecastMap: stationForecastMap,
      },
      {
        env: pilotEnv,
        loadSku: async () => ({
          projectGroup: '项目6组',
          spuId: 'spu-1',
          isActive: true,
          encodingMeta: westMeta,
        }),
        loadSiblingSkus: async () => [
          { skuId: 'sku-1', projectGroup: '项目6组', spuId: 'spu-1', isActive: true },
        ],
        loadAdoption: async () => undefined,
        loadPublishedDemandRows: async () => {
          publishedCalls += 1;
          return [{ period: '2026-W03', systemDailyAvg: 99, manualDailyAvg: null }];
        },
      },
    );
    assert.equal(publishedCalls, 0);
    assert.equal(result.source, 'forecast');
    assert.deepEqual(result.flags, []);
    assert.equal(result.demandMap, stationForecastMap);
  });

  it('leaves champion map empty and ignores demand rows when share is missing', async () => {
    const result = await loadPlanningDemandForSkuWarehouse(
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        championForecastMap: stationForecastMap,
      },
      {
        env: pilotEnv,
        loadSku: async () => ({
          projectGroup: '项目6组',
          spuId: 'spu-1',
          isActive: true,
          encodingMeta: {},
        }),
        loadSiblingSkus: async () => [
          { skuId: 'sku-1', projectGroup: '项目6组', spuId: 'spu-1', isActive: true },
        ],
        loadAdoption: async () => ({
          source: 'demand_plan',
          demandPlanVersionId: 'version-1',
        }),
        loadPublishedDemandRows: async () => [
          { period: '2026-W03', systemDailyAvg: 99, manualDailyAvg: null },
        ],
      },
    );
    assert.equal(result.source, 'forecast');
    assert.deepEqual(result.flags, ['no_share']);
    assert.equal(result.demandMap, stationForecastMap);
    assert.equal(result.demandMap.get('2026-10'), 20);
    assert.equal(result.championMap.size, 0);
  });
});
