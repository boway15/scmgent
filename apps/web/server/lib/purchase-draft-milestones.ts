export type PurchaseDraftMilestonePatch = {
  plannedProductionDoneDate?: string | null;
  actualProductionDoneDate?: string | null;
  plannedPickupDate?: string | null;
  etd?: string | null;
  etaPort?: string | null;
  customsDoneDate?: string | null;
  etaWarehouse?: string | null;
  transportMode?: string | null;
};

const MILESTONE_FIELDS = [
  'plannedProductionDoneDate',
  'actualProductionDoneDate',
  'plannedPickupDate',
  'etd',
  'etaPort',
  'customsDoneDate',
  'etaWarehouse',
  'transportMode',
] as const;

export function buildMilestonePatch(
  body: PurchaseDraftMilestonePatch,
): PurchaseDraftMilestonePatch {
  const patch: PurchaseDraftMilestonePatch = {};
  for (const field of MILESTONE_FIELDS) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  return patch;
}
