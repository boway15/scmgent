export type SuggestionSortRow = {
  status: string;
  suggestedDate: string;
  coverageDays?: string | number | null;
  healthStatus?: string | null;
  metrics?: Record<string, unknown> | null;
};

function parseMetricNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isSuggestedOrderOverdue(
  suggestedDate: string | null | undefined,
  today = new Date(),
): boolean {
  if (!suggestedDate?.trim()) return false;
  const todayKey = today.toISOString().slice(0, 10);
  return suggestedDate.slice(0, 10) < todayKey;
}

export function compareSuggestionsByUrgency(a: SuggestionSortRow, b: SuggestionSortRow): number {
  const pendingRank = (status: string) => (status === 'pending' ? 0 : 1);
  const pendingDiff = pendingRank(a.status) - pendingRank(b.status);
  if (pendingDiff !== 0) return pendingDiff;

  const overdueA = isSuggestedOrderOverdue(a.suggestedDate) ? 0 : 1;
  const overdueB = isSuggestedOrderOverdue(b.suggestedDate) ? 0 : 1;
  if (overdueA !== overdueB) return overdueA - overdueB;

  const dateA = a.suggestedDate?.slice(0, 10) || '9999-99-99';
  const dateB = b.suggestedDate?.slice(0, 10) || '9999-99-99';
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const coverageA = parseMetricNum(a.coverageDays);
  const coverageB = parseMetricNum(b.coverageDays);
  if (coverageA != null && coverageB != null && coverageA !== coverageB) {
    return coverageA - coverageB;
  }

  const healthRank: Record<string, number> = { red: 0, yellow: 1, green: 2, blue: 3, gray: 4 };
  const ha = healthRank[a.healthStatus?.toLowerCase() ?? ''] ?? 5;
  const hb = healthRank[b.healthStatus?.toLowerCase() ?? ''] ?? 5;
  return ha - hb;
}

export function filterSuggestionQueue<T extends SuggestionSortRow>(
  rows: T[],
  queue: string,
): T[] {
  if (queue === 'all') return rows;
  return rows.filter((row) => {
    const metrics =
      row.metrics && typeof row.metrics === 'object'
        ? (row.metrics as Record<string, unknown>)
        : {};
    const needsManual = metrics.needsManualConfirm === true;
    return queue === 'manual' ? needsManual : !needsManual;
  });
}
