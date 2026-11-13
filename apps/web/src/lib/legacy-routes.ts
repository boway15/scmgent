/** 已下线或合并的前端路径 → 重定向目标 */
export const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
  '/data/layered-forecast': '/data/forecast',
  '/data/sap-mirror': '/data/products',
  '/compliance': '/help',
  '/compliance/overview': '/help',
  '/compliance/skus': '/help',
  '/data/region-mapping': '/system/region-mapping',
};
