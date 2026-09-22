const SLIDE_CONTEXT = /滑轨|slide/i;

function normalizeSlideSpec(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** 从设计说明/结构摘要等文本推断抽屉滑轨规格（不含数量）。 */
export function inferDrawerSlideSpec(texts: (string | null | undefined)[]): string | null {
  const text = texts.filter((part): part is string => Boolean(part?.trim())).join('\n');
  if (!text || !SLIDE_CONTEXT.test(text)) return null;

  const compound = text.match(
    /(\d+\s*节\s*\d+\s*(?:寸|英寸|"|in)(?:\s*滚珠)?(?:\s*滑轨)?)/i,
  );
  if (compound) return normalizeSlideSpec(compound[1]!);

  const nearSlide = text.match(
    /滑轨[^，。;\n]{0,32}?(\d+\s*节\s*\d+\s*(?:寸|英寸|"|in)(?:\s*滚珠)?)/i,
  );
  if (nearSlide) return normalizeSlideSpec(nearSlide[1]!);

  const inchSlide = text.match(/(\d+\s*(?:寸|英寸|"|in)\s*(?:滚珠\s*)?滑轨)/i);
  if (inchSlide) return normalizeSlideSpec(inchSlide[1]!);

  const mmSlide = text.match(
    /(\d+\s*(?:mm|MM|毫米)\s*(?:三节|两节|二节|单节|滚珠\s*)?(?:滑轨)?)/,
  );
  if (mmSlide) return normalizeSlideSpec(mmSlide[1]!);

  return null;
}

const ANTI_TIP_CONTEXT = /防倾倒|anti[- ]?tip/i;

/** 文档（PPT 页文本/设计说明）是否出现防倾倒五金。 */
export function inferAntiTipSeen(texts: (string | null | undefined)[]): boolean {
  const text = texts.filter((part): part is string => Boolean(part?.trim())).join('\n');
  return Boolean(text && ANTI_TIP_CONTEXT.test(text));
}
