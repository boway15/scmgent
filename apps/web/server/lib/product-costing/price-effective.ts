export type PriceEffectiveEntry = {
  id: string;
  regionId: string | null;
  factoryId: string | null;
  materialName: string;
  spec: string;
  unit: string;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
};

function toDateOnly(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseDateOnlyInput(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateOnly(value);
  }
  if (typeof value === 'string' && value.trim()) {
    return toDateOnly(value.trim());
  }
  return null;
}

export function isPriceEffectiveOn(
  entry: Pick<PriceEffectiveEntry, 'effectiveFrom' | 'effectiveTo'>,
  priceAsOf: Date,
): boolean {
  const asOf = toDateOnly(priceAsOf)!;
  const from = toDateOnly(entry.effectiveFrom ?? '2000-01-01')!;
  const to = toDateOnly(entry.effectiveTo);
  if (from.getTime() > asOf.getTime()) return false;
  if (to && to.getTime() <= asOf.getTime()) return false;
  return true;
}

function sliceKey(entry: Pick<PriceEffectiveEntry, 'regionId' | 'factoryId' | 'materialName' | 'spec' | 'unit'>) {
  return [
    entry.regionId ?? '',
    entry.factoryId ?? '',
    entry.materialName.trim().toLowerCase(),
    entry.spec.trim().toLowerCase(),
    entry.unit.trim().toLowerCase(),
  ].join('\0');
}

/** Keep one row per slice+name+spec+unit: latest effectiveFrom that is valid on priceAsOf. */
export function dedupePriceBookByDate<T extends PriceEffectiveEntry>(
  book: T[],
  priceAsOf: Date,
): T[] {
  const valid = book.filter((entry) => isPriceEffectiveOn(entry, priceAsOf));
  const best = new Map<string, T>();
  for (const entry of valid) {
    const key = sliceKey(entry);
    const current = best.get(key);
    if (!current) {
      best.set(key, entry);
      continue;
    }
    const currentFrom = toDateOnly(current.effectiveFrom ?? '2000-01-01')!.getTime();
    const nextFrom = toDateOnly(entry.effectiveFrom ?? '2000-01-01')!.getTime();
    if (nextFrom >= currentFrom) best.set(key, entry);
  }
  return [...best.values()];
}

export function rangesOverlap(
  left: { from: Date; to: Date | null },
  right: { from: Date; to: Date | null },
): boolean {
  const leftEnd = left.to?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.to?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.from.getTime() < rightEnd && right.from.getTime() < leftEnd;
}

export function findOverlappingPriceBookEntry<T extends PriceEffectiveEntry>(
  candidates: T[],
  next: {
    regionId: string | null;
    factoryId: string | null;
    materialName: string;
    spec: string;
    unit: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    excludeId?: string;
  },
): T | null {
  const nextRange = { from: next.effectiveFrom, to: next.effectiveTo };
  for (const entry of candidates) {
    if (next.excludeId && entry.id === next.excludeId) continue;
    if (sliceKey(entry) !== sliceKey(next)) continue;
    const from = toDateOnly(entry.effectiveFrom ?? '2000-01-01')!;
    const to = toDateOnly(entry.effectiveTo);
    if (rangesOverlap(nextRange, { from, to })) return entry;
  }
  return null;
}
