/** Local replenishment algorithms (MVP — replaces Dify Workflow) */
const Z_SCORE_95 = 1.65;
const DEFAULT_HOLDING_COST_RATE = 0.2;
const DEFAULT_ORDER_COST = 50;
export function calcDailyStats(sales, days = 90) {
    if (!sales.length) {
        return { avgDaily: 0, stdDev: 0, totalSold: 0 };
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const filtered = sales.filter((s) => new Date(s.saleDate) >= cutoff);
    const totalSold = filtered.reduce((sum, s) => sum + s.qtySold, 0);
    const avgDaily = totalSold / days;
    if (filtered.length < 2) {
        return { avgDaily, stdDev: avgDaily * 0.3, totalSold };
    }
    const dailyMap = new Map();
    for (const s of filtered) {
        dailyMap.set(s.saleDate, (dailyMap.get(s.saleDate) ?? 0) + s.qtySold);
    }
    const dailyValues = Array.from(dailyMap.values());
    const mean = dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length;
    const variance = dailyValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / dailyValues.length;
    const stdDev = Math.sqrt(variance);
    return { avgDaily, stdDev, totalSold };
}
export function calcSafetyStock(stdDev, leadTimeDays, serviceLevel = 0.95) {
    const z = serviceLevel >= 0.95 ? Z_SCORE_95 : 1.28;
    return Math.ceil(z * stdDev * Math.sqrt(leadTimeDays));
}
export function calcReorderPoint(avgDaily, leadTimeDays, safetyStock) {
    return Math.ceil(avgDaily * leadTimeDays + safetyStock);
}
export function calcEoq(annualDemand, orderCost = DEFAULT_ORDER_COST, unitCost = 1, holdingRate = DEFAULT_HOLDING_COST_RATE) {
    const holdingCost = unitCost * holdingRate;
    if (holdingCost <= 0 || annualDemand <= 0)
        return 0;
    return Math.ceil(Math.sqrt((2 * annualDemand * orderCost) / holdingCost));
}
/** SKU 级 MOQ 优先，否则继承 SPU（主商品）级 MOQ */
export function resolveEffectiveMoq(skuMoq, spuMoq) {
    if (skuMoq != null && skuMoq > 0)
        return skuMoq;
    if (spuMoq != null && spuMoq > 0)
        return spuMoq;
    return 0;
}
/** 将算法建议量抬升至 MOQ（未设置 MOQ 时不改变） */
export function applyMoq(suggestedQty, moq) {
    if (moq <= 0)
        return suggestedQty;
    return Math.max(suggestedQty, moq);
}
export function calcReplenishment(params) {
    const { avgDaily, stdDev, totalSold } = calcDailyStats(params.sales, params.days ?? 90);
    const leadTime = params.leadTimeDays || 30;
    const serviceLevel = params.serviceLevel ?? 0.95;
    const safetyStockQty = calcSafetyStock(stdDev, leadTime, serviceLevel);
    const reorderPoint = calcReorderPoint(avgDaily, leadTime, safetyStockQty);
    const annualDemand = (totalSold / (params.days ?? 90)) * 365;
    const reorderQty = calcEoq(annualDemand, DEFAULT_ORDER_COST, params.unitCost ?? 1);
    return {
        safetyStockQty,
        reorderPoint,
        reorderQty: reorderQty || Math.ceil(avgDaily * leadTime),
        avgDaily,
        stdDev,
    };
}
const ALERT_TYPE_LABEL = {
    stockout: '缺货',
    below_safety: '低于安全库存',
    below_rop: '低于 ROP',
};
const ALERT_ACTION = {
    stockout: '立即补货 / 确认 PMC 计划',
    below_safety: '检查补货建议并采纳',
    below_rop: '运行补货预测或采纳建议',
};
export function formatAlertSummary(alerts) {
    if (!alerts.length)
        return '当前无待处理预警。';
    const lines = [`共 ${alerts.length} 条预警：`];
    for (const a of alerts) {
        const label = ALERT_TYPE_LABEL[a.type] ?? a.type;
        const action = ALERT_ACTION[a.type] ?? '查看补货建议';
        lines.push(`• [${label}] ${a.skuCode}：有效供给 ${a.currentQty}，阈值 ${a.threshold} → 建议：${action}`);
    }
    return lines.join('\n');
}
export function formatAlertSummaryFromRows(alerts) {
    return formatAlertSummary(alerts.map((a) => ({
        skuCode: a.skuCode,
        type: a.alertType,
        currentQty: a.currentQty,
        threshold: a.safetyQty,
    })));
}
