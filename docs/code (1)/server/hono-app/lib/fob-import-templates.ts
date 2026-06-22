import { FREIGHT_FEE_HEADERS, TRUCKING_FEE_HEADERS } from '../_db';

export type FobTemplateType = 'volume' | 'trucking' | 'freight';

const TEMPLATE_META: Record<FobTemplateType, { filename: string; sheetName: string }> = {
  volume: { filename: '1.体积导入模板.xlsx', sheetName: 'Sheet1' },
  trucking: { filename: '2.拖车导入模板.xlsx', sheetName: 'Sheet1' },
  freight: { filename: '3.货代港杂费导入模板.xlsx', sheetName: 'Sheet1' },
};

/** 生成 FOB 分账三类导入模板（xlsx），对齐 docs/samples/imports 业务模板 */
export async function buildFobImportTemplate(
  type: FobTemplateType,
): Promise<{ buffer: Buffer; filename: string }> {
  const XLSX = await import('xlsx');
  const { filename, sheetName } = TEMPLATE_META[type];
  const rows = buildTemplateRows(type);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { buffer: Buffer.from(arrayBuffer), filename };
}

function buildTemplateRows(type: FobTemplateType): unknown[][] {
  if (type === 'volume') return buildVolumeTemplateRows();
  if (type === 'trucking') return buildTruckingTemplateRows();
  return buildFreightTemplateRows();
}

/** 1. 体积信息：表头 + 可选示例行（亦兼容 ED 大件调拨原表导出） */
function buildVolumeTemplateRows(): unknown[][] {
  return [['柜号', '业务编号', '主体', '体积', '工厂类别', '工厂名称']];
}

/** 2. 拖车账单：第 1 行表头，宽表费用列 */
function buildTruckingTemplateRows(): unknown[][] {
  const header = ['货柜号', '业务编号', '提单号', '起始港', '船公司', '发货时间', ...TRUCKING_FEE_HEADERS];
  const sample = ['WHSU8817230', '', '', '', '', '', ...TRUCKING_FEE_HEADERS.map((_, i) => String(100 + i))];
  return [header, sample];
}

/** 3. 货代港杂费：第 1 行表头，宽表费用列（默认 CNY，ORC 按 USD 折算） */
function buildFreightTemplateRows(): unknown[][] {
  const header = [
    '货柜号',
    '业务编号',
    '提单号',
    '起始港',
    '船公司',
    '进港时间',
    ...FREIGHT_FEE_HEADERS,
    '',
    '',
    '',
    '',
    '',
  ];
  const sample = [
    'WHSU8817230',
    '',
    '',
    '',
    '',
    '',
    ...FREIGHT_FEE_HEADERS.map((_, i) => String(300 + i)),
    '',
    '',
    '',
    '',
    '',
  ];
  return [header, sample];
}
