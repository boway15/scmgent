import { eq, and } from 'drizzle-orm';
import { db, merchants, skuSuppliers, warehouses } from '@scm/db';
import {
  DEFAULT_INBOUND_BUFFER_DAYS,
  resolveProductionLeadDays,
  resolveShippingLeadDays,
  calcTotalLeadTime,
  type LeadTimeBreakdown,
} from './replenishment-coverage.js';

export type ResolvedLeadTime = LeadTimeBreakdown & {
  merchantCode?: string | null;
  warehouseCode: string;
};

export async function resolveLeadTimeForSkuWarehouse(params: {
  skuId: string;
  merchantCode?: string | null;
  warehouseCode: string;
  skuLeadTimeDays?: number | null;
}): Promise<ResolvedLeadTime> {
  let productionDays = resolveProductionLeadDays(params.skuLeadTimeDays);

  if (params.merchantCode) {
    const [merchant] = await db
      .select({ productionLeadDays: merchants.productionLeadDays })
      .from(merchants)
      .where(eq(merchants.code, params.merchantCode))
      .limit(1);
    if (merchant?.productionLeadDays) {
      productionDays = resolveProductionLeadDays(
        merchant.productionLeadDays,
        params.skuLeadTimeDays,
      );
    }
  }

  const [defaultSupplier] = await db
    .select({ leadTimeDays: skuSuppliers.leadTimeDays })
    .from(skuSuppliers)
    .where(and(eq(skuSuppliers.skuId, params.skuId), eq(skuSuppliers.isDefault, true)))
    .limit(1);

  productionDays = resolveProductionLeadDays(
    defaultSupplier?.leadTimeDays,
    productionDays,
    params.skuLeadTimeDays,
  );

  const [warehouse] = await db
    .select({
      shippingLeadDays: warehouses.shippingLeadDays,
      inboundBufferDays: warehouses.inboundBufferDays,
    })
    .from(warehouses)
    .where(eq(warehouses.code, params.warehouseCode))
    .limit(1);

  const shippingDays = resolveShippingLeadDays(
    params.warehouseCode,
    warehouse?.shippingLeadDays,
  );
  const breakdown = calcTotalLeadTime({
    productionDays,
    shippingDays,
    inboundBufferDays: warehouse?.inboundBufferDays ?? DEFAULT_INBOUND_BUFFER_DAYS,
  });

  return {
    ...breakdown,
    merchantCode: params.merchantCode,
    warehouseCode: params.warehouseCode,
  };
}
