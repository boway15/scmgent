const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES_LARGE = 15 * 1024 * 1024;
/** xiaoshou 日销量 CSV 约 60MB */
const MAX_FILE_BYTES_SALES = 70 * 1024 * 1024;
const MAX_ROWS = 5000;

/** FOB 宽表导出通常 1–2 万行，高于通用粘贴导入上限 */
const MAX_ROWS_BY_IMPORT_TYPE: Record<string, number> = {
  inventory: 25_000,
  sales: 35_000,
  'cs-reply': 20_000,
  'procurement-bulk_stock_request': 20_000,
  'procurement-purchase_follow_up': 20_000,
};

const LARGE_IMPORT_TYPES = new Set(Object.keys(MAX_ROWS_BY_IMPORT_TYPE));

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export function getMaxRows(importType?: string): number {
  if (importType && importType in MAX_ROWS_BY_IMPORT_TYPE) {
    return MAX_ROWS_BY_IMPORT_TYPE[importType];
  }
  return MAX_ROWS;
}

export function assertUploadFile(file: File, importType?: string): void {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  let maxBytes = MAX_FILE_BYTES;
  if (importType === 'sales') {
    maxBytes = MAX_FILE_BYTES_SALES;
  } else if (importType === 'cs-reply') {
    maxBytes = MAX_FILE_BYTES_LARGE;
  } else if (importType && LARGE_IMPORT_TYPES.has(importType)) {
    maxBytes = MAX_FILE_BYTES_LARGE;
  }
  if (file.size > maxBytes) {
    throw new Error(`File too large. Maximum size is ${maxBytes / 1024 / 1024}MB`);
  }
}

export function assertRowCount(rows: unknown[], importType?: string): void {
  const max = getMaxRows(importType);
  if (rows.length > max) {
    throw new Error(`Too many rows. Maximum is ${max}`);
  }
}

export { MAX_FILE_BYTES, MAX_FILE_BYTES_LARGE, MAX_ROWS, MAX_ROWS_BY_IMPORT_TYPE };
