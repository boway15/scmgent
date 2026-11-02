import { and, count, desc, eq, ilike, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { db, qcReinspectionFactories, qcReinspectionRows } from '@scm/db';
import {
  batchCreateBitableRecords,
  batchDeleteBitableRecords,
  batchGetBitableRecords,
  batchUpdateBitableRecords,
  ensureBitableFields,
  extractFieldValue,
  listAllRecords,
  type BitableFieldCreateInput,
  type BitableRecord,
} from '../integrations/feishu-bitable.js';
import {
  buildReinspectionBitableFields,
  buildReinspectionRefreshFields,
  collectFactoryNamesFromSource,
  collectFactoryWhitelist,
  formatShanghaiDate,
  planReinspectionWrites,
  reinspectionBusinessKey,
  type QcSourceSnapshot,
} from './qc-reinspection-plan.js';

const DEFAULT_APP_TOKEN = 'QWc8bLj05annNashYaYccebYnjg';
const DEFAULT_SOURCE_TABLE = 'tblM3ast4z4Kskez';
const DEFAULT_SOURCE_VIEW = 'vewmGvIyW3';
const DEFAULT_TARGET_TABLE = 'tblblV2ZfYda0Lnn';

const DATE_TIME_FIELD = {
  type: 5,
  property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false },
} as const;

const TARGET_FIELDS: BitableFieldCreateInput[] = [
  { field_name: '首次插入时间', ...DATE_TIME_FIELD },
  { field_name: '数据同步时间', ...DATE_TIME_FIELD },
  { field_name: '供应商简称', type: 1 },
  { field_name: '来源记录ID', type: 1 },
  { field_name: '验货状态', type: 1 },
  { field_name: '采购单号', type: 1 },
  { field_name: '需求单号', type: 1 },
  { field_name: 'SKU', type: 1 },
  { field_name: '品名', type: 1 },
  { field_name: '总箱数', type: 2, property: { formatter: '0' } },
  { field_name: '总件数', type: 2, property: { formatter: '0' } },
  { field_name: '目的仓', type: 1 },
  { field_name: '工厂类型', type: 1 },
  { field_name: '期望出货日期', type: 1 },
  { field_name: '货柜实发箱数', type: 2, property: { formatter: '0' } },
  { field_name: '货柜实发数量', type: 2, property: { formatter: '0' } },
  { field_name: '调拨单号', type: 1 },
  { field_name: '调拨状态', type: 1 },
  {
    field_name: '跟单货好时间',
    type: 5,
    property: { date_formatter: 'yyyy/MM/dd', auto_fill: false },
  },
  {
    field_name: '货好时间',
    type: 5,
    property: { date_formatter: 'yyyy/MM/dd', auto_fill: false },
  },
  { field_name: '装柜备注', type: 1 },
  { field_name: '跟单货好时间-期望出货时间差', type: 2, property: { formatter: '0' } },
];

export function getQcReinspectionConfig() {
  return {
    appToken: process.env.FEISHU_BITABLE_QC_APP_TOKEN?.trim() || DEFAULT_APP_TOKEN,
    sourceTableId: process.env.FEISHU_BITABLE_TABLE_QC_FOLLOW_UP?.trim() || DEFAULT_SOURCE_TABLE,
    sourceViewId: process.env.FEISHU_BITABLE_VIEW_QC_REINSPECTION?.trim() || DEFAULT_SOURCE_VIEW,
    targetTableId: process.env.FEISHU_BITABLE_TABLE_QC_REINSPECTION?.trim() || DEFAULT_TARGET_TABLE,
  };
}

function readEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1_000_000_000_000) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const ms = readEpochMs(item);
      if (ms != null) return ms;
    }
    return null;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return readEpochMs((value as { value: unknown }).value);
  }
  return null;
}

function textOf(fields: Record<string, unknown>, name: string): string {
  return extractFieldValue(fields[name]);
}

function gapOf(fields: Record<string, unknown>): number | null {
  const raw = textOf(fields, '跟单货好时间-期望出货时间差');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function snapshotFromSource(record: BitableRecord): QcSourceSnapshot {
  const fields = record.fields;
  return {
    recordId: record.record_id,
    factoryName: textOf(fields, '工厂名称'),
    supplierShortName: textOf(fields, '供应商简称'),
    inspectionStatus: textOf(fields, '验货状态'),
    purchaseOrderNo: textOf(fields, '采购单号'),
    demandNo: textOf(fields, '需求单号'),
    sku: textOf(fields, 'SKU'),
    productName: textOf(fields, '品名'),
    cartonCount: textOf(fields, '总箱数'),
    pieceCount: textOf(fields, '总件数'),
    destWarehouse: textOf(fields, '目的仓'),
    factoryType: textOf(fields, '工厂类型'),
    expectedShipDate: textOf(fields, '期望出货日期'),
    containerCartonCount: textOf(fields, '货柜实发箱数'),
    containerPieceCount: textOf(fields, '货柜实发数量'),
    transferOrderNo: textOf(fields, '调拨单号'),
    transferStatus: textOf(fields, '调拨状态'),
    followUpReadyAtMs: readEpochMs(fields['跟单货好时间']),
    goodsReadyAtMs: readEpochMs(fields['货好时间']),
    loadingNote: textOf(fields, '装柜备注'),
    gapDays: gapOf(fields),
  };
}

function snapshotFromTarget(record: BitableRecord): QcSourceSnapshot | null {
  const sourceRecordId = textOf(record.fields, '来源记录ID');
  if (!sourceRecordId) return null;
  const fields = record.fields;
  return {
    recordId: sourceRecordId,
    factoryName: '',
    supplierShortName: textOf(fields, '供应商简称'),
    inspectionStatus: textOf(fields, '验货状态'),
    purchaseOrderNo: textOf(fields, '采购单号'),
    demandNo: textOf(fields, '需求单号'),
    sku: textOf(fields, 'SKU'),
    productName: textOf(fields, '品名'),
    cartonCount: textOf(fields, '总箱数'),
    pieceCount: textOf(fields, '总件数'),
    destWarehouse: textOf(fields, '目的仓'),
    factoryType: textOf(fields, '工厂类型'),
    expectedShipDate: textOf(fields, '期望出货日期'),
    containerCartonCount: textOf(fields, '货柜实发箱数'),
    containerPieceCount: textOf(fields, '货柜实发数量'),
    transferOrderNo: textOf(fields, '调拨单号'),
    transferStatus: textOf(fields, '调拨状态'),
    followUpReadyAtMs: readEpochMs(fields['跟单货好时间']),
    goodsReadyAtMs: readEpochMs(fields['货好时间']),
    loadingNote: textOf(fields, '装柜备注'),
    gapDays: gapOf(fields),
  };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function rowValues(
  row: QcSourceSnapshot,
  bitableRecordId: string | null,
  insertedAtMs: number,
  syncedAtMs: number,
) {
  return {
    sourceRecordId: row.recordId,
    bitableRecordId,
    supplierShortName: blankToNull(row.supplierShortName),
    inspectionStatus: blankToNull(row.inspectionStatus),
    purchaseOrderNo: blankToNull(row.purchaseOrderNo),
    demandNo: blankToNull(row.demandNo),
    sku: blankToNull(row.sku),
    productName: blankToNull(row.productName),
    cartonCount: blankToNull(row.cartonCount),
    pieceCount: blankToNull(row.pieceCount),
    destWarehouse: blankToNull(row.destWarehouse),
    factoryType: blankToNull(row.factoryType),
    expectedShipDate: blankToNull(row.expectedShipDate),
    containerCartonCount: blankToNull(row.containerCartonCount),
    containerPieceCount: blankToNull(row.containerPieceCount),
    transferOrderNo: blankToNull(row.transferOrderNo),
    transferStatus: blankToNull(row.transferStatus),
    followUpReadyAt: row.followUpReadyAtMs != null ? formatShanghaiDate(row.followUpReadyAtMs) : null,
    goodsReadyAt: row.goodsReadyAtMs != null ? formatShanghaiDate(row.goodsReadyAtMs) : null,
    loadingNote: blankToNull(row.loadingNote),
    gapDays: row.gapDays,
    insertedAt: new Date(insertedAtMs),
    syncedAt: new Date(syncedAtMs),
  };
}

function localBusinessKey(row: {
  purchaseOrderNo: string | null;
  sku: string | null;
  demandNo: string | null;
  transferOrderNo: string | null;
}): string {
  return reinspectionBusinessKey({
    purchaseOrderNo: row.purchaseOrderNo ?? '',
    sku: row.sku ?? '',
    demandNo: row.demandNo ?? '',
    transferOrderNo: row.transferOrderNo ?? '',
  });
}

/** 本地按业务键只留最早一行，并把这一行更新成本次要保留的快照。 */
async function reconcileLocalRows(
  desired: Array<{
    snapshot: QcSourceSnapshot;
    bitableRecordId: string | null;
    insertedAtMs: number;
    syncedAtMs: number;
  }>,
) {
  const desiredByKey = new Map<string, (typeof desired)[number]>();
  for (const item of desired) {
    const key = reinspectionBusinessKey(item.snapshot);
    if (!desiredByKey.has(key)) desiredByKey.set(key, item);
  }

  const localRows = await db.select().from(qcReinspectionRows);
  const groups = new Map<string, typeof localRows>();
  for (const row of localRows) {
    const key = localBusinessKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const dropIds = new Set<string>();
  const keepByKey = new Map<string, string>();
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => {
      const diff = a.insertedAt.getTime() - b.insertedAt.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });
    const keep = sorted[0];
    if (!keep) continue;
    if (desiredByKey.has(key) || sorted.length > 1) keepByKey.set(key, keep.id);
    for (const extra of sorted.slice(1)) dropIds.add(extra.id);
  }

  const assignedSourceIds = new Set([...desiredByKey.values()].map((item) => item.snapshot.recordId));
  const keepIds = new Set(keepByKey.values());
  for (const row of localRows) {
    if (keepIds.has(row.id)) continue;
    if (assignedSourceIds.has(row.sourceRecordId)) dropIds.add(row.id);
  }

  if (dropIds.size) {
    await db.delete(qcReinspectionRows).where(inArray(qcReinspectionRows.id, [...dropIds]));
  }

  const updates = [...desiredByKey.entries()].flatMap(([key, item]) => {
    const keepId = keepByKey.get(key);
    if (!keepId || dropIds.has(keepId)) return [];
    return [{ keepId, item }];
  });

  for (const { keepId } of updates) {
    await db
      .update(qcReinspectionRows)
      .set({ sourceRecordId: `tmp:${keepId}` })
      .where(eq(qcReinspectionRows.id, keepId));
  }

  for (const { keepId, item } of updates) {
    const values = rowValues(item.snapshot, item.bitableRecordId, item.insertedAtMs, item.syncedAtMs);
    const { insertedAt: _insertedAt, ...changes } = values;
    await db.update(qcReinspectionRows).set(changes).where(eq(qcReinspectionRows.id, keepId));
  }

  for (const [key, item] of desiredByKey) {
    const keepId = keepByKey.get(key);
    if (keepId && !dropIds.has(keepId)) continue;
    await db
      .insert(qcReinspectionRows)
      .values(rowValues(item.snapshot, item.bitableRecordId, item.insertedAtMs, item.syncedAtMs));
  }
}

export async function syncQcReinspection() {
  const config = getQcReinspectionConfig();
  await ensureBitableFields(config.appToken, config.targetTableId, TARGET_FIELDS);

  const [targetRecords, sourceRecords, localFactories] = await Promise.all([
    listAllRecords(config.appToken, config.targetTableId, 'qc-reinspection'),
    listAllRecords(config.appToken, config.sourceTableId, 'qc-reinspection', {
      displayFormulaRef: true,
      viewId: config.sourceViewId,
    }),
    db.select({ factoryName: qcReinspectionFactories.factoryName }).from(qcReinspectionFactories),
  ]);

  const snapshots = sourceRecords.map(snapshotFromSource);

  const fromTarget = collectFactoryWhitelist(
    targetRecords.map((record) => ({
      factoryName: textOf(record.fields, '文本'),
      sourceRecordId: textOf(record.fields, '来源记录ID'),
    })),
  );
  let whitelist = [...new Set([...fromTarget, ...localFactories.map((row) => row.factoryName)])];
  if (!whitelist.length) {
    whitelist = collectFactoryNamesFromSource(snapshots);
  }
  if (!whitelist.length) {
    throw new Error(
      '二次验货工厂范围为空：目标表无「文本」占位行、本地无工厂缓存，且采购跟进「二次验货」视图中没有「工厂名称」。',
    );
  }

  const known = new Set(localFactories.map((row) => row.factoryName));
  const toSave = whitelist.filter((name) => !known.has(name));
  if (toSave.length) {
    await db
      .insert(qcReinspectionFactories)
      .values(toSave.map((factoryName) => ({ factoryName })))
      .onConflictDoNothing();
  }
  const allowed = new Set(whitelist);
  const matched = snapshots.filter((row) => allowed.has(row.factoryName.trim()));
  const matchedById = new Map(matched.map((row) => [row.recordId, row]));
  const targetById = new Map(targetRecords.map((record) => [record.record_id, record]));

  const plan = planReinspectionWrites({
    source: matched.map((row) => ({
      recordId: row.recordId,
      purchaseOrderNo: row.purchaseOrderNo,
      sku: row.sku,
      demandNo: row.demandNo,
      transferOrderNo: row.transferOrderNo,
    })),
    target: targetRecords.flatMap((record) => {
      const sourceRecordId = textOf(record.fields, '来源记录ID');
      if (!sourceRecordId) return [];
      return [
        {
          targetRecordId: record.record_id,
          sourceRecordId,
          purchaseOrderNo: textOf(record.fields, '采购单号'),
          sku: textOf(record.fields, 'SKU'),
          demandNo: textOf(record.fields, '需求单号'),
          transferOrderNo: textOf(record.fields, '调拨单号'),
          firstInsertedAtMs:
            readEpochMs(record.fields['首次插入时间']) ?? readEpochMs(record.fields['插入时间']),
        },
      ];
    }),
  });

  const syncedAtMs = Date.now();
  const refreshIds = new Set(plan.refreshes.map((item) => item.targetRecordId));
  const deletes = plan.deletes.filter((id) => !refreshIds.has(id));
  const refreshes = plan.refreshes.flatMap((item) => {
    const row = matchedById.get(item.sourceRecordId);
    const existing = targetById.get(item.targetRecordId);
    if (!row || !existing) return [];
    const existingFirst = readEpochMs(existing.fields['首次插入时间']);
    const backfill =
      existingFirst != null ? null : (readEpochMs(existing.fields['插入时间']) ?? syncedAtMs);
    return [
      {
        recordId: item.targetRecordId,
        fields: buildReinspectionRefreshFields(row, syncedAtMs, backfill),
      },
    ];
  });

  if (refreshes.length) {
    await batchUpdateBitableRecords(config.appToken, config.targetTableId, refreshes);
  }

  const creating = plan.creates.flatMap((id) => {
    const row = matchedById.get(id);
    return row ? [row] : [];
  });
  const createdIds = creating.length
    ? await batchCreateBitableRecords(
        config.appToken,
        config.targetTableId,
        creating.map((row) => buildReinspectionBitableFields(row, syncedAtMs)),
      )
    : [];
  if (createdIds.length !== creating.length) {
    throw new Error(`飞书写入条数不一致：计划 ${creating.length}，实际 ${createdIds.length}`);
  }

  if (deletes.length) {
    await batchDeleteBitableRecords(config.appToken, config.targetTableId, deletes);
  }

  const desired: Array<{
    snapshot: QcSourceSnapshot;
    bitableRecordId: string | null;
    insertedAtMs: number;
    syncedAtMs: number;
  }> = [];
  const deletedIds = new Set(deletes);

  for (const item of plan.refreshes) {
    const row = matchedById.get(item.sourceRecordId);
    const existing = targetById.get(item.targetRecordId);
    if (!row || !existing) continue;
    desired.push({
      snapshot: row,
      bitableRecordId: item.targetRecordId,
      insertedAtMs:
        readEpochMs(existing.fields['首次插入时间']) ??
        readEpochMs(existing.fields['插入时间']) ??
        syncedAtMs,
      syncedAtMs,
    });
  }

  for (let i = 0; i < creating.length; i++) {
    desired.push({
      snapshot: creating[i]!,
      bitableRecordId: createdIds[i] ?? null,
      insertedAtMs: syncedAtMs,
      syncedAtMs,
    });
  }

  for (const record of targetRecords) {
    if (deletedIds.has(record.record_id) || refreshIds.has(record.record_id)) continue;
    const snapshot = snapshotFromTarget(record);
    if (!snapshot) continue;
    const insertedAtMs =
      readEpochMs(record.fields['首次插入时间']) ??
      readEpochMs(record.fields['插入时间']) ??
      syncedAtMs;
    const previousSyncedAt =
      readEpochMs(record.fields['数据同步时间']) ??
      readEpochMs(record.fields['插入时间']) ??
      insertedAtMs;
    desired.push({
      snapshot,
      bitableRecordId: record.record_id,
      insertedAtMs,
      syncedAtMs: previousSyncedAt,
    });
  }

  await reconcileLocalRows(desired);

  const backfill = await backfillQcReinspectionTransferOrderNo();

  return {
    sourceCount: sourceRecords.length,
    matched: matched.length,
    created: createdIds.length,
    refreshed: refreshes.length,
    deleted: deletes.length,
    whitelistSize: whitelist.length,
    backfill,
  };
}

function businessMatchKey(parts: {
  purchaseOrderNo: string | null | undefined;
  sku: string | null | undefined;
  demandNo: string | null | undefined;
  destWarehouse: string | null | undefined;
}): string {
  return [parts.purchaseOrderNo, parts.sku, parts.demandNo, parts.destWarehouse]
    .map((part) => (part ?? '').trim())
    .join('|');
}

/**
 * 对本地仍缺「调拨单号」的历史行：
 * 1) 按来源记录 ID 回查采购跟进；
 * 2) 来源已删除时，用 采购单号+SKU+需求单号+目的仓 在现有跟进表唯一匹配。
 * 写回本地与飞书目标表。
 */
export async function backfillQcReinspectionTransferOrderNo() {
  const config = getQcReinspectionConfig();
  await ensureBitableFields(config.appToken, config.targetTableId, TARGET_FIELDS);

  const emptyRows = await db
    .select({
      id: qcReinspectionRows.id,
      sourceRecordId: qcReinspectionRows.sourceRecordId,
      bitableRecordId: qcReinspectionRows.bitableRecordId,
      purchaseOrderNo: qcReinspectionRows.purchaseOrderNo,
      sku: qcReinspectionRows.sku,
      demandNo: qcReinspectionRows.demandNo,
      destWarehouse: qcReinspectionRows.destWarehouse,
    })
    .from(qcReinspectionRows)
    .where(
      or(isNull(qcReinspectionRows.transferOrderNo), eq(qcReinspectionRows.transferOrderNo, '')),
    );

  if (!emptyRows.length) {
    return {
      scanned: 0,
      updatedLocal: 0,
      updatedFeishu: 0,
      matchedBySourceId: 0,
      matchedByBusinessKey: 0,
      missingSource: 0,
    };
  }

  const sourceById = await batchGetBitableRecords(
    config.appToken,
    config.sourceTableId,
    emptyRows.map((row) => row.sourceRecordId),
    { displayFormulaRef: true },
  );
  const transferBySourceId = new Map<string, string>();
  for (const record of sourceById) {
    const value = textOf(record.fields, '调拨单号').trim();
    if (value) transferBySourceId.set(record.record_id, value);
  }

  const unresolved = emptyRows.filter((row) => !transferBySourceId.has(row.sourceRecordId));
  const transferByBusinessKey = new Map<string, string>();
  if (unresolved.length) {
    const followUpRecords = await listAllRecords(
      config.appToken,
      config.sourceTableId,
      'procurement-purchase_follow_up',
      { displayFormulaRef: true },
    );
    const candidates = new Map<string, Set<string>>();
    for (const record of followUpRecords) {
      const value = textOf(record.fields, '调拨单号').trim();
      if (!value) continue;
      const key = businessMatchKey({
        purchaseOrderNo: textOf(record.fields, '采购单号'),
        sku: textOf(record.fields, 'SKU'),
        demandNo: textOf(record.fields, '需求单号'),
        destWarehouse: textOf(record.fields, '目的仓'),
      });
      if (!key.replace(/\|/g, '')) continue;
      if (!candidates.has(key)) candidates.set(key, new Set());
      candidates.get(key)!.add(value);
    }
    for (const [key, values] of candidates) {
      if (values.size === 1) transferByBusinessKey.set(key, [...values][0]!);
    }
  }

  const occupied = new Set<string>();
  const keyedRows = await db
    .select({
      purchaseOrderNo: qcReinspectionRows.purchaseOrderNo,
      sku: qcReinspectionRows.sku,
      demandNo: qcReinspectionRows.demandNo,
      transferOrderNo: qcReinspectionRows.transferOrderNo,
    })
    .from(qcReinspectionRows);
  for (const row of keyedRows) {
    if (!row.transferOrderNo?.trim()) continue;
    occupied.add(
      reinspectionBusinessKey({
        purchaseOrderNo: row.purchaseOrderNo ?? '',
        sku: row.sku ?? '',
        demandNo: row.demandNo ?? '',
        transferOrderNo: row.transferOrderNo,
      }),
    );
  }

  const feishuUpdates: Array<{ recordId: string; fields: Record<string, string> }> = [];
  const feishuDeletes: string[] = [];
  let updatedLocal = 0;
  let matchedBySourceId = 0;
  let matchedByBusinessKey = 0;
  let missingSource = 0;

  for (const row of emptyRows) {
    let transferOrderNo = transferBySourceId.get(row.sourceRecordId) ?? null;
    let via: 'sourceId' | 'businessKey' | null = transferOrderNo ? 'sourceId' : null;
    if (!transferOrderNo) {
      const key = businessMatchKey(row);
      transferOrderNo = transferByBusinessKey.get(key) ?? null;
      if (transferOrderNo) via = 'businessKey';
    }
    if (!transferOrderNo) {
      missingSource += 1;
      continue;
    }
    const nextKey = reinspectionBusinessKey({
      purchaseOrderNo: row.purchaseOrderNo ?? '',
      sku: row.sku ?? '',
      demandNo: row.demandNo ?? '',
      transferOrderNo,
    });
    if (occupied.has(nextKey)) {
      await db.delete(qcReinspectionRows).where(eq(qcReinspectionRows.id, row.id));
      if (row.bitableRecordId) feishuDeletes.push(row.bitableRecordId);
      continue;
    }
    occupied.add(nextKey);
    await db
      .update(qcReinspectionRows)
      .set({ transferOrderNo })
      .where(
        and(
          eq(qcReinspectionRows.id, row.id),
          or(isNull(qcReinspectionRows.transferOrderNo), eq(qcReinspectionRows.transferOrderNo, '')),
        ),
      );
    updatedLocal += 1;
    if (via === 'sourceId') matchedBySourceId += 1;
    if (via === 'businessKey') matchedByBusinessKey += 1;
    if (row.bitableRecordId) {
      feishuUpdates.push({
        recordId: row.bitableRecordId,
        fields: { 调拨单号: transferOrderNo },
      });
    }
  }

  if (feishuUpdates.length) {
    await batchUpdateBitableRecords(config.appToken, config.targetTableId, feishuUpdates);
  }
  const updateIds = new Set(feishuUpdates.map((item) => item.recordId));
  const deletes = feishuDeletes.filter((id) => !updateIds.has(id));
  if (deletes.length) {
    await batchDeleteBitableRecords(config.appToken, config.targetTableId, deletes);
  }

  return {
    scanned: emptyRows.length,
    updatedLocal,
    updatedFeishu: feishuUpdates.length,
    matchedBySourceId,
    matchedByBusinessKey,
    missingSource,
  };
}

export type QcReinspectionListItem = {
  id: string;
  sourceRecordId: string;
  supplierShortName: string | null;
  inspectionStatus: string | null;
  purchaseOrderNo: string | null;
  demandNo: string | null;
  sku: string | null;
  productName: string | null;
  cartonCount: string | null;
  pieceCount: string | null;
  destWarehouse: string | null;
  factoryType: string | null;
  expectedShipDate: string | null;
  containerCartonCount: string | null;
  containerPieceCount: string | null;
  transferOrderNo: string | null;
  transferStatus: string | null;
  followUpReadyAt: string | null;
  goodsReadyAt: string | null;
  loadingNote: string | null;
  gapDays: number | null;
  insertedAt: string;
  syncedAt: string;
};

export async function listQcReinspection(input: { keyword?: string; page: number; pageSize: number; offset: number }) {
  const keyword = input.keyword?.trim();
  const pattern = keyword ? `%${keyword}%` : null;
  const where = pattern
    ? or(
        ilike(qcReinspectionRows.sourceRecordId, pattern),
        ilike(qcReinspectionRows.supplierShortName, pattern),
        ilike(qcReinspectionRows.sku, pattern),
        ilike(qcReinspectionRows.purchaseOrderNo, pattern),
        ilike(qcReinspectionRows.demandNo, pattern),
        ilike(qcReinspectionRows.transferOrderNo, pattern),
        ilike(qcReinspectionRows.productName, pattern),
      )
    : sql`true`;

  const [rows, totalRow, latestRow] = await Promise.all([
    db
      .select()
      .from(qcReinspectionRows)
      .where(where)
      .orderBy(desc(qcReinspectionRows.insertedAt), desc(qcReinspectionRows.sourceRecordId))
      .limit(input.pageSize)
      .offset(input.offset),
    db.select({ total: count() }).from(qcReinspectionRows).where(where),
    db.select({ insertedAt: max(qcReinspectionRows.insertedAt) }).from(qcReinspectionRows),
  ]);

  const items: QcReinspectionListItem[] = rows.map((row) => ({
    id: row.id,
    sourceRecordId: row.sourceRecordId,
    supplierShortName: row.supplierShortName,
    inspectionStatus: row.inspectionStatus,
    purchaseOrderNo: row.purchaseOrderNo,
    demandNo: row.demandNo,
    sku: row.sku,
    productName: row.productName,
    cartonCount: row.cartonCount,
    pieceCount: row.pieceCount,
    destWarehouse: row.destWarehouse,
    factoryType: row.factoryType,
    expectedShipDate: row.expectedShipDate,
    containerCartonCount: row.containerCartonCount,
    containerPieceCount: row.containerPieceCount,
    transferOrderNo: row.transferOrderNo,
    transferStatus: row.transferStatus,
    followUpReadyAt: row.followUpReadyAt,
    goodsReadyAt: row.goodsReadyAt,
    loadingNote: row.loadingNote,
    gapDays: row.gapDays,
    insertedAt: row.insertedAt.toISOString(),
    syncedAt: row.syncedAt.toISOString(),
  }));

  return {
    items,
    total: Number(totalRow[0]?.total ?? 0),
    page: input.page,
    pageSize: input.pageSize,
    lastInsertedAt: latestRow[0]?.insertedAt?.toISOString() ?? null,
  };
}
