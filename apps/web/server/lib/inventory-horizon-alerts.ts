export type HorizonAlertType =
  | 'stockout_horizon'
  | 'coverage_short'
  | 'overstock'
  | 'uncoverable_by_new_po';

export type HorizonAlertCandidate = {
  alertType: HorizonAlertType;
  horizonDays: number | null;
  projectedQty: number;
  projectedStockoutDate: string | null;
  thresholdQty: number;
};

const STOCKOUT_HORIZONS = [7, 15, 30] as const;

/**
 * 从时间轴锚点与覆盖天数派生 horizon 预警候选（纯函数，不含去重落库）。
 */
export function deriveHorizonAlerts(params: {
  points: Array<{ horizonDays: number; projectedBalance: number }>;
  coverageDays: number;
  totalLeadDays: number;
  overstockThresholdDays: number;
  stockoutDate: string | null;
  uncoverableByNewPo?: boolean;
}): HorizonAlertCandidate[] {
  const out: HorizonAlertCandidate[] = [];
  const byHorizon = new Map(params.points.map((p) => [p.horizonDays, p]));

  for (const h of STOCKOUT_HORIZONS) {
    const point = byHorizon.get(h);
    if (!point) continue;
    if (point.projectedBalance <= 0) {
      out.push({
        alertType: 'stockout_horizon',
        horizonDays: h,
        projectedQty: point.projectedBalance,
        projectedStockoutDate: params.stockoutDate,
        thresholdQty: 0,
      });
    }
  }

  if (
    Number.isFinite(params.coverageDays) &&
    params.coverageDays < params.totalLeadDays
  ) {
    out.push({
      alertType: 'coverage_short',
      horizonDays: null,
      projectedQty: Math.round(params.coverageDays),
      projectedStockoutDate: params.stockoutDate,
      thresholdQty: params.totalLeadDays,
    });
  }

  if (
    Number.isFinite(params.coverageDays) &&
    params.coverageDays > params.overstockThresholdDays
  ) {
    out.push({
      alertType: 'overstock',
      horizonDays: null,
      projectedQty: Math.round(params.coverageDays),
      projectedStockoutDate: null,
      thresholdQty: params.overstockThresholdDays,
      });
  }

  if (params.uncoverableByNewPo) {
    out.push({
      alertType: 'uncoverable_by_new_po',
      horizonDays: null,
      projectedQty: 0,
      projectedStockoutDate: params.stockoutDate,
      thresholdQty: params.totalLeadDays,
    });
  }

  return out;
}
