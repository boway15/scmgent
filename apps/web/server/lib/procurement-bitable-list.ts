import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import {
  db,
  procurementListMeta,
  procurementListRows,
  users,
  type ProcurementListType,
} from '@scm/db';
import {
  extractFieldValue,
  listAllRecords,
  batchCreateBitableRecords,
  batchDeleteBitableRecords,
  batchUpdateBitableRecords,
  type BitableRecord,
} from '../integrations/feishu-bitable.js';
import { getBitableAppToken } from './bitable-sync.js';
import { assertRowCount } from './upload-guard.js';
import { decodeCsvBytes, parseDelimitedText } from './import/parse.js';
import { formatXlsxCellValue } from './turnover-date-format.js';

export type ProcurementListKey = ProcurementListType;

export const PROCUREMENT_LIST_TYPES: ProcurementListKey[] = [
  'bulk_stock_request',
  'purchase_follow_up',
];

const PROCUREMENT_APP_TOKEN_ENV = 'FEISHU_BITABLE_PROCUREMENT_APP_TOKEN';

const TABLE_ENV_KEYS: Record<ProcurementListKey, string> = {
  bulk_stock_request: 'FEISHU_BITABLE_TABLE_BULK_STOCK_REQUEST',
  purchase_follow_up: 'FEISHU_BITABLE_TABLE_PURCHASE_FOLLOW_UP',
};

const MENU_CODES: Record<ProcurementListKey, string> = {
  bulk_stock_request: 'procurement.bulk_stock',
  purchase_follow_up: 'procurement.follow_up',
};

const LIST_LABELS: Record<ProcurementListKey, string> = {
  bulk_stock_request: '大件备货申请',
  purchase_follow_up: '采购跟单',
};

export function isProcurementListType(value: string): value is ProcurementListKey {
  return (PROCUREMENT_LIST_TYPES as string[]).includes(value);
}

export function menuCodeForProcurementList(type: ProcurementListKey): string {
  return MENU_CODES[type];
}

export function labelForProcurementList(type: ProcurementListKey): string {
  return LIST_LABELS[type];
}

export function getProcurementListTableId(type: ProcurementListKey): string | undefined {
  return process.env[TABLE_ENV_KEYS[type]]?.trim() || undefined;
}

/** 采购列表可用独立 app_token（与新闻/主数据多维表格不是同一份时）。 */
export function getProcurementBitableAppToken(): string | undefined {
  return (
    process.env[PROCUREMENT_APP_TOKEN_ENV]?.trim() ||
    getBitableAppToken() ||
    undefined
  );
}

export type ProcurementListConfig = {
  listType: ProcurementListKey;
  label: string;
  menuCode: string;
  configured: boolean;
  appTokenConfigured: boolean;
  tableIdConfigured: boolean;
  tableEnvKey: string;
  appTokenEnvKeys: string[];
  tableId?: string;
};

export function getProcurementListConfig(): Record<ProcurementListKey, ProcurementListConfig> {
  const appToken = getProcurementBitableAppToken();
  const appTokenConfigured = Boolean(appToken);
  const result = {} as Record<ProcurementListKey, ProcurementListConfig>;

  for (const listType of PROCUREMENT_LIST_TYPES) {
    const tableId = getProcurementListTableId(listType);
    const tableIdConfigured = Boolean(tableId);
    result[listType] = {
      listType,
      label: LIST_LABELS[listType],
      menuCode: MENU_CODES[listType],
      configured: appTokenConfigured && tableIdConfigured,
      appTokenConfigured,
      tableIdConfigured,
      tableEnvKey: TABLE_ENV_KEYS[listType],
      appTokenEnvKeys: [PROCUREMENT_APP_TOKEN_ENV, 'FEISHU_BITABLE_APP_TOKEN'],
      tableId,
    };
  }

  return result;
}

function bitableRecordToRowData(record: BitableRecord): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(record.fields)) {
    const extracted = extractFieldValue(value);
    if (extracted) row[key] = extracted;
  }
  return row;
}

function collectColumnOrder(rows: Array<Record<string, string>>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  return order;
}

function isEmptyRow(row: Record<string, string>): boolean {
  return !Object.values(row).some((value) => value.trim());
}

export type ProcurementListInputRow = {
  rowData: Record<string, string>;
  bitableRecordId?: string;
};

function normalizeInputRows(
  rows: ProcurementListInputRow[],
): { rows: ProcurementListInputRow[]; columnOrder: string[] } {
  const filtered = rows
    .map((row) => ({
      rowData: Object.fromEntries(
        Object.entries(row.rowData)
          .map(([key, value]) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key && value),
      ),
      bitableRecordId: row.bitableRecordId,
    }))
    .filter((row) => !isEmptyRow(row.rowData));

  return {
    rows: filtered,
    columnOrder: collectColumnOrder(filtered.map((row) => row.rowData)),
  };
}

export async function replaceProcurementListData(params: {
  listType: ProcurementListKey;
  rows: ProcurementListInputRow[];
  source: 'feishu' | 'upload';
  userId: string;
}) {
  const { rows, columnOrder } = normalizeInputRows(params.rows);
  assertRowCount(rows, `procurement-${params.listType}`);

  await db.transaction(async (tx) => {
    await tx.delete(procurementListRows).where(eq(procurementListRows.listType, params.listType));

    if (rows.length) {
      await tx.insert(procurementListRows).values(
        rows.map((row, index) => ({
          listType: params.listType,
          rowIndex: index,
          bitableRecordId: row.bitableRecordId,
          rowData: row.rowData,
        })),
      );
    }

    await tx
      .insert(procurementListMeta)
      .values({
        listType: params.listType,
        columnOrder,
        rowCount: rows.length,
        lastSyncAt: new Date(),
        lastSyncSource: params.source,
        lastSyncBy: params.userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: procurementListMeta.listType,
        set: {
          columnOrder,
          rowCount: rows.length,
          lastSyncAt: new Date(),
          lastSyncSource: params.source,
          lastSyncBy: params.userId,
          updatedAt: new Date(),
        },
      });
  });

  return {
    imported: rows.length,
    columnOrder,
    source: params.source,
  };
}

export async function fetchProcurementRowsFromFeishu(
  listType: ProcurementListKey,
): Promise<ProcurementListInputRow[]> {
  const appToken = getProcurementBitableAppToken();
  const tableId = getProcurementListTableId(listType);

  if (!appToken || !tableId) {
    throw new Error(
      `飞书多维表格未配置。请设置 ${PROCUREMENT_APP_TOKEN_ENV}（或 FEISHU_BITABLE_APP_TOKEN）与 ${TABLE_ENV_KEYS[listType]}。`,
    );
  }

  const records = await listAllRecords(appToken, tableId, `procurement-${listType}`);
  return records.map((record) => ({
    bitableRecordId: record.record_id,
    rowData: bitableRecordToRowData(record),
  }));
}

export async function previewProcurementFeishuSync(listType: ProcurementListKey) {
  const rows = await fetchProcurementRowsFromFeishu(listType);
  const normalized = normalizeInputRows(rows);
  return {
    source: 'feishu' as const,
    totalRows: normalized.rows.length,
    columnOrder: normalized.columnOrder,
    sample: normalized.rows.slice(0, 5).map((row) => row.rowData),
  };
}

export async function executeProcurementFeishuSync(listType: ProcurementListKey, userId: string) {
  const rows = await fetchProcurementRowsFromFeishu(listType);
  return replaceProcurementListData({
    listType,
    rows,
    source: 'feishu',
    userId,
  });
}

export type ProcurementLocalRow = {
  id: string;
  rowIndex: number;
  bitableRecordId: string | null;
  rowData: Record<string, string>;
};

export type FeishuPushPlan = {
  localRowCount: number;
  feishuRowCount: number;
  toUpdate: number;
  toCreate: number;
  toDelete: number;
  updates: Array<{ localRowId: string; recordId: string; fields: Record<string, unknown> }>;
  creates: Array<{ localRowId: string; fields: Record<string, unknown> }>;
  deleteRecordIds: string[];
};

function rowDataToBitableFields(rowData: Record<string, string>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rowData)) {
    const trimmed = value.trim();
    if (trimmed) fields[key] = trimmed;
  }
  return fields;
}

export function buildFeishuPushPlan(
  localRows: ProcurementLocalRow[],
  feishuRecordIds: string[],
): FeishuPushPlan {
  const feishuIdSet = new Set(feishuRecordIds);
  const keptFeishuIds = new Set<string>();
  const updates: FeishuPushPlan['updates'] = [];
  const creates: FeishuPushPlan['creates'] = [];

  for (const row of localRows) {
    const fields = rowDataToBitableFields(row.rowData);
    if (!Object.keys(fields).length) continue;

    if (row.bitableRecordId && feishuIdSet.has(row.bitableRecordId)) {
      updates.push({
        localRowId: row.id,
        recordId: row.bitableRecordId,
        fields,
      });
      keptFeishuIds.add(row.bitableRecordId);
      continue;
    }

    creates.push({ localRowId: row.id, fields });
  }

  const deleteRecordIds = feishuRecordIds.filter((id) => !keptFeishuIds.has(id));

  return {
    localRowCount: localRows.length,
    feishuRowCount: feishuRecordIds.length,
    toUpdate: updates.length,
    toCreate: creates.length,
    toDelete: deleteRecordIds.length,
    updates,
    creates,
    deleteRecordIds,
  };
}

async function loadAllProcurementLocalRows(listType: ProcurementListKey): Promise<ProcurementLocalRow[]> {
  return db
    .select({
      id: procurementListRows.id,
      rowIndex: procurementListRows.rowIndex,
      bitableRecordId: procurementListRows.bitableRecordId,
      rowData: procurementListRows.rowData,
    })
    .from(procurementListRows)
    .where(eq(procurementListRows.listType, listType))
    .orderBy(procurementListRows.rowIndex);
}

function assertProcurementBitableConfigured(listType: ProcurementListKey) {
  const appToken = getProcurementBitableAppToken();
  const tableId = getProcurementListTableId(listType);
  if (!appToken || !tableId) {
    throw new Error(
      `飞书多维表格未配置。请设置 ${PROCUREMENT_APP_TOKEN_ENV}（或 FEISHU_BITABLE_APP_TOKEN）与 ${TABLE_ENV_KEYS[listType]}。`,
    );
  }
  return { appToken, tableId };
}

async function markProcurementListPushed(listType: ProcurementListKey, userId: string) {
  const localRows = await loadAllProcurementLocalRows(listType);
  const columnOrder = collectColumnOrder(localRows.map((row) => row.rowData));
  await db
    .insert(procurementListMeta)
    .values({
      listType,
      columnOrder,
      rowCount: localRows.length,
      lastSyncAt: new Date(),
      lastSyncSource: 'feishu_push',
      lastSyncBy: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: procurementListMeta.listType,
      set: {
        lastSyncAt: new Date(),
        lastSyncSource: 'feishu_push',
        lastSyncBy: userId,
        updatedAt: new Date(),
      },
    });
}

export async function previewProcurementFeishuPush(listType: ProcurementListKey) {
  const { appToken, tableId } = assertProcurementBitableConfigured(listType);
  const [localRows, feishuRecords] = await Promise.all([
    loadAllProcurementLocalRows(listType),
    listAllRecords(appToken, tableId, `procurement-${listType}`),
  ]);

  const plan = buildFeishuPushPlan(localRows, feishuRecords.map((row) => row.record_id));
  const meta = await getProcurementListMeta(listType);

  return {
    direction: 'to_feishu' as const,
    localRowCount: plan.localRowCount,
    feishuRowCount: plan.feishuRowCount,
    toUpdate: plan.toUpdate,
    toCreate: plan.toCreate,
    toDelete: plan.toDelete,
    columnOrder: meta.columnOrder,
    sample: localRows.slice(0, 5).map((row) => row.rowData),
  };
}

export async function executeProcurementFeishuPush(listType: ProcurementListKey, userId: string) {
  const { appToken, tableId } = assertProcurementBitableConfigured(listType);
  const [localRows, feishuRecords] = await Promise.all([
    loadAllProcurementLocalRows(listType),
    listAllRecords(appToken, tableId, `procurement-${listType}`),
  ]);

  assertRowCount(localRows, `procurement-${listType}`);

  const plan = buildFeishuPushPlan(localRows, feishuRecords.map((row) => row.record_id));

  if (plan.updates.length) {
    await batchUpdateBitableRecords(
      appToken,
      tableId,
      plan.updates.map((row) => ({ recordId: row.recordId, fields: row.fields })),
    );
  }

  if (plan.creates.length) {
    const createdIds = await batchCreateBitableRecords(
      appToken,
      tableId,
      plan.creates.map((row) => row.fields),
    );
    for (let i = 0; i < plan.creates.length; i++) {
      const recordId = createdIds[i];
      if (!recordId) continue;
      await db
        .update(procurementListRows)
        .set({ bitableRecordId: recordId })
        .where(eq(procurementListRows.id, plan.creates[i]!.localRowId));
    }
  }

  if (plan.deleteRecordIds.length) {
    await batchDeleteBitableRecords(appToken, tableId, plan.deleteRecordIds);
  }

  await markProcurementListPushed(listType, userId);

  return {
    direction: 'to_feishu' as const,
    pushed: plan.toUpdate + plan.toCreate,
    updated: plan.toUpdate,
    created: plan.toCreate,
    deleted: plan.toDelete,
  };
}

function rowsToObjectsPreserveHeaders(rows: string[][]): Array<Record<string, string>> {
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim()).filter(Boolean);
  return rows
    .slice(1)
    .map((line) => {
      const obj: Record<string, string> = {};
      headers.forEach((key, index) => {
        const value = (line[index] ?? '').trim();
        if (value) obj[key] = value;
      });
      return obj;
    })
    .filter((row) => !isEmptyRow(row));
}

export async function parseProcurementUploadBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<Array<Record<string, string>>> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return json
      .map((row) => {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          const trimmedKey = key.trim();
          if (!trimmedKey) continue;
          const formatted = formatXlsxCellValue(trimmedKey, value).trim();
          if (formatted) out[trimmedKey] = formatted;
        }
        return out;
      })
      .filter((row) => !isEmptyRow(row));
  }

  return rowsToObjectsPreserveHeaders(parseDelimitedText(decodeCsvBytes(buffer)));
}

export async function previewProcurementUpload(
  listType: ProcurementListKey,
  buffer: ArrayBuffer,
  fileName: string,
) {
  const parsed = await parseProcurementUploadBuffer(buffer, fileName);
  const normalized = normalizeInputRows(parsed.map((rowData) => ({ rowData })));
  return {
    source: 'upload' as const,
    totalRows: normalized.rows.length,
    columnOrder: normalized.columnOrder,
    sample: normalized.rows.slice(0, 5).map((row) => row.rowData),
  };
}

export async function executeProcurementUpload(params: {
  listType: ProcurementListKey;
  buffer: ArrayBuffer;
  fileName: string;
  userId: string;
}) {
  const parsed = await parseProcurementUploadBuffer(params.buffer, params.fileName);
  return replaceProcurementListData({
    listType: params.listType,
    rows: parsed.map((rowData) => ({ rowData })),
    source: 'upload',
    userId: params.userId,
  });
}

export async function getProcurementListMeta(listType: ProcurementListKey) {
  const [meta] = await db
    .select({
      listType: procurementListMeta.listType,
      columnOrder: procurementListMeta.columnOrder,
      rowCount: procurementListMeta.rowCount,
      lastSyncAt: procurementListMeta.lastSyncAt,
      lastSyncSource: procurementListMeta.lastSyncSource,
      updatedAt: procurementListMeta.updatedAt,
      lastSyncByName: users.name,
    })
    .from(procurementListMeta)
    .leftJoin(users, eq(users.id, procurementListMeta.lastSyncBy))
    .where(eq(procurementListMeta.listType, listType))
    .limit(1);

  const config = getProcurementListConfig()[listType];

  return {
    listType,
    label: config.label,
    configured: config.configured,
    tableId: config.tableId,
    columnOrder: meta?.columnOrder ?? [],
    rowCount: meta?.rowCount ?? 0,
    lastSyncAt: meta?.lastSyncAt ?? null,
    lastSyncSource: meta?.lastSyncSource ?? null,
    lastSyncByName: meta?.lastSyncByName ?? null,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export async function listProcurementRows(params: {
  listType: ProcurementListKey;
  page: number;
  pageSize: number;
  keyword?: string;
}) {
  const offset = (params.page - 1) * params.pageSize;
  const keyword = params.keyword?.trim();

  const keywordClause = keyword
    ? or(
        ilike(sql`${procurementListRows.rowData}::text`, `%${keyword}%`),
        ilike(procurementListRows.bitableRecordId, `%${keyword}%`),
      )
    : undefined;

  const whereClause = keywordClause
    ? and(eq(procurementListRows.listType, params.listType), keywordClause)
    : eq(procurementListRows.listType, params.listType);

  const [totalRow] = await db
    .select({ total: count() })
    .from(procurementListRows)
    .where(whereClause);

  const rows = await db
    .select({
      id: procurementListRows.id,
      rowIndex: procurementListRows.rowIndex,
      bitableRecordId: procurementListRows.bitableRecordId,
      rowData: procurementListRows.rowData,
      createdAt: procurementListRows.createdAt,
    })
    .from(procurementListRows)
    .where(whereClause)
    .orderBy(procurementListRows.rowIndex)
    .limit(params.pageSize)
    .offset(offset);

  const meta = await getProcurementListMeta(params.listType);

  return {
    items: rows,
    total: Number(totalRow?.total ?? 0),
    page: params.page,
    pageSize: params.pageSize,
    columns: meta.columnOrder,
    meta,
  };
}
