import { getCostingProject } from './service.js';
import type { CostSummary } from './types.js';

type CostingExportLine = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyNet: number;
  lossRate: number;
  qtyGross: number;
  effectiveUnitPrice: number | null;
  lineAmount: number;
  origin: string;
  sourceRef: string;
  confidence: string;
  matchStatus: string;
};

export function buildCostingExportAoa(input: {
  lines: CostingExportLine[];
  summary: CostSummary;
}): { list: unknown[][]; summary: unknown[][] } {
  const list: unknown[][] = [
    [
      '大类',
      '名称',
      '规格',
      '单位',
      '净用量',
      '损耗',
      '毛用量',
      '生效单价',
      '金额',
      '来源类型',
      '出处',
      '置信度',
      '匹配状态',
    ],
    ...input.lines.map((line) => [
      line.category,
      line.materialName,
      line.spec,
      line.unit,
      line.qtyNet,
      line.lossRate,
      line.qtyGross,
      line.effectiveUnitPrice,
      line.lineAmount,
      line.origin,
      line.sourceRef,
      line.confidence,
      line.matchStatus,
    ]),
  ];
  const summary: unknown[][] = [
    ['大类', '金额', '占比'],
    ...input.summary.byCategory.map((item) => [item.category, item.amount, item.share]),
    ['总成本', input.summary.totalAmount, 1],
    ['缺价行数', input.summary.missingPriceCount, '缺用量行数', input.summary.missingQtyCount],
  ];
  return { list, summary };
}

export async function exportCostingXlsx(projectId: string): Promise<Buffer> {
  const project = await getCostingProject(projectId);
  if (!project) throw new Error('核算单不存在');

  const aoa = buildCostingExportAoa({
    lines: project.lines.map((line) => ({
      category: line.category,
      materialName: line.materialName,
      spec: line.spec ?? '',
      unit: line.unit,
      qtyNet: Number(line.qtyNet),
      lossRate: Number(line.lossRate),
      qtyGross: Number(line.qtyGross),
      effectiveUnitPrice: line.effectiveUnitPrice,
      lineAmount: line.lineAmount,
      origin: line.origin,
      sourceRef: line.sourceRef ?? '',
      confidence: line.confidence,
      matchStatus: line.matchStatus,
    })),
    summary: project.summary,
  });

  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa.list), '材料清单');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa.summary), '成本汇总');
  return Buffer.from(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
