/** 与 packages/db/src/fob-fee-display-priority.ts 保持同步（前端勿引 @scm/db） */
export const TRUCKING_PRIORITY_BASE = 10_000;
export const FREIGHT_PRIORITY_BASE = 5_000;
export const LEGACY_TRUCKING_PRIORITY_BASE = 9_000;
export const LEGACY_FREIGHT_PRIORITY_BASE = 4_000;

export type FeeRulePriorityRow = {
  feeType: string | null;
  sourceBillType: string;
  matchPattern: string | null;
  priority: number;
};

export function defaultCatalogPriority(
  sourceBillType: 'trucking' | 'freight',
  catalogIndex: number,
): number {
  const base = sourceBillType === 'trucking' ? TRUCKING_PRIORITY_BASE : FREIGHT_PRIORITY_BASE;
  return base - catalogIndex;
}

export function buildFeePriorityMap(rules: FeeRulePriorityRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const rule of rules) {
    if (!rule.feeType || rule.matchPattern) continue;
    map.set(`${rule.sourceBillType}|${rule.feeType}`, rule.priority);
  }
  return map;
}

export function getFeeDisplayPriority(
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  priorityMap: Map<string, number>,
): number {
  return priorityMap.get(`${sourceBillType}|${feeType}`) ?? 0;
}

export function sortFeeChecksByDisplayPriority<
  T extends { feeType: string; sourceBillType: 'trucking' | 'freight' },
>(checks: T[], priorityMap: Map<string, number>): T[] {
  return [...checks].sort((a, b) => {
    const pa = getFeeDisplayPriority(a.feeType, a.sourceBillType, priorityMap);
    const pb = getFeeDisplayPriority(b.feeType, b.sourceBillType, priorityMap);
    if (pb !== pa) return pb - pa;
    const billOrder =
      (a.sourceBillType === 'trucking' ? 0 : 1) - (b.sourceBillType === 'trucking' ? 0 : 1);
    if (billOrder !== 0) return billOrder;
    return a.feeType.localeCompare(b.feeType, 'zh-CN');
  });
}
