/**
 * 库存总览 × 商品主数据 字段归属契约。
 *
 * 已拍板（2026-07-24）：
 * 1. 飞书可覆盖的主字段：全量覆盖，但「有变化才写库、无变化跳过」
 * 2. 商品主数据允许手工新建飞书尚不存在的 SKU
 * 3. lifecycle：系统按销量自动计算（classifySalesLifecycle → 中文标签）
 * 4. moq / unit / replenishLight / isActive：商品主数据权威，飞书不同步
 */

export type FieldOwner =
  | 'feishu_inventory' // 飞书同步可写入/覆盖（仅有变化时 update）
  | 'product_master' // 仅商品主数据维护；飞书不同步该列
  | 'shared_read' // 两边只读展示，来自飞书快照或计算
  | 'system'; // 系统派生

export type OwnershipRow = {
  field: string;
  storage: string;
  owner: FieldOwner;
  notes: string;
};

/** 与商品主数据 / 库存总览边界相关的字段归属（测试与文档共用） */
export const INVENTORY_PRODUCT_FIELD_OWNERSHIP: OwnershipRow[] = [
  {
    field: 'code',
    storage: 'skus.code',
    owner: 'feishu_inventory',
    notes: '飞书 SKU 为准；缺失则 ensureSku 创建；亦允许商品主数据手工新建',
  },
  {
    field: 'name',
    storage: 'skus.name',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'category',
    storage: 'skus.category',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'salesCountry',
    storage: 'skus.salesCountry',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'productCategory',
    storage: 'skus.productCategory',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'ownerName / developerName',
    storage: 'skus.owner_name / developer_name',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'merchantCode / merchantName / leadTimeDays / unitCost',
    storage: 'skus + sku_suppliers',
    owner: 'feishu_inventory',
    notes: '飞书覆盖；无变化不写库',
  },
  {
    field: 'lifecycle',
    storage: 'skus.lifecycle',
    owner: 'system',
    notes: '默认为空；有销量后按 classifySalesLifecycle 写入中文标签；库存/飞书导入不覆盖',
  },
  {
    field: 'moq / unit / replenishLight / isActive',
    storage: 'skus',
    owner: 'product_master',
    notes: '商品主数据可人工维护 replenishLight；补货/健康任务会回写（replenishLightManual 锁定除外）；飞书不同步',
  },
  {
    field: '包装长宽高 / 体积 / 毛重',
    storage: 'skus.encoding_meta.turnoverSnapshot',
    owner: 'shared_read',
    notes: '飞书写入快照；两页只读展示',
  },
  {
    field: '分仓/在产/预下单库存',
    storage: 'inventory_records (+ snapshot)',
    owner: 'feishu_inventory',
    notes: '仅库存总览维护入口（同步/导入）',
  },
  {
    field: '销量/预测/周转/断货宽表列',
    storage: 'skus.encoding_meta.turnoverSnapshot',
    owner: 'shared_read',
    notes: '库存总览权威展示；部分销量亦实时聚合 sales_history',
  },
];

export function ownershipByField(field: string): OwnershipRow | undefined {
  return INVENTORY_PRODUCT_FIELD_OWNERSHIP.find((row) => row.field === field);
}

/** 飞书同步允许回写到 skus 列的字段（不含 lifecycle / moq / unit / light） */
export const FEISHU_SYNC_SKU_COLUMN_KEYS = [
  'name',
  'category',
  'salesCountry',
  'productCategory',
  'ownerName',
  'developerName',
  'merchantCode',
  'merchantName',
  'leadTimeDays',
  'unitCost',
] as const;

/** 飞书同步明确不覆盖的 skus 列 */
export const FEISHU_SYNC_PRESERVED_SKU_COLUMN_KEYS = [
  'lifecycle',
  'moq',
  'unit',
  'replenishLight',
  'isActive',
] as const;
