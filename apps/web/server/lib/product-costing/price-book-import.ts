import { db } from '@scm/db';
import { sql } from 'drizzle-orm';
import { listCostingFactories, listCostingRegions, loadGenericSliceIds } from './costing-catalog.js';
import { parseUnitPrice } from './parse-unit-price.js';

export type PriceBookImportRow = {
  category: string;
  materialName: string;
  spec: string;
  standard: string;
  unit: string;
  unitPrice: number;
  notes: string;
  regionName: string;
  factoryName: string;
};

type ParsedPriceBookSheet = {
  rows: PriceBookImportRow[];
  errors: number;
};

const HEADER_ALIASES = {
  category: ['大类', 'category'],
  materialName: ['材料名称', 'material_name'],
  spec: ['规格', 'spec'],
  standard: ['标准', 'standard'],
  unit: ['单位', 'unit'],
  unitPrice: ['单价', 'unit_price'],
  notes: ['备注', 'notes'],
  regionName: ['地域', '区域', 'region'],
  factoryName: ['工厂', 'factory'],
} as const;

function cellText(value: unknown): string {
  return String(value ?? '').trim();
}

function headerIndex(header: unknown[], aliases: readonly string[]): number {
  const normalized = header.map((cell) => cellText(cell).toLowerCase());
  return normalized.findIndex((cell) => aliases.includes(cell as never));
}

export function parsePriceBookSheetDetailed(aoa: unknown[][]): ParsedPriceBookSheet {
  const header = aoa[0] ?? [];
  const indexes = {
    regionName: headerIndex(header, HEADER_ALIASES.regionName),
    factoryName: headerIndex(header, HEADER_ALIASES.factoryName),
    category: headerIndex(header, HEADER_ALIASES.category),
    materialName: headerIndex(header, HEADER_ALIASES.materialName),
    spec: headerIndex(header, HEADER_ALIASES.spec),
    standard: headerIndex(header, HEADER_ALIASES.standard),
    unit: headerIndex(header, HEADER_ALIASES.unit),
    unitPrice: headerIndex(header, HEADER_ALIASES.unitPrice),
    notes: headerIndex(header, HEADER_ALIASES.notes),
  };

  const required = [indexes.category, indexes.materialName, indexes.unit, indexes.unitPrice];
  if (required.some((index) => index < 0)) {
    throw new Error('价目表缺少必填列：大类、材料名称、单位或单价');
  }

  const rows: PriceBookImportRow[] = [];
  let errors = 0;
  for (const line of aoa.slice(1)) {
    const category = cellText(line[indexes.category]);
    const materialName = cellText(line[indexes.materialName]);
    const unit = cellText(line[indexes.unit]);
    const rawPrice = line[indexes.unitPrice];
    const unitPrice = parseUnitPrice(rawPrice);

    if (!category && !materialName && !unit && cellText(rawPrice) === '') continue;
    if (!category || !materialName || !unit || unitPrice === null) {
      errors += 1;
      continue;
    }

    rows.push({
      category,
      materialName,
      spec: indexes.spec < 0 ? '' : cellText(line[indexes.spec]),
      standard: indexes.standard < 0 ? '' : cellText(line[indexes.standard]),
      unit,
      unitPrice,
      notes: indexes.notes < 0 ? '' : cellText(line[indexes.notes]),
      regionName: indexes.regionName < 0 ? '' : cellText(line[indexes.regionName]),
      factoryName: indexes.factoryName < 0 ? '' : cellText(line[indexes.factoryName]),
    });
  }

  return { rows, errors };
}

export function parsePriceBookSheet(aoa: unknown[][]): PriceBookImportRow[] {
  return parsePriceBookSheetDetailed(aoa).rows;
}

export async function upsertPriceBookItems(rows: PriceBookImportRow[]): Promise<number> {
  if (!rows.length) return 0;
  const generic = await loadGenericSliceIds();
  const [regions, factories] = await Promise.all([listCostingRegions(), listCostingFactories()]);
  const regionByName = new Map(regions.map((item) => [item.name, item.id]));
  const factoryByName = new Map(factories.map((item) => [item.name, item.id]));

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const regionId = regionByName.get(row.regionName || '通用') ?? generic.genericRegionId;
      const factoryId = factoryByName.get(row.factoryName || '通用') ?? generic.genericFactoryId;
      await tx.execute(sql`
        INSERT INTO material_price_book (
          region_id, factory_id, category, material_name, spec, standard, unit,
          unit_price, notes, is_active, updated_at
        )
        VALUES (
          ${regionId}, ${factoryId}, ${row.category}, ${row.materialName}, ${row.spec},
          ${row.standard}, ${row.unit}, ${String(row.unitPrice)}, ${row.notes || null},
          true, now()
        )
        ON CONFLICT (region_id, factory_id, lower(material_name), lower(spec), lower(unit), lower(standard))
        DO UPDATE SET
          category = EXCLUDED.category,
          unit_price = EXCLUDED.unit_price,
          notes = EXCLUDED.notes,
          is_active = true,
          updated_at = now()
      `);
    }
  });

  return rows.length;
}

export async function importPriceBookWorkbook(
  buffer: ArrayBuffer,
): Promise<{ imported: number; errors: number }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { imported: 0, errors: 0 };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: true,
  });
  const parsed = parsePriceBookSheetDetailed(aoa);
  const imported = await upsertPriceBookItems(parsed.rows);
  return { imported, errors: parsed.errors };
}
