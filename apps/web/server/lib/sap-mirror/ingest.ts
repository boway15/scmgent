import { and, eq } from 'drizzle-orm';
import {
  db,
  merchants,
  sapPoMirrorLines,
  sapPoMirrors,
  sapSyncRuns,
  skus,
  type SapMirrorEntityType,
  type SapSyncRunStatus,
} from '@scm/db';
import { mapSapVendorToMerchant } from './map-merchant.js';
import { mapSapMaterialToSku } from './map-sku.js';
import { mapSapPurchaseOrderToMirror } from './map-po.js';
import {
  SAP_SOURCE_SYSTEM,
  type SapMirrorIngestResult,
  type SapMerchantMapped,
  type SapSkuMapped,
  type SapVendorInput,
  type SapMaterialInput,
  type SapPurchaseOrderInput,
} from './types.js';

export type SapMirrorIngestBatchInput = {
  entityType: SapMirrorEntityType;
  items: unknown[];
  userId?: string | null;
};

type IngestCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ externalId?: string; message: string }>;
};

export type MerchantRecord = {
  id: string;
  sourceSystem: string | null;
  externalId: string | null;
  code: string;
  name: string;
  unit?: never;
  externalVersion?: string | null;
  syncStatus?: string | null;
};

export type SkuRecord = {
  id: string;
  sourceSystem: string | null;
  externalId: string | null;
  code: string;
  name: string;
  unit: string;
  externalVersion?: string | null;
  syncStatus?: string | null;
};

export type PoMirrorRecord = {
  id: string;
  sourceSystem: string;
  externalId: string;
  externalVersion?: string | null;
  poNumber?: string | null;
  vendorExternalId?: string | null;
  merchantCode?: string | null;
  orderDate?: string | null;
  statusRaw?: string | null;
  payload?: Record<string, unknown> | null;
  syncStatus?: string | null;
};

export type PoMirrorLineRecord = {
  id: string;
  mirrorId: string;
  externalLineId: string;
  skuExternalId?: string | null;
  skuId?: string | null;
  qty?: number | null;
  uom?: string | null;
  deliveryDate?: string | null;
  payload?: Record<string, unknown> | null;
};

export interface SapMirrorIngestStore {
  createSyncRun(input: {
    entityType: SapMirrorEntityType;
    userId?: string | null;
    startedAt: Date;
  }): Promise<{ id: string }>;
  finishSyncRun(
    runId: string,
    input: {
      status: SapSyncRunStatus;
      finishedAt: Date;
      summary: IngestCounts;
      errorMessage?: string;
    },
  ): Promise<void>;
  findMerchantByExternal(
    sourceSystem: string,
    externalId: string,
  ): Promise<MerchantRecord | undefined>;
  findMerchantByCode(code: string): Promise<MerchantRecord | undefined>;
  insertMerchant(input: {
    mapped: SapMerchantMapped;
    syncedAt: Date;
  }): Promise<MerchantRecord>;
  updateMerchant(
    id: string,
    input: { mapped: SapMerchantMapped; syncedAt: Date },
  ): Promise<void>;
  findSkuByExternal(sourceSystem: string, externalId: string): Promise<SkuRecord | undefined>;
  findSkuByCode(code: string): Promise<SkuRecord | undefined>;
  insertSku(input: { mapped: SapSkuMapped; syncedAt: Date }): Promise<SkuRecord>;
  updateSku(id: string, input: { mapped: SapSkuMapped; syncedAt: Date }): Promise<void>;
  findPoMirrorByExternal(
    sourceSystem: string,
    externalId: string,
  ): Promise<PoMirrorRecord | undefined>;
  insertPoMirror(input: {
    head: ReturnType<typeof mapSapPurchaseOrderToMirror>['head'];
    merchantCode?: string;
    syncedAt: Date;
  }): Promise<PoMirrorRecord>;
  updatePoMirror(
    id: string,
    input: {
      head: ReturnType<typeof mapSapPurchaseOrderToMirror>['head'];
      merchantCode?: string;
      syncedAt: Date;
    },
  ): Promise<void>;
  upsertPoMirrorLine(input: {
    mirrorId: string;
    line: ReturnType<typeof mapSapPurchaseOrderToMirror>['lines'][number];
    skuId?: string | null;
    syncedAt: Date;
  }): Promise<'inserted' | 'updated'>;
}

/** Skip when both sides have the same non-empty external version (idempotent re-import). */
export function shouldSkipByExternalVersion(
  existingVersion: string | null | undefined,
  incomingVersion: string | null | undefined,
): boolean {
  const existing = String(existingVersion ?? '').trim();
  const incoming = String(incomingVersion ?? '').trim();
  if (!existing || !incoming) return false;
  return existing === incoming;
}

export function merchantRowMatchesMapped(
  existing: Pick<MerchantRecord, 'code' | 'name'>,
  mapped: SapMerchantMapped,
): boolean {
  return existing.code === mapped.code && existing.name === mapped.name;
}

export function skuRowMatchesMapped(
  existing: Pick<SkuRecord, 'code' | 'name' | 'unit'>,
  mapped: SapSkuMapped,
): boolean {
  return (
    existing.code === mapped.code &&
    existing.name === mapped.name &&
    existing.unit === mapped.unit
  );
}

export function resolveSyncRunStatus(counts: IngestCounts): SapSyncRunStatus {
  const processed = counts.inserted + counts.updated + counts.skipped;
  if (counts.errors.length === 0) return 'succeeded';
  if (processed === 0) return 'failed';
  return 'partial';
}

function externalIdFromItem(item: unknown, fallbackKeys: string[]): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const record = item as Record<string, unknown>;
  for (const key of fallbackKeys) {
    const value = String(record[key] ?? '').trim();
    if (value) return value;
  }
  return undefined;
}

async function ingestMerchantItem(
  store: SapMirrorIngestStore,
  item: unknown,
  syncedAt: Date,
  counts: IngestCounts,
): Promise<void> {
  const mapped = mapSapVendorToMerchant(item as SapVendorInput);
  const existing = await store.findMerchantByExternal(mapped.sourceSystem, mapped.externalId);

  if (!existing) {
    const codeOwner = await store.findMerchantByCode(mapped.code);
    if (codeOwner) {
      counts.errors.push({
        externalId: mapped.externalId,
        message: `merchant code ${mapped.code} already belongs to another record`,
      });
      return;
    }
    await store.insertMerchant({ mapped, syncedAt });
    counts.inserted++;
    return;
  }

  if (merchantRowMatchesMapped(existing, mapped)) {
    counts.skipped++;
    return;
  }

  await store.updateMerchant(existing.id, { mapped, syncedAt });
  counts.updated++;
}

async function ingestSkuItem(
  store: SapMirrorIngestStore,
  item: unknown,
  syncedAt: Date,
  counts: IngestCounts,
): Promise<void> {
  const mapped = mapSapMaterialToSku(item as SapMaterialInput);
  const existing = await store.findSkuByExternal(mapped.sourceSystem, mapped.externalId);

  if (!existing) {
    const codeOwner = await store.findSkuByCode(mapped.code);
    if (codeOwner) {
      counts.errors.push({
        externalId: mapped.externalId,
        message: `sku code ${mapped.code} already belongs to another record`,
      });
      return;
    }
    await store.insertSku({ mapped, syncedAt });
    counts.inserted++;
    return;
  }

  if (skuRowMatchesMapped(existing, mapped)) {
    counts.skipped++;
    return;
  }

  await store.updateSku(existing.id, { mapped, syncedAt });
  counts.updated++;
}

async function ingestPurchaseOrderItem(
  store: SapMirrorIngestStore,
  item: unknown,
  syncedAt: Date,
  counts: IngestCounts,
): Promise<void> {
  const mapped = mapSapPurchaseOrderToMirror(item as SapPurchaseOrderInput);
  const existing = await store.findPoMirrorByExternal(
    mapped.head.sourceSystem,
    mapped.head.externalId,
  );

  if (
    existing &&
    shouldSkipByExternalVersion(existing.externalVersion, mapped.head.externalVersion)
  ) {
    counts.skipped++;
    return;
  }

  let merchantCode = mapped.head.merchantCode;
  const vendor = await store.findMerchantByExternal(
    SAP_SOURCE_SYSTEM,
    mapped.head.vendorExternalId,
  );
  if (vendor) {
    merchantCode = merchantCode ?? vendor.code;
  }

  let mirror: PoMirrorRecord;
  if (!existing) {
    mirror = await store.insertPoMirror({ head: mapped.head, merchantCode, syncedAt });
    counts.inserted++;
  } else {
    await store.updatePoMirror(existing.id, { head: mapped.head, merchantCode, syncedAt });
    mirror = { ...existing, ...mapped.head, merchantCode };
    counts.updated++;
  }

  for (const line of mapped.lines) {
    const sku = await store.findSkuByExternal(SAP_SOURCE_SYSTEM, line.skuExternalId);
    if (!sku) {
      counts.errors.push({
        externalId: mapped.head.externalId,
        message: `line ${line.externalLineId}: sku not found for material ${line.skuExternalId}`,
      });
    }
    await store.upsertPoMirrorLine({
      mirrorId: mirror.id,
      line,
      skuId: sku?.id ?? null,
      syncedAt,
    });
  }
}

export async function ingestSapMirrorBatch(
  input: SapMirrorIngestBatchInput,
  store: SapMirrorIngestStore = createDbSapMirrorStore(),
): Promise<SapMirrorIngestResult> {
  const syncedAt = new Date();
  const counts: IngestCounts = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const run = await store.createSyncRun({
    entityType: input.entityType,
    userId: input.userId,
    startedAt: syncedAt,
  });

  for (const item of input.items) {
    try {
      switch (input.entityType) {
        case 'merchant':
          await ingestMerchantItem(store, item, syncedAt, counts);
          break;
        case 'sku':
          await ingestSkuItem(store, item, syncedAt, counts);
          break;
        case 'purchase_order':
          await ingestPurchaseOrderItem(store, item, syncedAt, counts);
          break;
        default:
          throw new Error(`unsupported entityType: ${input.entityType as string}`);
      }
    } catch (err) {
      const fallbackKeys =
        input.entityType === 'merchant'
          ? ['vendorId']
          : input.entityType === 'sku'
            ? ['materialId']
            : ['poId'];
      counts.errors.push({
        externalId: externalIdFromItem(item, fallbackKeys),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const status = resolveSyncRunStatus(counts);
  const errorMessage =
    status === 'failed' && counts.errors.length
      ? counts.errors.map((e) => e.message).join('; ')
      : undefined;

  await store.finishSyncRun(run.id, {
    status,
    finishedAt: new Date(),
    summary: counts,
    errorMessage,
  });

  return {
    runId: run.id,
    inserted: counts.inserted,
    updated: counts.updated,
    skipped: counts.skipped,
    errors: counts.errors,
  };
}

export function createDbSapMirrorStore(database: typeof db = db): SapMirrorIngestStore {
  return {
    async createSyncRun({ entityType, userId, startedAt }) {
      const [run] = await database
        .insert(sapSyncRuns)
        .values({
          sourceSystem: SAP_SOURCE_SYSTEM,
          entityType,
          status: 'running',
          requestedBy: userId ?? null,
          startedAt,
        })
        .returning({ id: sapSyncRuns.id });
      return run;
    },

    async finishSyncRun(runId, { status, finishedAt, summary, errorMessage }) {
      await database
        .update(sapSyncRuns)
        .set({
          status,
          finishedAt,
          summary,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(sapSyncRuns.id, runId));
    },

    async findMerchantByExternal(sourceSystem, externalId) {
      const [row] = await database
        .select({
          id: merchants.id,
          sourceSystem: merchants.sourceSystem,
          externalId: merchants.externalId,
          code: merchants.code,
          name: merchants.name,
          externalVersion: merchants.externalVersion,
          syncStatus: merchants.syncStatus,
        })
        .from(merchants)
        .where(and(eq(merchants.sourceSystem, sourceSystem), eq(merchants.externalId, externalId)))
        .limit(1);
      return row;
    },

    async findMerchantByCode(code) {
      const [row] = await database
        .select({
          id: merchants.id,
          sourceSystem: merchants.sourceSystem,
          externalId: merchants.externalId,
          code: merchants.code,
          name: merchants.name,
          externalVersion: merchants.externalVersion,
          syncStatus: merchants.syncStatus,
        })
        .from(merchants)
        .where(eq(merchants.code, code))
        .limit(1);
      return row;
    },

    async insertMerchant({ mapped, syncedAt }) {
      const [row] = await database
        .insert(merchants)
        .values({
          sourceSystem: mapped.sourceSystem,
          externalId: mapped.externalId,
          code: mapped.code,
          name: mapped.name,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .returning({
          id: merchants.id,
          sourceSystem: merchants.sourceSystem,
          externalId: merchants.externalId,
          code: merchants.code,
          name: merchants.name,
          externalVersion: merchants.externalVersion,
          syncStatus: merchants.syncStatus,
        });
      return row;
    },

    async updateMerchant(id, { mapped, syncedAt }) {
      await database
        .update(merchants)
        .set({
          code: mapped.code,
          name: mapped.name,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(eq(merchants.id, id));
    },

    async findSkuByExternal(sourceSystem, externalId) {
      const [row] = await database
        .select({
          id: skus.id,
          sourceSystem: skus.sourceSystem,
          externalId: skus.externalId,
          code: skus.code,
          name: skus.name,
          unit: skus.unit,
          externalVersion: skus.externalVersion,
          syncStatus: skus.syncStatus,
        })
        .from(skus)
        .where(and(eq(skus.sourceSystem, sourceSystem), eq(skus.externalId, externalId)))
        .limit(1);
      return row;
    },

    async findSkuByCode(code) {
      const [row] = await database
        .select({
          id: skus.id,
          sourceSystem: skus.sourceSystem,
          externalId: skus.externalId,
          code: skus.code,
          name: skus.name,
          unit: skus.unit,
          externalVersion: skus.externalVersion,
          syncStatus: skus.syncStatus,
        })
        .from(skus)
        .where(eq(skus.code, code))
        .limit(1);
      return row;
    },

    async insertSku({ mapped, syncedAt }) {
      const [row] = await database
        .insert(skus)
        .values({
          sourceSystem: mapped.sourceSystem,
          externalId: mapped.externalId,
          code: mapped.code,
          name: mapped.name,
          unit: mapped.unit,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .returning({
          id: skus.id,
          sourceSystem: skus.sourceSystem,
          externalId: skus.externalId,
          code: skus.code,
          name: skus.name,
          unit: skus.unit,
          externalVersion: skus.externalVersion,
          syncStatus: skus.syncStatus,
        });
      return row;
    },

    async updateSku(id, { mapped, syncedAt }) {
      await database
        .update(skus)
        .set({
          code: mapped.code,
          name: mapped.name,
          unit: mapped.unit,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(eq(skus.id, id));
    },

    async findPoMirrorByExternal(sourceSystem, externalId) {
      const [row] = await database
        .select({
          id: sapPoMirrors.id,
          sourceSystem: sapPoMirrors.sourceSystem,
          externalId: sapPoMirrors.externalId,
          externalVersion: sapPoMirrors.externalVersion,
          poNumber: sapPoMirrors.poNumber,
          vendorExternalId: sapPoMirrors.vendorExternalId,
          merchantCode: sapPoMirrors.merchantCode,
          orderDate: sapPoMirrors.orderDate,
          statusRaw: sapPoMirrors.statusRaw,
          payload: sapPoMirrors.payload,
          syncStatus: sapPoMirrors.syncStatus,
        })
        .from(sapPoMirrors)
        .where(
          and(
            eq(sapPoMirrors.sourceSystem, sourceSystem),
            eq(sapPoMirrors.externalId, externalId),
          ),
        )
        .limit(1);
      return row;
    },

    async insertPoMirror({ head, merchantCode, syncedAt }) {
      const [row] = await database
        .insert(sapPoMirrors)
        .values({
          sourceSystem: head.sourceSystem,
          externalId: head.externalId,
          externalVersion: head.externalVersion ?? null,
          poNumber: head.poNumber ?? null,
          vendorExternalId: head.vendorExternalId,
          merchantCode: merchantCode ?? null,
          orderDate: head.orderDate ?? null,
          statusRaw: head.statusRaw ?? null,
          payload: head.payload,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .returning({
          id: sapPoMirrors.id,
          sourceSystem: sapPoMirrors.sourceSystem,
          externalId: sapPoMirrors.externalId,
          externalVersion: sapPoMirrors.externalVersion,
          poNumber: sapPoMirrors.poNumber,
          vendorExternalId: sapPoMirrors.vendorExternalId,
          merchantCode: sapPoMirrors.merchantCode,
          orderDate: sapPoMirrors.orderDate,
          statusRaw: sapPoMirrors.statusRaw,
          payload: sapPoMirrors.payload,
          syncStatus: sapPoMirrors.syncStatus,
        });
      return row;
    },

    async updatePoMirror(id, { head, merchantCode, syncedAt }) {
      await database
        .update(sapPoMirrors)
        .set({
          externalVersion: head.externalVersion ?? null,
          poNumber: head.poNumber ?? null,
          vendorExternalId: head.vendorExternalId,
          merchantCode: merchantCode ?? null,
          orderDate: head.orderDate ?? null,
          statusRaw: head.statusRaw ?? null,
          payload: head.payload,
          syncStatus: 'synced',
          lastSyncAt: syncedAt,
          updatedAt: syncedAt,
        })
        .where(eq(sapPoMirrors.id, id));
    },

    async upsertPoMirrorLine({ mirrorId, line, skuId, syncedAt }) {
      const values = {
        mirrorId,
        externalLineId: line.externalLineId,
        skuExternalId: line.skuExternalId,
        skuId: skuId ?? null,
        qty: line.qty,
        uom: line.uom ?? null,
        deliveryDate: line.deliveryDate ?? null,
        payload: line.payload,
        updatedAt: syncedAt,
      };

      const updated = await database
        .update(sapPoMirrorLines)
        .set(values)
        .where(
          and(
            eq(sapPoMirrorLines.mirrorId, mirrorId),
            eq(sapPoMirrorLines.externalLineId, line.externalLineId),
          ),
        )
        .returning({ id: sapPoMirrorLines.id });

      if (updated.length > 0) return 'updated';

      await database.insert(sapPoMirrorLines).values(values);
      return 'inserted';
    },
  };
}

export function createMemorySapMirrorStore(): SapMirrorIngestStore & {
  merchants: MerchantRecord[];
  skus: SkuRecord[];
  poMirrors: PoMirrorRecord[];
  poLines: PoMirrorLineRecord[];
  runs: Array<{
    id: string;
    entityType: SapMirrorEntityType;
    status: SapSyncRunStatus;
    summary?: IngestCounts;
  }>;
} {
  const merchantsByExternal = new Map<string, MerchantRecord>();
  const merchantsByCode = new Map<string, MerchantRecord>();
  const skusByExternal = new Map<string, SkuRecord>();
  const skusByCode = new Map<string, SkuRecord>();
  const poMirrorsByExternal = new Map<string, PoMirrorRecord>();
  const poLinesByKey = new Map<string, PoMirrorLineRecord>();
  const runs: Array<{
    id: string;
    entityType: SapMirrorEntityType;
    status: SapSyncRunStatus;
    summary?: IngestCounts;
  }> = [];

  let nextId = 1;
  const id = () => `id-${nextId++}`;

  const externalKey = (sourceSystem: string, externalId: string) =>
    `${sourceSystem}::${externalId}`;

  return {
    merchants: [],
    skus: [],
    poMirrors: [],
    poLines: [],
    runs,

    async createSyncRun({ entityType, startedAt }) {
      const run = { id: id(), entityType, status: 'running' as SapSyncRunStatus, startedAt };
      runs.push(run);
      return { id: run.id };
    },

    async finishSyncRun(runId, { status, summary }) {
      const run = runs.find((row) => row.id === runId);
      if (run) {
        run.status = status;
        run.summary = summary;
      }
    },

    async findMerchantByExternal(sourceSystem, externalId) {
      return merchantsByExternal.get(externalKey(sourceSystem, externalId));
    },

    async findMerchantByCode(code) {
      return merchantsByCode.get(code);
    },

    async insertMerchant({ mapped, syncedAt }) {
      const row: MerchantRecord = {
        id: id(),
        sourceSystem: mapped.sourceSystem,
        externalId: mapped.externalId,
        code: mapped.code,
        name: mapped.name,
        syncStatus: 'synced',
        lastSyncAt: syncedAt.toISOString(),
      } as MerchantRecord & { lastSyncAt: string };
      merchantsByExternal.set(externalKey(mapped.sourceSystem, mapped.externalId), row);
      merchantsByCode.set(mapped.code, row);
      this.merchants.push(row);
      return row;
    },

    async updateMerchant(recordId, { mapped, syncedAt }) {
      const existing = this.merchants.find((row) => row.id === recordId);
      if (!existing) return;
      if (existing.code !== mapped.code) {
        merchantsByCode.delete(existing.code);
        merchantsByCode.set(mapped.code, existing);
      }
      existing.code = mapped.code;
      existing.name = mapped.name;
      existing.syncStatus = 'synced';
      (existing as MerchantRecord & { lastSyncAt?: string }).lastSyncAt = syncedAt.toISOString();
    },

    async findSkuByExternal(sourceSystem, externalId) {
      return skusByExternal.get(externalKey(sourceSystem, externalId));
    },

    async findSkuByCode(code) {
      return skusByCode.get(code);
    },

    async insertSku({ mapped, syncedAt }) {
      const row: SkuRecord = {
        id: id(),
        sourceSystem: mapped.sourceSystem,
        externalId: mapped.externalId,
        code: mapped.code,
        name: mapped.name,
        unit: mapped.unit,
        syncStatus: 'synced',
      };
      skusByExternal.set(externalKey(mapped.sourceSystem, mapped.externalId), row);
      skusByCode.set(mapped.code, row);
      this.skus.push(row);
      void syncedAt;
      return row;
    },

    async updateSku(recordId, { mapped, syncedAt }) {
      const existing = this.skus.find((row) => row.id === recordId);
      if (!existing) return;
      if (existing.code !== mapped.code) {
        skusByCode.delete(existing.code);
        skusByCode.set(mapped.code, existing);
      }
      existing.code = mapped.code;
      existing.name = mapped.name;
      existing.unit = mapped.unit;
      existing.syncStatus = 'synced';
      void syncedAt;
    },

    async findPoMirrorByExternal(sourceSystem, externalId) {
      return poMirrorsByExternal.get(externalKey(sourceSystem, externalId));
    },

    async insertPoMirror({ head, merchantCode, syncedAt }) {
      const row: PoMirrorRecord = {
        id: id(),
        sourceSystem: head.sourceSystem,
        externalId: head.externalId,
        externalVersion: head.externalVersion ?? null,
        poNumber: head.poNumber ?? null,
        vendorExternalId: head.vendorExternalId,
        merchantCode: merchantCode ?? null,
        orderDate: head.orderDate ?? null,
        statusRaw: head.statusRaw ?? null,
        payload: head.payload,
        syncStatus: 'synced',
      };
      poMirrorsByExternal.set(externalKey(head.sourceSystem, head.externalId), row);
      this.poMirrors.push(row);
      void syncedAt;
      return row;
    },

    async updatePoMirror(recordId, { head, merchantCode, syncedAt }) {
      const existing = this.poMirrors.find((row) => row.id === recordId);
      if (!existing) return;
      Object.assign(existing, {
        externalVersion: head.externalVersion ?? null,
        poNumber: head.poNumber ?? null,
        vendorExternalId: head.vendorExternalId,
        merchantCode: merchantCode ?? null,
        orderDate: head.orderDate ?? null,
        statusRaw: head.statusRaw ?? null,
        payload: head.payload,
        syncStatus: 'synced',
      });
      void syncedAt;
    },

    async upsertPoMirrorLine({ mirrorId, line, skuId, syncedAt }) {
      const key = `${mirrorId}::${line.externalLineId}`;
      const existing = poLinesByKey.get(key);
      if (existing) {
        existing.skuExternalId = line.skuExternalId;
        existing.skuId = skuId ?? null;
        existing.qty = line.qty;
        existing.uom = line.uom ?? null;
        existing.deliveryDate = line.deliveryDate ?? null;
        existing.payload = line.payload;
        void syncedAt;
        return 'updated';
      }
      const row: PoMirrorLineRecord = {
        id: id(),
        mirrorId,
        externalLineId: line.externalLineId,
        skuExternalId: line.skuExternalId,
        skuId: skuId ?? null,
        qty: line.qty,
        uom: line.uom ?? null,
        deliveryDate: line.deliveryDate ?? null,
        payload: line.payload,
      };
      poLinesByKey.set(key, row);
      this.poLines.push(row);
      void syncedAt;
      return 'inserted';
    },
  };
}
