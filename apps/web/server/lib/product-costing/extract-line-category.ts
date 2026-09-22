import type { MatchStatus } from './types.js';

/** AI 识别行（explicit）未关联价目时归入「其他」，规则/template 行保持原大类。 */
export function categoryForExtractLine(input: {
  origin: string;
  category: string;
  matchStatus: MatchStatus;
}): string {
  if (input.origin !== 'explicit') return input.category;
  if (input.matchStatus === 'exact' || input.matchStatus === 'name_only') return input.category;
  return '其他';
}

export const EXTRACT_OTHER_CATEGORY_NOTE = '未匹配价目，归入其他';

export function appendExtractOtherCategoryNote(
  notes: string | null | undefined,
  category: string,
  previousCategory: string,
): string | null {
  if (category !== '其他' || previousCategory === '其他') {
    return notes?.trim() || null;
  }
  const current = notes?.trim() ?? '';
  if (current.includes(EXTRACT_OTHER_CATEGORY_NOTE)) return current || null;
  return current ? `${current}；${EXTRACT_OTHER_CATEGORY_NOTE}` : EXTRACT_OTHER_CATEGORY_NOTE;
}
