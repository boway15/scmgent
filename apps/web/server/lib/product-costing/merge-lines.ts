import type { BomConfidence, CostingBomLineDraft } from './types.js';
import { canonicalMaterialName, getRuleFamilyId } from './category-rules.js';
import { applyCategoryTemplate } from './category-template.js';
import { promoteExtractedStructureLines, type ProductFacts } from './enrich-bom-from-facts.js';
import type { HardwareFact } from './hardware-facts.js';
import { ensureScrewPack, isScrewPack } from './hardware-facts.js';
import { parseBoardSpec } from './parse-board-spec.js';
import { mergeProcessOverrides } from './process-bom-lines.js';
import { sanitizeBomLines } from './sanitize-bom-lines.js';

const CONFIDENCE_RANK: Record<BomConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function betterConfidence(a: BomConfidence, b: BomConfidence): BomConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

const HARDWARE_COUNT_UNITS = /^(套|个|只|件|副)$/;

function normalizeMergeUnit(line: CostingBomLineDraft): string {
  const unit = line.unit.trim().toLowerCase();
  if (line.category === '五金' || /防倾倒/.test(line.materialName)) {
    return HARDWARE_COUNT_UNITS.test(line.unit.trim()) ? '套' : unit;
  }
  return unit;
}

function partMergeKey(name: string, category?: string | null): string {
  const canonical = canonicalMaterialName(name).trim().toLowerCase();
  const family = getRuleFamilyId(category);
  if (family === 'chest') {
    if (/桌面板|^盖板$|^顶板$/.test(canonical) || canonical.includes('顶底')) return '顶底板';
  }
  if (family === 'desk' && /桌面板|^桌面$/.test(canonical)) return '桌面';
  if (family === 'vanity' && /桌面板|^台面$/.test(canonical)) return '台面';
  return canonical;
}

function mergeKey(line: CostingBomLineDraft): string {
  return [
    canonicalMaterialName(line.materialName).trim().toLowerCase(),
    line.spec.trim().toLowerCase(),
    normalizeMergeUnit(line),
  ].join('\u0001');
}

function preferLine(existing: CostingBomLineDraft, incoming: CostingBomLineDraft): CostingBomLineDraft {
  const existingRank = CONFIDENCE_RANK[existing.confidence];
  const incomingRank = CONFIDENCE_RANK[incoming.confidence];
  if (incomingRank < existingRank) return incoming;
  if (incomingRank > existingRank) return existing;
  if (incoming.qtyNet > 0 && existing.qtyNet === 0) return incoming;
  if (existing.qtyNet > 0 && incoming.qtyNet === 0) return existing;
  if (incoming.qtyNet > existing.qtyNet) return incoming;
  return existing;
}

function mergeNotes(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing}; ${incoming}`;
}

function normalizeCutSize(size: string): string | null {
  const match = size.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const a = Math.round(Number(match[1]));
  const b = Math.round(Number(match[2]));
  if (!(a > 0) || !(b > 0)) return null;
  return `${Math.max(a, b)}×${Math.min(a, b)}`;
}

function cutSizeKey(line: CostingBomLineDraft): string | null {
  const parsed = parseBoardSpec(line.spec);
  if (!parsed.size) return null;
  return normalizeCutSize(parsed.size);
}

function mergeBoardSpecs(primary: string, secondary: string): string {
  const left = parseBoardSpec(primary);
  const right = parseBoardSpec(secondary);
  const thickness = left.thickness || right.thickness;
  const size = left.size || right.size;
  return [thickness, size].filter(Boolean).join(' ').trim() || primary.trim() || secondary.trim();
}

function foldSameNameRows(group: CostingBomLineDraft[]): CostingBomLineDraft {
  return group.reduce((keep, incoming) => {
    const chosen = preferLine(keep, incoming);
    const other = chosen === incoming ? keep : incoming;
    return {
      ...chosen,
      materialName: canonicalMaterialName(chosen.materialName),
      spec: mergeBoardSpecs(chosen.spec, other.spec) || chosen.spec.trim() || other.spec,
      unit: chosen.qtyNet > 0 ? chosen.unit : other.unit || chosen.unit,
      qtyNet: Math.max(keep.qtyNet, incoming.qtyNet),
      confidence: betterConfidence(keep.confidence, incoming.confidence),
      lossRate: Math.max(keep.lossRate, incoming.lossRate),
      sourceRef: [...new Set([keep.sourceRef, incoming.sourceRef].filter(Boolean))].join(','),
      notes: mergeNotes(chosen.notes, other.notes),
      origin: keep.origin === 'explicit' || incoming.origin === 'explicit' ? 'explicit' : chosen.origin,
      category: chosen.category === '其他' && other.category !== '其他' ? other.category : chosen.category,
      substrate: chosen.substrate?.trim() || other.substrate?.trim() || chosen.substrate,
      processOverrides: mergeProcessOverrides(chosen.processOverrides, other.processOverrides),
    };
  });
}

/** Merge template rows (no cut size) into an explicit same-name row from size/explosion pages. */
export function mergeSameNameLines(
  lines: CostingBomLineDraft[],
  category?: string | null,
): CostingBomLineDraft[] {
  const groups = new Map<string, CostingBomLineDraft[]>();
  for (const line of lines) {
    const key = partMergeKey(line.materialName, category);
    const bucket = groups.get(key) ?? [];
    bucket.push(line);
    groups.set(key, bucket);
  }

  const merged: CostingBomLineDraft[] = [];
  for (const [key, group] of groups) {
    const named = group.map((line) =>
      key === '顶底板' || key === '桌面' || key === '台面' ? { ...line, materialName: key } : line,
    );
    if (named.length === 1) {
      merged.push(named[0]!);
      continue;
    }
    if (isScrewPack(named[0]!.materialName)) {
      merged.push(foldSameNameRows(named.map((line) => ({ ...line, qtyNet: 1, lossRate: 0, unit: line.unit || '包' }))));
      continue;
    }
    const sized = named.filter((line) => cutSizeKey(line));
    const unsized = named.filter((line) => !cutSizeKey(line));
    if (sized.length === 0) {
      merged.push(foldSameNameRows(named));
      continue;
    }
    const byCut = new Map<string, CostingBomLineDraft[]>();
    for (const line of sized) {
      const cutKey = cutSizeKey(line)!;
      byCut.set(cutKey, [...(byCut.get(cutKey) ?? []), line]);
    }
    const cutRows = [...byCut.values()].map((cutGroup) => foldSameNameRows(cutGroup));
    const keptCuts = cutRows.filter((row) => row.qtyNet > 0);
    const emptyCuts = cutRows.filter((row) => row.qtyNet <= 0);
    const primaryCuts = keptCuts.length ? keptCuts : [foldSameNameRows(emptyCuts.length ? emptyCuts : cutRows)];
    if (unsized.length === 0) {
      merged.push(...primaryCuts);
      continue;
    }
    const preferred = primaryCuts.reduce((keep, row) => preferLine(keep, row));
    merged.push(
      ...primaryCuts.map((row) => (row === preferred ? foldSameNameRows([row, ...unsized]) : row)),
    );
  }
  return merged;
}

/** Drop qty-0 template placeholders when the same structure part already has size or用量. */
export function pruneRedundantTemplateLines(
  lines: CostingBomLineDraft[],
  category?: string | null,
): CostingBomLineDraft[] {
  const groups = new Map<string, CostingBomLineDraft[]>();
  for (const line of lines) {
    const key = partMergeKey(line.materialName, category);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const kept: CostingBomLineDraft[] = [];
  for (const group of groups.values()) {
    const hasFilled = group.some((line) => line.qtyNet > 0 || cutSizeKey(line));
    if (!hasFilled) {
      kept.push(...group);
      continue;
    }
    kept.push(
      ...group.filter(
        (line) => line.origin !== 'template' || line.qtyNet > 0 || Boolean(cutSizeKey(line)),
      ),
    );
  }
  return kept;
}

/** Cross-page duplicates keep the higher-confidence row; quantities are not summed. */
export function mergeBomLines(batches: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const map = new Map<string, CostingBomLineDraft>();
  for (const line of batches) {
    const key = mergeKey(line);
    const incoming: CostingBomLineDraft = { ...line, origin: line.origin ?? 'explicit' };
    const existing = map.get(key);
    if (!existing) {
      map.set(key, incoming);
      continue;
    }
    const chosen = preferLine(existing, incoming);
    const other = chosen === incoming ? existing : incoming;
    map.set(key, {
      ...chosen,
      materialName: canonicalMaterialName(chosen.materialName),
      confidence: betterConfidence(existing.confidence, incoming.confidence),
      lossRate: Math.max(existing.lossRate, incoming.lossRate),
      sourceRef: [...new Set([existing.sourceRef, incoming.sourceRef].filter(Boolean))].join(','),
      notes: mergeNotes(chosen.notes, other.notes),
      category: chosen.category || other.category,
    });
  }
  return [...map.values()];
}

export function finalizeExtractedLines(
  category: string | null | undefined,
  drafts: CostingBomLineDraft[],
  facts?: ProductFacts & { hardwareFacts?: HardwareFact[] },
): CostingBomLineDraft[] {
  const mergedDrafts = mergeBomLines(drafts);
  const sanitized = sanitizeBomLines(mergedDrafts);
  const promoted = promoteExtractedStructureLines(sanitized, facts);
  const templated = applyCategoryTemplate(category, promoted, facts);
  const merged = mergeSameNameLines(templated, category);
  return ensureScrewPack(pruneRedundantTemplateLines(merged, category));
}
