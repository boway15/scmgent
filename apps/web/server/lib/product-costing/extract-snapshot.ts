import type { CostingBomLineDraft } from './types.js';

export type ExtractSnapshot = {
  materialName: string;
  spec: string | null;
  qtyNet: number;
  origin: string;
  sourceRef: string | null;
};

export function buildExtractSnapshotFromDraft(draft: CostingBomLineDraft): ExtractSnapshot {
  return {
    materialName: draft.materialName.trim(),
    spec: draft.spec?.trim() || null,
    qtyNet: draft.qtyNet,
    origin: draft.origin,
    sourceRef: draft.sourceRef?.trim() || null,
  };
}

export function buildExtractSnapshotFromRow(row: {
  materialName: string;
  spec: string | null;
  qtyNet: string | number;
  origin: string;
  sourceRef: string | null;
}): ExtractSnapshot {
  return {
    materialName: row.materialName.trim(),
    spec: row.spec?.trim() || null,
    qtyNet: Number(row.qtyNet),
    origin: row.origin,
    sourceRef: row.sourceRef?.trim() || null,
  };
}

export function snapshotDiffText(
  snapshot: ExtractSnapshot | null | undefined,
  current: { materialName: string; spec: string | null; qtyNet: string | number },
): string | null {
  if (!snapshot) return null;
  const parts: string[] = [];
  if (snapshot.materialName !== current.materialName.trim()) {
    parts.push(`原名 ${snapshot.materialName}`);
  }
  const currentSpec = current.spec?.trim() || '';
  if ((snapshot.spec ?? '') !== currentSpec) {
    parts.push(`原规格 ${snapshot.spec ?? '—'}`);
  }
  if (snapshot.qtyNet !== Number(current.qtyNet)) {
    parts.push(`原用量 ${snapshot.qtyNet}`);
  }
  return parts.length ? parts.join('；') : null;
}
