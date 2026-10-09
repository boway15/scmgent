export const INVENTORY_RISK_SCENES = [
  {
    view: 'stockout_now',
    label: '已断货',
    hint: '在库+在途可售天数 ≤ 0：断货日已到或已无海外在库在途供给（不含本地）。',
    href: '/inventory/alerts?view=stockout_now',
  },
  {
    view: 'stockout_imminent',
    label: '即将断货',
    hint: '在库+在途可售仍短于海运交期，但尚未到断货日：船期来不及或本地货还不能发。',
    href: '/inventory/alerts?view=stockout_imminent',
  },
  {
    view: 'ship_urgent',
    label: '紧急发货',
    hint: '确定供给还能撑过海运，但最晚 7 天内必须开船。不含本地，不含无日期在途。',
    href: '/inventory/alerts?view=ship_urgent',
  },
  {
    view: 'ship',
    label: '发货',
    hint: '最晚开船日在 8–15 天。不含本地，不含无日期在途。',
    href: '/inventory/alerts?view=ship',
  },
  {
    view: 'order_tight',
    label: '下单 · 90 天',
    hint: '含本地可售不超过 90 天。',
    href: '/inventory/alerts?view=order_tight',
  },
  {
    view: 'order',
    label: '下单 · 120 天',
    hint: '含本地可售 91–120 天。',
    href: '/inventory/alerts?view=order',
  },
  {
    view: 'healthy',
    label: '健康',
    hint: '含 120–150 天。可售天数含本地库存。',
    href: '/inventory/alerts?view=healthy',
  },
  {
    view: 'mild_overstock',
    label: '轻度超备',
    hint: '含本地可售 151–180 天。绿灯安全覆盖落在此档。',
    href: '/inventory/alerts?view=mild_overstock',
  },
  {
    view: 'overstock',
    label: '超备',
    hint: '含本地可售 181–300 天。灰灯滞销按可售天数落入本档或 300 天以上。',
    href: '/inventory/alerts?view=overstock',
  },
  {
    view: 'confirmed_slow',
    label: '确定性滞销',
    hint: '含本地可售超过 300 天。无预测日均时按 0 计，可售封顶 9999 天。',
    href: '/inventory/alerts?view=confirmed_slow',
  },
] as const;

export type InventoryRiskView = (typeof INVENTORY_RISK_SCENES)[number]['view'];

export const PRICE_REASON_LABEL: Record<string, string> = {
  already_out: '已断货',
  ship_late: '船期来不及',
  not_ready: '货还不能发',
};

export const ALERT_LEVEL_LABEL: Record<string, string> = {
  l3: 'L3',
  l2: 'L2',
  l1: 'L1',
};
