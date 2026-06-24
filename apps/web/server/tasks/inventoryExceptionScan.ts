import { upsertInventoryExceptions } from '../lib/inventory-health-store.js';
import { computeAllInventoryHealth } from '../lib/inventory-health-service.js';
import { sendFeishuGroupMessage } from '../integrations/feishu.js';

export async function runInventoryExceptionScan() {
  const healthRows = await computeAllInventoryHealth();
  const exceptionCount = await upsertInventoryExceptions(healthRows);

  const blueGray = healthRows.filter((r) => r.healthStatus === 'blue' || r.healthStatus === 'gray');

  if (exceptionCount > 0) {
    const sample = blueGray
      .slice(0, 10)
      .map((r) => `${r.skuCode}[${r.warehouseCode}] ${r.healthStatus}`)
      .join('\n');
    try {
      await sendFeishuGroupMessage(
        `库存异常扫描：新增 ${exceptionCount} 条异常单\n${sample}${blueGray.length > 10 ? '\n...' : ''}`,
      );
    } catch (err) {
      console.warn('[inventoryExceptionScan] Feishu push skipped:', err);
    }
  }

  return { exceptionCount, scanned: healthRows.length };
}
