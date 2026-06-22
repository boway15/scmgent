import { and, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import { fobFeeAllocationRules } from './schema/logistics';
import { FREIGHT_FEE_CATALOG, TRUCKING_FEE_CATALOG } from './fob-fee-catalog';
import {
  LEGACY_FREIGHT_PRIORITY_BASE,
  LEGACY_TRUCKING_PRIORITY_BASE,
  defaultCatalogPriority,
} from './fob-fee-display-priority';

/** 按模板顺序重置：拖车 32 项 → 货代 23 项（数值越大列越靠前） */
export async function resetFobFeeRuleDisplayPriorities(): Promise<{ updated: number }> {
  let updated = 0;

  for (let i = 0; i < TRUCKING_FEE_CATALOG.length; i++) {
    const feeType = TRUCKING_FEE_CATALOG[i].feeType;
    const priority = defaultCatalogPriority('trucking', i);
    const result = await db
      .update(fobFeeAllocationRules)
      .set({ priority })
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, 'trucking'),
          eq(fobFeeAllocationRules.feeType, feeType),
          isNull(fobFeeAllocationRules.matchPattern),
        ),
      )
      .returning({ id: fobFeeAllocationRules.id });
    updated += result.length;
  }

  for (let i = 0; i < FREIGHT_FEE_CATALOG.length; i++) {
    const feeType = FREIGHT_FEE_CATALOG[i].feeType;
    const priority = defaultCatalogPriority('freight', i);
    const result = await db
      .update(fobFeeAllocationRules)
      .set({ priority })
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, 'freight'),
          eq(fobFeeAllocationRules.feeType, feeType),
          isNull(fobFeeAllocationRules.matchPattern),
        ),
      )
      .returning({ id: fobFeeAllocationRules.id });
    updated += result.length;
  }

  const legacyTrucking = ['多点提货费', '超时等待费', '落地寄柜费', '延误费', '指定柜号', '其他费用'];
  for (let i = 0; i < legacyTrucking.length; i++) {
    const result = await db
      .update(fobFeeAllocationRules)
      .set({ priority: LEGACY_TRUCKING_PRIORITY_BASE - i })
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, 'trucking'),
          eq(fobFeeAllocationRules.feeType, legacyTrucking[i]),
          isNull(fobFeeAllocationRules.matchPattern),
        ),
      )
      .returning({ id: fobFeeAllocationRules.id });
    updated += result.length;
  }

  const legacyFreightPatterns = ['海运费', 'THC', '码头', '拖车费'];
  for (let i = 0; i < legacyFreightPatterns.length; i++) {
    const result = await db
      .update(fobFeeAllocationRules)
      .set({ priority: LEGACY_FREIGHT_PRIORITY_BASE - i })
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, 'freight'),
          eq(fobFeeAllocationRules.matchPattern, legacyFreightPatterns[i]),
          isNull(fobFeeAllocationRules.feeType),
        ),
      )
      .returning({ id: fobFeeAllocationRules.id });
    updated += result.length;
  }

  return { updated };
}
