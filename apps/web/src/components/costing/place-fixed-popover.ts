export type ViewportRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export function placeFixedPopover({
  trigger,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  gap = 4,
  padding = 8,
}: {
  trigger: ViewportRect;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  padding?: number;
}): { top: number; left: number } {
  const maxLeft = viewportWidth - panelWidth - padding;
  const left = Math.max(padding, Math.min(trigger.left, maxLeft));

  const below = trigger.bottom + gap;
  const above = trigger.top - gap - panelHeight;
  const fitsBelow = below + panelHeight <= viewportHeight - padding;
  const fitsAbove = above >= padding;
  const top = !fitsBelow && fitsAbove ? above : below;

  return { top, left };
}
