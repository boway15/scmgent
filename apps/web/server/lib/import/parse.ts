/** Parse one CSV/TSV line, supporting quoted fields with embedded commas. */
export function parseDelimitedLine(line: string): string[] {
  const delimiter = line.includes('\t') && !line.includes(',') ? '\t' : ',';
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ''));
}

/** Parse CSV or TSV text into rows (first row = header) */
export function parseDelimitedText(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => parseDelimitedLine(line));
}

export function rowsToObjects(rows: string[][]): Array<Record<string, string>> {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((line) => {
    const obj: Record<string, string> = {};
    header.forEach((key, i) => {
      obj[key] = line[i] ?? '';
    });
    return obj;
  });
}

export function normalizeHeaderKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

export function pickField(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[normalizeHeaderKey(key)] ?? row[key];
    if (v != null && v !== '') return v;
  }
  return '';
}

const FOB_HEADER_MARKERS = /品名|品类|海外库存|全链库存|采购在途/;

function firstCsvLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? '';
}

/** PostgreSQL text / varchar reject NUL (U+0000) in UTF-8 strings. */
export function sanitizeCsvText(text: string): string {
  return text.includes('\0') ? text.replaceAll('\0', '') : text;
}

/** @alias sanitizeCsvText — strip NUL before any DB text write */
export const sanitizeDbText = sanitizeCsvText;

/** Decode CSV bytes: UTF-8 BOM first, then UTF-8 if header looks valid, else GBK (FOB 导出常见). */
export function decodeCsvBytes(buffer: Buffer | ArrayBuffer | Uint8Array): string {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  const body = bytes.subarray(offset);
  const utf8 = sanitizeCsvText(body.toString('utf8'));
  const header = firstCsvLine(utf8);
  if (FOB_HEADER_MARKERS.test(header)) return utf8;
  if (/[\u4e00-\u9fff]/.test(header) && !/[\uFFFD]|Ʒ|/.test(header)) return utf8;
  try {
    const gbk = sanitizeCsvText(new TextDecoder('gbk').decode(body));
    if (FOB_HEADER_MARKERS.test(firstCsvLine(gbk))) return gbk;
    return gbk;
  } catch {
    return utf8;
  }
}
