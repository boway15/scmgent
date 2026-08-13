import type { CostingBomLineDraft } from './types.js';

const CATEGORY_SLOTS: Record<string, string[]> = {
  斗柜: ['侧板', '顶底板', '背板', '抽面', '抽侧', '抽底'],
  床头柜: ['侧板', '顶底板', '背板', '抽面', '抽侧', '抽底'],
  书桌: ['桌面', '侧板', '抽盒'],
  梳妆台: ['台面', '侧板', '抽盒'],
};

export function applyCategoryTemplate(
  category: string | null | undefined,
  lines: CostingBomLineDraft[],
): CostingBomLineDraft[] {
  const slots = category ? CATEGORY_SLOTS[category] : undefined;
  if (!slots) return lines;

  const missingLines = slots
    .filter((slotName) => !lines.some((line) => line.materialName.includes(slotName)))
    .map<CostingBomLineDraft>((materialName) => ({
      category: '板材',
      materialName,
      spec: '',
      unit: '块',
      qtyNet: 0,
      lossRate: 0,
      sourceRef: '',
      confidence: 'low',
      origin: 'template',
      notes: '用量待补',
    }));

  return [...lines, ...missingLines];
}
