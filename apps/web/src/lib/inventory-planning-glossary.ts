import {
  normalizeInventoryHealth,
  type InventoryHealth,
} from '@/components/InventoryHealthBadge';

/** 逻辑仓码在页面上附加中文说明（物理仓仍用主数据名称） */
const LOGIC_WAREHOUSE_CN: Record<string, string> = {
  'IN-PRODUCTION': '在产逻辑仓（工厂在产、出货前未定目的仓）',
  OVERSEAS: '海外未定仓合计（逻辑仓，不是某个物理仓）',
  ALL: '全网络汇总（需求计划用仓码）',
};

export function formatPlanningWarehouseLabel(code: string, name?: string | null): string {
  const cn = LOGIC_WAREHOUSE_CN[code];
  if (cn) return `${code} · ${cn}`;
  if (name?.trim()) return `${code} · ${name}`;
  return code;
}

export function formatHealthStatusLabel(raw: string | null | undefined): string {
  const n = normalizeInventoryHealth(raw);
  if (!n) return raw ?? '—';
  const labels: Record<InventoryHealth, string> = {
    red: '红灯（高风险）',
    yellow: '黄灯（风险）',
    green: '绿灯（健康）',
    blue: '蓝灯（超备）',
    gray: '灰灯（暂停补货）',
  };
  return labels[n];
}

const DEMAND_GATE_FLAG_CN: Record<string, string> = {
  reconstruct_capped: '缺货还原需求已按 1.5 倍封顶',
  wmape_fail: '近期加权预测误差过大（需人工确认）',
  wmape_warn: '近期加权预测误差偏高',
};

export function formatDemandGateFlags(flags: string[]): string {
  return flags.map((f) => DEMAND_GATE_FLAG_CN[f] ?? f).join('；');
}

/** 悬停说明：数据源与算法，英文仅作括号备注 */
export const PLANNING_FIELD_TIPS = {
  effectiveQty:
    '数据源：飞书「库存周转」日快照 → 本系统库存台账（每个 SKU×仓最新一行）。网络视图为各物理仓相加，不含「在产逻辑仓 IN-PRODUCTION」的在产残差。算法：可售 + 在产 + 在途 + 已确认开放量 − 已分配 − 欠单。本仓可售或在途大于 0 用本仓，否则按销售占比拆「海外未定仓合计 OVERSEAS」。',
  coverageDays:
    '数据源：本页时间轴「确定线」（不是分仓一览的有效供给）。有确定缺货日 = 该日与今天的日历差；否则 = 今日确定余额 ÷ 日均需求。',
  suggestedQty:
    '数据源：时间轴在交期锚点的净缺口。算法：向上取整(累计需求 + 安全库存 − 确定供给 − 预计供给 − 计划供给)，再按最小起订量 MOQ 抬升。供给来自三池开放批次，不来自分仓有效供给。',
  stockoutDate:
    '数据源：时间轴确定余额第一次 ≤ 0 的日期。确定供给 = 海外可售（周转快照业务日）+ 有真实预计到仓日的在途。生产未完成的本地批次不计入。',
  avgDaily:
    '数据源：已采纳的需求计划；没有则已发布销售预测；再没有则历史销量。分仓再乘飞书周转快照里的区域销售占比。',
  warehouseEffective:
    '数据源：飞书「库存周转」→ 该物理仓库存台账最新行。本仓可售或在途大于 0 用本仓，否则 OVERSEAS 海外合计 × 销售占比。不含 IN-PRODUCTION 在产批次。',
  nearestArrival:
    '数据源：三池开放批次表。取该物理仓「可用日」不早于今天的最早一天。不含 IN-PRODUCTION / OVERSEAS / ALL 逻辑仓，所以本地在产的可用日不会出现在这里。',
  warehouseStockout:
    '本列当前没有按仓计算，固定显示「—」。该仓缺货日请点「分仓时间轴」。网络确定缺货日见上方「确定缺货日」，来自时间轴确定线。',
  warehouseHealth:
    '数据源：每日库存流水线写入的「健康快照」该仓最新一条，不是打开本页时重算。',
  availableAt:
    '数据源：开放批次上的「可用日」字段，含义是预计海外可售日。海外池 = 周转快照业务日；在途 = 发运/跟单预计可售日 ETA，没有则用飞书「最早在途上架时间」；本地在产残差 = 飞书「采购单最早上架时间」。生产未完成即使有日期，也不进入时间轴。',
  localQty:
    '数据源：三池里「本地池 local」开放批次数量合计，含 IN-PRODUCTION。不计入上方「有效供给」。',
  inTransitQty: '数据源：三池里「在途池 in_transit」数量合计（各物理仓 + 未定仓）。',
  overseasQty: '数据源：三池里「海外池 overseas」数量合计。',
  dateUnknownQty: '数据源：开放批次中没有可用日或标记为日期未知的数量。这些批次不进入时间轴。',
  safetyBreach:
    '数据源：时间轴确定余额第一次低于安全库存件数的日期。安全库存件数来自安全库存配置，缺省按 14 天 × 日均。',
  reorderDate: '数据源：时间轴。预计缺货日 − 总交期；早于今天则显示今天。',
  leadHorizonBalance:
    '数据源：时间轴交期节点上的预计余额 = 确定供给 + 已到可用日的预计供给 − 累计需求。',
  confirmedEnding:
    '数据源：时间轴。可用日已到的确定批次 − 占用 − 从今天累计到该节点的需求。',
  expectedEnding: '数据源：时间轴。确定供给 + 已到出货交期的本地货 − 累计需求。',
  cumulativeDemand:
    '数据源：需求计划（按周）或已发布预测（按月），按日累加（含当天）。分仓再乘销售占比。',
  plannedInbound:
    '数据源：三池里已写可用日、但仍属「计划档」的批次（在产未完工、估期在途）。只展示，不进入确定缺货日。',
} as const;

/** 页内可展开的英文术语对照（与业务文档 §3.8 一致） */
export const PLANNING_TERM_LEGEND: ReadonlyArray<{ term: string; meaning: string }> = [
  { term: 'IN-PRODUCTION', meaning: '在产逻辑仓：工厂在产、出货前未定目的仓' },
  { term: 'OVERSEAS', meaning: '海外未定仓合计（逻辑仓，非物理仓）' },
  { term: 'ALL', meaning: '全网络需求汇总仓码' },
  { term: 'local / 本地池', meaning: '工厂侧在产、待出货批次' },
  { term: 'in_transit / 在途池', meaning: '已发运、在途未到可售' },
  { term: 'overseas / 海外池', meaning: '海外网络在库或可拆分库存' },
  { term: 'open 批次', meaning: '未关闭的三池供给行' },
  { term: 'ETA', meaning: '预计可售日（海外仓可卖）' },
  { term: 'MOQ', meaning: '最小起订量' },
  { term: '确定线 confirmed', meaning: '海外可售 + 真实预计到仓日在途' },
  { term: '预计线 expected', meaning: '再加已达出货交期的本地货' },
  { term: '计划线 planned', meaning: '在产/估期在途，仅展示管道' },
  { term: 'Profile', meaning: '交期模板（六段相加）' },
];
