/** 需求计划页：区块与列头说明 */

export const DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP =
  '取当前已发布销量预测未来 6 个自然月的地平线，按 ISO 周展开对照。' +
  '左侧列为预测工作台口径（系统 / 校准 / 生效）；「计划生效」为本需求计划版本驱动补货的周日均；' +
  '「Champion」为生成计划时快照的预测周日均，仅供对照，不参与补货计算。';

export const DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP =
  '本需求计划版本该 ISO 周的生效日均 = 人工校准 ?? 系统日均。' +
  '系统日均由近 90 天销量反推水平 × 预测季节形状得出。试点圈发布后此列驱动补货与缺货预警。';

export const DEMAND_PLAN_CHAMPION_COLUMN_HELP =
  '生成本需求计划草稿时，从已发布销量预测按 ISO 周拆分的周日均快照（只读）。' +
  '用于与「计划生效」对照：Champion 代表「若仍走销量预测」的路径，不参与下单计算。';
