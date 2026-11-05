import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
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
  DEMAND_PLAN_PROJECT_GROUP_ALL,
  DEMAND_PLAN_WAREHOUSE_ALL,
  isAllScopeProjectGroup,
  parseDemandPlanPilotConfig,
} from '../lib/demand-plan-config.js';
import {
  filterProjectGroupOptions,
  resolveRequestProjectGroupScope,
  skuInProjectGroupScope,
  skuProjectGroupCondition,
} from '../lib/data-scope.js';
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
import { resolveDemandPlanChampionForecastVersion } from '../lib/demand-plan-champion.js';
import { resolvePublishedVersionIdForSku } from '../lib/forecast-published-resolve.js';
import {
  categoriesMatchFilterCondition,
  resolveCategoryFilters,
  searchSkuProjectGroups,
} from '../lib/sku-category.js';
import {
  excludeAccessorySkuSql,
  parseProductScope,
  productScopeSql,
  type ProductScope,
} from '../lib/planning-accessory-filter.js';
import {
  buildDemandPlanListRowKeys,
  demandPlanStoredRowMetaBySku,
  enrichDemandPlanWideRows,
  filterSkusByProfileSegment,
  resolveDemandPlanChannelQuery,
  sortDemandPlanSkus,
  paginateDemandPlanLongPairs,
  type DemandPlanSkuRef,
} from '../lib/demand-plan-enrich.js';
import { loadPublishedForecastSkuMetaBySkuIds } from '../lib/forecast-published-resolve.js';
import {
  buildDemandPlanHorizonExportCsv,
  loadDemandPlanHorizonExportDataset,
  type DemandPlanHorizonExportMode,
} from '../lib/demand-plan-horizon-export.js';
import {
  buildDemandPlanAccuracyExportCsv,
  buildDemandPlanAccuracyRows,
  paginateDemandPlanAccuracySkuSummaries,
} from '../lib/demand-plan-accuracy-export.js';
import { buildDemandPlanReviewSummary } from '../lib/demand-plan-review-summary.js';
import {
  clearDemandPlanVersionCalibrations,
  runDemandPlanCalibrationImport,
} from '../lib/demand-plan-calibration-import.js';
import { csvAttachment } from '../lib/csv-export.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { parseForecastSkuQuery } from '../lib/forecast-sku-query.js';
import { resolveHorizonProfileSegmentFilter } from '../lib/forecast-horizon.js';

export function parseGenerateBody(body: unknown): {
  projectGroup?: string;
  versionName?: string;
  startWeek?: string;
} {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const projectGroupRaw = typeof rec.projectGroup === 'string' ? rec.projectGroup.trim() : '';
  const projectGroup = projectGroupRaw || undefined;
  const versionName =
    typeof rec.versionName === 'string' && rec.versionName.trim()
      ? rec.versionName.trim()
      : undefined;
  const startWeek =
    typeof rec.startWeek === 'string' && rec.startWeek.trim() ? rec.startWeek.trim() : undefined;
  return { projectGroup, versionName, startWeek };
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
  const scope = await resolveRequestProjectGroupScope(c);
  if (scope.mode === 'restricted' && scope.groups.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize });
  }
  const q = c.req.query('q')?.trim();
  const conditions = [];
  if (scope.mode === 'restricted') {
    conditions.push(
      or(
        inArray(demandPlanVersions.projectGroup, scope.groups),
        eq(demandPlanVersions.projectGroup, DEMAND_PLAN_PROJECT_GROUP_ALL),
      )!,
    );
  }
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
  const scope = await resolveRequestProjectGroupScope(c);
  const config = parseDemandPlanPilotConfig(process.env);
  const all = await searchSkuProjectGroups(undefined, 200);
  const configured = config.projectGroups;
  const merged = configured.length
    ? [...configured.filter((group) => all.includes(group)), ...configured.filter((group) => !all.includes(group))]
    : all;
  const items = filterProjectGroupOptions(merged, scope);
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
  blendMeta?: import('@scm/db').DemandPlanWeekBlendMeta | null;
  inStockDayRatio?: string | null;
};

const MAX_SCOPE_FILTERS = 50;

function readDemandPlanPlatformsQuery(c: Context): string[] {
  const fromMulti = c.req.queries('platforms') ?? [];
  const fromSingle = c.req.query('platforms')?.trim();
  const raw = fromMulti.length
    ? fromMulti
    : fromSingle
      ? [fromSingle]
      : [];
  return [
    ...new Set(
      raw
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function readDemandPlanCategoryQuery(c: Context): { categories: string[] } | { error: string } {
  const fromMulti = [
    ...new Set((c.req.queries('categories') ?? []).map((item) => item.trim()).filter(Boolean)),
  ];
  const single = c.req.query('category')?.trim();
  const categories = fromMulti.length ? fromMulti : single ? [single] : [];
  if (categories.length > MAX_SCOPE_FILTERS) {
    return { error: `品类最多选择 ${MAX_SCOPE_FILTERS} 个` };
  }
  return { categories };
}

function demandPlanSkuCodeFilterSql(skuCode?: string): SQL | undefined {
  const query = parseForecastSkuQuery(skuCode);
  if (query.kind === 'fuzzy') return ilike(skus.code, `%${query.token}%`);
  if (query.kind === 'exact') return inArray(sql`upper(${skus.code})`, query.codes);
  return undefined;
}

function demandPlanCategoryFilterSql(categories?: string[]): SQL | undefined {
  const filters = resolveCategoryFilters({ categories });
  if (!filters.length) return undefined;
  return categoriesMatchFilterCondition(sql<string | null>`null`, skus.category, filters);
}

function parseDemandPlanListQuery(c: Context):
  | {
      channelView?: string;
      platforms: string[];
      profileSegment?: string;
      pendingCalibration: boolean;
      categories: string[];
      productScope: ProductScope;
    }
  | { error: string } {
  const channelView = c.req.query('channelView')?.trim() || undefined;
  const platforms = readDemandPlanPlatformsQuery(c);
  const pendingCalibration = c.req.query('pendingCalibration')?.trim() === 'true';
  const profileSegmentRaw = c.req.query('profileSegment')?.trim() || undefined;
  const profileSegment =
    resolveHorizonProfileSegmentFilter({
      profileSegment: profileSegmentRaw,
      pendingCalibration,
    }) ?? undefined;
  const categoryQuery = readDemandPlanCategoryQuery(c);
  if ('error' in categoryQuery) return categoryQuery;
  return {
    channelView,
    platforms,
    profileSegment,
    pendingCalibration,
    categories: categoryQuery.categories,
    productScope: parseProductScope(c.req.query('productScope')),
  };
}

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
  skuScopeCond?: SQL;
  channelView?: string;
  platforms?: string[];
  profileSegment?: string;
  categories?: string[];
  productScope?: ProductScope;
  periods: string[];
}) {
  const channel = resolveDemandPlanChannelQuery({
    channelView: input.channelView,
    platforms: input.platforms,
  });
  const allSkus = await listDemandPlanWeeklySkuRefs(input);
  const skuIdsAll = allSkus.map((row) => row.skuId);
  const [metaBySku, storedMetaBySku] = await Promise.all([
    loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
    loadDemandPlanStoredRowMetaForSkus(input.versionId, skuIdsAll),
  ]);
  const filtered = filterSkusByProfileSegment(
    allSkus,
    metaBySku,
    input.profileSegment,
    storedMetaBySku,
  );
  const sorted = sortDemandPlanSkus(filtered, metaBySku, storedMetaBySku);
  const rowKeys = buildDemandPlanListRowKeys(sorted, channel);
  const { pairs, total } = paginateDemandPlanLongPairs({
    rowKeys,
    periods: input.periods,
    offset: input.offset,
    pageSize: input.pageSize,
  });
  const pageRowKeys = [...new Map(pairs.map((pair) => [`${pair.rowKey.skuId}::${pair.rowKey.platform}`, pair.rowKey])).values()];
  const skuIds = [...new Set(pageRowKeys.map((key) => key.skuId))];
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
          blendMeta: demandPlanWeekly.blendMeta,
        })
        .from(demandPlanWeekly)
        .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
        .where(and(eq(demandPlanWeekly.versionId, input.versionId), inArray(demandPlanWeekly.skuId, skuIds)))
        .orderBy(skus.code, demandPlanWeekly.period)
    : [];
  const skuCodeById = new Map(sorted.map((row) => [row.skuId, row.skuCode ?? '—']));
  const skuNameById = new Map(sorted.map((row) => [row.skuId, row.skuName ?? null]));
  const wideRows = enrichDemandPlanWideRows({
    rowKeys: pageRowKeys,
    skuCodeById,
    skuNameById,
    rows,
    metaBySku,
    storedMetaBySku,
    channel,
  });
  const wideByKey = new Map(
    wideRows.map((row) => [`${row.skuId}::${row.platform}`, row] as const),
  );
  const items = pairs
    .map(({ rowKey, period }) => {
      const wide = wideByKey.get(`${rowKey.skuId}::${rowKey.platform}`);
      const cell = wide?.cells[period];
      if (!wide || !cell) return null;
      return {
        ...cell,
        skuCode: wide.skuCode,
        skuName: wide.skuName,
        platform: wide.platform,
        profileSegment: wide.profileSegment,
        lifecycle: wide.lifecycle,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  return {
    items,
    total,
    skuTotal: sorted.length,
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
  skuScopeCond?: SQL;
}) {
  const filters = [eq(demandPlanMonthly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuScopeCond) filters.push(input.skuScopeCond);
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

async function listDemandPlanWeeklySkuRefs(input: {
  versionId: string;
  skuCode?: string;
  skuScopeCond?: SQL;
  categories?: string[];
  productScope?: ProductScope;
}): Promise<DemandPlanSkuRef[]> {
  const filters: SQL[] = [
    eq(demandPlanWeekly.versionId, input.versionId),
    productScopeSql(input.productScope ?? 'goods'),
  ];
  if (input.skuScopeCond) filters.push(input.skuScopeCond);
  const skuCond = demandPlanSkuCodeFilterSql(input.skuCode);
  if (skuCond) filters.push(skuCond);
  const categoryCond = demandPlanCategoryFilterSql(input.categories);
  if (categoryCond) filters.push(categoryCond);
  const where = and(...filters);
  return db
    .select({
      skuId: demandPlanWeekly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
    })
    .from(demandPlanWeekly)
    .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
    .where(where)
    .groupBy(demandPlanWeekly.skuId, skus.code, skus.name);
}

async function listDemandPlanWeeklyWide(input: {
  versionId: string;
  skuCode?: string;
  page: number;
  pageSize: number;
  offset: number;
  skuScopeCond?: SQL;
  channelView?: string;
  platforms?: string[];
  profileSegment?: string;
  categories?: string[];
  productScope?: ProductScope;
}) {
  const channel = resolveDemandPlanChannelQuery({
    channelView: input.channelView,
    platforms: input.platforms,
  });
  const allSkus = await listDemandPlanWeeklySkuRefs(input);
  const skuIdsAll = allSkus.map((row) => row.skuId);
  const [metaBySku, storedMetaBySku] = await Promise.all([
    loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
    loadDemandPlanStoredRowMetaForSkus(input.versionId, skuIdsAll),
  ]);
  const filtered = filterSkusByProfileSegment(
    allSkus,
    metaBySku,
    input.profileSegment,
    storedMetaBySku,
  );
  const sorted = sortDemandPlanSkus(filtered, metaBySku, storedMetaBySku);
  const rowKeys = buildDemandPlanListRowKeys(sorted, channel);
  const pageKeys = rowKeys.slice(input.offset, input.offset + input.pageSize);
  const skuIds = [...new Set(pageKeys.map((key) => key.skuId))];
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
          blendMeta: demandPlanWeekly.blendMeta,
        })
        .from(demandPlanWeekly)
        .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
        .where(and(eq(demandPlanWeekly.versionId, input.versionId), inArray(demandPlanWeekly.skuId, skuIds)))
        .orderBy(skus.code, demandPlanWeekly.period)
    : [];
  const skuCodeById = new Map(sorted.map((row) => [row.skuId, row.skuCode ?? '—']));
  const skuNameById = new Map(sorted.map((row) => [row.skuId, row.skuName ?? null]));
  return {
    items: enrichDemandPlanWideRows({
      rowKeys: pageKeys,
      skuCodeById,
      skuNameById,
      rows,
      metaBySku,
      storedMetaBySku,
      channel,
    }),
    total: rowKeys.length,
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
  skuScopeCond?: SQL;
}) {
  const filters = [eq(demandPlanMonthly.versionId, input.versionId), excludeAccessorySkuSql()];
  if (input.skuScopeCond) filters.push(input.skuScopeCond);
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

async function readDemandPlanCalibrationImportCsvBuffer(c: Context): Promise<Buffer | Response> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ message: 'file is required' }, 400);
    }
    return Buffer.from(await file.arrayBuffer());
  }
  const body = await c.req.json<{ csv?: string }>().catch(() => ({ csv: undefined }));
  const csv = body.csv?.trim();
  if (!csv) {
    return c.json({ message: 'csv or file is required' }, 400);
  }
  return Buffer.from(csv, 'utf8');
}

async function loadWeeklyRowsForExport(versionId: string, skuIds: string[]) {
  if (!skuIds.length) return [];
  return db
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
      blendMeta: demandPlanWeekly.blendMeta,
    })
    .from(demandPlanWeekly)
    .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
    .where(and(eq(demandPlanWeekly.versionId, versionId), inArray(demandPlanWeekly.skuId, skuIds)))
    .orderBy(skus.code, demandPlanWeekly.period);
}

async function loadDemandPlanStoredRowMetaForSkus(versionId: string, skuIds: string[]) {
  if (!skuIds.length) return demandPlanStoredRowMetaBySku([]);
  const rows = await db
    .select({
      skuId: demandPlanWeekly.skuId,
      blendMeta: demandPlanWeekly.blendMeta,
    })
    .from(demandPlanWeekly)
    .where(and(eq(demandPlanWeekly.versionId, versionId), inArray(demandPlanWeekly.skuId, skuIds)))
    .orderBy(demandPlanWeekly.skuId, demandPlanWeekly.period);
  return demandPlanStoredRowMetaBySku(rows);
}

demandPlanRoutes.get('/demand-plans/horizon/export', menuGuard, async (c) => {
  const versionId = c.req.query('versionId')?.trim();
  if (!versionId) {
    return c.json({ message: 'versionId is required' }, 400);
  }
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }
  if (!version.startWeek) {
    return c.json({ message: '仅周粒度需求计划支持矩阵导出' }, 400);
  }

  const modeRaw = c.req.query('mode')?.trim().toLowerCase();
  const mode: DemandPlanHorizonExportMode =
    modeRaw === 'detail' ? 'detail' : modeRaw === 'calibration' ? 'calibration' : 'wide';
  if (mode === 'calibration') {
    const channelView = c.req.query('channelView')?.trim().toLowerCase();
    if (channelView !== 'by_channel') {
      return c.json(
        { message: '导出校准表须使用分平台视图：在矩阵筛选区将「合计/分平台」切换为「分平台」' },
        400,
      );
    }
  }

  const scope = await resolveRequestProjectGroupScope(c);
  if (
    scope.mode === 'restricted' &&
    !isAllScopeProjectGroup(version.projectGroup) &&
    !scope.groups.includes(version.projectGroup.trim())
  ) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }

  const listQuery = parseDemandPlanListQuery(c);
  if ('error' in listQuery) {
    return c.json({ message: listQuery.error }, 400);
  }
  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const skuScopeCond = skuProjectGroupCondition(scope);
  const periods = buildDemandPlanPeriodColumns(version);

  const dataset = await loadDemandPlanHorizonExportDataset({
    versionId,
    skuCode,
    channelView: listQuery.channelView,
    platforms: listQuery.platforms,
    profileSegment: listQuery.profileSegment,
    categories: listQuery.categories,
    productScope: listQuery.productScope,
    skuScopeCond,
    periods,
    listWeeklySkuRefs: listDemandPlanWeeklySkuRefs,
    listWeeklyRows: ({ versionId: vid, skuIds }) => loadWeeklyRowsForExport(vid, skuIds),
    listStoredRowMeta: ({ versionId: vid, skuIds }) =>
      loadDemandPlanStoredRowMetaForSkus(vid, skuIds),
  });

  const built = buildDemandPlanHorizonExportCsv(mode, dataset);
  if (mode === 'calibration' && built.rowCount === 0) {
    return c.json({ message: '当前筛选下无分平台计划行，请调整筛选或确认已生成计划' }, 400);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = version.versionNo.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48);
  const suffix = mode === 'detail' ? 'detail' : mode === 'calibration' ? 'calibration' : 'wide';
  return csvAttachment(`demand-plan-horizon-${suffix}-${safeName}-${stamp}.csv`, built.csv);
});

demandPlanRoutes.get('/demand-plans/:id/accuracy/export', menuGuard, async (c) => {
  const versionId = c.req.param('id')?.trim();
  if (!versionId) return c.json({ message: 'version id required' }, 400);

  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);
  if (!version.startWeek) {
    return c.json({ message: '仅周粒度需求计划支持准确度导出' }, 400);
  }

  const scope = await resolveRequestProjectGroupScope(c);
  if (
    scope.mode === 'restricted' &&
    !isAllScopeProjectGroup(version.projectGroup) &&
    !scope.groups.includes(version.projectGroup.trim())
  ) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }

  const listQuery = parseDemandPlanListQuery(c);
  if ('error' in listQuery) {
    return c.json({ message: listQuery.error }, 400);
  }
  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const skuScopeCond = skuProjectGroupCondition(scope);
  const allSkus = await listDemandPlanWeeklySkuRefs({
    versionId,
    skuCode,
    skuScopeCond,
    categories: listQuery.categories,
    productScope: listQuery.productScope,
  });
  const skuIdsAll = allSkus.map((row) => row.skuId);
  const [metaBySku, storedMetaBySku] = await Promise.all([
    loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
    loadDemandPlanStoredRowMetaForSkus(versionId, skuIdsAll),
  ]);
  const filtered = filterSkusByProfileSegment(
    allSkus,
    metaBySku,
    listQuery.profileSegment,
    storedMetaBySku,
  );
  const sorted = sortDemandPlanSkus(filtered, metaBySku, storedMetaBySku);
  const skuIds = sorted.map((row) => row.skuId);
  const skuCodeById = new Map(sorted.map((row) => [row.skuId, row.skuCode ?? '—']));

  const weeklyRows = skuIds.length
    ? await db
        .select({
          skuId: demandPlanWeekly.skuId,
          period: demandPlanWeekly.period,
          systemDailyAvg: demandPlanWeekly.systemDailyAvg,
          manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        })
        .from(demandPlanWeekly)
        .where(and(eq(demandPlanWeekly.versionId, versionId), inArray(demandPlanWeekly.skuId, skuIds)))
        .orderBy(demandPlanWeekly.period)
    : [];

  const planRows = weeklyRows.map((row) => ({
    skuId: row.skuId,
    skuCode: skuCodeById.get(row.skuId) ?? '—',
    period: row.period,
    systemDailyAvg: String(row.systemDailyAvg),
    manualDailyAvg: row.manualDailyAvg != null ? String(row.manualDailyAvg) : null,
  }));

  const built = await buildDemandPlanAccuracyExportCsv({ planRows });
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = version.versionNo.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48);
  return csvAttachment(`demand-plan-accuracy-${safeName}-${stamp}.csv`, built.csv);
});

demandPlanRoutes.get('/demand-plans/:id/accuracy/summary', menuGuard, async (c) => {
  const versionId = c.req.param('id')?.trim();
  if (!versionId) return c.json({ message: 'version id required' }, 400);

  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);
  if (!version.startWeek) {
    return c.json({ message: '仅周粒度需求计划支持准确度复盘' }, 400);
  }

  const scope = await resolveRequestProjectGroupScope(c);
  if (
    scope.mode === 'restricted' &&
    !isAllScopeProjectGroup(version.projectGroup) &&
    !scope.groups.includes(version.projectGroup.trim())
  ) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }

  const listQuery = parseDemandPlanListQuery(c);
  if ('error' in listQuery) {
    return c.json({ message: listQuery.error }, 400);
  }
  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const { page, pageSize } = parseListPagination(c.req.query('page'), c.req.query('pageSize'), 20);
  const skuScopeCond = skuProjectGroupCondition(scope);
  const allSkus = await listDemandPlanWeeklySkuRefs({
    versionId,
    skuCode,
    skuScopeCond,
    categories: listQuery.categories,
    productScope: listQuery.productScope,
  });
  const skuIdsAll = allSkus.map((row) => row.skuId);
  const [metaBySku, storedMetaBySku] = await Promise.all([
    loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
    loadDemandPlanStoredRowMetaForSkus(versionId, skuIdsAll),
  ]);
  const filtered = filterSkusByProfileSegment(
    allSkus,
    metaBySku,
    listQuery.profileSegment,
    storedMetaBySku,
  );
  const sorted = sortDemandPlanSkus(filtered, metaBySku, storedMetaBySku);
  const skuIds = sorted.map((row) => row.skuId);
  const skuCodeById = new Map(sorted.map((row) => [row.skuId, row.skuCode ?? '—']));

  const weeklyRows = skuIds.length
    ? await db
        .select({
          skuId: demandPlanWeekly.skuId,
          period: demandPlanWeekly.period,
          systemDailyAvg: demandPlanWeekly.systemDailyAvg,
          manualDailyAvg: demandPlanWeekly.manualDailyAvg,
        })
        .from(demandPlanWeekly)
        .where(and(eq(demandPlanWeekly.versionId, versionId), inArray(demandPlanWeekly.skuId, skuIds)))
        .orderBy(demandPlanWeekly.period)
    : [];

  const planRows = weeklyRows.map((row) => ({
    skuId: row.skuId,
    skuCode: skuCodeById.get(row.skuId) ?? '—',
    period: row.period,
    systemDailyAvg: String(row.systemDailyAvg),
    manualDailyAvg: row.manualDailyAvg != null ? String(row.manualDailyAvg) : null,
  }));

  const built = await buildDemandPlanAccuracyRows({ planRows });
  const pageResult = paginateDemandPlanAccuracySkuSummaries(built.skuSummaries, page, pageSize);
  return c.json({
    ...pageResult,
    totals: {
      skuCount: built.skuCount,
      comparedWeekCount: built.comparedWeekCount,
    },
  });
});

demandPlanRoutes.get('/demand-plans/:id/review-summary', menuGuard, async (c) => {
  const versionId = c.req.param('id')?.trim();
  if (!versionId) return c.json({ message: 'version id required' }, 400);
  const scope = await resolveRequestProjectGroupScope(c);
  const [version] = await db
    .select({
      id: demandPlanVersions.id,
      projectGroup: demandPlanVersions.projectGroup,
    })
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);
  if (
    scope.mode === 'restricted' &&
    !isAllScopeProjectGroup(version.projectGroup) &&
    !scope.groups.includes(version.projectGroup.trim())
  ) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }
  try {
    const summary = await buildDemandPlanReviewSummary(versionId);
    return c.json(summary);
  } catch (err) {
    const mapped = mapRouteError(err, '加载复核摘要失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

async function handleDemandPlanCalibrationImport(c: Context, commit: boolean) {
  const versionId = c.req.param('id')?.trim();
  if (!versionId) return c.json({ message: 'version id required' }, 400);

  const bufferOrResponse = await readDemandPlanCalibrationImportCsvBuffer(c);
  if (bufferOrResponse instanceof Response) return bufferOrResponse;

  try {
    const result = await runDemandPlanCalibrationImport({
      versionId,
      csvBuffer: bufferOrResponse,
      commit,
    });
    if (commit && result.hasBlockingIssues) {
      return c.json({ message: '导入存在错误，未写入', ...result }, 400);
    }
    if (commit && result.applied != null && result.applied > 0) {
      const user = await getCurrentUser(c);
      await writeAuditLog(c, {
        action: 'demand_plan.calibration_import',
        resourceType: 'demand_plan_version',
        resourceId: versionId,
        detail: {
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors,
          applied: result.applied,
        },
        user,
      });
    }
    return c.json(result);
  } catch (err) {
    const mapped = mapRouteError(err, 'Calibration import failed');
    return c.json({ message: mapped.message }, mapped.status);
  }
}

demandPlanRoutes.post(
  '/demand-plans/:id/calibration-import/preview',
  menuGuard,
  requireWrite(),
  (c) => handleDemandPlanCalibrationImport(c, false),
);

demandPlanRoutes.post(
  '/demand-plans/:id/calibration-import/commit',
  menuGuard,
  requireWrite(),
  (c) => handleDemandPlanCalibrationImport(c, true),
);

async function handleDemandPlanCalibrationClear(c: Context, commit: boolean) {
  const versionId = c.req.param('id')?.trim();
  if (!versionId) return c.json({ message: 'version id required' }, 400);

  try {
    const result = await clearDemandPlanVersionCalibrations({ versionId, commit });
    if (commit && (result.cleared ?? 0) > 0) {
      const user = await getCurrentUser(c);
      await writeAuditLog(c, {
        action: 'demand_plan.calibration_clear',
        resourceType: 'demand_plan_version',
        resourceId: versionId,
        detail: { cleared: result.cleared, rowsWithManual: result.rowsWithManual },
        user,
      });
    }
    return c.json(result);
  } catch (err) {
    const mapped = mapRouteError(err, 'Clear calibration failed');
    return c.json({ message: mapped.message }, mapped.status);
  }
}

demandPlanRoutes.post(
  '/demand-plans/:id/calibration-clear/preview',
  menuGuard,
  requireWrite(),
  (c) => handleDemandPlanCalibrationClear(c, false),
);

demandPlanRoutes.post(
  '/demand-plans/:id/calibration-clear/commit',
  menuGuard,
  requireWrite(),
  (c) => handleDemandPlanCalibrationClear(c, true),
);

demandPlanRoutes.get('/demand-plans/:id/sku-detail', menuGuard, async (c) => {
  const versionId = c.req.param('id');
  const skuId = c.req.query('skuId')?.trim();
  if (!skuId) {
    return c.json({ message: 'skuId is required' }, 400);
  }
  const platform = c.req.query('platform')?.trim() || undefined;
  const station = c.req.query('station')?.trim() || undefined;
  const scope = await resolveRequestProjectGroupScope(c);
  const [skuRow] = await db
    .select({ projectGroup: skus.projectGroup })
    .from(skus)
    .where(eq(skus.id, skuId))
    .limit(1);
  if (!skuRow || !skuInProjectGroupScope(skuRow.projectGroup, scope)) {
    return c.json({ message: 'SKU not found' }, 404);
  }
  try {
    const detail = await loadDemandPlanSkuDetail({ versionId, skuId, platform, station });
    return c.json(detail);
  } catch (err) {
    const mapped = mapRouteError(err, '加载 SKU 详情失败');
    return c.json({ message: mapped.message }, mapped.status);
  }
});

demandPlanRoutes.get('/demand-plans/:id', menuGuard, async (c) => {
  const id = c.req.param('id');
  const scope = await resolveRequestProjectGroupScope(c);
  const [version] = await db
    .select()
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, id))
    .limit(1);
  if (!version) return c.json({ message: '需求计划版本不存在' }, 404);
  if (
    scope.mode === 'restricted' &&
    !isAllScopeProjectGroup(version.projectGroup) &&
    !scope.groups.includes(version.projectGroup.trim())
  ) {
    return c.json({ message: '需求计划版本不存在' }, 404);
  }

  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const view = parseDemandPlanView(c.req.query('view'));
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page'),
    c.req.query('pageSize'),
    view === 'wide' ? 20 : 50,
  );
  const useWeeks = Boolean(version.startWeek);
  const skuScopeCond = skuProjectGroupCondition(scope);
  const listQuery = parseDemandPlanListQuery(c);
  if ('error' in listQuery) {
    return c.json({ message: listQuery.error }, 400);
  }
  const pageInput = {
    versionId: id,
    skuCode,
    page,
    pageSize,
    offset,
    skuScopeCond,
    channelView: listQuery.channelView,
    platforms: listQuery.platforms,
    profileSegment: listQuery.profileSegment,
    categories: listQuery.categories,
    productScope: listQuery.productScope,
  };
  const periods = buildDemandPlanPeriodColumns(version);

  const statsFilters: SQL[] = useWeeks
    ? [eq(demandPlanWeekly.versionId, id), productScopeSql(listQuery.productScope)]
    : [eq(demandPlanMonthly.versionId, id)];
  if (skuScopeCond) statsFilters.push(skuScopeCond);
  const skuCond = demandPlanSkuCodeFilterSql(skuCode);
  if (skuCond) statsFilters.push(skuCond);
  if (useWeeks) {
    const categoryCond = demandPlanCategoryFilterSql(listQuery.categories);
    if (categoryCond) statsFilters.push(categoryCond);
  }
  const statsWhere = and(...statsFilters);
  const statsFrom = useWeeks ? demandPlanWeekly : demandPlanMonthly;
  const statsSkuColumn = useWeeks ? demandPlanWeekly.skuId : demandPlanMonthly.skuId;

  const [[adoption], data, [statsRow], [sampleSku]] = await Promise.all([
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
        ? listDemandPlanWeeklyPage({ ...pageInput, periods })
        : listDemandPlanMonthlyPage(pageInput),
    db
      .select({
        rowTotal: sql<number>`count(*)::int`,
        skuTotal: sql<number>`count(distinct ${statsSkuColumn})::int`,
      })
      .from(statsFrom)
      .innerJoin(skus, eq(skus.id, statsFrom.skuId))
      .where(statsWhere),
    useWeeks
      ? db
          .select({ skuId: demandPlanWeekly.skuId })
          .from(demandPlanWeekly)
          .where(eq(demandPlanWeekly.versionId, id))
          .limit(1)
      : db
          .select({ skuId: demandPlanMonthly.skuId })
          .from(demandPlanMonthly)
          .where(eq(demandPlanMonthly.versionId, id))
          .limit(1),
  ]);

  const championForecastVersion = await resolveDemandPlanChampionForecastVersion({
    frozenVersionId: version.championForecastVersionId,
    sampleSkuId: sampleSku?.skuId ?? null,
  });

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
    championForecastVersion,
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
