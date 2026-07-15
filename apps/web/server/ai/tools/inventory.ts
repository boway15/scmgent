import { eq, and, desc } from 'drizzle-orm';
import { db, inventoryRecords, reorderSuggestions, stockAlerts } from '@scm/db';
import {
  getLatestInventorySnapshot,
  getLatestInProductionQty,
} from '../../lib/inventory-snapshot.js';
import { IN_PRODUCTION_WAREHOUSE, isPhysicalWarehouse } from '../../lib/inventory-constants.js';
import { recordToolCall } from '../trace.js';
import { resolveSkuId } from './sku.js';

export type InventoryContextInput = {
  skuId?: string;
  skuCode?: string;
  warehouseCode?: string;
};

export async function getSkuInventoryContext(input: InventoryContextInput, runId?: string) {
  const handler = async () => {
    const id = await resolveSkuId(input);
    if (!id) return null;

    const lines: string[] = [];

    if (input.warehouseCode) {
      const snap = await getLatestInventorySnapshot(id, input.warehouseCode);
      const inProduction = await getLatestInProductionQty(id);
      lines.push(
        `仓 ${input.warehouseCode}：可售 ${snap.qtyAvailable}，在途 ${snap.qtyInTransit}，本仓有效 ${snap.localEffectiveQty}`,
      );
      lines.push(`SKU 在产池（未分仓）：${inProduction}`);
    } else {
      const whRows = await db
        .selectDistinct({ warehouse: inventoryRecords.warehouse })
        .from(inventoryRecords)
        .where(eq(inventoryRecords.skuId, id));

      for (const { warehouse } of whRows) {
        if (!isPhysicalWarehouse(warehouse) || warehouse === IN_PRODUCTION_WAREHOUSE) continue;
        const snap = await getLatestInventorySnapshot(id, warehouse);
        lines.push(
          `仓 ${warehouse}：本仓有效 ${snap.localEffectiveQty}（可售 ${snap.qtyAvailable} / 在途 ${snap.qtyInTransit}）`,
        );
      }
      const inProduction = await getLatestInProductionQty(id);
      if (inProduction > 0) {
        lines.push(`SKU 在产池（未分仓）：${inProduction}`);
      }
      if (!whRows.length) lines.push('暂无库存台账记录');
    }

    return lines.join('\n');
  };

  if (runId) {
    return recordToolCall(runId, 'getSkuInventoryContext', handler, input);
  }
  return handler();
}

export async function getPendingReorderSuggestions(input: InventoryContextInput, runId?: string) {
  const handler = async () => {
    const id = await resolveSkuId(input);
    if (!id) return [];

    const rows = await db
      .select({
        suggestedQty: reorderSuggestions.suggestedQty,
        suggestedDate: reorderSuggestions.suggestedDate,
        reason: reorderSuggestions.reason,
        warehouseCode: reorderSuggestions.warehouseCode,
        healthStatus: reorderSuggestions.healthStatus,
      })
      .from(reorderSuggestions)
      .where(and(eq(reorderSuggestions.skuId, id), eq(reorderSuggestions.status, 'pending')))
      .orderBy(desc(reorderSuggestions.generatedAt))
      .limit(5);

    return rows;
  };

  if (runId) {
    return recordToolCall(runId, 'getPendingReorderSuggestions', handler, input);
  }
  return handler();
}

export async function getOpenStockAlerts(input: InventoryContextInput, runId?: string) {
  const handler = async () => {
    const id = await resolveSkuId(input);
    if (!id) return [];

    return db
      .select({
        alertType: stockAlerts.alertType,
        currentQty: stockAlerts.currentQty,
        safetyQty: stockAlerts.safetyQty,
        warehouseCode: stockAlerts.warehouseCode,
      })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.skuId, id), eq(stockAlerts.isResolved, false)))
      .limit(10);
  };

  if (runId) {
    return recordToolCall(runId, 'getOpenStockAlerts', handler, input);
  }
  return handler();
}

export async function buildFullSkuContext(input: InventoryContextInput, runId?: string) {
  const handler = async () => {
    const id = await resolveSkuId(input);
    if (!id) return null;

    const { getSkuInfo } = await import('./sku.js');
    const sku = await getSkuInfo({ skuId: id });
    if (!sku) return null;

    const lines = [`【SKU 上下文】${sku.code} ${sku.name}`];
    const inventory = await getSkuInventoryContext(input);
    if (inventory) lines.push(inventory);

    const suggestions = await getPendingReorderSuggestions({ skuId: id });
    if (suggestions.length) {
      lines.push('待处理补货建议：');
      for (const s of suggestions) {
        lines.push(
          `- 仓 ${s.warehouseCode ?? '-'}：建议 ${s.suggestedQty}，日期 ${String(s.suggestedDate).slice(0, 10)}。${s.reason ?? ''}`,
        );
      }
    }

    const alerts = await getOpenStockAlerts({ skuId: id });
    if (alerts.length) {
      lines.push('未处理预警：');
      for (const a of alerts) {
        lines.push(
          `- ${a.alertType}（仓 ${a.warehouseCode ?? '-'}）：当前 ${a.currentQty}，阈值 ${a.safetyQty}`,
        );
      }
    }

    if (sku.leadTimeDays) lines.push(`采购交期：${sku.leadTimeDays} 天`);
    if (sku.merchantCode) lines.push(`默认商家：${sku.merchantName ?? sku.merchantCode}`);

    return lines.join('\n');
  };

  if (runId) {
    return recordToolCall(runId, 'buildFullSkuContext', handler, input);
  }
  return handler();
}
