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
  /** 网络级（ALL）规划：直接使用全站预测，不按仓拆分也不标 no_share */
  networkScope?: boolean;
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

/** 按周期 key 排序后，最近 3 个正值的均值；没有正值时为 0。 */
/** 全网看板曲线：已采纳需求计划优先，否则保持已发布预测。 */
export function networkConsensusForecastRecord(input: {
  source: 'demand_plan' | 'forecast';
  demandMap: Map<string, number>;
  published: Record<string, number> | null;
}): Record<string, number> | null {
  if (input.source !== 'demand_plan') return input.published;
  const record: Record<string, number> = {};
  for (const [key, value] of input.demandMap) {
    if (Number.isFinite(value) && value > 0) record[key] = value;
  }
  return Object.keys(record).length ? record : input.published;
}

/** 分仓健康度：已采纳需求计划已是该仓曲线，不再按销售占比缩放预测。 */
export function warehouseConsensusForecastMap(input: {
  source: 'demand_plan' | 'forecast' | null | undefined;
  demandMap: Map<string, number> | null | undefined;
  shareScaledForecast: Map<string, number>;
}): Map<string, number> {
  if (input.source === 'demand_plan' && input.demandMap && input.demandMap.size > 0) {
    return input.demandMap;
  }
  return input.shareScaledForecast;
}

export function meanOfLastThreePositive(map: Map<string, number>): number {
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

/** 预测口径：物理仓按销售占比拆全站预测；无占比回退全站并标 no_share */
function forecastFallback(
  input: ResolvePlanningDemandInput,
  flags: PlanningDemandFlag[],
): PlanningDemandResult {
  const championMap = championMapFromRows(input.championWarehouseRows);
  const useWarehouseShare = !input.networkScope && input.hasShare;
  const demandMap = useWarehouseShare ? championMap : input.stationForecastMap;
  const outFlags = [...flags];
  if (!input.networkScope && !input.hasShare && !outFlags.includes('no_share')) {
    outFlags.push('no_share');
  }
  return {
    demandMap,
    championMap,
    source: 'forecast',
    flags: outFlags,
    fallbackDaily: meanOfLastThreePositive(demandMap),
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
  if (input.demandRows.length === 0) {
    const flags: PlanningDemandFlag[] = ['demand_missing_fallback_forecast'];
    if (!input.hasShare) flags.push('no_share');
    return forecastFallback(input, flags);
  }

  const demandMap = monthMapFromRows(input.demandRows);
  const flags: PlanningDemandFlag[] = ['pilot_hit'];
  if (!input.hasShare) flags.push('no_share');
  return {
    demandMap,
    championMap: input.hasShare
      ? championMapFromRows(input.championWarehouseRows)
      : new Map<string, number>(),
    source: 'demand_plan',
    flags,
    fallbackDaily: meanOfLastThreePositive(demandMap),
  };
}