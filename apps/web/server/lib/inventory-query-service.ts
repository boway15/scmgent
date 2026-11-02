import {
  getPublishedQuerySnapshotDate,
  listInventoryQuerySnapshotDates,
  loadInventoryQuerySnapshots,
} from './inventory-query-snapshot.js';
import { defaultVisibleInventoryQueryColumns } from './inventory-query-feishu-mapper.js';
import {
  INVENTORY_QUERY_DEFAULT_VISIBLE_HEADERS,
  INVENTORY_QUERY_HEADERS,
} from './inventory-query-headers.js';
import { inArray, or } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { matchesProductScope, type ProductScope } from './planning-accessory-filter.js';
import { skuInProjectGroupScope, type ProjectGroupScope } from './data-scope.js';

export type InventoryQueryListItem = {
  skuId: string | null;
  skuCode: string;
  payload: Record<string, string>;
};

export type InventoryQueryListFilters = {
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
};

function payloadIncludes(
  payload: Record<string, string>,
  key: string,
  expected?: string,
): boolean {
  if (!expected) return true;
  const value = payload[key] ?? '';
  return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
}

export function filterInventoryQueryItems(
  items: InventoryQueryListItem[],
  filters: InventoryQueryListFilters,
): InventoryQueryListItem[] {
  return items.filter((item) => {
    const q = filters.q?.trim();
    if (q) {
      const hay = `${item.skuCode}\n${item.payload.SKU名称 ?? ''}\n${item.payload.SKU ?? ''}`;
      if (!hay.toLocaleLowerCase().includes(q.toLocaleLowerCase())) return false;
    }
    const scope = filters.productScope ?? 'goods';
    if (!matchesProductScope(scope, { code: item.skuCode })) return false;
    return (
      payloadIncludes(item.payload, '品类', filters.category) &&
      payloadIncludes(item.payload, '销售国家', filters.salesCountry) &&
      payloadIncludes(item.payload, '生命周期', filters.lifecycle)
    );
  });
}

async function filterItemsByProjectGroupScope(
  items: InventoryQueryListItem[],
  scope?: ProjectGroupScope,
): Promise<InventoryQueryListItem[]> {
  if (!scope || scope.mode === 'all') return items;
  const skuIds = [...new Set(items.map((item) => item.skuId).filter((id): id is string => !!id))];
  const skuCodes = [...new Set(items.map((item) => item.skuCode).filter(Boolean))];
  if (!skuIds.length && !skuCodes.length) return [];

  const rowWhere = or(
    ...(skuIds.length ? [inArray(skus.id, skuIds)] : []),
    ...(skuCodes.length ? [inArray(skus.code, skuCodes)] : []),
  );
  if (!rowWhere) return [];

  const pgById = new Map<string, string | null>();
  const pgByCode = new Map<string, string | null>();
  for (const row of await db
    .select({ id: skus.id, code: skus.code, projectGroup: skus.projectGroup })
    .from(skus)
    .where(rowWhere)) {
    pgById.set(row.id, row.projectGroup);
    pgByCode.set(row.code, row.projectGroup);
  }

  return items.filter((item) => {
    const pg =
      (item.skuId ? pgById.get(item.skuId) : undefined) ??
      pgByCode.get(item.skuCode) ??
      null;
    return skuInProjectGroupScope(pg, scope);
  });
}

function resolveColumns(
  stored: string[],
  items: InventoryQueryListItem[],
): string[] {
  if (stored.length) return stored;
  const fromItems = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.payload)) fromItems.add(key);
  }
  if (fromItems.size) return Array.from(fromItems);
  return [...INVENTORY_QUERY_HEADERS];
}

export async function listInventoryQueryRows(input: {
  page: number;
  pageSize: number;
  offset: number;
  snapshotDate?: string;
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
  projectGroupScope?: ProjectGroupScope;
}) {
  const meta = await getPublishedQuerySnapshotDate(input.snapshotDate);
  if (!meta.selectedSnapshotDate) {
    return {
      items: [] as InventoryQueryListItem[],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      selectedSnapshotDate: null as string | null,
      latestSnapshotDate: meta.latestSnapshotDate,
      isLatestSnapshot: false,
      isStale: false,
      syncedAt: null as string | null,
      columns: [...INVENTORY_QUERY_HEADERS],
      defaultVisibleColumns: [...INVENTORY_QUERY_DEFAULT_VISIBLE_HEADERS],
    };
  }

  const loaded = await loadInventoryQuerySnapshots({
    snapshotDate: meta.selectedSnapshotDate,
  });
  const filtered = await filterItemsByProjectGroupScope(
    filterInventoryQueryItems(
      loaded.map((row) => ({
        skuId: row.skuId,
        skuCode: row.skuCode,
        payload: row.payload,
      })),
      {
        q: input.q,
        category: input.category,
        salesCountry: input.salesCountry,
        lifecycle: input.lifecycle,
        productScope: input.productScope,
      },
    ),
    input.projectGroupScope,
  );

  const total = filtered.length;
  const items = filtered.slice(input.offset, input.offset + input.pageSize);
  const columns = resolveColumns(meta.columns, filtered);
  const defaultVisibleColumns = defaultVisibleInventoryQueryColumns(columns);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    selectedSnapshotDate: meta.selectedSnapshotDate,
    latestSnapshotDate: meta.latestSnapshotDate,
    isLatestSnapshot: meta.isLatestSnapshot,
    isStale: meta.isStale,
    syncedAt: meta.syncedAt,
    columns,
    defaultVisibleColumns,
  };
}

export async function buildInventoryQueryExportRows(input: {
  snapshotDate?: string;
  q?: string;
  category?: string;
  salesCountry?: string;
  lifecycle?: string;
  productScope?: ProductScope;
  projectGroupScope?: ProjectGroupScope;
  columns?: string[];
}) {
  const result = await listInventoryQueryRows({
    page: 1,
    pageSize: 100_000,
    offset: 0,
    ...input,
  });
  const columnIds = input.columns?.length ? input.columns : result.columns;
  const headers = columnIds;
  const rows = result.items.map((item) =>
    columnIds.map((col) => item.payload[col] ?? (col === 'SKU' ? item.skuCode : '')),
  );
  return {
    headers,
    rows,
    selectedSnapshotDate: result.selectedSnapshotDate,
    syncedAt: result.syncedAt,
  };
}

export { listInventoryQuerySnapshotDates };
