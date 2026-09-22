import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  demandPlanMonthly,
  demandPlanVersions,
  demandPlanWeekly,
  planningDemandAdoptions,
  skus,
} from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  adoptDemandPlan,
  adoptForecast,
  archiveDemandPlan,
  generateDemandPlanDraft,
  publishDemandPlan,
  updateDemandPlanMonth,
  updateDemandPlanWeek,
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

export function parsePublishBody(body: unknown): { adopt: boolean } {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return { adopt: rec.adopt === true };
}

export function parseAdoptForecastBody(body: unknown): {
  projectGroup: string;
  warehouseCode: string;
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
  return { projectGroup, warehouseCode };
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
  const [months, weeks, [adoption]] = await Promise.all([
    db
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
      .orderBy(skus.code, demandPlanMonthly.period),
    db
      .select({
        id: demandPlanWeekly.id,
        skuId: demandPlanWeekly.skuId,
        skuCode: skus.code,
        warehouseCode: demandPlanWeekly.warehouseCode,
        period: demandPlanWeekly.period,
        systemDailyAvg: demandPlanWeekly.systemDailyAvg,
        manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        adjustReason: demandPlanWeekly.adjustReason,
        unconstrainedRecentDaily: demandPlanWeekly.unconstrainedRecentDaily,
        championForecastDaily: demandPlanWeekly.championForecastDaily,
        source: demandPlanWeekly.source,
      })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(eq(demandPlanWeekly.versionId, id))
      .orderBy(skus.code, demandPlanWeekly.period),
    db
      .select()
      .from(planningDemandAdoptions)
      .where(
        and(
          eq(planningDemandAdoptions.projectGroup, version.projectGroup),
          eq(planningDemandAdoptions.warehouseCode, version.warehouseCode),
        ),
      )
      .limit(1),
  ]);

  return c.json({
    version,
    months: skuCode ? months.filter((row) => row.skuCode === skuCode) : months,
    weeks: skuCode ? weeks.filter((row) => row.skuCode === skuCode) : weeks,
    adoption: adoption ?? null,
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

demandPlanRoutes.post('/demand-plans/adopt-forecast', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const parsed = parseAdoptForecastBody(await c.req.json().catch(() => ({})));
    const adoption = await adoptForecast({
      ...parsed,
      adoptedBy: user.id,
    });
    return c.json(adoption);
  } catch (err) {
    const mapped = mapRouteError(err, '采用月预测失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.post('/demand-plans/:id/publish', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const { adopt } = parsePublishBody(await c.req.json().catch(() => ({})));
    const published = await publishDemandPlan({
      versionId: c.req.param('id'),
      publishedBy: user.id,
      adopt,
    });
    return c.json(published);
  } catch (err) {
    const mapped = mapRouteError(err, '发布需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.post('/demand-plans/:id/adopt', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const adoption = await adoptDemandPlan({
      versionId: c.req.param('id'),
      adoptedBy: user.id,
    });
    return c.json(adoption);
  } catch (err) {
    const mapped = mapRouteError(err, '采用需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.post('/demand-plans/:id/archive', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  try {
    const archived = await archiveDemandPlan(c.req.param('id'), user.id);
    return c.json(archived);
  } catch (err) {
    const mapped = mapRouteError(err, '归档需求计划失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.patch('/demand-plans/:id/weeks/:weekId', menuGuard, requireWrite(), async (c) => {
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
    const updated = await updateDemandPlanWeek({
      versionId: c.req.param('id'),
      weekId: c.req.param('weekId'),
      manualDailyAvg,
      adjustReason: typeof body.adjustReason === 'string' ? body.adjustReason : null,
    });
    return c.json(updated);
  } catch (err) {
    const mapped = mapRouteError(err, '更新周需求失败');
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
