import type { MatchStatus, PriceBookEntry } from './types.js';

const normalize = (value: string): string => value.trim().toLowerCase();

export function matchPriceBook(
  line: { materialName: string; spec: string; unit: string },
  book: PriceBookEntry[],
): { status: MatchStatus; priceBookId: string | null; hint?: string } {
  const materialName = normalize(line.materialName);
  const spec = normalize(line.spec);
  const unit = normalize(line.unit);
  const candidates = book.filter(
    (entry) =>
      normalize(entry.materialName) === materialName && normalize(entry.unit) === unit,
  );
  const exact = candidates.find((entry) => normalize(entry.spec) === spec);

  if (exact) return { status: 'exact', priceBookId: exact.id };
  if (candidates.length === 1) {
    return { status: 'name_only', priceBookId: candidates[0].id };
  }
  if (candidates.length > 1) {
    return { status: 'unmatched', priceBookId: null, hint: '规格待确认' };
  }
  return { status: 'unmatched', priceBookId: null };
}
