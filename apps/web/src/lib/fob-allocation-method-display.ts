export type FeeRuleForMethod = {
  feeType?: string | null;
  sourceBillType: string;
  matchPattern?: string | null;
  priority: number;
  allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
  isActive?: boolean;
};

type AllocationMethodRef = { allocationMethod?: string | null };

export function resolveFeeAllocationMethod(
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  feeRules: FeeRuleForMethod[],
  sourceBillItemId?: string,
  allocationsByBillItem?: Map<string, AllocationMethodRef[]>,
  billItemMethods?: Map<string, string>,
): string {
  if (sourceBillItemId && allocationsByBillItem) {
    const method = allocationsByBillItem.get(sourceBillItemId)?.[0]?.allocationMethod;
    if (method) return method;
  }
  if (sourceBillItemId && billItemMethods) {
    const method = billItemMethods.get(sourceBillItemId);
    if (method) return method;
  }

  const normalized = feeType.trim();
  const active = feeRules
    .filter((r) => r.sourceBillType === sourceBillType && r.isActive !== false)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of active) {
    if (rule.feeType && rule.feeType === normalized) return rule.allocationMethod;
    if (rule.matchPattern && normalized.includes(rule.matchPattern)) return rule.allocationMethod;
  }

  return 'by_volume';
}
