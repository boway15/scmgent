import type { AlertListItem } from '@/lib/alert-list-view';
import {
  SKU_LIST_COLUMN_HEADER,
  SKU_LIST_GROUP_HEADER,
  WAREHOUSE_LIST_COLUMN_HEADER,
  WAREHOUSE_LIST_GROUP_HEADER,
  skuListRowValues,
  warehouseListRowValues,
} from '@/lib/alert-list-view';

function downloadCsv(filename: string, headerRows: readonly (readonly string[])[], body: string[][]) {
  const lines = [...headerRows, ...body].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
  );
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadAlertListCsv(items: AlertListItem[], grain: 'sku' | 'warehouse') {
  const stamp = new Date().toISOString().slice(0, 10);
  if (grain === 'sku') {
    downloadCsv(
      `库存概览-SKU全网-${stamp}.csv`,
      [SKU_LIST_GROUP_HEADER, SKU_LIST_COLUMN_HEADER],
      items.map(skuListRowValues),
    );
    return;
  }
  downloadCsv(
    `库存概览-SKU仓库-${stamp}.csv`,
    [WAREHOUSE_LIST_GROUP_HEADER, WAREHOUSE_LIST_COLUMN_HEADER],
    items.map(warehouseListRowValues),
  );
}
