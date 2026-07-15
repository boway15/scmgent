import { eq, desc, inArray } from 'drizzle-orm';
import { db, purchaseDrafts, skus, pmcPlans } from '@scm/db';
import { recordToolCall } from '../trace.js';
import { PURCHASE_DRAFT_STATUS_LABEL, normalizePurchaseDraftStatus } from '../../lib/purchase-draft-lifecycle.js';

export async function getExceptionPurchaseTracking(limit = 10, runId?: string) {
  const handler = async () => {
    const rows = await db
      .select({
        draftNo: purchaseDrafts.draftNo,
        skuCode: skus.code,
        qty: purchaseDrafts.qty,
        receivedQty: purchaseDrafts.receivedQty,
        status: purchaseDrafts.status,
        exceptionReason: purchaseDrafts.exceptionReason,
        confirmedDeliveryDate: purchaseDrafts.confirmedDeliveryDate,
        planNo: pmcPlans.planNo,
        merchantName: pmcPlans.merchantName,
      })
      .from(purchaseDrafts)
      .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
      .leftJoin(pmcPlans, eq(pmcPlans.id, purchaseDrafts.sourceRefId))
      .where(
        inArray(purchaseDrafts.status, ['exception', 'draft', 'partial_received']),
      )
      .orderBy(desc(purchaseDrafts.updatedAt))
      .limit(limit);

    return rows.map((r) => {
      const status = normalizePurchaseDraftStatus(r.status);
      return {
        ...r,
        status,
        statusLabel: PURCHASE_DRAFT_STATUS_LABEL[status],
        remainingQty: Math.max(r.qty - (r.receivedQty ?? 0), 0),
      };
    });
  };

  if (runId) {
    return recordToolCall(runId, 'getExceptionPurchaseTracking', handler, { limit });
  }
  return handler();
}

export function buildTrackingExceptionAdvice(
  rows: Array<{
    draftNo: string;
    skuCode: string;
    statusLabel: string;
    exceptionReason?: string | null;
    remainingQty: number;
    confirmedDeliveryDate?: string | null;
  }>,
): string {
  if (!rows.length) return '当前无异常或待处理采购跟单。';

  const lines = ['【采购跟单风险摘要】', `待关注 ${rows.length} 条：`];
  for (const r of rows.slice(0, 8)) {
    lines.push(
      `- ${r.draftNo} ${r.skuCode}（${r.statusLabel}）剩余 ${r.remainingQty}${r.exceptionReason ? `：${r.exceptionReason}` : ''}`,
    );
  }
  lines.push('', '建议：待确认项联系供应商确认交期；异常项核实原因后恢复履约或取消跟单；部分到货项尽快登记剩余数量。');
  return lines.join('\n');
}
