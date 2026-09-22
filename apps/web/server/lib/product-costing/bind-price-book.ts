import {
  buildSliceLookups,
  type MatchScope,
  type SliceContext,
} from './costing-scope.js';
import { isPriceEffectiveOn } from './price-effective.js';

export class BindPriceBookError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'BindPriceBookError';
    this.statusCode = statusCode;
  }
}

type PriceBookSliceEntry = {
  regionId: string | null;
  factoryId: string | null;
};

function normalizedSlice(
  entry: PriceBookSliceEntry,
  genericRegionId: string,
  genericFactoryId: string,
): { regionId: string; factoryId: string } {
  return {
    regionId: entry.regionId ?? genericRegionId,
    factoryId: entry.factoryId ?? genericFactoryId,
  };
}

export function resolvePriceBookEntryScope(
  entry: PriceBookSliceEntry,
  genericRegionId: string,
  genericFactoryId: string,
): MatchScope {
  const slice = normalizedSlice(entry, genericRegionId, genericFactoryId);
  if (
    slice.regionId === genericRegionId &&
    slice.factoryId === genericFactoryId
  ) {
    return 'global';
  }
  if (slice.factoryId !== genericFactoryId) {
    return 'factory';
  }
  return 'region';
}

export function isPriceBookUsableForProject(
  entry: PriceBookSliceEntry,
  project: { regionId: string | null; factoryId: string | null },
  ctx: SliceContext,
): boolean {
  const entrySlice = normalizedSlice(entry, ctx.genericRegionId, ctx.genericFactoryId);
  return buildSliceLookups(ctx).some(
    (slice) =>
      slice.regionId === entrySlice.regionId && slice.factoryId === entrySlice.factoryId,
  );
}

export function assertPriceBookBindable(
  entry: PriceBookSliceEntry & {
    isActive: boolean;
    effectiveFrom?: string | Date | null;
    effectiveTo?: string | Date | null;
  },
  project: { regionId: string | null; factoryId: string | null },
  ctx: SliceContext,
  priceAsOf: Date,
): void {
  if (!entry.isActive) {
    throw new BindPriceBookError('价目已停用', 400);
  }
  if (!isPriceEffectiveOn(entry, priceAsOf)) {
    throw new BindPriceBookError('价目在计价日无效', 400);
  }
  if (!isPriceBookUsableForProject(entry, project, ctx)) {
    throw new BindPriceBookError('价目与当前区域/工厂不匹配', 400);
  }
}
