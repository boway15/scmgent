export const ALLCAT_V41_MODEL = 'allcat_kpi_corefirst_v41';

export type AllCatV41BoundedSnapshot = {
  productCategory?: string;
  effectiveTrendDecay?: number;
  monthFactor?: number;
  conservativeFactor?: number;
  tierCeiling?: number;
  nearHorizonFloor?: number | null;
  growthSignal?: boolean;
  rollingRatio?: number;
};

export type AllCatV41HorizonDisplay = AllCatV41BoundedSnapshot & {
  tier: string;
  d6: number;
  d3: number;
  trendRatio: number;
  cv6: number;
  anchorDaily?: number;
  seasonalDaily?: number;
  levelDaily?: number;
  formula: string;
  algorithm: string;
};

export function isT99ForecastTier(tier?: string | null): boolean {
  return tier === 'T99';
}

/** 当前单元格是否为 V4.1 KPI 预测（非 legacy v2 / ABCD） */
export function isAllCatV41ForecastCell(cell: {
  forecastModel?: string | null;
  allCatV41Factors?: AllCatV41HorizonDisplay | null;
}): boolean {
  return (
    cell.forecastModel === ALLCAT_V41_MODEL ||
    cell.allCatV41Factors != null
  );
}

export function isLegacyHorizonCell(cell: {
  forecastModel?: string | null;
  allCatV41Factors?: AllCatV41HorizonDisplay | null;
  horizonFactors?: unknown;
}): boolean {
  return !isAllCatV41ForecastCell(cell) && cell.horizonFactors != null;
}
