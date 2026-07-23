import type { ProcurementListKey } from './procurement-bitable-list.js';
import type { TaskName } from './task-runs.js';

export function procurementPushTaskName(listType: ProcurementListKey): TaskName {
  return listType === 'bulk_stock_request'
    ? 'procurement_bulk_stock_push'
    : 'procurement_follow_up_push';
}

export function procurementPullTaskName(listType: ProcurementListKey): TaskName {
  return listType === 'bulk_stock_request'
    ? 'procurement_bulk_stock_pull'
    : 'procurement_follow_up_pull';
}

export function procurementFeishuIoTaskNames(listType: ProcurementListKey): TaskName[] {
  return [procurementPushTaskName(listType), procurementPullTaskName(listType)];
}
