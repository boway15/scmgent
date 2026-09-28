/**
 * ERP 商业状态（停售/下架/清仓）归一化与写库。
 * 与 skus.lifecycle（销量推断）分离，供规划驾驶舱与补货灰灯使用。
 */
import { eq } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { buildGrayLifecycleSqlCondition, isGrayLifecycle } from './inventory-light.js';
import { isReplenishLightManualLocked } from './replenish-light-sync.js';

export type CommercialStatusNorm = 'active' | 'phase_out' | 'discontinued' | 'unknown';

export type CommercialStatusSource =
  | 'erp_turnover'
  | 'erp_query'
  | 'erp_procurement'
  | 'manual';

const DISCONTINUED_KEYWORDS = [
  '停售',
  '已停售',
  '下架',
  '已下架',
  '淘汰',
  '停产',
  'discontinu',
  'inactive',
  'obsolete',
  'delist',
] as const;

const PHASE_OUT_KEYWORDS = [
  '即将停售',
  '清仓',
  '衰退',
  '滞销',
  'eol',
  'phase out',
  'clearance',
] as const;

const ACTIVE_KEYWORDS = ['active', '在售', '正常', '启用', 'normal'] as const;

const SOURCE_RANK: Record<CommercialStatusSource, number> = {
  erp_turnover: 3,
  erp_query: 2,
  erp_procurement: 1,
  manual: 4,
};

const NORM_SEVERITY: Record<CommercialStatusNorm, number> = {
  unknown: 0,
  active: 1,
  phase_out: 2,
  discontinued: 3,
};

export function normalizeCommercialStatus(
  raw: string | null | undefined,
): CommercialStatusNorm | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return null;

  // phase_out 先于 discontinued，避免「即将停售」被「停售」子串误判
  if (PHASE_OUT_KEYWORDS.some((kw) => text.includes(kw))) return 'phase_out';
  if (DISCONTINUED_KEYWORDS.some((kw) => text.includes(kw))) return 'discontinued';
  if (ACTIVE_KEYWORDS.some((kw) => text.includes(kw))) return 'active';
  return 'unknown';
}

export function pickStricterCommercialStatusNorm(
  current: CommercialStatusNorm | null | undefined,
  next: CommercialStatusNorm | null,
): CommercialStatusNorm | null {
  if (!next) return current ?? null;
  if (!current) return next;
  return NORM_SEVERITY[next] >= NORM_SEVERITY[current] ? next : current;
}

export function shouldPreferCommercialStatusUpdate(params: {
  currentSource: CommercialStatusSource | null | undefined;
  nextSource: CommercialStatusSource;
  currentNorm: CommercialStatusNorm | null | undefined;
  nextNorm: CommercialStatusNorm | null;
}): boolean {
  if (params.nextSource === 'manual') return true;
  const currentRank = params.currentSource ? SOURCE_RANK[params.currentSource] : 0;
  const nextRank = SOURCE_RANK[params.nextSource];
  if (nextRank > currentRank) return true;
  if (nextRank < currentRank) return false;
  const merged = pickStricterCommercialStatusNorm(params.currentNorm, params.nextNorm);
  return merged !== (params.currentNorm ?? null);
}

/** 规划驾驶舱 / 补货：是否排除在可规划 SKU 之外（灰灯） */
export function isPlanningExcluded(params: {
  lifecycle?: string | null;
  commercialStatusNorm?: string | null;
  isActive?: boolean;
}): boolean {
  if (params.isActive === false) return true;

  const norm = params.commercialStatusNorm?.trim().toLowerCase();
  if (norm === 'discontinued' || norm === 'phase_out') return true;
  if (norm === 'active') return false;

  return isGrayLifecycle(params.lifecycle);
}

/** SQL：active_skus 行上判断是否应计入 gray_skus */
export function buildPlanningExcludedSqlCondition(params: {
  lifecycleColumnSql: string;
  commercialStatusNormColumnSql: string;
}): string {
  const grayLifecycle = buildGrayLifecycleSqlCondition(params.lifecycleColumnSql);
  const norm = `lower(${params.commercialStatusNormColumnSql})`;
  return `(
    ${norm} IN ('discontinued', 'phase_out')
    OR (
      (${params.commercialStatusNormColumnSql} IS NULL OR ${norm} = 'unknown')
      AND ${grayLifecycle}
    )
  )`;
}

function coerceCommercialStatusValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    const trimmed = String(value).trim();
    return trimmed || null;
  }
  return null;
}

/** 仅读 ERP「产品状态」列；周转表「生命周期」为销量推断，不得用于商业状态同步。 */
export function extractProductStatusRaw(row: Record<string, unknown>): string | null {
  const keys = ['产品状态', 'product_status', 'commercial_status'];
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    const trimmed = coerceCommercialStatusValue(value);
    if (!trimmed) continue;
    normalized.set(key.trim().toLowerCase().replace(/\s+/g, '_'), trimmed);
  }
  for (const alias of keys) {
    const hit = normalized.get(alias.toLowerCase().replace(/\s+/g, '_'));
    if (hit) return hit;
  }
  return null;
}

export function extractCommercialStatusRaw(
  row: Record<string, unknown>,
): string | null {
  const keys = ['生命周期', 'lifecycle', '产品状态', 'product_status', 'commercial_status'];
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    const trimmed = coerceCommercialStatusValue(value);
    if (!trimmed) continue;
    normalized.set(key.trim().toLowerCase().replace(/\s+/g, '_'), trimmed);
  }
  for (const alias of keys) {
    const hit = normalized.get(alias.toLowerCase().replace(/\s+/g, '_'));
    if (hit) return hit;
  }
  return null;
}

export async function applyCommercialStatus(input: {
  skuId: string;
  rawStatus: string | null | undefined;
  source: CommercialStatusSource;
  syncedAt?: Date;
  force?: boolean;
}): Promise<'updated' | 'skipped' | 'locked' | 'unchanged'> {
  const raw = input.rawStatus?.trim() ?? '';
  if (!raw) return 'skipped';

  const nextNorm = normalizeCommercialStatus(raw);
  if (!nextNorm) return 'skipped';

  const [existing] = await db
    .select({
      commercialStatus: skus.commercialStatus,
      commercialStatusNorm: skus.commercialStatusNorm,
      commercialStatusSource: skus.commercialStatusSource,
      commercialStatusLocked: skus.commercialStatusLocked,
      replenishLight: skus.replenishLight,
      encodingMeta: skus.encodingMeta,
    })
    .from(skus)
    .where(eq(skus.id, input.skuId))
    .limit(1);

  if (!existing) return 'skipped';
  if (existing.commercialStatusLocked && !input.force) return 'locked';

  const currentNorm = (existing.commercialStatusNorm as CommercialStatusNorm | null) ?? null;
  const currentSource = (existing.commercialStatusSource as CommercialStatusSource | null) ?? null;

  const mergedNorm = input.force
    ? nextNorm
    : (pickStricterCommercialStatusNorm(currentNorm, nextNorm) ?? nextNorm);

  if (
    !input.force &&
    mergedNorm === currentNorm &&
    nextNorm != null &&
    NORM_SEVERITY[nextNorm] < NORM_SEVERITY[mergedNorm]
  ) {
    return 'unchanged';
  }

  if (
    !input.force &&
    !shouldPreferCommercialStatusUpdate({
      currentSource,
      nextSource: input.source,
      currentNorm,
      nextNorm,
    }) &&
    existing.commercialStatus === raw &&
    currentNorm === nextNorm
  ) {
    return 'unchanged';
  }

  const patch: Record<string, unknown> = {
    commercialStatus: raw,
    commercialStatusNorm: mergedNorm,
    commercialStatusSource: input.source,
    commercialStatusAt: input.syncedAt ?? new Date(),
    updatedAt: new Date(),
  };

  if (
    (mergedNorm === 'discontinued' || mergedNorm === 'phase_out') &&
    !isReplenishLightManualLocked(existing.encodingMeta)
  ) {
    patch.replenishLight = 'green';
  }

  await db.update(skus).set(patch).where(eq(skus.id, input.skuId));
  return 'updated';
}

export async function applyCommercialStatusBatch(
  rows: Array<{
    skuId: string;
    rawStatus: string | null | undefined;
    source: CommercialStatusSource;
  }>,
  options?: { syncedAt?: Date },
): Promise<{ updated: number; skipped: number; locked: number; unchanged: number }> {
  let updated = 0;
  let skipped = 0;
  let locked = 0;
  let unchanged = 0;

  for (const row of rows) {
    const result = await applyCommercialStatus({
      skuId: row.skuId,
      rawStatus: row.rawStatus,
      source: row.source,
      syncedAt: options?.syncedAt,
    });
    if (result === 'updated') updated += 1;
    else if (result === 'locked') locked += 1;
    else if (result === 'unchanged') unchanged += 1;
    else skipped += 1;
  }

  return { updated, skipped, locked, unchanged };
}
