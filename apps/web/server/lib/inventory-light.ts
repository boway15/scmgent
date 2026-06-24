/**
 * 库存健康五档亮灯（覆盖天数 + 生命周期）
 *
 * 蓝：库存超多 | 绿：库存健康 | 黄：有风险 | 红：必须补货 | 灰：滞销/即将停售
 */

export type InventoryHealth = 'red' | 'yellow' | 'green' | 'blue' | 'gray';

export const INVENTORY_HEALTH_LABEL: Record<InventoryHealth, string> = {
  red: '红灯',
  yellow: '黄灯',
  green: '绿灯',
  blue: '蓝灯',
  gray: '灰灯',
};

export const INVENTORY_HEALTH_MECHANISM: Record<InventoryHealth, string> = {
  blue: '库存超多，覆盖天数超过超备阈值',
  green: '库存健康，覆盖天数处于安全区间',
  yellow: '库存有风险，进入补货计划窗口',
  red: '库存很浅，覆盖低于总提前期，必须补货',
  gray: '滞销品或即将停售，暂停补货建议',
};

/** 兼容旧枚举值（迁移前 API/DB） */
const LEGACY_HEALTH_MAP: Record<string, InventoryHealth> = {
  healthy: 'green',
  overstock: 'blue',
};

export function normalizeInventoryHealth(
  raw: string | null | undefined,
): InventoryHealth | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in INVENTORY_HEALTH_LABEL) return key as InventoryHealth;
  return LEGACY_HEALTH_MAP[key] ?? null;
}

const GRAY_LIFECYCLE_KEYWORDS = [
  '停售',
  '即将停售',
  '停产',
  '下架',
  '淘汰',
  '滞销',
  '衰退',
  '清仓',
  'eol',
  'discontinu',
];

export const SLOW_MOVING_MAX_DAILY = 0.1;
export const SLOW_MOVING_MIN_COVERAGE_DAYS = 90;

export function isGrayLifecycle(lifecycle: string | null | undefined): boolean {
  const text = lifecycle?.trim().toLowerCase();
  if (!text) return false;
  return GRAY_LIFECYCLE_KEYWORDS.some((kw) => text.includes(kw));
}

export function isSlowMovingStock(params: {
  effectiveQty: number;
  avgDaily: number;
  coverageDays: number;
}): boolean {
  if (params.effectiveQty <= 0) return false;
  if (params.avgDaily > SLOW_MOVING_MAX_DAILY) return false;
  return (
    Number.isFinite(params.coverageDays) &&
    params.coverageDays >= SLOW_MOVING_MIN_COVERAGE_DAYS
  );
}

export function calcInventoryHealth(params: {
  coverageDays: number;
  totalLeadDays: number;
  safetyStockDays: number;
  overstockThresholdDays: number;
  lifecycle?: string | null;
  effectiveQty?: number;
  avgDaily?: number;
}): InventoryHealth {
  const avgDaily = params.avgDaily ?? 0;
  const effectiveQty = params.effectiveQty ?? 0;

  if (isGrayLifecycle(params.lifecycle)) return 'gray';
  if (
    isSlowMovingStock({
      effectiveQty,
      avgDaily,
      coverageDays: params.coverageDays,
    })
  ) {
    return 'gray';
  }

  if (!Number.isFinite(params.coverageDays)) {
    return params.coverageDays > 0 ? 'blue' : 'red';
  }
  if (params.coverageDays > params.overstockThresholdDays) return 'blue';
  if (params.coverageDays < params.totalLeadDays) return 'red';
  if (params.coverageDays < params.totalLeadDays + params.safetyStockDays) return 'yellow';
  return 'green';
}

/** 库存总览轻量估算（无完整预测时，基于 ROP + 生命周期） */
export function estimateInventoryHealthQuick(params: {
  effectiveQty: number;
  reorderPoint?: number | null;
  lifecycle?: string | null;
  overstockMultiplier?: number;
}): InventoryHealth {
  if (isGrayLifecycle(params.lifecycle)) return 'gray';

  const rop = params.reorderPoint ?? 0;
  const mult = params.overstockMultiplier ?? 2.5;
  const qty = params.effectiveQty;

  if (rop <= 0) {
    return qty > 0 ? 'green' : 'red';
  }
  if (qty > rop * mult) return 'blue';
  if (qty <= 0) return 'red';
  if (qty < rop) return 'red';
  if (qty < rop * 1.2) return 'yellow';
  return 'green';
}

export function needsReplenishmentByHealth(health: InventoryHealth): boolean {
  return health === 'red' || health === 'yellow';
}
