import { canonicalMaterialName } from './category-rules.js';
import {
  isStructureBoardPart,
  pieceAreaM2,
  resolvePricingMaterialName,
  sheetUnitPriceToM2,
} from './board-usage.js';
import { parseBoardSpec } from './parse-board-spec.js';
import { buildSliceLookups, type MatchScope, type SliceContext } from './costing-scope.js';
import type { MatchStatus, PriceBookEntry } from './types.js';

const normalize = (value: string): string => canonicalMaterialName(value).trim().toLowerCase();

const HARDWARE_COUNT_UNITS = /^(套|个|只|件|副)$/;

function isHardwareCountUnit(unit: string): boolean {
  return HARDWARE_COUNT_UNITS.test(unit.trim());
}

/** 五金计数单位在价目与 BOM 间视为等价（与 sanitize 归一一致）。 */
function unitsCompatible(lineUnit: string, entryUnit: string): boolean {
  const left = lineUnit.trim().toLowerCase();
  const right = entryUnit.trim().toLowerCase();
  if (left === right) return true;
  return isHardwareCountUnit(lineUnit) && isHardwareCountUnit(entryUnit);
}

export const MATCH_SPEC_HINT = '规格待确认';

export function appendMatchHint(
  notes: string | null | undefined,
  hint?: string,
): string | null {
  const current = notes?.trim() ?? '';
  const withoutSystemHint = current
    .split('；')
    .map((part) => part.trim())
    .filter((part) => part && part !== MATCH_SPEC_HINT)
    .join('；');
  if (!hint) return withoutSystemHint || null;
  if (withoutSystemHint.includes(hint)) return withoutSystemHint || null;
  return withoutSystemHint ? `${withoutSystemHint}；${hint}` : hint;
}

export type PriceMatchResult = {
  status: MatchStatus;
  priceBookId: string | null;
  scope: MatchScope | null;
  hint?: string;
  bookUnit?: string | null;
  pricePerM2?: number | null;
};

function pricePerM2FromEntry(entry: PriceBookEntry): number | null {
  if (entry.unitPrice === undefined) return null;
  const unit = entry.unit.trim().toLowerCase();
  const price = Number(entry.unitPrice);
  if (!Number.isFinite(price)) return null;
  if (unit === '平方米' || unit === 'm2' || unit === '㎡') return price;
  if (unit === '张') return sheetUnitPriceToM2(price);
  return null;
}

function withScope(
  matched: PriceMatchResult,
  scope: MatchScope | null,
  entry?: PriceBookEntry,
): PriceMatchResult {
  if (!entry) return { ...matched, scope };
  return {
    ...matched,
    scope: matched.priceBookId ? scope : null,
    bookUnit: entry.unit,
    pricePerM2: pricePerM2FromEntry(entry),
  };
}

function pickBoardPriceEntry(candidates: PriceBookEntry[]): PriceBookEntry {
  return [...candidates].sort(
    (left, right) => Number(left.unitPrice ?? 0) - Number(right.unitPrice ?? 0),
  )[0]!;
}

function boardCandidates(
  book: PriceBookEntry[],
  pricingName: string,
  thicknessMm: number,
): PriceBookEntry[] {
  const thicknessLabel = `${thicknessMm}mm`;
  const units = ['张', '平方米', 'm2', '㎡'];
  return book.filter((entry) => {
    const name = normalize(entry.materialName);
    const spec = normalize(entry.spec);
    const unit = normalize(entry.unit);
    if (name !== normalize(pricingName)) return false;
    if (!units.includes(unit)) return false;
    return (
      spec === normalize(thicknessLabel) ||
      parseBoardSpec(entry.spec).thicknessMm === thicknessMm
    );
  });
}

function nearestSheetEntries(
  book: PriceBookEntry[],
  pricingName: string,
  thicknessMm: number,
): PriceBookEntry[] {
  const units = ['张', '平方米', 'm2', '㎡'];
  const withThickness = book.filter((entry) => {
    if (normalize(entry.materialName) !== normalize(pricingName)) return false;
    if (!units.includes(normalize(entry.unit))) return false;
    return parseBoardSpec(entry.spec).thicknessMm !== null;
  });
  if (!withThickness.length) return [];
  const ranked = [...withThickness].sort((left, right) => {
    const leftGap = Math.abs((parseBoardSpec(left.spec).thicknessMm ?? 0) - thicknessMm);
    const rightGap = Math.abs((parseBoardSpec(right.spec).thicknessMm ?? 0) - thicknessMm);
    return leftGap - rightGap || Number(left.unitPrice ?? 0) - Number(right.unitPrice ?? 0);
  });
  const bestGap = Math.abs((parseBoardSpec(ranked[0]!.spec).thicknessMm ?? 0) - thicknessMm);
  return ranked.filter(
    (entry) => Math.abs((parseBoardSpec(entry.spec).thicknessMm ?? 0) - thicknessMm) === bestGap,
  );
}

function matchBoardBySubstrate(
  line: { materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
  defaultSubstrate?: string | null,
): PriceMatchResult {
  const thicknessMm = parseBoardSpec(line.spec).thicknessMm;
  if (thicknessMm === null) {
    return { status: 'unmatched', priceBookId: null, scope: null };
  }

  const primaryName = resolvePricingMaterialName(line.materialName, defaultSubstrate);
  const substrateNames = [
    primaryName,
    ...['颗粒板', '密度板', '多层实木板'].filter(
      (name) => name !== primaryName && name.trim(),
    ),
  ];

  for (const pricingName of substrateNames) {
    const exact = boardCandidates(book, pricingName, thicknessMm);
    if (exact.length) {
      const entry = pickBoardPriceEntry(exact);
      return {
        status: exact.length === 1 ? 'exact' : 'name_only',
        priceBookId: entry.id,
        scope: null,
        bookUnit: entry.unit,
        pricePerM2: pricePerM2FromEntry(entry),
        hint: exact.length > 1 ? MATCH_SPEC_HINT : undefined,
      };
    }
  }
  for (const pricingName of substrateNames) {
    const nearest = nearestSheetEntries(book, pricingName, thicknessMm);
    if (!nearest.length) continue;
    const entry = pickBoardPriceEntry(nearest);
    const bookMm = parseBoardSpec(entry.spec).thicknessMm;
    return {
      status: 'name_only',
      priceBookId: entry.id,
      scope: null,
      bookUnit: entry.unit,
      pricePerM2: pricePerM2FromEntry(entry),
      hint: `价目无${thicknessMm}mm${pricingName}，暂按${bookMm}mm计价`,
    };
  }
  return { status: 'unmatched', priceBookId: null, scope: null };
}

function isBlockSimulationEntry(entry: PriceBookEntry): boolean {
  return entry.unit.trim() === '块' && isStructureBoardPart(entry.materialName);
}

function pickHardwarePriceEntry(
  candidates: PriceBookEntry[],
  lineMaterialName: string,
): PriceBookEntry {
  const rawLine = lineMaterialName.trim().toLowerCase();
  const exactRaw = candidates.filter(
    (entry) => entry.materialName.trim().toLowerCase() === rawLine,
  );
  if (exactRaw.length === 1) return exactRaw[0]!;
  if (exactRaw.length > 1) return pickBoardPriceEntry(exactRaw);

  const lineName = normalize(lineMaterialName);
  const exactLabel = candidates.filter((entry) => normalize(entry.materialName) === lineName);
  const pool = exactLabel.length ? exactLabel : candidates;
  return pickBoardPriceEntry(pool);
}

function matchInSlice(
  line: { materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
): PriceMatchResult {
  const materialName = normalize(line.materialName);
  const spec = normalize(line.spec);
  const unit = normalize(line.unit);
  let candidates = book.filter(
    (entry) =>
      normalize(entry.materialName) === materialName && unitsCompatible(line.unit, entry.unit),
  );
  if (pieceAreaM2(line.spec) !== null && isStructureBoardPart(line.materialName)) {
    candidates = candidates.filter((entry) => !isBlockSimulationEntry(entry));
  }
  const exact = candidates.find((entry) => normalize(entry.spec) === spec);
  if (exact) return { status: 'exact', priceBookId: exact.id, scope: null };

  const lineThickness = parseBoardSpec(line.spec).thicknessMm;
  if (lineThickness !== null) {
    const byThickness = candidates.filter(
      (entry) => parseBoardSpec(entry.spec).thicknessMm === lineThickness,
    );
    if (byThickness.length === 1) {
      return { status: 'exact', priceBookId: byThickness[0]!.id, scope: null };
    }
    if (byThickness.length > 1) {
      return { status: 'unmatched', priceBookId: null, scope: null, hint: MATCH_SPEC_HINT };
    }
  }

  const genericCandidates = candidates.filter((entry) => !normalize(entry.spec));
  if (genericCandidates.length >= 1 && (!spec || genericCandidates.length === candidates.length)) {
    const entry = pickHardwarePriceEntry(genericCandidates, line.materialName);
    return {
      status: 'name_only',
      priceBookId: entry.id,
      scope: null,
      hint: genericCandidates.length > 1 ? MATCH_SPEC_HINT : undefined,
    };
  }

  if (candidates.length === 1) {
    return { status: 'name_only', priceBookId: candidates[0]!.id, scope: null };
  }
  if (candidates.length > 1) {
    return { status: 'unmatched', priceBookId: null, scope: null, hint: MATCH_SPEC_HINT };
  }
  return { status: 'unmatched', priceBookId: null, scope: null };
}

function sameSlice(entry: PriceBookEntry, regionId: string, factoryId: string): boolean {
  if (!entry.regionId || !entry.factoryId) {
    return regionId === '' && factoryId === '';
  }
  return entry.regionId === regionId && entry.factoryId === factoryId;
}

export function matchPriceBook(
  line: { materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
  ctx?: SliceContext,
): PriceMatchResult {
  if (!ctx) {
    return matchInSlice(line, book);
  }

  for (const slice of buildSliceLookups(ctx)) {
    const scoped = book.filter((entry) => sameSlice(entry, slice.regionId, slice.factoryId));
    if (!scoped.length) continue;
    const matched = matchInSlice(line, scoped);
    if (matched.status !== 'unmatched' || matched.hint) {
      const entry = scoped.find((item) => item.id === matched.priceBookId);
      return withScope(matched, matched.priceBookId ? slice.scope : null, entry);
    }
  }
  return { status: 'unmatched', priceBookId: null, scope: null };
}

/** Prefer substrate+thickness area pricing for cut board lines; fallback to name/unit match. */
export function matchCostingLine(
  line: { category: string; materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
  ctx?: SliceContext,
  defaultSubstrate?: string | null,
): PriceMatchResult {
  const tryBoard =
    line.category === '板材' && parseBoardSpec(line.spec).thicknessMm !== null
      ? matchBoardBySubstrate(line, book, defaultSubstrate)
      : null;

  const runScoped = (matcher: (scoped: PriceBookEntry[]) => PriceMatchResult): PriceMatchResult => {
    if (!ctx) return matcher(book);
    for (const slice of buildSliceLookups(ctx)) {
      const scoped = book.filter((entry) => sameSlice(entry, slice.regionId, slice.factoryId));
      if (!scoped.length) continue;
      const matched = matcher(scoped);
      if (matched.status !== 'unmatched' || matched.hint) {
        const entry = scoped.find((item) => item.id === matched.priceBookId);
        return withScope(matched, matched.priceBookId ? slice.scope : null, entry);
      }
    }
    return { status: 'unmatched', priceBookId: null, scope: null };
  };

  if (tryBoard?.priceBookId) {
    return runScoped((scoped) => matchBoardBySubstrate(line, scoped, defaultSubstrate));
  }

  const normal = runScoped((scoped) => matchInSlice(line, scoped));
  if (normal.priceBookId || normal.hint) return normal;

  if (tryBoard) {
    return runScoped((scoped) => matchBoardBySubstrate(line, scoped, defaultSubstrate));
  }
  return normal;
}

export type FeeRateEntry = {
  name: string;
  rate: number;
  regionId: string;
  factoryId: string;
  isActive?: boolean;
};

export function resolveFeeRates(ctx: SliceContext, rates: FeeRateEntry[]): Array<{
  name: string;
  rate: number;
  scope: MatchScope;
}> {
  const active = rates.filter((rate) => rate.isActive !== false);
  const byName = new Map<string, { name: string; rate: number; scope: MatchScope }>();
  for (const slice of buildSliceLookups(ctx)) {
    for (const rate of active) {
      if (rate.regionId !== slice.regionId || rate.factoryId !== slice.factoryId) continue;
      if (byName.has(rate.name)) continue;
      byName.set(rate.name, { name: rate.name, rate: rate.rate, scope: slice.scope });
    }
  }
  return [...byName.values()];
}
