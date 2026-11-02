import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import { db, skus, userDataScopes } from '@scm/db';
import type { AuthUser } from './auth-context.js';
import { getCurrentUserOptional } from './auth-context.js';
import { resolveProjectGroupFilters } from './sku-category.js';

export const PROJECT_GROUP_DIMENSION = 'project_group';

export type ProjectGroupScope =
  | { mode: 'all' }
  | { mode: 'restricted'; groups: string[] };

const scopeCache = new Map<string, { scope: ProjectGroupScope; at: number }>();
const CACHE_TTL_MS = 60_000;

export function clearDataScopeCache(userId?: string) {
  if (userId) scopeCache.delete(userId);
  else scopeCache.clear();
}

function uniqueTrimmed(values: Array<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** 空配置 / super_admin → all；否则返回配置的项目组列表。 */
export async function getUserProjectGroupScope(
  user: AuthUser | null | undefined,
): Promise<ProjectGroupScope> {
  if (!user) return { mode: 'all' };
  if (user.role.code === 'super_admin') return { mode: 'all' };

  const cached = scopeCache.get(user.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.scope;
  }

  const rows = await db
    .select({ value: userDataScopes.value })
    .from(userDataScopes)
    .where(
      and(
        eq(userDataScopes.userId, user.id),
        eq(userDataScopes.dimension, PROJECT_GROUP_DIMENSION),
      ),
    );

  const groups = uniqueTrimmed(rows.map((r) => r.value));
  const scope: ProjectGroupScope =
    groups.length === 0 ? { mode: 'all' } : { mode: 'restricted', groups };

  scopeCache.set(user.id, { scope, at: Date.now() });
  return scope;
}

export async function resolveRequestProjectGroupScope(c: Context): Promise<ProjectGroupScope> {
  const user = (c.get('user') as AuthUser | undefined) ?? (await getCurrentUserOptional(c));
  return getUserProjectGroupScope(user);
}

/**
 * 将页面请求的项目组筛选与用户数据范围取交集。
 * - all：原样返回 requested（空 = 不按项目组过滤）
 * - restricted + 无 requested：返回用户全部可见组
 * - restricted + requested：交集；空交集返回 []（调用方应产出空结果）
 */
export function applyProjectGroupFilter(
  requested: Array<string | null | undefined> | string | null | undefined,
  scope: ProjectGroupScope,
): string[] {
  const requestedList = Array.isArray(requested)
    ? resolveProjectGroupFilters({ projectGroups: requested })
    : resolveProjectGroupFilters({ projectGroup: requested });

  if (scope.mode === 'all') return requestedList;

  const allowed = new Set(scope.groups);
  if (requestedList.length === 0) return [...scope.groups];
  return requestedList.filter((g) => allowed.has(g));
}

/** restricted 且交集为空时，SQL 恒 false，避免 `IN ()`。 */
export function skuProjectGroupCondition(scope: ProjectGroupScope): SQL | undefined {
  if (scope.mode === 'all') return undefined;
  if (scope.groups.length === 0) return sql`false`;
  return inArray(skus.projectGroup, scope.groups);
}

/**
 * 在已有请求筛选上叠加数据范围，生成最终项目组列表与 SQL 条件。
 * `empty` 表示应返回空结果（受限且无可见组）。
 */
export function resolveScopedProjectGroups(input: {
  scope: ProjectGroupScope;
  projectGroup?: string | null;
  projectGroups?: Array<string | null | undefined> | null;
}): { groups: string[]; empty: boolean; condition: SQL | undefined } {
  const groups = applyProjectGroupFilter(
    input.projectGroups?.length
      ? input.projectGroups
      : input.projectGroup,
    input.scope,
  );

  if (input.scope.mode === 'restricted' && groups.length === 0) {
    return { groups: [], empty: true, condition: sql`false` };
  }

  if (groups.length === 0) {
    return { groups: [], empty: false, condition: undefined };
  }

  // 受限用户：即使请求未带筛选，也强制 IN 可见组
  if (input.scope.mode === 'restricted') {
    return { groups, empty: false, condition: inArray(skus.projectGroup, groups) };
  }

  // 未受限：仅当页面显式筛选时才加条件
  return { groups, empty: false, condition: inArray(skus.projectGroup, groups) };
}

/** 内存过滤：SKU 项目组是否在范围内。all 恒 true；无项目组对受限用户为 false。 */
export function skuInProjectGroupScope(
  skuProjectGroup: string | null | undefined,
  scope: ProjectGroupScope,
): boolean {
  if (scope.mode === 'all') return true;
  const value = skuProjectGroup?.trim();
  if (!value) return false;
  return scope.groups.includes(value);
}

/** 过滤项目组候选下拉，受限用户只能看到自己范围内的。 */
export function filterProjectGroupOptions(
  options: string[],
  scope: ProjectGroupScope,
): string[] {
  if (scope.mode === 'all') return options;
  const allowed = new Set(scope.groups);
  return options.filter((g) => allowed.has(g));
}

export async function listUserProjectGroupScopes(userId: string): Promise<string[]> {
  const rows = await db
    .select({ value: userDataScopes.value })
    .from(userDataScopes)
    .where(
      and(
        eq(userDataScopes.userId, userId),
        eq(userDataScopes.dimension, PROJECT_GROUP_DIMENSION),
      ),
    );
  return uniqueTrimmed(rows.map((r) => r.value)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 全量替换项目组范围；空数组表示全部（删除所有行）。 */
export async function replaceUserProjectGroupScopes(
  userId: string,
  projectGroups: string[],
): Promise<string[]> {
  const next = uniqueTrimmed(projectGroups);

  await db
    .delete(userDataScopes)
    .where(
      and(
        eq(userDataScopes.userId, userId),
        eq(userDataScopes.dimension, PROJECT_GROUP_DIMENSION),
      ),
    );

  if (next.length > 0) {
    await db.insert(userDataScopes).values(
      next.map((value) => ({
        userId,
        dimension: PROJECT_GROUP_DIMENSION,
        value,
      })),
    );
  }

  clearDataScopeCache(userId);
  return next.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
