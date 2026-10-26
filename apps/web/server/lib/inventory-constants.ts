/** 在产库存逻辑仓：不指向物理仓，货物发出后才写入目的仓的在途 */
export const IN_PRODUCTION_WAREHOUSE = 'IN-PRODUCTION';

/** 未定仓在途 / 网络合计逻辑仓（非某物理目的仓） */
export const UNALLOCATED_TRANSIT_WAREHOUSE = 'OVERSEAS';

/** 三池对人展示名。代码池名 local / in_transit / overseas 不变。 */
export const POOL_DISPLAY_LABEL = {
  local: '未发',
  in_transit: '在途',
  overseas: '在库',
} as const;

export function isPhysicalWarehouse(code: string): boolean {
  return code !== IN_PRODUCTION_WAREHOUSE;
}

/** 出货前供应落点：local → 在产池；在途 → 未定仓网络池 */
export function preShipmentWarehouse(pool: 'local' | 'in_transit'): string {
  return pool === 'local' ? IN_PRODUCTION_WAREHOUSE : UNALLOCATED_TRANSIT_WAREHOUSE;
}
