import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  effectiveDemandDaily,
  monthMapFromRows,
  pickDemandMapForTimeline,
  resolvePlanningDemandFromInputs,
} from './demand-plan-resolve.js';

const stationForecastMap = new Map<string, number>([
  ['2026-08', 7],
  ['2026-09', 9],
  ['2026-10', 11],
]);

const championWarehouseRows = [
  { period: '2026-08', daily: 2 },
  { period: '2026-09', daily: 3 },
  { period: '2026-10', daily: 4 },
];

const demandRows = [
  { period: '2026-08', systemDailyAvg: 5, manualDailyAvg: null },
  { period: '2026-09', systemDailyAvg: 5, manualDailyAvg: 8 },
  { period: '2026-10', systemDailyAvg: 6, manualDailyAvg: null },
];

function baseInput(
  overrides: Partial<Parameters<typeof resolvePlanningDemandFromInputs>[0]> = {},
) {
  return {
    pilotEnabled: false,
    adoptionSource: 'forecast' as const,
    excludedSpu: false,
    hasShare: true,
    demandRows,
    championWarehouseRows,
    stationForecastMap,
    ...overrides,
  };
}

describe('effectiveDemandDaily', () => {
  it('prefers manual daily when present', () => {
    assert.equal(effectiveDemandDaily(5, 8), 8);
  });

  it('uses system daily when manual is null', () => {
    assert.equal(effectiveDemandDaily(5, null), 5);
  });
});

describe('monthMapFromRows', () => {
  it('maps period to effective daily', () => {
    const map = monthMapFromRows(demandRows);
    assert.equal(map.get('2026-08'), 5);
    assert.equal(map.get('2026-09'), 8);
    assert.equal(map.get('2026-10'), 6);
  });

  it('maps weekly period keys into demandMap', () => {
    const map = monthMapFromRows([
      { period: '2026-W03', systemDailyAvg: 4, manualDailyAvg: null },
    ]);
    assert.equal(map.get('2026-W03'), 4);
  });
});

describe('resolvePlanningDemandFromInputs', () => {
  it('uses station forecast when excluded even if in pilot', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        excludedSpu: true,
      }),
    );
    assert.equal(result.source, 'forecast');
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, ['cross_spu_excluded']);
    assert.deepEqual([...result.championMap.entries()], [
      ['2026-08', 2],
      ['2026-09', 3],
      ['2026-10', 4],
    ]);
  });

  it('uses station forecast with empty flags when not in pilot', () => {
    const result = resolvePlanningDemandFromInputs(baseInput());
    assert.equal(result.source, 'forecast');
    assert.equal(result.demandMap, stationForecastMap);
    assert.notEqual(result.demandMap.get('2026-10'), 4);
    assert.equal(result.demandMap.get('2026-10'), 11);
    assert.deepEqual(result.flags, []);
    assert.deepEqual([...result.championMap.entries()], [
      ['2026-08', 2],
      ['2026-09', 3],
      ['2026-10', 4],
    ]);
  });

  it('falls back to station forecast with no_share when in pilot without share', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        hasShare: false,
      }),
    );
    assert.equal(result.source, 'forecast');
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, ['no_share']);
  });

  it('falls back to station forecast when in pilot with share but no demand rows', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        hasShare: true,
        demandRows: [],
      }),
    );
    assert.equal(result.source, 'forecast');
    assert.equal(result.demandMap, stationForecastMap);
    assert.deepEqual(result.flags, ['demand_missing_fallback_forecast']);
  });

  it('uses demand rows and champion rows on pilot hit', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        hasShare: true,
      }),
    );
    assert.equal(result.source, 'demand_plan');
    assert.deepEqual(result.flags, ['pilot_hit']);
    assert.equal(result.demandMap.get('2026-08'), 5);
    assert.equal(result.demandMap.get('2026-09'), 8);
    assert.equal(result.demandMap.get('2026-10'), 6);
    assert.equal(result.demandMap.get('2026-10') !== stationForecastMap.get('2026-10'), true);
    assert.deepEqual([...result.championMap.entries()], [
      ['2026-08', 2],
      ['2026-09', 3],
      ['2026-10', 4],
    ]);
  });

  it('puts weekly period keys into demandMap on adoption hit', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        demandRows: [
          { period: '2026-W03', systemDailyAvg: 4, manualDailyAvg: null },
        ],
      }),
    );
    assert.equal(result.source, 'demand_plan');
    assert.equal(result.demandMap.get('2026-W03'), 4);
  });

  it('ignores weekly rows when pilot disabled even if adopted', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({ pilotEnabled: false, adoptionSource: 'demand_plan', demandRows }),
    );
    assert.equal(result.source, 'forecast');
  });

  it('uses forecast when adopted weekly but demandRows empty', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        demandRows: [],
      }),
    );
    assert.equal(result.source, 'forecast');
    assert.deepEqual(result.flags, ['demand_missing_fallback_forecast']);
  });

  it('uses mean of last three positive demand values as fallbackDaily on pilot hit', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({
        pilotEnabled: true,
        adoptionSource: 'demand_plan',
        hasShare: true,
        demandRows: [
          { period: '2026-06', systemDailyAvg: 10, manualDailyAvg: null },
          { period: '2026-07', systemDailyAvg: 0, manualDailyAvg: null },
          { period: '2026-08', systemDailyAvg: 20, manualDailyAvg: null },
          { period: '2026-09', systemDailyAvg: 30, manualDailyAvg: null },
          { period: '2026-10', systemDailyAvg: 40, manualDailyAvg: null },
        ],
      }),
    );
    assert.equal(result.source, 'demand_plan');
    assert.equal(result.fallbackDaily, 30);
  });

  it('uses mean of last three positive station values as fallbackDaily on forecast', () => {
    const station = new Map<string, number>([
      ['2026-06', 4],
      ['2026-07', 0],
      ['2026-08', 6],
      ['2026-09', 8],
      ['2026-10', 10],
    ]);
    const result = resolvePlanningDemandFromInputs(
      baseInput({ stationForecastMap: station }),
    );
    assert.equal(result.source, 'forecast');
    assert.equal(result.fallbackDaily, 8);
  });

  it('uses zero fallbackDaily when station map has no positive values', () => {
    const result = resolvePlanningDemandFromInputs(
      baseInput({ stationForecastMap: new Map() }),
    );
    assert.equal(result.source, 'forecast');
    assert.equal(result.fallbackDaily, 0);
  });
});

describe('pickDemandMapForTimeline', () => {
  it('uses demand map when source is demand_plan', () => {
    const demand = new Map([['2026-10', 2]]);
    const forecast = new Map([['2026-10', 1]]);
    assert.equal(
      pickDemandMapForTimeline({
        source: 'demand_plan',
        demandMap: demand,
        stationForecastMap: forecast,
      }).get('2026-10'),
      2,
    );
  });

  it('uses station forecast when source is forecast', () => {
    const demand = new Map([['2026-10', 2]]);
    const forecast = new Map([['2026-10', 1]]);
    assert.equal(
      pickDemandMapForTimeline({
        source: 'forecast',
        demandMap: demand,
        stationForecastMap: forecast,
      }).get('2026-10'),
      1,
    );
  });
});
