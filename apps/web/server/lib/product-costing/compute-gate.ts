import type { CostSummary } from './types.js';
import { isRolledProcessLine } from './board-sheet.js';
import { isBundledOtherHardware } from './hardware-facts.js';
import {
  isCmfPlaceholderLine,
  isDecorativeFinishName,
  isDepartmentFooterName,
  isProcessStandardLine,
  isProfileDimensionAnnotation,
} from './sanitize-bom-lines.js';

export type ComputeBlocker = {
  lineId?: string;
  materialName: string;
  reason: 'missing_price' | 'missing_qty' | 'missing_thickness';
};

export function listComputeBlockers(
  lines: Array<{
    id?: string;
    materialName: string;
    qtyNet: number;
    effectiveUnitPrice: number | null;
    category?: string;
    spec?: string | null;
    unit?: string;
  }>,
): ComputeBlocker[] {
  if (!lines.length) return [{ materialName: '无材料行', reason: 'missing_qty' }];
  const blockers: ComputeBlocker[] = [];
  for (const line of lines) {
    if (isRolledProcessLine(line.category ?? '', line.materialName)) continue;
    if (isBundledOtherHardware(line.materialName)) continue;
    if (isDepartmentFooterName(line.materialName)) continue;
    if (isDecorativeFinishName(line.materialName)) continue;
    if (isProfileDimensionAnnotation(line)) continue;
    if (isCmfPlaceholderLine(line)) continue;
    if (isProcessStandardLine({
      category: line.category ?? '',
      qtyNet: line.qtyNet,
      spec: line.spec ?? '',
      unit: line.unit ?? '',
    }))
      continue;
    if (!(line.qtyNet > 0)) {
      blockers.push({ lineId: line.id, materialName: line.materialName, reason: 'missing_qty' });
    }
    if (line.effectiveUnitPrice === null) {
      blockers.push({ lineId: line.id, materialName: line.materialName, reason: 'missing_price' });
    }
  }
  return blockers;
}

export function resolveDisplaySummary(opts: {
  snapshot: CostSummary | null;
  live: CostSummary;
}): { summary: CostSummary; costStale: boolean } {
  if (!opts.snapshot) {
    return {
      costStale: true,
      summary: {
        ...opts.live,
        materialAmount: 0,
        processAmount: 0,
        feeAmount: 0,
        totalAmount: 0,
        byCategory: [],
        feeItems: [],
        boardSheet: opts.live.boardSheet ?? [],
      },
    };
  }
  return { summary: opts.snapshot, costStale: false };
}
