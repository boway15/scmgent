import type { OverallSize } from './parse-overall-size.js';
import type { CostingBomLineDraft } from './types.js';
import { canonicalMaterialName } from './category-rules.js';
import { mergePackProfile, type PackProfile } from './pack-profile.js';

const PACK_NOTE = '按成品外形加余量估算包装';

function appendNote(notes: string, extra: string): string {
  if (!extra) return notes;
  if (notes.includes(extra)) return notes;
  return notes ? `${notes}；${extra}` : extra;
}

function round4FromMm2(areaMm2: number): number {
  return Math.round(areaMm2 / 100) / 10_000;
}

export function packagingOuterSize(size: OverallSize, allowanceMm = 80): OverallSize {
  return {
    widthMm: size.widthMm + allowanceMm,
    depthMm: size.depthMm + allowanceMm,
    heightMm: size.heightMm + allowanceMm,
  };
}

/** 外箱展开面积（六面），用于纸箱 m²。 */
export function boxSurfaceM2(outer: OverallSize): number {
  const length = outer.widthMm;
  const width = outer.depthMm;
  const height = outer.heightMm;
  return round4FromMm2(2 * (length * width + length * height + width * height));
}

/** 保利龙体积 = 六面面积 × foamThicknessMm。 */
export function foamVolumeM3(outer: OverallSize, foamThicknessMm = 20): number {
  const length = outer.widthMm;
  const width = outer.depthMm;
  const height = outer.heightMm;
  const areaMm2 = 2 * (length * width + length * height + width * height);
  return Math.round((areaMm2 * foamThicknessMm) / 100_000) / 10_000;
}

function outerSpec(outer: OverallSize): string {
  return `外径 ${outer.widthMm}×${outer.depthMm}×${outer.heightMm} mm`;
}

function upsertNamed(
  lines: CostingBomLineDraft[],
  next: CostingBomLineDraft,
): CostingBomLineDraft[] {
  const index = lines.findIndex(
    (line) => canonicalMaterialName(line.materialName) === canonicalMaterialName(next.materialName),
  );
  if (index < 0) return [...lines, next];
  const current = lines[index]!;
  const copy = [...lines];
  copy[index] = {
    ...current,
    ...next,
    notes: appendNote(current.notes, next.notes),
  };
  return copy;
}

const REPLACED_PACK_NAME = /保利龙|纸箱|纸护角|护角/;

function stripReplacedPackaging(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  return lines.filter((line) => !REPLACED_PACK_NAME.test(canonicalMaterialName(line.materialName)));
}

export function upsertPackagingLines(
  lines: CostingBomLineDraft[],
  overallSize?: OverallSize | null,
  packProfile?: PackProfile | null,
): CostingBomLineDraft[] {
  const withoutPack = stripReplacedPackaging(lines);
  if (!overallSize) return withoutPack;
  const profile = mergePackProfile(packProfile);
  const outer = packagingOuterSize(overallSize, profile.cornerAllowanceMm);
  const spec = outerSpec(outer);
  let result = withoutPack;
  result = upsertNamed(result, {
    category: '包装',
    materialName: '纸护角',
    spec,
    unit: '个',
    qtyNet: 4,
    lossRate: 0,
    sourceRef: '',
    confidence: 'high',
    origin: 'template',
    notes: `${PACK_NOTE}；4×${profile.cornerYuanEach} 元`,
  });
  result = upsertNamed(result, {
    category: '包装',
    materialName: '保利龙',
    spec: `${spec}；六面 ${profile.foamThicknessMm}mm`,
    unit: 'm³',
    qtyNet: foamVolumeM3(outer, profile.foamThicknessMm),
    lossRate: 0,
    sourceRef: '',
    confidence: 'high',
    origin: 'template',
    notes: `${PACK_NOTE}；体积×${profile.foamYuanPerM3} 元/m³`,
  });
  result = upsertNamed(result, {
    category: '包装',
    materialName: '纸箱',
    spec: `${spec}；200磅`,
    unit: 'm²',
    qtyNet: boxSurfaceM2(outer),
    lossRate: 0,
    sourceRef: '',
    confidence: 'high',
    origin: 'template',
    notes: `${PACK_NOTE}；展开面积×${profile.cartonYuanPerM2} 元/m²`,
  });
  return result;
}

// Legacy exports for tests
export const PACK_ALLOWANCE_MM = 80;
export const FOAM_THICKNESS_MM = 20;
