import { Hono } from 'hono';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { assertUploadFile } from '../lib/upload-guard.js';
import {
  createPriceBookItem,
  disablePriceBookItem,
  listPriceBook,
  updatePriceBookItem,
} from '../lib/product-costing/price-book.js';
import { importPriceBookWorkbook } from '../lib/product-costing/price-book-import.js';

export const productCostingRoutes = new Hono();

const menuGuard = requireMenu('procurement.costing');

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && String(current.code) === '23505') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function requiredText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

productCostingRoutes.get('/procurement/costing/price-book', menuGuard, async (c) => {
  const activeOnlyRaw = c.req.query('activeOnly');
  const items = await listPriceBook({
    q: c.req.query('q') || undefined,
    category: c.req.query('category') || undefined,
    activeOnly: activeOnlyRaw === 'true' || activeOnlyRaw === '1',
  });
  return c.json({ items });
});

productCostingRoutes.post(
  '/procurement/costing/price-book',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const category = requiredText(body?.category);
    const materialName = requiredText(body?.materialName);
    const unit = requiredText(body?.unit);
    const unitPrice = nonnegativeNumber(body?.unitPrice);
    if (!category || !materialName || !unit || unitPrice === null) {
      return c.json({ message: '大类、材料名称、单位和非负单价为必填项' }, 400);
    }

    try {
      const item = await createPriceBookItem({
        category,
        materialName,
        spec: typeof body?.spec === 'string' ? body.spec : undefined,
        unit,
        unitPrice,
        notes: typeof body?.notes === 'string' ? body.notes : undefined,
      });
      return c.json(item, 201);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json({ message: '同名规格单位已存在' }, 409);
      }
      throw error;
    }
  },
);

productCostingRoutes.patch(
  '/procurement/costing/price-book/:id',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ message: '请求体格式错误' }, 400);

    const patch: Partial<{
      category: string;
      materialName: string;
      spec: string;
      unit: string;
      unitPrice: number;
      notes: string;
    }> = {};
    for (const key of ['category', 'materialName', 'unit'] as const) {
      if (body[key] !== undefined) {
        const value = requiredText(body[key]);
        if (!value) return c.json({ message: `${key} 不能为空` }, 400);
        patch[key] = value;
      }
    }
    if (body.spec !== undefined) patch.spec = String(body.spec ?? '').trim();
    if (body.notes !== undefined) patch.notes = String(body.notes ?? '').trim();
    if (body.unitPrice !== undefined) {
      const unitPrice = nonnegativeNumber(body.unitPrice);
      if (unitPrice === null) return c.json({ message: '单价必须为非负数' }, 400);
      patch.unitPrice = unitPrice;
    }

    try {
      const item = await updatePriceBookItem(c.req.param('id')!, patch);
      if (!item) return c.json({ message: 'Not found' }, 404);
      return c.json(item);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return c.json({ message: '同名规格单位已存在' }, 409);
      }
      throw error;
    }
  },
);

productCostingRoutes.post(
  '/procurement/costing/price-book/:id/disable',
  menuGuard,
  requireWrite(),
  async (c) => {
    const disabled = await disablePriceBookItem(c.req.param('id')!);
    if (!disabled) return c.json({ message: 'Not found' }, 404);
    return c.json({ ok: true });
  },
);

productCostingRoutes.post(
  '/procurement/costing/price-book/import',
  menuGuard,
  requireWrite(),
  async (c) => {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ message: '请上传 xlsx 文件' }, 400);
    }

    try {
      assertUploadFile(file, 'product-costing-price-book');
      const name = file.name.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        return c.json({ message: '仅支持 .xlsx / .xls 格式' }, 400);
      }
      const result = await importPriceBookWorkbook(await file.arrayBuffer());
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败';
      return c.json({ message }, 400);
    }
  },
);
