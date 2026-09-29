const STORAGE_KEY = 'scm.procurement-ops.visible-columns-v1';

export function loadProcurementOpsVisibleColumns(fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const ids = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return ids.length ? ids : fallback;
  } catch {
    return fallback;
  }
}

export function saveProcurementOpsVisibleColumns(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
