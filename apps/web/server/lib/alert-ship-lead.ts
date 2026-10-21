import { and, eq, isNull } from 'drizzle-orm';
import { db, leadTimeProfiles, warehouses } from '@scm/db';
import { resolveShippingLeadDays } from './replenishment-coverage.js';

const CACHE_MS = 60_000;

let cache: { at: number; map: Map<string, number | null> } | null = null;

export function clearWarehouseShippingLeadCache(): void {
  cache = null;
}

/** 仓库配置的海运天数优先；没有配置时用内置默认表。 */
export function shippingLeadFor(
  code: string,
  configured: Map<string, number | null> | null | undefined,
): number {
  return resolveShippingLeadDays(code, configured?.get(code));
}

/** 同一 SKU 多个预警仓时取最长海运交期，避免只用最紧急那一行的仓。 */
export function shippingLeadAcrossWarehouses(
  codes: Array<string | null | undefined>,
  configured: Map<string, number | null> | null | undefined,
): number {
  const present = codes.filter((code): code is string => Boolean(code));
  if (!present.length) return shippingLeadFor('', configured);
  return Math.max(...present.map((code) => shippingLeadFor(code, configured)));
}

/** 仓库列有正值时用仓库列，否则用默认 Profile 的订舱 + 海运 + 清关。 */
export function mergeShippingLeadDays(input: {
  warehouseDays: number | null;
  profileDays: number | null;
}): number | null {
  if (input.warehouseDays != null && input.warehouseDays > 0) return input.warehouseDays;
  if (input.profileDays != null && input.profileDays > 0) return input.profileDays;
  return null;
}

export async function loadWarehouseShippingLeadMap(): Promise<Map<string, number | null>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;

  const [warehouseRows, profileRows] = await Promise.all([
    db
      .select({
        code: warehouses.code,
        shippingLeadDays: warehouses.shippingLeadDays,
      })
      .from(warehouses),
    db
      .select({
        destinationWarehouseCode: leadTimeProfiles.destinationWarehouseCode,
        bookingDays: leadTimeProfiles.bookingDays,
        transitDays: leadTimeProfiles.transitDays,
        customsDays: leadTimeProfiles.customsDays,
      })
      .from(leadTimeProfiles)
      .where(and(eq(leadTimeProfiles.isDefault, true), isNull(leadTimeProfiles.merchantCode))),
  ]);

  const profileByWarehouse = new Map<string, number>();
  for (const row of profileRows) {
    const days = (row.bookingDays ?? 0) + (row.transitDays ?? 0) + (row.customsDays ?? 0);
    if (days <= 0) continue;
    const prev = profileByWarehouse.get(row.destinationWarehouseCode) ?? 0;
    profileByWarehouse.set(row.destinationWarehouseCode, Math.max(prev, days));
  }

  const codes = new Set<string>([
    ...warehouseRows.map((row) => row.code),
    ...profileByWarehouse.keys(),
  ]);
  const map = new Map<string, number | null>();
  for (const code of codes) {
    const warehouse = warehouseRows.find((row) => row.code === code);
    map.set(
      code,
      mergeShippingLeadDays({
        warehouseDays: warehouse?.shippingLeadDays ?? null,
        profileDays: profileByWarehouse.get(code) ?? null,
      }),
    );
  }

  cache = { at: Date.now(), map };
  return map;
}
