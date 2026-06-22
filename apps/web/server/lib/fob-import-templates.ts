import { FREIGHT_FEE_HEADERS, TRUCKING_FEE_HEADERS } from '@scm/db';

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

/** 调拨 SKU 明细导出表头，对齐 docs/samples/import-fob/体积信息_202606181444.xlsx */
export const TRANSFER_VOLUME_TEMPLATE_HEADERS = [
  '临柜号',
  '调拨单号',
  '订舱编号',
  'SKU编码',
  '中文品名',
  '英文品名',
  '海关编码',
  '目的国海关编码',
  '数量',
  '箱数',
  '长',
  '宽',
  '高',
  '体积',
  '型号',
  '材质',
  '货物净重kg',
  '货物毛重kg',
  '是否带电/带磁',
  '采购价-单价',
  '总金额',
  '是否退税',
  '材质（EN）',
  '用途',
  '用途(EN)',
  '目的仓',
  '清关模式',
  '清关类型',
  '是否商检',
  '是否反倾销',
  '公司名称EN',
  '公司地址EN',
  '税号',
  '清关号',
  'WSKU',
] as const;

/** 1. 体积信息：调拨 SKU 明细表头 + 示例行（亦兼容 ED 汇总模板原表导入） */
function buildVolumeTemplateRows(): unknown[][] {
  const sample: unknown[] = [
    'TLLU8925555',
    'DB2606020000095',
    'WJH2606020011',
    'DJ502313_34',
    '衣帽柜',
    'Hall tree',
    '',
    '',
    '50',
    '50',
    '',
    '',
    '',
    '4.99',
    '',
    '',
    '1575',
    '1725',
    '',
    '',
    '',
    '退税',
    '',
    '',
    '',
    'HK-德威美西洛杉矶仓-001-自发货',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'DJ502313_34',
  ];
  return [[...TRANSFER_VOLUME_TEMPLATE_HEADERS], sample];
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
