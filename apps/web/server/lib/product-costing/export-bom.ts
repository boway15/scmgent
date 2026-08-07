import type { CostingBomLineDraft } from './types.js';
import { calcQtyGross } from './bom-math.js';

export const BOM_EXPORT_HEADERS = [
  '大类',
  '物料名称',
  '规格',
  '单位',
  '净用量',
  '损耗率',
  '毛用量',
  '来源',
  '置信度',
  '备注',
] as const;

export type ExportBomRow = {
  category: string;
  materialName: string;
  spec: string | null;
  unit: string;
  qtyNet: string | number;
  lossRate: string | number;
  qtyGross: string | number;
  sourceRef: string | null;
  confidence: string;
  notes: string | null;
};

export async function buildBomXlsx(rows: ExportBomRow[]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const matrix: (string | number)[][] = [Array.from(BOM_EXPORT_HEADERS)];
  for (const r of rows) {
    const qtyNet = Number(r.qtyNet);
    const lossRate = Number(r.lossRate);
    const qtyGross =
      r.qtyGross !== undefined && r.qtyGross !== null && r.qtyGross !== ''
        ? Number(r.qtyGross)
        : calcQtyGross(qtyNet, lossRate);
    matrix.push([
      r.category,
      r.materialName,
      r.spec ?? '',
      r.unit,
      qtyNet,
      lossRate,
      qtyGross,
      r.sourceRef ?? '',
      r.confidence,
      r.notes ?? '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '原材料清单');
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return Buffer.from(out);
}

export function draftToExportRow(d: CostingBomLineDraft): ExportBomRow {
  return {
    category: d.category,
    materialName: d.materialName,
    spec: d.spec,
    unit: d.unit,
    qtyNet: d.qtyNet,
    lossRate: d.lossRate,
    qtyGross: calcQtyGross(d.qtyNet, d.lossRate),
    sourceRef: d.sourceRef,
    confidence: d.confidence,
    notes: d.notes,
  };
}
