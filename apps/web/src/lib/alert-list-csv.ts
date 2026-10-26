import type { AlertListItem, AlertExportHeaderSpan } from '@/lib/alert-list-view';
import type XLSX from 'xlsx-js-style';
import {
  SKU_LIST_HEADER,
  WAREHOUSE_LIST_HEADER,
  skuListRowValues,
  warehouseListRowValues,
} from '@/lib/alert-list-view';

const HEADER_GROUP_FILL = 'FFFFEDD5';
const HEADER_SUB_FILL = 'FFFFF7ED';
const HEADER_BORDER = 'FFE5E5E5';
const HEADER_FONT = 'FF1F1F1F';

export function alertHeaderRows(spans: readonly AlertExportHeaderSpan[]): {
  group: string[];
  columns: string[];
  merges: XLSX.Range[];
} {
  const group: string[] = [];
  const columns: string[] = [];
  const merges: XLSX.Range[] = [];
  let col = 0;
  for (const span of spans) {
    const children = span.children ?? [];
    if (children.length > 1) {
      group.push(span.label, ...Array<string>(children.length - 1).fill(''));
      columns.push(...children);
      merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + children.length - 1 } });
      col += children.length;
      continue;
    }
    group.push(span.label);
    columns.push(children[0] ?? '');
    merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
    col += 1;
  }
  return { group, columns, merges };
}

function headerStyle(row: number) {
  const edge = { style: 'thin', color: { rgb: HEADER_BORDER } };
  return {
    fill: { patternType: 'solid', fgColor: { rgb: row === 0 ? HEADER_GROUP_FILL : HEADER_SUB_FILL } },
    font: { bold: row === 0, sz: 11, color: { rgb: HEADER_FONT }, name: '微软雅黑' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: { top: edge, bottom: edge, left: edge, right: edge },
  };
}

function paintHeader(xlsx: typeof XLSX, sheet: XLSX.WorkSheet, columnCount: number) {
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      const address = xlsx.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] ?? { t: 's', v: '' };
      cell.s = headerStyle(row);
      sheet[address] = cell;
    }
  }
  sheet['!rows'] = [{ hpt: 22 }, { hpt: 20 }];
}

function downloadXlsx(
  xlsx: typeof XLSX,
  filename: string,
  spans: readonly AlertExportHeaderSpan[],
  body: string[][],
) {
  const { group, columns, merges } = alertHeaderRows(spans);
  const sheet = xlsx.utils.aoa_to_sheet([group, columns, ...body]);
  sheet['!merges'] = merges;
  sheet['!cols'] = group.map((_, index) => ({ wch: index === 0 ? 16 : 12 }));
  paintHeader(xlsx, sheet, group.length);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, '库存概览');
  xlsx.writeFile(book, filename);
}

export async function downloadAlertListCsv(items: AlertListItem[], grain: 'sku' | 'warehouse') {
  const loaded = await import('xlsx-js-style');
  const xlsx = loaded.default ?? loaded;
  const stamp = new Date().toISOString().slice(0, 10);
  if (grain === 'sku') {
    downloadXlsx(xlsx, `库存概览-SKU全网-${stamp}.xlsx`, SKU_LIST_HEADER, items.map(skuListRowValues));
    return;
  }
  downloadXlsx(xlsx, `库存概览-SKU仓库-${stamp}.xlsx`, WAREHOUSE_LIST_HEADER, items.map(warehouseListRowValues));
}
