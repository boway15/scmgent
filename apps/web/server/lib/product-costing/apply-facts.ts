import { applyLineSubstrates } from './board-usage.js';
import { applyCategoryTemplate } from './category-template.js';
import { canonicalMaterialName } from './category-rules.js';
import { enrichBomFromProductFacts, type ProductFacts } from './enrich-bom-from-facts.js';
import { inferAntiTipSeen, inferDrawerSlideSpec } from './infer-hardware-spec.js';
import {
  ensureAntiTipKit,
  ensureDrawerSlides,
  ensureScrewPack,
  upsertHardwareFacts,
  type HardwareFact,
} from './hardware-facts.js';
import { mergeSameNameLines, pruneRedundantTemplateLines } from './merge-lines.js';
import { mergePackProfile, type PackProfile } from './pack-profile.js';
import { upsertPackagingLines } from './packaging-facts.js';
import { applyInferredProcessOverrides } from './infer-process-overrides.js';
import { parseBoardSpec } from './parse-board-spec.js';
import { resolveOverallSize } from './parse-overall-size.js';
import { sanitizeBomLines } from './sanitize-bom-lines.js';
import type { ExtractSnapshot } from './extract-snapshot.js';
import { parseProcessOverrides } from './board-sheet.js';
import type { BomConfidence, CostingBomLineDraft } from './types.js';

export type ApplyFactsSourceLine = {
  category: string;
  materialName: string;
  spec: string | null;
  unit: string;
  qtyNet: string | number;
  lossRate: string | number;
  sourceRef: string | null;
  confidence: BomConfidence;
  origin: string;
  notes: string | null;
  substrate: string | null;
  processOverrides: unknown;
  isManual: boolean;
  extractSnapshot: ExtractSnapshot | null;
};

function isPriorApplyGeneratedLine(line: Pick<ApplyFactsSourceLine, 'origin' | 'notes' | 'category' | 'materialName'>) {
  if (line.origin === 'template') return true;
  if ((line.notes ?? '').includes('由结构关系推算')) return true;
  if (line.category === '包装') return true;
  if (line.materialName.trim() === '螺丝包') return true;
  return false;
}

function toDraftFromSource(line: ApplyFactsSourceLine): CostingBomLineDraft {
  return {
    category: line.category,
    materialName: line.materialName,
    spec: line.spec ?? '',
    unit: line.unit,
    qtyNet: Number(line.qtyNet),
    lossRate: Number(line.lossRate),
    sourceRef: line.sourceRef ?? '',
    confidence: line.confidence,
    origin: line.origin === 'template' ? 'template' : 'explicit',
    notes: line.notes ?? '',
    substrate: line.substrate ?? null,
    processOverrides: parseProcessOverrides(line.processOverrides),
  };
}

/** 生成开料前：去掉上次规则开料/包装行，非手工行回退到 extractSnapshot 基线。 */
export function prepareBomLinesForApplyFacts(lines: ApplyFactsSourceLine[]): CostingBomLineDraft[] {
  const reverted = lines
    .filter((line) => line.isManual || !isPriorApplyGeneratedLine(line))
    .map((line) => {
      if (line.isManual) return toDraftFromSource(line);
      const snap = line.extractSnapshot;
      if (!snap) return toDraftFromSource(line);
      return {
        category: line.category,
        materialName: snap.materialName,
        spec: snap.spec ?? '',
        unit: line.unit,
        qtyNet: snap.qtyNet,
        lossRate: Number(line.lossRate),
        sourceRef: snap.sourceRef ?? '',
        confidence: line.confidence,
        origin: snap.origin === 'template' ? 'template' : 'explicit',
        notes: '',
        substrate: line.substrate ?? null,
        processOverrides: parseProcessOverrides(line.processOverrides),
      };
    });
  return sanitizeBomLines(reverted);
}

export type ApplyFactsInput = ProductFacts & {
  hardwareFacts?: HardwareFact[];
  packProfile?: PackProfile | null;
  /** PPT 分页 OCR 文本，用于补全滑轨规格与防倾倒 */
  pageTexts?: string[];
};

function confirmedBrief(facts: ApplyFactsInput): string {
  return [
    facts.structureSummary?.trim() ? `结构：${facts.structureSummary.trim()}` : '',
    facts.designPrinciples?.trim() ? `原则：${facts.designPrinciples.trim()}` : '',
  ]
    .filter(Boolean)
    .join('；')
    .slice(0, 240);
}

/** 保留 apply 流水线意外丢掉的已识别 explicit 板件行，避免 replace 时删库。 */
export function preserveMissingExplicitBoardLines(
  source: CostingBomLineDraft[],
  next: CostingBomLineDraft[],
): CostingBomLineDraft[] {
  const nextKeys = new Set(next.map((line) => canonicalMaterialName(line.materialName)));
  const missing = source.filter((line) => {
    if (nextKeys.has(canonicalMaterialName(line.materialName))) return false;
    if (line.origin !== 'explicit' || !(line.qtyNet > 0)) return false;
    return Boolean(parseBoardSpec(line.spec).size);
  });
  return missing.length ? [...next, ...missing] : next;
}

export function attachConfirmedDesignNotes(
  lines: CostingBomLineDraft[],
  facts: ApplyFactsInput,
): CostingBomLineDraft[] {
  const brief = confirmedBrief(facts);
  if (!brief) return lines;
  return lines.map((line) => {
    const fromStructure =
      line.origin === 'template' || line.notes.includes('由结构关系推算');
    if (!fromStructure || line.notes.includes('按已确认结构设计')) return line;
    return {
      ...line,
      notes: [line.notes, `按已确认结构设计：${brief}`].filter(Boolean).join('；'),
    };
  });
}

export function applyFactsToLines(
  lines: CostingBomLineDraft[],
  facts: ApplyFactsInput,
): CostingBomLineDraft[] {
  const resolvedFacts: ApplyFactsInput = {
    ...facts,
    overallSize: resolveOverallSize({
      pageOverallSize: facts.overallSize,
      structureSummary: facts.structureSummary,
      designPrinciples: facts.designPrinciples,
      bomLineTexts: lines.map((line) => `${line.materialName} ${line.spec} ${line.notes}`),
    }),
  };
  const sanitized = sanitizeBomLines(lines);
  const templated = applyCategoryTemplate(resolvedFacts.category, sanitized, {
    overallSize: resolvedFacts.overallSize,
  });
  const enriched = enrichBomFromProductFacts(templated, resolvedFacts);
  const withProcess = applyInferredProcessOverrides(enriched, resolvedFacts);
  const withBrief = attachConfirmedDesignNotes(withProcess, resolvedFacts);
  const withHardware = upsertHardwareFacts(withBrief, resolvedFacts.hardwareFacts ?? []);
  const docTexts = [
    resolvedFacts.designPrinciples,
    resolvedFacts.structureSummary,
    ...(resolvedFacts.pageTexts ?? []),
  ];
  const slideSpecHint = inferDrawerSlideSpec([
    ...docTexts,
    ...sanitized.map((line) => `${line.materialName} ${line.spec}`),
  ]);
  const withSlides = ensureDrawerSlides(withHardware, {
    drawerCount: resolvedFacts.drawerCount,
    category: resolvedFacts.category,
    slideSpecHint,
  });
  const withAntiTip = ensureAntiTipKit(withSlides, {
    category: resolvedFacts.category,
    seenInDoc: inferAntiTipSeen(docTexts),
  });
  const finalized = applyLineSubstrates(
    pruneRedundantTemplateLines(
      mergeSameNameLines(
        upsertPackagingLines(
          ensureScrewPack(withAntiTip),
          resolvedFacts.overallSize,
          resolvedFacts.packProfile,
        ),
        resolvedFacts.category,
      ),
      resolvedFacts.category,
    ),
    resolvedFacts.defaultSubstrate,
  );
  return preserveMissingExplicitBoardLines(sanitized, finalized);
}
