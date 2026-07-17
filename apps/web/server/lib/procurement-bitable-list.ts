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
  listBitableFields,
  batchCreateBitableRecords,
  batchDeleteBitableRecords,
  ensureBitableTextFields,
  missingBitableFieldNames,
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

/**
 * 固定列表字段（顺序锁定）。导入/飞书同步只映射数据，不再改列结构。
 * 来源：当前生产库 procurement_list_meta.column_order 快照。
 */
export const FIXED_PROCUREMENT_COLUMNS: Record<ProcurementListKey, string[]> = {
  bulk_stock_request: [
    '需求单号',
    'SKU',
    'SKU名称',
    'WSKU',
    '需求平台',
    '区域',
    '亚马逊备货数量',
    '全链库存总数（含预下单，备货审批）',
    '非亚备货数量',
    '总备货数量',
    '采购成本(CNY)',
    '备货金额',
    '订单确认状态',
    '确认交期',
    '目的仓',
    '供应商编号',
    '供应商简称',
    '运输方式',
    '合同期望交付日期',
    '是否可发起验货申请',
    '产品状态',
    '产品类别',
    '备注',
    '初审备注',
    '近15天销量',
    '近30天销量',
    '近60天销量',
    '近30天毛利率',
    '近90天毛利率',
    '近30天综合毛利率',
    '长库龄占比',
    '近3月退款率',
    '近30天日均销量',
    '全链条周转(备货前)',
    '全链条周转(备货后)',
    '终审备注',
    '拆单备注',
    '预下单审核状态',
    '是否含税',
    '创建人',
    '创建时间',
    '推送时间',
  ],
  purchase_follow_up: [
    '需求单号',
    'SKU',
    'WSKU',
    'SKU名称',
    '品类',
    '开发人员',
    '首次下单',
    '供应商编号',
    '供应商简称',
    '采购数量',
    '采购成本（CNY）',
    '是否现货',
    '状态',
    '采购人员',
    '采购单号',
    '合同编号',
    '推送时间',
    '确认交期',
    '交货日期',
    '采购类型',
    '预计货好时间',
    '合同期望交付时间',
    '未调拨数量',
    '未入库数量',
    '跟单说明',
    '延期分类',
    '延期原因',
    '单据状态',
  ],
};

export function fixedColumnsForProcurementList(listType: ProcurementListKey): string[] {
  return FIXED_PROCUREMENT_COLUMNS[listType];
}

function projectRowsToColumns(
  rows: ProcurementListInputRow[],
  columnOrder: string[],
): ProcurementListInputRow[] {
  const allowed = new Set(columnOrder);
  return rows.map((row) => ({
    ...row,
    rowData: Object.fromEntries(
      Object.entries(row.rowData).filter(([key]) => allowed.has(key)),
    ),
  }));
}

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

/** 归一化行数据；传入 columnOrder 时严格按该表头顺序，并丢弃超出字段。 */
export function normalizeInputRows(
  rows: ProcurementListInputRow[],
  columnOrder?: string[],
): { rows: ProcurementListInputRow[]; columnOrder: string[] } {
  const allowed = columnOrder?.map((key) => key.trim()).filter(Boolean);
  const allowedSet = allowed?.length ? new Set(allowed) : null;

  const filtered = rows
    .map((row) => {
      const entries = Object.entries(row.rowData)
        .map(([key, value]) => [key.trim(), value.trim()] as const)
        .filter(([key, value]) => key && value)
        .filter(([key]) => !allowedSet || allowedSet.has(key));
      return {
        rowData: Object.fromEntries(entries),
        bitableRecordId: row.bitableRecordId,
      };
    })
    .filter((row) => !isEmptyRow(row.rowData));

  return {
    rows: filtered,
    columnOrder: allowed?.length ? allowed : collectColumnOrder(filtered.map((row) => row.rowData)),
  };
}

export async function replaceProcurementListData(params: {
  listType: ProcurementListKey;
  rows: ProcurementListInputRow[];
  source: 'feishu' | 'upload';
  userId: string;
  /** @deprecated 列结构已固定，忽略调用方传入的表头 */
  columnOrder?: string[];
}) {
  const columnOrder = fixedColumnsForProcurementList(params.listType);
  const normalized = normalizeInputRows(params.rows, columnOrder);
  const rows = projectRowsToColumns(normalized.rows, columnOrder);
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

/** 固定列：飞书拉取只映射到固定字段，不增删列。 */
export async function previewProcurementFeishuSync(listType: ProcurementListKey) {
  const rows = await fetchProcurementRowsFromFeishu(listType);
  const columnOrder = fixedColumnsForProcurementList(listType);
  const normalized = normalizeInputRows(rows, columnOrder);
  return {
    source: 'feishu' as const,
    totalRows: normalized.rows.length,
    columnOrder,
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
  /** 固定为全量覆盖：先删飞书全部行，再写入本地全部行 */
  mode: 'full_replace';
  localRowCount: number;
  feishuRowCount: number;
  /** 将写入飞书的本地行数（非空行） */
  toWrite: number;
  /** 将删除的飞书现有行数 */
  toDelete: number;
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

/** 全量覆盖推送计划：删除飞书全部记录后，按本地顺序重建。 */
export function buildFeishuFullReplacePlan(
  localRows: ProcurementLocalRow[],
  feishuRecordIds: string[],
): FeishuPushPlan {
  const creates: FeishuPushPlan['creates'] = [];

  for (const row of localRows) {
    const fields = rowDataToBitableFields(row.rowData);
    if (!Object.keys(fields).length) continue;
    creates.push({ localRowId: row.id, fields });
  }

  return {
    mode: 'full_replace',
    localRowCount: localRows.length,
    feishuRowCount: feishuRecordIds.length,
    toWrite: creates.length,
    toDelete: feishuRecordIds.length,
    creates,
    deleteRecordIds: [...feishuRecordIds],
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
  const columnOrder = fixedColumnsForProcurementList(listType);
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
        columnOrder,
        rowCount: localRows.length,
        lastSyncAt: new Date(),
        lastSyncSource: 'feishu_push',
        lastSyncBy: userId,
        updatedAt: new Date(),
      },
    });
}

export async function previewProcurementFeishuPush(listType: ProcurementListKey) {
  const { appToken, tableId } = assertProcurementBitableConfigured(listType);
  const columnOrder = fixedColumnsForProcurementList(listType);
  const [localRows, feishuRecords, feishuFields] = await Promise.all([
    loadAllProcurementLocalRows(listType),
    listAllRecords(appToken, tableId, `procurement-${listType}`),
    listBitableFields(appToken, tableId),
  ]);

  const missingFeishuFields = missingBitableFieldNames(
    columnOrder,
    feishuFields.map((f) => f.field_name),
  );
  const plan = buildFeishuFullReplacePlan(localRows, feishuRecords.map((row) => row.record_id));
  const meta = await getProcurementListMeta(listType);

  return {
    direction: 'to_feishu' as const,
    mode: plan.mode,
    localRowCount: plan.localRowCount,
    feishuRowCount: plan.feishuRowCount,
    toWrite: plan.toWrite,
    toDelete: plan.toDelete,
    missingFeishuFields,
    willCreateFeishuFields: missingFeishuFields.length,
    columnOrder: meta.columnOrder,
    sample: localRows.slice(0, 5).map((row) => row.rowData),
  };
}

export async function executeProcurementFeishuPush(listType: ProcurementListKey, userId: string) {
  const { appToken, tableId } = assertProcurementBitableConfigured(listType);
  const columnOrder = fixedColumnsForProcurementList(listType);

  // Push uses fixed local columns as field names; recreate any deleted Feishu columns first.
  const ensured = await ensureBitableTextFields(appToken, tableId, columnOrder);

  const [localRows, feishuRecords] = await Promise.all([
    loadAllProcurementLocalRows(listType),
    listAllRecords(appToken, tableId, `procurement-${listType}`),
  ]);

  assertRowCount(localRows, `procurement-${listType}`);

  const plan = buildFeishuFullReplacePlan(localRows, feishuRecords.map((row) => row.record_id));

  if (plan.deleteRecordIds.length) {
    await batchDeleteBitableRecords(appToken, tableId, plan.deleteRecordIds);
  }

  if (plan.creates.length) {
    const createdIds = await batchCreateBitableRecords(
      appToken,
      tableId,
      plan.creates.map((row) => row.fields),
    );

    await db
      .update(procurementListRows)
      .set({ bitableRecordId: null })
      .where(eq(procurementListRows.listType, listType));

    for (let i = 0; i < plan.creates.length; i++) {
      const recordId = createdIds[i];
      if (!recordId) continue;
      await db
        .update(procurementListRows)
        .set({ bitableRecordId: recordId })
        .where(eq(procurementListRows.id, plan.creates[i]!.localRowId));
    }
  } else {
    await db
      .update(procurementListRows)
      .set({ bitableRecordId: null })
      .where(eq(procurementListRows.listType, listType));
  }

  await markProcurementListPushed(listType, userId);

  return {
    direction: 'to_feishu' as const,
    mode: plan.mode,
    pushed: plan.toWrite,
    deleted: plan.toDelete,
    created: plan.toWrite,
    fieldsCreated: ensured.created.length,
  };
}

function rowsToObjectsPreserveHeaders(rows: string[][]): {
  rows: Array<Record<string, string>>;
  columnOrder: string[];
} {
  if (rows.length < 2) return { rows: [], columnOrder: [] };
  const columnOrder = rows[0].map((header) => header.trim()).filter(Boolean);
  const parsed = rows
    .slice(1)
    .map((line) => {
      const obj: Record<string, string> = {};
      columnOrder.forEach((key, index) => {
        const value = (line[index] ?? '').trim();
        if (value) obj[key] = value;
      });
      return obj;
    })
    .filter((row) => !isEmptyRow(row));
  return { rows: parsed, columnOrder };
}

export type ProcurementUploadParseResult = {
  rows: Array<Record<string, string>>;
  columnOrder: string[];
};

export async function parseProcurementUploadBuffer(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ProcurementUploadParseResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { rows: [], columnOrder: [] };
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null | undefined)[]>(
      sheet,
      { header: 1, defval: '', raw: false },
    );
    if (!matrix.length) return { rows: [], columnOrder: [] };
    const headerRow = (Array.isArray(matrix[0]) ? matrix[0] : []).map((cell) =>
      String(cell ?? '').trim(),
    );
    const stringRows = matrix.map((line, rowIndex) => {
      const cells = Array.isArray(line) ? line : [];
      return headerRow.map((header, colIndex) => {
        const cell = cells[colIndex];
        if (cell == null) return '';
        if (rowIndex === 0) return header;
        return formatXlsxCellValue(header, cell);
      });
    });
    return rowsToObjectsPreserveHeaders(stringRows);
  }

  return rowsToObjectsPreserveHeaders(parseDelimitedText(decodeCsvBytes(buffer)));
}

export async function previewProcurementUpload(
  listType: ProcurementListKey,
  buffer: ArrayBuffer,
  fileName: string,
) {
  const parsed = await parseProcurementUploadBuffer(buffer, fileName);
  const columnOrder = fixedColumnsForProcurementList(listType);
  const normalized = normalizeInputRows(
    parsed.rows.map((rowData) => ({ rowData })),
    columnOrder,
  );
  return {
    source: 'upload' as const,
    totalRows: normalized.rows.length,
    columnOrder,
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
    rows: parsed.rows.map((rowData) => ({ rowData })),
    source: 'upload',
    userId: params.userId,
  });
}

/** 仅清空本地行数据，保留固定字段列。 */
export async function clearProcurementListData(listType: ProcurementListKey, userId: string) {
  const columnOrder = fixedColumnsForProcurementList(listType);
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(procurementListRows)
      .where(eq(procurementListRows.listType, listType))
      .returning({ id: procurementListRows.id });

    await tx
      .insert(procurementListMeta)
      .values({
        listType,
        columnOrder,
        rowCount: 0,
        lastSyncAt: new Date(),
        lastSyncSource: 'clear',
        lastSyncBy: userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: procurementListMeta.listType,
        set: {
          columnOrder,
          rowCount: 0,
          lastSyncAt: new Date(),
          lastSyncSource: 'clear',
          lastSyncBy: userId,
          updatedAt: new Date(),
        },
      });

    return { deleted: deleted.length };
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
    columnOrder: fixedColumnsForProcurementList(listType),
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
