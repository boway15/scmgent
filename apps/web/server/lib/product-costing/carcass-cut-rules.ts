export type CarcassCutPart = {
  lengthMm: number;
  widthMm: number;
  qty: number;
};

export type CarcassCutInput = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  sideThicknessMm: number;
  drawerCount: number;
  drawerFrontWidthMm: number;
  drawerFrontHeightMm: number;
  /** 默认盖板：顶板长=柜宽 */
  topCoversSides?: boolean;
  /** 默认侧板落地：取消底板，改两根 50mm 拉条 */
  sidesToFloor?: boolean;
};

export type CarcassCuts = {
  top: CarcassCutPart;
  bottom: CarcassCutPart | null;
  floorRails: CarcassCutPart | null;
  sides: CarcassCutPart;
  back: CarcassCutPart & { split: boolean };
  backRail: CarcassCutPart | null;
  drawerFront: CarcassCutPart;
  drawerSide: CarcassCutPart;
  drawerBack: CarcassCutPart;
  drawerBottom: CarcassCutPart;
  frontRails: CarcassCutPart;
};

function dim(value: number): number {
  return Math.max(1, Math.round(value));
}

const GRID_GAP_MM = 16;

/** 九抽菱格等多为 3×3；六抽多为 2×3。 */
export function inferDrawerGrid(drawerCount: number): { cols: number; rows: number } {
  if (!Number.isFinite(drawerCount) || drawerCount <= 0) return { cols: 1, rows: 0 };
  if (drawerCount === 9) return { cols: 3, rows: 3 };
  if (drawerCount === 6) return { cols: 2, rows: 3 };
  if (drawerCount === 4) return { cols: 2, rows: 2 };
  if (drawerCount % 3 === 0 && drawerCount >= 6) return { cols: 3, rows: drawerCount / 3 };
  if (drawerCount % 2 === 0) return { cols: 2, rows: drawerCount / 2 };
  return { cols: 1, rows: drawerCount };
}

export function inferDefaultDrawerFrontSize(input: {
  widthMm: number;
  heightMm: number;
  kickMm?: number;
  sideThicknessMm: number;
  drawerCount: number;
}): { widthMm: number; heightMm: number } {
  const { cols, rows } = inferDrawerGrid(input.drawerCount);
  const usableH = Math.max(120, input.heightMm - (input.kickMm ?? 0));
  const widthMm = dim((input.widthMm - input.sideThicknessMm) / cols);
  const heightMm =
    rows > 0 ? dim((usableH - (rows - 1) * GRID_GAP_MM) / rows) : dim(usableH / Math.max(1, input.drawerCount));
  return { widthMm, heightMm };
}

/** 无抽屉数时，用外形尺寸判断基材开料是否像抽面（避免补空「抽面」模板）。 */
export function looksLikeDrawerFrontCut(
  faceW: number,
  faceH: number,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
): boolean {
  if (faceW < 100 || faceH < 80) return false;
  if (faceW >= cabinetWidthMm * 0.85 || faceH >= cabinetHeightMm * 0.85) return false;
  return faceW <= cabinetWidthMm * 0.75 && faceH <= 600;
}

export function isImplausibleDrawerFrontSize(
  lengthMm: number,
  widthMm: number,
  cabinetWidthMm: number,
  cabinetHeightMm: number,
  drawerCount: number,
): boolean {
  if (drawerCount <= 1) return false;
  const faceW = Math.max(lengthMm, widthMm);
  const faceH = Math.min(lengthMm, widthMm);
  if (faceW >= cabinetWidthMm * 0.85) return true;
  const { rows } = inferDrawerGrid(drawerCount);
  const minReasonableH = Math.max(120, Math.floor((cabinetHeightMm - 80) / rows) * 0.65);
  return faceH > 0 && faceH < minReasonableH;
}

/** 1-2抽 0 根；3-4→1；5-6→2；7-8→3，即 ceil((n-2)/2)。 */
export function frontRailCount(drawerCount: number): number {
  if (!Number.isFinite(drawerCount) || drawerCount <= 2) return 0;
  return Math.ceil((drawerCount - 2) / 2);
}

export type FrontRailQtySource = 'explicit' | 'formula';

export type FrontRailQtyResolution = {
  qty: number;
  source: FrontRailQtySource;
  formulaQty: number;
  explicitQty: number | null;
};

type FrontRailLine = { materialName: string; origin: string; qtyNet: number };

/** 爆炸图/物料清单明示件数优先；否则 fallback 公式。 */
export function resolveFrontRailQty(
  lines: ReadonlyArray<FrontRailLine>,
  drawerCount: number,
  isFrontRail: (materialName: string) => boolean = (name) => name === '前拉条',
): FrontRailQtyResolution {
  const formulaQty = frontRailCount(drawerCount);
  let explicitQty: number | null = null;
  for (const line of lines) {
    if (!isFrontRail(line.materialName.trim())) continue;
    if (line.origin !== 'explicit' || !(line.qtyNet > 0)) continue;
    explicitQty = explicitQty == null ? line.qtyNet : Math.max(explicitQty, line.qtyNet);
  }
  if (explicitQty != null && explicitQty > 0) {
    return { qty: explicitQty, source: 'explicit', formulaQty, explicitQty };
  }
  return { qty: formulaQty, source: 'formula', formulaQty, explicitQty: null };
}

export function computeCarcassCuts(input: CarcassCutInput): CarcassCuts {
  const topCoversSides = input.topCoversSides !== false;
  const sidesToFloor = input.sidesToFloor !== false;
  const t = input.sideThicknessMm;
  const innerWidth = dim(input.widthMm - 2 * t);
  const drawerSideLength = dim(input.depthMm - 50);
  const drawerSideWidth = dim(input.drawerFrontHeightMm - 60);
  const frontRailQty = frontRailCount(input.drawerCount);
  const splitBack = input.widthMm > input.depthMm;

  return {
    top: {
      lengthMm: dim(topCoversSides ? input.widthMm : input.widthMm - 2 * t),
      widthMm: dim(input.depthMm),
      qty: 1,
    },
    bottom: sidesToFloor
      ? null
      : { lengthMm: innerWidth, widthMm: dim(input.depthMm), qty: 1 },
    floorRails: sidesToFloor ? { lengthMm: innerWidth, widthMm: 50, qty: 2 } : null,
    sides: {
      lengthMm: dim(input.depthMm),
      widthMm: dim(input.heightMm),
      qty: 2,
    },
    back: {
      lengthMm: splitBack ? dim(input.widthMm / 2) : dim(input.widthMm),
      widthMm: dim(input.heightMm),
      qty: splitBack ? 2 : 1,
      split: splitBack,
    },
    backRail: splitBack ? { lengthMm: innerWidth, widthMm: 50, qty: 1 } : null,
    drawerFront: {
      lengthMm: dim(input.drawerFrontWidthMm),
      widthMm: dim(input.drawerFrontHeightMm),
      qty: Math.max(0, input.drawerCount),
    },
    drawerSide: {
      lengthMm: drawerSideLength,
      widthMm: drawerSideWidth,
      qty: Math.max(0, input.drawerCount) * 2,
    },
    drawerBack: {
      lengthMm: dim(input.drawerFrontWidthMm - 45),
      widthMm: drawerSideWidth,
      qty: Math.max(0, input.drawerCount),
    },
    drawerBottom: {
      lengthMm: drawerSideLength,
      widthMm: dim(input.drawerFrontWidthMm - 45),
      qty: Math.max(0, input.drawerCount),
    },
    frontRails: {
      lengthMm: innerWidth,
      widthMm: 50,
      qty: frontRailQty,
    },
  };
}
