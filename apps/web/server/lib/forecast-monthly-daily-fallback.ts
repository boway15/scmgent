/**
 * 日销表覆盖不足时，把月销量均匀摊到当月每一天，供走步回测还原近端窗口。
 * 只在日销查询结果为空时使用，避免和真实日销重复计数。
 */
export type SyntheticDailySalesPoint = {
  skuId: string;
  qtySold: number;
  saleDate: string;
  warehouseCode: null;
};

export function synthesizeDailySalesFromMonthly(input: {
  monthlyBySku: Map<string, Array<{ saleYear: number; month: number; qtySold: number }>>;
  fromDate: string;
  toDate: string;
}): Map<string, SyntheticDailySalesPoint[]> {
  const map = new Map<string, SyntheticDailySalesPoint[]>();
  for (const [skuId, rows] of input.monthlyBySku) {
    const points: SyntheticDailySalesPoint[] = [];
    for (const row of rows) {
      if (!(row.qtySold > 0)) continue;
      const days = new Date(Date.UTC(row.saleYear, row.month, 0)).getUTCDate();
      if (days <= 0) continue;
      const daily = row.qtySold / days;
      const month = String(row.month).padStart(2, '0');
      for (let day = 1; day <= days; day += 1) {
        const saleDate = `${row.saleYear}-${month}-${String(day).padStart(2, '0')}`;
        if (saleDate < input.fromDate || saleDate > input.toDate) continue;
        points.push({ skuId, qtySold: daily, saleDate, warehouseCode: null });
      }
    }
    if (points.length > 0) map.set(skuId, points);
  }
  return map;
}
