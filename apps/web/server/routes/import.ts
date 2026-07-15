import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  parseImportContent,
  parseImportBuffer,
  parseXlsxBuffer,
  runImport,
  type ImportType,
} from '../lib/import/handlers.js';
import { requireImportAccess, requireMenu } from '../lib/rbac.js';
import { assertRowCount, assertUploadFile } from '../lib/upload-guard.js';
import {
  createImportBatch,
  finalizeImportBatch,
  listImportBatches,
} from '../lib/import/batch.js';
import {
  ASYNC_IMPORT_ROW_THRESHOLD,
  scheduleImportJob,
} from '../lib/import/async-job.js';
import {
  BATCH_TRACKED_IMPORT_TYPES,
  buildImportPreviewResponse,
} from '../lib/import/preview.js';
import {
  buildSalesXiaoshouPreviewResponse,
  detectXiaoshouWideKind,
  estimateDailySalesExpansionFromHeaders,
  salesXiaoshouSkuRowCount,
  shouldRunSalesXiaoshouImportAsync,
  wideRowsFromBuffer,
  type SalesXiaoshouWideInput,
} from '../lib/import/sales-xiaoshou.js';
import {
  countWideCsvSkuRows,
  saveSalesImportTempFile,
  wideCsvBufferToRowObjectsSample,
} from '../lib/import/sales-csv-stream.js';

export const importRoutes = new Hono();

const VALID_TYPES: ImportType[] = [
  'skus',
  'inventory',
  'sales',
  'safety_stock',
  'merchants',
  'pmc_plans',
];

const BATCH_TRACKED_TYPES = BATCH_TRACKED_IMPORT_TYPES;

function formatImportDbError(err: unknown): string {
  const pg = err as { code?: string; message?: string };
  if (pg.code === '22001') {
    const msg = pg.message ?? '';
    if (msg.includes('variant_no') || msg.includes('character varying(2)')) {
      return '变参号超出长度限制（legacy 编码如 DJ502313_342 变参可为 3 位）。请执行数据库迁移后重试，或检查 sku_code';
    }
    return `字段值超出数据库长度限制：${msg || '请检查 SKU 编码、变参号、供应商编码等列'}`;
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

async function loadSalesCsvUpload(file: File): Promise<{
  buffer: Buffer;
  fileName: string;
  sample: Array<Record<string, string>>;
  skuRowCount: number;
}> {
  assertUploadFile(file, 'sales');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    throw new Error('销量历史 xiaoshou 宽表请使用 CSV 导出（xlsx 列头无法保留 (YYYY-MM-DD) 格式）');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sample = wideCsvBufferToRowObjectsSample(buffer, 50);
  const kind = detectXiaoshouWideKind(sample);
  if (kind === 'monthly_sku') {
    throw new Error(
      'SKU 月销量宽表已不再支持单独导入，请改传产品销售报表-每日宽表（列头含 (YYYY-MM-DD)），月表将自动从日表聚合',
    );
  }
  if (kind !== 'daily') {
    throw new Error('无法识别销量文件：需为产品销售报表-每日宽表（列头含 (YYYY-MM-DD)）');
  }

  const skuRowCount = countWideCsvSkuRows(buffer);
  assertRowCount(Array.from({ length: skuRowCount }), 'sales');
  return { buffer, fileName: file.name, sample, skuRowCount };
}

function salesFileFromForm(form: FormData): File {
  const dailyFile = form.get('dailyFile');
  const file = form.get('file');
  const uploadFile = dailyFile instanceof File ? dailyFile : file instanceof File ? file : null;
  if (!uploadFile) {
    throw new Error('请上传日销量 CSV（产品销售报表-每日宽表）');
  }
  return uploadFile;
}

importRoutes.get('/import/batches', requireMenu('data.import'), async (c) => {
  const type = c.req.query('type') ?? undefined;
  const batches = await listImportBatches(type, 30);
  return c.json(batches);
});

importRoutes.post('/import/:type/preview', requireImportAccess(), async (c) => {
  const type = c.req.param('type') as ImportType;
  if (!VALID_TYPES.includes(type)) {
    return c.json({ message: `Invalid import type. Use: ${VALID_TYPES.join(', ')}` }, 400);
  }

  const contentType = c.req.header('content-type') ?? '';

  if (type === 'sales') {
    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        { message: '销量历史请使用文件上传（xiaoshou 日销量宽表 CSV），不支持粘贴导入' },
        400,
      );
    }
    try {
      const form = await c.req.formData();
      const upload = await loadSalesCsvUpload(salesFileFromForm(form));
      const xiaoshou: SalesXiaoshouWideInput = {
        dailyWideRows: upload.sample,
        skuWideRowCount: upload.skuRowCount,
      };
      return c.json(
        buildSalesXiaoshouPreviewResponse(xiaoshou, {
          lightweight: upload.skuRowCount > upload.sample.length,
        }),
      );
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
  }

  let rows: Array<Record<string, string>> = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ message: 'file required' }, 400);
    }
    try {
      assertUploadFile(file, type);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseXlsxBuffer(buffer);
    } else {
      rows = parseImportBuffer(buffer);
    }
  } else {
    const body = await c.req.json<{ csv?: string }>();
    if (!body.csv?.trim()) return c.json({ message: 'csv content required' }, 400);
    rows = parseImportContent(body.csv);
  }

  try {
    assertRowCount(rows, type);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
  }

  return c.json(await buildImportPreviewResponse(type, rows));
});

importRoutes.post('/import/:type', requireImportAccess(), async (c) => {
  const user = await getCurrentUser(c);
  const type = c.req.param('type') as ImportType;

  if (!VALID_TYPES.includes(type)) {
    return c.json({ message: `Invalid import type. Use: ${VALID_TYPES.join(', ')}` }, 400);
  }

  const contentType = c.req.header('content-type') ?? '';

  async function executeImport(
    rows: Array<Record<string, string>>,
    fileName?: string,
    planMeta?: {
      name?: string;
      planDate?: string;
      deliveryDate?: string;
      merchantCode?: string;
      merchantName?: string;
    },
    salesXiaoshou?: SalesXiaoshouWideInput,
  ) {
    const preview =
      type === 'sales' && salesXiaoshou
        ? buildSalesXiaoshouPreviewResponse(salesXiaoshou, {
            lightweight: shouldRunSalesXiaoshouImportAsync(salesXiaoshou),
          })
        : await buildImportPreviewResponse(type, rows);

    if (preview.hasBlockingIssues && BATCH_TRACKED_TYPES.has(type)) {
      return c.json(
        {
          message: 'Import blocked by validation issues',
          validationIssues: preview.validationIssues,
        },
        400,
      );
    }

    const rowCount =
      type === 'sales' && salesXiaoshou
        ? salesXiaoshouSkuRowCount(salesXiaoshou)
        : rows.length;

    let batchId: string | undefined;
    if (BATCH_TRACKED_TYPES.has(type)) {
      const progressMeta =
        type === 'sales' && salesXiaoshou
          ? {
              estimatedDailyRows: estimateDailySalesExpansionFromHeaders(
                Object.keys(salesXiaoshou.dailyWideRows?.[0] ?? {}),
                salesXiaoshouSkuRowCount(salesXiaoshou),
              ).expandedRowEstimate,
              processedSkuWideRows: 0,
              phase: 'writing' as const,
            }
          : undefined;
      const batch = await createImportBatch({
        type,
        fileName,
        rowCount,
        userId: user.id,
        progressMeta,
      });
      batchId = batch.id;
    }

    const useAsync =
      Boolean(batchId) &&
      BATCH_TRACKED_TYPES.has(type) &&
      (type === 'sales' && salesXiaoshou
        ? shouldRunSalesXiaoshouImportAsync(salesXiaoshou)
        : rowCount >= ASYNC_IMPORT_ROW_THRESHOLD);

    const estimatedDailyRows =
      type === 'sales' && salesXiaoshou
        ? estimateDailySalesExpansionFromHeaders(
            Object.keys(salesXiaoshou.dailyWideRows?.[0] ?? {}),
            salesXiaoshouSkuRowCount(salesXiaoshou),
          ).expandedRowEstimate
        : undefined;

    if (useAsync && batchId) {
      scheduleImportJob({
        type,
        rows,
        userId: user.id,
        batchId,
        planMeta,
        salesXiaoshou,
      });
      const salesMessage =
        type === 'sales' && estimatedDailyRows
          ? `已提交后台导入：宽表 ${rowCount.toLocaleString()} 个 SKU，预估约 ${estimatedDailyRows.toLocaleString()} 条日销量。请勿重启服务，在下方批次查看进度（全量约需数小时）。`
          : `已提交后台导入 ${rowCount} 行，请在下方的导入批次中查看进度`;
      return c.json(
        {
          imported: 0,
          errors: [] as string[],
          batchId,
          batchStatus: 'pending',
          async: true,
          rowCount,
          estimatedDailyRows,
          validationIssues: preview.validationIssues,
          message: salesMessage,
        },
        202,
      );
    }

    let result;
    try {
      result = await runImport(type, rows, user.id, planMeta, batchId, salesXiaoshou);
    } catch (err) {
      if (batchId) {
        await finalizeImportBatch(batchId, { imported: 0, errors: [formatImportDbError(err)] });
      }
      return c.json({ message: formatImportDbError(err) }, 400);
    }
    let batchStatus: string | undefined;
    if (batchId) {
      const finalized = await finalizeImportBatch(batchId, result);
      batchStatus = finalized.status;
    }

    return c.json({
      ...result,
      batchId,
      batchStatus,
      validationIssues: preview.validationIssues,
    });
  }

  if (type === 'sales') {
    if (!contentType.includes('multipart/form-data')) {
      return c.json(
        { message: '销量历史请使用文件上传（xiaoshou 日销量宽表 CSV），不支持粘贴导入' },
        400,
      );
    }
    try {
      const form = await c.req.formData();
      const upload = await loadSalesCsvUpload(salesFileFromForm(form));
      const xiaoshouPreview: SalesXiaoshouWideInput = {
        dailyWideRows: upload.sample,
        skuWideRowCount: upload.skuRowCount,
      };
      const useAsync = shouldRunSalesXiaoshouImportAsync(xiaoshouPreview);

      if (useAsync) {
        const preview = buildSalesXiaoshouPreviewResponse(xiaoshouPreview, { lightweight: true });
        if (preview.hasBlockingIssues) {
          return c.json(
            { message: 'Import blocked by validation issues', validationIssues: preview.validationIssues },
            400,
          );
        }

        const estimatedDailyRows = estimateDailySalesExpansionFromHeaders(
          Object.keys(upload.sample[0] ?? {}),
          upload.skuRowCount,
        ).expandedRowEstimate;

        const batch = await createImportBatch({
          type: 'sales',
          fileName: upload.fileName,
          rowCount: upload.skuRowCount,
          userId: user.id,
          progressMeta: {
            estimatedDailyRows,
            processedSkuWideRows: 0,
            phase: 'writing',
          },
        });

        const tempFilePath = await saveSalesImportTempFile(batch.id, upload.buffer);
        scheduleImportJob({
          type: 'sales',
          rows: [],
          userId: user.id,
          batchId: batch.id,
          salesXiaoshou: {
            tempFilePath,
            skuWideRowCount: upload.skuRowCount,
            batchId: batch.id,
          },
        });

        return c.json(
          {
            imported: 0,
            errors: [] as string[],
            batchId: batch.id,
            batchStatus: 'pending',
            async: true,
            rowCount: upload.skuRowCount,
            estimatedDailyRows,
            validationIssues: preview.validationIssues,
            message: `已提交后台导入：宽表 ${upload.skuRowCount.toLocaleString()} 个 SKU，预估约 ${estimatedDailyRows.toLocaleString()} 条日销量。请勿重启 Docker，在下方批次查看进度（全量约需数小时）。`,
          },
          202,
        );
      }

      const xiaoshouFull: SalesXiaoshouWideInput = {
        dailyWideRows: wideRowsFromBuffer(upload.buffer.buffer.slice(
          upload.buffer.byteOffset,
          upload.buffer.byteOffset + upload.buffer.byteLength,
        )),
        skuWideRowCount: upload.skuRowCount,
      };
      return executeImport([], upload.fileName, undefined, xiaoshouFull);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
  }

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ message: 'file required' }, 400);
    }
    try {
      assertUploadFile(file, type);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    let rows;
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseXlsxBuffer(buffer);
    } else {
      rows = parseImportBuffer(buffer);
    }
    try {
      assertRowCount(rows, type);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
    }
    const planMeta =
      type === 'pmc_plans'
        ? {
            name: String(form.get('planName') ?? ''),
            planDate: String(form.get('planDate') ?? ''),
            deliveryDate: String(form.get('deliveryDate') ?? ''),
            merchantCode: String(form.get('merchantCode') ?? ''),
            merchantName: String(form.get('merchantName') ?? ''),
          }
        : undefined;
    return executeImport(rows, file.name, planMeta);
  }

  const body = await c.req.json<{
    csv?: string;
    planName?: string;
    planDate?: string;
    deliveryDate?: string;
    merchantCode?: string;
    merchantName?: string;
  }>();

  if (!body.csv?.trim()) return c.json({ message: 'csv content required' }, 400);
  const rows = parseImportContent(body.csv);
  try {
    assertRowCount(rows, type);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
  }

  const planMeta =
    type === 'pmc_plans'
      ? {
          name: body.planName,
          planDate: body.planDate,
          deliveryDate: body.deliveryDate,
          merchantCode: body.merchantCode,
          merchantName: body.merchantName,
        }
      : undefined;

  return executeImport(rows, undefined, planMeta);
});
