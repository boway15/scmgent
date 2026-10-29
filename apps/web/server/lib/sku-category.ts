import { and, desc, eq, inArray, isNotNull, ilike, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db, skus, warehouses, salesForecastVersions, salesHistory, salesHistoryMonthly } from '@scm/db';

/** 统一品类路径分隔符（销量历史常用 `\`，主数据常用 `/`）。 */
export function normalizeCategoryPath(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/');
}

/**
 * 项目组 = 品类路径中间段。
 * `事业部\项目组\品类` 取第二段，例如
 * `DJ02-家具事业1部\Amazon项目1组-第一曲线-US\卧室-床` → `Amazon项目1组-第一曲线-US`。
 * 多于三段时，去掉首段和末段后的中间全部保留。不足三段返回 null。
 */
export function extractProjectGroupFromCategory(
  category: string | null | undefined,
): string | null {
  const normalized = normalizeCategoryPath(category);
  if (!normalized) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 3) return null;
  return segments.slice(1, -1).join('\\') || null;
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
  historyCategory: SQLWrapper,
  skuCategory: SQLWrapper,
  filter?: string | null,
) {
  const normalized = normalizeCategoryPath(filter);
  if (!normalized) return undefined;

  const pattern = `%${escapeLikePattern(normalized)}%`;
  const effective = sql`replace(coalesce(${historyCategory}, ${skuCategory}), '\\', '/')`;

  return sql`${effective} is not null and trim(${effective}) <> '' and ${effective} ilike ${pattern}`;
}

/** 多选优先；列表为空时回退到单个筛选值。 */
export function uniqueTrimmedFilters(
  many?: Array<string | null | undefined> | null,
  single?: string | null,
): string[] {
  const fromList = [
    ...new Set(
      (many ?? [])
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (fromList.length) return fromList;
  const trimmed = single?.trim();
  return trimmed ? [trimmed] : [];
}

export function resolveProjectGroupFilters(input: {
  projectGroup?: string | null;
  projectGroups?: Array<string | null | undefined> | null;
}): string[] {
  return uniqueTrimmedFilters(input.projectGroups, input.projectGroup);
}

export function resolveCategoryFilters(input: {
  category?: string | null;
  categories?: Array<string | null | undefined> | null;
}): string[] {
  return uniqueTrimmedFilters(input.categories, input.category);
}

/** 多个品类取并集，单条仍走原有包含匹配。 */
export function categoriesMatchFilterCondition(
  historyCategory: SQLWrapper,
  skuCategory: SQLWrapper,
  filters?: Array<string | null | undefined> | null,
) {
  const parts: SQL[] = [];
  for (const filter of uniqueTrimmedFilters(filters)) {
    const part = categoryMatchesFilterCondition(historyCategory, skuCategory, filter);
    if (part) parts.push(part);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return sql`(${sql.join(parts, sql` or `)})`;
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

export function skuMatchesProjectGroupFilter(
  skuProjectGroup: string | null | undefined,
  filter?: string | null,
): boolean {
  const normalizedFilter = filter?.trim();
  if (!normalizedFilter) return true;
  const projectGroup = skuProjectGroup?.trim();
  if (!projectGroup) return false;
  return projectGroup === normalizedFilter || projectGroup.includes(normalizedFilter);
}

/** 未选项目组时不过滤；多选时命中任意一个即可。 */
export function skuMatchesAnyProjectGroupFilter(
  skuProjectGroup: string | null | undefined,
  filters?: Array<string | null | undefined> | null,
): boolean {
  const normalized = uniqueTrimmedFilters(filters);
  if (!normalized.length) return true;
  return normalized.some((filter) => skuMatchesProjectGroupFilter(skuProjectGroup, filter));
}

/** 项目组搜索：来自 SKU 主数据 project_group 字段。 */
export async function searchSkuProjectGroups(query?: string, limit = 50): Promise<string[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const pattern = categorySearchPattern(query);

  const match = pattern
    ? and(
        eq(skus.isActive, true),
        isNotNull(skus.projectGroup),
        sql`trim(${skus.projectGroup}) <> ''`,
        ilike(skus.projectGroup, pattern),
      )
    : and(
        eq(skus.isActive, true),
        isNotNull(skus.projectGroup),
        sql`trim(${skus.projectGroup}) <> ''`,
      );

  const rows = await db
    .selectDistinct({ projectGroup: skus.projectGroup })
    .from(skus)
    .where(match)
    .limit(safeLimit * 2);

  return mergeDistinctCategories(
    rows.map((row) => row.projectGroup),
    safeLimit,
  );
}

async function countActiveSkusMatchingProjectGroup(filters: string[]): Promise<number> {
  const rows = await db
    .select({ projectGroup: skus.projectGroup })
    .from(skus)
    .where(eq(skus.isActive, true));
  if (!filters.length) return rows.length;
  return rows.filter((row) => skuMatchesAnyProjectGroupFilter(row.projectGroup, filters)).length;
}

export async function countActiveSkusForForecast(input: {
  projectGroup?: string;
  projectGroups?: string[];
  skuCode?: string;
}): Promise<number> {
  const filters = resolveProjectGroupFilters(input);
  const skuCode = input.skuCode?.trim();
  if (skuCode) {
    const [row] = await db
      .select({ id: skus.id, projectGroup: skus.projectGroup })
      .from(skus)
      .where(and(eq(skus.isActive, true), ilike(skus.code, skuCode)))
      .limit(1);
    if (!row) return 0;
    if (!filters.length) return 1;
    return skuMatchesAnyProjectGroupFilter(row.projectGroup, filters) ? 1 : 0;
  }
  return countActiveSkusMatchingProjectGroup(filters);
}
