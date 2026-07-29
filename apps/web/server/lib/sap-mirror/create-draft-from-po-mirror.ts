import { and, eq } from 'drizzle-orm';
import { db, purchaseDrafts, sapPoMirrorLines, sapPoMirrors } from '@scm/db';
import { SAP_SOURCE_SYSTEM } from './types.js';

export type PoMirrorLineForDraft = {
  id: string;
  externalLineId: string;
  skuId: string | null;
  qty: number | null;
  deliveryDate: string | null;
};

export type PoMirrorForDraft = {
  id: string;
  sourceSystem: string;
  externalId: string;
  externalVersion: string | null;
  poNumber: string | null;
  lines: PoMirrorLineForDraft[];
};

export type CreateDraftFromPoMirrorLineResult =
  | { lineId: string; draftId: string; draftNo: string; action: 'created' }
  | { lineId: string; draftId: string; draftNo: string; action: 'existing' }
  | { lineId: string; reason: string; action: 'skipped' };

export type CreateDraftFromPoMirrorResult = {
  mirrorId: string;
  poExternalId: string;
  lines: CreateDraftFromPoMirrorLineResult[];
  /** Drafts stay unassigned (no planItemId) so they do not enter position buckets. */
  positionExcluded: true;
};

export interface PoMirrorDraftStore {
  findMirrorById(mirrorId: string): Promise<PoMirrorForDraft | null>;
  findDraftByExternal(
    sourceSystem: string,
    externalId: string,
  ): Promise<{ id: string; draftNo: string } | null>;
  insertDraft(input: {
    skuId: string;
    qty: number;
    expectedDate?: string | null;
    sourceSystem: string;
    externalId: string;
    externalVersion?: string | null;
    sourceRefId: string;
    remark: string;
    createdBy: string;
  }): Promise<{ id: string; draftNo: string }>;
}

export function buildPoMirrorDraftExternalId(
  sourceSystem: string,
  poExternalId: string,
  lineExternalId: string,
): string {
  return `${sourceSystem}:${poExternalId}:${lineExternalId}`;
}

function nextDraftNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString().slice(-6)}`;
}

export async function createDraftsFromPoMirror(
  params: { mirrorId: string; createdBy: string },
  store: PoMirrorDraftStore = createDbPoMirrorDraftStore(),
): Promise<CreateDraftFromPoMirrorResult | null> {
  const mirror = await store.findMirrorById(params.mirrorId);
  if (!mirror) return null;

  const lines: CreateDraftFromPoMirrorLineResult[] = [];
  const poLabel = mirror.poNumber ?? mirror.externalId;

  for (const line of mirror.lines) {
    if (!line.skuId) {
      lines.push({
        lineId: line.externalLineId,
        action: 'skipped',
        reason: 'skuId not resolved on mirror line',
      });
      continue;
    }

    const qty = line.qty ?? 0;
    if (qty <= 0) {
      lines.push({
        lineId: line.externalLineId,
        action: 'skipped',
        reason: 'qty must be positive',
      });
      continue;
    }

    const draftExternalId = buildPoMirrorDraftExternalId(
      mirror.sourceSystem,
      mirror.externalId,
      line.externalLineId,
    );

    const existing = await store.findDraftByExternal(mirror.sourceSystem, draftExternalId);
    if (existing) {
      lines.push({
        lineId: line.externalLineId,
        draftId: existing.id,
        draftNo: existing.draftNo,
        action: 'existing',
      });
      continue;
    }

    const inserted = await store.insertDraft({
      skuId: line.skuId,
      qty,
      expectedDate: line.deliveryDate,
      sourceSystem: mirror.sourceSystem,
      externalId: draftExternalId,
      externalVersion: mirror.externalVersion,
      sourceRefId: line.id,
      remark: `SAP PO mirror ${poLabel} line ${line.externalLineId}`,
      createdBy: params.createdBy,
    });

    lines.push({
      lineId: line.externalLineId,
      draftId: inserted.id,
      draftNo: inserted.draftNo,
      action: 'created',
    });
  }

  return {
    mirrorId: mirror.id,
    poExternalId: mirror.externalId,
    lines,
    positionExcluded: true,
  };
}

export function createDbPoMirrorDraftStore(database: typeof db = db): PoMirrorDraftStore {
  return {
    async findMirrorById(mirrorId) {
      const [mirror] = await database
        .select({
          id: sapPoMirrors.id,
          sourceSystem: sapPoMirrors.sourceSystem,
          externalId: sapPoMirrors.externalId,
          externalVersion: sapPoMirrors.externalVersion,
          poNumber: sapPoMirrors.poNumber,
        })
        .from(sapPoMirrors)
        .where(eq(sapPoMirrors.id, mirrorId))
        .limit(1);

      if (!mirror) return null;

      const lines = await database
        .select({
          id: sapPoMirrorLines.id,
          externalLineId: sapPoMirrorLines.externalLineId,
          skuId: sapPoMirrorLines.skuId,
          qty: sapPoMirrorLines.qty,
          deliveryDate: sapPoMirrorLines.deliveryDate,
        })
        .from(sapPoMirrorLines)
        .where(eq(sapPoMirrorLines.mirrorId, mirrorId));

      return { ...mirror, lines };
    },

    async findDraftByExternal(sourceSystem, externalId) {
      const [row] = await database
        .select({ id: purchaseDrafts.id, draftNo: purchaseDrafts.draftNo })
        .from(purchaseDrafts)
        .where(
          and(
            eq(purchaseDrafts.sourceSystem, sourceSystem),
            eq(purchaseDrafts.externalId, externalId),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async insertDraft(input) {
      const syncedAt = new Date();
      const [row] = await database
        .insert(purchaseDrafts)
        .values({
          draftNo: nextDraftNo(),
          skuId: input.skuId,
          qty: input.qty,
          expectedDate: input.expectedDate ?? undefined,
          source: 'manual',
          sourceRefId: input.sourceRefId,
          status: 'draft',
          receivedQty: 0,
          sourceSystem: input.sourceSystem,
          externalId: input.externalId,
          externalVersion: input.externalVersion ?? undefined,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          remark: input.remark,
          createdBy: input.createdBy,
        })
        .returning({ id: purchaseDrafts.id, draftNo: purchaseDrafts.draftNo });
      if (!row) throw new Error('failed to insert purchase draft');
      return row;
    },
  };
}

type MemoryDraft = {
  id: string;
  draftNo: string;
  sourceSystem: string;
  externalId: string;
  skuId: string;
  qty: number;
  status: string;
  planItemId: string | null;
  expectedDate: string | null;
  remark: string;
  createdBy: string;
};

export function createMemoryPoMirrorDraftStore(seed?: {
  mirrors?: PoMirrorForDraft[];
  drafts?: MemoryDraft[];
}): PoMirrorDraftStore & { drafts: MemoryDraft[] } {
  const mirrors = new Map((seed?.mirrors ?? []).map((mirror) => [mirror.id, mirror]));
  const drafts: MemoryDraft[] = [...(seed?.drafts ?? [])];
  let seq = 1;

  return {
    drafts,

    async findMirrorById(mirrorId) {
      return mirrors.get(mirrorId) ?? null;
    },

    async findDraftByExternal(sourceSystem, externalId) {
      const row = drafts.find(
        (draft) => draft.sourceSystem === sourceSystem && draft.externalId === externalId,
      );
      return row ? { id: row.id, draftNo: row.draftNo } : null;
    },

    async insertDraft(input) {
      const row: MemoryDraft = {
        id: `draft-${seq++}`,
        draftNo: `PO-MEM-${seq}`,
        sourceSystem: input.sourceSystem,
        externalId: input.externalId,
        skuId: input.skuId,
        qty: input.qty,
        status: 'draft',
        planItemId: null,
        expectedDate: input.expectedDate ?? null,
        remark: input.remark,
        createdBy: input.createdBy,
      };
      drafts.push(row);
      return { id: row.id, draftNo: row.draftNo };
    },
  };
}
