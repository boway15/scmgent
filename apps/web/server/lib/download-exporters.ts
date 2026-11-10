import { and, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import {
  db,
  demandPlanVersions,
  demandPlanWeekly,
  inventoryRecords,
  safetyStockConfig,
  skus,
  warehouses,
} from '@scm/db';
import type { ProjectGroupScope } from './data-scope.js';
import { skuProjectGroupCondition } from './data-scope.js';
import { buildCsv } from './csv-export.js';
import {
  buildForecastHorizonExportCsv,
  type ForecastHorizonExportMode,
} from './forecast-horizon-export.js';
import {
  buildForecastAccuracyExportCsv,
  buildForecastAccuracySkuExportCsv,
} from './forecast-accuracy.js';
import {
  buildDemandPlanHorizonExportCsv,
  loadDemandPlanHorizonExportDataset,
  type DemandPlanHorizonExportMode,
} from './demand-plan-horizon-export.js';
import { buildDemandPlanAccuracyExportCsv } from './demand-plan-accuracy-export.js';
import { buildDemandPlanPeriodColumns } from './demand-plan-periods.js';
import {
  demandPlanStoredRowMetaBySku,
  filterSkusByProfileSegment,
  sortDemandPlanSkus,
  type DemandPlanSkuRef,
} from './demand-plan-enrich.js';
import { loadPublishedForecastSkuMetaBySkuIds } from './forecast-published-resolve.js';
import { productScopeSql, type ProductScope } from './planning-accessory-filter.js';
import { categoriesMatchFilterCondition, resolveCategoryFilters } from './sku-category.js';
import { parseForecastSkuQuery } from './forecast-sku-query.js';
import { buildInventoryQueryExportRows } from './inventory-query-service.js';
import { buildProcurementOpsExportRows } from './procurement-ops-service.js';
import { buildInventoryOverviewExportItems } from './inventory-overview-service.js';
import { getViewColumnIds, resolveOverviewColumnIds } from './inventory-overview-views.js';
import { getOverviewCellValue } from './inventory-overview-cell-value.js';
import { INVENTORY_OVERVIEW_COLUMN_BY_ID } from './inventory-turnover-snapshot.js';
import { buildSupplyLotSummaryExportCsv } from './inventory-supply-lot-summary.js';
import { buildSupplyLotsExportCsv } from './inventory-supply-lot-sync.js';
import {
  buildInventoryDataIssueExportCsv,
  listInventoryDataIssueRowsForExport,
} from './inventory-data-issue-list.js';
import { getLatestInProductionQty } from './inventory-snapshot.js';
import { resolveInventoryPosition } from './inventory-position.js';
import { normalizeReplenishLight } from './replenish-light.js';
import type { DownloadJobRow } from './download-jobs.js';

export type DownloadExportResult = {
  content: string | Buffer;
  contentType: string;
  fileName: string;
  rowCount?: number;
};

type Exporter = (
  params: Record<string, unknown>,
  job: DownloadJobRow,
) => Promise<DownloadExportResult>;

const CSV_TYPE = 'text/csv; charset=utf-8';

function asScope(raw: unknown): ProjectGroupScope {
  if (raw && typeof raw === 'object' && (raw as { mode?: string }).mode === 'restricted') {
    const groups = Array.isArray((raw as { groups?: unknown }).groups)
      ? ((raw as { groups: unknown[] }).groups.filter((g) => typeof g === 'string') as string[])
      : [];
    return { mode: 'restricted', groups };
  }
  return { mode: 'all' };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
  return out.length ? out : undefined;
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
  const skuQuery = parseForecastSkuQuery(input.skuCode);
  if (skuQuery.kind === 'fuzzy') filters.push(ilike(skus.code, `%${skuQuery.token}%`));
  else if (skuQuery.kind === 'exact') filters.push(inArray(sql`upper(${skus.code})`, skuQuery.codes));
  const categoryFilters = resolveCategoryFilters({ categories: input.categories });
  if (categoryFilters.length) {
    const categoryCond = categoriesMatchFilterCondition(
      sql<string | null>`null`,
      skus.category,
      categoryFilters,
    );
    if (categoryCond) filters.push(categoryCond);
  }
  return db
    .select({
      skuId: demandPlanWeekly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
    })
    .from(demandPlanWeekly)
    .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
    .where(and(...filters))
    .groupBy(demandPlanWeekly.skuId, skus.code, skus.name);
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

const exporters: Record<string, Exporter> = {
  async sales_forecast_horizon(params) {
    const mode = (str(params.mode) as ForecastHorizonExportMode) || 'wide';
    const versionId = str(params.versionId);
    if (!versionId) throw new Error('versionId is required');
    const scopeEmpty = params.scopeEmpty === true;
    const built = scopeEmpty
      ? { csv: '', rowCount: 0 }
      : await buildForecastHorizonExportCsv({
          mode,
          versionId,
          station: str(params.station),
          platform: str(params.platform),
          platforms: strList(params.platforms),
          channelView: str(params.channelView),
          skuCode: str(params.skuCode),
          categories: strList(params.categories),
          profileSegment: str(params.profileSegment),
          pendingCalibration: params.pendingCalibration === true || undefined,
          monthCount: typeof params.monthCount === 'number' ? params.monthCount : undefined,
          historyMonthCount:
            mode === 'calibration'
              ? 0
              : typeof params.historyMonthCount === 'number'
                ? params.historyMonthCount
                : undefined,
          projectGroupScope: asScope(params.projectGroupScope),
        });
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = String(params.versionNo ?? versionId)
      .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
      .slice(0, 48);
    const suffix = mode === 'detail' ? 'detail' : mode === 'calibration' ? 'calibration' : 'wide';
    return {
      content: built.csv,
      contentType: CSV_TYPE,
      fileName: `forecast-horizon-${suffix}-${safeName}-${stamp}.csv`,
      rowCount: built.rowCount,
    };
  },

  async sales_forecast_accuracy(params) {
    const versionId = str(params.versionId);
    if (!versionId) throw new Error('versionId is required');
    const scopeEmpty = params.scopeEmpty === true;
    const groupBy = str(params.groupBy);
    const rowKind = str(params.rowKind) === 'miss' ? 'miss' : 'predicted';
    const base = {
      versionId,
      year: typeof params.year === 'number' ? params.year : undefined,
      month: typeof params.month === 'number' ? params.month : undefined,
      station: str(params.station),
      platform: str(params.platform),
      rowKind: rowKind as 'miss' | 'predicted',
      projectGroupScope: asScope(params.projectGroupScope),
    };
    const { csv, rowCount } = scopeEmpty
      ? { csv: '', rowCount: 0 }
      : groupBy === 'sku'
        ? await buildForecastAccuracySkuExportCsv(base)
        : await buildForecastAccuracyExportCsv(base);
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = String(params.versionNo ?? versionId)
      .replace(/[^\w\u4e00-\u9fff-]+/g, '_')
      .slice(0, 48);
    const suffix =
      groupBy === 'sku'
        ? rowKind === 'miss'
          ? 'miss-sku-summary'
          : 'sku-summary'
        : rowKind === 'miss'
          ? 'miss'
          : 'detail';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `forecast-accuracy-${suffix}-${safeName}-${stamp}.csv`,
      rowCount,
    };
  },

  async demand_plan_horizon(params) {
    const versionId = str(params.versionId);
    if (!versionId) throw new Error('versionId is required');
    const [version] = await db
      .select()
      .from(demandPlanVersions)
      .where(eq(demandPlanVersions.id, versionId))
      .limit(1);
    if (!version?.startWeek) throw new Error('仅周粒度需求计划支持矩阵导出');
    const mode = (str(params.mode) as DemandPlanHorizonExportMode) || 'wide';
    const scope = asScope(params.projectGroupScope);
    const skuScopeCond = skuProjectGroupCondition(scope);
    const periods = buildDemandPlanPeriodColumns(version);
    const dataset = await loadDemandPlanHorizonExportDataset({
      versionId,
      skuCode: str(params.skuCode),
      channelView: str(params.channelView),
      platforms: strList(params.platforms),
      profileSegment: str(params.profileSegment),
      categories: strList(params.categories),
      productScope: (str(params.productScope) as ProductScope) || 'goods',
      skuScopeCond,
      periods,
      listWeeklySkuRefs: listDemandPlanWeeklySkuRefs,
      listWeeklyRows: ({ versionId: vid, skuIds }) => loadWeeklyRowsForExport(vid, skuIds),
      listStoredRowMeta: ({ versionId: vid, skuIds }) =>
        loadDemandPlanStoredRowMetaForSkus(vid, skuIds),
    });
    const built = buildDemandPlanHorizonExportCsv(mode, dataset);
    if (mode === 'calibration' && built.rowCount === 0) {
      throw new Error('当前筛选下无分平台计划行，请调整筛选或确认已生成计划');
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = version.versionNo.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48);
    const suffix = mode === 'detail' ? 'detail' : mode === 'calibration' ? 'calibration' : 'wide';
    return {
      content: built.csv,
      contentType: CSV_TYPE,
      fileName: `demand-plan-horizon-${suffix}-${safeName}-${stamp}.csv`,
      rowCount: built.rowCount,
    };
  },

  async demand_plan_accuracy(params) {
    const versionId = str(params.versionId);
    if (!versionId) throw new Error('versionId is required');
    const [version] = await db
      .select()
      .from(demandPlanVersions)
      .where(eq(demandPlanVersions.id, versionId))
      .limit(1);
    if (!version?.startWeek) throw new Error('仅周粒度需求计划支持准确度导出');
    const scope = asScope(params.projectGroupScope);
    const skuScopeCond = skuProjectGroupCondition(scope);
    const allSkus = await listDemandPlanWeeklySkuRefs({
      versionId,
      skuCode: str(params.skuCode),
      skuScopeCond,
      categories: strList(params.categories),
      productScope: (str(params.productScope) as ProductScope) || 'goods',
    });
    const skuIdsAll = allSkus.map((row) => row.skuId);
    const [metaBySku, storedMetaBySku] = await Promise.all([
      loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
      loadDemandPlanStoredRowMetaForSkus(versionId, skuIdsAll),
    ]);
    const filtered = filterSkusByProfileSegment(
      allSkus,
      metaBySku,
      str(params.profileSegment),
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
    return {
      content: built.csv,
      contentType: CSV_TYPE,
      fileName: `demand-plan-accuracy-${safeName}-${stamp}.csv`,
      rowCount: built.rowCount,
    };
  },

  async inventory_query(params) {
    const projectGroupScope = asScope(params.projectGroupScope);
    const exported = await buildInventoryQueryExportRows({
      q: str(params.q),
      category: str(params.category),
      salesCountry: str(params.salesCountry),
      lifecycle: str(params.lifecycle),
      snapshotDate: str(params.snapshotDate),
      productScope: (str(params.productScope) as 'goods' | 'accessory') || 'goods',
      columns: strList(params.columns),
      projectGroupScope,
    });
    const csv = buildCsv(exported.headers, exported.rows);
    const date = exported.selectedSnapshotDate ?? new Date().toISOString().slice(0, 10);
    const scope = (str(params.productScope) as string) || 'goods';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-query-${date}-${scope}.csv`,
      rowCount: exported.rows.length,
    };
  },

  async inventory_procurement_ops(params) {
    const projectGroupScope = asScope(params.projectGroupScope);
    const exported = await buildProcurementOpsExportRows({
      q: str(params.q),
      category: str(params.category),
      salesCountry: str(params.salesCountry),
      lifecycle: str(params.lifecycle),
      snapshotDate: str(params.snapshotDate),
      productScope: (str(params.productScope) as 'goods' | 'accessory') || 'goods',
      projectGroupScope,
    });
    const csv = buildCsv(exported.headers, exported.rows);
    const date = exported.selectedSnapshotDate ?? new Date().toISOString().slice(0, 10);
    const scope = (str(params.productScope) as string) || 'goods';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `procurement-ops-${date}-${scope}.csv`,
      rowCount: exported.rows.length,
    };
  },

  async inventory_overview(params) {
    const projectGroupScope = asScope(params.projectGroupScope);
    const full = params.full === true;
    const filters = (params.filters as Record<string, unknown>) ?? {};
    const columnIds = full
      ? getViewColumnIds('feishu_full')
      : resolveOverviewColumnIds({
          view: str(filters.view),
          columns: strList(filters.columns),
        }) ?? getViewColumnIds('replenish');
    const items = await buildInventoryOverviewExportItems(
      { ...(filters as object), projectGroupScope } as Parameters<
        typeof buildInventoryOverviewExportItems
      >[0],
      { fullColumns: full },
    );
    const headers = columnIds.map((id) => INVENTORY_OVERVIEW_COLUMN_BY_ID.get(id)?.label ?? id);
    const rows = items.map((item) => columnIds.map((colId) => getOverviewCellValue(item, colId)));
    const csv = buildCsv(headers, rows);
    const date = new Date().toISOString().slice(0, 10);
    const scope = str(filters.productScope) || 'goods';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-turnover-${date}-${scope}.csv`,
      rowCount: rows.length,
    };
  },

  async inventory_full(params) {
    const scope = asScope(params.projectGroupScope);
    const scopeCond = skuProjectGroupCondition(scope);
    const warehouseFilter = str(params.warehouse);
    const whList = warehouseFilter
      ? [{ code: warehouseFilter }]
      : await db
          .select({ code: warehouses.code })
          .from(warehouses)
          .where(eq(warehouses.isActive, true))
          .orderBy(warehouses.sortOrder);
    const skuWhere = scopeCond ? and(eq(skus.isActive, true), scopeCond) : eq(skus.isActive, true);
    const skuRows = await db
      .select({
        id: skus.id,
        code: skus.code,
        name: skus.name,
        replenishLight: skus.replenishLight,
      })
      .from(skus)
      .where(skuWhere)
      .orderBy(skus.code);
    const rows: Array<Array<string | number>> = [];
    for (const sku of skuRows) {
      const qtyInProduction = await getLatestInProductionQty(sku.id);
      for (const wh of whList) {
        const [record] = await db
          .select({
            qtyAvailable: inventoryRecords.qtyAvailable,
            qtyInTransit: inventoryRecords.qtyInTransit,
            qtyReserved: inventoryRecords.qtyReserved,
          })
          .from(inventoryRecords)
          .where(and(eq(inventoryRecords.skuId, sku.id), eq(inventoryRecords.warehouse, wh.code)))
          .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
          .limit(1);
        const [cfg] = await db
          .select({ reorderPoint: safetyStockConfig.reorderPoint })
          .from(safetyStockConfig)
          .where(
            and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, wh.code)),
          )
          .limit(1);
        const qtyAvailable = record?.qtyAvailable ?? 0;
        const qtyInTransit = record?.qtyInTransit ?? 0;
        const qtyReserved = record?.qtyReserved ?? 0;
        const localEffectiveQty = qtyAvailable + qtyInTransit;
        const position = await resolveInventoryPosition({
          skuId: sku.id,
          warehouseCode: wh.code,
        });
        rows.push([
          wh.code,
          sku.code,
          sku.name,
          normalizeReplenishLight(sku.replenishLight),
          qtyAvailable,
          qtyInTransit,
          qtyInProduction,
          qtyReserved,
          localEffectiveQty,
          position.effectiveQty,
          cfg?.reorderPoint ?? '',
        ]);
      }
    }
    const csv = buildCsv(
      [
        'warehouse',
        'sku_code',
        'sku_name',
        'replenish_light',
        'qty_available',
        'qty_in_transit',
        'sku_qty_in_production',
        'qty_reserved',
        'local_effective_qty',
        'effective_qty',
        'reorder_point',
      ],
      rows,
    );
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: rows.length,
    };
  },

  async inventory_pools_summary(params) {
    const filters = (params.filters as Record<string, unknown>) ?? {};
    const csv = await buildSupplyLotSummaryExportCsv(filters as Parameters<
      typeof buildSupplyLotSummaryExportCsv
    >[0]);
    const scope = str(filters.productScope) || 'goods';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-pools-summary-${new Date().toISOString().slice(0, 10)}-${scope}.csv`,
    };
  },

  async inventory_pools(params) {
    const filters = (params.filters as Record<string, unknown>) ?? {};
    const csv = await buildSupplyLotsExportCsv(
      filters as Parameters<typeof buildSupplyLotsExportCsv>[0],
    );
    const poolSuffix = str(filters.pool) ?? 'all';
    const scope = str(filters.productScope) || 'goods';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-pools-batches-${poolSuffix}-${new Date().toISOString().slice(0, 10)}-${scope}.csv`,
    };
  },

  async inventory_data_issues(params) {
    const filters = (params.filters as Record<string, unknown>) ?? {};
    const { items, truncated } = await listInventoryDataIssueRowsForExport(
      filters as Parameters<typeof listInventoryDataIssueRowsForExport>[0],
    );
    const { headers, bodyRows } = buildInventoryDataIssueExportCsv(items);
    const csv = buildCsv(headers, bodyRows);
    const date = new Date().toISOString().slice(0, 10);
    const scope = str(filters.productScope) === 'accessory' ? 'accessory' : 'goods';
    const suffix = truncated ? '-truncated' : '';
    return {
      content: csv,
      contentType: CSV_TYPE,
      fileName: `inventory-data-issues-${date}-${scope}${suffix}.csv`,
      rowCount: bodyRows.length,
    };
  },
};

export async function runDownloadExporter(
  jobType: string,
  params: Record<string, unknown>,
  job: DownloadJobRow,
): Promise<DownloadExportResult> {
  const exporter = exporters[jobType];
  if (!exporter) throw new Error(`未知下载任务类型: ${jobType}`);
  return exporter(params, job);
}
