import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
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
import { DEMAND_PLAN_WAREHOUSE_ALL, parseDemandPlanPilotConfig } from '../lib/demand-plan-config.js';
import {
  adoptDemandPlan,
  adoptForecast,
  archiveDemandPlan,
  generateDemandPlanDraft,
  publishDemandPlan,
  updateDemandPlanMonth,
  updateDemandPlanWeek,
} from '../lib/demand-plan-service.js';
import { buildDemandPlanPeriodColumns } from '../lib/demand-plan-periods.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { DEMAND_PLAN_HORIZON_WEEKS } from '../lib/planning-calendar.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { loadDemandPlanSkuDetail } from '../lib/demand-plan-sku-detail.js';
import { resolvePublishedVersionIdForSku } from '../lib/forecast-published-resolve.js';
import { searchSkuProjectGroups } from '../lib/sku-category.js';
import { excludeAccessorySkuSql } from '../lib/planning-accessory-filter.js';

export function parseGenerateBody(body: unknown): {
  projectGroup?: string;
  versionName?: string;
} {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const projectGroupRaw = typeof rec.projectGroup === 'string' ? rec.projectGroup.trim() : '';
  const projectGroup = projectGroupRaw || undefined;
  const versionName =
    typeof rec.versionName === 'string' && rec.versionName.trim()
      ? rec.versionName.trim()
      : undefined;
  return { projectGroup, versionName };
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
  const warehouseCode =
    typeof rec.warehouseCode === 'string' && rec.warehouseCode.trim()
      ? rec.warehouseCode.trim()
      : DEMAND_PLAN_WAREHOUSE_ALL;
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
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const q = c.req.query('q')?.trim();
  const conditions = [];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(demandPlanVersions.versionNo, pattern),
        ilike(demandPlanVersions.versionName, pattern),
        ilike(demandPlanVersions.projectGroup, pattern),
        ilike(demandPlanVersions.warehouseCode, pattern),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: demandPlanVersions.id,
        versionNo: demandPlanVersions.versionNo,
        versionName: demandPlanVersions.versionName,
        status: demandPlanVersions.status,
        projectGroup: demandPlanVersions.projectGroup,
        warehouseCode: demandPlanVersions.warehouseCode,
        startMonth: demandPlanVersions.startMonth,
        startWeek: demandPlanVersions.startWeek,
        horizonWeeks: demandPlanVersions.horizonWeeks,
        publishedAt: demandPlanVersions.publishedAt,
        createdAt: demandPlanVersions.createdAt,
      })
      .from(demandPlanVersions)
      .where(where)
      .orderBy(desc(demandPlanVersions.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(demandPlanVersions)
      .where(where),
  ]);

  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

demandPlanRoutes.get('/demand-plans/project-groups', menuGuard, async (c) => {
  const config = parseDemandPlanPilotConfig(process.env);
  const all = await searchSkuProjectGroups(undefined, 200);
  const configured = config.projectGroups;
  const items = configured.length
    ? [...configured.filter((group) => all.includes(group)), ...configured.filter((group) => !all.includes(group))]
    : all;
  return c.json({ items, horizonWeeks: DEMAND_PLAN_HORIZON_WEEKS });
});

demandPlanRoutes.get('/demand-plans/forecast-version-for-sku', menuGuard, async (c) => {
  const skuId = c.req.query('skuId')?.trim();
  if (!skuId) {
    return c.json({ message: 'skuId is required' }, 400);
  }
  const versionId = await resolvePublishedVersionIdForSku(skuId);
  return c.json({ versionId });
});

const emptyDemandPlanPeriodPage = (page: number, pageSize: number) => ({
  items: [],
  total: 0,
  skuTotal: 0,
  page,
  pageSize,
});

const emptyDemandPlanWidePage = (page: number, pageSize: number) => ({
  items: [],
  total: 0,
  page,
  pageSize,
});

export function parseDemandPlanView(raw?: string): 'wide' | 'long' {
  return raw === 'long' ? 'long' : 'wide';
}

type DemandPlanPeriodRow = {
  id: string;
  skuId: string;
  skuCode: string | null;
  warehouseCode: string;
  period: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  adjustReason: string | null;
  unconstrainedRecentDaily: string | null;
  championForecastDaily: string | null;
  source: string;
  inStockDayRatio?: string | null;
};

function buildWideItems(
  skuPage: Array<{ skuId: string; skuCode: string | null }>,
  rows: DemandPlanPeriodRow[],
): Array<{ skuId: string; skuCode: string; cells: Record<string, DemandPlanPeriodRow> }> {
  const rowsBySku = new Map<string, DemandPlanPeriodRow[]>();
  for (const row of rows) {
    const list = rowsBySku.get(row.skuId) ?? [];
    list.push(row);
    rowsBySku.set(row.skuId, list);
  }
  return skuPage.map((sku) => {
    const cells: Record<string, DemandPlanPeriodRow> = {};
    for (const row of rowsBySku.get(sku.skuId) ?? []) {
      cells[row.period] = row;
    }
    return {
      skuId: sku.skuId,
      skuCode: sku.skuCode ?? '—',
      cells,
    };
  });
}

async function listDemandPlanWeeklyPage(input: {
  versionId: string;
  skuCode?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const filters = [eq(demandPlanWeekly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuCode) {
    filters.push(ilike(skus.code, `%${input.skuCode}%`));
  }
  const where = and(...filters);
  const [items, [countRow], [skuCountRow]] = await Promise.all([
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
      .where(where)
      .orderBy(skus.code, demandPlanWeekly.period)
      .limit(input.pageSize)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(where),
    db
      .select({ count: sql<number>`count(distinct ${demandPlanWeekly.skuId})::int` })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(where),
  ]);
  return {
    items,
    total: countRow?.count ?? 0,
    skuTotal: skuCountRow?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function listDemandPlanMonthlyPage(input: {
  versionId: string;
  skuCode?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const filters = [eq(demandPlanMonthly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuCode) {
    filters.push(ilike(skus.code, `%${input.skuCode}%`));
  }
  const where = and(...filters);
  const [items, [countRow], [skuCountRow]] = await Promise.all([
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
      .where(where)
      .orderBy(skus.code, demandPlanMonthly.period)
      .limit(input.pageSize)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(demandPlanMonthly)
      .innerJoin(skus, eq(skus.id, demandPlanMonthly.skuId))
      .where(where),
    db
      .select({ count: sql<number>`count(distinct ${demandPlanMonthly.skuId})::int` })
      .from(demandPlanMonthly)
      .innerJoin(skus, eq(skus.id, demandPlanMonthly.skuId))
      .where(where),
  ]);
  return {
    items,
    total: countRow?.count ?? 0,
    skuTotal: skuCountRow?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function listDemandPlanWeeklyWide(input: {
  versionId: string;
  skuCode?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const filters = [eq(demandPlanWeekly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuCode) {
    filters.push(ilike(skus.code, `%${input.skuCode}%`));
  }
  const where = and(...filters);
  const [skuPage, [skuCountRow]] = await Promise.all([
    db
      .select({
        skuId: demandPlanWeekly.skuId,
        skuCode: skus.code,
      })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(where)
      .groupBy(demandPlanWeekly.skuId, skus.code)
      .orderBy(skus.code)
      .limit(input.pageSize)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(distinct ${demandPlanWeekly.skuId})::int` })
      .from(demandPlanWeekly)
      .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
      .where(where),
  ]);
  const skuIds = skuPage.map((row) => row.skuId);
  const rows: DemandPlanPeriodRow[] = skuIds.length
    ? await db
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
        .where(and(eq(demandPlanWeekly.versionId, input.versionId), inArray(demandPlanWeekly.skuId, skuIds)))
        .orderBy(skus.code, demandPlanWeekly.period)
    : [];
  return {
    items: buildWideItems(skuPage, rows),
    total: skuCountRow?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function listDemandPlanMonthlyWide(input: {
  versionId: string;
  skuCode?: string;
  page: number;
  pageSize: number;
  offset: number;
}) {
  const filters = [eq(demandPlanMonthly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuCode) {
    filters.push(ilike(skus.code, `%${input.skuCode}%`));
  }
  const where = and(...filters);
  const [skuPage, [skuCountRow]] = await Promise.all([
    db
      .select({
        skuId: demandPlanMonthly.skuId,
        skuCode: skus.code,
      })
      .from(demandPlanMonthly)
      .innerJoin(skus, eq(skus.id, demandPlanMonthly.skuId))
      .where(where)
      .groupBy(demandPlanMonthly.skuId, skus.code)
      .orderBy(skus.code)
      .limit(input.pageSize)
      .offset(input.offset),
    db
      .select({ count: sql<number>`count(distinct ${demandPlanMonthly.skuId})::int` })
      .from(demandPlanMonthly)
      .innerJoin(skus, eq(skus.id, demandPlanMonthly.skuId))
      .where(where),
  ]);
  const skuIds = skuPage.map((row) => row.skuId);
  const rows: DemandPlanPeriodRow[] = skuIds.length
    ? await db
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
        .where(and(eq(demandPlanMonthly.versionId, input.versionId), inArray(demandPlanMonthly.skuId, skuIds)))
        .orderBy(skus.code, demandPlanMonthly.period)
    : [];
  return {
    items: buildWideItems(skuPage, rows),
    total: skuCountRow?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

demandPlanRoutes.get('/demand-plans/:id/sku-detail', menuGuard, async (c) => {
  const versionId = c.req.param('id');
  const skuId = c.req.query('skuId')?.trim();
  if (!skuId) {
    return c.json({ message: 'skuId is required' }, 400);
  }
  try {
    const detail = await loadDemandPlanSkuDetail({ versionId, skuId });
    return c.json(detail);
  } catch (err) {
    const mapped = mapRouteError(err, '加载 SKU 详情失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.get('/demand-plans/:id', menuGuard, async (c) => {
  const id = c.req.param('id');
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, id))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);

  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const view = parseDemandPlanView(c.req.query('view'));
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page'),
    c.req.query('pageSize'),
    view === 'wide' ? 20 : 50,
  );
  const useWeeks = Boolean(version.startWeek);
  const pageInput = { versionId: id, skuCode, page, pageSize, offset };
  const periods = buildDemandPlanPeriodColumns(version);

  const statsFilters = useWeeks
    ? [eq(demandPlanWeekly.versionId, id)]
    : [eq(demandPlanMonthly.versionId, id)];
  if (skuCode) {
    statsFilters.push(ilike(skus.code, `%${skuCode}%`));
  }
  const statsWhere = and(...statsFilters);
  const statsFrom = useWeeks ? demandPlanWeekly : demandPlanMonthly;
  const statsSkuColumn = useWeeks ? demandPlanWeekly.skuId : demandPlanMonthly.skuId;

  const [[adoption], data, [statsRow]] = await Promise.all([
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
    view === 'wide'
      ? useWeeks
        ? listDemandPlanWeeklyWide(pageInput)
        : listDemandPlanMonthlyWide(pageInput)
      : useWeeks
        ? listDemandPlanWeeklyPage(pageInput)
        : listDemandPlanMonthlyPage(pageInput),
    db
      .select({
        rowTotal: sql<number>`count(*)::int`,
        skuTotal: sql<number>`count(distinct ${statsSkuColumn})::int`,
      })
      .from(statsFrom)
      .innerJoin(skus, eq(skus.id, statsFrom.skuId))
      .where(statsWhere),
  ]);

  return c.json({
    version,
    view,
    periods,
    grain: useWeeks ? 'week' : 'month',
    stats: {
      rowTotal: statsRow?.rowTotal ?? 0,
      skuTotal: statsRow?.skuTotal ?? 0,
    },
    long: view === 'long' ? data : emptyDemandPlanPeriodPage(page, pageSize),
    wide: view === 'wide' ? data : emptyDemandPlanWidePage(page, pageSize),
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
