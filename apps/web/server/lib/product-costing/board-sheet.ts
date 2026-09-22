import { STANDARD_SHEET_MM, USABLE_SHEET_MM, isStructureBoardPart, pieceAreaM2 } from './board-usage.js';
import { canonicalMaterialName } from './category-rules.js';
import { parseBoardSpec } from './parse-board-spec.js';

export type ProcessOverrides = {
  cutMeters?: number | null;
  bandMeters?: number | null;
  drillCount?: number | null;
  grooveMeters?: number | null;
  paintAreaM2?: number | null;
  cutRate?: number | null;
  bandRate?: number | null;
  drillRate?: number | null;
  grooveRate?: number | null;
  paintRate?: number | null;
};

export type ProcessRates = {
  cut: number;
  band: number;
  drill: number;
  groove: number;
  paint: number;
};

export const DEFAULT_PROCESS_RATES: ProcessRates = {
  cut: 0.3,
  band: 0.5,
  drill: 0.15,
  groove: 0.5,
  paint: 0,
};

export const ROLLED_PROCESS_NAMES = ['开料', '封边', '打孔', '开槽', '喷漆'] as const;

export type BoardSheetRow = {
  lineId?: string;
  materialName: string;
  substrate: string;
  thicknessMm: number | null;
  lengthMm: number;
  widthMm: number;
  usableWidthMm: number;
  usableLengthMm: number;
  qty: number;
  sheetPrice: number;
  piecesPerSheet: number;
  boardCost: number;
  cutMeters: number;
  cutRate: number;
  cutAmount: number;
  bandMeters: number;
  bandRate: number;
  bandAmount: number;
  drillCount: number;
  drillRate: number;
  drillAmount: number;
  grooveMeters: number;
  grooveRate: number;
  grooveAmount: number;
  paintAreaM2: number;
  paintRate: number;
  paintAmount: number;
  subtotal: number;
  pricingMode: 'sheet' | 'area';
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseProcessOverrides(raw: unknown): ProcessOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const out: ProcessOverrides = {};
  for (const key of [
    'cutMeters',
    'bandMeters',
    'drillCount',
    'grooveMeters',
    'paintAreaM2',
    'cutRate',
    'bandRate',
    'drillRate',
    'grooveRate',
    'paintRate',
  ] as const) {
    const value = record[key];
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = value;
    }
  }
  return out;
}

export function resolveProcessRatesFromBook(
  book: Array<{ materialName: string; unitPrice?: number | string }>,
): ProcessRates {
  const rates = { ...DEFAULT_PROCESS_RATES };
  for (const row of book) {
    const name = canonicalMaterialName(row.materialName);
    const price = Number(row.unitPrice);
    if (!Number.isFinite(price)) continue;
    if (name === '开料') rates.cut = price;
    else if (name === '封边') rates.band = price;
    else if (name === '打孔') rates.drill = price;
    else if (name === '开槽') rates.groove = price;
    else if (name === '喷漆') rates.paint = price;
  }
  return rates;
}

export function isRolledProcessLine(category: string, name: string): boolean {
  if (category !== '加工') return false;
  const canonical = canonicalMaterialName(name);
  return (ROLLED_PROCESS_NAMES as readonly string[]).includes(canonical);
}

export function piecesPerSheet(lengthMm: number, widthMm: number): number {
  if (!(lengthMm > 0) || !(widthMm > 0)) return 0;
  const { width: sheetW, length: sheetL } = USABLE_SHEET_MM;
  return Math.max(0, Math.floor(sheetW / widthMm) * Math.floor(sheetL / lengthMm));
}

export function perimeterMeters(lengthMm: number, widthMm: number, qty: number): number {
  return money(((2 * (lengthMm + widthMm)) / 1000) * qty);
}

function parseSizeMm(spec: string | null | undefined): { lengthMm: number; widthMm: number } | null {
  const size = parseBoardSpec(spec).size;
  const match = size.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return { lengthMm: Math.max(a, b), widthMm: Math.min(a, b) };
}

function pickNumber(override: number | null | undefined, fallback: number): number {
  return typeof override === 'number' && Number.isFinite(override) ? override : fallback;
}

export function resolveSheetPrice(input: {
  unitPriceOverride: number | null;
  bookUnitPrice: number | null;
  bookUnit?: string | null;
  pricePerM2?: number | null;
}): number | null {
  if (input.unitPriceOverride !== null && Number.isFinite(input.unitPriceOverride)) {
    return input.unitPriceOverride;
  }
  const unit = (input.bookUnit ?? '').trim().toLowerCase();
  if (unit === '张' && input.bookUnitPrice !== null && Number.isFinite(input.bookUnitPrice)) {
    return input.bookUnitPrice;
  }
  if (input.pricePerM2 !== null && input.pricePerM2 !== undefined && Number.isFinite(input.pricePerM2)) {
    const area = (STANDARD_SHEET_MM.width * STANDARD_SHEET_MM.length) / 1_000_000;
    return money(input.pricePerM2 * area);
  }
  if (input.bookUnitPrice !== null && Number.isFinite(input.bookUnitPrice)) {
    return input.bookUnitPrice;
  }
  return null;
}

export function buildBoardSheetRow(input: {
  lineId?: string;
  materialName: string;
  spec: string;
  qtyNet: number;
  sheetPrice: number | null;
  defaultSubstrate?: string | null;
  rates: ProcessRates;
  overrides?: ProcessOverrides;
  areaFallback?: { usageAreaM2: number; pricePerM2: number } | null;
}): BoardSheetRow | null {
  const size = parseSizeMm(input.spec);
  if (!size || !(input.qtyNet > 0)) return null;
  const thicknessMm = parseBoardSpec(input.spec).thicknessMm;
  const pieces = piecesPerSheet(size.lengthMm, size.widthMm);
  const perimeter = perimeterMeters(size.lengthMm, size.widthMm, input.qtyNet);
  const overrides = input.overrides ?? {};
  const rates = {
    cut: pickNumber(overrides.cutRate, input.rates.cut),
    band: pickNumber(overrides.bandRate, input.rates.band),
    drill: pickNumber(overrides.drillRate, input.rates.drill),
    groove: pickNumber(overrides.grooveRate, input.rates.groove),
    paint: pickNumber(overrides.paintRate, input.rates.paint),
  };

  let boardCost: number;
  let pricingMode: 'sheet' | 'area' = 'sheet';
  let sheetPrice = input.sheetPrice ?? 0;
  if (pieces >= 1 && input.sheetPrice !== null) {
    boardCost = money((input.sheetPrice / pieces) * input.qtyNet);
  } else if (input.areaFallback) {
    pricingMode = 'area';
    boardCost = money(input.areaFallback.usageAreaM2 * input.areaFallback.pricePerM2);
    sheetPrice = input.sheetPrice ?? money(input.areaFallback.pricePerM2 * (STANDARD_SHEET_MM.width * STANDARD_SHEET_MM.length) / 1_000_000);
  } else {
    return null;
  }

  const cutMeters = pickNumber(overrides.cutMeters, perimeter);
  const bandMeters = pickNumber(overrides.bandMeters, perimeter);
  const drillCount = pickNumber(overrides.drillCount, 0);
  const grooveMeters = pickNumber(overrides.grooveMeters, 0);
  const paintAreaM2 = pickNumber(overrides.paintAreaM2, 0);

  const cutAmount = money(cutMeters * rates.cut);
  const bandAmount = money(bandMeters * rates.band);
  const drillAmount = money(drillCount * rates.drill);
  const grooveAmount = money(grooveMeters * rates.groove);
  const paintAmount = money(paintAreaM2 * rates.paint);
  const processTotal = money(cutAmount + bandAmount + drillAmount + grooveAmount + paintAmount);

  return {
    lineId: input.lineId,
    materialName: input.materialName,
    substrate:
      input.defaultSubstrate?.trim() && isStructureBoardPart(input.materialName)
        ? input.defaultSubstrate.trim()
        : input.materialName,
    thicknessMm,
    lengthMm: size.lengthMm,
    widthMm: size.widthMm,
    usableWidthMm: USABLE_SHEET_MM.width,
    usableLengthMm: USABLE_SHEET_MM.length,
    qty: input.qtyNet,
    sheetPrice,
    piecesPerSheet: pieces,
    boardCost,
    cutMeters,
    cutRate: rates.cut,
    cutAmount,
    bandMeters,
    bandRate: rates.band,
    bandAmount,
    drillCount,
    drillRate: rates.drill,
    drillAmount,
    grooveMeters,
    grooveRate: rates.groove,
    grooveAmount,
    paintAreaM2,
    paintRate: rates.paint,
    paintAmount,
    subtotal: money(boardCost + processTotal),
    pricingMode,
  };
}

export function pieceAreaFromSpec(spec: string): number | null {
  return pieceAreaM2(spec);
}
