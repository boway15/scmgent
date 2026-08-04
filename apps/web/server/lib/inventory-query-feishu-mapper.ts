import { extractFieldValue, type BitableRecord } from '../integrations/feishu-bitable.js';

const SKU_FIELD_ALIASES = ['SKU', 'sku_code', 'SKU编码', '编码', 'code', '内部SKU'] as const;

function pickSkuCode(fields: Record<string, unknown>): string {
  for (const alias of SKU_FIELD_ALIASES) {
    if (alias in fields) {
      const value = extractFieldValue(fields[alias]);
      if (value) return value;
    }
  }
  const normalized = new Map(
    Object.entries(fields).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), v]),
  );
  for (const alias of SKU_FIELD_ALIASES) {
    const key = alias.trim().toLowerCase().replace(/\s+/g, '_');
    if (normalized.has(key)) {
      const value = extractFieldValue(normalized.get(key));
      if (value) return value;
    }
  }
  return '';
}

/** 将飞书记录扁平化为「列名 → 字符串」payload；字段名以飞书表头为准。 */
export function mapInventoryQueryBitableRecord(
  record: BitableRecord,
  fieldNames?: readonly string[],
): {
  skuCode: string | null;
  payload: Record<string, string>;
} {
  const fields = record.fields ?? {};
  const payload: Record<string, string> = {};
  const orderedKeys = fieldNames?.length ? [...fieldNames] : Object.keys(fields);

  for (const key of orderedKeys) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      payload[key] = extractFieldValue(fields[key]);
    } else {
      payload[key] = '';
    }
  }

  // 飞书偶发返回未在 fields 元数据中的列，仍保留
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in payload)) payload[key] = extractFieldValue(value);
  }

  const skuCode = pickSkuCode(fields) || null;
  if (skuCode && !payload.SKU) payload.SKU = skuCode;
  return { skuCode, payload };
}

export function mapInventoryQueryBitableRecords(
  records: BitableRecord[],
  fieldNames?: readonly string[],
): {
  items: Array<{ skuCode: string; payload: Record<string, string> }>;
  warningCount: number;
  skipped: number;
} {
  const items: Array<{ skuCode: string; payload: Record<string, string> }> = [];
  let warningCount = 0;
  let skipped = 0;

  for (const record of records) {
    const mapped = mapInventoryQueryBitableRecord(record, fieldNames);
    if (!mapped.skuCode) {
      warningCount += 1;
      skipped += 1;
      continue;
    }
    items.push({ skuCode: mapped.skuCode, payload: mapped.payload });
  }

  return { items, warningCount, skipped };
}

/** 默认可见列：展示飞书快照全部字段，列表横向滑动浏览 */
export function defaultVisibleInventoryQueryColumns(columns: readonly string[]): string[] {
  return columns.length ? [...columns] : [];
}
