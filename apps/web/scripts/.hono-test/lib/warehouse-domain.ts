/** 分仓补货：美国仓网互调、渠道偏好与尾程成本 */

export const US_WAREHOUSE_CODES = ['US-WEST', 'US-SOUTH', 'US-SOUTHEAST', 'US-EAST'] as const;

export function parseOverflowCodes(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * 单仓缺口但仓网整体充足时，建议互调而非补货。
 */
export function shouldDeferReplenishment(params: {
  warehouseEffective: number;
  warehouseRop: number;
  networkEffective: number;
  networkRop: number;
}): boolean {
  if (params.warehouseEffective >= params.warehouseRop) return true;
  if (params.networkRop <= 0) return false;
  return params.networkEffective >= params.networkRop;
}

/** 按分仓日均销量占比拆分总补货量 */
export function splitQtyByDailyShare(
  totalQty: number,
  dailyByWarehouse: Record<string, number>,
): Record<string, number> {
  const totalDaily = Object.values(dailyByWarehouse).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (totalQty <= 0) return out;

  if (totalDaily <= 0) {
    const keys = Object.keys(dailyByWarehouse);
    const each = Math.ceil(totalQty / Math.max(keys.length, 1));
    for (const k of keys) out[k] = each;
    return out;
  }

  let assigned = 0;
  const keys = Object.keys(dailyByWarehouse);
  for (let i = 0; i < keys.length; i++) {
    const code = keys[i];
    if (i === keys.length - 1) {
      out[code] = Math.max(0, totalQty - assigned);
    } else {
      const share = Math.ceil(totalQty * (dailyByWarehouse[code] / totalDaily));
      out[code] = share;
      assigned += share;
    }
  }
  return out;
}
