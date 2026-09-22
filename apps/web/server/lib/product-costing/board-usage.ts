import { parseBoardSpec } from './parse-board-spec.js';

/** 采购素板标称尺寸 1220×2440 mm（张价折 m² 用此面积） */
export const STANDARD_SHEET_MM = { width: 1220, length: 2440 };

/** 开料净料面 1200×2400 mm（修边后；片数按此套，不旋转） */
export const USABLE_SHEET_MM = { width: 1200, length: 2400 };

const STRUCTURE_PART =
  /侧板|顶底板|顶板|底板|背板|抽面|抽侧|抽后|抽底|桌面|桌面板|台面|横撑|层板|搁板|拉条/;

export function isStructureBoardPart(materialName: string): boolean {
  return STRUCTURE_PART.test(materialName.trim());
}

export function standardSheetAreaM2(): number {
  return (STANDARD_SHEET_MM.width * STANDARD_SHEET_MM.length) / 1_000_000;
}

/** Single-piece cut area in m² from spec like `18mm 1200×400`. */
export function pieceAreaM2(spec: string | null | undefined): number | null {
  const parsed = parseBoardSpec(spec);
  if (!parsed.size) return null;
  const match = parsed.size.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const widthMm = Number(match[1]);
  const lengthMm = Number(match[2]);
  if (!Number.isFinite(widthMm) || !Number.isFinite(lengthMm) || widthMm <= 0 || lengthMm <= 0) {
    return null;
  }
  return (widthMm * lengthMm) / 1_000_000;
}

/** Total usage area including loss. */
export function boardUsageAreaM2(
  spec: string | null | undefined,
  qtyNet: number,
  lossRate: number,
): number | null {
  const piece = pieceAreaM2(spec);
  if (piece === null || qtyNet <= 0) return null;
  return Math.round(piece * qtyNet * (1 + lossRate) * 1_000_000) / 1_000_000;
}

export function sheetUnitPriceToM2(sheetPrice: number): number {
  return sheetPrice / standardSheetAreaM2();
}

export function inferLineSubstrate(
  materialName: string,
  projectDefault?: string | null,
): string | null {
  const name = materialName.trim();
  if (!isStructureBoardPart(name) || /色板|浮雕|木皮|饰面/.test(name)) return null;
  if (/抽底/.test(name)) return '密度板';
  if (/背板/.test(name) && !/背拉|后拉/.test(name)) return '密度板';
  return projectDefault?.trim() || null;
}

export function applyLineSubstrates<T extends { category: string; materialName: string; substrate?: string | null }>(
  lines: T[],
  projectDefault?: string | null,
): T[] {
  return lines.map((line) => {
    if (line.category !== '板材') return line;
    if (line.substrate?.trim()) return line;
    const inferred = inferLineSubstrate(line.materialName, projectDefault);
    return inferred ? { ...line, substrate: inferred } : line;
  });
}

export function resolvePricingMaterialName(
  materialName: string,
  defaultSubstrate?: string | null,
): string {
  const name = materialName.trim();
  if (defaultSubstrate?.trim() && isStructureBoardPart(name) && !/色板|浮雕|木皮|饰面/.test(name)) {
    return defaultSubstrate.trim();
  }
  return name;
}

export function shouldCostBoardByArea(
  category: string,
  spec: string | null | undefined,
  qtyNet: number,
): boolean {
  return category === '板材' && qtyNet > 0 && pieceAreaM2(spec) !== null;
}
