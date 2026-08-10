import type { BomConfidence, CostingBomLineDraft } from './types.js';

const CONFIDENCE_RANK: Record<BomConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function worseConfidence(a: BomConfidence, b: BomConfidence): BomConfidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

function mergeKey(line: CostingBomLineDraft): string {
  return [line.materialName.trim().toLowerCase(), line.spec.trim().toLowerCase(), line.unit.trim().toLowerCase()].join(
    '\u0001',
  );
}

export function mergeBomLines(batches: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const map = new Map<string, CostingBomLineDraft>();
  for (const line of batches) {
    const key = mergeKey(line);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...line });
      continue;
    }
    existing.qtyNet = Math.round((existing.qtyNet + line.qtyNet) * 10000) / 10000;
    existing.lossRate = Math.max(existing.lossRate, line.lossRate);
    existing.confidence = worseConfidence(existing.confidence, line.confidence);
    const refs = [existing.sourceRef, line.sourceRef].filter(Boolean);
    existing.sourceRef = [...new Set(refs)].join(',');
    if (line.notes && !existing.notes.includes(line.notes)) {
      existing.notes = [existing.notes, line.notes].filter(Boolean).join('; ');
    }
    if (!existing.category && line.category) existing.category = line.category;
  }
  return [...map.values()];
}
