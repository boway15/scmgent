import { eq, and } from 'drizzle-orm';
import { db, leadTimeProfiles, merchants, skuSuppliers, warehouses } from '@scm/db';
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

export type LeadTimeProfileRow = {
  id: string;
  merchantCode: string | null;
  destinationWarehouseCode: string;
  transportMode: string | null;
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
};

export function pickLeadTimeProfile(
  rows: readonly LeadTimeProfileRow[],
  params: {
    merchantCode?: string | null;
    warehouseCode: string;
    transportMode?: string | null;
  },
): LeadTimeProfileRow | undefined {
  const mode = params.transportMode || null;
  const merchantCode = params.merchantCode || null;
  const matches = (candidateMerchant: string | null, candidateMode: string | null) =>
    rows.find(
      (row) =>
        row.destinationWarehouseCode === params.warehouseCode &&
        row.merchantCode === candidateMerchant &&
        row.transportMode === candidateMode,
    );

  return (
    (merchantCode && mode ? matches(merchantCode, mode) : undefined) ??
    (merchantCode ? matches(merchantCode, null) : undefined) ??
    (mode ? matches(null, mode) : undefined) ??
    matches(null, null)
  );
}

export async function resolveLeadTimeForSkuWarehouse(params: {
  skuId: string;
  merchantCode?: string | null;
  warehouseCode: string;
  skuLeadTimeDays?: number | null;
  transportMode?: string | null;
}): Promise<ResolvedLeadTime> {
  const profileRows = await db
    .select({
      id: leadTimeProfiles.id,
      merchantCode: leadTimeProfiles.merchantCode,
      destinationWarehouseCode: leadTimeProfiles.destinationWarehouseCode,
      transportMode: leadTimeProfiles.transportMode,
      productionDays: leadTimeProfiles.productionDays,
      domesticDays: leadTimeProfiles.domesticDays,
      bookingDays: leadTimeProfiles.bookingDays,
      transitDays: leadTimeProfiles.transitDays,
      customsDays: leadTimeProfiles.customsDays,
      inboundDays: leadTimeProfiles.inboundDays,
    })
    .from(leadTimeProfiles)
    .where(
      and(
        eq(leadTimeProfiles.destinationWarehouseCode, params.warehouseCode),
        eq(leadTimeProfiles.isDefault, true),
      ),
    );
  const profile = pickLeadTimeProfile(profileRows, params);

  if (profile) {
    return {
      ...calcTotalLeadTime({
        productionDays: profile.productionDays,
        domesticDays: profile.domesticDays,
        bookingDays: profile.bookingDays,
        transitDays: profile.transitDays,
        customsDays: profile.customsDays,
        inboundDays: profile.inboundDays,
      }),
      profileId: profile.id,
      merchantCode: params.merchantCode,
      warehouseCode: params.warehouseCode,
    };
  }

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
    profileId: null,
    merchantCode: params.merchantCode,
    warehouseCode: params.warehouseCode,
  };
}
