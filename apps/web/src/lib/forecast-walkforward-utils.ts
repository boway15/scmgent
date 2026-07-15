/** 使 buildMonthlyForecastHorizon(asOf, monthCount) 覆盖最近 monthCount 个已完成自然月 */
export function computeWalkForwardAsOf(monthCount: number, today = new Date()): string {
  const safeCount = Math.max(0, Math.floor(monthCount));
  const months: Array<{ year: number; month: number }> = [];

  for (let index = 1; index <= safeCount; index++) {
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - index, 1));
    months.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
    });
  }

  if (months.length === 0) {
    return today.toISOString().slice(0, 10);
  }

  months.reverse();
  const first = months[0];
  return `${first.year}-${String(first.month).padStart(2, '0')}-01`;
}
