import { db, materialPriceBook } from '@scm/db';
import { and, desc, eq, ilike, ne, or, type InferSelectModel, type SQL } from 'drizzle-orm';
import { loadGenericSliceIds } from './costing-catalog.js';
import {
  findOverlappingPriceBookEntry,
  formatDateOnly,
  parseDateOnlyInput,
} from './price-effective.js';

export type MaterialPriceBookRow = InferSelectModel<typeof materialPriceBook>;

export class PriceBookOverlapError extends Error {
  constructor(message = '与同切片价目生效区间重叠') {
    super(message);
    this.name = 'PriceBookOverlapError';
  }
}

async function assertNoOverlap(input: {
  regionId: string | null;
  factoryId: string | null;
  materialName: string;
  spec: string;
  unit: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  excludeId?: string;
}) {
  const candidates = await db
    .select()
    .from(materialPriceBook)
    .where(and(eq(materialPriceBook.isActive, true), input.excludeId ? ne(materialPriceBook.id, input.excludeId) : undefined));
  const overlap = findOverlappingPriceBookEntry(
    candidates.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom ? String(row.effectiveFrom) : '2000-01-01',
      effectiveTo: row.effectiveTo ? String(row.effectiveTo) : null,
    })),
    input,
  );
  if (overlap) throw new PriceBookOverlapError();
}

export async function listPriceBook(opts: {
  q?: string;
  category?: string;
  regionId?: string;
  factoryId?: string;
  activeOnly?: boolean;
}): Promise<MaterialPriceBookRow[]> {
  const conditions: SQL[] = [];
  const q = opts.q?.trim();
  const category = opts.category?.trim();

  if (q) {
    conditions.push(
      or(
        ilike(materialPriceBook.materialName, `%${q}%`),
        ilike(materialPriceBook.spec, `%${q}%`),
      )!,
    );
  }
  if (category) conditions.push(eq(materialPriceBook.category, category));
  if (opts.regionId) conditions.push(eq(materialPriceBook.regionId, opts.regionId));
  if (opts.factoryId) conditions.push(eq(materialPriceBook.factoryId, opts.factoryId));
  if (opts.activeOnly) conditions.push(eq(materialPriceBook.isActive, true));

  return db
    .select()
    .from(materialPriceBook)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(materialPriceBook.updatedAt));
}

export async function createPriceBookItem(input: {
  category: string;
  materialName: string;
  spec?: string;
  standard?: string;
  unit: string;
  unitPrice: number;
  notes?: string;
  regionId?: string | null;
  factoryId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): Promise<MaterialPriceBookRow> {
  const generic =
    input.regionId && input.factoryId ? null : await loadGenericSliceIds();
  const regionId = input.regionId || generic?.genericRegionId || null;
  const factoryId = input.factoryId || generic?.genericFactoryId || null;
  const effectiveFrom = parseDateOnlyInput(input.effectiveFrom ?? '2000-01-01') ?? new Date('2000-01-01');
  const effectiveTo = input.effectiveTo ? parseDateOnlyInput(input.effectiveTo) : null;
  await assertNoOverlap({
    regionId,
    factoryId,
    materialName: input.materialName.trim(),
    spec: input.spec?.trim() ?? '',
    unit: input.unit.trim(),
    effectiveFrom,
    effectiveTo,
  });
  const [created] = await db
    .insert(materialPriceBook)
    .values({
      category: input.category.trim(),
      materialName: input.materialName.trim(),
      spec: input.spec?.trim() ?? '',
      standard: input.standard?.trim() ?? '',
      unit: input.unit.trim(),
      unitPrice: String(input.unitPrice),
      notes: input.notes?.trim() || null,
      regionId,
      factoryId,
      effectiveFrom: formatDateOnly(effectiveFrom),
      effectiveTo: effectiveTo ? formatDateOnly(effectiveTo) : null,
    })
    .returning();
  return created;
}

export async function updatePriceBookItem(
  id: string,
  patch: Partial<{
    category: string;
    materialName: string;
    spec: string;
    unit: string;
    unitPrice: number;
    notes: string;
    standard: string;
    regionId: string | null;
    factoryId: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>,
): Promise<MaterialPriceBookRow | null> {
  const [existing] = await db.select().from(materialPriceBook).where(eq(materialPriceBook.id, id)).limit(1);
  if (!existing) return null;

  const values: Partial<typeof materialPriceBook.$inferInsert> = { updatedAt: new Date() };
  if (patch.category !== undefined) values.category = patch.category.trim();
  if (patch.materialName !== undefined) values.materialName = patch.materialName.trim();
  if (patch.spec !== undefined) values.spec = patch.spec.trim();
  if (patch.standard !== undefined) values.standard = patch.standard.trim();
  if (patch.unit !== undefined) values.unit = patch.unit.trim();
  if (patch.unitPrice !== undefined) values.unitPrice = String(patch.unitPrice);
  if (patch.notes !== undefined) values.notes = patch.notes.trim() || null;
  if (patch.regionId !== undefined) values.regionId = patch.regionId;
  if (patch.factoryId !== undefined) values.factoryId = patch.factoryId;
  if (patch.effectiveFrom !== undefined) {
    values.effectiveFrom = formatDateOnly(parseDateOnlyInput(patch.effectiveFrom ?? '2000-01-01') ?? new Date('2000-01-01'));
  }
  if (patch.effectiveTo !== undefined) {
    const parsed = patch.effectiveTo ? parseDateOnlyInput(patch.effectiveTo) : null;
    values.effectiveTo = parsed ? formatDateOnly(parsed) : null;
  }

  const nextRegionId = values.regionId ?? existing.regionId;
  const nextFactoryId = values.factoryId ?? existing.factoryId;
  const nextFrom = parseDateOnlyInput(values.effectiveFrom ?? existing.effectiveFrom ?? '2000-01-01')!;
  const nextTo = values.effectiveTo !== undefined
    ? (values.effectiveTo ? parseDateOnlyInput(values.effectiveTo) : null)
    : (existing.effectiveTo ? parseDateOnlyInput(String(existing.effectiveTo)) : null);

  await assertNoOverlap({
    regionId: nextRegionId,
    factoryId: nextFactoryId,
    materialName: (values.materialName ?? existing.materialName).trim(),
    spec: (values.spec ?? existing.spec ?? '').trim(),
    unit: (values.unit ?? existing.unit).trim(),
    effectiveFrom: nextFrom,
    effectiveTo: nextTo,
    excludeId: id,
  });

  const [updated] = await db
    .update(materialPriceBook)
    .set(values)
    .where(eq(materialPriceBook.id, id))
    .returning();
  return updated ?? null;
}

export async function disablePriceBookItem(id: string): Promise<boolean> {
  const rows = await db
    .update(materialPriceBook)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(materialPriceBook.id, id))
    .returning({ id: materialPriceBook.id });
  return rows.length > 0;
}
