import type { PageKind } from './types.js';

const MATERIAL_KEYWORDS = [
  '板',
  '密度板',
  '颗粒板',
  '实木',
  '五金',
  '滑轨',
  '拉手',
  '封边',
  'mm',
  '插排',
  '防倾倒',
];

const hasMaterialKeyword = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return MATERIAL_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
};

const isOnlyProductAndDepartment = (text: string): boolean => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.length <= 2 &&
    lines.every((line) => line.length <= 30) &&
    lines.some((line) => /部门|设计部|研发部|开发部/i.test(line))
  );
};

export function classifyPage(pageNo: number, text: string): PageKind {
  const trimmed = text.trim();
  if (/物料清单|bill of materials/i.test(trimmed)) return 'bom_list';
  if (/cmf|材质选择/i.test(trimmed)) return 'cmf';
  if (/产品尺寸|product size|W\s*\d/i.test(trimmed)) return 'size';
  if (/爆炸图|explosion|disassembly/i.test(trimmed)) return 'explosion';
  if (/设计说明|产品细节|design notes/i.test(trimmed)) return 'notes';
  if (pageNo === 1 || isOnlyProductAndDepartment(trimmed)) return 'cover';
  if (!trimmed) return 'unknown';
  return 'render';
}

const EXTRACT_ORDER: Record<PageKind, number> = {
  size: 0,
  cmf: 1,
  notes: 2,
  bom_list: 3,
  explosion: 4,
  unknown: 5,
  render: 6,
  cover: 7,
};

/** Size/CMF/notes first so later explosion pages can use overall size and prior lines. */
export function sortPagesForExtract<T extends { pageType: PageKind; pageNo: number }>(pages: T[]): T[] {
  return [...pages].sort((left, right) => {
    const order = (EXTRACT_ORDER[left.pageType] ?? 9) - (EXTRACT_ORDER[right.pageType] ?? 9);
    if (order !== 0) return order;
    return left.pageNo - right.pageNo;
  });
}

export function shouldSendPageToDify(
  kind: PageKind,
  text: string,
  options?: { pageNo?: number; hasRealImage?: boolean },
): boolean {
  if (kind === 'unknown') return options?.hasRealImage === true;
  if (kind !== 'cover' && kind !== 'render') return true;
  return hasMaterialKeyword(text);
}

const FACTS_PAGE_ORDER: Record<PageKind, number> = {
  size: 0,
  notes: 1,
  cmf: 2,
  cover: 3,
  explosion: 4,
  bom_list: 5,
  unknown: 6,
  render: 7,
};

/** Size/notes/CMF first; fall back to cover text when the deck has no design pages. */
export function selectPagesForFactsJudge<T extends { pageType: PageKind; pageNo: number }>(
  pages: T[],
  limit = 2,
): T[] {
  const ranked = [...pages]
    .filter(
      (page) => page.pageType === 'notes' || page.pageType === 'size' || page.pageType === 'cmf',
    )
    .sort((left, right) => {
      const order =
        (FACTS_PAGE_ORDER[left.pageType] ?? 9) - (FACTS_PAGE_ORDER[right.pageType] ?? 9);
      if (order !== 0) return order;
      return left.pageNo - right.pageNo;
    });
  if (ranked.length) return ranked.slice(0, limit);
  return pages.filter((page) => page.pageType === 'cover').slice(0, 1);
}

/** Step 2 BOM: explosion + size first; CMF/notes/bom_list still help specs. */
export function shouldSendPageToBomExtract(kind: PageKind): boolean {
  return (
    kind === 'size' ||
    kind === 'explosion' ||
    kind === 'cmf' ||
    kind === 'notes' ||
    kind === 'bom_list'
  );
}
