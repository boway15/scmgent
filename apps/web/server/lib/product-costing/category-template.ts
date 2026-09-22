import { looksLikeDrawerFrontCut } from './carcass-cut-rules.js';
import { canonicalMaterialName, getCategoryRule } from './category-rules.js';
import type { CostingBomLineDraft } from './types.js';

const SUBSTRATE_CUT_NAME = /^(密度板|颗粒板|多层实木板|中纤板|mdf)$/i;

function parseCutPair(spec: string): { faceW: number; faceH: number } | null {
  const match = spec.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const a = Math.round(Number(match[1]));
  const b = Math.round(Number(match[2]));
  if (!(a > 0) || !(b > 0)) return null;
  return { faceW: Math.max(a, b), faceH: Math.min(a, b) };
}

export function lineFillsStructureSlot(lineName: string, slotName: string): boolean {
  const canonical = canonicalMaterialName(lineName).trim();
  const slot = canonicalMaterialName(slotName).trim();
  if (!canonical || !slot) return false;
  if (canonical.includes(slot) || slot.includes(canonical)) return true;
  if (slot === '顶底板' && /桌面板|^盖板$|^顶板$/.test(canonical)) return true;
  if (slot === '台面' && /桌面板/.test(canonical)) return true;
  return false;
}

function lineOccupiesStructureSlot(
  line: CostingBomLineDraft,
  slotName: string,
  cabinetSize?: { widthMm: number; heightMm: number } | null,
): boolean {
  if (lineFillsStructureSlot(line.materialName, slotName)) return true;
  if (!cabinetSize || slotName !== '抽面') return false;
  if (!SUBSTRATE_CUT_NAME.test(line.materialName.trim())) return false;
  const pair = parseCutPair(line.spec);
  if (!pair) return false;
  return looksLikeDrawerFrontCut(pair.faceW, pair.faceH, cabinetSize.widthMm, cabinetSize.heightMm);
}

export function applyCategoryTemplate(
  category: string | null | undefined,
  lines: CostingBomLineDraft[],
  facts?: { overallSize?: { widthMm: number; depthMm: number; heightMm: number } | null },
): CostingBomLineDraft[] {
  const slots = getCategoryRule(category).structureSlots;
  if (!slots.length) return lines;

  const cabinetSize = facts?.overallSize
    ? { widthMm: facts.overallSize.widthMm, heightMm: facts.overallSize.heightMm }
    : null;
  const missingLines = slots
    .filter(
      (slotName) => !lines.some((line) => lineOccupiesStructureSlot(line, slotName, cabinetSize)),
    )
    .map<CostingBomLineDraft>((materialName) => ({
      category: '板材',
      materialName,
      spec: '',
      unit: '块',
      qtyNet: 0,
      lossRate: 0,
      sourceRef: '',
      confidence: 'low',
      origin: 'template',
      notes: '用量待补',
    }));

  return [...lines, ...missingLines];
}
