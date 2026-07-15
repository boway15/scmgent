/** 前端复用的 12 子档矩阵行顺序（与 server SEGMENT_MATRIX_ROWS 一致） */
export const SEGMENT_MATRIX_ROWS = [
  'A:core',
  'A:mid',
  'A:tail',
  'B:core',
  'B:mid',
  'B:tail',
  'C:pool',
  'C:sku-core',
  'C:sku-mid',
  'C:sku-tail',
  'D:floor',
  'D:skipped',
] as const;
