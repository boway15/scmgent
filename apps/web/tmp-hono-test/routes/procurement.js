import { eq, desc, like, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, purchaseDrafts, skus, pmcPlans } from '../_db/index.js';
import { requireMenu } from '../lib/rbac.js';
function draftNo() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString().slice(-6)}`;
}
export async function createPurchaseDraft(params) {
    const [row] = await db
        .insert(purchaseDrafts)
        .values({
        draftNo: draftNo(),
        skuId: params.skuId,
        qty: params.qty,
        expectedDate: params.expectedDate,
        source: params.source,
        sourceRefId: params.sourceRefId,
        remark: params.remark,
        createdBy: params.createdBy,
        status: 'draft',
    })
        .returning();
    return row;
}
export const procurementRoutes = new Hono();
procurementRoutes.get('/purchase-drafts', async (c) => {
    const status = c.req.query('status');
    const baseQuery = db
        .select({
        id: purchaseDrafts.id,
        draftNo: purchaseDrafts.draftNo,
        skuId: purchaseDrafts.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        qty: purchaseDrafts.qty,
        expectedDate: purchaseDrafts.expectedDate,
        source: purchaseDrafts.source,
        sourceRefId: purchaseDrafts.sourceRefId,
        planId: purchaseDrafts.sourceRefId,
        planNo: pmcPlans.planNo,
        merchantCode: pmcPlans.merchantCode,
        merchantName: pmcPlans.merchantName,
        status: purchaseDrafts.status,
        remark: purchaseDrafts.remark,
        createdAt: purchaseDrafts.createdAt,
    })
        .from(purchaseDrafts)
        .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
        .leftJoin(pmcPlans, eq(pmcPlans.id, purchaseDrafts.sourceRefId))
        .$dynamic();
    const rows = status
        ? await baseQuery
            .where(and(eq(purchaseDrafts.source, 'pmc'), eq(purchaseDrafts.status, status)))
            .orderBy(desc(purchaseDrafts.createdAt))
            .limit(200)
        : await baseQuery
            .where(eq(purchaseDrafts.source, 'pmc'))
            .orderBy(desc(purchaseDrafts.createdAt))
            .limit(200);
    return c.json(rows);
});
procurementRoutes.post('/purchase-drafts', async (c) => {
    return c.json({ message: '采购跟单仅由计划确认后自动生成' }, 403);
});
procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), async (c) => {
    const body = await c.req.json();
    const [row] = await db
        .update(purchaseDrafts)
        .set({
        ...(body.status ? { status: body.status } : {}),
        ...(body.remark != null ? { remark: body.remark } : {}),
        updatedAt: new Date(),
    })
        .where(eq(purchaseDrafts.id, c.req.param('id')))
        .returning();
    if (!row)
        return c.json({ message: 'Draft not found' }, 404);
    return c.json(row);
});
/** Next plan number sequence */
export async function nextPlanNo() {
    const d = new Date();
    const prefix = `PMC-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rows = await db
        .select({ planNo: pmcPlans.planNo })
        .from(pmcPlans)
        .where(like(pmcPlans.planNo, `${prefix}%`));
    const seq = rows.length + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
}
