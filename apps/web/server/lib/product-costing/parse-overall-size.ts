export type OverallSize = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
};

function compactDigits(value: string): number | null {
  const digits = value.replace(/\s+/g, '');
  if (!/^\d{3,4}$/.test(digits)) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 4000) return null;
  return parsed;
}

function firstMatch(
  texts: string[],
  pattern: RegExp,
  map: (match: RegExpMatchArray) => OverallSize | null,
): OverallSize | null {
  for (const text of texts) {
    const match = text.match(pattern);
    if (!match) continue;
    const size = map(match);
    if (size) return size;
  }
  return null;
}

export function formatOverallSize(size: OverallSize): string {
  return `W${size.widthMm} × D${size.depthMm} × H${size.heightMm} mm`;
}

/** Prefer 产品尺寸页；避免爆炸图/模板开料里的局部尺寸冒充整柜. */
export function parseOverallSizeFromPages(
  pages: Array<{ pageType?: string | null; text: string }>,
): OverallSize | null {
  const sizeTexts = pages.filter((page) => page.pageType === 'size').map((page) => page.text);
  return parseOverallSize(sizeTexts) ?? parseOverallSize(pages.map((page) => page.text));
}

/** Parse overall W×D×H in mm from size-page (or any) slide texts. */
export function parseOverallSize(texts: string[]): OverallSize | null {
  const joined = texts
    .map((text) => text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!joined.length) return null;

  const compact = firstMatch(
    joined,
    /(\d{3,4})\s*[x×X*]\s*(\d{3,4})\s*[x×X*]\s*(\d{3,4})/,
    (match) => {
      const widthMm = Number(match[1]);
      const depthMm = Number(match[2]);
      const heightMm = Number(match[3]);
      if ([widthMm, depthMm, heightMm].some((value) => value < 100 || value > 4000)) return null;
      return { widthMm, depthMm, heightMm };
    },
  );
  if (compact) return compact;

  const labeled = firstMatch(
    joined,
    /W\s*(\d{3,4}).{0,24}D\s*(\d{3,4}).{0,24}H\s*(\d{3,4})/i,
    (match) => ({
      widthMm: Number(match[1]),
      depthMm: Number(match[2]),
      heightMm: Number(match[3]),
    }),
  );
  if (labeled) return labeled;

  return firstMatch(
    joined,
    /W\s*((?:\d\s*){3,4}).{0,40}D\s*((?:\d\s*){3,4}).{0,40}H\s*((?:\d\s*){3,4})/i,
    (match) => {
      const widthMm = compactDigits(match[1] ?? '');
      const depthMm = compactDigits(match[2] ?? '');
      const heightMm = compactDigits(match[3] ?? '');
      if (widthMm == null || depthMm == null || heightMm == null) return null;
      return { widthMm, depthMm, heightMm };
    },
  );
}

/** Fallback when size-page OCR misses W×D×H but facts step captured it in text fields. */
export function parseOverallSizeFromProjectContext(input: {
  structureSummary?: string | null;
  designPrinciples?: string | null;
  bomLineTexts?: string[];
}): OverallSize | null {
  const texts = [input.structureSummary, input.designPrinciples, ...(input.bomLineTexts ?? [])].filter(
    (text): text is string => typeof text === 'string' && text.trim().length > 0,
  );
  return parseOverallSize(texts);
}

export function resolveOverallSize(input: {
  pageOverallSize?: OverallSize | null;
  structureSummary?: string | null;
  designPrinciples?: string | null;
  bomLineTexts?: string[];
}): OverallSize | null {
  return (
    input.pageOverallSize ??
    parseOverallSizeFromProjectContext({
      structureSummary: input.structureSummary,
      designPrinciples: input.designPrinciples,
      bomLineTexts: input.bomLineTexts,
    })
  );
}
