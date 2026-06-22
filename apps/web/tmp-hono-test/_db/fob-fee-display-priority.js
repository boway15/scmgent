export const TRUCKING_PRIORITY_BASE = 10_000;
export const FREIGHT_PRIORITY_BASE = 5_000;
export const LEGACY_TRUCKING_PRIORITY_BASE = 9_000;
export const LEGACY_FREIGHT_PRIORITY_BASE = 4_000;
export function defaultCatalogPriority(sourceBillType, catalogIndex) {
    const base = sourceBillType === 'trucking' ? TRUCKING_PRIORITY_BASE : FREIGHT_PRIORITY_BASE;
    return base - catalogIndex;
}
export function buildFeePriorityMap(rules) {
    const map = new Map();
    for (const rule of rules) {
        if (!rule.feeType || rule.matchPattern)
            continue;
        map.set(`${rule.sourceBillType}|${rule.feeType}`, rule.priority);
    }
    return map;
}
export function getFeeDisplayPriority(feeType, sourceBillType, priorityMap) {
    return priorityMap.get(`${sourceBillType}|${feeType}`) ?? 0;
}
/** 列展示顺序：规则 priority 越大越靠左；同优先级拖车先于货代 */
export function sortFeeChecksByDisplayPriority(checks, priorityMap) {
    return [...checks].sort((a, b) => {
        const pa = getFeeDisplayPriority(a.feeType, a.sourceBillType, priorityMap);
        const pb = getFeeDisplayPriority(b.feeType, b.sourceBillType, priorityMap);
        if (pb !== pa)
            return pb - pa;
        const billOrder = (a.sourceBillType === 'trucking' ? 0 : 1) - (b.sourceBillType === 'trucking' ? 0 : 1);
        if (billOrder !== 0)
            return billOrder;
        return a.feeType.localeCompare(b.feeType, 'zh-CN');
    });
}
