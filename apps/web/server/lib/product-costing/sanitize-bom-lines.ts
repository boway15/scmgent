import { canonicalMaterialName, inferBomLineCategory } from './category-rules.js';
import { absorbProcessMisnamedBoardRows, isDrawerThicknessStandardLine, mergeProcessOverrides } from './process-bom-lines.js';
import { parseBoardSpec } from './parse-board-spec.js';
import { parseOverallSize } from './parse-overall-size.js';
import type { BomConfidence, CostingBomLineDraft } from './types.js';

const CONFIDENCE_RANK: Record<BomConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PROFILE_NAMES = /踢脚|拉条/;
const COVER_GAP = /盖住/;
const SIZE_NAME = /产品尺寸|外形尺寸|整体尺寸/;
const DEPARTMENT_FOOTER =
  /事业部|设计部|研发部|开发部|部门|^(?:[一二三四五六七八九十百]+|\d+)\s*部$/;
const BOARD_PANEL = /板|抽面|抽侧|抽底|侧板|顶底/;
const SUBSTRATE_ONLY = /^(密度板|颗粒板|多层实木板|中纤板|mdf)$/i;
const DECORATIVE_FINISH = /胡桃|浮雕|木皮|饰面|山纹/;
const HARDWARE_COUNT_UNITS = /^(套|个|只|件)$/;

function appendNote(notes: string, extra: string): string {
  if (!extra) return notes;
  if (!notes) return extra;
  if (notes.includes(extra)) return notes;
  return `${notes}；${extra}`;
}

export function isDepartmentFooterName(name: string): boolean {
  return DEPARTMENT_FOOTER.test(name.trim());
}

/** 饰面/色板只有厚度、没有开料，不是可计价物料。 */
export function isDecorativeFinishName(name: string): boolean {
  return DECORATIVE_FINISH.test(name.trim());
}

function isDepartmentFooterRow(line: CostingBomLineDraft): boolean {
  return isDepartmentFooterName(line.materialName);
}

function isOverallSizeRow(line: CostingBomLineDraft): boolean {
  if (SIZE_NAME.test(line.materialName)) return true;
  return Boolean(parseOverallSize([line.spec, `${line.materialName} ${line.spec}`]));
}

function isCoverGapRow(line: CostingBomLineDraft): boolean {
  return COVER_GAP.test(line.materialName);
}

function isHeightOnlyProfile(line: CostingBomLineDraft): boolean {
  if (isProfileDimensionAnnotation(line)) return false;
  if (!PROFILE_NAMES.test(line.materialName)) return false;
  const parsed = parseBoardSpec(line.spec);
  return Boolean(parsed.thicknessMm) && !parsed.size;
}

/** Dify 把「踢脚线高度 60mm」等截面标注拆成独立行，不是可计价物料。 */
export function isProfileDimensionAnnotation(
  line: Pick<CostingBomLineDraft, 'materialName' | 'spec'>,
): boolean {
  const name = line.materialName.trim();
  return /高度$/.test(name) && PROFILE_NAMES.test(name);
}

/** CMF/装饰占位：无开料尺寸的装饰记录。 */
export function isCmfPlaceholderLine(
  line: Pick<CostingBomLineDraft, 'materialName' | 'spec' | 'qtyNet'>,
): boolean {
  if (line.qtyNet > 0) return false;
  if (!/内嵌板|装饰板/.test(line.materialName.trim())) return false;
  return !parseBoardSpec(line.spec ?? '').size;
}

/** 表面工艺标准描述行，无面积用量。 */
export function isProcessStandardLine(
  line: Pick<CostingBomLineDraft, 'category' | 'qtyNet' | 'spec' | 'unit'>,
): boolean {
  if (line.category !== '表面工艺') return false;
  if (line.qtyNet > 0) return false;
  if (parseBoardSpec(line.spec).size) return false;
  return line.unit.trim() === '项';
}

function profileAnnotationBaseName(materialName: string): string {
  return materialName.trim().replace(/高度$/, '');
}

/** 将「踢脚线高度」等标注行的截面 mm 合并到本体行，再丢弃标注行。 */
export function foldProfileHeightAnnotations(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const annotations = lines.filter(isProfileDimensionAnnotation);
  if (!annotations.length) return lines;

  let result = [...lines];
  for (const ann of annotations) {
    const baseName = profileAnnotationBaseName(ann.materialName);
    const sectionMm = parseBoardSpec(ann.spec).thicknessMm;
    if (!sectionMm) continue;
    result = result.map((line) => {
      if (line.materialName.trim() !== baseName) return line;
      if (parseBoardSpec(line.spec).thicknessMm) return line;
      return {
        ...line,
        spec: `${sectionMm}mm`,
        notes: appendNote(line.notes, `截面高${sectionMm}mm（自标注行合并）`),
      };
    });
  }
  return result.filter((line) => !isProfileDimensionAnnotation(line));
}

function isBoardPanel(line: CostingBomLineDraft): boolean {
  if (PROFILE_NAMES.test(line.materialName)) return false;
  return BOARD_PANEL.test(line.materialName);
}

function specLeftoverLabel(spec: string): string {
  const parsed = parseBoardSpec(spec);
  const raw = spec.trim();
  if (parsed.size) return '';
  if (!parsed.thickness) return raw;
  return raw.replace(new RegExp(parsed.thickness.replace('.', '\\.'), 'i'), '').trim();
}

const PART_IN_SPEC =
  /抽面|抽侧|抽后|抽底|侧板|顶底板|前拉条|背拉条|落地拉条|踢脚|横撑|层板|盖板|桌面板|^(?:顶板|底板|背板|桌面|台面)$/;

function partNameFromSpecLabel(label: string): string | null {
  const text = canonicalMaterialName(label).trim();
  if (!text || SUBSTRATE_ONLY.test(text)) return null;
  if (/桌面板/.test(text)) return '桌面板';
  const match = text.match(
    /抽面|抽侧|抽后|抽底|侧板|顶底板|前拉条|背拉条|落地拉条|踢脚|横撑|层板|盖板|桌面板|^顶板$|^底板$|^背板$|^桌面$|^台面$/,
  );
  return match ? canonicalMaterialName(match[0]!) : PART_IN_SPEC.test(text) ? text : null;
}

/** CMF 常把「密度板 / 15mm 桌面板」拆成名称=基材、规格=零件名。 */
function relabelSubstrateAndPart(line: CostingBomLineDraft): CostingBomLineDraft {
  if (!SUBSTRATE_ONLY.test(canonicalMaterialName(line.materialName))) return line;
  const part = partNameFromSpecLabel(specLeftoverLabel(line.spec)) ?? partNameFromSpecLabel(line.spec.trim());
  if (!part) return line;
  const thickness = parseBoardSpec(line.spec).thickness;
  return {
    ...line,
    materialName: part,
    spec: thickness,
    category: '板材',
    substrate: canonicalMaterialName(line.materialName),
    notes: appendNote(line.notes, '基材与零件名已对调'),
  };
}

function isEmptySubstrateHint(line: CostingBomLineDraft): boolean {
  const canonical = canonicalMaterialName(line.materialName);
  return SUBSTRATE_ONLY.test(canonical) && !line.spec.trim() && line.qtyNet <= 0;
}

function isUnsizedFinishOrSubstrateHint(line: CostingBomLineDraft): boolean {
  const parsed = parseBoardSpec(line.spec);
  if (parsed.size) return false;
  if (isDecorativeFinishName(line.materialName)) return true;
  const canonical = canonicalMaterialName(line.materialName);
  return SUBSTRATE_ONLY.test(canonical) && line.qtyNet < 1;
}

function normalizeHardwareUnit(unit: string): string {
  return HARDWARE_COUNT_UNITS.test(unit.trim()) ? '套' : unit.trim();
}

function normalizeSpec(spec: string): string {
  const text = spec.trim().toLowerCase();
  if (!text || /^(未标明|未指定|未知规格|规格待定)$/.test(text)) return '';
  return text;
}

function mergeKey(line: CostingBomLineDraft): string {
  const name = canonicalMaterialName(line.materialName).toLowerCase();
  const spec = normalizeSpec(line.spec);
  const unit =
    line.category === '五金' || /防倾倒/.test(line.materialName)
      ? normalizeHardwareUnit(line.unit)
      : line.unit.trim().toLowerCase();
  return `${name}\u0001${spec}\u0001${unit}`;
}

function preferLine(existing: CostingBomLineDraft, incoming: CostingBomLineDraft): CostingBomLineDraft {
  const existingRank = CONFIDENCE_RANK[existing.confidence];
  const incomingRank = CONFIDENCE_RANK[incoming.confidence];
  if (incomingRank < existingRank) return incoming;
  if (incomingRank > existingRank) return existing;
  if (incoming.qtyNet > 0 && existing.qtyNet === 0) return incoming;
  if (existing.qtyNet > 0 && incoming.qtyNet === 0) return existing;
  if (incoming.category === '五金' && existing.category !== '五金') return incoming;
  if (existing.category === '五金' && incoming.category !== '五金') return existing;
  if (incoming.unit === '套' && existing.unit !== '套') return incoming;
  if (existing.unit === '套' && incoming.unit !== '套') return existing;
  if (incoming.qtyNet > existing.qtyNet) return incoming;
  return existing;
}

const NAMED_BOARD_PART =
  /抽面|抽侧|抽后|抽底|侧板|顶底|^顶板$|^底板$|背板|桌面|台面|拉条|踢脚|横撑|层板|盖板/;

function parseSizePair(spec: string): { a: number; b: number } | null {
  const parsed = parseBoardSpec(spec);
  const match = parsed.size.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  return { a: Number(match[1]), b: Number(match[2]) };
}

function sameCutSize(left: CostingBomLineDraft, right: CostingBomLineDraft): boolean {
  const a = parseSizePair(left.spec);
  const b = parseSizePair(right.spec);
  if (!a || !b) return false;
  return (
    Math.abs(Math.max(a.a, a.b) - Math.max(b.a, b.b)) <= 2 &&
    Math.abs(Math.min(a.a, a.b) - Math.min(b.a, b.b)) <= 2
  );
}

function sameThicknessOrUnknown(left: CostingBomLineDraft, right: CostingBomLineDraft): boolean {
  const a = parseBoardSpec(left.spec).thicknessMm;
  const b = parseBoardSpec(right.spec).thicknessMm;
  if (a === null || b === null) return true;
  return a === b;
}

function foldSubstrateIntoNamed(
  named: CostingBomLineDraft,
  substrate: CostingBomLineDraft,
): CostingBomLineDraft {
  return {
    ...named,
    qtyNet: named.qtyNet > 0 ? named.qtyNet : substrate.qtyNet,
    origin: named.origin === 'explicit' || substrate.origin === 'explicit' ? 'explicit' : named.origin,
    sourceRef: [...new Set([named.sourceRef, substrate.sourceRef].filter(Boolean))].join(','),
    notes: appendNote(named.notes, substrate.notes),
    spec: parseSizePair(named.spec) ? named.spec : substrate.spec,
    substrate: named.substrate?.trim() || substrate.substrate?.trim() || named.substrate,
  };
}

/** Explosion pages often name cuts 颗粒板/密度板 while the same L×W already exists as 抽面/拉条. */
export function absorbSubstrateCutRows(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const result = [...lines];
  for (let index = 0; index < result.length; index += 1) {
    const line = result[index]!;
    if (!SUBSTRATE_ONLY.test(canonicalMaterialName(line.materialName))) continue;
    if (!parseSizePair(line.spec)) continue;
    const matches = result.filter(
      (other, otherIndex) =>
        otherIndex !== index &&
        NAMED_BOARD_PART.test(other.materialName) &&
        !SUBSTRATE_ONLY.test(canonicalMaterialName(other.materialName)) &&
        sameCutSize(other, line) &&
        sameThicknessOrUnknown(other, line),
    );
    if (!matches.length) continue;
    const target = matches.find((row) => row.qtyNet <= 0) ?? matches[0]!;
    const targetIndex = result.indexOf(target);
    if (targetIndex >= 0) {
      result[targetIndex] = foldSubstrateIntoNamed(result[targetIndex]!, line);
    }
    result.splice(index, 1);
    index -= 1;
  }
  return result;
}

function mergePair(existing: CostingBomLineDraft, incoming: CostingBomLineDraft): CostingBomLineDraft {
  const chosen = preferLine(existing, incoming);
  const other = chosen === incoming ? existing : incoming;
  return {
    ...chosen,
    confidence: CONFIDENCE_RANK[existing.confidence] <= CONFIDENCE_RANK[incoming.confidence]
      ? existing.confidence
      : incoming.confidence,
    lossRate: Math.max(existing.lossRate, incoming.lossRate),
    sourceRef: [...new Set([existing.sourceRef, incoming.sourceRef].filter(Boolean))].join(','),
    notes: appendNote(chosen.notes, other.notes),
    category: chosen.category === '其他' && other.category !== '其他' ? other.category : chosen.category,
    processOverrides: mergeProcessOverrides(chosen.processOverrides, other.processOverrides),
  };
}

/** 设计页「设计标准/设计规则-xxx」或「xxx规格/结构/厚度标准」占位，不是可计价物料。 */
export function isDesignStandardLine(
  line: Pick<CostingBomLineDraft, 'materialName' | 'qtyNet'>,
): boolean {
  if (line.qtyNet > 0) return false;
  const name = line.materialName.trim();
  if (/^设计(?:标准|规则)[-—]/u.test(name)) return true;
  if (/规格标准$|结构标准$|厚度标准$|板厚标准$/u.test(name)) return true;
  return false;
}

/** notes 页误输出的五金标准名，归一为标准价目名以便匹配与 enrich 补量。 */
function promoteStandardHardwarePlaceholder(line: CostingBomLineDraft): CostingBomLineDraft | null {
  if (line.qtyNet > 0) return null;
  const name = line.materialName.trim();
  if (/滑轨/.test(name) && /标准|规格/.test(name)) {
    return { ...line, materialName: '抽屉滑轨', category: '五金' };
  }
  if (/防倾倒/.test(name) && /标准|规格/.test(name)) {
    return { ...line, materialName: '防倾倒配件', category: '五金' };
  }
  return null;
}

export function sanitizeBomLines(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const cleaned: CostingBomLineDraft[] = [];
  for (const raw of absorbProcessMisnamedBoardRows(foldProfileHeightAnnotations(lines))) {
    if (isCoverGapRow(raw)) continue;
    if (isOverallSizeRow(raw)) continue;
    if (isDepartmentFooterRow(raw)) continue;
    if (isProfileDimensionAnnotation(raw)) continue;

    let line: CostingBomLineDraft = relabelSubstrateAndPart({ ...raw });
    const promotedHardware = promoteStandardHardwarePlaceholder(line);
    if (promotedHardware) line = promotedHardware;
    if (line.qtyNet > 0 && line.qtyNet < 0.01) {
      line = { ...line, qtyNet: 0, notes: appendNote(line.notes, '用量过小已清零') };
    }
    if (isEmptySubstrateHint(line) || isUnsizedFinishOrSubstrateHint(line)) continue;
    if (isCmfPlaceholderLine(line)) continue;
    if (isDrawerThicknessStandardLine(line)) continue;
    if (isDesignStandardLine(line)) continue;
    if (isProcessStandardLine(line)) continue;
    if (isHeightOnlyProfile(line) && line.qtyNet > 0) {
      line = {
        ...line,
        qtyNet: 0,
        origin: 'template',
        notes: appendNote(line.notes, `截面${line.spec}，长度未标注`),
      };
    }
    if (isBoardPanel(line) && line.unit.trim() === '米') {
      line = { ...line, unit: '张', notes: appendNote(line.notes, '板件单位已由米改为张') };
    }
    const canonical = canonicalMaterialName(line.materialName);
    if (canonical !== line.materialName) {
      line = { ...line, materialName: canonical };
    }
    const nextCategory = inferBomLineCategory(line.materialName, line.category);
    if (nextCategory !== line.category) {
      line = { ...line, category: nextCategory };
    }
    if ((line.category === '五金' || /防倾倒/.test(line.materialName)) && HARDWARE_COUNT_UNITS.test(line.unit)) {
      line = {
        ...line,
        category: '五金',
        unit: normalizeHardwareUnit(line.unit),
      };
    }
    cleaned.push(line);
  }

  const map = new Map<string, CostingBomLineDraft>();
  for (const line of cleaned) {
    const key = mergeKey(line);
    const existing = map.get(key);
    map.set(key, existing ? mergePair(existing, line) : line);
  }
  return absorbSubstrateCutRows([...map.values()]);
}
