import { parseMappableRegion, type MappableRegion } from './region-codes.js';
import { normalizeStationKey } from './region-mapping.js';

export type MappingKind = 'station' | 'warehouse';

export type ParsedMappingRow = {
  key: string;
  region: MappableRegion;
};

export type MappingParseResult =
  | { ok: true; rows: ParsedMappingRow[] }
  | { ok: false; message: string };

const HEADERS: Record<MappingKind, [string, string]> = {
  station: ['station', 'sales_region'],
  warehouse: ['warehouse_code', 'fulfillment_region'],
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseStationMappingBody(body: {
  station?: unknown;
  salesRegion?: unknown;
}): { ok: true; station: string; salesRegion: MappableRegion } | { ok: false; message: string } {
  const station = normalizeStationKey(asText(body.station));
  if (!station) return { ok: false, message: 'station is required' };
  const salesRegion = parseMappableRegion(asText(body.salesRegion));
  if (!salesRegion) return { ok: false, message: 'salesRegion must be US, CA, EU, UK, or OTHER' };
  return { ok: true, station, salesRegion };
}

export function parseWarehouseMappingBody(body: {
  warehouseCode?: unknown;
  fulfillmentRegion?: unknown;
}):
  | { ok: true; warehouseCode: string; fulfillmentRegion: MappableRegion }
  | { ok: false; message: string } {
  const warehouseCode = asText(body.warehouseCode).trim();
  if (!warehouseCode) return { ok: false, message: 'warehouseCode is required' };
  const fulfillmentRegion = parseMappableRegion(asText(body.fulfillmentRegion));
  if (!fulfillmentRegion) {
    return { ok: false, message: 'fulfillmentRegion must be US, CA, EU, UK, or OTHER' };
  }
  return { ok: true, warehouseCode, fulfillmentRegion };
}

function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''));
}

export function parseMappingCsv(text: string, kind: MappingKind): MappingParseResult {
  const table = parseCsvTable(text);
  if (table.length === 0) return { ok: false, message: 'CSV is empty' };
  const [expectedKey, expectedRegion] = HEADERS[kind];
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  if (header[0] !== expectedKey || header[1] !== expectedRegion) {
    return { ok: false, message: `CSV header must be ${expectedKey},${expectedRegion}` };
  }

  const merged = new Map<string, MappableRegion>();
  for (let i = 1; i < table.length; i += 1) {
    const key = (table[i][0] ?? '').trim();
    const region = parseMappableRegion(table[i][1] ?? '');
    if (!key || !region) {
      return {
        ok: false,
        message: `row ${i + 1} must map to US, CA, EU, UK, or OTHER`,
      };
    }
    merged.set(key, region);
  }
  if (merged.size === 0) return { ok: false, message: 'CSV has no data rows' };
  return {
    ok: true,
    rows: [...merged.entries()].map(([key, region]) => ({ key, region })),
  };
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toMappingCsv(kind: MappingKind, rows: Array<{ key: string; region: string }>): string {
  const [keyHeader, regionHeader] = HEADERS[kind];
  const lines = rows.map((row) => `${csvCell(row.key)},${csvCell(row.region)}`);
  return `${keyHeader},${regionHeader}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}
