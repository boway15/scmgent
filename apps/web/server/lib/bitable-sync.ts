import {
  extractFieldValue,
  listAllRecords,
  normalizeBitableKey,
  type BitableRecord,
} from '../integrations/feishu-bitable.js';
import {
  BATCH_TRACKED_IMPORT_TYPES,
  buildImportPreviewResponse,
} from './import/preview.js';
import {
  createImportBatch,
  finalizeImportBatch,
} from './import/batch.js';
import { runImport } from './import/handlers.js';

export type BitableSyncType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'merchants'
  | 'inventory_policy';

const BITABLE_SYNC_TYPES: BitableSyncType[] = [
  'skus',
  'inventory',
  'sales',
  'merchants',
  'inventory_policy',
];

const TABLE_ENV_KEYS: Record<BitableSyncType, string> = {
  skus: 'FEISHU_BITABLE_TABLE_SKUS',
  inventory: 'FEISHU_BITABLE_TABLE_INVENTORY',
  sales: 'FEISHU_BITABLE_TABLE_SALES',
  merchants: 'FEISHU_BITABLE_TABLE_MERCHANTS',
  inventory_policy: 'FEISHU_BITABLE_TABLE_INVENTORY_POLICY',
};

/** Bitable column aliases per import field. */
export const BITABLE_FIELD_MAPS: Record<BitableSyncType, Record<string, string[]>> = {
  skus: {
    sku_code: ['SKU编码', 'sku_code', 'SKU', '编码', 'code', '内部SKU'],
    external_code: ['外部SKU', 'external_code', '外部编码', '标准外部码'],
    name: ['商品名称', 'name', '名称', '品名'],
    unit: ['单位', 'unit'],
    spu_code: ['SPU编码', 'spu_code', 'SPU'],
    spu_moq: ['SPU起订量', 'spu_moq'],
    category: ['品类', 'category', '类目'],
    lead_time_days: ['交期天数', 'lead_time_days', '交期'],
    production_lead_days: ['生产周期', 'production_lead_days', '工厂周期', 'factory_lead_days'],
    moq: ['MOQ', 'moq', '起订量'],
    unit_cost: ['成本', 'unit_cost', '单价', '采购价'],
    merchant_code: ['工厂编码', 'merchant_code', '商家编码', '供应商编码'],
    merchant_name: ['工厂名称', 'merchant_name', '商家名称', '供应商名称'],
    replenish_light: ['补货灯', 'replenish_light', '亮灯'],
  },
  inventory: {
    sku_code: ['SKU编码', 'sku_code', 'SKU', '编码', 'code'],
    warehouse: ['仓库', 'warehouse', 'warehouse_code', '仓库编码'],
    qty_available: ['可用库存', 'qty_available', '库存', '可用数量'],
    qty_in_transit: ['在途', 'qty_in_transit', '在途数量'],
    qty_in_production: ['在产', 'qty_in_production', '在产数量'],
    recorded_date: ['盘点日期', 'recorded_date', '记录日期', '日期'],
  },
  sales: {
    sku_code: ['SKU编码', 'sku_code', 'SKU', '编码', 'code'],
    sale_date: ['销售日期', 'sale_date', '日期', '订单日期'],
    qty_sold: ['销量', 'qty_sold', '销售数量', '数量'],
    channel: ['渠道', 'channel', '销售平台'],
    warehouse_code: ['发货仓', 'warehouse_code', 'warehouse', '仓库', '仓库编码'],
  },
  merchants: {
    merchant_code: ['工厂编码', 'merchant_code', '商家编码', '供应商编码', 'code'],
    merchant_name: ['工厂名称', 'merchant_name', '商家名称', '供应商名称', 'name'],
    production_lead_days: ['生产周期', 'production_lead_days', '工厂周期', 'factory_lead_days'],
    contact_name: ['联系人', 'contact_name'],
    contact_phone: ['联系电话', 'contact_phone', '电话'],
    contact_email: ['联系邮箱', 'contact_email', '邮箱'],
    payment_terms: ['付款条件', 'payment_terms'],
  },
  inventory_policy: {
    sku_code: ['SKU编码', 'sku_code', 'SKU', '编码', 'code'],
    warehouse_code: ['仓库编码', 'warehouse_code', 'warehouse', '仓库'],
    safety_stock_days: ['安全库存天数', 'safety_stock_days'],
    target_coverage_days: ['目标覆盖天数', 'target_coverage_days'],
    overstock_threshold_days: ['超备阈值天数', 'overstock_threshold_days', '超备天数'],
    safety_stock_qty: ['安全库存数量', 'safety_stock_qty', 'safety_stock'],
    reorder_point: ['补货触发点', 'reorder_point', 'rop'],
    reorder_qty: ['建议补货量', 'reorder_qty', 'eoq'],
  },
};

export type BitableSyncTargetStatus = {
  configured: boolean;
  tableId?: string;
  appTokenConfigured: boolean;
};

export function getBitableAppToken(): string | undefined {
  return process.env.FEISHU_BITABLE_APP_TOKEN?.trim() || undefined;
}

export function getBitableTableId(type: BitableSyncType): string | undefined {
  const key = TABLE_ENV_KEYS[type];
  return process.env[key]?.trim() || undefined;
}

export function getBitableSyncConfig(): Record<BitableSyncType, BitableSyncTargetStatus> {
  const appTokenConfigured = Boolean(getBitableAppToken());
  const result = {} as Record<BitableSyncType, BitableSyncTargetStatus>;

  for (const type of BITABLE_SYNC_TYPES) {
    const tableId = getBitableTableId(type);
    result[type] = {
      configured: appTokenConfigured && Boolean(tableId),
      tableId,
      appTokenConfigured,
    };
  }

  return result;
}

export function isBitableSyncType(value: string): value is BitableSyncType {
  return (BITABLE_SYNC_TYPES as string[]).includes(value);
}

function lookupFieldValue(
  fields: Record<string, unknown>,
  alias: string,
): unknown {
  if (alias in fields) return fields[alias];

  const normalizedAlias = normalizeBitableKey(alias);
  for (const [key, value] of Object.entries(fields)) {
    if (normalizeBitableKey(key) === normalizedAlias) return value;
  }
  return undefined;
}

export function mapBitableRecordToRow(
  record: BitableRecord,
  type: BitableSyncType,
): Record<string, string> {
  const fieldMap = BITABLE_FIELD_MAPS[type];
  const row: Record<string, string> = {};

  for (const [targetKey, aliases] of Object.entries(fieldMap)) {
    for (const alias of aliases) {
      const raw = lookupFieldValue(record.fields, alias);
      if (raw == null || raw === '') continue;
      const extracted = extractFieldValue(raw);
      if (extracted) {
        row[targetKey] = extracted;
        break;
      }
    }
  }

  return row;
}

export function isEmptyImportRow(row: Record<string, string>): boolean {
  return !Object.values(row).some((v) => v.trim());
}

export function mapBitableRecordsToRows(
  records: BitableRecord[],
  type: BitableSyncType,
): Array<Record<string, string>> {
  return records
    .map((record) => mapBitableRecordToRow(record, type))
    .filter((row) => !isEmptyImportRow(row));
}

export async function fetchMappedRows(type: BitableSyncType): Promise<Array<Record<string, string>>> {
  const appToken = getBitableAppToken();
  const tableId = getBitableTableId(type);

  if (!appToken || !tableId) {
    throw new Error(
      `Bitable sync not configured for ${type}. Set FEISHU_BITABLE_APP_TOKEN and ${TABLE_ENV_KEYS[type]}.`,
    );
  }

  const importType = type === 'inventory_policy' ? 'safety_stock' : type;
  const records = await listAllRecords(appToken, tableId, importType);
  return mapBitableRecordsToRows(records, type);
}

export function bitableSyncFileName(type: BitableSyncType): string {
  const tableId = getBitableTableId(type) ?? 'unknown';
  return `feishu-bitable:${tableId}`;
}

export async function previewBitableSync(type: BitableSyncType) {
  const rows = await fetchMappedRows(type);
  const importType = type === 'inventory_policy' ? 'safety_stock' : type;
  const preview = await buildImportPreviewResponse(importType, rows);
  return { ...preview, source: 'feishu-bitable' as const };
}

export async function executeBitableSync(type: BitableSyncType, userId: string) {
  const rows = await fetchMappedRows(type);
  const importType = type === 'inventory_policy' ? 'safety_stock' : type;
  const preview = await buildImportPreviewResponse(importType, rows);

  if (preview.hasBlockingIssues && BATCH_TRACKED_IMPORT_TYPES.has(importType)) {
    return {
      ok: false as const,
      status: 400,
      body: {
        message: 'Import blocked by validation issues',
        validationIssues: preview.validationIssues,
      },
    };
  }

  const fileName = bitableSyncFileName(type);
  let batchId: string | undefined;

  if (BATCH_TRACKED_IMPORT_TYPES.has(importType)) {
    const batch = await createImportBatch({
      type: importType,
      fileName,
      rowCount: rows.length,
      userId,
    });
    batchId = batch.id;
  }

  const result = await runImport(importType, rows, userId, undefined, batchId);
  let batchStatus: string | undefined;

  if (batchId) {
    const finalized = await finalizeImportBatch(batchId, result);
    batchStatus = finalized.status;
  }

  return {
    ok: true as const,
    status: 200,
    body: {
      ...result,
      batchId,
      batchStatus,
      validationIssues: preview.validationIssues,
      source: 'feishu-bitable' as const,
    },
  };
}
