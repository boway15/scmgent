import {
  stationSalesRegionMaps,
  warehouseFulfillmentRegionMaps,
} from '@scm/db';
import {
  isMappableRegion,
  parseMappableRegion,
  type MappableRegion,
  type RuntimeRegion,
} from './region-codes.js';
import { normalizeSalesRegionLabel } from './region-label.js';

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

/**
 * 运行时单行销量销售区域：行上码优先，其次站点映射；未知为 UNMAPPED。
 * 预测生成、护栏、准确率、补货分桶应与该函数一致。
 */
export function resolveSalesRowRegion(
  row: { salesRegion?: string | null; station?: string | null },
  tables: RegionMappingTables,
): RuntimeRegion {
  const coded = row.salesRegion?.trim().toUpperCase();
  if (coded && (isMappableRegion(coded) || coded === 'UNMAPPED')) return coded as RuntimeRegion;
  return resolveSalesRegion(row.station ?? null, tables);
}

export function resolveFulfillmentRegion(
  warehouseCode: string | null | undefined,
  tables: RegionMappingTables,
): RuntimeRegion {
  if (!warehouseCode?.trim()) return 'UNMAPPED';
  return tables.warehouses.get(warehouseCode.trim()) ?? 'UNMAPPED';
}

/**
 * 销量入库用区域：优先行上区域（飞书汉字/码归一），否则站点映射；仍未知则 null（展示为空，不写 UNMAPPED）。
 */
export function resolveInboundSalesRegion(
  regionRaw: string | null | undefined,
  station: string | null | undefined,
  tables: RegionMappingTables,
): string | null {
  const fromRow = normalizeSalesRegionLabel(regionRaw);
  if (fromRow) return fromRow;
  if (!station?.trim()) return null;
  return tables.stations.get(normalizeStationKey(station)) ?? null;
}

type MappingRow = {
  station?: string | null;
  salesRegion?: string | null;
  warehouseCode?: string | null;
  fulfillmentRegion?: string | null;
};

type MappingDb = {
  select: (shape: Record<string, unknown>) => {
    from: (table: unknown) => Promise<MappingRow[]>;
  };
};

let regionMappingCache: RegionMappingTables | null = null;
let regionMappingGeneration = 0;

export function invalidateRegionMappingCache(): void {
  regionMappingGeneration += 1;
  regionMappingCache = null;
}

function rememberRegion(
  map: Map<string, MappableRegion>,
  key: string | null | undefined,
  regionRaw: string | null | undefined,
): void {
  const normalized = key?.trim();
  if (!normalized || !regionRaw) return;
  const region = parseMappableRegion(regionRaw);
  if (!region) return;
  map.set(normalized, region);
}

export async function loadRegionMappingTables(db: unknown): Promise<RegionMappingTables> {
  if (regionMappingCache) return regionMappingCache;
  const loadGeneration = regionMappingGeneration;
  const reader = db as MappingDb;
  if (!reader || typeof reader.select !== 'function') {
    throw new Error('loadRegionMappingTables requires a drizzle database');
  }

  const stationRows = await reader
    .select({
      station: stationSalesRegionMaps.station,
      salesRegion: stationSalesRegionMaps.salesRegion,
    })
    .from(stationSalesRegionMaps);
  const warehouseRows = await reader
    .select({
      warehouseCode: warehouseFulfillmentRegionMaps.warehouseCode,
      fulfillmentRegion: warehouseFulfillmentRegionMaps.fulfillmentRegion,
    })
    .from(warehouseFulfillmentRegionMaps);

  const stations = new Map<string, MappableRegion>();
  for (const row of stationRows) rememberRegion(stations, row.station, row.salesRegion);
  const warehouses = new Map<string, MappableRegion>();
  for (const row of warehouseRows) {
    rememberRegion(warehouses, row.warehouseCode, row.fulfillmentRegion);
  }

  const tables = { stations, warehouses };
  if (loadGeneration === regionMappingGeneration) {
    regionMappingCache = tables;
  }
  return tables;
}
