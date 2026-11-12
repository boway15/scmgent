import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, inventoryDataIssues, skus } from '@scm/db';
import type { ProductScope } from './planning-accessory-filter.js';
import { parseProductScope, productScopeSql } from './planning-accessory-filter.js';
import { UNMAPPED_WAREHOUSE_FP_PREFIX } from './region-unmapped-scan.js';

export type InventoryDataIssueListFilters = {
  status?: string;
  issueType?: string;
  q?: string;
  productScope: ProductScope;
};

export function parseInventoryDataIssueListFilters(input: {
  status?: string;
  type?: string;
  q?: string;
  productScope?: string;
}): InventoryDataIssueListFilters {
  return {
    status: input.status?.trim() || undefined,
    issueType: input.type?.trim() || undefined,
    q: input.q?.trim() || undefined,
    productScope: parseProductScope(input.productScope),
  };
}

function buildDataIssueWhere(filters: InventoryDataIssueListFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(
      eq(
        inventoryDataIssues.status,
        filters.status as 'open' | 'in_progress' | 'resolved' | 'dismissed',
      ),
    );
  } else {
    conditions.push(inArray(inventoryDataIssues.status, ['open', 'in_progress']));
  }

  if (filters.issueType) {
    conditions.push(
      eq(
        inventoryDataIssues.issueType,
        filters.issueType as
          | 'missing_available_at'
          | 'unallocated_warehouse'
          | 'share_sum_mismatch'
          | 'unmapped_warehouse'
          | 'unmapped_station'
          | 'position_source_mismatch'
          | 'position_share_gap',
      ),
    );
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(inventoryDataIssues.warehouseCode, pattern),
        ilike(inventoryDataIssues.example, pattern),
      )!,
    );
  }

  conditions.push(productScopeSql(filters.productScope));

  return and(...conditions);
}

const listSelect = {
  id: inventoryDataIssues.id,
  fingerprint: inventoryDataIssues.fingerprint,
  skuId: inventoryDataIssues.skuId,
  skuCode: skus.code,
  skuName: skus.name,
  warehouseCode: inventoryDataIssues.warehouseCode,
  issueType: inventoryDataIssues.issueType,
  impactModule: inventoryDataIssues.impactModule,
  example: inventoryDataIssues.example,
  qty: inventoryDataIssues.qty,
  status: inventoryDataIssues.status,
  ownerId: inventoryDataIssues.ownerId,
  resolutionNote: inventoryDataIssues.resolutionNote,
  lastSeenAt: inventoryDataIssues.lastSeenAt,
  createdAt: inventoryDataIssues.createdAt,
  updatedAt: inventoryDataIssues.updatedAt,
};

export type InventoryDataIssueListRow = Awaited<
  ReturnType<typeof listInventoryDataIssueRows>
>['items'][number];

export async function listInventoryDataIssueRows(input: {
  filters: InventoryDataIssueListFilters;
  limit: number;
  offset: number;
}) {
  const where = buildDataIssueWhere(input.filters);
  const rows = await db
    .select(listSelect)
    .from(inventoryDataIssues)
    .innerJoin(skus, eq(skus.id, inventoryDataIssues.skuId))
    .where(where)
    .orderBy(desc(inventoryDataIssues.lastSeenAt))
    .limit(input.limit)
    .offset(input.offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryDataIssues)
    .innerJoin(skus, eq(skus.id, inventoryDataIssues.skuId))
    .where(where);

  return { items: rows, total: countRow?.count ?? 0 };
}

const EXPORT_ROW_CAP = 50_000;

export async function listInventoryDataIssueRowsForExport(filters: InventoryDataIssueListFilters) {
  const { items, total } = await listInventoryDataIssueRows({
    filters,
    limit: EXPORT_ROW_CAP,
    offset: 0,
  });
  return { items, total, truncated: total > EXPORT_ROW_CAP };
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  missing_available_at: '可用时间缺失',
  unallocated_warehouse: '未分仓',
  share_sum_mismatch: '占比偏离',
  unmapped_warehouse: '新仓库未映射',
  unmapped_station: '站点未映射销售区域',
  position_source_mismatch: '查询/全链数量不一致',
  position_share_gap: '影子在库 vs 占比拟物',
};

const IMPACT_LABEL: Record<string, string> = {
  timeline: '库存时间轴',
  horizon: '7/15/30 预警',
  planning: '分仓规划',
};

const STATUS_LABEL: Record<string, string> = {
  open: '待跟进',
  in_progress: '处理中',
  resolved: '已自动结案',
  dismissed: '已知悉',
};

const ERP_HINT: Record<string, string> = {
  missing_available_at: '迅捷维护跟单/备货 ETA、可售日',
  unallocated_warehouse: '迅捷维护分仓销售占比',
  share_sum_mismatch: '迅捷校正各仓占比使合计约 100%',
  unmapped_warehouse: '迅捷确认仓名；scm-agent 补 TURNOVER_BUCKET_WAREHOUSE_MAP',
  unmapped_station: '在区域映射（/data/region-mapping）把站点配到 US/CA/EU/UK/OTHER',
  position_source_mismatch: '迅捷核对库存查询与全链库存同仓同状态数量',
  position_share_gap: '迅捷核对分仓库存；占比拆分仅作对照不改数',
};

const FULFILLMENT_UNMAPPED_LABEL = '履约区域未映射';
const FULFILLMENT_UNMAPPED_HINT =
  '在区域映射（/data/region-mapping）为仓库配置履约区域 US/CA/EU/UK/OTHER';

export function isFulfillmentRegionUnmappedWarehouse(row: {
  issueType: string;
  fingerprint?: string | null;
}): boolean {
  return (
    row.issueType === 'unmapped_warehouse' &&
    (row.fingerprint ?? '').startsWith(UNMAPPED_WAREHOUSE_FP_PREFIX)
  );
}

export function inventoryDataIssueTypeLabel(row: {
  issueType: string;
  fingerprint?: string | null;
}): string {
  if (isFulfillmentRegionUnmappedWarehouse(row)) return FULFILLMENT_UNMAPPED_LABEL;
  return ISSUE_TYPE_LABEL[row.issueType] ?? row.issueType;
}

export function inventoryDataIssueActionHint(row: {
  issueType: string;
  fingerprint?: string | null;
}): string {
  if (isFulfillmentRegionUnmappedWarehouse(row)) return FULFILLMENT_UNMAPPED_HINT;
  return ERP_HINT[row.issueType] ?? '';
}

export function buildInventoryDataIssueExportCsv(
  rows: InventoryDataIssueListRow[],
): { headers: string[]; bodyRows: Array<Array<string | number>> } {
  const headers = [
    '问题类型',
    'SKU编码',
    'SKU名称',
    '仓库',
    '数量',
    '影响模块',
    '示例说明',
    '状态',
    '源系统建议动作',
    '最近检出时间',
    '首次检出时间',
  ];
  const bodyRows = rows.map((row) => [
    inventoryDataIssueTypeLabel(row),
    row.skuCode,
    row.skuName,
    row.warehouseCode,
    row.qty,
    IMPACT_LABEL[row.impactModule] ?? row.impactModule,
    row.example,
    STATUS_LABEL[row.status] ?? row.status,
    inventoryDataIssueActionHint(row),
    row.lastSeenAt instanceof Date ? row.lastSeenAt.toISOString() : String(row.lastSeenAt),
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  ]);
  return { headers, bodyRows };
}
