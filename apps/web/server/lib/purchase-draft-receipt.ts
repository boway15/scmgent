import { eq } from 'drizzle-orm';
import { db, purchaseDrafts, pmcPlanItems } from '@scm/db';
import { receivePmcPlanItem } from './pmc-receipt.js';
import { deriveReceiptStatus, normalizePurchaseDraftStatus } from './purchase-draft-lifecycle.js';

export type ReceivePurchaseDraftInput = {
  draftId: string;
  qtyReceived: number;
  receivedDate?: string;
  idempotencyKey?: string;
  userId: string;
};

export async function receivePurchaseDraft(input: ReceivePurchaseDraftInput) {
  const [draft] = await db
    .select()
    .from(purchaseDrafts)
    .where(eq(purchaseDrafts.id, input.draftId))
    .limit(1);
  if (!draft) throw new Error('跟单记录不存在');
  const status = normalizePurchaseDraftStatus(draft.status);
  if (status === 'cancelled') throw new Error('已取消的跟单不能登记到货');
  if (status === 'received') throw new Error('该跟单已全部收货');
  if (!draft.planItemId || !draft.sourceRefId) {
    throw new Error('跟单缺少计划行关联，请从 PMC 计划详情登记到货');
  }

  const receiptResult = await receivePmcPlanItem({
    planId: draft.sourceRefId,
    planItemId: draft.planItemId,
    qtyReceived: input.qtyReceived,
    receivedDate: input.receivedDate,
    idempotencyKey: input.idempotencyKey ?? `draft:${input.draftId}:${input.qtyReceived}`,
    userId: input.userId,
  });

  const [planItem] = await db
    .select({ plannedQty: pmcPlanItems.plannedQty })
    .from(pmcPlanItems)
    .where(eq(pmcPlanItems.id, draft.planItemId))
    .limit(1);

  const nextReceivedQty = (draft.receivedQty ?? 0) + input.qtyReceived;
  const nextStatus = deriveReceiptStatus(nextReceivedQty, planItem?.plannedQty ?? draft.qty);

  const receivedDate = input.receivedDate ?? new Date().toISOString().slice(0, 10);
  const [updatedDraft] = await db
    .update(purchaseDrafts)
    .set({
      receivedQty: nextReceivedQty,
      actualReceivedDate: receivedDate,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(purchaseDrafts.id, input.draftId))
    .returning();

  return {
    draft: updatedDraft,
    receipt: receiptResult,
  };
}
