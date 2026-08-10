import type { BomConfidence, CostingBomLineDraft } from './types.js';

const CONFIDENCE_SET = new Set<BomConfidence>(['high', 'medium', 'low']);

export function calcQtyGross(qtyNet: number, lossRate: number): number {
  const gross = qtyNet * (1 + lossRate);
  return Math.round(gross * 10000) / 10000;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function normalizeAiLine(raw: unknown): CostingBomLineDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const materialName = asString(row.material_name ?? row.materialName);
  const unit = asString(row.unit);
  const qtyNet = asNumber(row.qty_net ?? row.qtyNet);
  if (!materialName || !unit || qtyNet === null || qtyNet < 0) return null;

  const confidenceRaw = asString(row.confidence).toLowerCase() as BomConfidence;
  if (!CONFIDENCE_SET.has(confidenceRaw)) return null;

  const lossRate = asNumber(row.loss_rate ?? row.lossRate) ?? 0;
  if (lossRate < 0) return null;

  return {
    category: asString(row.category) || '未分类',
    materialName,
    spec: asString(row.spec),
    unit,
    qtyNet,
    lossRate,
    sourceRef: asString(row.source_ref ?? row.sourceRef),
    confidence: confidenceRaw,
    notes: asString(row.notes),
  };
}

export type ConfirmableBomLine = {
  materialName: string;
  unit: string;
  qtyNet: number | string | null | undefined;
  confidence: BomConfidence | string;
};

export function canConfirmBom(
  lines: ConfirmableBomLine[],
  force = false,
): { ok: boolean; reasons: string[] } {
  if (force) return { ok: true, reasons: [] };
  const reasons: string[] = [];
  if (lines.length === 0) {
    reasons.push('清单为空');
    return { ok: false, reasons };
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = `第 ${i + 1} 行`;
    if (!line.materialName?.trim()) reasons.push(`${label}缺少物料名称`);
    if (!line.unit?.trim()) reasons.push(`${label}缺少单位`);
    const qty = typeof line.qtyNet === 'string' ? Number(line.qtyNet) : line.qtyNet;
    if (qty === null || qty === undefined || !Number.isFinite(Number(qty))) {
      reasons.push(`${label}缺少净用量`);
    }
    if (line.confidence === 'low') reasons.push(`${label}置信度为 low`);
  }
  return { ok: reasons.length === 0, reasons };
}
