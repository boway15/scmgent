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

function detectDelimiter(text: string): ',' | '\t' {
  // Scan first logical header line without breaking on newlines inside quotes.
  let inQuotes = false;
  let sawComma = false;
  let sawTab = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') sawComma = true;
    if (ch === '\t') sawTab = true;
    if (ch === '\n' || ch === '\r') break;
  }
  return sawTab && !sawComma ? '\t' : ',';
}

/**
 * Parse CSV/TSV text into rows (first row = header).
 * Supports RFC4180 quoted fields that contain commas and newlines.
 */
export function parseDelimitedText(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  if (!input.trim()) return [];

  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
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
      row.push(current.trim());
      current = '';
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += ch;
  }

  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
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

function headerLooksValid(header: string): boolean {
  if (FOB_HEADER_MARKERS.test(header)) return true;
  // Reject replacement chars / common GBK-mojibake markers; trailing `|` in a regex
  // would match empty string and incorrectly invalidate every header.
  if (/[\uFFFD]/.test(header) || header.includes('Ʒ')) return false;
  return /[\u4e00-\u9fff]/.test(header);
}

/** Decode CSV bytes: UTF-16 BOM / UTF-8 BOM / UTF-8 / GBK（Excel 中文导出常见）. */
export function decodeCsvBytes(buffer: Buffer | ArrayBuffer | Uint8Array): string {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // Excel "Unicode CSV" / UTF-16 LE
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return sanitizeCsvText(bytes.subarray(2).toString('utf16le'));
  }
  // UTF-16 BE
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return sanitizeCsvText(new TextDecoder('utf-16be').decode(bytes.subarray(2)));
  }

  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  const body = bytes.subarray(offset);
  const utf8 = sanitizeCsvText(body.toString('utf8'));
  const header = firstCsvLine(utf8);
  if (headerLooksValid(header)) return utf8;
  try {
    const gbk = sanitizeCsvText(new TextDecoder('gbk').decode(body));
    if (headerLooksValid(firstCsvLine(gbk)) || FOB_HEADER_MARKERS.test(firstCsvLine(gbk))) {
      return gbk;
    }
    return gbk;
  } catch {
    return utf8;
  }
}
