/** 与 deploy/cron/crontab 对齐的可手动触发任务目录 */
export type ScheduledTask = {
  id: string;
  name: string;
  path: string;
  cron: string;
  cronLabel: string;
  description: string;
};

export const SCHEDULED_TASKS: ScheduledTask[] = [
  {
    id: 'stock_alert',
    name: '缺货预警检测',
    path: '/api/tasks/stock-alert',
    cron: '0 7 * * *',
    cronLabel: '已停用（原每天 07:00）',
    description: '扫描库存并生成缺货/低于 ROP 预警（定时调度已临时关闭）',
  },
  {
    id: 'inventory_query_pull',
    name: '库存查询飞书拉取',
    path: '/api/tasks/inventory-query-pull',
    cron: '20 7 * * *',
    cronLabel: '每天 07:20',
    description: '从飞书多维表格同步库存查询分仓明细快照',
  },
  {
    id: 'inventory_turnover_pull',
    name: '库存周转飞书拉取',
    path: '/api/tasks/inventory-turnover-pull',
    cron: '30 7 * * *',
    cronLabel: '每天 07:30',
    description: '从飞书同步 SKU 周转相关信息，供库存总览使用',
  },
  {
    id: 'news_ingest',
    name: '新闻情报采集',
    path: '/api/tasks/news-ingest',
    cron: '0 8 * * *',
    cronLabel: '每天 08:00',
    description: 'RSS 抓取、正文提取与飞书归档',
  },
  {
    id: 'procurement_bulk_stock_pull',
    name: '备货需求飞书拉取',
    path: '/api/tasks/procurement-bulk-stock-pull',
    cron: '0 8 * * *',
    cronLabel: '每天 08:00',
    description: '从飞书拉取备货需求列表',
  },
  {
    id: 'procurement_follow_up_pull',
    name: '采购跟单飞书拉取',
    path: '/api/tasks/procurement-follow-up-pull',
    cron: '5 8 * * *',
    cronLabel: '每天 08:05',
    description: '从飞书拉取采购跟单列表',
  },
  {
    id: 'replenishment_forecast',
    name: '补货建议生成',
    path: '/api/tasks/replenishment-forecast',
    cron: '0 9 * * 1',
    cronLabel: '每周一 09:00',
    description: '基于预测与库存位置生成补货建议',
  },
];

export const TASK_NAME_LABELS: Record<string, string> = {
  stock_alert: '缺货预警检测',
  inventory_query_pull: '库存查询飞书拉取',
  inventory_turnover_pull: '库存周转飞书拉取',
  news_ingest: '新闻情报采集',
  procurement_bulk_stock_pull: '备货需求飞书拉取',
  procurement_follow_up_pull: '采购跟单飞书拉取',
  replenishment_forecast: '补货建议生成',
  purchase_follow_up: '采购跟单提醒',
  inventory_exception_scan: '库存异常扫描',
  daily_inventory_pipeline: '每日库存流水线',
  forecast_accuracy: '预测准确率计算',
  forecast_baseline: '预测基线生成',
  sales_history_maintenance: '销售历史维护',
  procurement_bulk_stock_push: '备货需求飞书推送',
  procurement_follow_up_push: '采购跟单飞书推送',
};
