import {
  isAlertWorkflowEnabled,
  isReplenishmentWorkflowEnabled,
  isSalesForecastWorkflowEnabled,
  runWorkflow,
} from './dify.js';

export type ReplenishmentSuggestionInput = {
  skuCode: string;
  warehouseCode: string;
  suggestedQty: number;
  reason: string;
};

export type EnhancedReplenishmentRow = {
  skuCode: string;
  warehouseCode: string;
  reason: string;
  summary?: string;
  risk_notes?: string;
};

export type AlertRowInput = {
  skuCode: string;
  type: string;
  currentQty: number;
  threshold: number;
};

function suggestionKey(skuCode: string, warehouseCode: string) {
  return `${skuCode}::${warehouseCode}`;
}

/** Parse Dify replenishment workflow `enhanced_json` output. */
export function parseEnhancedReplenishmentJson(raw: unknown): EnhancedReplenishmentRow[] {
  if (!raw) return [];

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const rows: EnhancedReplenishmentRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const skuCode = String(row.skuCode ?? row.sku_code ?? '').trim();
    const warehouseCode = String(row.warehouseCode ?? row.warehouse_code ?? '').trim();
    const reason = String(row.reason ?? '').trim();
    if (!skuCode || !warehouseCode || !reason) continue;
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
export function mergeEnhancedReason(row: EnhancedReplenishmentRow, fallbackReason: string): string {
  const parts = [row.reason || fallbackReason];
  if (row.summary?.trim()) parts.push(`摘要：${row.summary.trim()}`);
  if (row.risk_notes?.trim()) parts.push(`风险提示：${row.risk_notes.trim()}`);
  return parts.join('\n');
}

/** Parse Dify alert workflow output into a single Feishu message body. */
export function parseAlertWorkflowMessage(outputs: Record<string, unknown>): string | null {
  const direct =
    outputs.feishu_message ?? outputs.summary ?? outputs.message ?? outputs.text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return null;
}

/**
 * Call Dify replenishment workflow to enhance reason text.
 * Returns a map keyed by skuCode::warehouseCode; empty map on skip/failure.
 */
export async function enhanceReplenishmentReasons(
  suggestions: ReplenishmentSuggestionInput[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!isReplenishmentWorkflowEnabled() || !suggestions.length) return result;

  const outputs = await runWorkflow('DIFY_API_KEY_REPLENISHMENT', {
    suggestions_json: JSON.stringify(suggestions.slice(0, 50)),
    days: 90,
  });

  const enhanced = parseEnhancedReplenishmentJson(outputs.enhanced_json);
  for (const row of enhanced) {
    const original = suggestions.find(
      (s) => s.skuCode === row.skuCode && s.warehouseCode === row.warehouseCode,
    );
    result.set(
      suggestionKey(row.skuCode, row.warehouseCode),
      mergeEnhancedReason(row, original?.reason ?? ''),
    );
  }
  return result;
}

/**
 * Call Dify alert workflow for Feishu message body.
 * Returns null when workflow disabled or output empty.
 */
export async function generateAlertFeishuMessage(
  alerts: AlertRowInput[],
  alertCount: number,
): Promise<string | null> {
  if (!isAlertWorkflowEnabled() || !alerts.length) return null;

  const outputs = await runWorkflow('DIFY_API_KEY_ALERT', {
    alert_rows_json: JSON.stringify(alerts.slice(0, 100)),
    alert_count: alertCount,
  });

  return parseAlertWorkflowMessage(outputs);
}

export type DifySingleSkuForecastRow = {
  monthLabel: string;
  forecastDailyAvg: number;
  confidence?: string;
  rationale?: string;
};

function parseDifySingleSkuForecastOutput(raw: unknown): DifySingleSkuForecastRow[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const rows: DifySingleSkuForecastRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const monthLabel = String(row.monthLabel ?? row.month_label ?? '').trim();
    const forecastDailyAvg = Number(row.forecastDailyAvg ?? row.forecast_daily_avg ?? 0);
    if (!monthLabel || !Number.isFinite(forecastDailyAvg) || forecastDailyAvg < 0) continue;
    rows.push({
      monthLabel,
      forecastDailyAvg: Math.round(forecastDailyAvg * 10_000) / 10_000,
      confidence: row.confidence != null ? String(row.confidence) : undefined,
      rationale: row.rationale != null ? String(row.rationale) : undefined,
    });
  }
  return rows;
}

/** T99 单条 SKU Dify LLM 预测 */
export async function runSingleSkuForecastWorkflow(
  inputs: Record<string, unknown>,
  userId = 'forecast-dify-single',
): Promise<{ monthly: DifySingleSkuForecastRow[]; summary: string }> {
  if (!isSalesForecastWorkflowEnabled()) {
    throw new Error('DIFY_API_KEY_SALES_FORECAST is not configured');
  }

  const outputs = await runWorkflow('DIFY_API_KEY_SALES_FORECAST', inputs, userId);
  const monthly = parseDifySingleSkuForecastOutput(
    outputs.monthly_forecast_json ?? outputs.forecast_json,
  );
  const summary = String(outputs.summary ?? outputs.rationale ?? outputs.text ?? '').trim();
  return { monthly, summary };
}
