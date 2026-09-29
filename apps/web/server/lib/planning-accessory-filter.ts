import { sql, type SQL } from 'drizzle-orm';
import { skus } from '@scm/db';
import { isAccessorySku } from './sku-encoding.js';

export type ProductScope = 'goods' | 'accessory';

/** 与 isAccessorySku 兜底规则对齐：skuKind 或变化段 / 编码含配件 P */
export function excludeAccessorySkuSql(): SQL {
  return sql`(
    coalesce(${skus.skuKind}::text, '') <> 'accessory'
    AND ${skus.code} !~* '_[^_]*P'
    AND ${skus.code} !~* '^[A-Z]+[0-9]+P[0-9]+'
    AND ${skus.code} !~* '^[0-9]{7,9}P[0-9]+'
  )`;
}

export function parseProductScope(value: string | null | undefined): ProductScope {
  return value === 'accessory' ? 'accessory' : 'goods';
}

export function matchesProductScope(
  scope: ProductScope,
  sku: { code?: string | null; skuKind?: string | null },
): boolean {
  const accessory = isAccessorySku(sku);
  return scope === 'accessory' ? accessory : !accessory;
}

export function productScopeSql(scope: ProductScope = 'goods'): SQL {
  const goods = excludeAccessorySkuSql();
  return scope === 'accessory' ? sql`NOT ${goods}` : goods;
}

/** 原始 SQL 中 skus 表别名为 `s` 时使用 */
export function productScopeOnSkuAlias(scope: ProductScope, alias: 's'): SQL {
  const goods = sql`(
    coalesce(${sql.raw(`${alias}.sku_kind`)}::text, '') <> 'accessory'
    AND ${sql.raw(`${alias}.code`)} !~* '_[^_]*P'
    AND ${sql.raw(`${alias}.code`)} !~* '^[A-Z]+[0-9]+P[0-9]+'
    AND ${sql.raw(`${alias}.code`)} !~* '^[0-9]{7,9}P[0-9]+'
  )`;
  const clause = scope === 'accessory' ? sql`NOT ${goods}` : goods;
  return sql`AND ${clause}`;
}
