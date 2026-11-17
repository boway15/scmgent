export type ForecastCalibrationLeaf = {
  platform: string;
  salesRegion: string;
};

/**
 * 区域合计视图：未分区域，且不是恰好筛选一个区域。
 * 单区筛选时行仍是该区叶子，允许校准。
 */
export function isMergedRegionCalibrationView(input: {
  splitByRegion: boolean;
  salesRegions?: readonly string[];
}): boolean {
  const regionCount = input.salesRegions?.length ?? 0;
  return !input.splitByRegion && regionCount !== 1;
}

export function assertCalibrationWritableLeaf(
  row: ForecastCalibrationLeaf,
): { ok: true } | { ok: false; message: string } {
  const platform = row.platform?.trim().toUpperCase() ?? '';
  const salesRegion = row.salesRegion?.trim().toUpperCase() ?? '';

  if (platform === 'ALL') {
    return {
      ok: false,
      message:
        '全平台预测行不可直接校准，请在分平台视图编辑或使用「导入校准」写回各渠道',
    };
  }
  if (salesRegion === 'ALL') {
    return {
      ok: false,
      message:
        '全区域预测行不可直接校准，请切换「分区域」或「导入校准」写回各销售区域',
    };
  }
  return { ok: true };
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
