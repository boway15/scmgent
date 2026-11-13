import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { isCostingBomWorkflowEnabled } from '../integrations/dify.js';
import { startExtractRun } from '../lib/product-costing/extract-runner.js';
import { resolveStoragePath } from '../lib/product-costing/storage.js';
import {
  confirmBom,
  createBomLine,
  createCostingProject,
  deleteBomLine,
  deleteCostingProject,
  exportBomBuffer,
  getCostingProject,
  getExtractRun,
  listBomLines,
  listCostingProjects,
  listExtractRuns,
  replaceBomLines,
  saveSourceAttachment,
  updateBomLine,
  updateCostingProject,
} from '../lib/product-costing/service.js';
import { db, costingAttachments } from '@scm/db';
import { and, eq } from 'drizzle-orm';

export const productCostingRoutes = new Hono();

const menuGuard = requireMenu('procurement.costing');

const ALLOWED_EXT = ['.pptx', '.pdf'];
const MAX_BYTES = 30 * 1024 * 1024;

function assertDesignFile(file: File) {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXT.some((ext) => name.endsWith(ext))) {
    throw new Error('仅支持 .pptx 或 .pdf');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('文件过大，最大 30MB');
  }
}

productCostingRoutes.get('/procurement/costing/status', menuGuard, async (c) => {
  return c.json({
    difyEnabled: isCostingBomWorkflowEnabled(),
    preprocessMode: process.env.COSTING_PREPROCESS_MODE ?? 'auto',
  });
});

productCostingRoutes.get('/procurement/costing', menuGuard, async (c) => {
  const { page, pageSize } = parseListPagination(c.req.query('page'), c.req.query('pageSize'), 20);
  const result = await listCostingProjects({
    page,
    pageSize,
    status: c.req.query('status') || undefined,
    keyword: c.req.query('keyword') || undefined,
  });
  return c.json(result);
});

productCostingRoutes.post('/procurement/costing', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ name?: string; category?: string; skuId?: string | null }>();
  if (!body.name?.trim()) return c.json({ message: '请填写名称' }, 400);
  const row = await createCostingProject({
    name: body.name,
    category: body.category,
    skuId: body.skuId,
    userId: user.id,
  });
  return c.json(row, 201);
});

productCostingRoutes.get('/procurement/costing/:id', menuGuard, async (c) => {
  const detail = await getCostingProject(c.req.param('id'));
  if (!detail) return c.json({ message: '未找到核算单' }, 404);
  return c.json(detail);
});

productCostingRoutes.patch('/procurement/costing/:id', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<{ name?: string; category?: string | null; skuId?: string | null }>();
  const row = await updateCostingProject(c.req.param('id'), body);
  if (!row) return c.json({ message: '未找到核算单' }, 404);
  return c.json(row);
});

productCostingRoutes.delete('/procurement/costing/:id', menuGuard, requireWrite(), async (c) => {
  await deleteCostingProject(c.req.param('id'));
  return c.json({ ok: true });
});

productCostingRoutes.post(
  '/procurement/costing/:id/attachments',
  menuGuard,
  requireWrite(),
  async (c) => {
    const id = c.req.param('id');
    const project = await getCostingProject(id);
    if (!project) return c.json({ message: '未找到核算单' }, 404);
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ message: '请上传文件' }, 400);
    try {
      assertDesignFile(file);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : String(err) }, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType =
      file.type ||
      (file.name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const row = await saveSourceAttachment({
      projectId: id,
      fileName: file.name,
      contentType,
      buffer,
    });
    return c.json(row, 201);
  },
);

productCostingRoutes.get('/procurement/costing/:id/pages/:pageNo', menuGuard, async (c) => {
  const id = c.req.param('id');
  const pageNo = Number(c.req.param('pageNo'));
  if (!Number.isFinite(pageNo) || pageNo < 1) return c.json({ message: '无效页码' }, 400);
  const want = c.req.query('type') === 'text' ? 'page_text' : 'page_image';
  const [att] = await db
    .select()
    .from(costingAttachments)
    .where(
      and(
        eq(costingAttachments.projectId, id),
        eq(costingAttachments.kind, want),
        eq(costingAttachments.pageNo, pageNo),
      ),
    )
    .limit(1);
  if (!att) return c.json({ message: '页面不存在，请先执行 AI 拆解预处理' }, 404);
  try {
    const abs = resolveStoragePath(att.storagePath);
    const buf = await readFile(abs);
    if (want === 'page_text') {
      return c.json({ pageNo, text: buf.toString('utf8') });
    }
    return new Response(buf, {
      headers: {
        'Content-Type': att.contentType || 'image/png',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch {
    return c.json({ message: '读取页面失败' }, 500);
  }
});

productCostingRoutes.post('/procurement/costing/:id/extract', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { pageFrom?: number; pageTo?: number };
  try {
    const { runId } = await startExtractRun(id, user.id, {
      pageFrom: body.pageFrom,
      pageTo: body.pageTo,
    });
    return c.json({ runId }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('DIFY_API_KEY') ? 503 : 400;
    return c.json({ message }, status);
  }
});

productCostingRoutes.get('/procurement/costing/:id/extract/runs', menuGuard, async (c) => {
  const runs = await listExtractRuns(c.req.param('id'));
  return c.json({ items: runs });
});

productCostingRoutes.get('/procurement/costing/:id/extract/runs/:runId', menuGuard, async (c) => {
  const run = await getExtractRun(c.req.param('id'), c.req.param('runId'));
  if (!run) return c.json({ message: '未找到运行记录' }, 404);
  return c.json(run);
});

productCostingRoutes.get('/procurement/costing/:id/bom-lines', menuGuard, async (c) => {
  const lines = await listBomLines(c.req.param('id'));
  return c.json({ items: lines });
});

productCostingRoutes.put('/procurement/costing/:id/bom-lines', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<{
    lines?: Array<{
      category: string;
      materialName: string;
      spec?: string | null;
      unit: string;
      qtyNet: number;
      lossRate?: number;
      sourceRef?: string | null;
      confidence?: 'high' | 'medium' | 'low';
      notes?: string | null;
      isManual?: boolean;
    }>;
  }>();
  const lines = await replaceBomLines(c.req.param('id'), body.lines ?? []);
  return c.json({ items: lines });
});

productCostingRoutes.post('/procurement/costing/:id/bom-lines', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<{
    category: string;
    materialName: string;
    spec?: string | null;
    unit: string;
    qtyNet: number;
    lossRate?: number;
    sourceRef?: string | null;
    confidence?: 'high' | 'medium' | 'low';
    notes?: string | null;
  }>();
  if (!body.materialName?.trim() || !body.unit?.trim() || body.qtyNet === undefined) {
    return c.json({ message: '物料名称、单位、净用量必填' }, 400);
  }
  const row = await createBomLine(c.req.param('id'), body);
  return c.json(row, 201);
});

productCostingRoutes.patch(
  '/procurement/costing/:id/bom-lines/:lineId',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = await c.req.json();
    const row = await updateBomLine(c.req.param('id'), c.req.param('lineId'), body);
    if (!row) return c.json({ message: '行不存在' }, 404);
    return c.json(row);
  },
);

productCostingRoutes.delete(
  '/procurement/costing/:id/bom-lines/:lineId',
  menuGuard,
  requireWrite(),
  async (c) => {
    await deleteBomLine(c.req.param('id'), c.req.param('lineId'));
    return c.json({ ok: true });
  },
);

productCostingRoutes.post(
  '/procurement/costing/:id/confirm-bom',
  menuGuard,
  requireWrite(),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
    const result = await confirmBom(c.req.param('id'), Boolean(body.force));
    if (!result.ok) {
      return c.json({ message: '清单尚未可确认', reasons: result.reasons }, 400);
    }
    return c.json(result.project);
  },
);

productCostingRoutes.get('/procurement/costing/:id/export-bom', menuGuard, async (c) => {
  const id = c.req.param('id');
  const project = await getCostingProject(id);
  if (!project) return c.json({ message: '未找到核算单' }, 404);
  const buf = await exportBomBuffer(id);
  const filename = encodeURIComponent(`${project.projectNo}-bom.xlsx`);
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${project.projectNo}-bom.xlsx"; filename*=UTF-8''${filename}`,
    },
  });
});
