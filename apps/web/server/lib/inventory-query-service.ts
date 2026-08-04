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
    return (
      payloadIncludes(item.payload, '品类', filters.category) &&
      payloadIncludes(item.payload, '销售国家', filters.salesCountry) &&
      payloadIncludes(item.payload, '生命周期', filters.lifecycle)
    );
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
  const filtered = filterInventoryQueryItems(
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
    },
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
