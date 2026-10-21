import { listAllRecords } from '../integrations/feishu-bitable.js';
import { getBitableAppToken } from './bitable-sync.js';
import {
  assertFeishuSalesDailyWindow,
  mapFeishuSalesDailyRecords,
} from './feishu-sales-daily-mapper.js';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { persistDailySalesRowsAsHistory } from './sales-history-import.js';
import { refreshSkuLifecycles } from './sku-lifecycle.js';

/** 产品销售报表-长表。可用 FEISHU_BITABLE_TABLE_SALES_DAILY 覆盖。 */
export const DEFAULT_SALES_DAILY_TABLE_ID = 'tbl6autzkb5vMqHx';

export function getFeishuSalesDailyBitableConfig(): {
  configured: boolean;
  appToken?: string;
  tableId?: string;
} {
  const appToken = getBitableAppToken('inventory_turnover');
  const tableId =
    process.env.FEISHU_BITABLE_TABLE_SALES_DAILY?.trim() || DEFAULT_SALES_DAILY_TABLE_ID;
  return {
    configured: Boolean(appToken && tableId),
    appToken,
    tableId,
  };
}

export async function pullSalesDailyFromFeishu(now: Date = new Date()) {
  const config = getFeishuSalesDailyBitableConfig();
  if (!config.configured || !config.appToken || !config.tableId) {
    throw new Error(
      '销量长表飞书多维表格未配置（需 FEISHU_BITABLE_PROCUREMENT_APP_TOKEN 或 FEISHU_BITABLE_APP_TOKEN，与库存周转相同）',
    );
  }

  const records = await listAllRecords(config.appToken, config.tableId, 'sales_daily');
  const mapped = mapFeishuSalesDailyRecords(records);
  assertFeishuSalesDailyWindow(mapped.dates, getShanghaiBusinessDate(now));
  if (!mapped.rows.length) {
    throw new Error('飞书销量长表没有可写入的销量行，本次不同步。');
  }

  const stats = await persistDailySalesRowsAsHistory(mapped.rows);
  const skuIds = [...new Set(stats.rows.map((row) => row.skuId))];
  let lifecycleError: string | undefined;
  if (skuIds.length) {
    try {
      await refreshSkuLifecycles(skuIds);
    } catch (err) {
      lifecycleError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    recordCount: records.length,
    dates: mapped.dates,
    skippedInvalid: mapped.skipped,
    insertedSalesRows: stats.insertedSalesRows,
    updatedSalesRows: stats.updatedSalesRows,
    createdSkuCount: stats.createdSkuCount,
    lifecycleError,
    errors: stats.errors,
  };
}
