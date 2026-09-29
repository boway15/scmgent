import { inArray } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { listAllRecords, listBitableFields } from '../integrations/feishu-bitable.js';
import { getBitableAppToken } from './bitable-sync.js';
import {
  defaultVisibleProcurementOpsColumns,
  mapProcurementOpsBitableRecords,
} from './procurement-ops-feishu-mapper.js';
import {
  publishProcurementOpsSnapshot,
  type ProcurementOpsSnapshotItem,
} from './procurement-ops-snapshot.js';

export const DEFAULT_PROCUREMENT_OPS_TABLE_ID = 'tblWUnYLwD8UATAS';

export function getProcurementOpsBitableConfig(): {
  configured: boolean;
  appToken?: string;
  tableId?: string;
} {
  const appToken = getBitableAppToken('inventory_turnover');
  const tableId =
    process.env.FEISHU_BITABLE_TABLE_PROCUREMENT_OPS?.trim() ||
    DEFAULT_PROCUREMENT_OPS_TABLE_ID;
  return {
    configured: Boolean(appToken && tableId),
    appToken,
    tableId,
  };
}

async function resolveSkuIdsByCodes(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const rows = await db
      .select({ id: skus.id, code: skus.code })
      .from(skus)
      .where(inArray(skus.code, chunk));
    for (const row of rows) map.set(row.code, row.id);
  }
  return map;
}

export async function pullAndPublishProcurementOpsFromFeishu(): Promise<{
  imported: number;
  warningCount: number;
  skipped: number;
  snapshotDate: string;
  snapshotRowCount: number;
  snapshotRunId: string;
  columns: string[];
}> {
  const config = getProcurementOpsBitableConfig();
  if (!config.configured || !config.appToken || !config.tableId) {
    throw new Error(
      '全链库存飞书多维表格未配置（需 FEISHU_BITABLE_PROCUREMENT_APP_TOKEN 或 FEISHU_BITABLE_APP_TOKEN，与库存周转相同）',
    );
  }

  const [fieldMetas, records] = await Promise.all([
    listBitableFields(config.appToken, config.tableId),
    listAllRecords(config.appToken, config.tableId, 'procurement_ops', {
      displayFormulaRef: true,
    }),
  ]);

  const columns = fieldMetas
    .map((f) => f.field_name?.trim())
    .filter((name): name is string => Boolean(name));

  const mapped = mapProcurementOpsBitableRecords(records, columns);
  console.log(
    `[procurement-ops-pull] feishuRows=${records.length} mapped=${mapped.items.length} skippedEmptySku=${mapped.skipped}`,
  );
  if (mapped.items.length === 0) {
    throw new Error('全链库存同步没有可归档数据，本次不发布每日快照。');
  }

  const skuMap = await resolveSkuIdsByCodes(mapped.items.map((item) => item.skuCode));
  const items: ProcurementOpsSnapshotItem[] = mapped.items.map((item) => ({
    skuCode: item.skuCode,
    skuId: skuMap.get(item.skuCode) ?? null,
    payload: item.payload,
  }));

  const publishedColumns = columns.length
    ? columns
    : Array.from(new Set(items.flatMap((item) => Object.keys(item.payload))));

  const published = await publishProcurementOpsSnapshot({
    items,
    imported: items.length,
    source: 'feishu-bitable',
    columns: publishedColumns,
  });

  return {
    imported: items.length,
    warningCount: mapped.warningCount,
    skipped: mapped.skipped,
    snapshotDate: published.snapshotDate,
    snapshotRowCount: published.rowCount,
    snapshotRunId: published.runId,
    columns: publishedColumns,
  };
}

export { defaultVisibleProcurementOpsColumns };
