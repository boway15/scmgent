import { eq, and, desc } from 'drizzle-orm';
import { db, pmcPlans, pmcPlanItems, skus, reorderSuggestions } from '../_db/index.js';
import { nextPlanNo, createPurchaseDraft } from '../routes/procurement.js';
export async function findDraftPlanForMerchantAndWarehouse(merchantCode, warehouseCode) {
    const [plan] = await db
        .select()
        .from(pmcPlans)
        .where(and(eq(pmcPlans.merchantCode, merchantCode), eq(pmcPlans.targetWarehouseCode, warehouseCode), eq(pmcPlans.status, 'draft')))
        .orderBy(desc(pmcPlans.updatedAt))
        .limit(1);
    return plan ?? null;
}
export async function mergePlanItem(params) {
    const [existing] = await db
        .select()
        .from(pmcPlanItems)
        .where(and(eq(pmcPlanItems.planId, params.planId), eq(pmcPlanItems.skuId, params.skuId), eq(pmcPlanItems.warehouseCode, params.warehouseCode)))
        .limit(1);
    if (existing) {
        const [updated] = await db
            .update(pmcPlanItems)
            .set({ plannedQty: existing.plannedQty + params.addQty })
            .where(eq(pmcPlanItems.id, existing.id))
            .returning();
        return updated;
    }
    const items = await db
        .select({ sortOrder: pmcPlanItems.sortOrder })
        .from(pmcPlanItems)
        .where(eq(pmcPlanItems.planId, params.planId));
    const nextSort = items.length ? Math.max(...items.map((i) => i.sortOrder ?? 0)) + 1 : 0;
    const [created] = await db
        .insert(pmcPlanItems)
        .values({
        planId: params.planId,
        skuId: params.skuId,
        warehouseCode: params.warehouseCode,
        plannedQty: params.addQty,
        unit: params.unit,
        sortOrder: nextSort,
    })
        .returning();
    return created;
}
export async function findOrCreateDraftPlan(params) {
    const existing = await findDraftPlanForMerchantAndWarehouse(params.merchantCode, params.warehouseCode);
    if (existing)
        return existing;
    const today = new Date().toISOString().slice(0, 10);
    const delivery = params.deliveryDate ??
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const merchantLabel = params.merchantName?.trim() || params.merchantCode;
    const whLabel = params.warehouseName?.trim() || params.warehouseCode;
    const [plan] = await db
        .insert(pmcPlans)
        .values({
        planNo: await nextPlanNo(),
        name: `${merchantLabel} · ${whLabel} 下单计划`,
        merchantCode: params.merchantCode,
        merchantName: params.merchantName ?? undefined,
        targetWarehouseCode: params.warehouseCode,
        planDate: new Date(today),
        deliveryDate: new Date(delivery),
        status: 'draft',
        createdBy: params.createdBy,
    })
        .returning();
    return plan;
}
export async function mergeSuggestionToPlan(params) {
    const [suggestion] = await db
        .select()
        .from(reorderSuggestions)
        .where(eq(reorderSuggestions.id, params.suggestionId))
        .limit(1);
    if (!suggestion)
        throw new Error('Suggestion not found');
    if (!suggestion.warehouseCode)
        throw new Error('补货建议缺少目标仓');
    const [sku] = await db.select().from(skus).where(eq(skus.id, suggestion.skuId)).limit(1);
    if (!sku)
        throw new Error('SKU not found');
    const merchantCode = params.merchantCode ?? sku.merchantCode;
    if (!merchantCode) {
        throw new Error('SKU 未配置商家，请指定 merchantCode');
    }
    const plan = await findOrCreateDraftPlan({
        merchantCode,
        merchantName: params.merchantName ?? sku.merchantName,
        warehouseCode: suggestion.warehouseCode,
        deliveryDate: String(suggestion.suggestedDate),
        createdBy: params.userId,
    });
    await mergePlanItem({
        planId: plan.id,
        skuId: sku.id,
        warehouseCode: suggestion.warehouseCode,
        addQty: suggestion.suggestedQty,
        unit: sku.unit,
    });
    await db
        .update(pmcPlans)
        .set({ updatedAt: new Date() })
        .where(eq(pmcPlans.id, plan.id));
    return { plan, sku };
}
export async function generatePurchaseDraftsFromPlan(planId, userId) {
    const [plan] = await db.select().from(pmcPlans).where(eq(pmcPlans.id, planId)).limit(1);
    if (!plan)
        throw new Error('Plan not found');
    const items = await db
        .select({
        skuId: pmcPlanItems.skuId,
        plannedQty: pmcPlanItems.plannedQty,
        warehouseCode: pmcPlanItems.warehouseCode,
        skuCode: skus.code,
    })
        .from(pmcPlanItems)
        .innerJoin(skus, eq(skus.id, pmcPlanItems.skuId))
        .where(eq(pmcPlanItems.planId, planId));
    const drafts = [];
    for (const item of items) {
        const wh = item.warehouseCode ?? plan.targetWarehouseCode ?? '-';
        const draft = await createPurchaseDraft({
            skuId: item.skuId,
            qty: item.plannedQty,
            expectedDate: String(plan.deliveryDate).slice(0, 10),
            source: 'pmc',
            sourceRefId: plan.id,
            remark: `计划 ${plan.planNo} / 商家 ${plan.merchantCode} / 仓 ${wh} / ${item.skuCode}`,
            createdBy: userId,
        });
        drafts.push(draft);
    }
    return drafts;
}
