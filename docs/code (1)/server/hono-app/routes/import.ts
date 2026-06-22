import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context';
import {
  parseImportContent,
  parseXlsxBuffer,
  runImport,
  type ImportType,
} from '../lib/import/handlers';
import { requireImportAccess, requireMenu } from '../lib/rbac';
import { assertRowCount, assertUploadFile } from '../lib/upload-guard';

export const importRoutes = new Hono();

const VALID_TYPES: ImportType[] = ['skus', 'inventory', 'sales', 'safety_stock', 'pmc_plans', 'compliance'];

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

  const headers = rows.length ? Object.keys(rows[0]) : [];
  return c.json({
    rowCount: rows.length,
    headers,
    preview: rows.slice(0, 10),
  });
});

importRoutes.post('/import/:type', requireImportAccess(), async (c) => {
  const user = await getCurrentUser(c);
  const type = c.req.param('type') as ImportType;

  if (!VALID_TYPES.includes(type)) {
    return c.json({ message: `Invalid import type. Use: ${VALID_TYPES.join(', ')}` }, 400);
  }

  const contentType = c.req.header('content-type') ?? '';

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
    const result = await runImport(type, rows, user.id, planMeta);
    return c.json(result);
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

  const result = await runImport(type, rows, user.id, planMeta);
  return c.json(result);
});

/** Legacy endpoints */
importRoutes.post('/import/inventory', requireMenu('data.import'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ csv: string }>();
  if (!body.csv?.trim()) return c.json({ message: 'csv content required' }, 400);
  const rows = parseImportContent(body.csv);
  const result = await runImport('inventory', rows, user.id);
  return c.json(result);
});

importRoutes.post('/import/sales', requireMenu('data.import'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ csv: string }>();
  if (!body.csv?.trim()) return c.json({ message: 'csv content required' }, 400);
  const rows = parseImportContent(body.csv);
  const result = await runImport('sales', rows, user.id);
  return c.json(result);
});
