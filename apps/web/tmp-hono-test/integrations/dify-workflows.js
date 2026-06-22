import { isAlertWorkflowEnabled, isReplenishmentWorkflowEnabled, runWorkflow, } from './dify.js';
function suggestionKey(skuCode, warehouseCode) {
    return `${skuCode}::${warehouseCode}`;
}
/** Parse Dify replenishment workflow `enhanced_json` output. */
export function parseEnhancedReplenishmentJson(raw) {
    if (!raw)
        return [];
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(parsed))
        return [];
    const rows = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object')
            continue;
        const row = item;
        const skuCode = String(row.skuCode ?? row.sku_code ?? '').trim();
        const warehouseCode = String(row.warehouseCode ?? row.warehouse_code ?? '').trim();
        const reason = String(row.reason ?? '').trim();
        if (!skuCode || !warehouseCode || !reason)
            continue;
        rows.push({
            skuCode,
            warehouseCode,
            reason,
            summary: row.summary != null ? String(row.summary) : undefined,
            risk_notes: row.risk_notes != null ? String(row.risk_notes) : undefined,
        });
    }
    return rows;
}
/** Merge LLM-enhanced reason with optional summary / risk notes. */
export function mergeEnhancedReason(row, fallbackReason) {
    const parts = [row.reason || fallbackReason];
    if (row.summary?.trim())
        parts.push(`摘要：${row.summary.trim()}`);
    if (row.risk_notes?.trim())
        parts.push(`风险提示：${row.risk_notes.trim()}`);
    return parts.join('\n');
}
/** Parse Dify alert workflow output into a single Feishu message body. */
export function parseAlertWorkflowMessage(outputs) {
    const direct = outputs.feishu_message ?? outputs.summary ?? outputs.message ?? outputs.text;
    if (typeof direct === 'string' && direct.trim())
        return direct.trim();
    return null;
}
/**
 * Call Dify replenishment workflow to enhance reason text.
 * Returns a map keyed by skuCode::warehouseCode; empty map on skip/failure.
 */
export async function enhanceReplenishmentReasons(suggestions) {
    const result = new Map();
    if (!isReplenishmentWorkflowEnabled() || !suggestions.length)
        return result;
    const outputs = await runWorkflow('DIFY_API_KEY_REPLENISHMENT', {
        suggestions_json: JSON.stringify(suggestions.slice(0, 50)),
        days: 90,
    });
    const enhanced = parseEnhancedReplenishmentJson(outputs.enhanced_json);
    for (const row of enhanced) {
        const original = suggestions.find((s) => s.skuCode === row.skuCode && s.warehouseCode === row.warehouseCode);
        result.set(suggestionKey(row.skuCode, row.warehouseCode), mergeEnhancedReason(row, original?.reason ?? ''));
    }
    return result;
}
/**
 * Call Dify alert workflow for Feishu message body.
 * Returns null when workflow disabled or output empty.
 */
export async function generateAlertFeishuMessage(alerts, alertCount) {
    if (!isAlertWorkflowEnabled() || !alerts.length)
        return null;
    const outputs = await runWorkflow('DIFY_API_KEY_ALERT', {
        alert_rows_json: JSON.stringify(alerts.slice(0, 100)),
        alert_count: alertCount,
    });
    return parseAlertWorkflowMessage(outputs);
}
