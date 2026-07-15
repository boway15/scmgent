import type { ImportType, BitableSyncType } from '@/lib/api';

export type ImportResultSummary = {
  imported: number;
  errors: string[];
  createdSkus?: number;
  updatedSkus?: number;
  enrichedSkus?: number;
  insertedDailyRows?: number;
  skippedDailyRows?: number;
  upsertedMonthlyRows?: number;
  batchStatus?: string;
};

export function formatImportResult(r: ImportResultSummary): string {
  if (r.insertedDailyRows != null) {
    const parts = [`日销量新增 ${r.insertedDailyRows.toLocaleString()} 条`];
    if (r.skippedDailyRows) parts.push(`跳过已有 ${r.skippedDailyRows.toLocaleString()}`);
    if (r.upsertedMonthlyRows != null) parts.push(`月表聚合 ${r.upsertedMonthlyRows.toLocaleString()}`);
    if (r.createdSkus) parts.push(`新建 SKU ${r.createdSkus}`);
    parts.push(`批次 ${r.batchStatus ?? '-'}`);
    parts.push(`错误：${r.errors.slice(0, 5).join('; ') || '无'}`);
    return parts.join('；');
  }
  const parts = [`导入 ${r.imported.toLocaleString()} 条`];
  if (r.skippedDailyRows) parts.push(`日销量跳过 ${r.skippedDailyRows.toLocaleString()}`);
  if (r.upsertedMonthlyRows != null) parts.push(`月表聚合 ${r.upsertedMonthlyRows}`);
  if (r.createdSkus) parts.push(`新建 SKU ${r.createdSkus}`);
  if (r.enrichedSkus) parts.push(`补全 SKU ${r.enrichedSkus}`);
  if (r.updatedSkus) parts.push(`更新 SKU ${r.updatedSkus}`);
  parts.push(`批次 ${r.batchStatus ?? '-'}`);
  parts.push(`错误：${r.errors.slice(0, 5).join('; ') || '无'}`);
  return parts.join('；');
}

export const IMPORT_TEMPLATES: Record<
  ImportType,
  { title: string; hint: string; sample: string }
> = {
  skus: {
    title: 'SKU 主数据',
    hint: '列：sku_code（支持标准9位/外部15位，或 legacy：DJ502313_34、DJ478585_2P02 等）, external_code, name, unit；重复 sku_code 将更新已有记录（空列保留原值）',
    sample: `sku_code,name,unit,spu_moq,category,lead_time_days,production_lead_days,moq,unit_cost,merchant_code,merchant_name,replenish_light
704576101,PETOY款-标准,pcs,500,宠物用品,25,50,100,8.5,M-PET-001,宠物工厂,red
DJ502313_34,大件款-变参34,pcs,200,大件,30,50,50,12.0,M-DJ-001,大件工厂,red
DJ478585_2P02,大件款2号-配件02,pcs,,大件,30,50,10,3.5,M-DJ-001,大件工厂,green
DJ485882P01,大件款-通用配件01,pcs,,大件,30,50,20,2.0,M-DJ-001,大件工厂,green`,
  },
  inventory: {
    title: '库存盘点',
    hint: '支持三种格式：① 标准列；② 旧 FOB 导出；③ SKU库存周转查询明细（库存 V:AD/BF:BN/BO:BS/CC，SKU 主数据 A:K）。**请用「上传文件」导入 xlsx**（约 5500 行将自动后台导入，在下方批次查看进度）；勿用粘贴框导入大表',
    sample: `sku_code,warehouse,qty_available,qty_in_transit,qty_in_production,recorded_date
DJ502313_34,US-WEST,120,80,0,2026-06-01
DJ502313_34,IN-PRODUCTION,0,0,45,2026-06-01`,
  },
  sales: {
    title: '日销量宽表（自动聚合月表）',
    hint: '上传 xiaoshou 产品销售报表-每日 CSV（列头含 (YYYY-MM-DD)）。导入结束自动：写日表 → 聚月表 → 裁剪超保留期日明细。',
    sample: '',
  },
  safety_stock: {
    title: '库存策略',
    hint: '列：sku_code, warehouse_code, safety_stock_days, target_coverage_days, overstock_threshold_days, safety_stock_qty, reorder_point, reorder_qty',
    sample: `sku_code,warehouse_code,safety_stock_days,target_coverage_days,overstock_threshold_days,safety_stock_qty,reorder_point,reorder_qty
DJ502313_34,US-WEST,14,130,180,200,400,1000`,
  },
  merchants: {
    title: '供应商/工厂',
    hint: '列：merchant_code, merchant_name, production_lead_days, contact_name, contact_phone, payment_terms',
    sample: `merchant_code,merchant_name,production_lead_days,contact_name,contact_phone,payment_terms
M-HM-001,顺德家居供应链,50,张工,13800000000,月结30天`,
  },
  pmc_plans: {
    title: '下单计划',
    hint: '列：sku_code, planned_qty, unit（可选）。需填写商家编号；计划名称/日期可在下方填写',
    sample: `sku_code,planned_qty,unit
DJ502313_34,200,pcs
DJ502952_1,500,pcs`,
  },
};

const BITABLE_SYNC_TYPES = new Set<BitableSyncType>([
  'skus',
  'inventory',
  'merchants',
  'inventory_policy',
]);

function isBitableSyncType(type: ImportType): type is BitableSyncType {
  return BITABLE_SYNC_TYPES.has(type as BitableSyncType);
}

export function bitableTypeForImport(type: ImportType): BitableSyncType | null {
  if (type === 'safety_stock') return 'inventory_policy';
  if (isBitableSyncType(type)) return type;
  return null;
}

/** 旧 /data/import?type= 重定向目标 */
export const IMPORT_TYPE_REDIRECT: Record<string, string> = {
  inventory: '/inventory/overview?import=1',
  skus: '/data/products?import=1',
  merchants: '/data/products?import=1&tab=merchant',
  sales: '/data/sales?import=1',
  sales_forecast: '/data/forecast',
  safety_stock: '/inventory/safety?import=1',
  pmc_plans: '/pmc/list?import=1',
};

export function importRedirectPath(type: string | null): string {
  if (type && type in IMPORT_TYPE_REDIRECT) return IMPORT_TYPE_REDIRECT[type];
  return '/inventory/overview?import=1';
}
