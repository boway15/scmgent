/** 与服务端 `BOM_LINE_CATEGORIES` 保持一致，作 status 接口不可用时的兜底 */
export const BOM_LINE_CATEGORIES_FALLBACK = [
  '板材',
  '五金',
  '表面工艺',
  '包装',
  '加工',
  '其他',
] as const;

export const BOM_UNIT_HINTS: Record<string, readonly string[]> = {
  板材: ['张', '块', '平方米', 'm²', '米'],
  五金: ['套', '个', '只', '件', '副', '米'],
  表面工艺: ['平方米', 'm²', '项'],
  包装: ['套', '个', '项'],
  加工: ['项', '平方米', 'm²'],
  其他: ['项', '套', '个'],
};

export function bomSpecPlaceholder(category: string): string {
  if (category === '板材') return '规格（如 18mm 1200×400）';
  if (category === '五金') return '规格（如 2节12寸滚珠滑轨）';
  return '规格（可空）';
}

export function defaultLossPercentForCategory(category: string): string {
  return category === '板材' ? '8' : '0';
}

export function defaultUnitForCategory(category: string): string {
  if (category === '板材') return '张';
  if (category === '五金') return '套';
  if (category === '包装') return '套';
  return '';
}
