/**
 * 库存总览字段分组：列选择器与详情抽屉共用。
 * 顶层仅三类：主数据 / 库存数据 / 销售与预测；抽屉内再用小节细分。
 */

export const OVERVIEW_COLUMN_GROUPS = ['主数据', '库存数据', '销售与预测'] as const;

export type OverviewColumnGroup = (typeof OVERVIEW_COLUMN_GROUPS)[number];

/** 近半年海外仓销售单占比（迅捷定义；非分仓数量） */
const REGION_SALES_SHARE_HEADERS = new Set([
  '美东',
  '美南',
  '美西',
  '美中',
  '美东南',
  '德国',
  '平台仓_美',
  '平台仓_欧',
]);

/** 抽屉顶部 KPI 条（固定顺序） */
export const DRAWER_KPI_COLUMN_IDS = [
  '海外仓在库',
  '调拨在途合计',
  '供应商订单',
  '全链条合计库存',
  '预计海外周转天数',
] as const;

/** 抽屉内字段展示形态 */
export type DrawerFieldLayout = 'kpi' | 'region' | 'wide' | 'id' | 'default';

/**
 * 主数据：SKU/供应商主档 + 包装与毛利 + 运营 + 同步信息
 * 库存数据：合计在途 + 链路库存 + 周转 + 断货与上架
 * 销售与预测：近半年仓占比 + 历史销量 + 预测日均
 */
export function inferOverviewColumnGroup(header: string): OverviewColumnGroup {
  if (
    REGION_SALES_SHARE_HEADERS.has(header) ||
    header.endsWith('销量') ||
    header.includes('月销量') ||
    header.includes('预测日均')
  ) {
    return '销售与预测';
  }
  if (
    header === '海外仓在库' ||
    header === '调拨在途合计' ||
    header === '已调拨未在途' ||
    (header.includes('预计') && header.includes('上架')) ||
    header === '预下单' ||
    header === '全链条合计库存' ||
    header === '供应商订单' ||
    header.includes('周转') ||
    header.includes('断货') ||
    header.includes('上架时间') ||
    header.includes('最早上架') ||
    header.includes('在途上架')
  ) {
    return '库存数据';
  }
  return '主数据';
}

export function getDrawerFieldLayout(columnId: string): DrawerFieldLayout {
  if (
    columnId === '海外仓在库' ||
    columnId === '全链条合计库存' ||
    columnId === '预计海外周转天数' ||
    columnId === '全链条周转天数' ||
    columnId === '供应商订单' ||
    columnId === '调拨在途合计'
  ) {
    return 'kpi';
  }
  if (REGION_SALES_SHARE_HEADERS.has(columnId)) {
    return 'region';
  }
  if (
    columnId === 'SKU名称' ||
    columnId === '品类' ||
    columnId === '产品分类' ||
    columnId.includes('上架') ||
    columnId.includes('断货时间') ||
    columnId === '预计10天内|10-20天|超20天上架数量'
  ) {
    return 'wide';
  }
  if (columnId === 'Id' || columnId === 'ProductBaseID' || columnId === 'SupplierId') {
    return 'id';
  }
  return 'default';
}

/** 抽屉 Tab 内小节标题（三大类内再细分，便于扫读） */
export function getDrawerSubsectionTitle(columnId: string, group: string): string | null {
  if (group === '销售与预测') {
    if (REGION_SALES_SHARE_HEADERS.has(columnId)) return '近半年海外仓销售占比';
    if (columnId.includes('预测日均')) return '预测日均';
    return '历史销量';
  }

  if (group === '库存数据') {
    if (
      columnId === '海外仓在库' ||
      columnId === '调拨在途合计' ||
      columnId === '已调拨未在途'
    ) {
      return '合计与在途';
    }
    if (columnId.includes('上架') && !columnId.includes('断货')) return '预计上架';
    if (
      columnId === '供应商订单' ||
      columnId === '预下单' ||
      columnId === '全链条合计库存'
    ) {
      return '链路库存';
    }
    if (columnId.includes('周转')) return '周转';
    if (
      columnId.includes('断货') ||
      columnId.includes('上架时间') ||
      columnId.includes('最早上架') ||
      columnId.includes('在途上架')
    ) {
      return '断货与上架';
    }
    return '库存其他';
  }

  // 主数据
  if (columnId === 'updatedAt' || columnId === 'dataSource' || columnId === 'inventoryRecordedDate') {
    return '同步信息';
  }
  if (columnId === 'replenishLight' || columnId === 'ai') {
    return '运营';
  }
  if (columnId.includes('毛利率') || columnId.includes('退款率')) {
    return '毛利与退款';
  }
  if (columnId.includes('包装') || columnId.includes('体积') || columnId.includes('毛重')) {
    return '包装规格';
  }
  if (columnId === 'Id' || columnId === 'ProductBaseID' || columnId === 'SupplierId') {
    return '系统标识';
  }
  if (
    columnId === '供应商编码' ||
    columnId === '供应商简称' ||
    columnId === '采购周期' ||
    columnId === '采购价' ||
    columnId === '币种'
  ) {
    return '供应商与采购';
  }
  return '商品信息';
}

export function orderColumnGroups(
  entries: Array<[string, unknown]>,
): Array<[string, unknown]> {
  const order = new Map(OVERVIEW_COLUMN_GROUPS.map((g, i) => [g, i]));
  return [...entries].sort((a, b) => {
    const ai = order.get(a[0] as OverviewColumnGroup) ?? 999;
    const bi = order.get(b[0] as OverviewColumnGroup) ?? 999;
    return ai - bi;
  });
}

/** 抽屉小节展示顺序（按三大类分别定义） */
const DRAWER_SUBSECTION_ORDER: Record<OverviewColumnGroup, string[]> = {
  主数据: ['商品信息', '供应商与采购', '系统标识', '包装规格', '毛利与退款', '运营', '同步信息'],
  库存数据: ['合计与在途', '链路库存', '预计上架', '周转', '断货与上架', '库存其他'],
  销售与预测: ['近半年海外仓销售占比', '历史销量', '预测日均'],
};

export function orderDrawerSections(
  group: string,
  sections: Array<{ title: string; cols: unknown[] }>,
): Array<{ title: string; cols: unknown[] }> {
  const orderList =
    DRAWER_SUBSECTION_ORDER[group as OverviewColumnGroup] ?? [];
  const rank = new Map(orderList.map((t, i) => [t, i]));
  return [...sections].sort((a, b) => {
    const ai = rank.get(a.title) ?? 999;
    const bi = rank.get(b.title) ?? 999;
    return ai - bi;
  });
}
