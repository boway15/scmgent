import { db, materialPriceBook } from '@scm/db';
import { and, desc, eq, ilike, or, type InferSelectModel, type SQL } from 'drizzle-orm';

export type MaterialPriceBookRow = InferSelectModel<typeof materialPriceBook>;

export async function listPriceBook(opts: {
  q?: string;
  category?: string;
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
  unit: string;
  unitPrice: number;
  notes?: string;
}): Promise<MaterialPriceBookRow> {
  const [created] = await db
    .insert(materialPriceBook)
    .values({
      category: input.category.trim(),
      materialName: input.materialName.trim(),
      spec: input.spec?.trim() ?? '',
      unit: input.unit.trim(),
      unitPrice: String(input.unitPrice),
      notes: input.notes?.trim() || null,
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
  }>,
): Promise<MaterialPriceBookRow | null> {
  const values: Partial<typeof materialPriceBook.$inferInsert> = { updatedAt: new Date() };
  if (patch.category !== undefined) values.category = patch.category.trim();
  if (patch.materialName !== undefined) values.materialName = patch.materialName.trim();
  if (patch.spec !== undefined) values.spec = patch.spec.trim();
  if (patch.unit !== undefined) values.unit = patch.unit.trim();
  if (patch.unitPrice !== undefined) values.unitPrice = String(patch.unitPrice);
  if (patch.notes !== undefined) values.notes = patch.notes.trim() || null;

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
