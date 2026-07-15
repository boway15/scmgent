import { TURNOVER_IMPORT_HEADERS } from './inventory-turnover-headers.js';
import { formatTurnoverDateValue } from './turnover-date-format.js';

/** 与 parseXlsxBuffer / CSV 导入列名规范化保持一致 */
export function normalizeImportHeaderKey(key: string): string {
  return key
    .trim()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .toLowerCase()
    .replace(/\s+/g, '_');
}

const MASTER_HEADER_KEYS = new Set(
  [
    '品类',
    'sku',
    '生命周期',
    'sku名称',
    '品名',
    '销售国家',
    '产品分类',
    '供应商编码',
    '负责人',
    '开发人员',
    '供应商简称',
    '采购周期',
    '采购价',
  ].map((key) => normalizeImportHeaderKey(key)),
);

const CANONICAL_HEADER_BY_KEY = new Map(
  TURNOVER_IMPORT_HEADERS.map((header) => [normalizeImportHeaderKey(header), header]),
);

export function resolveCanonicalTurnoverHeader(key: string): string | null {
  return CANONICAL_HEADER_BY_KEY.get(normalizeImportHeaderKey(key)) ?? null;
}

/** postgres.js 经 db.execute 返回的 jsonb 有时是字符串 */
function coerceEncodingMeta(encodingMeta: unknown): Record<string, unknown> | null {
  if (encodingMeta == null) return null;
  if (typeof encodingMeta === 'string') {
    const trimmed = encodingMeta.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof encodingMeta === 'object') return encodingMeta as Record<string, unknown>;
  return null;
}

function indexImportRow(row: Record<string, string>): Map<string, string> {
  const indexed = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    indexed.set(normalizeImportHeaderKey(key), trimmed);
  }
  return indexed;
}

/**
 * 按 Excel A:GR 标准表头写入 turnoverSnapshot，键名与列目录完全一致（含 A:K 主数据列）。
 */
export function extractTurnoverSnapshot(row: Record<string, string>): Record<string, string> {
  const indexed = indexImportRow(row);
  const snapshot: Record<string, string> = {};

  for (const header of TURNOVER_IMPORT_HEADERS) {
    const value = indexed.get(normalizeImportHeaderKey(header));
    if (value !== undefined && value !== '') {
      snapshot[header] = formatTurnoverDateValue(header, value);
    }
  }

  for (const [key, value] of indexed) {
    const canonical = CANONICAL_HEADER_BY_KEY.get(key);
    if (canonical) {
      if (snapshot[canonical] === undefined && value !== '') {
        snapshot[canonical] = formatTurnoverDateValue(canonical, value);
      }
      continue;
    }
    if (!MASTER_HEADER_KEYS.has(key) && value !== '') snapshot[key] = value;
  }

  return snapshot;
}

export function mergeTurnoverSnapshotMeta(
  encodingMeta: unknown,
  snapshot: Record<string, string>,
  importedAt?: string,
): Record<string, unknown> {
  const base =
    encodingMeta && typeof encodingMeta === 'object'
      ? { ...(encodingMeta as Record<string, unknown>) }
      : {};

  return {
    ...base,
    turnoverSnapshot: snapshot,
    turnoverSnapshotAt: importedAt ?? new Date().toISOString(),
  };
}

/** 读取快照并将历史非标准键名归一到 Excel 表头 */
export function readTurnoverSnapshot(encodingMeta: unknown): Record<string, string> {
  const meta = coerceEncodingMeta(encodingMeta);
  if (!meta) return {};
  const raw = meta.turnoverSnapshot;
  if (!raw || typeof raw !== 'object') return {};

  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    const canonical = resolveCanonicalTurnoverHeader(key) ?? key;
    snapshot[canonical] = formatTurnoverDateValue(canonical, text);
  }

  const invMaster = meta.inventoryMaster;
  if (invMaster && typeof invMaster === 'object') {
    for (const [key, value] of Object.entries(invMaster as Record<string, unknown>)) {
      if (value == null) continue;
      const text = String(value).trim();
      if (!text) continue;
      const canonical = resolveCanonicalTurnoverHeader(key) ?? key;
      if (snapshot[canonical] === undefined) {
        snapshot[canonical] = formatTurnoverDateValue(canonical, text);
      }
    }
  }

  return snapshot;
}

export function readTurnoverSnapshotAt(encodingMeta: unknown): string | null {
  const meta = coerceEncodingMeta(encodingMeta);
  if (!meta) return null;
  const value = meta.turnoverSnapshotAt;
  return typeof value === 'string' && value.trim() ? value : null;
}

/** 库存周转表包装列（与库存总览 turnoverExtras 键名一致） */
export const TURNOVER_PACK_DIMENSIONS_HEADER = '包装长宽高cm';
export const TURNOVER_VOLUME_HEADER = '体积（m3）';
export const TURNOVER_GROSS_WEIGHT_HEADER = '毛重（Kg）';

export type SkuPackagingFromTurnover = {
  packDimensionsCm: string | null;
  volumeM3: string | null;
  grossWeightKg: string | null;
};

/** 从 encoding_meta.turnoverSnapshot 读取包装尺寸/体积/毛重（库存导入同源） */
export function readSkuPackagingFromEncodingMeta(encodingMeta: unknown): SkuPackagingFromTurnover {
  const snapshot = readTurnoverSnapshot(encodingMeta);
  return {
    packDimensionsCm: snapshot[TURNOVER_PACK_DIMENSIONS_HEADER] ?? null,
    volumeM3: snapshot[TURNOVER_VOLUME_HEADER] ?? null,
    grossWeightKg: snapshot[TURNOVER_GROSS_WEIGHT_HEADER] ?? null,
  };
}

export function inferTurnoverHeaderGroup(header: string): string {
  if (header.includes('销售占比')) return '销售占比';
  if (header.startsWith('海外仓库存')) return '海外仓库存';
  if (header.includes('预计') && header.includes('上架')) return '预计上架';
  if (header.startsWith('调拨在途')) return '调拨在途';
  if (header.includes('供应商订单')) return '供应商订单';
  if (header.startsWith('已调拨未在途')) return '已调拨未在途';
  if (header === '预下单' || header === '全链条合计库存') return '库存汇总';
  if (header.endsWith('销量') || header.includes('月销量')) return '销量';
  if (header.includes('预测日均')) return '预测日均';
  if (header.includes('周转')) return '周转天数';
  if (header.includes('断货') || header.includes('上架时间') || header.includes('最早上架')) {
    return '断货与上架';
  }
  if (
    header.includes('毛利率') ||
    header.includes('退款率') ||
    header.includes('包装') ||
    header.includes('体积') ||
    header.includes('毛重')
  ) {
    return '包装与毛利';
  }
  if (header === '币种') return '主数据扩展';
  return '其他';
}

export type OverviewColumnDef = {
  id: string;
  label: string;
  group: string;
  kind: 'meta' | 'sheet' | 'ops';
  excelCol?: string;
  defaultVisible: boolean;
};

/** Excel 列号：A=1 … Z=26, AA=27 … GR=200 */
export function excelColumnLabel(index: number): string {
  let n = index;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

const META_COLUMNS: OverviewColumnDef[] = [
  { id: 'updatedAt', label: '更新时间', group: '更新信息', kind: 'meta', defaultVisible: true },
  { id: 'dataSource', label: '数据来源', group: '更新信息', kind: 'meta', defaultVisible: true },
  {
    id: 'inventoryRecordedDate',
    label: '库存快照日期',
    group: '更新信息',
    kind: 'meta',
    defaultVisible: false,
  },
];

const SHEET_COLUMNS: OverviewColumnDef[] = TURNOVER_IMPORT_HEADERS.map((header, index) => ({
  id: header,
  label: header,
  group: inferTurnoverHeaderGroup(header),
  kind: 'sheet' as const,
  excelCol: excelColumnLabel(index + 1),
  defaultVisible: false,
}));

const OPS_COLUMNS: OverviewColumnDef[] = [
  { id: 'replenishLight', label: '补货灯', group: '运营', kind: 'ops', defaultVisible: true },
  { id: 'ai', label: 'AI', group: '运营', kind: 'ops', defaultVisible: true },
];

export const INVENTORY_OVERVIEW_COLUMNS: OverviewColumnDef[] = [
  ...META_COLUMNS,
  ...SHEET_COLUMNS,
  ...OPS_COLUMNS,
];

export const INVENTORY_OVERVIEW_COLUMN_BY_ID = new Map(
  INVENTORY_OVERVIEW_COLUMNS.map((col) => [col.id, col]),
);

export const TURNOVER_SHEET_COLUMN_COUNT = TURNOVER_IMPORT_HEADERS.length;
