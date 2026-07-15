/** 走步回归集 SKU（含 DJ502530_2），用于 Phase 2+ 算法门禁抽检 */
export const FORECAST_REGRESSION_SKUS = [
  'DJ502530_2',
  'DJ502530_1',
  'DJ502531_1',
  'DJ502532_1',
  'DJ502533_1',
  'DJ502534_1',
  'DJ502535_1',
  'DJ502536_1',
  'DJ502537_1',
  'DJ502538_1',
  'DJ502539_1',
  'DJ502540_1',
  'DJ502541_1',
  'DJ502542_1',
  'DJ502543_1',
  'DJ502544_1',
  'DJ502545_1',
  'DJ502546_1',
  'DJ502547_1',
  'DJ502548_1',
] as const;

export function isRegressionSku(skuCode: string): boolean {
  return (FORECAST_REGRESSION_SKUS as readonly string[]).includes(skuCode.trim());
}
