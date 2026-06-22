/** SKU 补货亮灯：红=必补，黄=同 SPU 有红灯 SKU 需补时才补，绿=不补 */
export const REPLENISH_LIGHT_LABEL = {
    red: '红灯（必补）',
    yellow: '黄灯（联动）',
    green: '绿灯（不补）',
};
const LIGHT_ALIASES = {
    red: 'red',
    红: 'red',
    红灯: 'red',
    must: 'red',
    yellow: 'yellow',
    黄: 'yellow',
    黄灯: 'yellow',
    follow: 'yellow',
    green: 'green',
    绿: 'green',
    绿灯: 'green',
    skip: 'green',
    none: 'green',
};
export function parseReplenishLight(raw) {
    const key = raw?.trim().toLowerCase();
    if (!key)
        return null;
    return LIGHT_ALIASES[key] ?? null;
}
export function normalizeReplenishLight(raw) {
    return parseReplenishLight(raw) ?? 'red';
}
export function needsReplenishmentByInventory(effectiveQty, reorderPoint) {
    const rop = reorderPoint ?? 0;
    return rop > 0 && effectiveQty < rop;
}
export function shouldReplenishByLight(params) {
    if (!params.needsReplenishment)
        return false;
    if (params.replenishLight === 'green')
        return false;
    if (params.replenishLight === 'red')
        return true;
    return params.spuHasRedNeedingReplenishment;
}
export function buildSpuRedNeedingSet(rows) {
    const spuIds = new Set();
    for (const row of rows) {
        if (row.spuId && row.replenishLight === 'red' && row.needsReplenishment) {
            spuIds.add(row.spuId);
        }
    }
    return spuIds;
}
export function applyReplenishLightToRows(rows) {
    const spuRedNeeding = buildSpuRedNeedingSet(rows);
    return rows.map((row) => ({
        ...row,
        replenishEligible: shouldReplenishByLight({
            replenishLight: row.replenishLight,
            needsReplenishment: row.needsReplenishment,
            spuHasRedNeedingReplenishment: row.spuId ? spuRedNeeding.has(row.spuId) : false,
        }),
    }));
}
