import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChampionWarehouseRows,
  loadPlanningDemandForSkuWarehouse,
  scaleDemandRowsByShare,
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
    assert.deepEqual([...result.demandMap.entries()], [...stationForecastMap.entries()]);
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
    assert.deepEqual([...result.demandMap.entries()], [...stationForecastMap.entries()]);
  });

  const disabledDeps = (encodingMeta: unknown) => ({
    env: { DEMAND_PLAN_PILOT_ENABLED: 'false' },
    loadSku: async () => ({
      projectGroup: '项目6组',
      spuId: 'spu-1',
      isActive: true,
      encodingMeta,
    }),
  });

  it('splits station forecast by sales share for non-pilot warehouses', async () => {
    const meta = { turnoverSnapshot: { 美西: '0.6', 美东: '0.4' } };
    const east = await loadPlanningDemandForSkuWarehouse(
      { skuId: 'sku-1', warehouseCode: 'US-EAST', championForecastMap: stationForecastMap },
      disabledDeps(meta),
    );
    assert.equal(east.demandMap.get('2026-10'), 8);
    assert.deepEqual(east.flags, []);

    const south = await loadPlanningDemandForSkuWarehouse(
      { skuId: 'sku-1', warehouseCode: 'US-SOUTH', championForecastMap: stationForecastMap },
      disabledDeps(meta),
    );
    assert.equal(south.demandMap.get('2026-10'), 0);
    assert.equal(south.fallbackDaily, 0);
  });

  it('falls back to station forecast with no_share for warehouses without a share column', async () => {
    const result = await loadPlanningDemandForSkuWarehouse(
      { skuId: 'sku-1', warehouseCode: 'UK', championForecastMap: stationForecastMap },
      disabledDeps({ turnoverSnapshot: { 美西: '1' } }),
    );
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, ['no_share']);
  });

  it('keeps station forecast without flags for network ALL', async () => {
    const result = await loadPlanningDemandForSkuWarehouse(
      { skuId: 'sku-1', warehouseCode: 'ALL', championForecastMap: stationForecastMap },
      disabledDeps({ turnoverSnapshot: { 美西: '1' } }),
    );
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, []);
  });

  it('falls back to forecast when share is missing and rows are network ALL', async () => {
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
    assert.deepEqual(result.flags, ['demand_missing_fallback_forecast', 'no_share']);
    assert.equal(result.demandMap, stationForecastMap);
    assert.equal(result.demandMap.get('2026-10'), 20);
    assert.equal(result.championMap.size, 0);
  });

  it('loads ALL plan rows first and scales by warehouse share', async () => {
    const adoptionWarehouses: string[] = [];
    const rowWarehouses: string[] = [];
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
          encodingMeta: { turnoverSnapshot: { 美西: '0.6', 美东: '0.4' } },
        }),
        loadSiblingSkus: async () => [
          { skuId: 'sku-1', projectGroup: '项目6组', spuId: 'spu-1', isActive: true },
        ],
        loadAdoption: async (input) => {
          adoptionWarehouses.push(input.warehouseCode);
          if (input.warehouseCode === 'ALL') {
            return { source: 'demand_plan', demandPlanVersionId: 'version-1' };
          }
          return undefined;
        },
        loadPublishedDemandRows: async (input) => {
          rowWarehouses.push(input.warehouseCode);
          if (input.warehouseCode !== 'ALL') return [];
          return [
            { period: '2026-W03', systemDailyAvg: 10, manualDailyAvg: 5 },
          ];
        },
      },
    );
    assert.deepEqual(adoptionWarehouses, ['ALL', 'ALL']);
    assert.deepEqual(rowWarehouses, ['ALL']);
    assert.equal(result.source, 'demand_plan');
    assert.equal(result.demandMap.get('2026-W03'), 3);
    assert.equal(result.championMap.get('2026-10'), 12);
  });

  it('enables global ALL adoption for SKUs outside legacy pilot groups', async () => {
    let publishedCalls = 0;
    const result = await loadPlanningDemandForSkuWarehouse(
      {
        skuId: 'sku-2',
        warehouseCode: 'US-EAST',
        championForecastMap: stationForecastMap,
      },
      {
        env: pilotEnv,
        loadSku: async () => ({
          projectGroup: '项目99组',
          spuId: 'spu-2',
          isActive: true,
          encodingMeta: { turnoverSnapshot: { 美东: '1' } },
        }),
        loadSiblingSkus: async () => [
          { skuId: 'sku-2', projectGroup: '项目99组', spuId: 'spu-2', isActive: true },
        ],
        loadAdoption: async (input) => {
          if (
            input.projectGroup === 'ALL' &&
            input.warehouseCode === 'ALL'
          ) {
            return { source: 'demand_plan', demandPlanVersionId: 'version-all' };
          }
          return undefined;
        },
        loadPublishedDemandRows: async () => {
          publishedCalls += 1;
          return [{ period: '2026-W03', systemDailyAvg: 4, manualDailyAvg: null }];
        },
      },
    );
    assert.equal(publishedCalls, 1);
    assert.equal(result.source, 'demand_plan');
    assert.equal(result.demandMap.get('2026-W03'), 4);
  });
});

describe('scaleDemandRowsByShare', () => {
  it('scales system and manual daily by warehouse share', () => {
    assert.deepEqual(
      scaleDemandRowsByShare(
        [
          { period: '2026-W03', systemDailyAvg: 10, manualDailyAvg: 5 },
          { period: '2026-W04', systemDailyAvg: 8, manualDailyAvg: null },
        ],
        0.6,
      ),
      [
        { period: '2026-W03', systemDailyAvg: 6, manualDailyAvg: 3 },
        { period: '2026-W04', systemDailyAvg: 4.8, manualDailyAvg: null },
      ],
    );
  });
});
