/** 从板材规格里拆出厚度与开料尺寸，供展示和按厚度匹配价目。 */

export type ParsedBoardSpec = {
  thickness: string;
  thicknessMm: number | null;
  size: string;
};

const PLACEHOLDER = /^(未指定|未知规格|未标明|规格待定)$/;

function formatMm(value: number): string {
  return Number.isInteger(value) ? `${value}mm` : `${value}mm`;
}

export function parseBoardSpec(spec: string | null | undefined): ParsedBoardSpec {
  const text = (spec ?? '').trim();
  if (!text || PLACEHOLDER.test(text)) {
    return { thickness: '', thicknessMm: null, size: '' };
  }

  const triple = text.match(
    /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i,
  );
  if (triple) {
    const nums = [Number(triple[1]), Number(triple[2]), Number(triple[3])];
    const thin = nums.filter((value) => value > 0 && value <= 40);
    if (thin.length !== 1) {
      return {
        thickness: '',
        thicknessMm: null,
        size: `${nums[0]}×${nums[1]}×${nums[2]}`,
      };
    }
    const thicknessMm = thin[0]!;
    const sizeParts = nums.filter((value) => value !== thicknessMm);
    return {
      thickness: formatMm(thicknessMm),
      thicknessMm,
      size: sizeParts.length === 2 ? `${sizeParts[0]}×${sizeParts[1]}` : '',
    };
  }

  const thicknessMatch = text.match(/(\d+(?:\.\d+)?)\s*mm/i);
  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  const thicknessMm = thicknessMatch ? Number(thicknessMatch[1]) : null;
  return {
    thickness: thicknessMm === null ? '' : formatMm(thicknessMm),
    thicknessMm,
    size: sizeMatch ? `${sizeMatch[1]}×${sizeMatch[2]}` : '',
  };
}

export function specDisplayParts(spec: string | null | undefined): { thickness: string; size: string } {
  const parsed = parseBoardSpec(spec);
  const raw = (spec ?? '').trim();
  if (parsed.size) return { thickness: parsed.thickness, size: parsed.size };
  if (!parsed.thickness) return { thickness: '', size: raw };
  const leftover = raw.replace(new RegExp(parsed.thickness.replace('.', '\\.'), 'i'), '').trim();
  return { thickness: parsed.thickness, size: leftover };
}
