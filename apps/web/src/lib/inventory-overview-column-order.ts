/** 冻结在表格最左侧的列（按显示顺序） */
export const LEADING_FROZEN_COLUMN_IDS = ['品类', 'SKU'] as const;

/** 排在表格末尾的运营列 */
export const TRAILING_OPS_COLUMN_IDS = ['replenishLight', 'ai'] as const;

/** 排在表格最末尾的元数据列 */
export const TRAILING_META_COLUMN_IDS = [
  'updatedAt',
  'dataSource',
  'inventoryRecordedDate',
] as const;

const leadingSet = new Set<string>(LEADING_FROZEN_COLUMN_IDS);
const trailingOpsSet = new Set<string>(TRAILING_OPS_COLUMN_IDS);
const trailingMetaSet = new Set<string>(TRAILING_META_COLUMN_IDS);
const trailingAllSet = new Set<string>([
  ...TRAILING_OPS_COLUMN_IDS,
  ...TRAILING_META_COLUMN_IDS,
]);

/** 品类/SKU 置首，更新信息/运营列置尾，中间列保持原相对顺序 */
export function orderOverviewColumnIds(ids: string[]): string[] {
  const leading = LEADING_FROZEN_COLUMN_IDS.filter((id) => ids.includes(id));
  const middle = ids.filter((id) => !leadingSet.has(id) && !trailingAllSet.has(id));
  const trailingOps = TRAILING_OPS_COLUMN_IDS.filter((id) => ids.includes(id));
  const trailingMeta = TRAILING_META_COLUMN_IDS.filter((id) => ids.includes(id));
  const ordered = [...leading, ...middle, ...trailingOps, ...trailingMeta];
  return ordered.length ? ordered : ['SKU'];
}
