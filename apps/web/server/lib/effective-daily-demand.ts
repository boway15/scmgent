export type DailySale = { saleDate: string; qtySold: number };
export type DailyAvailability = { date: string; qtyAvailable: number };

export type EffectiveDailyDemandResult = {
  avgDaily: number;
  stockoutAdjusted: boolean;
  windowDays: number;
  inStockDays: number;
  soldOnInStockDays: number;
  calendarSold: number;
};

function toDateKey(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateWindowDates(windowStart: string, windowEnd: string): string[] {
  const dates: string[] = [];
  for (let cursor = new Date(`${windowStart}T00:00:00.000Z`); ; cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor);
    dates.push(key);
    if (key >= windowEnd) break;
  }
  return dates;
}

export function calcEffectiveDailyDemand(params: {
  sales: DailySale[];
  availability: DailyAvailability[];
  windowDays?: number;
  asOf?: Date;
}): EffectiveDailyDemandResult {
  const windowDays = params.windowDays ?? 90;
  const asOf = params.asOf ?? new Date();
  const windowEnd = toDateKey(addDays(new Date(`${toDateKey(asOf)}T00:00:00.000Z`), -1));
  const windowStart = toDateKey(
    addDays(new Date(`${windowEnd}T00:00:00.000Z`), -(windowDays - 1)),
  );
  const windowDates = enumerateWindowDates(windowStart, windowEnd);

  const salesByDate = new Map<string, number>();
  for (const sale of params.sales) {
    const key = toDateKey(sale.saleDate);
    if (key < windowStart || key > windowEnd) continue;
    salesByDate.set(key, (salesByDate.get(key) ?? 0) + sale.qtySold);
  }

  const calendarSold = windowDates.reduce((sum, date) => sum + (salesByDate.get(date) ?? 0), 0);

  const availabilityInWindow = params.availability.filter(
    (row) => row.date.slice(0, 10) >= windowStart && row.date.slice(0, 10) <= windowEnd,
  );

  if (availabilityInWindow.length === 0) {
    return {
      avgDaily: calendarSold / windowDays,
      stockoutAdjusted: false,
      windowDays,
      inStockDays: 0,
      soldOnInStockDays: 0,
      calendarSold,
    };
  }

  const availabilityByDate = new Map<string, number>();
  for (const row of availabilityInWindow) {
    availabilityByDate.set(row.date.slice(0, 10), row.qtyAvailable);
  }

  let inStockDays = 0;
  let soldOnInStockDays = 0;
  for (const date of windowDates) {
    const qtyAvailable = availabilityByDate.get(date) ?? 0;
    if (qtyAvailable > 0) {
      inStockDays += 1;
      soldOnInStockDays += salesByDate.get(date) ?? 0;
    }
  }

  return {
    avgDaily: inStockDays > 0 ? soldOnInStockDays / inStockDays : 0,
    stockoutAdjusted: true,
    windowDays,
    inStockDays,
    soldOnInStockDays,
    calendarSold,
  };
}
