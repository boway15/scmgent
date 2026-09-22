/** 从板材规格里拆出厚度与开料尺寸，供清单展示。 */

export type ParsedBoardSpec = {
  thickness: string;
  thicknessMm: number | null;
  size: string;
};

const PLACEHOLDER = /^(未指定|未知规格|未标明|规格待定)$/;

function formatMm(value: number): string {
  return `${value}mm`;
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

function normalizeThicknessInput(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const parsed = parseBoardSpec(/\d/.test(text) && !/mm/i.test(text) && !/[x×*]/.test(text) ? `${text}mm` : text);
  return parsed.thickness || text;
}

/** Merge edited thickness and/or cut-size back into a stored spec string. */
export function composeBoardSpecParts(
  existing: string | null | undefined,
  parts: { thickness?: string; size?: string },
): string {
  const display = specDisplayParts(existing);
  let thickness = display.thickness;
  let size = display.size;
  if (parts.thickness !== undefined) {
    thickness = normalizeThicknessInput(parts.thickness);
  }
  if (parts.size !== undefined) {
    const next = parts.size.trim();
    if (!next) {
      size = '';
    } else {
      const incoming = parseBoardSpec(next);
      if (incoming.thickness && !incoming.size && !/[x×*]/.test(next)) {
        thickness = incoming.thickness;
      } else {
        size = incoming.size || next;
        if (incoming.thickness) thickness = incoming.thickness;
      }
    }
  }
  return [thickness, size].filter(Boolean).join(' ');
}

export function composeBoardSpec(existing: string | null | undefined, sizeInput: string): string {
  return composeBoardSpecParts(existing, { size: sizeInput });
}

export function pieceAreaM2(spec: string | null | undefined): number | null {
  const parsed = parseBoardSpec(spec);
  if (!parsed.size) return null;
  const match = parsed.size.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return (w * h) / 1_000_000;
}

export function boardUsageAreaM2(
  spec: string | null | undefined,
  qtyNet: number,
  lossRate: number,
): number | null {
  const piece = pieceAreaM2(spec);
  if (piece === null || qtyNet <= 0) return null;
  return Math.round(piece * qtyNet * (1 + lossRate) * 1_000_000) / 1_000_000;
}
