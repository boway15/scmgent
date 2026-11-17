export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 640;
/** 普通业务列表调宽上限（避免拖一次就出现「表头挤在一起、表体大空洞」） */
export const LIST_COLUMN_WIDTH_MAX = 360;

export function clampColumnWidth(width: number, max = MAX_COLUMN_WIDTH): number {
  return Math.min(max, Math.max(MIN_COLUMN_WIDTH, width));
}

export function loadStoredColumnWidths(
  storageKey: string,
  max = MAX_COLUMN_WIDTH,
): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[key] = clampColumnWidth(value, max);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveStoredColumnWidths(storageKey: string, widths: Record<string, number>): void {
  localStorage.setItem(storageKey, JSON.stringify(widths));
}
