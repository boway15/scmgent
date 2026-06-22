import { eq, and } from 'drizzle-orm';
import { db, pmcPlans, pmcPlanItems, pmcReceipts, inventoryRecords } from '@scm/db';
import { getLatestInventorySnapshot } from './inventory-snapshot.js';

export type ReceivePmcItemInput = {
  planId: string;
  planItemId: string;
  qtyReceived: number;
  receivedDate?: string;
  idempotencyKey?: string;
  userId: string;
};

export async function receivePmcPlanItem(input: ReceivePmcItemInput) {
  if (!Number.isInteger(input.qtyReceived) || input.qtyReceived <= 0) {
    throw new Error('qtyReceived must be a positive integer');
  }

  if (input.idempotencyKey?.trim()) {
    const [existing] = await db
      .select()
      .from(pmcReceipts)
      .where(eq(pmcReceipts.idempotencyKey, input.idempotencyKey.trim()))
      .limit(1);
    if (existing) {
      const [item] = await db
        .select()
        .from(pmcPlanItems)
        .where(eq(pmcPlanItems.id, existing.planItemId))
        .limit(1);
      return { receipt: existing, planItem: item, duplicate: true };
    }
  }

  const [plan] = await db.select().from(pmcPlans).where(eq(pmcPlans.id, input.planId)).limit(1);
  if (!plan) throw new Error('Plan not found');
  if (!['confirmed', 'in_progress'].includes(plan.status)) {
    throw new Error(`Plan status ${plan.status} does not allow receiving`);
  }

  const [item] = await db
    .select()
    .from(pmcPlanItems)
    .where(and(eq(pmcPlanItems.id, input.planItemId), eq(pmcPlanItems.planId, input.planId)))
    .limit(1);
  if (!item) throw new Error('Plan item not found');

  const warehouseCode = item.warehouseCode ?? plan.targetWarehouseCode;
  if (!warehouseCode) throw new Error('warehouseCode is required');

  const currentCompleted = item.completedQty ?? 0;
  const nextCompleted = currentCompleted + input.qtyReceived;
  if (nextCompleted > item.plannedQty) {
    throw new Error(
      `到货数量超出计划：当前已完成 ${currentCompleted}，本次 ${input.qtyReceived}，计划 ${item.plannedQty}`,
    );
  }

  const receivedDate = input.receivedDate ?? new Date().toISOString().slice(0, 10);
  const snapshot = await getLatestInventorySnapshot(item.skuId, warehouseCode);

  const [inventoryRecord] = await db
    .insert(inventoryRecords)
    .values({
      skuId: item.skuId,
      warehouse: warehouseCode,
      qtyAvailable: snapshot.qtyAvailable + input.qtyReceived,
      qtyInTransit: snapshot.qtyInTransit,
      qtyInProduction: 0,
      recordedDate: receivedDate,
      source: 'pmc_receipt',
      createdBy: input.userId,
    })
    .returning();

  const [receipt] = await db
    .insert(pmcReceipts)
    .values({
      planId: input.planId,
      planItemId: input.planItemId,
      skuId: item.skuId,
      warehouseCode,
      qtyReceived: input.qtyReceived,
      receivedDate,
      inventoryRecordId: inventoryRecord.id,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      createdBy: input.userId,
    })
    .returning();

  const [updatedItem] = await db
    .update(pmcPlanItems)
    .set({ completedQty: nextCompleted })
    .where(eq(pmcPlanItems.id, item.id))
    .returning();

  let nextPlanStatus: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' = plan.status;
  if (plan.status === 'confirmed') {
    nextPlanStatus = 'in_progress';
  }

  const allItems = await db
    .select({
      plannedQty: pmcPlanItems.plannedQty,
      completedQty: pmcPlanItems.completedQty,
    })
    .from(pmcPlanItems)
    .where(eq(pmcPlanItems.planId, input.planId));

  const allComplete = allItems.every((row) => (row.completedQty ?? 0) >= row.plannedQty);
  if (allComplete) {
    nextPlanStatus = 'completed';
  }

  if (nextPlanStatus !== plan.status) {
    await db
      .update(pmcPlans)
      .set({ status: nextPlanStatus, updatedAt: new Date() })
      .where(eq(pmcPlans.id, input.planId));
  }

  return {
    receipt,
    planItem: updatedItem,
    inventoryRecord,
    planStatus: nextPlanStatus,
    duplicate: false,
  };
}
