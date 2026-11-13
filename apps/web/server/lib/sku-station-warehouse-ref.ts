import { normalizeSalesPlatformSync } from './sales-platform.js';
import { preserveImportedSalesStation } from './sales-report-parser.js';

export type SkuStationWarehouseRefRow = {
  skuCode: string;
  station: string;
  channel: string;
  warehouseCode: string;
  resolution: 'unique' | 'dominant';
};

export function decodeCsvBytes(bytes: Buffer | Uint8Array | string): string {
  if (typeof bytes === 'string') return bytes.replace(/^\uFEFF/, '');
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const asUtf8 = buf.toString('utf8');
  const firstLine = asUtf8.split(/\r?\n/)[0] ?? '';
  if (/站点|station/i.test(firstLine) && /仓库|warehouse/i.test(firstLine)) {
    return asUtf8.replace(/^\uFEFF/, '');
  }
  try {
    return new TextDecoder('gb18030').decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return asUtf8.replace(/^\uFEFF/, '');
  }
}

export type SkuStationWarehouseCsvStats = {
  sourceRows: number;
  groups: number;
  uniqueWarehouseGroups: number;
  multiWarehouseGroups: number;
  uniqueRefs: SkuStationWarehouseRefRow[];
  dominantRefs: SkuStationWarehouseRefRow[];
  /** @deprecated 兼容旧调用方 */
  refs: SkuStationWarehouseRefRow[];
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function pickDominantWarehouse(counts: Map<string, number>): string {
  let bestWh = '';
  let bestCount = -1;
  for (const [wh, n] of counts) {
    if (n > bestCount || (n === bestCount && wh < bestWh)) {
      bestCount = n;
      bestWh = wh;
    }
  }
  return bestWh;
}

/** 解析 SKU,站点,平台,仓库 CSV → 策略 A（唯一仓）+ 策略 B（多仓主仓）参考行。 */
export function buildSkuStationWarehouseRefs(csvText: string): SkuStationWarehouseCsvStats {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return {
      sourceRows: 0,
      groups: 0,
      uniqueWarehouseGroups: 0,
      multiWarehouseGroups: 0,
      uniqueRefs: [],
      dominantRefs: [],
      refs: [],
    };
  }

  const header = parseCsvLine(lines[0]!).map((h) =>
    h.replace(/^\uFEFF/, '').trim().toLowerCase(),
  );
  const skuIdx = header.findIndex((h) => h === 'sku');
  const stationIdx = header.findIndex((h) => h === '站点' || h === 'station');
  const platformIdx = header.findIndex((h) => h === '平台' || h === 'platform' || h === 'channel');
  const whIdx = header.findIndex((h) => h === '仓库' || h === 'warehouse' || h === 'warehouse_code');
  if (skuIdx < 0 || stationIdx < 0 || platformIdx < 0 || whIdx < 0) {
    throw new Error('CSV 需包含列：SKU, 站点, 平台, 仓库');
  }

  const groupCounts = new Map<string, Map<string, number>>();
  let sourceRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]!);
    const skuCode = cols[skuIdx]?.trim() ?? '';
    const station = preserveImportedSalesStation(cols[stationIdx]?.trim() ?? '');
    const channel = normalizeSalesPlatformSync(cols[platformIdx]?.trim() ?? '');
    const warehouseCode = cols[whIdx]?.trim() ?? '';
    if (!skuCode || !station || !warehouseCode || channel === 'UNKNOWN') continue;
    sourceRows += 1;
    const key = `${skuCode}\t${station}\t${channel}`;
    if (!groupCounts.has(key)) groupCounts.set(key, new Map());
    const whMap = groupCounts.get(key)!;
    whMap.set(warehouseCode, (whMap.get(warehouseCode) ?? 0) + 1);
  }

  const uniqueRefs: SkuStationWarehouseRefRow[] = [];
  const dominantRefs: SkuStationWarehouseRefRow[] = [];
  let uniqueWarehouseGroups = 0;
  let multiWarehouseGroups = 0;

  for (const [key, whCounts] of groupCounts) {
    const [skuCode, station, channel] = key.split('\t');
    if (whCounts.size === 1) {
      uniqueWarehouseGroups += 1;
      uniqueRefs.push({
        skuCode: skuCode!,
        station: station!,
        channel: channel!,
        warehouseCode: [...whCounts.keys()][0]!,
        resolution: 'unique',
      });
    } else {
      multiWarehouseGroups += 1;
      dominantRefs.push({
        skuCode: skuCode!,
        station: station!,
        channel: channel!,
        warehouseCode: pickDominantWarehouse(whCounts),
        resolution: 'dominant',
      });
    }
  }

  return {
    sourceRows,
    groups: groupCounts.size,
    uniqueWarehouseGroups,
    multiWarehouseGroups,
    uniqueRefs,
    dominantRefs,
    refs: uniqueRefs,
  };
}

/** @deprecated 使用 buildSkuStationWarehouseRefs */
export function buildUniqueSkuStationWarehouseRefs(csvText: string): SkuStationWarehouseCsvStats {
  return buildSkuStationWarehouseRefs(csvText);
}
