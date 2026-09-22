import { costingBomLines, db } from '@scm/db';
import { and, eq, inArray, asc } from 'drizzle-orm';
import { calcQtyGross } from './bom-math.js';
import { canonicalMaterialName } from './category-rules.js';
import { buildExtractSnapshotFromDraft } from './extract-snapshot.js';
import type { CostingBomLineDraft } from './types.js';

function toRoundedBomQuantities(qtyNet: number, lossRate: number) {
  const roundedQtyNet = Number(String(Math.round(qtyNet * 10000) / 10000));
  const roundedLossRate = Number(String(Math.round(lossRate * 10000) / 10000));
  return {
    qtyNet: String(roundedQtyNet),
    lossRate: String(roundedLossRate),
    qtyGross: String(calcQtyGross(roundedQtyNet, roundedLossRate)),
  };
}

export type PreservedBomLineMeta = {
  id: string;
  unitPriceOverride: string | null;
  isManual: boolean;
  processOverrides: unknown;
  substrate: string | null;
  extractSnapshot: {
    materialName: string;
    spec: string | null;
    qtyNet: number;
    origin: string;
    sourceRef: string | null;
  } | null;
};

function preferPreservedMeta(left: PreservedBomLineMeta, right: PreservedBomLineMeta): PreservedBomLineMeta {
  if (left.isManual !== right.isManual) return left.isManual ? right : left;
  const leftQty = left.extractSnapshot?.qtyNet ?? 0;
  const rightQty = right.extractSnapshot?.qtyNet ?? 0;
  if (leftQty !== rightQty) return leftQty > rightQty ? left : right;
  const leftSpec = left.extractSnapshot?.spec?.trim().length ?? 0;
  const rightSpec = right.extractSnapshot?.spec?.trim().length ?? 0;
  return leftSpec >= rightSpec ? left : right;
}

export function indexBomLinesByMaterialName(
  lines: Array<{
    id: string;
    materialName: string;
    unitPriceOverride: string | null;
    isManual: boolean;
    processOverrides: unknown;
    substrate: string | null;
    extractSnapshot: PreservedBomLineMeta['extractSnapshot'];
  }>,
): Map<string, PreservedBomLineMeta> {
  const map = new Map<string, PreservedBomLineMeta>();
  for (const line of lines) {
    const key = canonicalMaterialName(line.materialName);
    const meta: PreservedBomLineMeta = {
      id: line.id,
      unitPriceOverride: line.unitPriceOverride,
      isManual: line.isManual,
      processOverrides: line.processOverrides ?? {},
      substrate: line.substrate ?? null,
      extractSnapshot: line.extractSnapshot ?? null,
    };
    const prev = map.get(key);
    map.set(key, prev ? preferPreservedMeta(prev, meta) : meta);
  }
  return map;
}

function preferDraft(existing: CostingBomLineDraft, incoming: CostingBomLineDraft): CostingBomLineDraft {
  if (incoming.qtyNet > existing.qtyNet) return incoming;
  if (existing.qtyNet > incoming.qtyNet) return existing;
  if (incoming.spec.trim().length > existing.spec.trim().length) return incoming;
  if (existing.spec.trim().length > incoming.spec.trim().length) return existing;
  return incoming.origin === 'explicit' ? incoming : existing;
}

/** Collapse duplicate material names in draft output (e.g. two 抽屉滑轨 rows). */
export function dedupeDraftsByMaterialName(drafts: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const chosen = new Map<string, CostingBomLineDraft>();
  for (const draft of drafts) {
    const key = canonicalMaterialName(draft.materialName);
    const prev = chosen.get(key);
    chosen.set(key, prev ? preferDraft(prev, draft) : draft);
  }
  const seen = new Set<string>();
  const result: CostingBomLineDraft[] = [];
  for (const draft of drafts) {
    const key = canonicalMaterialName(draft.materialName);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(chosen.get(key)!);
  }
  return result;
}

type Tx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** Replace project BOM rows while reusing stable ids per material name when possible. */
export async function replaceProjectBomDrafts(
  tx: Tx,
  projectId: string,
  drafts: CostingBomLineDraft[],
  opts?: {
    onlyReplaceNonManual?: boolean;
    clearNonManualOverrides?: boolean;
    /** 生成开料时保留首次识别的 extractSnapshot，便于下次回退基线。 */
    preserveExtractSnapshot?: boolean;
    buildInsert?: (
      draft: CostingBomLineDraft,
      index: number,
      keep: PreservedBomLineMeta | undefined,
    ) => typeof costingBomLines.$inferInsert;
  },
): Promise<void> {
  drafts = dedupeDraftsByMaterialName(drafts);

  const existing = await tx
    .select({
      id: costingBomLines.id,
      materialName: costingBomLines.materialName,
      isManual: costingBomLines.isManual,
      unitPriceOverride: costingBomLines.unitPriceOverride,
      processOverrides: costingBomLines.processOverrides,
      substrate: costingBomLines.substrate,
      extractSnapshot: costingBomLines.extractSnapshot,
    })
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, projectId));

  const indexed = indexBomLinesByMaterialName(existing);
  const nextKeys = new Set(drafts.map((draft) => canonicalMaterialName(draft.materialName)));
  const removableIds = existing
    .filter((line) => {
      if (opts?.onlyReplaceNonManual && line.isManual) return false;
      return !nextKeys.has(canonicalMaterialName(line.materialName));
    })
    .map((line) => line.id);

  if (removableIds.length) {
    await tx.delete(costingBomLines).where(inArray(costingBomLines.id, removableIds));
  }

  const defaultBuild = (
    draft: CostingBomLineDraft,
    index: number,
    keep: PreservedBomLineMeta | undefined,
  ): typeof costingBomLines.$inferInsert => {
    const qty = toRoundedBomQuantities(draft.qtyNet, draft.lossRate);
    const manual = keep?.isManual ?? false;
    const clearOverride = opts?.clearNonManualOverrides && !manual;
    return {
      projectId,
      lineNo: index + 1,
      category: draft.category,
      materialName: draft.materialName,
      spec: draft.spec || null,
      unit: draft.unit,
      ...qty,
      sourceRef: draft.sourceRef || null,
      confidence: draft.confidence,
      notes: draft.notes || null,
      origin: draft.origin,
      isManual: manual,
      unitPriceOverride: clearOverride ? null : keep?.unitPriceOverride ?? null,
      processOverrides: draft.processOverrides ?? keep?.processOverrides ?? {},
      substrate: draft.substrate?.trim() || keep?.substrate || null,
      priceBookId: null,
      matchStatus: 'unmatched' as const,
      extractSnapshot: manual
        ? keep?.extractSnapshot ?? null
        : opts?.preserveExtractSnapshot
          ? keep?.extractSnapshot ?? buildExtractSnapshotFromDraft(draft)
          : buildExtractSnapshotFromDraft(draft),
    };
  };

  const build = opts?.buildInsert ?? defaultBuild;
  const keptIdByKey = new Map<string, string>();

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    const key = canonicalMaterialName(draft.materialName);
    const keep = indexed.get(key);
    const values = build(draft, index, keep);
    if (keep) {
      keptIdByKey.set(key, keep.id);
      if (!opts?.onlyReplaceNonManual || !keep.isManual) {
        await tx
          .update(costingBomLines)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(costingBomLines.id, keep.id), eq(costingBomLines.projectId, projectId)));
      }
    } else {
      const inserted = await tx
        .insert(costingBomLines)
        .values(values)
        .returning({ id: costingBomLines.id });
      const newId = inserted[0]?.id;
      if (newId) {
        keptIdByKey.set(key, newId);
        indexed.set(key, {
          id: newId,
          unitPriceOverride: null,
          isManual: false,
          processOverrides: {},
          substrate: draft.substrate?.trim() || null,
          extractSnapshot: null,
        });
      }
    }
  }

  const orphanIds = existing
    .filter((line) => {
      const key = canonicalMaterialName(line.materialName);
      if (!nextKeys.has(key)) return false;
      const keptId = keptIdByKey.get(key);
      if (!keptId || line.id === keptId) return false;
      return true;
    })
    .map((line) => line.id);
  if (orphanIds.length) {
    await tx.delete(costingBomLines).where(inArray(costingBomLines.id, orphanIds));
  }

  const ordered = await tx
    .select({ id: costingBomLines.id })
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, projectId))
    .orderBy(asc(costingBomLines.lineNo), asc(costingBomLines.id));
  for (let index = 0; index < ordered.length; index += 1) {
    await tx
      .update(costingBomLines)
      .set({ lineNo: index + 1, updatedAt: new Date() })
      .where(eq(costingBomLines.id, ordered[index]!.id));
  }
}

export function hasConfirmedPanelThickness(facts: {
  carcassThicknessMm?: number | null;
  sideThicknessMm?: number | null;
  backThicknessMm?: number | null;
  bottomThicknessMm?: number | null;
  drawerBottomThicknessMm?: number | null;
}): boolean {
  return [
    facts.carcassThicknessMm,
    facts.sideThicknessMm,
    facts.backThicknessMm,
    facts.bottomThicknessMm,
    facts.drawerBottomThicknessMm,
  ].some((value) => typeof value === 'number' && Number.isFinite(value));
}
