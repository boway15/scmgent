import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { assertUploadFile } from '../lib/upload-guard.js';
import { isCostingBomWorkflowEnabled } from '../integrations/dify.js';
import {
  createPriceBookItem,
  disablePriceBookItem,
  listPriceBook,
  PriceBookOverlapError,
  updatePriceBookItem,
} from '../lib/product-costing/price-book.js';
import { importPriceBookWorkbook } from '../lib/product-costing/price-book-import.js';
import {
  CONSTRUCTION_TYPES,
  BOM_LINE_CATEGORIES,
  COSTING_CATEGORY_CATALOG,
  COSTING_PRODUCT_CATEGORIES,
} from '../lib/product-costing/category-rules.js';
import { parseUnitPrice } from '../lib/product-costing/parse-unit-price.js';
import { exportCostingXlsx } from '../lib/product-costing/export-costing.js';
import {
  ExtractAlreadyRunningError,
  getExtractRun,
  readCostingPageImage,
  startAnalyzeProductFacts,
  startExtractRun,
} from '../lib/product-costing/extract-runner.js';
import {
  createCostingFactory,
  createCostingRegion,
  disableFactoryFeeRate,
  listCostingFactories,
  listCostingRegions,
  listFactoryFeeRates,
  updateCostingFactoryPackProfile,
  upsertFactoryFeeRate,
} from '../lib/product-costing/costing-catalog.js';
import { parseDateOnlyInput } from '../lib/product-costing/price-effective.js';
import {
  assertCostingSourceAttachment,
  applyCostingFacts,
  bindBomLinePriceBook,
  BindPriceBookError,
  computeCostingProject,
  confirmCostingDesignForApply,
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
import { parseHardwareFacts } from '../lib/product-costing/hardware-facts.js';
import { parseProcessOverrides } from '../lib/product-costing/board-sheet.js';

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

function optionalLongText(
  value: unknown,
  max = 4000,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > max) return { ok: false };
  return { ok: true, value: text };
}

function optionalId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: false };
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !value.trim()) return { ok: false };
  return { ok: true, value: value.trim() };
}

function parseDrawerCount(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30) return { ok: false };
  return { ok: true, value: parsed };
}

function parseConstructionType(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  const text = requiredText(value);
  if (!text || !(CONSTRUCTION_TYPES as readonly string[]).includes(text)) return { ok: false };
  return { ok: true, value: text };
}

function parseDefaultSubstrate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const text = value.trim();
  if (text.length > 100) return { ok: false };
  return { ok: true, value: text || null };
}

function parseOptionalPct(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return { ok: false };
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function parseOptionalMm(
  value: unknown,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === '') return { ok: true, value: null };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return { ok: false };
  return { ok: true, value: parsed };
}

function toPublicProject<T extends { calculatedSummary?: unknown }>(project: T) {
  const { calculatedSummary: _ignored, ...rest } = project;
  return rest;
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
    processOverrides:
      body.processOverrides !== undefined ? parseProcessOverrides(body.processOverrides) : undefined,
    substrate: typeof body.substrate === 'string' ? body.substrate : null,
  };
}

productCostingRoutes.get('/procurement/costing/status', menuGuard, async (c) => {
  return c.json({
    difyEnabled: isCostingBomWorkflowEnabled(),
    preprocessMode: process.env.COSTING_PREPROCESS_MODE?.trim() || 'auto',
    productCategories: [...COSTING_PRODUCT_CATEGORIES],
    categoryFamilies: COSTING_CATEGORY_CATALOG.map((item) => ({
      category: item.label,
      familyId: item.familyId,
    })),
    bomLineCategories: [...BOM_LINE_CATEGORIES],
  });
});

productCostingRoutes.get('/procurement/costing/regions', menuGuard, async (c) => {
  return c.json({ items: await listCostingRegions(c.req.query('activeOnly') === 'true') });
});

productCostingRoutes.post('/procurement/costing/regions', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = requiredText(body?.name);
  const code = requiredText(body?.code) ?? name;
  if (!name) return c.json({ message: '请填写区域名称' }, 400);
  try {
    return c.json(await createCostingRegion({ name, code: code! }), 201);
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ message: '区域编码已存在' }, 409);
    throw error;
  }
});

productCostingRoutes.get('/procurement/costing/factories', menuGuard, async (c) => {
  return c.json({ items: await listCostingFactories(c.req.query('activeOnly') === 'true') });
});

productCostingRoutes.post('/procurement/costing/factories', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = requiredText(body?.name);
  const code = requiredText(body?.code) ?? name;
  if (!name) return c.json({ message: '请填写工厂名称' }, 400);
  const regionId = optionalId(body?.regionId ?? null);
  if (!regionId.ok) return c.json({ message: '区域无效' }, 400);
  try {
    return c.json(
      await createCostingFactory({ name, code: code!, regionId: regionId.value }),
      201,
    );
  } catch (error) {
    if (isUniqueViolation(error)) return c.json({ message: '工厂编码已存在' }, 409);
    throw error;
  }
});

productCostingRoutes.patch(
  '/procurement/costing/factories/:id/pack-profile',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ message: '请求体格式错误' }, 400);
    const updated = await updateCostingFactoryPackProfile(c.req.param('id')!, body.packProfile);
    if (!updated) return c.json({ message: '工厂不存在' }, 404);
    return c.json(updated);
  },
);

productCostingRoutes.get('/procurement/costing/fee-rates', menuGuard, async (c) => {
  return c.json({
    items: await listFactoryFeeRates({
      regionId: c.req.query('regionId') || undefined,
      factoryId: c.req.query('factoryId') || undefined,
    }),
  });
});

productCostingRoutes.post('/procurement/costing/fee-rates', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = requiredText(body?.name);
  const regionId = optionalId(body?.regionId ?? null);
  const factoryId = optionalId(body?.factoryId ?? null);
  const rate = typeof body?.rate === 'number' ? body.rate : Number(body?.rate);
  if (!name || !regionId.ok || !regionId.value || !factoryId.ok || !factoryId.value) {
    return c.json({ message: '费用名称、区域和工厂为必填' }, 400);
  }
  if (!Number.isFinite(rate) || rate < 0) return c.json({ message: '费率须为非负数' }, 400);
  return c.json(
    await upsertFactoryFeeRate({
      name,
      regionId: regionId.value,
      factoryId: factoryId.value,
      rate,
    }),
    201,
  );
});

productCostingRoutes.post(
  '/procurement/costing/fee-rates/:id/disable',
  menuGuard,
  requireWrite(),
  async (c) => {
    const ok = await disableFactoryFeeRate(c.req.param('id')!);
    if (!ok) return c.json({ message: '费用项不存在' }, 404);
    return c.json({ ok: true });
  },
);

productCostingRoutes.get('/procurement/costing/projects', menuGuard, async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)));
  const q = c.req.query('q')?.trim() || undefined;
  return c.json(await listCostingProjects({ page, pageSize, q }));
});

productCostingRoutes.get(
  '/procurement/costing/projects/:id/export',
  menuGuard,
  async (c) => {
    const projectId = c.req.param('id')!;
    const project = await getCostingProject(projectId);
    if (!project) return c.json({ message: '未找到核算产品' }, 404);
    const buffer = await exportCostingXlsx(projectId);
    c.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    c.header('Content-Disposition', `attachment; filename="costing-${project.projectNo}.xlsx"`);
    return c.body(new Uint8Array(buffer));
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const name = requiredText(body?.name);
    const user = await getCurrentUser(c);
    const created = await createCostingProject({
      name: name ?? '',
      userId: user.id,
    });
    return c.json(created, 201);
  },
);

productCostingRoutes.get('/procurement/costing/projects/:id', menuGuard, async (c) => {
  const project = await getCostingProject(c.req.param('id')!);
  if (!project) return c.json({ message: '未找到核算产品' }, 404);
  return c.json(toPublicProject(project));
});

productCostingRoutes.patch(
  '/procurement/costing/projects/:id',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ message: '请求体格式错误' }, 400);
    const patch: {
      name?: string;
      category?: string | null;
      constructionType?: string | null;
      drawerCount?: number | null;
      defaultSubstrate?: string | null;
      carcassThicknessMm?: number | null;
      drawerBottomThicknessMm?: number | null;
      sideThicknessMm?: number | null;
      backThicknessMm?: number | null;
      bottomThicknessMm?: number | null;
      structureSummary?: string | null;
      designPrinciples?: string | null;
      hardwareFacts?: unknown;
      otherHardwarePct?: number | null;
      regionId?: string | null;
      factoryId?: string | null;
      priceAsOf?: string | null;
    } = {};
    if (body.name !== undefined) {
      const name = requiredText(body.name);
      if (!name) return c.json({ message: '产品名称不能为空' }, 400);
      patch.name = name;
    }
    if (body.category !== undefined) {
      patch.category = requiredText(body.category);
    }
    if (body.constructionType !== undefined) {
      const constructionType = parseConstructionType(body.constructionType);
      if (!constructionType.ok) return c.json({ message: '结构类型须为板式、实木或混合' }, 400);
      patch.constructionType = constructionType.value;
    }
    if (body.drawerCount !== undefined) {
      const drawerCount = parseDrawerCount(body.drawerCount);
      if (!drawerCount.ok) return c.json({ message: '抽屉数须为 0–30 的整数' }, 400);
      patch.drawerCount = drawerCount.value;
    }
    if (body.defaultSubstrate !== undefined) {
      const defaultSubstrate = parseDefaultSubstrate(body.defaultSubstrate);
      if (!defaultSubstrate.ok) return c.json({ message: '默认基材过长' }, 400);
      patch.defaultSubstrate = defaultSubstrate.value;
    }
    if (body.carcassThicknessMm !== undefined) {
      const thickness = parseOptionalMm(body.carcassThicknessMm, 8, 40);
      if (!thickness.ok) return c.json({ message: '箱体默认厚度须为 8–40 的整数' }, 400);
      patch.carcassThicknessMm = thickness.value;
    }
    if (body.sideThicknessMm !== undefined) {
      const thickness = parseOptionalMm(body.sideThicknessMm, 8, 40);
      if (!thickness.ok) return c.json({ message: '侧板默认厚度须为 8–40 的整数' }, 400);
      patch.sideThicknessMm = thickness.value;
    }
    if (body.backThicknessMm !== undefined) {
      const thickness = parseOptionalMm(body.backThicknessMm, 2, 18);
      if (!thickness.ok) return c.json({ message: '背板默认厚度须为 2–18 的整数' }, 400);
      patch.backThicknessMm = thickness.value;
    }
    if (body.bottomThicknessMm !== undefined) {
      const thickness = parseOptionalMm(body.bottomThicknessMm, 3, 40);
      if (!thickness.ok) return c.json({ message: '底板默认厚度须为 3–40 的整数' }, 400);
      patch.bottomThicknessMm = thickness.value;
    }
    if (body.drawerBottomThicknessMm !== undefined) {
      const thickness = parseOptionalMm(body.drawerBottomThicknessMm, 3, 18);
      if (!thickness.ok) return c.json({ message: '抽底默认厚度须为 3–18 的整数' }, 400);
      patch.drawerBottomThicknessMm = thickness.value;
    }
    if (body.structureSummary !== undefined) {
      const summary = optionalLongText(body.structureSummary);
      if (!summary.ok) return c.json({ message: '结构说明过长' }, 400);
      patch.structureSummary = summary.value;
    }
    if (body.designPrinciples !== undefined) {
      const principles = optionalLongText(body.designPrinciples);
      if (!principles.ok) return c.json({ message: '设计原则过长' }, 400);
      patch.designPrinciples = principles.value;
    }
    if (body.hardwareFacts !== undefined) {
      patch.hardwareFacts = parseHardwareFacts(body.hardwareFacts);
    }
    if (body.otherHardwarePct !== undefined) {
      const pct = parseOptionalPct(body.otherHardwarePct);
      if (!pct.ok) return c.json({ message: '其他五金占比须为 0–100 的数字' }, 400);
      patch.otherHardwarePct = pct.value;
    }
    if (body.regionId !== undefined) {
      const regionId = optionalId(body.regionId);
      if (!regionId.ok) return c.json({ message: '区域无效' }, 400);
      patch.regionId = regionId.value;
    }
    if (body.factoryId !== undefined) {
      const factoryId = optionalId(body.factoryId);
      if (!factoryId.ok) return c.json({ message: '工厂无效' }, 400);
      patch.factoryId = factoryId.value;
    }
    if (body.priceAsOf !== undefined) {
      if (body.priceAsOf === null || body.priceAsOf === '') {
        patch.priceAsOf = null;
      } else if (typeof body.priceAsOf === 'string' && parseDateOnlyInput(body.priceAsOf)) {
        patch.priceAsOf = body.priceAsOf.trim();
      } else {
        return c.json({ message: '计价日格式须为 YYYY-MM-DD' }, 400);
      }
    }
    const updated = await updateCostingProject(c.req.param('id')!, patch);
    if (!updated) return c.json({ message: '未找到核算产品' }, 404);
    const project = await getCostingProject(c.req.param('id')!);
    return c.json(project ? toPublicProject(project) : updated);
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

productCostingRoutes.post(
  '/procurement/costing/projects/:id/analyze-facts',
  menuGuard,
  requireWrite(),
  async (c) => {
    try {
      return c.json(await startAnalyzeProductFacts(c.req.param('id')!), 202);
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : '识别失败' }, 400);
    }
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/confirm-design',
  menuGuard,
  requireWrite(),
  async (c) => {
    const project = await confirmCostingDesignForApply(c.req.param('id')!);
    if (!project) return c.json({ message: '未找到核算产品' }, 404);
    return c.json(toPublicProject(project));
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/extract',
  menuGuard,
  requireWrite(),
  async (c) => {
    if (!isCostingBomWorkflowEnabled()) {
      return c.json(
        { message: '未配置 DIFY_API_KEY_COSTING_BOM，无法 AI 拆解；可手工维护清单' },
        503,
      );
    }
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    const parsePage = (value: unknown): number | undefined => {
      if (value === undefined || value === null) return undefined;
      return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : Number.NaN;
    };
    const pageFrom = parsePage(body.pageFrom);
    const pageTo = parsePage(body.pageTo);
    if (
      Number.isNaN(pageFrom) ||
      Number.isNaN(pageTo) ||
      (pageFrom !== undefined && pageTo !== undefined && pageFrom > pageTo)
    ) {
      return c.json({ message: '页码范围无效' }, 400);
    }
    try {
      const user = await getCurrentUser(c);
      return c.json(
        await startExtractRun(c.req.param('id')!, user.id, { pageFrom, pageTo }),
        202,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '启动解析失败';
      const status =
        error instanceof ExtractAlreadyRunningError
          ? 409
          : message === '核算单不存在'
            ? 404
            : 400;
      return c.json({ message }, status);
    }
  },
);

productCostingRoutes.get(
  '/procurement/costing/projects/:id/extract/runs/:runId',
  menuGuard,
  async (c) => {
    const run = await getExtractRun(c.req.param('id')!, c.req.param('runId')!);
    if (!run) return c.json({ message: '解析任务不存在' }, 404);
    return c.json(run);
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/apply-facts',
  menuGuard,
  requireWrite(),
  async (c) => {
    try {
      const project = await applyCostingFacts(c.req.param('id')!);
      if (!project) return c.json({ message: '未找到核算产品' }, 404);
      return c.json(toPublicProject(project));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('请先填写全部板厚')) {
        return c.json({ message }, 400);
      }
      throw error;
    }
  },
);

productCostingRoutes.post(
  '/procurement/costing/projects/:id/compute',
  menuGuard,
  requireWrite(),
  async (c) => {
    const result = await computeCostingProject(c.req.param('id')!);
    if ('notFound' in result && result.notFound) {
      return c.json({ message: '未找到核算产品' }, 404);
    }
    if (!result.ok) {
      return c.json(
        {
          message: '请先确认原材料：板厚须全部填写，未匹配项须填写本单单价，且用量须大于 0',
          blockers: result.blockers,
        },
        400,
      );
    }
    return c.json(toPublicProject(result.project!));
  },
);

productCostingRoutes.get(
  '/procurement/costing/projects/:id/pages/:pageNo',
  menuGuard,
  async (c) => {
    const pageNo = Number(c.req.param('pageNo'));
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      return c.json({ message: '页码无效' }, 400);
    }
    try {
      const page = await readCostingPageImage(c.req.param('id')!, pageNo);
      if (!page) return c.json({ message: '页面不存在' }, 404);
      c.header('Content-Type', page.contentType);
      c.header('Cache-Control', 'private, max-age=300');
      return c.body(new Uint8Array(page.buffer));
    } catch {
      return c.json({ message: '页面文件不存在' }, 404);
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
    if (body.substrate !== undefined) {
      patch.substrate = typeof body.substrate === 'string' ? body.substrate : null;
    }
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
    if (body.processOverrides !== undefined) {
      patch.processOverrides = parseProcessOverrides(body.processOverrides);
    }
    if (body.isManual === true) {
      patch.isManual = true;
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

productCostingRoutes.post(
  '/procurement/costing/projects/:id/bom-lines/:lineId/bind-price-book',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const priceBookId = typeof body?.priceBookId === 'string' ? body.priceBookId.trim() : '';
    if (!priceBookId) return c.json({ message: 'priceBookId 为必填项' }, 400);
    try {
      const updated = await bindBomLinePriceBook(
        c.req.param('id')!,
        c.req.param('lineId')!,
        priceBookId,
      );
      if (!updated) return c.json({ message: '清单行不存在' }, 404);
      return c.json(updated);
    } catch (error) {
      if (error instanceof BindPriceBookError) {
        return c.json({ message: error.message }, error.statusCode as 400);
      }
      throw error;
    }
  },
);

productCostingRoutes.get('/procurement/costing/price-book', menuGuard, async (c) => {
  const activeOnlyRaw = c.req.query('activeOnly');
  const items = await listPriceBook({
    q: c.req.query('q') || undefined,
    category: c.req.query('category') || undefined,
    regionId: c.req.query('regionId') || undefined,
    factoryId: c.req.query('factoryId') || undefined,
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
        standard: typeof body?.standard === 'string' ? body.standard : undefined,
        unit,
        unitPrice,
        notes: typeof body?.notes === 'string' ? body.notes : undefined,
        regionId: typeof body?.regionId === 'string' ? body.regionId : undefined,
        factoryId: typeof body?.factoryId === 'string' ? body.factoryId : undefined,
        effectiveFrom: typeof body?.effectiveFrom === 'string' ? body.effectiveFrom : undefined,
        effectiveTo: typeof body?.effectiveTo === 'string' ? body.effectiveTo : undefined,
      });
      return c.json(item, 201);
    } catch (error) {
      if (error instanceof PriceBookOverlapError) {
        return c.json({ message: '与同切片价目生效区间重叠' }, 400);
      }
      if (isUniqueViolation(error)) {
        return c.json({ message: '同一切片下同名规格单位已存在' }, 409);
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
      standard: string;
      regionId: string | null;
      factoryId: string | null;
      effectiveFrom: string | null;
      effectiveTo: string | null;
    }> = {};
    for (const key of ['category', 'materialName', 'unit'] as const) {
      if (body[key] !== undefined) {
        const value = requiredText(body[key]);
        if (!value) return c.json({ message: `${key} 不能为空` }, 400);
        patch[key] = value;
      }
    }
    if (body.spec !== undefined) patch.spec = String(body.spec ?? '').trim();
    if (body.standard !== undefined) patch.standard = String(body.standard ?? '').trim();
    if (body.notes !== undefined) patch.notes = String(body.notes ?? '').trim();
    if (body.unitPrice !== undefined) {
      const unitPrice = parseUnitPrice(body.unitPrice);
      if (unitPrice === null) return c.json({ message: '单价必须为非负数' }, 400);
      patch.unitPrice = unitPrice;
    }
    if (body.regionId !== undefined) {
      const regionId = optionalId(body.regionId);
      if (!regionId.ok) return c.json({ message: '区域无效' }, 400);
      patch.regionId = regionId.value;
    }
    if (body.factoryId !== undefined) {
      const factoryId = optionalId(body.factoryId);
      if (!factoryId.ok) return c.json({ message: '工厂无效' }, 400);
      patch.factoryId = factoryId.value;
    }
    if (body.effectiveFrom !== undefined) {
      if (body.effectiveFrom === null || body.effectiveFrom === '') {
        patch.effectiveFrom = '2000-01-01';
      } else if (typeof body.effectiveFrom === 'string' && parseDateOnlyInput(body.effectiveFrom)) {
        patch.effectiveFrom = body.effectiveFrom.trim();
      } else {
        return c.json({ message: '生效起始日格式须为 YYYY-MM-DD' }, 400);
      }
    }
    if (body.effectiveTo !== undefined) {
      if (body.effectiveTo === null || body.effectiveTo === '') {
        patch.effectiveTo = null;
      } else if (typeof body.effectiveTo === 'string' && parseDateOnlyInput(body.effectiveTo)) {
        patch.effectiveTo = body.effectiveTo.trim();
      } else {
        return c.json({ message: '生效截止日格式须为 YYYY-MM-DD' }, 400);
      }
    }

    try {
      const item = await updatePriceBookItem(c.req.param('id')!, patch);
      if (!item) return c.json({ message: 'Not found' }, 404);
      return c.json(item);
    } catch (error) {
      if (error instanceof PriceBookOverlapError) {
        return c.json({ message: '与同切片价目生效区间重叠' }, 400);
      }
      if (isUniqueViolation(error)) {
        return c.json({ message: '同一切片下同名规格单位已存在' }, 409);
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
