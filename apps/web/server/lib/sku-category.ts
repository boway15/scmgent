import { and, desc, eq, inArray, isNotNull, ilike, sql } from 'drizzle-orm';
import { db, skus, warehouses, salesForecastVersions, salesHistory, salesHistoryMonthly } from '@scm/db';

/** 统一品类路径分隔符（销量历史常用 `\`，主数据常用 `/`）。 */
export function normalizeCategoryPath(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/');
}

/** Match SKU category against a filter (exact or parent path prefix). */
export function skuMatchesCategoryFilter(
  skuCategory: string | null | undefined,
  filter?: string | null,
): boolean {
  const normalizedFilter = normalizeCategoryPath(filter);
  if (!normalizedFilter) return true;

  const category = normalizeCategoryPath(skuCategory);
  if (!category) return false;

  return (
    category === normalizedFilter ||
    category.startsWith(`${normalizedFilter}/`) ||
    category.includes(normalizedFilter) ||
    (!normalizedFilter.includes('/') &&
      category.split('/').some((segment) => segment.includes(normalizedFilter)))
  );
}

export function resolveEffectiveSkuCategory(
  masterCategory: string | null | undefined,
  salesCategory: string | null | undefined,
): string | null {
  const sales = salesCategory?.trim();
  if (sales) return normalizeCategoryPath(sales);
  const master = masterCategory?.trim();
  return master ? normalizeCategoryPath(master) : null;
}

export function resolveSkuCategoryFromMaster(
  categoryBySkuId: Map<string, string | null | undefined>,
  skuId: string,
): string | null {
  const category = categoryBySkuId.get(skuId)?.trim();
  return category || null;
}

export async function loadSkuCategoryMap(skuIds: string[]): Promise<Map<string, string | null>> {
  if (skuIds.length === 0) return new Map();

  const rows = await db
    .select({ id: skus.id, category: skus.category })
    .from(skus)
    .where(inArray(skus.id, skuIds));

  return new Map(rows.map((row) => [row.id, row.category?.trim() || null]));
}

/** 销量历史品类快照（优先日表最近一条，其次月表）。 */
export async function loadLatestSalesHistoryCategoryBySkuIds(
  skuIds: string[],
): Promise<Map<string, string>> {
  if (skuIds.length === 0) return new Map();

  const [dailyRows, monthlyRows] = await Promise.all([
    db
      .select({
        skuId: salesHistory.skuId,
        category: salesHistory.category,
        saleDate: salesHistory.saleDate,
      })
      .from(salesHistory)
      .where(and(inArray(salesHistory.skuId, skuIds), isNotNull(salesHistory.category)))
      .orderBy(salesHistory.skuId, desc(salesHistory.saleDate)),
    db
      .select({
        skuId: salesHistoryMonthly.skuId,
        category: salesHistoryMonthly.category,
        saleYear: salesHistoryMonthly.saleYear,
        month: salesHistoryMonthly.month,
      })
      .from(salesHistoryMonthly)
      .where(and(inArray(salesHistoryMonthly.skuId, skuIds), isNotNull(salesHistoryMonthly.category)))
      .orderBy(
        salesHistoryMonthly.skuId,
        desc(salesHistoryMonthly.saleYear),
        desc(salesHistoryMonthly.month),
      ),
  ]);

  const map = new Map<string, string>();
  for (const row of dailyRows) {
    if (map.has(row.skuId)) continue;
    const category = row.category?.trim();
    if (category) map.set(row.skuId, category);
  }
  for (const row of monthlyRows) {
    if (map.has(row.skuId)) continue;
    const category = row.category?.trim();
    if (category) map.set(row.skuId, category);
  }
  return map;
}

export async function listSalesStations(): Promise<string[]> {
  const [warehouseRows, versionRows] = await Promise.all([
    db
      .selectDistinct({ station: warehouses.regionGroup })
      .from(warehouses)
      .where(eq(warehouses.isActive, true)),
    db.selectDistinct({ station: salesForecastVersions.station }).from(salesForecastVersions),
  ]);

  const stations = new Set<string>(['US']);
  for (const row of warehouseRows) {
    if (row.station?.trim()) stations.add(row.station.trim().toUpperCase());
  }
  for (const row of versionRows) {
    if (row.station?.trim()) stations.add(row.station.trim().toUpperCase());
  }
  return Array.from(stations).sort();
}

export async function listSkuCategories(): Promise<string[]> {
  return searchSkuCategories(undefined, 500);
}

function escapeLikePattern(value: string): string {
  return normalizeCategoryPath(value).replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/** 与销量历史列表 coalesce 口径一致，支持关键词包含与路径前缀（`\`/`/` 等价）。 */
export function categoryMatchesFilterCondition(
  historyCategory: typeof salesHistory.category,
  skuCategory: typeof skus.category,
  filter?: string | null,
) {
  const normalized = normalizeCategoryPath(filter);
  if (!normalized) return undefined;

  const pattern = `%${escapeLikePattern(normalized)}%`;
  const effective = sql`replace(coalesce(${historyCategory}, ${skuCategory}), '\\', '/')`;

  return sql`${effective} is not null and trim(${effective}) <> '' and ${effective} ilike ${pattern}`;
}

function categorySearchPattern(query?: string): string | null {
  const normalized = query?.trim();
  if (!normalized) return null;
  return `%${escapeLikePattern(normalized)}%`;
}

function mergeDistinctCategories(values: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const category = value?.trim();
    if (!category) continue;
    seen.add(category);
  }
  return Array.from(seen)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .slice(0, limit);
}

/** 品类搜索：与列表 coalesce(销量快照, SKU 主数据) 一致，支持 `\`/`/` 与关键词包含。 */
export async function searchSkuCategories(query?: string, limit = 50): Promise<string[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const pattern = categorySearchPattern(query);
  const fetchLimit = safeLimit * 4;

  const dailyMatch = pattern
    ? sql`
        coalesce(${salesHistory.category}, ${skus.category}) is not null
        and trim(coalesce(${salesHistory.category}, ${skus.category})) <> ''
        and replace(coalesce(${salesHistory.category}, ${skus.category}), '\\', '/') ilike ${pattern}
      `
    : sql`
        coalesce(${salesHistory.category}, ${skus.category}) is not null
        and trim(coalesce(${salesHistory.category}, ${skus.category})) <> ''
      `;

  const monthlyMatch = pattern
    ? sql`
        coalesce(${salesHistoryMonthly.category}, ${skus.category}) is not null
        and trim(coalesce(${salesHistoryMonthly.category}, ${skus.category})) <> ''
        and replace(coalesce(${salesHistoryMonthly.category}, ${skus.category}), '\\', '/') ilike ${pattern}
      `
    : sql`
        coalesce(${salesHistoryMonthly.category}, ${skus.category}) is not null
        and trim(coalesce(${salesHistoryMonthly.category}, ${skus.category})) <> ''
      `;

  const skuMatch = pattern
    ? and(
        eq(skus.isActive, true),
        isNotNull(skus.category),
        sql`trim(${skus.category}) <> ''`,
        sql`replace(${skus.category}, '\\', '/') ilike ${pattern}`,
      )
    : and(eq(skus.isActive, true), isNotNull(skus.category), sql`trim(${skus.category}) <> ''`);

  const [dailyRows, monthlyRows, skuRows] = await Promise.all([
    db
      .selectDistinct({
        category: sql<string>`trim(coalesce(${salesHistory.category}, ${skus.category}))`,
      })
      .from(salesHistory)
      .innerJoin(skus, eq(skus.id, salesHistory.skuId))
      .where(dailyMatch)
      .limit(fetchLimit),
    db
      .selectDistinct({
        category: sql<string>`trim(coalesce(${salesHistoryMonthly.category}, ${skus.category}))`,
      })
      .from(salesHistoryMonthly)
      .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId))
      .where(monthlyMatch)
      .limit(fetchLimit),
    db
      .selectDistinct({ category: skus.category })
      .from(skus)
      .where(skuMatch)
      .limit(fetchLimit),
  ]);

  return mergeDistinctCategories(
    [...dailyRows, ...monthlyRows, ...skuRows].map((row) => row.category),
    safeLimit,
  );
}

async function countActiveSkusMatchingCategory(filter?: string): Promise<number> {
  const rows = await db
    .select({ id: skus.id, category: skus.category })
    .from(skus)
    .where(eq(skus.isActive, true));
  const normalizedFilter = filter?.trim();
  if (!normalizedFilter) return rows.length;

  const salesCategoryBySku = await loadLatestSalesHistoryCategoryBySkuIds(rows.map((row) => row.id));
  return rows.filter((row) =>
    skuMatchesCategoryFilter(
      resolveEffectiveSkuCategory(row.category, salesCategoryBySku.get(row.id)),
      normalizedFilter,
    ),
  ).length;
}

export async function countActiveSkusByCategory(category?: string): Promise<number> {
  return countActiveSkusMatchingCategory(category);
}

export async function countActiveSkusForForecast(input: {
  category?: string;
  skuCode?: string;
}): Promise<number> {
  const skuCode = input.skuCode?.trim();
  if (skuCode) {
    const [row] = await db
      .select({ id: skus.id, category: skus.category })
      .from(skus)
      .where(and(eq(skus.isActive, true), ilike(skus.code, skuCode)))
      .limit(1);
    if (!row) return 0;
    const category = input.category?.trim();
    if (!category) return 1;
    const salesCategoryBySku = await loadLatestSalesHistoryCategoryBySkuIds([row.id]);
    return skuMatchesCategoryFilter(
      resolveEffectiveSkuCategory(row.category, salesCategoryBySku.get(row.id)),
      category,
    )
      ? 1
      : 0;
  }
  return countActiveSkusMatchingCategory(input.category);
}
