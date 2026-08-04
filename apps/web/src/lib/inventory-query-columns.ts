const STORAGE_KEY = 'scm.inventory-query.visible-columns-v3';

export function loadQueryVisibleColumns(fallback: string[]): string[] {
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

export function saveQueryVisibleColumns(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
