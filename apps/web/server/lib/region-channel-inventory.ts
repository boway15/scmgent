/** 履约区域库存按渠道分摊（计划分摊，不落渠道台账） */

export const CHANNEL_SHARE_HISTORY_DAYS = 90;

function sumPositive(values: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(values)) {
    if (value > 0) total += value;
  }
  return total;
}

function toWeights(qtyByPlatform: Record<string, number>): Record<string, number> {
  const total = sumPositive(qtyByPlatform);
  const weights: Record<string, number> = {};
  if (total <= 0) return weights;
  for (const [platform, qty] of Object.entries(qtyByPlatform)) {
    if (qty > 0) weights[platform] = qty / total;
  }
  return weights;
}

/**
 * 占比：发布预测渠道优先，否则历史销量；两者皆空则 empty（补货侧应跳过）。
 */
export function resolveChannelWeights(params: {
  forecastQtyByPlatform: Record<string, number>;
  historyQtyByPlatform: Record<string, number>;
}): { source: 'forecast' | 'history' | 'empty'; weights: Record<string, number> } {
  if (sumPositive(params.forecastQtyByPlatform) > 0) {
    return { source: 'forecast', weights: toWeights(params.forecastQtyByPlatform) };
  }
  if (sumPositive(params.historyQtyByPlatform) > 0) {
    return { source: 'history', weights: toWeights(params.historyQtyByPlatform) };
  }
  return { source: 'empty', weights: {} };
}

/**
 * 区域库存按渠道权重分摊为整数；向下取整后用最大余数法补齐，保证件数守恒。
 */
export function allocateRegionInventoryByChannel(params: {
  regionQty: number;
  channelWeights: Record<string, number>;
}): Record<string, number> {
  const qty = Math.max(0, Math.floor(params.regionQty));
  const entries = Object.entries(params.channelWeights).filter(([, w]) => w > 0);
  const out: Record<string, number> = {};
  if (qty <= 0 || entries.length === 0) return out;

  const weightSum = entries.reduce((sum, [, w]) => sum + w, 0);
  if (weightSum <= 0) return out;

  const floors: Array<{ platform: string; floor: number; frac: number }> = [];
  let assigned = 0;
  for (const [platform, weight] of entries) {
    const exact = (qty * weight) / weightSum;
    const floor = Math.floor(exact);
    floors.push({ platform, floor, frac: exact - floor });
    out[platform] = floor;
    assigned += floor;
  }

  let remain = qty - assigned;
  floors.sort((a, b) => b.frac - a.frac || a.platform.localeCompare(b.platform));
  for (let i = 0; i < floors.length && remain > 0; i++) {
    out[floors[i]!.platform] += 1;
    remain -= 1;
  }
  return out;
}
