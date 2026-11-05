/** 需求计划页：区块与列头说明 */

export const DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP =
  '取销量预测未来 6 月地平线按 ISO 周展开（可内联 V4.1，不依赖月版本发布）。' +
  '含「实际日均 / 周销量」列：已发生计划周可对照计划生效做回测；未来周实际为空。' +
  '「计划系统 / 计划生效」与矩阵宽表一致；Champion 仅作可选对照。';

export const DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP =
  '本需求计划版本该 ISO 周的生效日均 = 人工校准 ?? 系统日均。' +
  '系统日均与月预测同一套公式（近窗 × 同比结构 × 季节系数 × 地平线混合），按周滚动。补货链路暂未接入。';

export const DEMAND_PLAN_CHAMPION_COLUMN_HELP =
  '生成本需求计划草稿时，从已发布销量预测按 ISO 周拆分的周日均快照（只读）。' +
  '用于与「计划生效」对照：Champion 代表「若仍走销量预测」的路径，不参与下单计算。';
