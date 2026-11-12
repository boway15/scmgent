import {
  isMappableRegion,
  type MappableRegion,
  type RuntimeRegion,
} from './region-codes.js';

export { isMappableRegion, type MappableRegion, type RuntimeRegion };

export type RegionMappingTables = {
  stations: Map<string, MappableRegion>;
  warehouses: Map<string, MappableRegion>;
};

export function normalizeStationKey(raw: string): string {
  return raw.trim();
}

export function resolveSalesRegion(
  station: string | null | undefined,
  tables: RegionMappingTables,
): RuntimeRegion {
  if (!station?.trim()) return 'UNMAPPED';
  return tables.stations.get(normalizeStationKey(station)) ?? 'UNMAPPED';
}

export function resolveFulfillmentRegion(
  warehouseCode: string | null | undefined,
  tables: RegionMappingTables,
): RuntimeRegion {
  if (!warehouseCode?.trim()) return 'UNMAPPED';
  return tables.warehouses.get(warehouseCode.trim()) ?? 'UNMAPPED';
}

export function invalidateRegionMappingCache(): void {
  // Task 2: wire to loadRegionMappingTables in-process cache
}

export async function loadRegionMappingTables(_db: unknown): Promise<RegionMappingTables> {
  throw new Error('loadRegionMappingTables is not implemented until region mapping tables land (Task 2)');
}
