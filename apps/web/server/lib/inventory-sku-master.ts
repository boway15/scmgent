import {
  mergeTurnoverSnapshotMeta,
  readTurnoverSnapshot,
} from './inventory-turnover-snapshot.js';

/** 库存周转明细表 A:K 列 → SKU 主数据 */
export type InventorySkuMasterFields = {
  /** A 品类 */
  category?: string;
  /** B SKU */
  skuCode: string;
  /** C 生命周期 */
  lifecycle?: string;
  /** D SKU名称 */
  name: string;
  /** E 销售国家 */
  salesCountry?: string;
  /** F 产品分类 */
  productCategory?: string;
  /** G 供应商编码 */
  merchantCode?: string;
  /** H 负责人 */
  ownerName?: string;
  /** I 开发人员 */
  developerName?: string;
  /** J 供应商简称 */
  merchantName?: string;
  /** K 采购周期（天） */
  leadTimeDays?: number;
};

export const INVENTORY_MASTER_COLUMN_LABELS = {
  category: '品类',
  skuCode: 'SKU',
  lifecycle: '生命周期',
  name: 'SKU名称',
  salesCountry: '销售国家',
  productCategory: '产品分类',
  merchantCode: '供应商编码',
  ownerName: '负责人',
  developerName: '开发人员',
  merchantName: '供应商简称',
  leadTimeDays: '采购周期',
} as const;

/** 库存周转总览数量/销量列（对齐导入周转表） */
export const INVENTORY_TURNOVER_QTY_LABELS = {
  unitCost: '采购价',
  qtyOverseas: '海外仓库存_合计',
  qtyInTransit: '调拨在途_合计',
  qtyInProduction: '供应商订单',
  qtyPreOrder: '预下单',
  qtyChainTotal: '全链条合计库存',
  salesQty3d: '3天销量',
  salesQty7d: '7天销量',
  salesQty14d: '14天销量',
  salesQty30d: '30天销量',
} as const;

function clampText(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen);
}

export function inventoryMasterToSkuColumns(
  master: Partial<InventorySkuMasterFields>,
): {
  category?: string;
  lifecycle?: string;
  salesCountry?: string;
  productCategory?: string;
  ownerName?: string;
  developerName?: string;
  merchantCode?: string;
  merchantName?: string;
  leadTimeDays?: number;
  name?: string;
} {
  return {
    category: clampText(master.category, 500),
    lifecycle: clampText(master.lifecycle, 50),
    salesCountry: clampText(master.salesCountry, 100),
    productCategory: clampText(master.productCategory, 200),
    ownerName: clampText(master.ownerName, 100),
    developerName: clampText(master.developerName, 100),
    merchantCode: clampText(master.merchantCode, 100),
    merchantName: clampText(master.merchantName, 200),
    leadTimeDays: master.leadTimeDays,
    name: clampText(master.name, 200),
  };
}

export function buildInventoryEncodingMeta(
  master: Partial<InventorySkuMasterFields>,
  skuCode: string,
  existing?: unknown,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const cols = inventoryMasterToSkuColumns(master);

  return {
    ...base,
    masterDataSource: 'inventory',
    lifecycle: cols.lifecycle,
    salesCountry: cols.salesCountry,
    productCategory: cols.productCategory,
    ownerName: cols.ownerName,
    developerName: cols.developerName,
    inventoryMaster: {
      品类: cols.category ?? '',
      SKU: skuCode,
      生命周期: cols.lifecycle ?? '',
      SKU名称: cols.name ?? '',
      销售国家: cols.salesCountry ?? '',
      产品分类: cols.productCategory ?? '',
      供应商编码: cols.merchantCode ?? '',
      负责人: cols.ownerName ?? '',
      开发人员: cols.developerName ?? '',
      供应商简称: cols.merchantName ?? '',
      采购周期: cols.leadTimeDays != null ? String(cols.leadTimeDays) : '',
    },
  };
}

export type InventoryMasterCompareRow = {
  name: string;
  category?: string | null;
  lifecycle?: string | null;
  salesCountry?: string | null;
  productCategory?: string | null;
  ownerName?: string | null;
  developerName?: string | null;
  merchantCode?: string | null;
  merchantName?: string | null;
  leadTimeDays?: number | null;
  unitCost?: string | null;
  spuId?: string | null;
  encodingMeta?: unknown;
};

function normalizeOptionalText(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeUnitCost(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? String(parsed) : trimmed;
}

function snapshotsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
}

/** 库存导入主数据与现有 SKU 完全一致时跳过写库 */
export function inventoryImportMasterUnchanged(
  existing: InventoryMasterCompareRow,
  next: {
    name: string;
    category?: string | null;
    lifecycle?: string | null;
    salesCountry?: string | null;
    productCategory?: string | null;
    ownerName?: string | null;
    developerName?: string | null;
    merchantCode?: string | null;
    merchantName?: string | null;
    leadTimeDays?: number | null;
    unitCost?: string | null;
    spuId?: string | null;
    encodingMeta: Record<string, unknown>;
  },
): boolean {
  const textFields: Array<keyof InventoryMasterCompareRow> = [
    'name',
    'category',
    'lifecycle',
    'salesCountry',
    'productCategory',
    'ownerName',
    'developerName',
    'merchantCode',
    'merchantName',
  ];

  for (const field of textFields) {
    if (
      normalizeOptionalText(existing[field] as string | null | undefined) !==
      normalizeOptionalText(next[field] as string | null | undefined)
    ) {
      return false;
    }
  }

  if ((existing.leadTimeDays ?? null) !== (next.leadTimeDays ?? null)) return false;
  if (normalizeUnitCost(existing.unitCost) !== normalizeUnitCost(next.unitCost)) return false;
  if (!existing.spuId && next.spuId) return false;

  const existingMaster = inventoryMasterFromEncodingMeta(existing.encodingMeta, {
    code: '',
    name: existing.name,
    category: existing.category,
    lifecycle: existing.lifecycle,
    salesCountry: existing.salesCountry,
    productCategory: existing.productCategory,
    ownerName: existing.ownerName,
    developerName: existing.developerName,
    merchantCode: existing.merchantCode,
    merchantName: existing.merchantName,
    leadTimeDays: existing.leadTimeDays,
  });
  const nextMaster = inventoryMasterFromEncodingMeta(next.encodingMeta, {
    code: '',
    name: next.name,
    category: next.category,
    lifecycle: next.lifecycle,
    salesCountry: next.salesCountry,
    productCategory: next.productCategory,
    ownerName: next.ownerName,
    developerName: next.developerName,
    merchantCode: next.merchantCode,
    merchantName: next.merchantName,
    leadTimeDays: next.leadTimeDays,
  });

  const masterFields: Array<keyof InventorySkuMasterFields> = [
    'category',
    'lifecycle',
    'name',
    'salesCountry',
    'productCategory',
    'merchantCode',
    'ownerName',
    'developerName',
    'merchantName',
    'leadTimeDays',
  ];
  for (const field of masterFields) {
    const left = existingMaster[field];
    const right = nextMaster[field];
    if (field === 'leadTimeDays') {
      if ((left ?? null) !== (right ?? null)) return false;
      continue;
    }
    if (normalizeOptionalText(left as string | undefined) !== normalizeOptionalText(right as string | undefined)) {
      return false;
    }
  }

  const existingSnapshot = readTurnoverSnapshot(existing.encodingMeta);
  const nextSnapshot = readTurnoverSnapshot(next.encodingMeta);

  return snapshotsEqual(existingSnapshot, nextSnapshot);
}

export function buildNextInventoryEncodingMeta(
  master: Partial<InventorySkuMasterFields>,
  skuCode: string,
  existingEncodingMeta: unknown,
  turnoverSnapshot?: Record<string, string>,
): Record<string, unknown> {
  const snapshot =
    turnoverSnapshot ??
    readTurnoverSnapshot(existingEncodingMeta);
  return mergeTurnoverSnapshotMeta(
    buildInventoryEncodingMeta(master, skuCode, existingEncodingMeta),
    snapshot,
  );
}

export function inventoryMasterFromEncodingMeta(
  encodingMeta: unknown,
  fallback: {
    code: string;
    name: string;
    category?: string | null;
    lifecycle?: string | null;
    salesCountry?: string | null;
    productCategory?: string | null;
    ownerName?: string | null;
    developerName?: string | null;
    merchantCode?: string | null;
    merchantName?: string | null;
    leadTimeDays?: number | null;
  },
): InventorySkuMasterFields {
  const meta =
    encodingMeta && typeof encodingMeta === 'object'
      ? (encodingMeta as Record<string, unknown>)
      : {};
  const raw =
    meta.inventoryMaster && typeof meta.inventoryMaster === 'object'
      ? (meta.inventoryMaster as Record<string, string>)
      : {};

  const pick = (...values: Array<string | null | undefined>) => {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  };

  const leadFromMeta = raw['采购周期'] || meta.leadTimeDays;
  const leadParsed =
    typeof leadFromMeta === 'number'
      ? leadFromMeta
      : parseInt(String(leadFromMeta ?? ''), 10);

  return {
    category: pick(fallback.category, raw['品类'], meta.category as string),
    skuCode: fallback.code,
    lifecycle: pick(fallback.lifecycle, raw['生命周期'], meta.lifecycle as string),
    name: pick(fallback.name, raw['SKU名称']),
    salesCountry: pick(fallback.salesCountry, raw['销售国家'], meta.salesCountry as string),
    productCategory: pick(fallback.productCategory, raw['产品分类'], meta.productCategory as string),
    merchantCode: pick(fallback.merchantCode, raw['供应商编码']),
    ownerName: pick(fallback.ownerName, raw['负责人'], meta.ownerName as string),
    developerName: pick(fallback.developerName, raw['开发人员'], meta.developerName as string),
    merchantName: pick(fallback.merchantName, raw['供应商简称']),
    leadTimeDays:
      fallback.leadTimeDays ??
      (Number.isFinite(leadParsed) && leadParsed > 0 ? leadParsed : undefined),
  };
}
