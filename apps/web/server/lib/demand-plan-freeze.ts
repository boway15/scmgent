/**
 * 需求计划提前期内冻结：地平线前半段（默认按 totalLeadDays 折算月数）不可改；后半段可改。
 */

export function freezeHorizonMonths(totalLeadDays: number, horizonMonths = 12): number {
  const leadMonths = Math.max(1, Math.ceil(totalLeadDays / 30));
  return Math.min(horizonMonths, leadMonths);
}

/** period `YYYY-MM` 是否落在冻结窗（含 startMonth 起的前 freezeMonths 个月）。 */
export function isDemandPeriodFrozen(params: {
  period: string;
  startMonth: string;
  freezeMonths: number;
}): boolean {
  const periodIdx = monthIndex(params.period);
  const startIdx = monthIndex(params.startMonth);
  if (periodIdx == null || startIdx == null) return false;
  const offset = periodIdx - startIdx;
  return offset >= 0 && offset < params.freezeMonths;
}

export function monthIndex(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/**
 * 分层预测上层总量只作约束：reconcile 比例缩放到父级目标，不单独驱动采购。
 */
export function reconcileSkuQtyToParentTotal(params: {
  skuDraftQty: number[];
  parentTotal: number;
}): number[] {
  const sum = params.skuDraftQty.reduce((a, b) => a + b, 0);
  if (sum <= 0 || params.parentTotal <= 0) {
    return params.skuDraftQty.map(() => 0);
  }
  const scale = params.parentTotal / sum;
  const scaled = params.skuDraftQty.map((q) => Math.round(q * scale));
  const drift = params.parentTotal - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length > 0 && drift !== 0) {
    const i = scaled.reduce(
      (best, q, idx) => (q >= scaled[best]! ? idx : best),
      0,
    );
    scaled[i] = (scaled[i] ?? 0) + drift;
  }
  return scaled;
}
