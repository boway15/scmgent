import type { ImportResult } from './handlers.js';
import { persistDailySalesRowsAsHistory } from '../sales-history-import.js';
import { aggregateSalesHistoryMonthlyFromDaily } from '../sales-history-monthly.js';
import { updateImportBatchProgress } from './batch.js';
import { salesImportMinSaleDate } from '../sales-history-config.js';
import {
  iterateWideCsvRowChunks,
  readWideCsvHeadersFromFile,
  removeSalesImportTempFile,
} from './sales-csv-stream.js';
import {
  detectDailySalesDateColumns,
  detectSkuMonthlySalesColumns,
  estimateDailySalesExpansion,
  parseDailySalesRows,
  parseDailySalesRowsAsync,
  wideCsvBufferToRowObjects,
} from '../sales-report-parser.js';
import { ASYNC_IMPORT_ROW_THRESHOLD } from './import-constants.js';
import { pruneSalesHistoryDailyBeyondRetention } from '../sales-history-retention.js';

/** 日宽表按 SKU 行分片导入，避免一次展开数千万日销量行导致 OOM */
export const SALES_WIDE_IMPORT_CHUNK_SIZE = 25;

export type XiaoshouWideKind = 'daily' | 'monthly_sku';

export type SalesXiaoshouWideInput = {
  /** 小文件同步导入 */
  dailyWideRows?: Array<Record<string, string>>;
  /** 大文件后台导入：落盘 UTF-8 后按行流式读取 */
  tempFilePath?: string;
  skuWideRowCount?: number;
  batchId?: string;
};

export type SalesXiaoshouImportResult = ImportResult & {
  createdSkus?: number;
  enrichedSkus?: number;
  insertedDailyRows?: number;
  skippedDailyRows?: number;
  upsertedMonthlyRows?: number;
  expandedDailyRows?: number;
  prunedDailyRows?: number;
  dailyRetentionCutoff?: string;
};

export function wideRowsFromBuffer(buffer: ArrayBuffer): Array<Record<string, string>> {
  return wideCsvBufferToRowObjects(buffer);
}

export function detectXiaoshouWideKind(rows: Array<Record<string, string>>): XiaoshouWideKind | null {
  if (!rows.length) return null;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (detectDailySalesDateColumns(headers).length > 0) return 'daily';
  if (detectSkuMonthlySalesColumns(headers).length > 0) return 'monthly_sku';
  return null;
}

export function isXiaoshouSalesWideRows(rows: Array<Record<string, string>>): boolean {
  return detectXiaoshouWideKind(rows) === 'daily';
}

export function salesXiaoshouSkuRowCount(input: SalesXiaoshouWideInput): number {
  return input.skuWideRowCount ?? input.dailyWideRows?.length ?? 0;
}

export function estimateDailySalesExpansionFromHeaders(
  headers: string[],
  skuRowCount: number,
  minSaleDate?: string,
) {
  const dateColumnCount = detectDailySalesDateColumns(headers, minSaleDate).length;
  return {
    skuRowCount,
    dateColumnCount,
    expandedRowEstimate: skuRowCount * dateColumnCount,
  };
}

/** @deprecated use estimateDailySalesExpansionFromHeaders */
export function estimateDailySalesExpansionFromSample(
  sampleRows: Array<Record<string, string>>,
  skuRowCount: number,
) {
  const headers = sampleRows.length
    ? Array.from(new Set(sampleRows.flatMap((row) => Object.keys(row))))
    : [];
  return estimateDailySalesExpansionFromHeaders(headers, skuRowCount);
}

/** 宽表按 SKU 行数或最坏展开行数判断是否后台导入 */
export function shouldRunSalesXiaoshouImportAsync(input: SalesXiaoshouWideInput): boolean {
  const skuRows = salesXiaoshouSkuRowCount(input);
  if (!skuRows) return false;

  if (input.tempFilePath) {
    return skuRows >= ASYNC_IMPORT_ROW_THRESHOLD;
  }

  const rows = input.dailyWideRows ?? [];
  const { expandedRowEstimate } = estimateDailySalesExpansion(rows);
  return skuRows >= ASYNC_IMPORT_ROW_THRESHOLD || expandedRowEstimate >= ASYNC_IMPORT_ROW_THRESHOLD;
}

export type SalesXiaoshouPreview = {
  rowCount: number;
  headers: string[];
  preview: Array<Record<string, string>>;
  validationIssues: Array<{ row: number; field?: string; message: string }>;
  hasBlockingIssues: boolean;
  salesDiagnostics: {
    daily: ReturnType<typeof parseDailySalesRows>['diagnostics'] | null;
  };
};

function previewSlice(rows: Array<Record<string, string>>, limit = 3): Array<Record<string, string>> {
  return rows.slice(0, limit).map((row) => {
    const keys = Object.keys(row);
    const slim: Record<string, string> = {};
    for (const key of keys.slice(0, 10)) {
      slim[key] = row[key];
    }
    if (keys.length > 10) {
      slim['…'] = `+${keys.length - 10} 列`;
    }
    return slim;
  });
}

export function buildSalesXiaoshouPreviewResponse(
  input: SalesXiaoshouWideInput,
  options?: { lightweight?: boolean },
): SalesXiaoshouPreview {
  const validationIssues: SalesXiaoshouPreview['validationIssues'] = [];
  let dailyDiagnostics: SalesXiaoshouPreview['salesDiagnostics']['daily'] = null;
  const sampleRows = input.dailyWideRows ?? [];
  const skuRowCount = salesXiaoshouSkuRowCount(input);

  if (sampleRows.length) {
    const kind = detectXiaoshouWideKind(sampleRows);
    if (kind === 'monthly_sku') {
      validationIssues.push({
        row: 1,
        message: 'SKU 月销量宽表已不再支持单独导入，请上传产品销售报表-每日宽表（列头含 (YYYY-MM-DD)）',
      });
    } else if (kind !== 'daily') {
      validationIssues.push({
        row: 1,
        message: '日销量文件不是 xiaoshou 日宽表（需含 (YYYY-MM-DD) 日期列）',
      });
    } else if (options?.lightweight || skuRowCount > sampleRows.length) {
      const estimate = estimateDailySalesExpansionFromSample(sampleRows, skuRowCount);
      const parsed = parseDailySalesRows(sampleRows.slice(0, 50));
      dailyDiagnostics = {
        rowCount: estimate.skuRowCount,
        expandedRowCount: estimate.expandedRowEstimate,
        skuCount: estimate.skuRowCount,
        startDate: parsed.diagnostics.startDate,
        endDate: parsed.diagnostics.endDate,
        stationCounts: parsed.diagnostics.stationCounts,
        platformCounts: parsed.diagnostics.platformCounts,
        errors: parsed.diagnostics.errors,
      };
      for (const error of parsed.diagnostics.errors.slice(0, 10)) {
        validationIssues.push({ row: 0, message: error });
      }
    } else {
      const parsed = parseDailySalesRows(sampleRows);
      dailyDiagnostics = parsed.diagnostics;
      for (const error of parsed.diagnostics.errors.slice(0, 10)) {
        validationIssues.push({ row: 0, message: error });
      }
    }
  }

  if (!skuRowCount) {
    validationIssues.push({ row: 0, message: '请上传日销量宽表 CSV（产品销售报表-每日）' });
  }

  const headers = sampleRows.length ? Object.keys(sampleRows[0]) : [];

  return {
    rowCount: skuRowCount,
    headers: headers.slice(0, 20),
    preview: previewSlice(sampleRows),
    validationIssues,
    hasBlockingIssues: validationIssues.some((issue) =>
      issue.message.includes('不是 xiaoshou') ||
      issue.message.includes('不再支持') ||
      issue.message.includes('请上传'),
    ),
    salesDiagnostics: {
      daily: dailyDiagnostics,
    },
  };
}

async function processWideChunk(
  input: SalesXiaoshouWideInput,
  chunkWide: Array<Record<string, string>>,
  processedSkuWideRows: number,
  estimatedDailyRows: number,
  state: {
    errors: string[];
    imported: number;
    insertedDailyRows: number;
    skippedDailyRows: number;
    createdSkus: number;
    enrichedSkus: number;
    affectedSkuIds: Set<string>;
    maxPersistErrors: number;
    isFirstChunk: boolean;
  },
): Promise<void> {
  const chunkDaily = await parseDailySalesRowsAsync(chunkWide, salesImportMinSaleDate());

  if (state.isFirstChunk) {
    state.errors.push(...chunkDaily.diagnostics.errors.slice(0, 10));
  } else if (chunkDaily.diagnostics.errors.length > 0) {
    state.errors.push(...chunkDaily.diagnostics.errors.slice(0, 2));
  }

  if (chunkDaily.rows.length === 0) {
    if (input.batchId) {
      await updateImportBatchProgress(input.batchId, {
        insertedDailyRows: state.imported,
        processedSkuWideRows,
        estimatedDailyRows,
        phase: 'writing',
      });
    }
    return;
  }

  const stats = await persistDailySalesRowsAsHistory(chunkDaily.rows, input.batchId || undefined, {
    skipMonthlyAggregate: true,
  });
  state.insertedDailyRows += stats.insertedSalesRows;
  state.skippedDailyRows += stats.skippedExistingSalesRows;
  state.createdSkus += stats.createdSkuCount;
  state.enrichedSkus += stats.enrichedSkuCount;
  for (const row of stats.rows) {
    state.affectedSkuIds.add(row.skuId);
  }
  if (stats.errors.length && state.errors.length < state.maxPersistErrors) {
    state.errors.push(...stats.errors.slice(0, state.maxPersistErrors - state.errors.length));
  }
  state.imported += stats.insertedSalesRows;

  if (input.batchId) {
    await updateImportBatchProgress(input.batchId, {
      insertedDailyRows: state.imported,
      processedSkuWideRows,
      estimatedDailyRows,
      phase: 'writing',
    });
  }
}

export async function importXiaoshouSalesHistory(
  input: SalesXiaoshouWideInput,
): Promise<SalesXiaoshouImportResult> {
  const errors: string[] = [];
  let imported = 0;
  let createdSkus = 0;
  let enrichedSkus = 0;
  let insertedDailyRows = 0;
  let skippedDailyRows = 0;
  let upsertedMonthlyRows = 0;
  let expandedDailyRows = 0;
  let prunedDailyRows = 0;
  let dailyRetentionCutoff: string | undefined;

  try {
    const hasDisk = Boolean(input.tempFilePath);
    const hasMemory = Boolean(input.dailyWideRows?.length);
    if (!hasDisk && !hasMemory) {
      return { imported: 0, errors: ['请上传日销量 xiaoshou 宽表（产品销售报表-每日 CSV）'] };
    }

    const skuRowCount = salesXiaoshouSkuRowCount(input);
    let kind: XiaoshouWideKind | null = null;
    let headers: string[] = [];

    if (input.tempFilePath) {
      headers = await readWideCsvHeadersFromFile(input.tempFilePath);
      if (detectDailySalesDateColumns(headers, salesImportMinSaleDate()).length > 0) kind = 'daily';
      else if (detectSkuMonthlySalesColumns(headers).length > 0) kind = 'monthly_sku';
    } else {
      kind = detectXiaoshouWideKind(input.dailyWideRows!);
      headers = Array.from(new Set(input.dailyWideRows!.flatMap((row) => Object.keys(row))));
    }

    if (kind === 'monthly_sku') {
      return {
        imported: 0,
        errors: ['SKU 月销量宽表已不再支持单独导入，请改传产品销售报表-每日宽表，月表将自动从日表聚合'],
      };
    }
    if (kind !== 'daily') {
      return {
        imported: 0,
        errors: ['日销量文件格式无效：需为产品销售报表-每日宽表，列头含 (YYYY-MM-DD)'],
      };
    }

    const estimate = estimateDailySalesExpansionFromHeaders(
      headers,
      skuRowCount,
      salesImportMinSaleDate(),
    );
    expandedDailyRows = estimate.expandedRowEstimate;
    const estimatedDailyRows = estimate.expandedRowEstimate;

    const affectedSkuIds = new Set<string>();
    const chunkSize = SALES_WIDE_IMPORT_CHUNK_SIZE;
    const state = {
      errors,
      imported,
      insertedDailyRows,
      skippedDailyRows,
      createdSkus,
      enrichedSkus,
      affectedSkuIds,
      maxPersistErrors: 20,
      isFirstChunk: true,
    };

    if (input.tempFilePath) {
      for await (const { rows: chunkWide, processedSkuWideRows } of iterateWideCsvRowChunks(
        input.tempFilePath,
        chunkSize,
      )) {
        await processWideChunk(input, chunkWide, processedSkuWideRows, estimatedDailyRows, state);
        state.isFirstChunk = false;
      }
    } else {
      const wideRows = input.dailyWideRows!;
      for (let offset = 0; offset < wideRows.length; offset += chunkSize) {
        const chunkWide = wideRows.slice(offset, offset + chunkSize);
        const processedSkuWideRows = Math.min(offset + chunkWide.length, wideRows.length);
        await processWideChunk(input, chunkWide, processedSkuWideRows, estimatedDailyRows, state);
        state.isFirstChunk = false;
      }
    }

    imported = state.imported;
    insertedDailyRows = state.insertedDailyRows;
    skippedDailyRows = state.skippedDailyRows;
    createdSkus = state.createdSkus;
    enrichedSkus = state.enrichedSkus;

    if (affectedSkuIds.size > 0) {
      if (input.batchId) {
        await updateImportBatchProgress(input.batchId, {
          insertedDailyRows: imported,
          processedSkuWideRows: skuRowCount,
          estimatedDailyRows,
          phase: 'aggregating',
        });
      }
      const monthlyAggregate = await aggregateSalesHistoryMonthlyFromDaily({
        skuIds: Array.from(affectedSkuIds),
        lookbackMonths: salesImportMinSaleDate() ? undefined : 'all',
      });
      upsertedMonthlyRows = monthlyAggregate.upsertedRows;

      if (input.batchId) {
        await updateImportBatchProgress(input.batchId, {
          insertedDailyRows: imported,
          processedSkuWideRows: skuRowCount,
          estimatedDailyRows,
          phase: 'pruning',
        });
      }
      const pruneResult = await pruneSalesHistoryDailyBeyondRetention();
      prunedDailyRows = pruneResult.deletedRows;
      dailyRetentionCutoff = pruneResult.cutoffDate;
    }

    return {
      imported,
      errors,
      createdSkus: createdSkus || undefined,
      enrichedSkus: enrichedSkus || undefined,
      insertedDailyRows,
      skippedDailyRows,
      upsertedMonthlyRows,
      expandedDailyRows,
      prunedDailyRows: prunedDailyRows || undefined,
      dailyRetentionCutoff,
    };
  } finally {
    await removeSalesImportTempFile(input.tempFilePath);
  }
}
