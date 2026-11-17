/** 与 `apps/web/server/lib/forecast-calibration-guard.ts` 规则一致（前端抽屉/矩阵可编辑性） */
export const CALIBRATION_LEAF_VIEW_HINT =
  '仅当分平台，且区域为「分区域」或只筛选一个销售区域时，支持逐行校准与导出校准表；多区合计请使用「导入校准」。';

/** 未分区域且不是恰好单区时，视为区域合计，不可逐行校准。 */
export function isMergedRegionCalibrationView(input: {
  splitByRegion: boolean;
  salesRegions?: readonly string[];
}): boolean {
  const regionCount = input.salesRegions?.length ?? 0;
  return !input.splitByRegion && regionCount !== 1;
}

export function canEditForecastCalibration(input: {
  mergedChannelView: boolean;
  splitByRegion: boolean;
  salesRegions?: readonly string[];
}): boolean {
  if (input.mergedChannelView) return false;
  return !isMergedRegionCalibrationView(input);
}

export function canExportCalibrationTable(input: {
  channelView?: string | null;
  splitByRegion: boolean;
  salesRegions?: readonly string[];
}): boolean {
  return input.channelView === 'by_channel' && !isMergedRegionCalibrationView(input);
}
