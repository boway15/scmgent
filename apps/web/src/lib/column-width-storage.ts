export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 640;

export function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
}

export function loadStoredColumnWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[key] = clampColumnWidth(value);
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
