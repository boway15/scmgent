import { subtractDaysIso } from './inventory-iso-date.js';

/**
 * 供应商确认交期：写入预计可售日，并推导 shipReadyAt，供下次三池同步把跟单从无期计划升到有日期管道。
 */
export function buildEtaPatch(
  etaAvailable: string,
  opts?: { remainingLogisticsDays?: number | null },
) {
  const remaining = opts?.remainingLogisticsDays;
  const patch: {
    etaAvailable: string;
    confirmedDeliveryDate: string;
    shipReadyAt?: string;
  } = {
    etaAvailable,
    confirmedDeliveryDate: etaAvailable,
  };
  if (remaining != null && Number.isFinite(remaining) && remaining >= 0) {
    patch.shipReadyAt = subtractDaysIso(etaAvailable, Math.floor(remaining));
  }
  return patch;
}
