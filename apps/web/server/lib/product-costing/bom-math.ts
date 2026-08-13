import type { BomConfidence, BomOrigin, CostingBomLineDraft } from './types.js';

const CATEGORIES = new Set(['板材', '五金', '表面工艺', '包装', '其他']);
const CONFIDENCES = new Set<BomConfidence>(['high', 'medium', 'low']);
const ORIGINS = new Set<BomOrigin>(['explicit', 'template']);

export function calcQtyGross(qtyNet: number, lossRate: number): number {
  return Math.round(qtyNet * (1 + lossRate) * 10000) / 10000;
}

export function normalizeAiLine(raw: unknown): CostingBomLineDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const input = raw as Record<string, unknown>;
  const qtyNet = input.qty_net;
  if (typeof qtyNet !== 'number' || !Number.isFinite(qtyNet) || qtyNet < 0) return null;

  const sourceRef = typeof input.source_ref === 'string' ? input.source_ref : '';
  const explicitOrigin = input.origin;
  const origin = ORIGINS.has(explicitOrigin as BomOrigin)
    ? (explicitOrigin as BomOrigin)
    : sourceRef.length > 0
      ? 'explicit'
      : 'template';
  const confidence = CONFIDENCES.has(input.confidence as BomConfidence)
    ? (input.confidence as BomConfidence)
    : 'low';

  return {
    category:
      typeof input.category === 'string' && CATEGORIES.has(input.category)
        ? input.category
        : '其他',
    materialName: typeof input.material_name === 'string' ? input.material_name : '',
    spec: typeof input.spec === 'string' ? input.spec : '',
    unit: typeof input.unit === 'string' ? input.unit : '',
    qtyNet,
    lossRate:
      typeof input.loss_rate === 'number' && Number.isFinite(input.loss_rate)
        ? input.loss_rate
        : 0,
    sourceRef,
    confidence,
    origin,
    notes: typeof input.notes === 'string' ? input.notes : '',
  };
}
