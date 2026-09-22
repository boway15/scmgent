export const GENERIC_REGION_CODE = 'generic';
export const GENERIC_FACTORY_CODE = 'generic';

export type MatchScope = 'factory' | 'region' | 'global';

export type SliceLookup = {
  regionId: string;
  factoryId: string;
  scope: MatchScope;
};

export type SliceContext = {
  regionId: string | null;
  factoryId: string | null;
  genericRegionId: string;
  genericFactoryId: string;
};

export function buildSliceLookups(ctx: SliceContext): SliceLookup[] {
  const { regionId, factoryId, genericRegionId, genericFactoryId } = ctx;
  const slices: SliceLookup[] = [];
  const seen = new Set<string>();

  const push = (lookup: SliceLookup) => {
    const key = `${lookup.regionId}\0${lookup.factoryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    slices.push(lookup);
  };

  if (regionId && factoryId && factoryId !== genericFactoryId) {
    push({ regionId, factoryId, scope: 'factory' });
  }
  if (regionId && regionId !== genericRegionId) {
    push({ regionId, factoryId: genericFactoryId, scope: 'region' });
  }
  if (factoryId && factoryId !== genericFactoryId && !regionId) {
    push({ regionId: genericRegionId, factoryId, scope: 'factory' });
  }
  push({ regionId: genericRegionId, factoryId: genericFactoryId, scope: 'global' });
  return slices;
}
