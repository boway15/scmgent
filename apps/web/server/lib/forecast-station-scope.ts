/**
 * 销量导入无站点维度时，预测统一使用 station=ALL（全站合并）。
 * 渠道/platform 仍可按 V4.1 分平台写入与查询。
 */
export const FORECAST_GLOBAL_STATION = 'ALL';

export function normalizeForecastStation(raw?: string | null): string {
  const normalized = raw?.trim().toUpperCase();
  if (!normalized || normalized === FORECAST_GLOBAL_STATION) {
    return FORECAST_GLOBAL_STATION;
  }
  return normalized;
}

export function isForecastGlobalStation(raw?: string | null): boolean {
  return normalizeForecastStation(raw) === FORECAST_GLOBAL_STATION;
}

/** 基线生成始终单站（全站合并），忽略用户传入的站点。 */
export function resolveBaselineGenerateStations(_input?: {
  station?: string;
  skuCode?: string;
  allStations?: string[];
}): string[] {
  return [FORECAST_GLOBAL_STATION];
}

export function resolveForecastGenerationStation(_raw?: string | null): string {
  return FORECAST_GLOBAL_STATION;
}
