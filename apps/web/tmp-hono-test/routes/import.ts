import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  parseImportContent,
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
  BATCH_TRACKED_IMPORT_TYPES,
  buildImportPreviewResponse,
} from '../lib/import/preview.js';

export const importRoutes = new Hono();

const VALID_TYPES: ImportType[] = ['skus', 'inventory', 'sales', 'safety_stock', 'pmc_plans'];

const BATCH_TRACKED_TYPES = BATCH_TRACKED_IMPORT_TYPES;

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
  let rows: Array<Record<string, string>> = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ message: 'file required' }, 400);
    }
    try {
      assertUploadFile(file);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseXlsxBuffer(buffer);
    } else {
      rows = parseImportContent(new TextDecoder().decode(buffer));
    }
  } else {
    const body = await c.req.json<{ csv?: string }>();
    if (!body.csv?.trim()) return c.json({ message: 'csv content required' }, 400);
    rows = parseImportContent(body.csv);
  }

  try {
    assertRowCount(rows);
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
  ) {
    const preview = await buildImportPreviewResponse(type, rows);
    if (preview.hasBlockingIssues && BATCH_TRACKED_TYPES.has(type)) {
      return c.json(
        {
          message: 'Import blocked by validation issues',
          validationIssues: preview.validationIssues,
        },
        400,
      );
    }

    let batchId: string | undefined;
    if (BATCH_TRACKED_TYPES.has(type)) {
      const batch = await createImportBatch({
        type,
        fileName,
        rowCount: rows.length,
        userId: user.id,
      });
      batchId = batch.id;
    }

    const result = await runImport(type, rows, user.id, planMeta, batchId);
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

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ message: 'file required' }, 400);
    }
    try {
      assertUploadFile(file);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    let rows;
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseXlsxBuffer(buffer);
    } else {
      rows = parseImportContent(new TextDecoder().decode(buffer));
    }
    try {
      assertRowCount(rows);
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
    assertRowCount(rows);
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
