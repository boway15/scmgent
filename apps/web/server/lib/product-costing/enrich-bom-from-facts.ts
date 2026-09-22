import {
  computeCarcassCuts,
  inferDefaultDrawerFrontSize,
  inferDrawerGrid,
  isImplausibleDrawerFrontSize,
  looksLikeDrawerFrontCut,
  resolveFrontRailQty,
} from './carcass-cut-rules.js';
import { canonicalMaterialName, isChestCategory } from './category-rules.js';
import { parseBoardSpec } from './parse-board-spec.js';
import type { OverallSize } from './parse-overall-size.js';
import { absorbSubstrateCutRows } from './sanitize-bom-lines.js';
import type { CostingBomLineDraft } from './types.js';

export type ProductFacts = {
  category?: string | null;
  overallSize?: OverallSize | null;
  drawerCount?: number | null;
  defaultSubstrate?: string | null;
  carcassThicknessMm?: number | null;
  drawerBottomThicknessMm?: number | null;
  sideThicknessMm?: number | null;
  backThicknessMm?: number | null;
  bottomThicknessMm?: number | null;
  structureSummary?: string | null;
  designPrinciples?: string | null;
};

export { isChestCategory } from './category-rules.js';

const INFERRED = '由结构关系推算，待核对';
const DECORATIVE = /胡桃|浮雕|木皮|饰面|封边|山纹/;
const PROFILE = /踢脚|拉条/;
const SUBSTRATE = /颗粒板|密度板|多层|中纤|mdf/i;
const OVERALL_NAME = /桌面板|^(桌面|台面)$|产品尺寸|外形/;
const CARCASS_MIN_MM = 8;
const CARCASS_MAX_MM = 25;

type SizePair = { a: number; b: number };

function parseSizePair(spec: string): SizePair | null {
  const parsed = parseBoardSpec(spec);
  const match = parsed.size.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return { a: Number(match[1]), b: Number(match[2]) };
}

function modeThicknessMm(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]![0];
}

function isThicknessSourceLine(line: CostingBomLineDraft): boolean {
  if (DECORATIVE.test(line.materialName) || PROFILE.test(line.materialName)) return false;
  if (/抽面|抽侧|抽后|抽底|抽屉/.test(line.materialName)) return false;
  const parsed = parseBoardSpec(line.spec);
  if (!parsed.thicknessMm) return false;
  if (parsed.size) return true;
  if (/桌面板|^(桌面|台面)$/.test(line.materialName)) return true;
  if (SUBSTRATE.test(line.materialName)) return true;
  return false;
}

function collectCarcassThicknesses(lines: CostingBomLineDraft[], predicate: (mm: number) => boolean): number[] {
  return lines
    .filter(isThicknessSourceLine)
    .map((line) => parseBoardSpec(line.spec).thicknessMm)
    .filter((mm): mm is number => mm !== null && predicate(mm));
}

function inferPartThicknessMm(
  lines: CostingBomLineDraft[],
  namePattern: RegExp,
  options: { min: number; max: number; defaultMm: number },
): number {
  const named = lines.find((line) => namePattern.test(line.materialName));
  const fromNamed = parseBoardSpec(named?.spec ?? '').thicknessMm;
  if (fromNamed !== null && fromNamed >= options.min && fromNamed <= options.max) return fromNamed;

  for (const line of lines) {
    const text = `${line.materialName} ${line.spec} ${line.notes}`;
    if (!namePattern.test(text)) continue;
    const match = text.match(/(\d+(?:\.\d+)?)\s*mm/i);
    if (!match) continue;
    const mm = Number(match[1]);
    if (mm >= options.min && mm <= options.max) return mm;
  }
  return options.defaultMm;
}

function inferOverallFromLines(lines: CostingBomLineDraft[]): OverallSize | null {
  const top = lines.find((line) => OVERALL_NAME.test(line.materialName));
  const topPair = top ? parseSizePair(top.spec) : null;
  if (!topPair) return null;

  const widthMm = Math.max(topPair.a, topPair.b);
  const depthMm = Math.min(topPair.a, topPair.b);
  const pairs = lines
    .filter((line) => OVERALL_NAME.test(line.materialName) || /侧板/.test(line.materialName))
    .map((line) => parseSizePair(line.spec))
    .filter((pair): pair is SizePair => pair !== null);

  for (const pair of pairs) {
    const dims = [pair.a, pair.b];
    if (!dims.includes(depthMm)) continue;
    const other = dims[0] === depthMm ? dims[1]! : dims[0]!;
    if (other !== widthMm && other >= 200) {
      return { widthMm, depthMm, heightMm: other };
    }
  }
  return null;
}

function formatSizePair(pair: SizePair): string {
  return `${pair.a}×${pair.b}`;
}

const NOT_DRAWER_FRONT_NAME =
  /侧板|顶底|^顶板$|^底板$|背板|拉条|抽侧|抽后|抽底|桌面|台面|踢脚|封边|滑轨/;

function drawerFrontPairScore(line: CostingBomLineDraft): number {
  let score = 10;
  if (nameIs(line, /抽面|抽屉面板/)) score -= 6;
  if (line.origin === 'explicit') score -= 4;
  if (line.origin === 'template') score += 5;
  if (/\bp\s*7\b|\bp7\b|\bsize\b|尺寸/i.test(line.sourceRef)) score -= 4;
  if (/^(密度板|颗粒板|多层实木板|中纤板|mdf)$/i.test(line.materialName.trim())) score += 2;
  return score;
}

/** Size-page 抽面 often lands on 颗粒板/密度板 instead of the 抽面 slot. */
function findDrawerFrontSizeFromLines(
  lines: CostingBomLineDraft[],
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  drawerCount: number,
): string | null {
  let best: { size: string; score: number } | null = null;
  for (const line of lines) {
    if (NOT_DRAWER_FRONT_NAME.test(line.materialName)) continue;
    const pair = parseSizePair(line.spec);
    if (!pair) continue;
    const faceW = Math.max(pair.a, pair.b);
    const faceH = Math.min(pair.a, pair.b);
    if (isImplausibleDrawerFrontSize(faceW, faceH, cabinetWidthMm, cabinetHeightMm, drawerCount)) {
      continue;
    }
    const size = `${Math.round(faceW)}×${Math.round(faceH)}`;
    const score = drawerFrontPairScore(line);
    if (!best || score < best.score) best = { size, score };
  }
  return best?.size ?? null;
}

function pairsMatchDrawerFront(left: SizePair, right: SizePair): boolean {
  return (
    Math.abs(Math.max(left.a, left.b) - Math.max(right.a, right.b)) <= 2 &&
    Math.abs(Math.min(left.a, left.b) - Math.min(right.a, right.b)) <= 2
  );
}

const SUBSTRATE_CUT_NAME = /^(密度板|颗粒板|多层实木板|中纤板|mdf)$/i;

function mergeDrawerFrontRows(
  keep: CostingBomLineDraft,
  incoming: CostingBomLineDraft,
): CostingBomLineDraft {
  const keepScore =
    (keep.origin === 'explicit' ? 0 : 2) + (/\bp7\b/i.test(keep.sourceRef) ? 0 : 1);
  const incomingScore =
    (incoming.origin === 'explicit' ? 0 : 2) + (/\bp7\b/i.test(incoming.sourceRef) ? 0 : 1);
  const chosen = incomingScore < keepScore ? incoming : keep;
  const other = chosen === incoming ? keep : incoming;
  return {
    ...chosen,
    materialName: '抽面',
    category: '板材',
    qtyNet: Math.max(keep.qtyNet, incoming.qtyNet),
    origin: keep.origin === 'explicit' || incoming.origin === 'explicit' ? 'explicit' : chosen.origin,
    sourceRef: [...new Set([keep.sourceRef, incoming.sourceRef].filter(Boolean))].join(','),
    notes: appendNote(appendNote(chosen.notes, other.notes), '尺寸图抽面'),
  };
}

function promoteObviousSubstrateCuts(
  lines: CostingBomLineDraft[],
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): CostingBomLineDraft[] {
  const hasNamedDrawerFront = lines.some(
    (line) => /抽面|抽屉面板/.test(line.materialName) && (line.qtyNet > 0 || parseSizePair(line.spec)),
  );

  const promoted = lines.map((line) => {
    if (!SUBSTRATE_CUT_NAME.test(line.materialName.trim())) return line;
    const pair = parseSizePair(line.spec);
    if (!pair) return line;
    const faceW = Math.max(pair.a, pair.b);
    const faceH = Math.min(pair.a, pair.b);
    if (
      !hasNamedDrawerFront &&
      looksLikeDrawerFrontCut(faceW, faceH, cabinetWidthMm, cabinetHeightMm)
    ) {
      return {
        ...line,
        materialName: '抽面',
        category: '板材',
        notes: appendNote(line.notes, '尺寸图抽面'),
      };
    }
    return line;
  });

  const fronts = promoted.filter((line) => /抽面|抽屉面板/.test(line.materialName));
  if (fronts.length <= 1) return promoted;
  const rest = promoted.filter((line) => !/抽面|抽屉面板/.test(line.materialName));
  return [...rest, fronts.reduce((keep, incoming) => mergeDrawerFrontRows(keep, incoming))];
}

function promoteMisnamedSubstrateStructure(
  lines: CostingBomLineDraft[],
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  drawerCount: number,
): CostingBomLineDraft[] {
  if (drawerCount > 0) {
    return collapseMisnamedDrawerFronts(lines, cabinetWidthMm, cabinetHeightMm, drawerCount);
  }
  return promoteObviousSubstrateCuts(lines, cabinetWidthMm, cabinetHeightMm);
}

/** 识别阶段：把尺寸图写成颗粒板/密度板的抽面开料提升为「抽面」，避免再补空模板行。 */
export function promoteExtractedStructureLines(
  lines: CostingBomLineDraft[],
  facts?: ProductFacts,
): CostingBomLineDraft[] {
  const size = facts?.overallSize;
  if (!size) return lines;
  let drawers = typeof facts?.drawerCount === 'number' && facts.drawerCount > 0 ? facts.drawerCount : 0;
  if (!drawers) {
    const slides = lines.find((line) => /滑轨/.test(line.materialName));
    if (slides && slides.qtyNet >= 2) drawers = Math.round(slides.qtyNet);
  }
  return promoteMisnamedSubstrateStructure(lines, size.widthMm, size.heightMm, drawers);
}

/** 颗粒板/密度板 + 抽面开料 = 抽面；尺寸图与 CMF 各写一行时只留一条。 */
function collapseMisnamedDrawerFronts(
  lines: CostingBomLineDraft[],
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  drawerCount: number,
): CostingBomLineDraft[] {
  if (!drawerCount) return lines;
  const frontSize = findDrawerFrontSizeFromLines(
    lines,
    cabinetWidthMm,
    cabinetHeightMm,
    drawerCount,
  );
  const frontPair = frontSize ? parseSizePair(frontSize) : null;
  if (!frontPair) return lines;

  const promoted = lines.map((line) => {
    if (!SUBSTRATE_CUT_NAME.test(line.materialName.trim())) return line;
    const pair = parseSizePair(line.spec);
    if (!pair || !pairsMatchDrawerFront(pair, frontPair)) return line;
    return {
      ...line,
      materialName: '抽面',
      category: '板材',
      notes: appendNote(line.notes, '尺寸图抽面'),
    };
  });

  const fronts = promoted.filter((line) => /抽面|抽屉面板/.test(line.materialName));
  const rest = promoted.filter((line) => !/抽面|抽屉面板/.test(line.materialName));
  if (fronts.length <= 1) return promoted;

  const matching = fronts.filter((line) => {
    const pair = parseSizePair(line.spec);
    return pair ? pairsMatchDrawerFront(pair, frontPair) : false;
  });
  const pool = matching.length ? matching : fronts;
  return [...rest, pool.reduce((keep, incoming) => mergeDrawerFrontRows(keep, incoming))];
}

/** Prefer explicit / high-confidence cut size already extracted for a drawer part. */
function findExplicitCutSize(lines: CostingBomLineDraft[], namePattern: RegExp): string | null {
  const rank = (line: CostingBomLineDraft): number => {
    let score = line.origin === 'explicit' ? 0 : 1;
    if (line.confidence === 'high') score -= 0.2;
    else if (line.confidence === 'medium') score += 0.1;
    if (parseSizePair(line.spec)) score -= 0.5;
    return score;
  };
  let best: { size: string; score: number } | null = null;
  for (const line of lines) {
    if (!namePattern.test(line.materialName)) continue;
    const pair = parseSizePair(line.spec);
    if (!pair) continue;
    const size = formatSizePair(pair);
    const score = rank(line);
    if (!best || score < best.score) best = { size, score };
  }
  return best?.size ?? null;
}

function resolveDrawerSize(
  line: CostingBomLineDraft,
  lines: CostingBomLineDraft[],
  namePattern: RegExp,
  fallback: string,
  validateFront?: {
    cabinetWidthMm: number;
    cabinetHeightMm: number;
    drawerCount: number;
  },
): string {
  const pick = (spec: string | null | undefined): string | null => {
    if (!spec) return null;
    const pair = parseSizePair(spec);
    if (!pair) return null;
    const lengthMm = Math.max(pair.a, pair.b);
    const widthMm = Math.min(pair.a, pair.b);
    if (
      validateFront &&
      isImplausibleDrawerFrontSize(
        lengthMm,
        widthMm,
        validateFront.cabinetWidthMm,
        validateFront.cabinetHeightMm,
        validateFront.drawerCount,
      )
    ) {
      return null;
    }
    return formatSizePair(pair);
  };

  return (
    pick(line.spec) ??
    pick(findExplicitCutSize(lines, namePattern)) ??
    fallback
  );
}

function composeSpec(existing: string, size: string, thicknessMm?: number | null): string {
  const parsed = parseBoardSpec(existing);
  if (parsed.size) {
    if (parsed.thickness || thicknessMm == null) return existing.trim();
    return `${thicknessMm}mm ${parsed.size}`.trim();
  }
  const thickness = parsed.thickness || (thicknessMm ? `${thicknessMm}mm` : '');
  return [thickness, size].filter(Boolean).join(' ').trim();
}

function appendNote(notes: string, extra: string): string {
  if (!extra) return notes;
  if (notes.includes(extra)) return notes;
  return notes ? `${notes}；${extra}` : extra;
}

function kickMm(lines: CostingBomLineDraft[]): number {
  for (const line of lines) {
    if (!/踢脚/.test(line.materialName) || /高度/.test(line.materialName)) continue;
    const mm = parseBoardSpec(line.spec ?? '').thicknessMm;
    if (mm) return mm;
  }
  return 0;
}

function nameIs(line: CostingBomLineDraft, pattern: RegExp): boolean {
  return pattern.test(line.materialName);
}

function patch(
  line: CostingBomLineDraft,
  nextSpec: { size: string; thicknessMm?: number | null },
  qtyNet?: number,
  options?: { forceSize?: boolean; forceQty?: boolean; forceThickness?: boolean },
): CostingBomLineDraft {
  let next = { ...line };
  let changed = false;
  const parsed = parseBoardSpec(line.spec);
  const existingPair = parseSizePair(line.spec);
  const nextPair = parseSizePair(nextSpec.size);
  const forceSize =
    options?.forceSize === true ||
    (Boolean(existingPair && nextPair) &&
      (existingPair!.a !== nextPair!.a || existingPair!.b !== nextPair!.b) &&
      line.origin !== 'explicit');
  const thicknessLabel =
    options?.forceThickness && nextSpec.thicknessMm
      ? `${nextSpec.thicknessMm}mm`
      : parsed.thickness || (nextSpec.thicknessMm ? `${nextSpec.thicknessMm}mm` : '');
  const composed = forceSize
    ? [thicknessLabel, nextSpec.size].filter(Boolean).join(' ').trim()
    : composeSpec(line.spec, nextSpec.size, nextSpec.thicknessMm);
  if (composed && composed !== line.spec) {
    next.spec = composed;
    changed = true;
  }
  if (
    typeof qtyNet === 'number' &&
    (line.qtyNet <= 0 || (options?.forceQty === true && line.qtyNet !== qtyNet))
  ) {
    next.qtyNet = qtyNet;
    changed = true;
  }
  if (!changed) return line;
  return { ...next, notes: appendNote(next.notes, INFERRED) };
}

const APPLY_CUT = { forceSize: true, forceQty: true, forceThickness: true } as const;

function sizeText(lengthMm: number, widthMm: number): string {
  return `${lengthMm}×${widthMm}`;
}

function collapseNamedRows(lines: CostingBomLineDraft[], materialName: string): CostingBomLineDraft[] {
  const matches = lines.filter((line) => line.materialName === materialName);
  if (matches.length <= 1) return lines;
  const rest = lines.filter((line) => line.materialName !== materialName);
  const keep = matches.reduce((left, right) => {
    const pick = (a: CostingBomLineDraft, b: CostingBomLineDraft): CostingBomLineDraft => {
      const aSized = Boolean(parseSizePair(a.spec));
      const bSized = Boolean(parseSizePair(b.spec));
      if (aSized !== bSized) return aSized ? a : b;
      if (a.origin === 'explicit' && b.origin !== 'explicit') return a;
      if (b.origin === 'explicit' && a.origin !== 'explicit') return b;
      return a.qtyNet >= b.qtyNet ? a : b;
    };
    const preferred = pick(left, right);
    const other = preferred === left ? right : left;
    return {
      ...preferred,
      spec: preferred.spec.trim() || other.spec,
      qtyNet: Math.max(left.qtyNet, right.qtyNet),
      origin: left.origin === 'explicit' || right.origin === 'explicit' ? 'explicit' : preferred.origin,
      sourceRef: [...new Set([left.sourceRef, right.sourceRef].filter(Boolean))].join(','),
      notes: appendNote(left.notes, right.notes),
      unit: preferred.qtyNet > 0 ? preferred.unit : other.unit || preferred.unit,
    };
  });
  return [...rest, keep];
}

function upsertRail(
  lines: CostingBomLineDraft[],
  materialName: string,
  part: { lengthMm: number; widthMm: number; qty: number } | null,
  thicknessMm: number,
  options?: { preserveExplicitQty?: boolean },
): CostingBomLineDraft[] {
  if (!part || part.qty <= 0) {
    return lines.filter((line) => line.materialName !== materialName);
  }
  const collapsed = collapseNamedRows(lines, materialName);
  const spec = `${thicknessMm}mm ${sizeText(part.lengthMm, part.widthMm)}`;
  const index = collapsed.findIndex((line) => line.materialName === materialName);
  if (index < 0) {
    return [
      ...collapsed,
      {
        category: '板材',
        materialName,
        spec,
        unit: '根',
        qtyNet: part.qty,
        lossRate: 0.08,
        sourceRef: '',
        confidence: 'low',
        origin: options?.preserveExplicitQty ? 'explicit' : 'template',
        notes: options?.preserveExplicitQty ? '' : INFERRED,
      },
    ];
  }
  const existing = collapsed[index]!;
  const qty =
    options?.preserveExplicitQty && existing.origin === 'explicit' && existing.qtyNet > 0
      ? existing.qtyNet
      : part.qty;
  return collapsed.map((line, current) =>
    current === index
      ? patch(
          line,
          { size: sizeText(part.lengthMm, part.widthMm), thicknessMm },
          qty,
          {
            forceSize: true,
            forceQty: !(options?.preserveExplicitQty && existing.origin === 'explicit'),
            forceThickness: true,
          },
        )
      : line,
  );
}

function isFrontRailMaterialName(name: string): boolean {
  return canonicalMaterialName(name.trim()) === '前拉条';
}

export function enrichBomFromProductFacts(
  lines: CostingBomLineDraft[],
  facts: ProductFacts,
): CostingBomLineDraft[] {
  const absorbed = absorbSubstrateCutRows(lines);
  const size = facts.overallSize ?? inferOverallFromLines(absorbed);
  if (!size) return absorbed;
  const { widthMm: w, depthMm: d, heightMm: h } = size;
  let drawers =
    typeof facts.drawerCount === 'number' && facts.drawerCount > 0 ? facts.drawerCount : 0;
  if (!drawers) {
    const slides = absorbed.find((line) => /滑轨/.test(line.materialName));
    if (slides && slides.qtyNet >= 2) drawers = Math.round(slides.qtyNet);
  }
  const sourceLines = promoteMisnamedSubstrateStructure(absorbed, w, h, drawers);
  const kick = kickMm(sourceLines);
  const chest = isChestCategory(facts.category);
  const factCarcass = facts.carcassThicknessMm;
  const carcassMm =
    typeof factCarcass === 'number' && factCarcass >= CARCASS_MIN_MM && factCarcass <= CARCASS_MAX_MM
      ? factCarcass
      : modeThicknessMm(
          collectCarcassThicknesses(
            sourceLines,
            (mm) => mm >= CARCASS_MIN_MM && mm <= CARCASS_MAX_MM,
          ),
        ) ?? 18;
  const sideMm =
    typeof facts.sideThicknessMm === 'number' && facts.sideThicknessMm >= 8 && facts.sideThicknessMm <= 40
      ? facts.sideThicknessMm
      : carcassMm;
  const bottomMm =
    typeof facts.bottomThicknessMm === 'number' &&
    facts.bottomThicknessMm >= 3 &&
    facts.bottomThicknessMm <= 40
      ? facts.bottomThicknessMm
      : carcassMm;
  const backPanelMm =
    typeof facts.backThicknessMm === 'number' && facts.backThicknessMm >= 2 && facts.backThicknessMm <= 18
      ? facts.backThicknessMm
      : inferPartThicknessMm(sourceLines, /背板/, { min: 2, max: 6, defaultMm: 3 });
  const factBottom = facts.drawerBottomThicknessMm;
  const drawerBottomMm =
    typeof factBottom === 'number' && factBottom >= 3 && factBottom <= 18
      ? factBottom
      : inferPartThicknessMm(sourceLines, /抽底|抽屉底/, { min: 3, max: 18, defaultMm: 9 });
  const defaultFront = inferDefaultDrawerFrontSize({
    widthMm: w,
    heightMm: h,
    kickMm: kick,
    sideThicknessMm: sideMm,
    drawerCount: drawers,
  });
  const explicitFront =
    findDrawerFrontSizeFromLines(sourceLines, w, h, drawers) ??
    findExplicitCutSize(sourceLines, /抽面|抽屉面板/);
  const frontPair = explicitFront ? parseSizePair(explicitFront) : null;
  const explicitFrontOk =
    frontPair &&
    !isImplausibleDrawerFrontSize(
      Math.max(frontPair.a, frontPair.b),
      Math.min(frontPair.a, frontPair.b),
      w,
      h,
      drawers,
    );
  const drawerFrontWidth = explicitFrontOk
    ? Math.max(frontPair!.a, frontPair!.b)
    : defaultFront.widthMm;
  const drawerFrontHeight = explicitFrontOk
    ? Math.min(frontPair!.a, frontPair!.b)
    : defaultFront.heightMm;
  const frontValidate = { cabinetWidthMm: w, cabinetHeightMm: h, drawerCount: drawers };
  const cuts = computeCarcassCuts({
    widthMm: w,
    depthMm: d,
    heightMm: h,
    sideThicknessMm: sideMm,
    drawerCount: drawers,
    drawerFrontWidthMm: drawerFrontWidth,
    drawerFrontHeightMm: drawerFrontHeight,
  });

  let result = sourceLines.map((line) => {
    if (nameIs(line, /桌面板|^(桌面|台面)$/)) {
      const topMm = parseBoardSpec(line.spec).thicknessMm ?? carcassMm;
      return patch(
        line,
        { size: sizeText(cuts.top.lengthMm, cuts.top.widthMm), thicknessMm: topMm },
        cuts.top.qty,
        APPLY_CUT,
      );
    }
    if (nameIs(line, /侧板/) && !nameIs(line, /抽侧|抽屉侧/)) {
      return patch(
        line,
        { size: sizeText(cuts.sides.lengthMm, cuts.sides.widthMm), thicknessMm: sideMm },
        cuts.sides.qty,
        APPLY_CUT,
      );
    }
    if (nameIs(line, /顶底板|^顶板$/)) {
      return patch(
        line,
        { size: sizeText(cuts.top.lengthMm, cuts.top.widthMm), thicknessMm: carcassMm },
        cuts.top.qty,
        APPLY_CUT,
      );
    }
    if (nameIs(line, /^底板$/) && (!chest || cuts.bottom)) {
      const part = cuts.bottom;
      if (part) {
        return patch(
          line,
          { size: sizeText(part.lengthMm, part.widthMm), thicknessMm: bottomMm },
          part.qty,
          APPLY_CUT,
        );
      }
    }
    if (nameIs(line, /^底板$/) && chest && !cuts.bottom) {
      return {
        ...line,
        qtyNet: 0,
        notes: appendNote(line.notes, '侧板落地，底板取消'),
      };
    }
    if (nameIs(line, /背板/) && !nameIs(line, /背拉|后板/)) {
      return patch(
        line,
        { size: sizeText(cuts.back.lengthMm, cuts.back.widthMm), thicknessMm: backPanelMm },
        cuts.back.qty,
        APPLY_CUT,
      );
    }
    if (nameIs(line, /抽面|抽屉面板/) && drawers) {
      const fromCuts = sizeText(cuts.drawerFront.lengthMm, cuts.drawerFront.widthMm);
      const resolved =
        line.origin === 'explicit'
          ? resolveDrawerSize(line, sourceLines, /抽面|抽屉面板/, fromCuts, frontValidate)
          : fromCuts;
      const own = parseSizePair(line.spec);
      const forceFront =
        line.origin !== 'explicit' ||
        (Boolean(own) && resolved !== formatSizePair(own!));
      return patch(
        line,
        { size: resolved, thicknessMm: carcassMm },
        drawers,
        { forceSize: forceFront, forceQty: true, forceThickness: true },
      );
    }
    if (nameIs(line, /抽侧|抽屉侧/) && drawers) {
      return patch(
        line,
        {
          size: sizeText(cuts.drawerSide.lengthMm, cuts.drawerSide.widthMm),
          thicknessMm: carcassMm,
        },
        cuts.drawerSide.qty,
        { forceSize: true, forceQty: true, forceThickness: true },
      );
    }
    if (nameIs(line, /抽后|抽屉后/) && drawers) {
      return patch(
        line,
        {
          size: sizeText(cuts.drawerBack.lengthMm, cuts.drawerBack.widthMm),
          thicknessMm: carcassMm,
        },
        cuts.drawerBack.qty,
        { forceSize: true, forceQty: true, forceThickness: true },
      );
    }
    if (nameIs(line, /抽底|抽屉底/) && drawers) {
      return patch(
        line,
        {
          size: sizeText(cuts.drawerBottom.lengthMm, cuts.drawerBottom.widthMm),
          thicknessMm: drawerBottomMm,
        },
        cuts.drawerBottom.qty,
        { forceSize: true, forceQty: true, forceThickness: true },
      );
    }
    if (nameIs(line, /滑轨/) && drawers) {
      if (line.qtyNet !== drawers) {
        return { ...line, qtyNet: drawers, notes: appendNote(line.notes, '一抽一套滑轨') };
      }
      return line;
    }
    if (nameIs(line, /踢脚/) && !nameIs(line, /高度/)) {
      const kickH = (parseBoardSpec(line.spec).thicknessMm ?? kickMm(sourceLines)) || 60;
      if (!parseSizePair(line.spec)) {
        return patch(
          line,
          { size: sizeText(w - 2 * sideMm, kickH), thicknessMm: carcassMm },
          Math.max(line.qtyNet, 1),
          APPLY_CUT,
        );
      }
    }
    return line;
  });

  if (chest) {
    result = upsertRail(result, '落地拉条', cuts.floorRails, bottomMm);
    const frontRailQty = resolveFrontRailQty(sourceLines, drawers, isFrontRailMaterialName);
    const frontRailPart =
      frontRailQty.qty > 0
        ? {
            lengthMm: cuts.frontRails.lengthMm,
            widthMm: cuts.frontRails.widthMm,
            qty: frontRailQty.qty,
          }
        : null;
    if (frontRailPart) {
      result = upsertRail(result, '前拉条', frontRailPart, carcassMm, {
        preserveExplicitQty: frontRailQty.source === 'explicit',
      });
    } else {
      result = upsertRail(result, '前拉条', null, carcassMm);
    }
    result = upsertRail(result, '背拉条', cuts.backRail, carcassMm);
  }
  if (chest && drawers && !result.some((line) => nameIs(line, /抽后|抽屉后/))) {
    result = [
      ...result,
      {
        category: '板材',
        materialName: '抽后',
        spec: `${carcassMm}mm ${sizeText(cuts.drawerBack.lengthMm, cuts.drawerBack.widthMm)}`,
        unit: '块',
        qtyNet: cuts.drawerBack.qty,
        lossRate: 0.08,
        sourceRef: '',
        confidence: 'low',
        origin: 'template',
        notes: INFERRED,
      },
    ];
  }
  return absorbSubstrateCutRows(result).filter((line) => {
    const name = line.materialName.trim();
    if (!/^(密度板|颗粒板|多层实木板|中纤板|mdf)$/i.test(name)) return true;
    return !parseSizePair(line.spec);
  });
}
