import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, reorderSuggestions, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { mergeSuggestionToPlan } from '../lib/pmc-plan.js';
import { requireMenu } from '../lib/rbac.js';

export const reorderRoutes = new Hono();

reorderRoutes.get('/reorder/suggestions', async (c) => {
  const status = c.req.query('status');

  const baseQuery = db
    .select({
      id: reorderSuggestions.id,
      skuId: reorderSuggestions.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
      warehouseCode: reorderSuggestions.warehouseCode,
      suggestedQty: reorderSuggestions.suggestedQty,
      suggestedDate: reorderSuggestions.suggestedDate,
      reason: reorderSuggestions.reason,
      status: reorderSuggestions.status,
      planId: reorderSuggestions.planId,
      generatedAt: reorderSuggestions.generatedAt,
    })
    .from(reorderSuggestions)
    .innerJoin(skus, eq(skus.id, reorderSuggestions.skuId))
    .$dynamic();

  const rows = status
    ? await baseQuery
        .where(eq(reorderSuggestions.status, status as 'pending' | 'accepted' | 'ignored'))
        .orderBy(desc(reorderSuggestions.generatedAt))
        .limit(100)
    : await baseQuery.orderBy(desc(reorderSuggestions.generatedAt)).limit(100);

  return c.json(rows);
});

reorderRoutes.patch('/reorder/suggestions/:id', requireMenu('pmc.suggestion'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ status: 'accepted' | 'ignored'; merchantCode?: string; merchantName?: string }>();
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(reorderSuggestions)
    .where(eq(reorderSuggestions.id, id))
    .limit(1);

  if (!existing) return c.json({ message: 'Suggestion not found' }, 404);

  if (body.status === 'accepted') {
    try {
      const { plan } = await mergeSuggestionToPlan({
        suggestionId: id,
        userId: user.id,
        merchantCode: body.merchantCode,
        merchantName: body.merchantName,
      });

      const [row] = await db
        .update(reorderSuggestions)
        .set({ status: 'accepted', reviewedBy: user.id, planId: plan.id })
        .where(eq(reorderSuggestions.id, id))
        .returning();

      return c.json({ ...row, planNo: plan.planNo, planId: plan.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to merge plan';
      return c.json({ message }, 400);
    }
  }

  const [row] = await db
    .update(reorderSuggestions)
    .set({ status: body.status, reviewedBy: user.id })
    .where(eq(reorderSuggestions.id, id))
    .returning();

  return c.json(row);
});
