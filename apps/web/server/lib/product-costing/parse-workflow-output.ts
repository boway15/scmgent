import { normalizeAiLine } from './bom-math.js';
import type { CostingBomLineDraft } from './types.js';

/** Extract lines array from Dify workflow outputs (flexible shapes). */
export function parseWorkflowLines(outputs: Record<string, unknown>): CostingBomLineDraft[] {
  let raw: unknown = outputs.lines ?? outputs.bom_lines ?? outputs.result;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    raw = obj.lines ?? obj.items ?? obj.data;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeAiLine).filter((x): x is CostingBomLineDraft => x !== null);
}
