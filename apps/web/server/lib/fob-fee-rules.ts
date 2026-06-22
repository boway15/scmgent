export type AllocationMethod = 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
export type CostStage = 'trucking' | 'freight' | 'customs' | 'other';
export type ExceptionStatus = 'pending' | 'confirmed' | 'rejected';
export type ExceptionReason = 'unconfigured' | 'remark' | 'amount' | 'fee_name';

export type FeeRuleRow = {
  feeType?: string | null;
  sourceBillType: string;
  matchPattern?: string | null;
  allocationMethod: AllocationMethod;
  defaultStage: CostStage;
  priority: number;
};

export type RuleMatchResult = {
  allocationMethod: AllocationMethod;
  stage: CostStage;
  isException: boolean;
  exceptionStatus?: ExceptionStatus;
  exceptionReason?: ExceptionReason;
  ruleConfigured: boolean;
};

const EXCEPTION_REMARK_PATTERN = /异常|减免|多收|调整|应付款/i;

export function findMatchingFeeRule(
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  rules: FeeRuleRow[],
): FeeRuleRow | undefined {
  const normalizedFee = feeType.trim();
  const active = rules
    .filter((r) => r.sourceBillType === sourceBillType)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of active) {
    if (rule.feeType && rule.feeType === normalizedFee) return rule;
    if (rule.matchPattern && normalizedFee.includes(rule.matchPattern)) return rule;
  }
  return undefined;
}

export function matchAllocationRule(
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  rules: FeeRuleRow[],
  remark?: string | null,
  amountCny?: number,
): RuleMatchResult {
  const normalizedFee = feeType.trim();
  const matched = findMatchingFeeRule(normalizedFee, sourceBillType, rules);
  const ruleConfigured = !!matched;

  const method = matched?.allocationMethod ?? inferDefaultMethod(normalizedFee);
  const stage = matched?.defaultStage ?? inferStage(normalizedFee);

  const remarkException = remark ? EXCEPTION_REMARK_PATTERN.test(remark) : false;
  const amountException = amountCny != null && amountCny <= 0;
  const nameException = /异常/.test(normalizedFee);

  let exceptionReason: ExceptionReason | undefined;
  if (!ruleConfigured) exceptionReason = 'unconfigured';
  else if (nameException) exceptionReason = 'fee_name';
  else if (amountException) exceptionReason = 'amount';
  else if (remarkException) exceptionReason = 'remark';

  const isException = !!exceptionReason;

  return {
    allocationMethod: method,
    stage,
    isException,
    exceptionStatus: isException ? 'pending' : undefined,
    exceptionReason,
    ruleConfigured,
  };
}

function inferStage(feeType: string): CostStage {
  if (/报关|关税|增值税|查验|清关/.test(feeType)) return 'customs';
  if (/拖车|提柜|装货/.test(feeType)) return 'trucking';
  if (/海运费|港杂|THC|码头|文件|VGM|订舱/.test(feeType)) return 'freight';
  if (/延误|超期|超时|压夜|等待/.test(feeType)) return 'other';
  return 'other';
}

/** 无规则命中时的兜底分摊方式（新费用项可在 fob_fee_allocation_rules 表配置覆盖） */
function inferDefaultMethod(feeType: string): AllocationMethod {
  if (/延误|异常|减免|多收/.test(feeType)) return 'manual';
  return 'by_volume';
}

export function effectiveBillAmount(amountCny: number, adjustedAmountCny?: number | null) {
  return adjustedAmountCny != null ? adjustedAmountCny : amountCny;
}

export const EXCEPTION_REASON_LABEL: Record<ExceptionReason, string> = {
  unconfigured: '未配置费用项',
  remark: '备注含异常关键词',
  amount: '金额异常',
  fee_name: '费用名含异常',
};

