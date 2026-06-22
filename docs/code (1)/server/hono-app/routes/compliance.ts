import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, skus, skuCompliance } from '../_db';
import { deriveComplianceStatus, type ComplianceStatus } from '../lib/compliance';

function mapComplianceRow(
  sku: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    isActive: boolean;
  },
  compliance: typeof skuCompliance.$inferSelect | null,
) {
  const fields = compliance
    ? {
        hsCode: compliance.hsCode,
        originCountry: compliance.originCountry,
        declaredValue: compliance.declaredValue,
        weightKg: compliance.weightKg,
        lengthCm: compliance.lengthCm,
        widthCm: compliance.widthCm,
        heightCm: compliance.heightCm,
        batteryType: compliance.batteryType,
        isLiquid: compliance.isLiquid,
      }
    : null;

  return {
    skuId: sku.id,
    skuCode: sku.code,
    skuName: sku.name,
    category: sku.category,
    isActive: sku.isActive,
    complianceStatus: deriveComplianceStatus(fields),
    hsCode: compliance?.hsCode ?? null,
    originCountry: compliance?.originCountry ?? null,
    declaredValue: compliance?.declaredValue ?? null,
    weightKg: compliance?.weightKg ?? null,
    lengthCm: compliance?.lengthCm ?? null,
    widthCm: compliance?.widthCm ?? null,
    heightCm: compliance?.heightCm ?? null,
    batteryType: compliance?.batteryType ?? null,
    isLiquid: compliance?.isLiquid ?? false,
    updatedAt: compliance?.updatedAt ?? null,
  };
}

export const complianceRoutes = new Hono();

complianceRoutes.get('/compliance/overview', async (c) => {
  const category = c.req.query('category')?.trim();
  const statusFilter = c.req.query('status') as ComplianceStatus | undefined;

  const rows = await db
    .select({
      sku: skus,
      compliance: skuCompliance,
    })
    .from(skus)
    .leftJoin(skuCompliance, eq(skuCompliance.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(desc(skus.updatedAt));

  const mapped = rows
    .filter((r) => !category || r.sku.category === category)
    .map((r) => mapComplianceRow(r.sku, r.compliance));

  const stats = {
    total: mapped.length,
    complete: mapped.filter((m) => m.complianceStatus === 'complete').length,
    partial: mapped.filter((m) => m.complianceStatus === 'partial').length,
    missing: mapped.filter((m) => m.complianceStatus === 'missing').length,
  };

  const categories = [...new Set(rows.map((r) => r.sku.category).filter(Boolean))].sort() as string[];

  const gaps = mapped
    .filter((m) => m.complianceStatus !== 'complete')
    .filter((m) => !statusFilter || m.complianceStatus === statusFilter)
    .slice(0, 200);

  return c.json({ stats, categories, gaps });
});

complianceRoutes.get('/compliance/skus', async (c) => {
  const category = c.req.query('category')?.trim();
  const statusFilter = c.req.query('status') as ComplianceStatus | undefined;
  const q = c.req.query('q')?.trim().toLowerCase();

  const rows = await db
    .select({
      sku: skus,
      compliance: skuCompliance,
    })
    .from(skus)
    .leftJoin(skuCompliance, eq(skuCompliance.skuId, skus.id))
    .where(eq(skus.isActive, true))
    .orderBy(skus.code)
    .limit(500);

  const items = rows
    .map((r) => mapComplianceRow(r.sku, r.compliance))
    .filter((m) => !category || m.category === category)
    .filter((m) => !statusFilter || m.complianceStatus === statusFilter)
    .filter((m) => !q || m.skuCode.toLowerCase().includes(q) || m.skuName.toLowerCase().includes(q));

  return c.json(items);
});
