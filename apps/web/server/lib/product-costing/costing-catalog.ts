import {
  costingFactories,
  costingFactoryFeeRates,
  costingRegions,
  db,
} from '@scm/db';
import { and, asc, eq } from 'drizzle-orm';
import { GENERIC_FACTORY_CODE, GENERIC_REGION_CODE } from './costing-scope.js';
import { parsePackProfileInput } from './pack-profile.js';

export async function listCostingRegions(activeOnly = false) {
  return db
    .select()
    .from(costingRegions)
    .where(activeOnly ? eq(costingRegions.isActive, true) : undefined)
    .orderBy(asc(costingRegions.sortOrder), asc(costingRegions.name));
}

export async function listCostingFactories(activeOnly = false) {
  return db
    .select()
    .from(costingFactories)
    .where(activeOnly ? eq(costingFactories.isActive, true) : undefined)
    .orderBy(asc(costingFactories.sortOrder), asc(costingFactories.name));
}

export async function createCostingRegion(input: { code: string; name: string; sortOrder?: number }) {
  const [created] = await db
    .insert(costingRegions)
    .values({
      code: input.code.trim(),
      name: input.name.trim(),
      sortOrder: input.sortOrder ?? 99,
    })
    .returning();
  return created;
}

export async function createCostingFactory(input: {
  code: string;
  name: string;
  regionId?: string | null;
  sortOrder?: number;
}) {
  const [created] = await db
    .insert(costingFactories)
    .values({
      code: input.code.trim(),
      name: input.name.trim(),
      regionId: input.regionId || null,
      sortOrder: input.sortOrder ?? 99,
    })
    .returning();
  return created;
}

export async function updateCostingFactoryPackProfile(
  id: string,
  packProfile: unknown,
): Promise<(typeof costingFactories.$inferSelect) | null> {
  const parsed = parsePackProfileInput(packProfile);
  const [updated] = await db
    .update(costingFactories)
    .set({
      packProfile: parsed,
      updatedAt: new Date(),
    })
    .where(eq(costingFactories.id, id))
    .returning();
  return updated ?? null;
}

export async function listFactoryFeeRates(opts?: { regionId?: string; factoryId?: string }) {
  const conditions = [];
  if (opts?.regionId) conditions.push(eq(costingFactoryFeeRates.regionId, opts.regionId));
  if (opts?.factoryId) conditions.push(eq(costingFactoryFeeRates.factoryId, opts.factoryId));
  return db
    .select()
    .from(costingFactoryFeeRates)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(costingFactoryFeeRates.sortOrder), asc(costingFactoryFeeRates.name));
}

export async function upsertFactoryFeeRate(input: {
  regionId: string;
  factoryId: string;
  name: string;
  rate: number;
  isActive?: boolean;
  sortOrder?: number;
}) {
  const [existing] = await db
    .select({ id: costingFactoryFeeRates.id })
    .from(costingFactoryFeeRates)
    .where(
      and(
        eq(costingFactoryFeeRates.regionId, input.regionId),
        eq(costingFactoryFeeRates.factoryId, input.factoryId),
        eq(costingFactoryFeeRates.name, input.name.trim()),
      ),
    )
    .limit(1);
  if (existing) {
    const [updated] = await db
      .update(costingFactoryFeeRates)
      .set({
        rate: String(input.rate),
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(costingFactoryFeeRates.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(costingFactoryFeeRates)
    .values({
      regionId: input.regionId,
      factoryId: input.factoryId,
      name: input.name.trim(),
      rate: String(input.rate),
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return created;
}

export async function disableFactoryFeeRate(id: string): Promise<boolean> {
  const rows = await db
    .update(costingFactoryFeeRates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(costingFactoryFeeRates.id, id))
    .returning({ id: costingFactoryFeeRates.id });
  return rows.length > 0;
}

export async function loadGenericSliceIds(): Promise<{
  genericRegionId: string;
  genericFactoryId: string;
}> {
  const [[region], [factory]] = await Promise.all([
    db
      .select({ id: costingRegions.id })
      .from(costingRegions)
      .where(eq(costingRegions.code, GENERIC_REGION_CODE))
      .limit(1),
    db
      .select({ id: costingFactories.id })
      .from(costingFactories)
      .where(eq(costingFactories.code, GENERIC_FACTORY_CODE))
      .limit(1),
  ]);
  if (!region || !factory) {
    throw new Error('未初始化通用区域或通用工厂，请执行数据库迁移 0077');
  }
  return { genericRegionId: region.id, genericFactoryId: factory.id };
}
