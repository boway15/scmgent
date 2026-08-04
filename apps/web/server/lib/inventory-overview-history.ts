export type InventorySnapshotSelection = {
  selectedSnapshotDate: string | null;
  latestSnapshotDate: string | null;
  isLatestSnapshot: boolean;
  isStale: boolean;
};

export function resolveInventorySnapshotSelection(
  availableDates: string[],
  requestedDate: string | undefined,
  today: string,
): InventorySnapshotSelection {
  const latestSnapshotDate = availableDates[0] ?? null;
  const selectedSnapshotDate = requestedDate
    ? availableDates.includes(requestedDate)
      ? requestedDate
      : null
    : availableDates.includes(today)
      ? today
      : latestSnapshotDate;

  return {
    selectedSnapshotDate,
    latestSnapshotDate,
    isLatestSnapshot:
      selectedSnapshotDate != null && selectedSnapshotDate === latestSnapshotDate,
    isStale: selectedSnapshotDate != null && selectedSnapshotDate !== today,
  };
}

type SnapshotFilterable = {
  code?: string | null;
  name?: string | null;
  category?: string | null;
  lifecycle?: string | null;
  salesCountry?: string | null;
  merchantCode?: string | null;
  ownerName?: string | null;
  developerName?: string | null;
};

export function filterSnapshotItems<T extends SnapshotFilterable>(
  items: T[],
  filters: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
  },
): T[] {
  const includes = (value: string | null | undefined, expected?: string) =>
    !expected || (value ?? '').toLocaleLowerCase().includes(expected.toLocaleLowerCase());

  return items.filter(
    (item) =>
      (!filters.q ||
        includes(item.code, filters.q) ||
        includes(item.name, filters.q)) &&
      includes(item.category, filters.category) &&
      includes(item.lifecycle, filters.lifecycle) &&
      includes(item.salesCountry, filters.salesCountry) &&
      includes(item.merchantCode, filters.merchantCode) &&
      includes(item.ownerName, filters.ownerName) &&
      includes(item.developerName, filters.developerName),
  );
}
