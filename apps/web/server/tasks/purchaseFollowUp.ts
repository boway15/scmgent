import { eq, and, lte, isNull } from 'drizzle-orm';
import { db, purchaseDrafts, purchaseFollowUpReminders, skus, pmcPlans } from '@scm/db';
import { sendFeishuGroupMessage } from '../integrations/feishu.js';

const MILESTONES = [
  { code: 'T-30', offsetDays: 30 },
  { code: 'T-14', offsetDays: 14 },
  { code: 'T-7', offsetDays: 7 },
] as const;

function addDaysFrom(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function schedulePurchaseFollowUps(draftId: string, expectedDate: string) {
  for (const milestone of MILESTONES) {
    const dueDate = addDaysFrom(expectedDate, milestone.offsetDays);
    await db
      .insert(purchaseFollowUpReminders)
      .values({
        draftId,
        milestone: milestone.code,
        dueDate,
      })
      .onConflictDoNothing({
        target: [purchaseFollowUpReminders.draftId, purchaseFollowUpReminders.milestone],
      });
  }
}

export async function runPurchaseFollowUp() {
  const today = new Date().toISOString().slice(0, 10);

  const dueRows = await db
    .select({
      reminderId: purchaseFollowUpReminders.id,
      milestone: purchaseFollowUpReminders.milestone,
      draftNo: purchaseDrafts.draftNo,
      skuCode: skus.code,
      qty: purchaseDrafts.qty,
      expectedDate: purchaseDrafts.expectedDate,
      merchantCode: pmcPlans.merchantCode,
      merchantName: pmcPlans.merchantName,
    })
    .from(purchaseFollowUpReminders)
    .innerJoin(purchaseDrafts, eq(purchaseDrafts.id, purchaseFollowUpReminders.draftId))
    .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
    .leftJoin(pmcPlans, eq(pmcPlans.id, purchaseDrafts.sourceRefId))
    .where(
      and(
        lte(purchaseFollowUpReminders.dueDate, today),
        isNull(purchaseFollowUpReminders.notifiedAt),
        eq(purchaseDrafts.status, 'draft'),
      ),
    )
    .limit(50);

  const messages: string[] = [];

  for (const row of dueRows) {
    const merchant = row.merchantName ?? row.merchantCode ?? '未知工厂';
    messages.push(
      `[${row.milestone}] ${row.draftNo} · ${row.skuCode} × ${row.qty} · ${merchant} · 交期 ${row.expectedDate ?? '-'}`,
    );

    await db
      .update(purchaseFollowUpReminders)
      .set({ notifiedAt: new Date() })
      .where(eq(purchaseFollowUpReminders.id, row.reminderId));
  }

  if (messages.length) {
    try {
      await sendFeishuGroupMessage(
        `采购跟进提醒 (${messages.length} 条)\n${messages.join('\n')}`,
      );
    } catch (err) {
      console.warn('[purchaseFollowUp] Feishu push skipped:', err);
    }
  }

  return { reminderCount: messages.length, reminders: messages };
}
