export type OverviewTableDensity = 'comfortable' | 'compact';

export const DENSITY_STORAGE_KEY = 'scm.inventory-overview.density-v1';

export function loadOverviewTableDensity(): OverviewTableDensity {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY);
    if (raw === 'compact' || raw === 'comfortable') return raw;
  } catch {
    /* ignore */
  }
  return 'comfortable';
}

export function saveOverviewTableDensity(density: OverviewTableDensity): void {
  localStorage.setItem(DENSITY_STORAGE_KEY, density);
}

export function rowHeightForDensity(density: OverviewTableDensity): number {
  return density === 'compact' ? 36 : 44;
}
