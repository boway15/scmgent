import { db } from '@scm/db';
import { sql } from 'drizzle-orm';

export type PriceBookImportRow = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  unitPrice: number;
  notes: string;
};

type ParsedPriceBookSheet = {
  rows: PriceBookImportRow[];
  errors: number;
};

const HEADER_ALIASES = {
  category: ['大类', 'category'],
  materialName: ['材料名称', 'material_name'],
  spec: ['规格', 'spec'],
  unit: ['单位', 'unit'],
  unitPrice: ['单价', 'unit_price'],
  notes: ['备注', 'notes'],
} as const;

function cellText(value: unknown): string {
  return String(value ?? '').trim();
}

function headerIndex(header: unknown[], aliases: readonly string[]): number {
  const normalized = header.map((cell) => cellText(cell).toLowerCase());
  return normalized.findIndex((cell) => aliases.includes(cell as never));
}

function parsePriceBookSheetDetailed(aoa: unknown[][]): ParsedPriceBookSheet {
  const header = aoa[0] ?? [];
  const indexes = {
    category: headerIndex(header, HEADER_ALIASES.category),
    materialName: headerIndex(header, HEADER_ALIASES.materialName),
    spec: headerIndex(header, HEADER_ALIASES.spec),
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
    const unitPrice = typeof rawPrice === 'number' ? rawPrice : Number(cellText(rawPrice));

    if (!category && !materialName && !unit && cellText(rawPrice) === '') continue;
    if (!category || !materialName || !unit || !Number.isFinite(unitPrice) || unitPrice < 0) {
      errors += 1;
      continue;
    }

    rows.push({
      category,
      materialName,
      spec: indexes.spec < 0 ? '' : cellText(line[indexes.spec]),
      unit,
      unitPrice,
      notes: indexes.notes < 0 ? '' : cellText(line[indexes.notes]),
    });
  }

  return { rows, errors };
}

export function parsePriceBookSheet(aoa: unknown[][]): PriceBookImportRow[] {
  return parsePriceBookSheetDetailed(aoa).rows;
}

export async function upsertPriceBookItems(rows: PriceBookImportRow[]): Promise<number> {
  if (!rows.length) return 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.execute(sql`
        INSERT INTO material_price_book (
          category, material_name, spec, unit, unit_price, notes, is_active, updated_at
        )
        VALUES (
          ${row.category}, ${row.materialName}, ${row.spec}, ${row.unit},
          ${String(row.unitPrice)}, ${row.notes || null}, true, now()
        )
        ON CONFLICT (lower(material_name), lower(spec), lower(unit))
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
