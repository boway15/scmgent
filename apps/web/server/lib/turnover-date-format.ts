/** 周转表中的日期/时间列（非数量列「预计*上架」、非「*断货天数」） */
export function isTurnoverDateColumn(columnId: string): boolean {
  const header = columnId.trim();
  if (!header) return false;
  if (header === '采购单最早上架时间') return true;
  if (header.includes('断货时间')) return true;
  if (/^最早上架_/.test(header)) return true;
  return false;
}

/** Excel 1900 日期序列（约 1982–2100） */
export function isPlausibleExcelSerial(value: number): boolean {
  return Number.isFinite(value) && value >= 30_000 && value <= 80_000;
}

/** Excel 序列日 → YYYY-MM-DD（UTC，与 xlsx 一致：1899-12-30 为第 0 日） */
export function excelSerialToIsoDate(serial: number): string {
  const utcDays = Math.floor(serial);
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + utcDays * 86_400_000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 将单元格原始值格式化为展示/存储用字符串。
 * 日期列中的 Excel 序列号转为 YYYY-MM-DD；已是日期字符串则原样返回。
 */
export function formatTurnoverDateValue(columnId: string, raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const text = String(raw).trim();
  if (!text || text === '-') return text;

  if (!isTurnoverDateColumn(columnId)) return text;

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const parsed = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || !isPlausibleExcelSerial(parsed)) return text;

  return excelSerialToIsoDate(parsed);
}

/** xlsx 解析：按列名将数字日期序列转为 ISO 字符串 */
export function formatXlsxCellValue(header: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && isTurnoverDateColumn(header) && isPlausibleExcelSerial(value)) {
    return excelSerialToIsoDate(value);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}
