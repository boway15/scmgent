export const LEADING_FROZEN_COLUMN_IDS = ['品类', 'SKU'] as const;

export const TRAILING_OPS_COLUMN_IDS = ['replenishLight', 'ai'] as const;

export const TRAILING_META_COLUMN_IDS = [
  'updatedAt',
  'dataSource',
  'inventoryRecordedDate',
] as const;

const leadingSet = new Set<string>(LEADING_FROZEN_COLUMN_IDS);
const trailingAllSet = new Set<string>([
  ...TRAILING_OPS_COLUMN_IDS,
  ...TRAILING_META_COLUMN_IDS,
]);

export function orderOverviewColumnIds(ids: string[]): string[] {
  const leading = LEADING_FROZEN_COLUMN_IDS.filter((id) => ids.includes(id));
  const middle = ids.filter((id) => !leadingSet.has(id) && !trailingAllSet.has(id));
  const trailingOps = TRAILING_OPS_COLUMN_IDS.filter((id) => ids.includes(id));
  const trailingMeta = TRAILING_META_COLUMN_IDS.filter((id) => ids.includes(id));
  const ordered = [...leading, ...middle, ...trailingOps, ...trailingMeta];
  return ordered.length ? ordered : ['SKU'];
}
