export type PlanningDemandFlag =
  | 'pilot_hit'
  | 'fallback_forecast'
  | 'no_share'
  | 'cross_spu_excluded'
  | 'demand_missing_fallback_forecast';

export type PlanningDemandResult = {
  demandMap: Map<string, number>;
  championMap: Map<string, number>;
  source: 'demand_plan' | 'forecast';
  flags: PlanningDemandFlag[];
  fallbackDaily: number;
};

type DemandRow = {
  period: string;
  systemDailyAvg: number;
  manualDailyAvg: number | null;
};

type ChampionRow = {
  period: string;
  daily: number;
};

type ResolvePlanningDemandInput = {
  pilotEnabled: boolean;
  adoptionSource: 'forecast' | 'demand_plan';
  excludedSpu: boolean;
  hasShare: boolean;
  demandRows: DemandRow[]; // period 可为 YYYY-Www
  championWarehouseRows: ChampionRow[];
  stationForecastMap: Map<string, number>;
};

export function effectiveDemandDaily(
  systemDailyAvg: number,
  manualDailyAvg: number | null,
): number {
  return manualDailyAvg ?? systemDailyAvg;
}

export function monthMapFromRows(rows: DemandRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.period, effectiveDemandDaily(row.systemDailyAvg, row.manualDailyAvg));
  }
  return map;
}

function championMapFromRows(rows: ChampionRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.period, row.daily]));
}

function meanOfLastThreePositive(map: Map<string, number>): number {
  const positives = [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
    .filter((value) => value > 0);
  if (positives.length === 0) {
    return 0;
  }
  const lastThree = positives.slice(-3);
  return lastThree.reduce((sum, value) => sum + value, 0) / lastThree.length;
}

function forecastFallback(
  input: ResolvePlanningDemandInput,
  flags: PlanningDemandFlag[],
): PlanningDemandResult {
  return {
    demandMap: input.stationForecastMap,
    championMap: championMapFromRows(input.championWarehouseRows),
    source: 'forecast',
    flags,
    fallbackDaily: meanOfLastThreePositive(input.stationForecastMap),
  };
}

export function resolvePlanningDemandFromInputs(
  input: ResolvePlanningDemandInput,
): PlanningDemandResult {
  if (input.excludedSpu) {
    return forecastFallback(input, ['cross_spu_excluded']);
  }
  if (!input.pilotEnabled) {
    return forecastFallback(input, []);
  }
  if (input.adoptionSource !== 'demand_plan') {
    return forecastFallback(input, []);
  }
  if (!input.hasShare) {
    return forecastFallback(input, ['no_share']);
  }
  if (input.demandRows.length === 0) {
    return forecastFallback(input, ['demand_missing_fallback_forecast']);
  }

  const demandMap = monthMapFromRows(input.demandRows);
  return {
    demandMap,
    championMap: championMapFromRows(input.championWarehouseRows),
    source: 'demand_plan',
    flags: ['pilot_hit'],
    fallbackDaily: meanOfLastThreePositive(demandMap),
  };
}

export function pickDemandMapForTimeline(input: {
  source: 'demand_plan' | 'forecast';
  demandMap: Map<string, number>;
  stationForecastMap: Map<string, number>;
}): Map<string, number> {
  return input.source === 'demand_plan' ? input.demandMap : input.stationForecastMap;
}
