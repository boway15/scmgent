import type { ImportType } from './handlers.js';
import { runImport } from './handlers.js';
import type { SalesXiaoshouWideInput } from './sales-xiaoshou.js';
import { finalizeImportBatch, countSalesHistoryRowsForBatch } from './batch.js';
import { ASYNC_IMPORT_ROW_THRESHOLD } from './import-constants.js';

export { ASYNC_IMPORT_ROW_THRESHOLD };

function formatImportDbError(err: unknown): string {
  const pg = err as { code?: string; message?: string };
  if (pg.code === '22001') {
    return `字段值超出数据库长度限制：${pg.message ?? '请检查 SKU 编码等列'}`;
  }
  if (pg.code === '22021' || (pg.message && pg.message.includes('0x00'))) {
    return 'CSV 含非法空字节（NUL），请重新导出或联系数据方修复；服务端已尝试自动清洗，若仍失败请换一份文件';
  }
  if (pg.code === '23505') {
    return '存在重复数据（唯一约束冲突），请检查 sku_code 是否重复';
  }
  if (pg.message) return pg.message;
  return err instanceof Error ? err.message : 'Import failed';
}

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

