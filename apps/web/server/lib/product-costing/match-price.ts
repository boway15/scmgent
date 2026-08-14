import type { MatchStatus, PriceBookEntry } from './types.js';

const normalize = (value: string): string => value.trim().toLowerCase();

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
    return { status: 'unmatched', priceBookId: null, hint: MATCH_SPEC_HINT };
  }
  return { status: 'unmatched', priceBookId: null };
}
