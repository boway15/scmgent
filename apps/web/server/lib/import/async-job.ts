import type { ImportType } from './handlers.js';
import { runImport } from './handlers.js';
import type { SalesXiaoshouWideInput } from './sales-xiaoshou.js';
import { finalizeImportBatch, countSalesHistoryRowsForBatch } from './batch.js';
import { ASYNC_IMPORT_ROW_THRESHOLD } from './import-constants.js';
import { formatImportDbError } from './format-import-db-error.js';

export { ASYNC_IMPORT_ROW_THRESHOLD };

/** 大批量导入在后台执行，避免 HTTP 长时间阻塞导致 Failed to fetch */
export function scheduleImportJob(params: {
  type: ImportType;
  rows: Array<Record<string, string>>;
  userId: string;
  batchId: string;
  planMeta?: {
    name?: string;
    planDate?: string;
    deliveryDate?: string;
    merchantCode?: string;
    merchantName?: string;
  };
  salesXiaoshou?: SalesXiaoshouWideInput;
}): void {
  setImmediate(() => {
    void (async () => {
      const startedAt = Date.now();
      try {
        const result = await runImport(
          params.type,
          params.rows,
          params.userId,
          params.planMeta,
          params.batchId,
          params.salesXiaoshou,
        );
        await finalizeImportBatch(params.batchId, result);
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        console.info(
          `[import] batch ${params.batchId} ${params.type} done: imported=${result.imported} errors=${result.errors.length} elapsed=${elapsedSec}s`,
        );
      } catch (err) {
        const partialImported = await countSalesHistoryRowsForBatch(params.batchId);
        console.error(`[import] batch ${params.batchId} ${params.type} failed after ${partialImported} rows`, err);
        await finalizeImportBatch(params.batchId, {
          imported: partialImported,
          errors: [formatImportDbError(err)],
        });
      }
    })();
  });
}

