export type ImportBatchProgressMeta = {
  estimatedDailyRows?: number;
  processedSkuWideRows?: number;
  phase?: 'writing' | 'aggregating' | 'pruning';
};

export type ImportBatchListItem = {
  id: string;
  type: string;
  fileName?: string | null;
  rowCount: number;
  successCount: number;
  errorCount: number;
  status: string;
  errorSummary?: string | null;
  createdAt: string;
  dailyRowsWritten?: number;
  progressMeta?: ImportBatchProgressMeta | null;
};

export function formatImportBatchStatus(batch: ImportBatchListItem): string {
  if (batch.status === 'pending') {
    if (batch.progressMeta?.phase === 'aggregating') {
      return '聚合月表…';
    }
    if (batch.progressMeta?.phase === 'pruning') {
      return '裁剪日表…';
    }
    return '导入中…';
  }
  if (batch.status === 'success') return '成功';
  if (batch.status === 'partial') return '部分成功';
  if (batch.status === 'failed') return '失败';
  return batch.status;
}

export function formatImportBatchCounts(batch: ImportBatchListItem): {
  primary: string;
  secondary?: string;
} {
  if (batch.type === 'sales') {
    const dailyWritten = batch.dailyRowsWritten ?? batch.successCount;
    const estimated = batch.progressMeta?.estimatedDailyRows;
    const skuDone = batch.progressMeta?.processedSkuWideRows ?? 0;
    const skuTotal = batch.rowCount;

    if (batch.status === 'pending') {
      const dailyPart =
        estimated && estimated > 0
          ? `日销量 ${dailyWritten.toLocaleString()} / 约 ${estimated.toLocaleString()}`
          : `日销量 ${dailyWritten.toLocaleString()}`;
      return {
        primary: dailyPart,
        secondary: `SKU 宽表 ${skuDone.toLocaleString()} / ${skuTotal.toLocaleString()}`,
      };
    }

    return {
      primary: `日销量 ${dailyWritten.toLocaleString()}`,
      secondary: `宽表 ${skuTotal.toLocaleString()} SKU`,
    };
  }

  return {
    primary: `${batch.successCount.toLocaleString()} / ${batch.rowCount.toLocaleString()}`,
  };
}
