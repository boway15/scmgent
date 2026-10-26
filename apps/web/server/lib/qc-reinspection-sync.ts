import { count, desc, ilike, max, or, sql } from 'drizzle-orm';
import { db, qcReinspectionFactories, qcReinspectionRows } from '@scm/db';
import {
  batchCreateBitableRecords,
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
  collectFactoryWhitelist,
  formatShanghaiDate,
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
    transferStatus: blankToNull(row.transferStatus),
    followUpReadyAt: row.followUpReadyAtMs != null ? formatShanghaiDate(row.followUpReadyAtMs) : null,
    goodsReadyAt: row.goodsReadyAtMs != null ? formatShanghaiDate(row.goodsReadyAtMs) : null,
    loadingNote: blankToNull(row.loadingNote),
    gapDays: row.gapDays,
    insertedAt: new Date(insertedAtMs),
    syncedAt: new Date(syncedAtMs),
  };
}

async function upsertLocalRow(
  row: QcSourceSnapshot,
  bitableRecordId: string | null,
  insertedAtMs: number,
  syncedAtMs: number,
) {
  const values = rowValues(row, bitableRecordId, insertedAtMs, syncedAtMs);
  await db
    .insert(qcReinspectionRows)
    .values(values)
    .onConflictDoUpdate({
      target: qcReinspectionRows.sourceRecordId,
      set: {
        bitableRecordId: values.bitableRecordId,
        supplierShortName: values.supplierShortName,
        inspectionStatus: values.inspectionStatus,
        purchaseOrderNo: values.purchaseOrderNo,
        demandNo: values.demandNo,
        sku: values.sku,
        productName: values.productName,
        cartonCount: values.cartonCount,
        pieceCount: values.pieceCount,
        destWarehouse: values.destWarehouse,
        factoryType: values.factoryType,
        expectedShipDate: values.expectedShipDate,
        containerCartonCount: values.containerCartonCount,
        containerPieceCount: values.containerPieceCount,
        transferStatus: values.transferStatus,
        followUpReadyAt: values.followUpReadyAt,
        goodsReadyAt: values.goodsReadyAt,
        loadingNote: values.loadingNote,
        gapDays: values.gapDays,
        syncedAt: values.syncedAt,
      },
    });
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

  const fromTarget = collectFactoryWhitelist(
    targetRecords.map((record) => ({
      factoryName: textOf(record.fields, '文本'),
      sourceRecordId: textOf(record.fields, '来源记录ID'),
    })),
  );
  const whitelist = [...new Set([...fromTarget, ...localFactories.map((row) => row.factoryName)])];
  if (!whitelist.length) {
    throw new Error('二次验货工厂范围为空。请在「需二次验货数据」的「文本」列保留工厂全称。');
  }

  const known = new Set(localFactories.map((row) => row.factoryName));
  const toSave = whitelist.filter((name) => !known.has(name));
  if (toSave.length) {
    await db
      .insert(qcReinspectionFactories)
      .values(toSave.map((factoryName) => ({ factoryName })))
      .onConflictDoNothing();
  }

  const snapshots = sourceRecords.map(snapshotFromSource);
  const allowed = new Set(whitelist);
  const matched = snapshots.filter((row) => allowed.has(row.factoryName.trim()));
  const matchedIds = new Set(matched.map((row) => row.recordId));
  const targetBySourceId = new Map<string, BitableRecord>();
  for (const record of targetRecords) {
    const sourceRecordId = textOf(record.fields, '来源记录ID');
    if (sourceRecordId) targetBySourceId.set(sourceRecordId, record);
  }

  const syncedAtMs = Date.now();
  const refreshes: Array<{ recordId: string; fields: Record<string, string | number> }> = [];
  const creating: QcSourceSnapshot[] = [];
  for (const row of matched) {
    const existing = targetBySourceId.get(row.recordId);
    if (!existing) {
      creating.push(row);
      continue;
    }
    const existingFirst = readEpochMs(existing.fields['首次插入时间']);
    const backfill =
      existingFirst != null
        ? null
        : (readEpochMs(existing.fields['插入时间']) ?? syncedAtMs);
    refreshes.push({
      recordId: existing.record_id,
      fields: buildReinspectionRefreshFields(row, syncedAtMs, backfill),
    });
  }

  if (refreshes.length) {
    await batchUpdateBitableRecords(config.appToken, config.targetTableId, refreshes);
  }

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

  for (const record of targetRecords) {
    const snapshot = snapshotFromTarget(record);
    if (!snapshot || matchedIds.has(snapshot.recordId)) continue;
    const insertedAtMs =
      readEpochMs(record.fields['首次插入时间']) ??
      readEpochMs(record.fields['插入时间']) ??
      syncedAtMs;
    const previousSyncedAt =
      readEpochMs(record.fields['数据同步时间']) ??
      readEpochMs(record.fields['插入时间']) ??
      insertedAtMs;
    await upsertLocalRow(snapshot, record.record_id, insertedAtMs, previousSyncedAt);
  }

  for (const row of matched) {
    const existing = targetBySourceId.get(row.recordId);
    if (!existing) continue;
    const insertedAtMs =
      readEpochMs(existing.fields['首次插入时间']) ??
      readEpochMs(existing.fields['插入时间']) ??
      syncedAtMs;
    await upsertLocalRow(row, existing.record_id, insertedAtMs, syncedAtMs);
  }

  for (let i = 0; i < creating.length; i++) {
    await upsertLocalRow(creating[i]!, createdIds[i] ?? null, syncedAtMs, syncedAtMs);
  }

  return {
    sourceCount: sourceRecords.length,
    matched: matched.length,
    created: createdIds.length,
    refreshed: refreshes.length,
    whitelistSize: whitelist.length,
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
