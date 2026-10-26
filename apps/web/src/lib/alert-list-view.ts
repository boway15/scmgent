import type { api } from '@/lib/api';
import { ALERT_LEVEL_LABEL, INVENTORY_RISK_SCENES, PRICE_REASON_LABEL } from '@/lib/inventory-risk-scenes';
import { orderRecommendationFields, shipRecommendationFields, RECOMMEND_EMPTY } from '@/lib/alert-recommendation-display';

export type AlertListItem = Awaited<ReturnType<typeof api.getAlerts>>['items'][number];

const ACTION_LABEL = Object.fromEntries(INVENTORY_RISK_SCENES.map((item) => [item.view, item.label]));

/** 与列表 QtyCell / DateCell 一致 */
export const ALERT_EMPTY = '—';
/** 与建议列 RecommendDateCell / RecommendQtyCell 空值一致（与 alert-recommendation-display 同源） */
export { RECOMMEND_EMPTY } from '@/lib/alert-recommendation-display';

export function formatAlertQty(value: number | null | undefined): string {
  if (value == null) return ALERT_EMPTY;
  return value.toLocaleString('zh-CN');
}

/** 周转销量三列：表头「销量」下分 7/14/30 天 */
export function formatAlertSalesDays(item: {
  turnoverSales7d?: number | null;
  turnoverSales14d?: number | null;
  turnoverSales30d?: number | null;
}): [string, string, string] {
  return [
    formatAlertQty(item.turnoverSales7d),
    formatAlertQty(item.turnoverSales14d),
    formatAlertQty(item.turnoverSales30d),
  ];
}

/** 周转 7/14/30 天销量，单格展示 */
export function formatAlertSalesWindow(item: {
  turnoverSales7d?: number | null;
  turnoverSales14d?: number | null;
  turnoverSales30d?: number | null;
}): string {
  return formatAlertSalesDays(item).join('/');
}

export function formatAlertDays(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ALERT_EMPTY;
  return `${Math.round(value)}天`;
}

export function formatAlertDate(value: string | null | undefined): string {
  if (!value) return ALERT_EMPTY;
  return value.slice(0, 10);
}

export function formatAlertGap(value: number | null | undefined, covered?: boolean): string {
  if (covered) return '0';
  if (value == null) return ALERT_EMPTY;
  return formatAlertQty(value);
}

export function formatAlertCategory(item: Pick<
  AlertListItem,
  'action' | 'hasShippableLots' | 'hasUnallocatedLocal'
>): string {
  const hints: string[] = [];
  if ((item.action === 'ship_urgent' || item.action === 'ship') && !item.hasShippableLots) {
    hints.push('暂无可发，等完工');
  }
  if (item.hasUnallocatedLocal) hints.push('有未定仓未发');
  const main = item.action ? (ACTION_LABEL[item.action] ?? item.action) : ALERT_EMPTY;
  if (!hints.length) return main;
  return `${main}；${hints.join('；')}`;
}

export function formatAlertLevel(level: string | null | undefined): string {
  if (!level) return ALERT_EMPTY;
  return ALERT_LEVEL_LABEL[level] ?? level;
}

function recommendationCells(item: AlertListItem): [string, string, string, string, string, string] {
  const order = orderRecommendationFields(item);
  const ship = shipRecommendationFields(item);
  return [
    order.yesLabel,
    order.yes ? order.date : RECOMMEND_EMPTY,
    order.qty,
    ship.yesLabel,
    ship.yes ? ship.date : RECOMMEND_EMPTY,
    ship.qty,
  ];
}

/** 导出表头：无 children 的列纵向合并两行；有 children 的列第一行合并、第二行是子列 */
export type AlertExportHeaderSpan = {
  label: string;
  children?: readonly string[];
};

/** SKU 全网导出，分组与页面表头一致；销量拆成 7/14/30 天 */
export const SKU_LIST_HEADER: readonly AlertExportHeaderSpan[] = [
  { label: 'SKU' },
  { label: '销量', children: ['7天', '14天', '30天'] },
  { label: '等级' },
  { label: '分类' },
  { label: '库存', children: ['未发', '在库', '在途'] },
  { label: '可售', children: ['含未发', '在库+在途', '预计断货'] },
  { label: '需求', children: ['150d', '120d', '90d'] },
  { label: '缺口', children: ['90d', '120d', '150d'] },
  { label: '建议下单', children: ['是否', '下单日期', '下单数量'] },
  { label: '建议发货', children: ['是否', '发货日期', '发货数量'] },
];

export function skuListRowValues(item: AlertListItem): string[] {
  const [oYes, oDate, oQty, sYes, sDate, sQty] = recommendationCells(item);
  return [
    item.skuCode,
    ...formatAlertSalesDays(item),
    formatAlertLevel(item.level),
    formatAlertCategory(item),
    formatAlertQty(item.networkLocalQty),
    formatAlertQty(item.networkOverseasQty),
    formatAlertQty(item.networkInTransitQty),
    formatAlertDays(item.networkBandDays),
    formatAlertDays(item.networkOnHandTransitDays),
    formatAlertDate(item.networkStockoutDate),
    formatAlertQty(item.demand150),
    formatAlertQty(item.demand120),
    formatAlertQty(item.demand90),
    formatAlertGap(item.gap90, item.orderWindowCovered),
    formatAlertGap(item.gap120, item.orderWindowCovered),
    formatAlertGap(item.gap150, item.orderWindowCovered),
    oYes,
    oDate,
    oQty,
    sYes,
    sDate,
    sQty,
  ];
}

/** SKU × 仓库导出（不含「操作」列） */
export const WAREHOUSE_LIST_HEADER: readonly AlertExportHeaderSpan[] = [
  { label: 'SKU' },
  { label: '销量', children: ['7天', '14天', '30天'] },
  { label: '仓库' },
  { label: '等级' },
  { label: '分类' },
  { label: '原因' },
  { label: '天数' },
  {
    label: '本仓',
    children: ['未发', '在库', '在途', '在库可售', '在途可售', '在库在途可售', '在途未定', '未来需求', '预计缺货'],
  },
  {
    label: '全网合计',
    children: ['天数', '在库在途可售', '未发', '在库', '在途', '未来需求', '预计缺货'],
  },
];

export function warehouseListRowValues(item: AlertListItem): string[] {
  return [
    item.skuCode,
    ...formatAlertSalesDays(item),
    item.warehouseCode ?? ALERT_EMPTY,
    formatAlertLevel(item.level),
    formatAlertCategory(item),
    item.priceReason ? (PRICE_REASON_LABEL[item.priceReason] ?? item.priceReason) : ALERT_EMPTY,
    formatAlertDays(item.bandDays),
    formatAlertQty(item.localQty),
    formatAlertQty(item.overseasQty),
    formatAlertQty(item.inTransitQty),
    formatAlertDays(item.onHandCoverageDays),
    formatAlertDays(item.inTransitCoverageDays),
    formatAlertDays(item.warehouseOnHandTransitDays),
    formatAlertQty(item.inTransitUndatedQty),
    formatAlertQty(item.futureNeedQty),
    formatAlertDate(item.projectedStockoutDate),
    formatAlertDays(item.networkBandDays),
    formatAlertDays(item.networkOnHandTransitDays),
    formatAlertQty(item.networkLocalQty),
    formatAlertQty(item.networkOverseasQty),
    formatAlertQty(item.networkInTransitQty),
    formatAlertQty(item.networkFutureNeedQty),
    formatAlertDate(item.networkStockoutDate),
  ];
}
