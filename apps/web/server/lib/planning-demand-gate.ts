/**
 * 需求门禁：WMAPE fail 或还原封顶的建议需人工确认，不进默认可采纳队列。
 */

import { isKpiMet, type HorizonBand } from './forecast-kpi-targets.js';
import type { ProfileSegment } from './forecast-profile-class.js';

export type DemandGateInput = {
  reconstructCapHit?: boolean;
  unconstrainedDaily?: number | null;
  stockoutDays?: number | null;
  /** 最近已结算月 WMAPE（0–1） */
  recentWmape?: number | null;
  segment?: ProfileSegment | null;
  band?: HorizonBand;
};

export type DemandGateResult = {
  needsManualConfirm: boolean;
  flags: string[];
  demandUnconstrainedDaily: number | null;
  demandStockoutDays: number | null;
  demandCapped: boolean;
};

export function evaluateDemandGate(input: DemandGateInput): DemandGateResult {
  const flags: string[] = [];
  const demandCapped = input.reconstructCapHit === true;
  if (demandCapped) flags.push('reconstruct_capped');

  const segment = input.segment ?? 'A:mid';
  const band = input.band ?? 'precision';
  if (input.recentWmape != null) {
    const status = isKpiMet(segment, band, input.recentWmape);
    if (status === 'fail') flags.push('wmape_fail');
    else if (status === 'warn') flags.push('wmape_warn');
  }

  const needsManualConfirm = flags.includes('reconstruct_capped') || flags.includes('wmape_fail');

  return {
    needsManualConfirm,
    flags,
    demandUnconstrainedDaily:
      input.unconstrainedDaily == null ? null : Number(input.unconstrainedDaily),
    demandStockoutDays: input.stockoutDays == null ? null : Number(input.stockoutDays),
    demandCapped,
  };
}

/** 默认可采纳：未打人工确认标记 */
export function isAutoAdoptableSuggestion(metrics: Record<string, unknown> | null | undefined): boolean {
  if (!metrics) return true;
  return metrics.needsManualConfirm !== true;
}
