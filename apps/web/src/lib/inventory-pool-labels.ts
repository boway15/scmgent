/** 三池对人展示名。代码池名 local / in_transit / overseas 不变。 */
export const POOL_DISPLAY_LABEL = {
  local: '未发',
  in_transit: '在途',
  overseas: '在库',
} as const;

export type InventoryPoolId = keyof typeof POOL_DISPLAY_LABEL;
