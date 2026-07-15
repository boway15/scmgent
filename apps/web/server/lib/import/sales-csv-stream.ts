import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeCsvBytes, parseDelimitedLine, sanitizeCsvText } from './parse.js';

const TEMP_DIR = path.join(tmpdir(), 'scm-sales-import');

export function salesImportTempPath(batchId: string): string {
  return path.join(TEMP_DIR, `${batchId}.csv`);
}

/** 解码后写入临时 UTF-8 文件，后台按行流式读取，避免 3 万行宽表整表驻留内存 */
export async function saveSalesImportTempFile(batchId: string, buffer: Buffer): Promise<string> {
  await mkdir(TEMP_DIR, { recursive: true });
  const filePath = salesImportTempPath(batchId);
  const text = decodeCsvBytes(buffer);
  await writeFile(filePath, text, 'utf8');
  return filePath;
}

export async function removeSalesImportTempFile(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {
    // ignore missing temp file
  }
}

/** 统计 SKU 宽表行数（不含表头），上传时仅解码一次文本 */
export function countWideCsvSkuRows(buffer: Buffer | ArrayBuffer | Uint8Array): number {
  const text = decodeCsvBytes(buffer);
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lines++;
  }
  if (text.length > 0 && !text.endsWith('\n')) lines++;
  return Math.max(0, lines - 1);
}

function wideRowFromLine(headers: string[], line: string): Record<string, string> {
  const cells = parseDelimitedLine(line).map((cell) => sanitizeCsvText(cell.trim()));
  const row: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (header) row[header] = cells[index] ?? '';
  });
  return row;
}

/** 仅解析前 N 行 SKU，用于预览/校验，不加载全表 */
export function wideCsvBufferToRowObjectsSample(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  maxSkuRows = 50,
): Array<Record<string, string>> {
  const text = decodeCsvBytes(buffer);
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const line = text.slice(start, i).replace(/\r$/, '');
      if (line.trim()) lines.push(line);
      start = i + 1;
      if (lines.length > maxSkuRows) break;
    }
  }
  if (lines.length < 2) return [];

  const headers = parseDelimitedLine(lines[0]).map((header) =>
    sanitizeCsvText(header.replace(/^\uFEFF/, '').trim()),
  );
  return lines.slice(1).map((line) => wideRowFromLine(headers, line));
}

export async function readWideCsvHeadersFromFile(filePath: string): Promise<string[]> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    rl.close();
    if (!line.trim()) continue;
    return parseDelimitedLine(line).map((header) =>
      sanitizeCsvText(header.replace(/^\uFEFF/, '').trim()),
    );
  }
  return [];
}

export async function* iterateWideCsvRowChunks(
  filePath: string,
  chunkSize: number,
): AsyncGenerator<{ rows: Array<Record<string, string>>; processedSkuWideRows: number }> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  let chunk: Array<Record<string, string>> = [];
  let processedSkuWideRows = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!headers) {
      headers = parseDelimitedLine(line).map((header) =>
        sanitizeCsvText(header.replace(/^\uFEFF/, '').trim()),
      );
      continue;
    }

    chunk.push(wideRowFromLine(headers, line));
    processedSkuWideRows++;
    if (chunk.length >= chunkSize) {
      yield { rows: chunk, processedSkuWideRows };
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    yield { rows: chunk, processedSkuWideRows };
  }
}
