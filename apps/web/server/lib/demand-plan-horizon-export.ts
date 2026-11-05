/**
 * 周需求计划列表导出：宽表 / 明细 / 校准表（与 DemandPlanHorizonPanel 筛选一致）。
 */
import type { SQL } from 'drizzle-orm';
import { formatAllCatV41TierLabel } from './forecast-allcat-v41.js';
import { formatForecastChannelLabel } from './forecast-channel-view.js';
import { buildCsv } from './csv-export.js';
import {
  enrichDemandPlanWideRows,
  filterSkusByProfileSegment,
  flattenDemandPlanWideToLongRows,
  resolveDemandPlanChannelQuery,
  sortDemandPlanSkus,
  buildDemandPlanListRowKeys,
  demandPlanStoredRowMetaBySku,
  type DemandPlanWideRow,
} from './demand-plan-enrich.js';
import { loadPublishedForecastSkuMetaBySkuIds } from './forecast-published-resolve.js';
import type { ProjectGroupScope } from './data-scope.js';
import { formatIsoWeekMondayMd, isIsoWeekPeriod } from './planning-calendar.js';

export const DEMAND_PLAN_HORIZON_EXPORT_MAX_SKUS = 20_000;
const PAGE_SIZE = 100;

export type DemandPlanHorizonExportMode = 'wide' | 'detail' | 'calibration';

const LIFECYCLE_LABEL: Record<string, string> = {
  mature: '成熟',
  growth: '增长',
  decline: '下滑',
  new: '新品',
  intermittent: '间歇',
  stockout_suspected: '疑似断货',
};

function formatLifecycle(value?: string | null): string {
  if (!value) return '';
  return LIFECYCLE_LABEL[value] ?? value;
}

function formatTierLabel(segment?: string | null): string {
  if (!segment?.trim()) return '';
  return formatAllCatV41TierLabel(segment);
}

function formatDaily(value: string | number | null | undefined): string {
  if (value == null) return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function effectiveDaily(cell: {
  manualDailyAvg: string | null;
  systemDailyAvg: string;
}): number {
  const manual = cell.manualDailyAvg != null ? Number(cell.manualDailyAvg) : null;
  const system = Number(cell.systemDailyAvg);
  if (manual != null && Number.isFinite(manual)) return manual;
  return Number.isFinite(system) ? system : 0;
}

function weekColumnHeader(period: string): string {
  if (!isIsoWeekPeriod(period)) return period;
  return `${period} (${formatIsoWeekMondayMd(period)})`;
}

export type DemandPlanHorizonExportDataset = {
  periods: string[];
  items: DemandPlanWideRow[];
};

export async function loadDemandPlanHorizonExportDataset(input: {
  versionId: string;
  skuCode?: string;
  channelView?: string;
  platforms?: string[];
  profileSegment?: string;
  categories?: string[];
  productScope?: 'goods' | 'accessory';
  skuScopeCond?: SQL;
  listWeeklySkuRefs: (args: {
    versionId: string;
    skuCode?: string;
    skuScopeCond?: SQL;
    categories?: string[];
    productScope?: 'goods' | 'accessory';
  }) => Promise<Array<{ skuId: string; skuCode: string | null; skuName?: string | null }>>;
  listWeeklyRows: (args: {
    versionId: string;
    skuIds: string[];
  }) => Promise<
    Array<{
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
      blendMeta?: { lifecycle?: string; profileSegment?: string } | null;
    }>
  >;
  listStoredRowMeta?: (args: {
    versionId: string;
    skuIds: string[];
  }) => Promise<Map<string, { lifecycle: string | null; profileSegment: string | null }>>;
  periods: string[];
  maxSkus?: number;
  projectGroupScope?: ProjectGroupScope;
}): Promise<DemandPlanHorizonExportDataset> {
  void input.projectGroupScope;
  const maxSkus = Math.min(
    Math.max(1, input.maxSkus ?? DEMAND_PLAN_HORIZON_EXPORT_MAX_SKUS),
    DEMAND_PLAN_HORIZON_EXPORT_MAX_SKUS,
  );
  const channel = resolveDemandPlanChannelQuery({
    channelView: input.channelView,
    platforms: input.platforms,
  });
  const allSkus = await input.listWeeklySkuRefs({
    versionId: input.versionId,
    skuCode: input.skuCode,
    skuScopeCond: input.skuScopeCond,
    categories: input.categories,
    productScope: input.productScope,
  });
  const skuIdsAll = allSkus.map((row) => row.skuId);
  const [metaBySku, storedMetaBySku] = await Promise.all([
    loadPublishedForecastSkuMetaBySkuIds(skuIdsAll),
    input.listStoredRowMeta
      ? input.listStoredRowMeta({ versionId: input.versionId, skuIds: skuIdsAll })
      : Promise.resolve(demandPlanStoredRowMetaBySku([])),
  ]);
  const filtered = filterSkusByProfileSegment(
    allSkus,
    metaBySku,
    input.profileSegment,
    storedMetaBySku,
  );
  const sorted = sortDemandPlanSkus(filtered, metaBySku, storedMetaBySku);
  const rowKeys = buildDemandPlanListRowKeys(sorted, channel);
  const pageKeys = rowKeys.slice(0, maxSkus);
  const skuIds = [...new Set(pageKeys.map((key) => key.skuId))];
  const rows = skuIds.length
    ? await input.listWeeklyRows({ versionId: input.versionId, skuIds })
    : [];
  const skuCodeById = new Map(sorted.map((row) => [row.skuId, row.skuCode ?? '—']));
  const skuNameById = new Map(sorted.map((row) => [row.skuId, row.skuName ?? null]));
  const items = enrichDemandPlanWideRows({
    rowKeys: pageKeys,
    skuCodeById,
    skuNameById,
    rows,
    metaBySku,
    storedMetaBySku,
    channel,
  });
  return { periods: input.periods, items };
}

export function buildDemandPlanHorizonWideCsv(dataset: DemandPlanHorizonExportDataset): {
  csv: string;
  rowCount: number;
} {
  const headers = [
    'SKU',
    '平台',
    '生命周期',
    '分层',
    ...dataset.periods.map(weekColumnHeader),
  ];
  const rows = dataset.items.map((row) => {
    return [
      row.skuCode,
      formatForecastChannelLabel(row.platform),
      formatLifecycle(row.lifecycle),
      formatTierLabel(row.profileSegment),
      ...dataset.periods.map((period) => {
        const cell = row.cells[period];
        return cell ? formatDaily(effectiveDaily(cell)) : '';
      }),
    ];
  });
  return { csv: buildCsv(headers, rows), rowCount: rows.length };
}

export function buildDemandPlanHorizonDetailCsv(dataset: DemandPlanHorizonExportDataset): {
  csv: string;
  rowCount: number;
} {
  const headers = [
    '时段',
    'SKU',
    '平台',
    '绝对周',
    '生命周期',
    '分层',
    '系统日均',
    '生效日均',
    '校准值',
    '调整原因',
    'Champion',
    '来源',
  ];
  const longRows = flattenDemandPlanWideToLongRows(dataset.items);
  const rows = longRows.map((row) => [
    '未来',
    row.skuCode,
    formatForecastChannelLabel(row.platform),
    row.period,
    formatLifecycle(row.lifecycle),
    formatTierLabel(row.profileSegment),
    formatDaily(row.systemDailyAvg),
    formatDaily(effectiveDaily(row)),
    row.platform === 'ALL' && row.manualDailyAvg != null ? formatDaily(row.manualDailyAvg) : '',
    row.platform === 'ALL' ? (row.adjustReason?.trim() ?? '') : '',
    formatDaily(row.championForecastDaily),
    row.source ?? '',
  ]);
  return { csv: buildCsv(headers, rows), rowCount: rows.length };
}

/** 校准宽表：仅分平台行，列为各周生效日均（可编辑后导入） */
export function buildDemandPlanCalibrationImportCsv(dataset: DemandPlanHorizonExportDataset): {
  csv: string;
  rowCount: number;
} {
  const filtered: DemandPlanHorizonExportDataset = {
    ...dataset,
    items: dataset.items.filter((row) => row.platform !== 'ALL'),
  };
  return buildDemandPlanHorizonWideCsv(filtered);
}

export function buildDemandPlanHorizonExportCsv(
  mode: DemandPlanHorizonExportMode,
  dataset: DemandPlanHorizonExportDataset,
): { csv: string; rowCount: number } {
  if (mode === 'detail') return buildDemandPlanHorizonDetailCsv(dataset);
  if (mode === 'calibration') return buildDemandPlanCalibrationImportCsv(dataset);
  return buildDemandPlanHorizonWideCsv(dataset);
}
