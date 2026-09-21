import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, demandPlanMonthly, demandPlanVersions, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  archiveDemandPlan,
  generateDemandPlanDraft,
  publishDemandPlan,
  updateDemandPlanMonth,
} from '../lib/demand-plan-service.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';

export function parseGenerateBody(body: unknown): {
  projectGroup: string;
  warehouseCode: string;
  versionName?: string;
} {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const projectGroup = typeof rec.projectGroup === 'string' ? rec.projectGroup.trim() : '';
  if (!projectGroup) {
    throw Object.assign(new Error('projectGroup is required'), { status: 400 });
  }
  const warehouseCode = typeof rec.warehouseCode === 'string' ? rec.warehouseCode.trim() : '';
  if (!warehouseCode) {
    throw Object.assign(new Error('warehouseCode is required'), { status: 400 });
  }
  const versionName =
    typeof rec.versionName === 'string' && rec.versionName.trim()
      ? rec.versionName.trim()
      : undefined;
  return { projectGroup, warehouseCode, versionName };
}

function mapRouteError(err: unknown, fallback: string): { message: string; status: 400 | 404 } {
  const status =
    err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
      ? err.status
      : undefined;
  const message = err instanceof Error ? err.message : fallback;
  if (status === 400) return { message, status: 400 };
  if (status === 404) return { message, status: 404 };
  throw err;
}

export const demandPlanRoutes = new Hono();

const menuGuard = requireMenu('data.demand_plan');

demandPlanRoutes.get('/demand-plans', menuGuard, async (c) => {
  const rows = await db
    .select({
      id: demandPlanVersions.id,
      versionNo: demandPlanVersions.versionNo,
      versionName: demandPlanVersions.versionName,
      status: demandPlanVersions.status,
      projectGroup: demandPlanVersions.projectGroup,
      warehouseCode: demandPlanVersions.warehouseCode,
      startMonth: demandPlanVersions.startMonth,
      publishedAt: demandPlanVersions.publishedAt,
      createdAt: demandPlanVersions.createdAt,
    })
    .from(demandPlanVersions)
    .orderBy(desc(demandPlanVersions.createdAt));
  return c.json(rows);
});

demandPlanRoutes.get('/demand-plans/:id', menuGuard, async (c) => {
  const id = c.req.param('id');
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, id))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);

  const skuCode = c.req.query('skuCode')?.trim();
  const months = await db
    .select({
      id: demandPlanMonthly.id,
      skuId: demandPlanMonthly.skuId,
      skuCode: skus.code,
      warehouseCode: demandPlanMonthly.warehouseCode,
      period: demandPlanMonthly.period,
      systemDailyAvg: demandPlanMonthly.systemDailyAvg,
      manualDailyAvg: demandPlanMonthly.manualDailyAvg,
      adjustReason: demandPlanMonthly.adjustReason,
      unconstrainedRecentDaily: demandPlanMonthly.unconstrainedRecentDaily,
      championForecastDaily: demandPlanMonthly.championForecastDaily,
      inStockDayRatio: demandPlanMonthly.inStockDayRatio,
      source: demandPlanMonthly.source,
    })
    .from(demandPlanMonthly)
    .innerJoin(skus, eq(skus.id, demandPlanMonthly.skuId))
    .where(eq(demandPlanMonthly.versionId, id))
    .orderBy(skus.code, demandPlanMonthly.period);

  return c.json({
    version,
    months: skuCode ? months.filter((row) => row.skuCode === skuCode) : months,
  });
});

demandPlanRoutes.post('/demand-plans/generate', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const parsed = parseGenerateBody(await c.req.json().catch(() => ({})));
    const result = await generateDemandPlanDraft({
      ...parsed,
      createdBy: user.id,
    });
    return c.json(result, 201);
  } catch (err) {
    const mapped = mapRouteError(err, '生成需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.post('/demand-plans/:id/publish', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const published = await publishDemandPlan({
      versionId: c.req.param('id'),
      publishedBy: user.id,
    });
    return c.json(published);
  } catch (err) {
    const mapped = mapRouteError(err, '发布需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.post('/demand-plans/:id/archive', menuGuard, requireWrite(), async (c) => {
  try {
    const archived = await archiveDemandPlan(c.req.param('id'));
    return c.json(archived);
  } catch (err) {
    const mapped = mapRouteError(err, '归档需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.patch('/demand-plans/:id/months/:monthId', menuGuard, requireWrite(), async (c) => {
  try {
    const body = await c.req.json<{
      manualDailyAvg?: number | null;
      adjustReason?: string | null;
    }>().catch(() => ({} as { manualDailyAvg?: number | null; adjustReason?: string | null }));
    const raw = body.manualDailyAvg;
    const manualDailyAvg = raw == null ? null : Number(raw);
    if (manualDailyAvg != null && !Number.isFinite(manualDailyAvg)) {
      return c.json({ message: 'manualDailyAvg is invalid' }, 400);
    }
    const updated = await updateDemandPlanMonth({
      versionId: c.req.param('id'),
      monthId: c.req.param('monthId'),
      manualDailyAvg,
      adjustReason: typeof body.adjustReason === 'string' ? body.adjustReason : null,
    });
    return c.json(updated);
  } catch (err) {
    const mapped = mapRouteError(err, '更新月度需求失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});
