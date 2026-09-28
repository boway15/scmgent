import { sql, type SQL } from 'drizzle-orm';
import { skus } from '@scm/db';

/** 与 isAccessorySku 兜底规则对齐：skuKind 或变化段 / 编码含配件 P */
export function excludeAccessorySkuSql(): SQL {
  return sql`(
    coalesce(${skus.skuKind}::text, '') <> 'accessory'
    AND ${skus.code} !~* '_[^_]*P'
    AND ${skus.code} !~* '^[A-Z]+[0-9]+P[0-9]+'
    AND ${skus.code} !~* '^[0-9]{9}P[0-9]+'
  )`;
}
