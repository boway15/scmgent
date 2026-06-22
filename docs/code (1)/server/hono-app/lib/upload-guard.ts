const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export function assertUploadFile(file: File): void {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    throw new Error(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large. Maximum size is ${MAX_FILE_BYTES / 1024 / 1024}MB`);
  }
}

export function assertRowCount(rows: unknown[]): void {
  if (rows.length > MAX_ROWS) {
    throw new Error(`Too many rows. Maximum is ${MAX_ROWS}`);
  }
}

export { MAX_FILE_BYTES, MAX_ROWS };
