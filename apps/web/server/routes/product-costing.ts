import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { assertUploadFile } from '../lib/upload-guard.js';
import { isCostingBomWorkflowEnabled } from '../integrations/dify.js';
import {
  createPriceBookItem,
  disablePriceBookItem,
  listPriceBook,
  updatePriceBookItem,
} from '../lib/product-costing/price-book.js';
import { importPriceBookWorkbook } from '../lib/product-costing/price-book-import.js';
import { parseUnitPrice } from '../lib/product-costing/parse-unit-price.js';
import {
  assertCostingSourceAttachment,
  createBomLine,
  createCostingProject,
  deleteBomLine,
  deleteCostingProject,
  getCostingProject,
  listBomLines,
  listCostingProjects,
  replaceBomLines,
  saveSourceAttachment,
  updateBomLine,
  updateCostingProject,
  type ManualBomLineInput,
} from '../lib/product-costing/service.js';

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

function parseManualBomLine(value: unknown): ManualBomLineInput | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const materialName = requiredText(body.materialName);
  const unit = requiredText(body.unit);
  const qtyNet = body.qtyNet;
  const lossRate = body.lossRate;
  const unitPriceOverride = body.unitPriceOverride;
  if (
    !materialName ||
    !unit ||
    typeof qtyNet !== 'number' ||
    !Number.isFinite(qtyNet) ||
    qtyNet < 0 ||
    (lossRate !== undefined &&
      (typeof lossRate !== 'number' || !Number.isFinite(lossRate) || lossRate < 0)) ||
    (unitPriceOverride !== undefined &&
      unitPriceOverride !== null &&
      (typeof unitPriceOverride !== 'number' ||
        !Number.isFinite(unitPriceOverride) ||
        unitPriceOverride < 0))
  ) {
    return null;
  }
  const confidence = body.confidence;
  if (
    confidence !== undefined &&
    confidence !== 'high' &&
    confidence !== 'medium' &&
    confidence !== 'low'
  ) {
    return null;
  }
  return {
    category: requiredText(body.category) ?? '未分类',
    materialName,
    spec: typeof body.spec === 'string' ? body.spec : null,
    unit,
    qtyNet,
    lossRate: typeof lossRate === 'number' ? lossRate : undefined,
    sourceRef: typeof body.sourceRef === 'string' ? body.sourceRef : null,
    confidence,
    notes: typeof body.notes === 'string' ? body.notes : null,
    unitPriceOverride:
      typeof unitPriceOverride === 'number' || unitPriceOverride === null
        ? unitPriceOverride
        : undefined,
  };
}

productCostingRoutes.get('/procurement/costing/status', menuGuard, async (c) => {
  return c.json({
    difyEnabled: isCostingBomWorkflowEnabled(),
    preprocessMode: process.env.COSTING_PREPROCESS_MODE?.trim() || 'auto',
  });
});

productCostingRoutes.get('/procurement/costing/projects', menuGuard, async (c) => {
  return c.json({ items: await listCostingProjects() });
});

productCostingRoutes.post(
  '/procurement/costing/projects',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const name = requiredText(body?.name);
    if (!name) return c.json({ message: '请填写产品名称' }, 400);
    const user = await getCurrentUser(c);
    const created = await createCostingProject({
      name,
      category: requiredText(body?.category) ?? undefined,
      userId: user.id,
    });
    return c.json(created, 201);
  },
);

productCostingRoutes.get('/procurement/costing/projects/:id', menuGuard, async (c) => {
  const project = await getCostingProject(c.req.param('id')!);
  if (!project) return c.json({ message: '未找到核算产品' }, 404);
  return c.json(project);
});

productCostingRoutes.patch(
  '/procurement/costing/projects/:id',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ message: '请求体格式错误' }, 400);
    const patch: { name?: string; category?: string | null } = {};
    if (body.name !== undefined) {
      const name = requiredText(body.name);
      if (!name) return c.json({ message: '产品名称不能为空' }, 400);
      patch.name = name;
    }
    if (body.category !== undefined) {
      patch.category = requiredText(body.category);
    }
    const updated = await updateCostingProject(c.req.param('id')!, patch);
    if (!updated) return c.json({ message: '未找到核算产品' }, 404);
    return c.json(updated);
  },
);

productCostingRoutes.delete(
  '/procurement/costing/projects/:id',
  menuGuard,
  requireWrite(),
  async (c) => {
    await deleteCostingProject(c.req.param('id')!);
    return c.json({ ok: true });
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/attachments',
  menuGuard,
  requireWrite(),
  async (c) => {
    const projectId = c.req.param('id')!;
    const project = await getCostingProject(projectId);
    if (!project) return c.json({ message: '未找到核算产品' }, 404);
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ message: '请上传文件' }, 400);
    try {
      assertCostingSourceAttachment(file.name, file.size);
      await saveSourceAttachment({
        projectId,
        fileName: file.name,
        contentType:
          file.type ||
          (file.name.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      return c.json({ ok: true }, 201);
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '上传失败' }, 400);
    }
  },
);

productCostingRoutes.get(
  '/procurement/costing/projects/:id/bom-lines',
  menuGuard,
  async (c) => {
    return c.json({ items: await listBomLines(c.req.param('id')!) });
  },
);

productCostingRoutes.put(
  '/procurement/costing/projects/:id/bom-lines',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || !Array.isArray(body.lines)) {
      return c.json({ message: 'lines 必须为数组' }, 400);
    }
    const lines = body.lines.map(parseManualBomLine);
    if (lines.some((line) => line === null)) {
      return c.json({ message: '清单行字段无效' }, 400);
    }
    const saved = await replaceBomLines(
      c.req.param('id')!,
      lines as ManualBomLineInput[],
    );
    if (!saved) return c.json({ message: '未找到核算产品' }, 404);
    return c.json({ items: saved });
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/bom-lines',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const line = parseManualBomLine(body);
    if (!line) return c.json({ message: '物料名称、单位和非负净用量为必填项' }, 400);
    const created = await createBomLine(c.req.param('id')!, line);
    if (!created) return c.json({ message: '未找到核算产品' }, 404);
    return c.json(created, 201);
  },
);

productCostingRoutes.patch(
  '/procurement/costing/projects/:id/bom-lines/:lineId',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ message: '请求体格式错误' }, 400);
    const patch: Partial<ManualBomLineInput> = {};
    if (body.category !== undefined) {
      const category = requiredText(body.category);
      if (!category) return c.json({ message: '大类不能为空' }, 400);
      patch.category = category;
    }
    for (const key of ['materialName', 'unit'] as const) {
      if (body[key] !== undefined) {
        const text = requiredText(body[key]);
        if (!text) return c.json({ message: `${key} 不能为空` }, 400);
        patch[key] = text;
      }
    }
    if (body.spec !== undefined) patch.spec = typeof body.spec === 'string' ? body.spec : null;
    if (body.sourceRef !== undefined) {
      patch.sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef : null;
    }
    if (body.notes !== undefined) patch.notes = typeof body.notes === 'string' ? body.notes : null;
    for (const key of ['qtyNet', 'lossRate'] as const) {
      if (body[key] !== undefined) {
        const number = body[key];
        if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
          return c.json({ message: `${key} 必须为非负数` }, 400);
        }
        patch[key] = number;
      }
    }
    if (body.unitPriceOverride !== undefined) {
      if (
        body.unitPriceOverride !== null &&
        (typeof body.unitPriceOverride !== 'number' ||
          !Number.isFinite(body.unitPriceOverride) ||
          body.unitPriceOverride < 0)
      ) {
        return c.json({ message: '覆盖单价必须为非负数或 null' }, 400);
      }
      patch.unitPriceOverride = body.unitPriceOverride as number | null;
    }
    if (body.confidence !== undefined) {
      if (
        body.confidence !== 'high' &&
        body.confidence !== 'medium' &&
        body.confidence !== 'low'
      ) {
        return c.json({ message: 'confidence 无效' }, 400);
      }
      patch.confidence = body.confidence;
    }
    const updated = await updateBomLine(
      c.req.param('id')!,
      c.req.param('lineId')!,
      patch,
    );
    if (!updated) return c.json({ message: '清单行不存在' }, 404);
    return c.json(updated);
  },
);

productCostingRoutes.delete(
  '/procurement/costing/projects/:id/bom-lines/:lineId',
  menuGuard,
  requireWrite(),
  async (c) => {
    const deleted = await deleteBomLine(c.req.param('id')!, c.req.param('lineId')!);
    if (!deleted) return c.json({ message: '清单行不存在' }, 404);
    return c.json({ ok: true });
  },
);

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
    const unitPrice = parseUnitPrice(body?.unitPrice);
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
      const unitPrice = parseUnitPrice(body.unitPrice);
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
