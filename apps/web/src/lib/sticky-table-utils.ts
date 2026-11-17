import type { CSSProperties } from 'react';

/** 按列顺序累计冻结列 left 偏移（仅对 frozenIds 中的列写 Map） */
export function computeFrozenLeftOffsets(
  columnIds: readonly string[],
  frozenIds: readonly string[],
  getWidth: (id: string) => number,
): Map<string, number> {
  const frozenSet = new Set(frozenIds);
  const offsets = new Map<string, number>();
  let left = 0;
  for (const id of columnIds) {
    if (!frozenSet.has(id)) continue;
    offsets.set(id, left);
    left += getWidth(id);
  }
  return offsets;
}

export type StickyColumnStyleOptions = {
  width: number;
  /** 有值表示横向冻结 */
  frozenLeft?: number;
  isHeader: boolean;
  /** 冻结列从左到右的栈序（0 = 最左） */
  stackIndex?: number;
};

/**
 * sticky 单元格 style。表头一律 top:0；冻结列叠加 left。
 * z-index：任意表头 > 任意 body，避免纵滚时冻结体单元格盖住表头。
 * header 冻结角 60−i，普通 header 40，body 冻结 20−i。
 */
export function stickyColumnStyle({
  width,
  frozenLeft,
  isHeader,
  stackIndex = 0,
}: StickyColumnStyleOptions): CSSProperties {
  const base: CSSProperties = {
    width,
    minWidth: width,
    maxWidth: width,
  };

  return {
    ...base,
    ...stickyTableCellPosition({ frozenLeft, isHeader, stackIndex }),
  };
}

/** table-fixed + colgroup 时列宽只写在 col 上，单元格只用 sticky 定位 */
export function stickyTableCellPosition({
  frozenLeft,
  isHeader,
  stackIndex = 0,
}: Omit<StickyColumnStyleOptions, 'width'>): CSSProperties {
  const style: CSSProperties = {};

  if (isHeader) {
    style.position = 'sticky';
    style.top = 0;
    style.zIndex = frozenLeft != null ? 60 - stackIndex : 40;
  }

  if (frozenLeft != null) {
    style.position = 'sticky';
    style.left = frozenLeft;
    if (isHeader) {
      style.top = 0;
      style.zIndex = 60 - stackIndex;
    } else {
      style.zIndex = 20 - stackIndex;
    }
  }

  return style;
}

export function tableTotalWidth(
  columnIds: readonly string[],
  getWidth: (id: string) => number,
): number {
  return columnIds.reduce((sum, id) => sum + getWidth(id), 0);
}

const SKU_LIKE = /^(SKU|sku|商品编码)(\b|$|[\s_\-（(])/i;

/** 飞书镜像等：识别应冻结的 SKU 列名 */
export function findSkuLikeColumnId(columnIds: readonly string[]): string | undefined {
  return columnIds.find((id) => id === 'SKU' || id === 'sku' || id === '商品编码' || SKU_LIKE.test(id));
}

/**
 * 冻结「从首列到 SKU」的连续前缀；无 SKU 则只冻首列。
 * sticky left 必须作用于连续左侧列，否则中间列滚动后偏移错误。
 */
export function leadingFreezeColumnIds(columnIds: readonly string[]): string[] {
  if (!columnIds.length) return [];
  const skuIdx = columnIds.findIndex(
    (id) => id === 'SKU' || id === 'sku' || id === '商品编码' || SKU_LIKE.test(id),
  );
  if (skuIdx < 0) return [columnIds[0]!];
  return columnIds.slice(0, skuIdx + 1);
}
