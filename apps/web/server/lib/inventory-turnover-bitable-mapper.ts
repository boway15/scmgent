import { extractFieldValue, type BitableRecord } from '../integrations/feishu-bitable.js';
import {
  FEISHU_INVENTORY_TURNOVER_HEADERS,
  FEISHU_REGION_SALES_SHARE_FIELDS,
  FEISHU_REGION_STOCK_FIELDS,
} from './inventory-turnover-feishu-headers.js';

export {
  FEISHU_INVENTORY_TURNOVER_HEADERS,
  FEISHU_REGION_SALES_SHARE_FIELDS,
  FEISHU_REGION_STOCK_FIELDS,
};

export type InventoryTurnoverBitableMapResult = {
  row: Record<string, string>;
  regionSum: number;
  overseasTotal: number;
  regionOverseasMismatch: boolean;
};

function pickRaw(fields: Record<string, unknown>, ...aliases: string[]): string {
  for (const alias of aliases) {
    if (alias in fields) {
      const extracted = extractFieldValue(fields[alias]);
      if (extracted) return extracted;
    }
  }
  const normalized = new Map(
    Object.entries(fields).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, '_'), v]),
  );
  for (const alias of aliases) {
    const key = alias.trim().toLowerCase().replace(/\s+/g, '_');
    if (normalized.has(key)) {
      const extracted = extractFieldValue(normalized.get(key));
      if (extracted) return extracted;
    }
  }
  return '';
}

function parseQty(value: string): number {
  const parsed = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 销售占比：支持 0.41 / 41% */
function parseShare(value: string): number {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  if (!raw) return 0;
  const asPct = raw.endsWith('%');
  const parsed = parseFloat(asPct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(parsed)) return 0;
  return asPct ? parsed / 100 : parsed;
}

function setBoth(row: Record<string, string>, feishuKey: string, excelKey: string, value: string) {
  if (!value) return;
  row[feishuKey] = value;
  if (excelKey !== feishuKey) row[excelKey] = value;
}

function shanghaiParts(at: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? at.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? at.getUTCMonth() + 1);
  return { year, month };
}

/** monthDelta: 0=本月, -1=上月, 1=下月 */
export function calendarMonthLabel(at: Date, monthDelta: number): number {
  const { year, month } = shanghaiParts(at);
  const idx = year * 12 + (month - 1) + monthDelta;
  return ((idx % 12) + 12) % 12 + 1;
}

function recordedDateShanghai(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * 将飞书「SKU周转相关信息」一行映射为可走 FOB/周转导入的规范化行。
 * 双键写入：飞书原名 + Excel 兼容别名。
 * 美东…平台仓_欧 为近半年海外仓销售占比，仅入 snapshot，不写入 海外仓库存_*。
 */
export function mapInventoryTurnoverBitableFields(
  fields: Record<string, unknown>,
  options?: { recordedDate?: string; now?: Date },
): InventoryTurnoverBitableMapResult | null {
  const now = options?.now ?? new Date();
  const sku = pickRaw(fields, 'SKU', 'sku', 'sku_code');
  if (!sku) return null;

  const row: Record<string, string> = {
    SKU: sku,
    recorded_date: options?.recordedDate || recordedDateShanghai(now),
  };

  const copyDirect = (key: string, ...aliases: string[]) => {
    const value = pickRaw(fields, key, ...aliases);
    if (value) row[key] = value;
  };

  copyDirect('SKU名称');
  copyDirect('品类');
  copyDirect('销售国家');
  copyDirect('产品分类');
  copyDirect('负责人');
  copyDirect('开发人员');
  copyDirect('供应商编码');
  copyDirect('供应商简称');
  copyDirect('采购周期');
  copyDirect('采购价');
  copyDirect('币种');

  const feishuId = pickRaw(fields, 'Id');
  const productBaseId = pickRaw(fields, 'ProductBaseID');
  const supplierId = pickRaw(fields, 'SupplierId');
  if (feishuId) row.Id = feishuId;
  if (productBaseId) row.ProductBaseID = productBaseId;
  if (supplierId) row.SupplierId = supplierId;

  let regionSum = 0;
  let shareFieldCount = 0;
  for (const region of FEISHU_REGION_SALES_SHARE_FIELDS) {
    const value = pickRaw(fields, region);
    if (!value) continue;
    row[region] = value;
    shareFieldCount++;
    regionSum += parseShare(value);
  }

  const overseas = pickRaw(fields, '海外仓在库');
  setBoth(row, '海外仓在库', '海外仓库存_合计', overseas);
  const overseasTotal = parseQty(overseas);

  const transit = pickRaw(fields, '调拨在途合计');
  setBoth(row, '调拨在途合计', '调拨在途_合计', transit);

  const supplierOrders = pickRaw(fields, '供应商订单');
  setBoth(row, '供应商订单', '供应商订单合计', supplierOrders);

  const preOrder = pickRaw(fields, '预下单');
  if (preOrder) row['预下单'] = preOrder;

  const chainTotal = pickRaw(fields, '全链条合计库存');
  if (chainTotal) row['全链条合计库存'] = chainTotal;

  const etaPacked = pickRaw(fields, '预计10天内|10-20天|超20天上架数量');
  if (etaPacked) {
    row['预计10天内|10-20天|超20天上架数量'] = etaPacked;
    const parts = etaPacked.split('|').map((p) => p.trim());
    setBoth(row, '预计10天上架_合计', '预计10天上架_合计', parts[0] ?? '0');
    setBoth(row, '预计10-20天上架_合计', '预计10-20天上架_合计', parts[1] ?? '0');
    setBoth(row, '预计超20天上架_合计', '预计超20天上架_合计', parts[2] ?? '0');
  }

  for (const key of ['3天销量', '7天销量', '14天销量', '30天销量'] as const) {
    const value = pickRaw(fields, key);
    if (value) row[key] = value;
  }

  const lastMonthSales = pickRaw(fields, '上月销量');
  const prevPrevSales = pickRaw(fields, '上上月销量');
  if (lastMonthSales) {
    row['上月销量'] = lastMonthSales;
    row[`${calendarMonthLabel(now, -1)}月销量`] = lastMonthSales;
  }
  if (prevPrevSales) {
    row['上上月销量'] = prevPrevSales;
    row[`${calendarMonthLabel(now, -2)}月销量`] = prevPrevSales;
  }

  const forecastPairs: Array<[string, number]> = [
    ['本月预测日均销量', 0],
    ['下月预测日均销量', 1],
    ['下2月预测日均销量', 2],
    ['下3月预测日均销量', 3],
    ['下4月预测日均销量', 4],
  ];
  for (const [feishuKey, delta] of forecastPairs) {
    const value = pickRaw(fields, feishuKey);
    if (!value) continue;
    row[feishuKey] = value;
    row[`${calendarMonthLabel(now, delta)}月预测日均销量`] = value;
  }

  setBoth(row, '预计海外仓周转天数', '海外仓周转_合计', pickRaw(fields, '预计海外仓周转天数'));
  setBoth(row, '预计海外在途周转天数', '海外在途周转_合计', pickRaw(fields, '预计海外在途周转天数'));
  setBoth(row, '预计海外周转天数', '海外周转_合计', pickRaw(fields, '预计海外周转天数'));
  setBoth(row, '预计国内周转', '国内周转天数', pickRaw(fields, '预计国内周转'));
  const fullChainTurnover = pickRaw(fields, '预计全链条周转');
  if (fullChainTurnover) row['预计全链条周转'] = fullChainTurnover;

  const earliestPo = pickRaw(fields, '采购单最早上架时间');
  if (earliestPo) row['采购单最早上架时间'] = earliestPo;
  const domesticStockoutDays = pickRaw(fields, '预计国内断货天数');
  if (domesticStockoutDays) row['预计国内断货天数'] = domesticStockoutDays;
  const earliestTransit = pickRaw(fields, '最早在途上架时间');
  if (earliestTransit) row['最早在途上架时间'] = earliestTransit;

  setBoth(row, '预计海外断货天数', '海外断货天数_合计', pickRaw(fields, '预计海外断货天数'));
  setBoth(row, '预计海外仓断货时间', '海外仓断货时间_合计', pickRaw(fields, '预计海外仓断货时间'));
  setBoth(row, '预计海外断货时间', '海外断货时间_合计', pickRaw(fields, '预计海外断货时间'));
  setBoth(row, '预计全链条断货时间', '全链条断货时间_合计', pickRaw(fields, '预计全链条断货时间'));

  const chainStockoutNoPre = pickRaw(fields, '全链条断货时间(不含预下单)');
  if (chainStockoutNoPre) {
    row['全链条断货时间(不含预下单)'] = chainStockoutNoPre;
    row['全链条断货时间（不含预下单）_合计'] = chainStockoutNoPre;
  }

  const pack = pickRaw(fields, '包装长宽高cm');
  if (pack) row['包装长宽高cm'] = pack;

  const volume = pickRaw(fields, '体积(m3)', '体积（m3）');
  if (volume) {
    row['体积(m3)'] = volume;
    row['体积（m3）'] = volume;
  }
  const weight = pickRaw(fields, '毛重(Kg)', '毛重（Kg）');
  if (weight) {
    row['毛重(Kg)'] = weight;
    row['毛重（Kg）'] = weight;
  }

  setBoth(row, '近30天毛利率', '近30毛利率', pickRaw(fields, '近30天毛利率', '近30毛利率'));
  setBoth(row, '近90天毛利率', '近90天毛利率', pickRaw(fields, '近90天毛利率'));
  setBoth(
    row,
    '近30天毛利率(AMZ)',
    '亚马逊近30毛利率',
    pickRaw(fields, '近30天毛利率(AMZ)'),
  );
  setBoth(
    row,
    '近90天毛利率(AMZ)',
    '亚马逊近90天毛利率',
    pickRaw(fields, '近90天毛利率(AMZ)'),
  );
  setBoth(
    row,
    '近30天毛利率(AMZ不含计提)',
    '亚马逊近30毛利率不含计提',
    pickRaw(fields, '近30天毛利率(AMZ不含计提)'),
  );
  setBoth(
    row,
    '近90天毛利率(AMZ不含计提)',
    '亚马逊近90天毛利率不含计提',
    pickRaw(fields, '近90天毛利率(AMZ不含计提)'),
  );

  const refund = pickRaw(fields, '近3月退款率');
  if (refund) row['近3月退款率'] = refund;
  const chainDays = pickRaw(fields, '全链条周转天数');
  if (chainDays) row['全链条周转天数'] = chainDays;
  const stockout30 = pickRaw(fields, '近30天断货天数');
  if (stockout30) row['近30天断货天数'] = stockout30;

  setBoth(row, '已调拨未在途', '已调拨未在途_合计', pickRaw(fields, '已调拨未在途'));

  // 占比合计应接近 1；与「海外仓在库」数量无关
  const mismatch =
    shareFieldCount > 0 && regionSum > 0 && Math.abs(regionSum - 1) > 0.05;

  return {
    row,
    regionSum,
    overseasTotal,
    regionOverseasMismatch: mismatch,
  };
}

export function mapInventoryTurnoverBitableRecord(
  record: BitableRecord,
  options?: { recordedDate?: string; now?: Date },
): InventoryTurnoverBitableMapResult | null {
  return mapInventoryTurnoverBitableFields(record.fields, options);
}

export function mapInventoryTurnoverBitableRecords(
  records: BitableRecord[],
  options?: { recordedDate?: string; now?: Date },
): {
  rows: Array<Record<string, string>>;
  mismatchCount: number;
  skipped: number;
} {
  const rows: Array<Record<string, string>> = [];
  let mismatchCount = 0;
  let skipped = 0;

  for (const record of records) {
    const mapped = mapInventoryTurnoverBitableRecord(record, options);
    if (!mapped) {
      skipped++;
      continue;
    }
    if (mapped.regionOverseasMismatch) mismatchCount++;
    rows.push(mapped.row);
  }

  return { rows, mismatchCount, skipped };
}

/** 识别飞书压缩周转表（映射前或映射后） */
export function isFeishuCompressedTurnoverFormat(rows: Array<Record<string, string>>): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]!);
  const hasOverseas = keys.some((k) => k === '海外仓在库' || k === '海外仓库存_合计');
  const hasTransit = keys.some((k) => k === '调拨在途合计' || k === '调拨在途_合计');
  const hasRegion = FEISHU_REGION_SALES_SHARE_FIELDS.some((r) => keys.includes(r))
    || keys.some((k) => k.startsWith('海外仓库存_') && !k.endsWith('合计'));
  return hasOverseas && hasTransit && hasRegion;
}
