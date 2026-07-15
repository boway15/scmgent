/** 取多个时间戳中最晚的一个（ISO 字符串） */
export function pickLatestIso(...values: Array<string | Date | null | undefined>): string | null {
  let latest = 0;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}
