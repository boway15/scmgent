import { pickField } from './import/parse.js';
import { extractTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import {
  parseTurnoverWarehouseBuckets,
  type TurnoverWarehouseBucket,
} from './turnover-bucket-warehouse.js';

export type FobInventoryExpandedRow = {
  skuCode: string;
  name: string;
  category?: string;
  /** C 生命周期 */
  lifecycle?: string;
  /** E 销售国家（原始值） */
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
  /** K 采购周期 */
  leadTimeDays?: number;
  region: string;
  unitCost?: string;
  warehouse: string;
  qtyAvailable: number;
  qtyInTransit: number;
  /** 已向工厂下单且有合同（供应商订单 BO:BS） */
  qtyInProduction: number;
  /** 预下单：已向工厂下单但尚无合同（CC） */
  qtyPreOrder: number;
  /** 全链条合计库存（CD），用于校验 */
  qtyChainTotal?: number;
  recordedDate: string;
  /** 除 A:K 主数据外的导入列原值 */
  turnoverSnapshot?: Record<string, string>;
  /** 周转表分区仓库存（美东/美南/…），禁止合并为区域 FOB 仓 */
  warehouseBuckets?: TurnoverWarehouseBucket[];
};

function normalizeLookupKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '');
}

function rowKeys(row: Record<string, string>): string[] {
  return Object.keys(row);
}

function parseQty(value: string | undefined): number {
  const parsed = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumRowFields(row: Record<string, string>, aliases: string[]): number {
  let total = 0;
  const normalizedAliases = new Set(aliases.map(normalizeLookupKey));

  for (const key of rowKeys(row)) {
    const normalizedKey = normalizeLookupKey(key);
    if (!normalizedAliases.has(normalizedKey)) continue;
    total += parseQty(row[key]);
  }

  return total;
}

function pickRowField(row: Record<string, string>, ...aliases: string[]): string {
  const direct = pickField(row, ...aliases);
  if (direct) return direct;

  const normalizedAliases = new Set(aliases.map(normalizeLookupKey));
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    if (normalizedAliases.has(normalizeLookupKey(key))) return value;
  }
  return '';
}

/** SKU库存周转情况查询-明细：V:AD 海外仓、BF:BN 在途、BO:BS 有合同在产、CC 预下单、CD 全链合计 */
function isTurnoverInventoryFormat(rows: Array<Record<string, string>>): boolean {
  if (!rows.length) return false;
  const keys = rowKeys(rows[0]);
  const hasOverseasBucket = keys.some((key) => key.includes('海外仓库存_'));
  const hasTransitBucket = keys.some((key) => key.includes('调拨在途_'));
  const hasSupplierOrders = keys.some(
    (key) => key.includes('供应商订单') || key.includes('截止当月供应商订单'),
  );
  return hasOverseasBucket && hasTransitBucket && hasSupplierOrders;
}

function sumDetailColumnsByPrefix(
  row: Record<string, string>,
  prefix: string,
  totalColumn?: string,
): number {
  if (totalColumn) {
    const total = parseQty(pickRowField(row, totalColumn));
    if (total > 0 || pickRowField(row, totalColumn) !== '') {
      return total;
    }
  }

  let total = 0;
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(prefix)) continue;
    if (key.endsWith('合计')) continue;
    total += parseQty(value);
  }
  return total;
}

function sumSupplierOrderQty(row: Record<string, string>): number {
  const total = parseQty(pickRowField(row, '供应商订单合计'));
  if (total > 0 || pickRowField(row, '供应商订单合计') !== '') {
    return total;
  }

  return sumRowFields(row, [
    '截止当月供应商订单数',
    '第二个月供应商订单数',
    '第三个月供应商订单数',
    '第四个月及之后订单数',
  ]);
}

function mapSalesCountryToRegion(raw: string): string {
  const value = raw.trim();
  if (!value) return 'US';
  if (value.includes('美国') || /^us$/i.test(value)) return 'US';
  if (value.includes('英国') || /^uk$/i.test(value)) return 'UK';
  if (value.includes('德国') || value.includes('法国') || /欧洲|eu/i.test(value)) return 'EU';
  const first = value.split(/[,，]/)[0]?.trim() ?? value;
  if (first.includes('美')) return 'US';
  if (first.includes('英')) return 'UK';
  if (first.includes('德') || first.includes('法')) return 'EU';
  return first.slice(0, 8).toUpperCase().replace(/\s+/g, '-') || 'US';
}

export function isFobInventoryFormat(rows: Array<Record<string, string>>): boolean {
  if (!rows.length) return false;

  if (isTurnoverInventoryFormat(rows)) return true;

  const keys = rowKeys(rows[0]);
  const hasSku = keys.some((key) => normalizeLookupKey(key) === 'sku');
  const hasFobMarkers = keys.some(
    (key) => key.includes('品名') || key.includes('全链库存') || key.includes('海外库存'),
  );
  const hasSimpleWarehouse = keys.some((key) =>
    ['warehouse', 'warehouse_code'].includes(normalizeLookupKey(key)),
  );
  const wideSkuExport = hasSku && keys.length >= 15 && !hasSimpleWarehouse;

  return (hasSku && hasFobMarkers && !hasSimpleWarehouse) || wideSkuExport;
}

function parseLeadTimeDays(raw: string): number | undefined {
  const parsed = parseInt(String(raw ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractTurnoverSkuMaster(row: Record<string, string>) {
  const unitCostRaw = pickRowField(row, '采购价', '成本单价', 'unit_cost');
  const unitCost =
    unitCostRaw && /^-?\d+(\.\d+)?$/.test(unitCostRaw.replace(/,/g, '')) ? unitCostRaw : undefined;

  return {
    category: pickRowField(row, '品类', 'category') || undefined,
    lifecycle: pickRowField(row, '生命周期', 'lifecycle') || undefined,
    name: pickRowField(row, 'sku名称', '品名', 'name') || '',
    salesCountry: pickRowField(row, '销售国家', '区域', 'region', 'station') || undefined,
    productCategory: pickRowField(row, '产品分类') || undefined,
    merchantCode: pickRowField(row, '供应商编码', 'merchant_code') || undefined,
    ownerName: pickRowField(row, '负责人', 'owner_name') || undefined,
    developerName: pickRowField(row, '开发人员') || undefined,
    merchantName: pickRowField(row, '供应商简称', 'merchant_name') || undefined,
    leadTimeDays: parseLeadTimeDays(pickRowField(row, '采购周期', 'production_lead_days')),
    unitCost,
  };
}

function expandLegacyFobInventoryRow(
  row: Record<string, string>,
  date: string,
): FobInventoryExpandedRow | null {
  const skuCode = pickRowField(row, 'sku', 'sku_code', 'code', 'SKU');
  if (!skuCode) return null;

  const region = (pickRowField(row, '区域', 'region', 'station') || 'US').toUpperCase();
  const warehouse = `${region}-FOB`;

  const qtyAvailable = sumRowFields(row, [
    '海外库存',
    'fba库存',
    '海外三方仓库存',
    '海外平台仓库存',
  ]);
  const qtyInTransit = sumRowFields(row, [
    '采购在途',
    '调拨(国内-海外)',
    '调拨(国内-fba)',
    '调拨(国内-海外三方仓)',
    '调拨(国内-海外平台仓)',
    '调拨（海外|fba-海外|fba）',
    '调拨(海外|fba-海外|fba)',
  ]);
  const qtyInProduction = sumRowFields(row, ['国内库存', '预下单', '备货审批中']);

  const unitCostRaw = pickRowField(row, '成本单价', 'unit_cost', '采购价');
  const unitCost =
    unitCostRaw && /^-?\d+(\.\d+)?$/.test(unitCostRaw.replace(/,/g, '')) ? unitCostRaw : undefined;

  return {
    skuCode,
    turnoverSnapshot: extractTurnoverSnapshot(row),
    name: pickRowField(row, '品名', 'name', 'sku名称') || skuCode,
    category: pickRowField(row, '品类', 'category') || undefined,
    lifecycle: pickRowField(row, '生命周期', 'lifecycle') || undefined,
    salesCountry: pickRowField(row, '区域', 'region', 'station', '销售国家') || undefined,
    productCategory: pickRowField(row, '产品分类') || undefined,
    merchantCode: pickRowField(row, '供应商编码', 'merchant_code') || undefined,
    ownerName: pickRowField(row, '负责人', 'owner_name') || undefined,
    developerName: pickRowField(row, '开发人员') || undefined,
    merchantName: pickRowField(row, '供应商简称', 'merchant_name') || undefined,
    leadTimeDays: parseLeadTimeDays(pickRowField(row, '采购周期', 'production_lead_days')),
    region,
    unitCost,
    warehouse,
    qtyAvailable,
    qtyInTransit,
    qtyInProduction,
    qtyPreOrder: 0,
    recordedDate: pickRowField(row, 'recorded_date') || date,
  };
}

function expandTurnoverInventoryRow(
  row: Record<string, string>,
  date: string,
): FobInventoryExpandedRow | null {
  const skuCode = pickRowField(row, 'sku', 'sku_code', 'code', 'SKU');
  if (!skuCode) return null;

  const region = mapSalesCountryToRegion(
    pickRowField(row, '销售国家', '区域', 'region', 'station'),
  );

  const qtyInProduction = sumSupplierOrderQty(row);
  const qtyPreOrder = parseQty(pickRowField(row, '预下单'));
  const qtyChainTotalRaw = pickRowField(row, '全链条合计库存', '全链库存总数');
  const qtyChainTotal = qtyChainTotalRaw ? parseQty(qtyChainTotalRaw) : undefined;
  const warehouseBuckets = parseTurnoverWarehouseBuckets(row);

  const master = extractTurnoverSkuMaster(row);

  return {
    skuCode,
    turnoverSnapshot: extractTurnoverSnapshot(row),
    name: master.name || skuCode,
    category: master.category,
    lifecycle: master.lifecycle,
    salesCountry: master.salesCountry,
    productCategory: master.productCategory,
    merchantCode: master.merchantCode,
    ownerName: master.ownerName,
    developerName: master.developerName,
    merchantName: master.merchantName,
    leadTimeDays: master.leadTimeDays,
    region,
    unitCost: master.unitCost,
    warehouse: warehouseBuckets[0]?.warehouse ?? `${region}-FOB`,
    qtyAvailable: warehouseBuckets[0]?.qtyAvailable ?? 0,
    qtyInTransit: warehouseBuckets[0]?.qtyInTransit ?? 0,
    warehouseBuckets,
    qtyInProduction,
    qtyPreOrder,
    qtyChainTotal,
    recordedDate: pickRowField(row, 'recorded_date') || date,
  };
}

export function expandFobInventoryRows(
  rows: Array<Record<string, string>>,
  recordedDate?: string,
): FobInventoryExpandedRow[] {
  const date = recordedDate || new Date().toISOString().slice(0, 10);
  const turnover = isTurnoverInventoryFormat(rows);
  const expanded: FobInventoryExpandedRow[] = [];

  for (const row of rows) {
    const mapped = turnover
      ? expandTurnoverInventoryRow(row, date)
      : expandLegacyFobInventoryRow(row, date);
    if (mapped) expanded.push(mapped);
  }

  return expanded;
}
