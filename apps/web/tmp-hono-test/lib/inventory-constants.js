/** 在产库存逻辑仓：不指向物理仓，货物发出后才写入目的仓的在途 */
export const IN_PRODUCTION_WAREHOUSE = 'IN-PRODUCTION';
export function isPhysicalWarehouse(code) {
    return code !== IN_PRODUCTION_WAREHOUSE;
}
