import { eq, desc, and, isNull, or, ilike } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, reorderSuggestions, skus } from '@scm/db';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { requireMenu } from '../lib/rbac.js';
import { parseListPagination } from '../lib/list-pagination.js';
import {
  compareSuggestionsByUrgency,
  filterSuggestionQueue,
} from '../lib/reorder-suggestion-sort.js';
import { parseProductScope, productScopeSql } from '../lib/planning-accessory-filter.js';

export const reorderRoutes = new Hono();

reorderRoutes.get('/reorder/suggestions', requireMenu('pmc.suggestion'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const status = c.req.query('status')?.trim();
  const queue = c.req.query('queue') ?? 'auto';
  const q = c.req.query('q')?.trim() || c.req.query('sku')?.trim();
  const warehouse = c.req.query('warehouse')?.trim();

  const productScope = parseProductScope(c.req.query('productScope'));
  const conditions = [isNull(reorderSuggestions.supersededAt), productScopeSql(productScope)];
  if (status) {
    conditions.push(
      eq(reorderSuggestions.status, status as 'pending' | 'accepted' | 'ignored'),
    );
  }
  if (warehouse) {
    conditions.push(eq(reorderSuggestions.warehouseCode, warehouse));
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(skus.merchantCode, pattern),
        ilike(skus.merchantName, pattern),
        ilike(reorderSuggestions.warehouseCode, pattern),
      )!,
    );
  }

  const rows = await db
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
      healthStatus: reorderSuggestions.healthStatus,
      coverageDays: reorderSuggestions.coverageDays,
      totalLeadDays: reorderSuggestions.totalLeadDays,
      latestOrderDays: reorderSuggestions.latestOrderDays,
      metrics: reorderSuggestions.metrics,
      status: reorderSuggestions.status,
      planId: reorderSuggestions.planId,
      generatedAt: reorderSuggestions.generatedAt,
      supersededAt: reorderSuggestions.supersededAt,
    })
    .from(reorderSuggestions)
    .innerJoin(skus, eq(skus.id, reorderSuggestions.skuId))
    .where(and(...conditions))
    .orderBy(desc(reorderSuggestions.generatedAt))
    .limit(2000);

  const filtered = filterSuggestionQueue(rows, queue);
  filtered.sort(compareSuggestionsByUrgency);

  return c.json({
    items: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
  });
});

reorderRoutes.patch('/reorder/suggestions/:id', requireMenu('pmc.suggestion'), async (c) =>
  analysisOnlyResponse(c),
);
