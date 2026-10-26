/**
 * 建议量 = max(0, ceil(目标日累计需求 + 安全库存 − 目标日供给))；
 * 有 coverQty（>0）时先封顶到该量，再按 MOQ 抬升；缺口为 0 不因 MOQ 出单。
 */
export function decideReplenishmentQty(input: {
  cumulativeDemandAtTarget: number;
  safetyStockQty: number;
  supplyAtTarget: number;
  coverQty?: number;
  moq?: number;
}): number {
  let raw = Math.max(
    0,
    Math.ceil(input.cumulativeDemandAtTarget + input.safetyStockQty - input.supplyAtTarget),
  );
  if (raw <= 0) return 0;
  const cover = input.coverQty ?? 0;
  if (cover > 0) raw = Math.min(raw, Math.ceil(cover));
  const moq = input.moq ?? 0;
  return moq > 0 ? Math.max(raw, moq) : raw;
}
