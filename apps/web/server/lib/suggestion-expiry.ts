/** 本轮算过、但不再生成建议的 SKU。这些 SKU 的 pending 建议应作废。 */
export function pendingSkuIdsToExpire(input: {
  processedSkuIds: string[];
  keptSkuIds: string[];
}): string[] {
  const kept = new Set(input.keptSkuIds);
  const expired: string[] = [];
  const seen = new Set<string>();
  for (const skuId of input.processedSkuIds) {
    if (!skuId || seen.has(skuId) || kept.has(skuId)) continue;
    seen.add(skuId);
    expired.push(skuId);
  }
  return expired;
}
