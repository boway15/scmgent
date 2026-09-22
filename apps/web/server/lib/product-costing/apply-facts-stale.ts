import { canonicalMaterialName, isChestCategory } from './category-rules.js';
import { parseBoardSpec } from './parse-board-spec.js';

export const STRUCTURE_FACT_PATCH_KEYS = [
  'category',
  'drawerCount',
  'defaultSubstrate',
  'carcassThicknessMm',
  'drawerBottomThicknessMm',
  'sideThicknessMm',
  'backThicknessMm',
  'bottomThicknessMm',
  'structureSummary',
  'designPrinciples',
] as const;

export type StructureFactPatchKey = (typeof STRUCTURE_FACT_PATCH_KEYS)[number];

export function patchTouchesStructureFacts(
  patch: Partial<Record<StructureFactPatchKey, unknown>>,
): boolean {
  return STRUCTURE_FACT_PATCH_KEYS.some((key) => patch[key] !== undefined);
}

type StaleLine = {
  materialName: string;
  qtyNet: number;
  spec?: string | null;
  origin: string;
  notes?: string | null;
};

/** 是否已有「生成开料」产出的结构/滑轨行（用于区分首次开料 vs 需重算）。 */
export function hasAppliedStructureCuts(lines: StaleLine[]): boolean {
  return lines.some((line) => {
    if (!(line.qtyNet > 0)) return false;
    if ((line.notes ?? '').includes('由结构关系推算')) return true;
    if ((line.notes ?? '').includes('一抽一套滑轨')) return true;
    if (line.origin !== 'template') return false;
    return /侧板|顶底|背板|抽面|抽侧|抽后|抽底|拉条|抽屉滑轨/.test(line.materialName);
  });
}

export function detectApplyFactsStale(
  project: {
    status: string;
    drawerCount?: number | null;
    category?: string | null;
    carcassThicknessMm?: number | null;
  },
  lines: StaleLine[],
): boolean {
  if (!hasAppliedStructureCuts(lines)) return false;

  if (project.status === 'draft') return true;

  const drawers =
    typeof project.drawerCount === 'number' && project.drawerCount > 0 ? project.drawerCount : null;
  if (drawers && isChestCategory(project.category)) {
    const slide = lines.find(
      (line) => canonicalMaterialName(line.materialName) === '抽屉滑轨' && line.qtyNet > 0,
    );
    if (slide && slide.qtyNet !== drawers) return true;

    const front = lines.find((line) => line.materialName === '抽面' && line.qtyNet > 0);
    if (front && front.qtyNet !== drawers) return true;
  }

  if (project.carcassThicknessMm) {
    const side = lines.find((line) => line.materialName === '侧板' && line.qtyNet > 0 && line.spec);
    if (side) {
      const thicknessMm = parseBoardSpec(side.spec ?? '').thicknessMm;
      if (thicknessMm && thicknessMm !== project.carcassThicknessMm) return true;
    }
  }

  return false;
}
