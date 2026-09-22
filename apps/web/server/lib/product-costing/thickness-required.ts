export const PANEL_THICKNESS_FIELDS = [
  { key: 'carcassThicknessMm', label: '箱体默认厚度' },
  { key: 'sideThicknessMm', label: '侧板默认厚度' },
  { key: 'backThicknessMm', label: '背板默认厚度' },
  { key: 'bottomThicknessMm', label: '底板默认厚度' },
  { key: 'drawerBottomThicknessMm', label: '抽底默认厚度' },
] as const;

export type PanelThicknessFacts = Partial<
  Record<(typeof PANEL_THICKNESS_FIELDS)[number]['key'], number | null | undefined>
>;

export function missingPanelThicknessLabels(facts: PanelThicknessFacts): string[] {
  return PANEL_THICKNESS_FIELDS.filter((field) => {
    const value = facts[field.key];
    return typeof value !== 'number' || !Number.isFinite(value);
  }).map((field) => field.label);
}

export function panelThicknessComplete(facts: PanelThicknessFacts): boolean {
  return missingPanelThicknessLabels(facts).length === 0;
}

export function panelThicknessRequiredMessage(facts: PanelThicknessFacts): string | null {
  const missing = missingPanelThicknessLabels(facts);
  if (!missing.length) return null;
  return `请先填写全部板厚（${missing.join('、')}），再生成材料`;
}
