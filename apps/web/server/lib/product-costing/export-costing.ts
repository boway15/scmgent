import { getCostingProject } from './service.js';
import type { CostSummary } from './types.js';

const MATCH_SCOPE_LABEL: Record<string, string> = {
  factory: '工厂专用',
  region: '区域通用',
  global: '全局通用',
};

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
  matchScope?: string | null;
  substrate?: string | null;
  provenanceTags?: string[];
  extractDiff?: string | null;
};

export function buildCostingExportAoa(input: {
  lines: CostingExportLine[];
  summary: CostSummary;
  computed?: boolean;
}): { list: unknown[][]; summary: unknown[][] } {
  const list: unknown[][] = [
    [
      '大类',
      '名称',
      '材质',
      '规格',
      '单位',
      '净用量',
      '损耗',
      '毛用量',
      '生效单价',
      '金额',
      '来源标签',
      '提取原值',
      '来源类型',
      '出处',
      '置信度',
      '匹配状态',
      '价层',
    ],
    ...input.lines.map((line) => [
      line.category,
      line.materialName,
      line.category === '板材' ? line.substrate ?? '' : '',
      line.spec,
      line.unit,
      line.qtyNet,
      line.lossRate,
      line.qtyGross,
      line.effectiveUnitPrice,
      line.lineAmount,
      (line.provenanceTags ?? []).join('、'),
      line.extractDiff ?? '',
      line.origin,
      line.sourceRef,
      line.confidence,
      line.matchStatus,
      line.matchScope ? (MATCH_SCOPE_LABEL[line.matchScope] ?? line.matchScope) : '',
    ]),
  ];
  const share = (amount: number) =>
    input.summary.totalAmount ? amount / input.summary.totalAmount : 0;
  const summary: unknown[][] = [];
  if (input.computed === false) {
    summary.push(['尚未计算成本', '请先在核算页确认原材料并点击计算成本']);
  }
  summary.push(
    ['项目', '金额', '占比'],
    ['材料小计', input.computed === false ? '' : input.summary.materialAmount, share(input.summary.materialAmount)],
    ['加工费', input.computed === false ? '' : input.summary.processAmount, share(input.summary.processAmount)],
    ...input.summary.feeItems.map((item) => [
      item.name,
      input.computed === false ? '' : item.amount,
      share(item.amount),
    ]),
    ['费用小计', input.computed === false ? '' : input.summary.feeAmount, share(input.summary.feeAmount)],
    ...input.summary.byCategory.map((item) => [
      item.category,
      input.computed === false ? '' : item.amount,
      item.share,
    ]),
    ['总成本', input.computed === false ? '' : input.summary.totalAmount, input.computed === false ? '' : 1],
    ['缺价行数', input.summary.missingPriceCount, '缺用量行数', input.summary.missingQtyCount],
  );
  return { list, summary };
}

export function buildBoardSheetExportAoa(input: {
  summary: CostSummary;
  computed?: boolean;
}): unknown[][] {
  const money = (value: number) => (input.computed === false ? '' : value);
  const rows = input.summary.boardSheet ?? [];
  const header = [
    '序号',
    '板子',
    '材质',
    '厚度mm',
    '元/张',
    '数量',
    '长度mm',
    '宽度mm',
    '开料净宽mm',
    '开料净长mm',
    '开料片数',
    '板材成本',
    '开料米',
    '开料单价',
    '开料成本',
    '封边米',
    '封边单价',
    '封边成本',
    '打孔个数',
    '打孔单价',
    '打孔成本',
    '开槽米',
    '开槽单价',
    '开槽成本',
    '喷漆m²',
    '喷漆单价',
    '喷漆成本',
    '成本小计',
  ];
  const body = rows.map((row, index) => [
    index + 1,
    row.materialName,
    row.substrate,
    row.thicknessMm,
    money(row.sheetPrice),
    row.qty,
    row.lengthMm,
    row.widthMm,
    row.usableWidthMm,
    row.usableLengthMm,
    row.piecesPerSheet,
    money(row.boardCost),
    row.cutMeters,
    row.cutRate,
    money(row.cutAmount),
    row.bandMeters,
    row.bandRate,
    money(row.bandAmount),
    row.drillCount,
    row.drillRate,
    money(row.drillAmount),
    row.grooveMeters,
    row.grooveRate,
    money(row.grooveAmount),
    row.paintAreaM2,
    row.paintRate,
    money(row.paintAmount),
    money(row.subtotal),
  ]);
  const total = rows.reduce((sum, row) => sum + row.subtotal, 0);
  return [
    ['板材成本核算（按照每个板材的规格进行核算）'],
    header,
    ...body,
    ['合计', ...Array(26).fill(''), money(total)],
  ];
}

export function buildAccessoriesExportAoa(input: {
  lines: CostingExportLine[];
  computed?: boolean;
}): unknown[][] {
  const money = (value: number | null) => (input.computed === false ? '' : value);
  const hardware = input.lines.filter(
    (line) => line.category === '五金' || /防倾倒/.test(line.materialName),
  );
  const packs = input.lines.filter((line) => line.category === '包装');
  const rows = [...hardware, ...packs];
  return [
    ['名称', '大类', '规格', '数量', '单位', '单价', '金额'],
    ...rows.map((line) => [
      line.materialName,
      line.category,
      line.spec,
      line.qtyNet,
      line.unit,
      money(line.effectiveUnitPrice),
      money(line.lineAmount),
    ]),
  ];
}

/** 本单涉及的原材料/配件生效单价（去重）。 */
export function buildMaterialUnitPriceAoa(input: {
  lines: CostingExportLine[];
  computed?: boolean;
}): unknown[][] {
  const money = (value: number | null) => (input.computed === false ? '' : value);
  const seen = new Set<string>();
  const rows: unknown[][] = [];
  for (const line of input.lines) {
    if (!(line.qtyNet > 0) && !(line.lineAmount > 0)) continue;
    const key = [line.category, line.materialName, line.spec, line.substrate ?? '', line.unit].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([
      line.materialName,
      line.category,
      line.category === '板材' ? line.substrate ?? '' : '',
      line.spec,
      line.unit,
      money(line.effectiveUnitPrice),
      line.matchStatus,
      line.matchScope ? (MATCH_SCOPE_LABEL[line.matchScope] ?? line.matchScope) : '',
    ]);
  }
  return [
    ['名称', '大类', '材质', '规格', '单位', '生效单价', '匹配状态', '价层'],
    ...rows,
  ];
}

function pushSection(target: unknown[][], title: string, rows: unknown[][]): void {
  if (target.length) target.push([]);
  target.push([title]);
  for (const row of rows) target.push(row);
}

/** 成本确认单页导出：原材料单价 → 板材核算 → 配件包装 → 小计 → 看板。 */
export function buildCostingConfirmSheetAoa(input: {
  projectNo?: string;
  projectName?: string;
  lines: CostingExportLine[];
  summary: CostSummary;
  computed?: boolean;
}): unknown[][] {
  const money = (value: number) => (input.computed === false ? '' : value);
  const share = (amount: number) =>
    input.computed === false || !input.summary.totalAmount ? '' : amount / input.summary.totalAmount;

  const sheet: unknown[][] = [
    ['产品成本核算 — 价格确认'],
    ['核算编号', input.projectNo ?? ''],
    ['产品名称', input.projectName ?? ''],
  ];

  pushSection(sheet, '一、相关涉及的原材料成本单价', buildMaterialUnitPriceAoa(input));

  const boardRows = buildBoardSheetExportAoa({ summary: input.summary, computed: input.computed });
  pushSection(sheet, '二、板材成本核算', boardRows.slice(1));

  pushSection(sheet, '三、配件与包装', buildAccessoriesExportAoa(input).slice(1));

  pushSection(sheet, '四、小计', [
    ['项目', '金额', '占比'],
    ['材料小计', money(input.summary.materialAmount), share(input.summary.materialAmount)],
    ['加工费', money(input.summary.processAmount), share(input.summary.processAmount)],
    ['费用小计', money(input.summary.feeAmount), share(input.summary.feeAmount)],
    ['总成本', money(input.summary.totalAmount), input.computed === false ? '' : 1],
    ['缺价行数', input.summary.missingPriceCount, '缺用量行数', input.summary.missingQtyCount],
  ]);

  const dashboardRows: unknown[][] = [
    ['项目', '金额', '占比'],
    ...input.summary.byCategory.map((item) => [
      item.category,
      money(item.amount),
      input.computed === false ? '' : item.share,
    ]),
    ...input.summary.feeItems.map((item) => [
      `${item.name}（${(item.rate * 100).toFixed(1)}%）`,
      money(item.amount),
      share(item.amount),
    ]),
    ['总成本', money(input.summary.totalAmount), input.computed === false ? '' : 1],
  ];
  pushSection(sheet, '五、成本看板数据', dashboardRows);

  return sheet;
}

export async function exportCostingXlsx(projectId: string): Promise<Buffer> {
  const project = await getCostingProject(projectId);
  if (!project) throw new Error('核算单不存在');

  const exportLines = project.lines.map((line) => ({
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
    matchScope: line.matchScope,
    substrate: line.substrate ?? null,
    provenanceTags: line.provenanceTags,
    extractDiff: line.extractDiff ?? null,
  }));

  const computed = !project.costStale;
  const aoa = buildCostingExportAoa({
    lines: exportLines,
    summary: project.summary,
    computed,
  });

  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      buildCostingConfirmSheetAoa({
        projectNo: project.projectNo,
        projectName: project.name,
        lines: exportLines,
        summary: project.summary,
        computed,
      }),
    ),
    '成本确认',
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa.list), '材料清单');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa.summary), '成本汇总');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      buildBoardSheetExportAoa({ summary: project.summary, computed }),
    ),
    '板材成本核算',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      buildAccessoriesExportAoa({
        lines: exportLines,
        computed,
      }),
    ),
    '配件与包装',
  );
  return Buffer.from(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
