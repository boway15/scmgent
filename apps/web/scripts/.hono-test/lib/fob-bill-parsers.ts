export type ParsedTruckingFee = {
  containerNo: string;
  internalNo?: string;
  blNo?: string;
  shipDate?: string;
  loadAddress?: string;
  feeType: string;
  amountCny: number;
  sourceRow: number;
  remark?: string;
  assignedMerchantCode?: string;
  forceException?: boolean;
};

export type ParsedFreightFee = {
  containerNo: string;
  orderNo?: string;
  blNo?: string;
  bizDate?: string;
  destPort?: string;
  volumeCbm?: number;
  feeType: string;
  stage: 'trucking' | 'freight' | 'customs' | 'other';
  amountCny: number;
  originalCurrency: 'CNY' | 'USD';
  originalAmount: number;
  exchangeRate?: number;
  sourceRow: number;
  panelSide: 'left' | 'right';
  remark?: string;
  assignedMerchantCode?: string;
  forceException?: boolean;
};

export type ParseResult<T> = {
  items: T[];
  errors: string[];
  skippedRows: number;
  /** 体积文件中出现但货柜内无 FOB 行的柜号 */
  nonFobContainers?: string[];
};

function parseAmount(v: unknown): number {
  if (v == null || v === '' || v === ' ') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function cleanContainerNo(v: unknown): string {
  return String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/\n/g, '')
    .toUpperCase();
}

function normalizeFeeName(v: unknown): string {
  return String(v ?? '')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SENWEI_FEE_COLUMNS = [
  '拖车费',
  '报关费',
  '堆存费',
  '多点提货费',
  '码头费',
  '港杂费',
  '超期费',
  '超时等待费',
  '落地寄柜费',
  '压夜费',
  '指定柜号',
  '其他费用',
] as const;

const SENWEI_SKIP_PATTERN = /递延|减免|^FOB$|多收|应付款/;

/** 森威拖车账单：表头第 2 行，宽表 unpivot；底部合计/调整行跳过 */
export function parseSenweiTruckingSheet(rows: unknown[][]): ParseResult<ParsedTruckingFee> {
  const errors: string[] = [];
  const items: ParsedTruckingFee[] = [];
  let skippedRows = 0;

  if (rows.length < 3) {
    return { items, errors: ['文件行数不足'], skippedRows: 0 };
  }

  const header = rows[1] as unknown[];
  const feeColIdx = SENWEI_FEE_COLUMNS.map((name) => header.indexOf(name));
  const remarkIdx = header.indexOf('备注(CNY)');

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const internalNo = String(row[0] ?? '').trim();
    const containerNo = cleanContainerNo(row[2]);
    const firstCell = internalNo || String(row[feeColIdx[0] >= 0 ? feeColIdx[0] : 0] ?? '').trim();

    if (SENWEI_SKIP_PATTERN.test(firstCell) || SENWEI_SKIP_PATTERN.test(String(row[24] ?? ''))) {
      skippedRows++;
      continue;
    }

    if (!containerNo) {
      if (row.some((c) => String(c).trim())) skippedRows++;
      continue;
    }

    const recordBase = {
      containerNo,
      internalNo: internalNo || undefined,
      blNo: String(row[1] ?? '').trim() || undefined,
      shipDate: String(row[4] ?? '').trim() || undefined,
      loadAddress: String(row[3] ?? '').trim() || undefined,
      sourceRow: r + 1,
      remark: remarkIdx >= 0 ? String(row[remarkIdx] ?? '').trim() || undefined : undefined,
    };

    let hasFee = false;
    SENWEI_FEE_COLUMNS.forEach((feeType, idx) => {
      const col = feeColIdx[idx];
      if (col < 0) return;
      const amount = parseAmount(row[col]);
      if (amount <= 0) return;
      hasFee = true;
      items.push({ ...recordBase, feeType, amountCny: amount });
    });

    if (!hasFee) {
      errors.push(`第 ${r + 1} 行（柜号 ${containerNo}）无有效费用列`);
    }
  }

  return { items, errors, skippedRows };
}

/** 识别森威拖车原表（表头第 2 行含「内部编号」） */
export function isSenweiTruckingSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const header = rows[1] as unknown[];
  return (
    findHeaderIndex(header, ['内部编号']) >= 0 &&
    findHeaderIndex(header, CONTAINER_HEADER_ALIASES) >= 0
  );
}

/** 识别简化拖车导入模板（表头第 1 行含「货柜号」+ 宽表费用列） */
export function isSimplifiedTruckingSheet(rows: unknown[][]): boolean {
  if (rows.length < 1) return false;
  const header = rows[0] as unknown[];
  return (
    findHeaderIndex(header, ['货柜号']) >= 0 &&
    findHeaderIndex(header, ['拖车费']) >= 0 &&
    findHeaderIndex(header, ['内部编号']) < 0
  );
}

/** 简化拖车导入：表头第 1 行，按列 unpivot 费用 */
export function parseSimplifiedTruckingSheet(rows: unknown[][]): ParseResult<ParsedTruckingFee> {
  const errors: string[] = [];
  const items: ParsedTruckingFee[] = [];
  let skippedRows = 0;

  if (rows.length < 2) {
    return { items, errors: ['文件行数不足'], skippedRows: 0 };
  }

  const header = rows[0] as unknown[];
  const containerIdx = findHeaderIndex(header, CONTAINER_HEADER_ALIASES);
  const internalNoIdx = findHeaderIndex(header, ['业务编号', '内部编号']);
  const blNoIdx = findHeaderIndex(header, ['提单号']);
  const loadAddressIdx = findHeaderIndex(header, ['起始港', '装货地址']);
  const shipDateIdx = findHeaderIndex(header, ['发货时间', '船期']);

  if (containerIdx < 0) {
    return { items, errors: ['缺少必要列：货柜号/柜号'], skippedRows: 0 };
  }

  const feeCols: Array<{ idx: number; name: string }> = [];
  header.forEach((name, i) => {
    const n = normalizeFeeName(name);
    if (!n || TRUCKING_META_HEADERS.has(String(name ?? '').trim())) return;
    feeCols.push({ idx: i, name: n });
  });

  if (!feeCols.length) {
    return { items, errors: ['未找到费用列'], skippedRows: 0 };
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row.some((c) => String(c).trim())) {
      skippedRows++;
      continue;
    }

    const containerNo = cleanContainerNo(row[containerIdx]);
    const firstCell = String(row[0] ?? '').trim();
    if (SENWEI_SKIP_PATTERN.test(firstCell)) {
      skippedRows++;
      continue;
    }

    if (!containerNo) {
      skippedRows++;
      continue;
    }

    const recordBase = {
      containerNo,
      internalNo: internalNoIdx >= 0 ? String(row[internalNoIdx] ?? '').trim() || undefined : undefined,
      blNo: blNoIdx >= 0 ? String(row[blNoIdx] ?? '').trim() || undefined : undefined,
      shipDate: shipDateIdx >= 0 ? String(row[shipDateIdx] ?? '').trim() || undefined : undefined,
      loadAddress: loadAddressIdx >= 0 ? String(row[loadAddressIdx] ?? '').trim() || undefined : undefined,
      sourceRow: r + 1,
    };

    let hasFee = false;
    for (const { idx, name } of feeCols) {
      const amount = parseAmount(row[idx]);
      if (amount <= 0) continue;
      hasFee = true;
      items.push({ ...recordBase, feeType: name, amountCny: amount });
    }

    if (!hasFee) {
      errors.push(`第 ${r + 1} 行（柜号 ${containerNo}）无有效费用列`);
    }
  }

  return { items, errors, skippedRows };
}

/** 识别华贸货代原表（表头第 6 行含「工作号」） */
export function isHuamaoFreightSheet(rows: unknown[][]): boolean {
  if (rows.length < 6) return false;
  const header = rows[5] as unknown[];
  return findHeaderIndex(header, ['工作号']) >= 0;
}

/** 识别简化货代导入模板（表头第 1 行含「货柜号」+ 港杂费列） */
export function isSimplifiedFreightSheet(rows: unknown[][]): boolean {
  if (rows.length < 1) return false;
  const header = rows[0] as unknown[];
  return (
    findHeaderIndex(header, ['货柜号']) >= 0 &&
    (findHeaderIndex(header, ['ORC']) >= 0 ||
      findHeaderIndex(header, ['文件费']) >= 0 ||
      findHeaderIndex(header, ['港杂费']) >= 0) &&
    findHeaderIndex(header, ['工作号']) < 0
  );
}

/** 简化货代导入：表头第 1 行；单元格金额均为人民币（业务侧已折算） */
export function parseSimplifiedFreightSheet(rows: unknown[][]): ParseResult<ParsedFreightFee> {
  const errors: string[] = [];
  const items: ParsedFreightFee[] = [];
  let skippedRows = 0;

  if (rows.length < 2) {
    return { items, errors: ['文件行数不足'], skippedRows: 0 };
  }

  const header = rows[0] as unknown[];
  const containerIdx = findHeaderIndex(header, CONTAINER_HEADER_ALIASES);
  const orderNoIdx = findHeaderIndex(header, ['业务编号', '工作号']);
  const blNoIdx = findHeaderIndex(header, ['提单号']);
  const bizDateIdx = findHeaderIndex(header, ['进港时间', '业务日期']);
  const destPortIdx = findHeaderIndex(header, ['起始港', '目的港']);

  if (containerIdx < 0) {
    return { items, errors: ['缺少必要列：货柜号/柜号'], skippedRows: 0 };
  }

  const feeCols: Array<{ idx: number; name: string }> = [];
  header.forEach((name, i) => {
    const n = normalizeFeeName(name);
    if (!n || FREIGHT_META_HEADERS.has(String(name ?? '').trim())) return;
    feeCols.push({ idx: i, name: n });
  });

  if (!feeCols.length) {
    return { items, errors: ['未找到费用列'], skippedRows: 0 };
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row.some((c) => String(c).trim())) {
      skippedRows++;
      continue;
    }

    const containerNo = cleanContainerNo(row[containerIdx]);
    if (!containerNo) {
      skippedRows++;
      continue;
    }

    const baseInfo = {
      containerNo,
      orderNo: orderNoIdx >= 0 ? String(row[orderNoIdx] ?? '').trim() || undefined : undefined,
      blNo: blNoIdx >= 0 ? String(row[blNoIdx] ?? '').trim() || undefined : undefined,
      bizDate: bizDateIdx >= 0 ? String(row[bizDateIdx] ?? '').trim() || undefined : undefined,
      destPort: destPortIdx >= 0 ? String(row[destPortIdx] ?? '').trim() || undefined : undefined,
      sourceRow: r + 1,
      panelSide: 'left' as const,
    };

    let hasFee = false;
    for (const { idx, name } of feeCols) {
      const amountCny = parseAmount(row[idx]);
      if (amountCny <= 0) continue;
      hasFee = true;

      items.push({
        ...baseInfo,
        feeType: name,
        stage: mapHuamaoFeeStage(name),
        amountCny,
        originalCurrency: 'CNY',
        originalAmount: amountCny,
        forceException: /异常/.test(name),
      });
    }

    if (!hasFee) {
      errors.push(`第 ${r + 1} 行（柜号 ${containerNo}）无费用明细`);
    }
  }

  return { items, errors, skippedRows };
}

function mapHuamaoFeeStage(feeName: string): 'freight' | 'customs' | 'other' {
  if (/申报|关税|增值税|查验|清关/.test(feeName)) return 'customs';
  return 'freight';
}

/** 华贸对账单：表头第 6 行；每行左右两栏各为独立票；金额均为人民币（业务侧已折算） */
export function parseHuamaoFreightSheet(rows: unknown[][]): ParseResult<ParsedFreightFee> {
  const errors: string[] = [];
  const items: ParsedFreightFee[] = [];
  let skippedRows = 0;

  if (rows.length < 7) {
    return { items, errors: ['文件行数不足'], skippedRows: 0 };
  }

  const header = rows[5] as unknown[];
  const leftFeeCols: Array<{ i: number; name: string }> = [];
  const rightFeeCols: Array<{ i: number; name: string }> = [];

  header.forEach((name, i) => {
    const n = normalizeFeeName(name);
    if (!n || /合计/.test(n)) return;
    if (i <= 24 && /\(USD\)|\(CNY\)/.test(n)) leftFeeCols.push({ i, name: n });
    if (i >= 26 && /\(CNY\)/.test(n)) rightFeeCols.push({ i, name: n });
  });

  const panels: Array<{ base: number; fees: typeof leftFeeCols; side: 'left' | 'right' }> = [
    { base: 0, fees: leftFeeCols, side: 'left' },
    { base: 26, fees: rightFeeCols, side: 'right' },
  ];

  for (let r = 6; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const marker = String(row[0] ?? '').trim();
    if (!marker || marker.startsWith('全称') || marker.startsWith('开户') || marker.startsWith('帐号')) {
      skippedRows++;
      continue;
    }

    for (const panel of panels) {
      const containerNo = cleanContainerNo(row[panel.base + 2]);
      if (!containerNo) continue;

      const baseInfo = {
        containerNo,
        orderNo: String(row[panel.base] ?? '').trim() || undefined,
        blNo: String(row[panel.base + 1] ?? '').trim() || undefined,
        bizDate: String(row[panel.base + 7] ?? '').trim() || undefined,
        destPort: String(row[panel.base + 8] ?? '').trim() || undefined,
        volumeCbm: parseAmount(row[panel.base + 9]) || undefined,
        sourceRow: r + 1,
        panelSide: panel.side,
      };

      let hasFee = false;
      for (const { i, name } of panel.fees) {
        const amountCny = parseAmount(row[i]);
        if (amountCny <= 0) continue;
        hasFee = true;

        const forceException = /异常/.test(name);
        items.push({
          ...baseInfo,
          feeType: name,
          stage: mapHuamaoFeeStage(name),
          amountCny,
          originalCurrency: 'CNY',
          originalAmount: amountCny,
          forceException,
        });
      }

      if (!hasFee) {
        errors.push(`第 ${r + 1} 行 ${panel.side} 栏（柜号 ${containerNo}）无费用明细`);
      }
    }
  }

  return { items, errors, skippedRows };
}

export async function sheetRowsFromBuffer(buffer: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false }) as unknown[][];
}

/** 体积信息 / 商家发货行 */
export type ParsedMerchantShipment = {
  merchantCode: string;
  merchantName?: string;
  containerNo: string;
  skuCode?: string;
  qty?: number;
  volumeCbm: number;
  weightKg?: number;
  remark?: string;
};

const CONTAINER_HEADER_ALIASES = ['柜号', '货柜号', '箱号', '集装箱号', 'container_no', '临柜号'] as const;

const TRUCKING_META_HEADERS = new Set([
  '货柜号',
  '柜号',
  '箱号',
  '集装箱号',
  '临柜号',
  '业务编号',
  '内部编号',
  '提单号',
  '起始港',
  '装货地址',
  '船公司',
  '发货时间',
  '船期',
]);

const FREIGHT_META_HEADERS = new Set([
  '货柜号',
  '柜号',
  '箱号',
  '集装箱号',
  '临柜号',
  '业务编号',
  '提单号',
  '起始港',
  '船公司',
  '进港时间',
  '业务日期',
  '目的港',
  '体积',
]);
const SUBJECT_HEADER_ALIASES = ['法人主体', '主体', '商家名称', 'merchant_name', '商家编码', '商家代码'] as const;
const VOLUME_HEADER_ALIASES = ['体积/m3', '体积m3', '体积', 'volume_cbm', 'volume'] as const;

function normalizeHeaderCell(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function findHeaderIndex(header: unknown[], aliases: readonly string[]): number {
  const normalized = header.map(normalizeHeaderCell);
  for (const alias of aliases) {
    const key = normalizeHeaderCell(alias);
    const idx = normalized.indexOf(key);
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < header.length; i++) {
    const raw = String(header[i] ?? '').trim();
    if (aliases.some((alias) => raw === alias || raw.includes(alias))) return i;
  }
  return -1;
}

export function findEdVolumeHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const header = rows[i] as unknown[];
    const factoryTypeIdx = findHeaderIndex(header, ['工厂类别']);
    const subjectIdx = findHeaderIndex(header, SUBJECT_HEADER_ALIASES);
    const volumeIdx = findHeaderIndex(header, VOLUME_HEADER_ALIASES);
    const containerIdx = findHeaderIndex(header, CONTAINER_HEADER_ALIASES);
    if (factoryTypeIdx >= 0 && subjectIdx >= 0 && volumeIdx >= 0 && containerIdx >= 0) return i;
  }
  return -1;
}

/** 识别 ED 大件调拨导出（含 工厂类别 + 主体 + 体积列） */
export function isEdVolumeExport(rows: unknown[][]): boolean {
  return findEdVolumeHeaderRow(rows) >= 0;
}

function isFobFactoryType(v: unknown): boolean {
  return /FOB/i.test(String(v ?? '').trim());
}

/**
 * ED 大件调拨管理导出明细 → 体积信息
 * - 按原表每行拆分；分摊主体取法人主体/主体列
 * - 柜级过滤：仅当货柜全部为非 FOB 时整柜忽略；含 FOB 的货柜保留该柜所有有效体积行（含非 FOB 行）
 */
export function parseEdVolumeSheet(rows: unknown[][]): ParseResult<ParsedMerchantShipment> {
  const errors: string[] = [];
  const items: ParsedMerchantShipment[] = [];
  let skippedRows = 0;

  if (rows.length < 2) {
    return { items, errors: ['文件行数不足'], skippedRows: 0 };
  }

  const headerRowIdx = findEdVolumeHeaderRow(rows);
  if (headerRowIdx < 0) {
    return { items, errors: ['缺少必要列：柜号/箱号、主体/法人主体、体积、工厂类别'], skippedRows: 0 };
  }

  const header = rows[headerRowIdx] as unknown[];
  const containerIdx = findHeaderIndex(header, CONTAINER_HEADER_ALIASES);
  const subjectIdx = findHeaderIndex(header, SUBJECT_HEADER_ALIASES);
  const volumeIdx = findHeaderIndex(header, VOLUME_HEADER_ALIASES);
  const factoryTypeIdx = findHeaderIndex(header, ['工厂类别']);
  const skuIdx = findHeaderIndex(header, ['Sku', 'sku', 'sku_code']);
  const bizNoIdx = findHeaderIndex(header, ['业务编号']);
  const factoryNameIdx = findHeaderIndex(header, ['工厂名称']);
  const qtyIdx = findHeaderIndex(header, ['总件数', '实发数量', '调拨数量', 'qty']);
  const weightIdx = findHeaderIndex(header, ['总净重/kg', '总净重/KG', '外箱毛重/KG', 'weight_kg']);

  if (containerIdx < 0 || subjectIdx < 0 || volumeIdx < 0 || factoryTypeIdx < 0) {
    return {
      items,
      errors: ['缺少必要列：柜号/箱号、主体/法人主体、体积、工厂类别'],
      skippedRows: 0,
    };
  }

  const containersInFile = new Set<string>();
  const containersWithFob = new Set<string>();
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row.some((c) => String(c).trim())) continue;
    const containerNo = cleanContainerNo(row[containerIdx]);
    if (!containerNo) continue;
    containersInFile.add(containerNo);
    if (isFobFactoryType(row[factoryTypeIdx])) containersWithFob.add(containerNo);
  }
  const nonFobContainers = [...containersInFile].filter((c) => !containersWithFob.has(c)).sort();

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row.some((c) => String(c).trim())) {
      skippedRows++;
      continue;
    }

    const containerNo = cleanContainerNo(row[containerIdx]);
    const subject = String(row[subjectIdx] ?? '').trim();
    const factoryType = String(row[factoryTypeIdx] ?? '').trim();
    const volumeCbm = parseAmount(row[volumeIdx]);

    if (!containerNo) {
      skippedRows++;
      continue;
    }

    if (!containersWithFob.has(containerNo)) {
      skippedRows++;
      continue;
    }

    if (volumeCbm <= 0) {
      skippedRows++;
      continue;
    }

    if (!subject) {
      errors.push(`第 ${r + 1} 行：主体为空（柜号 ${containerNo}）`);
      continue;
    }

    const bizNo = bizNoIdx >= 0 ? String(row[bizNoIdx] ?? '').trim() : '';
    const factoryName = factoryNameIdx >= 0 ? String(row[factoryNameIdx] ?? '').trim() : '';
    const remarkParts = [
      bizNo && `业务编号:${bizNo}`,
      factoryName && `工厂:${factoryName}`,
      factoryType && `类别:${factoryType}`,
    ].filter(Boolean);

    items.push({
      merchantCode: subject,
      merchantName: subject,
      containerNo,
      skuCode: skuIdx >= 0 ? String(row[skuIdx] ?? '').trim() || undefined : undefined,
      qty: qtyIdx >= 0 ? parseAmount(row[qtyIdx]) || undefined : undefined,
      volumeCbm,
      weightKg: weightIdx >= 0 ? parseAmount(row[weightIdx]) || undefined : undefined,
      remark: remarkParts.length ? remarkParts.join('；') : undefined,
    });
  }

  if (!items.length && !nonFobContainers.length) {
    errors.push('未解析到体积行（需货柜内至少含一行 FOB，且体积 > 0）');
  }

  return { items, errors, skippedRows, nonFobContainers };
}

export function parseMerchantShipmentRows(
  rows: Array<Record<string, string>>,
): ParseResult<ParsedMerchantShipment> {
  const errors: string[] = [];
  const items: ParsedMerchantShipment[] = [];
  let skippedRows = 0;

  const hasFactoryType = rows.some((row) => (row['工厂类别'] ?? row.factory_type ?? '').trim());
  const containersInFile = new Set<string>();
  const containersWithFob = new Set<string>();

  if (hasFactoryType) {
    rows.forEach((row) => {
      const containerNo = cleanContainerNo(
        row.container_no ||
          row.containerno ||
          row['柜号'] ||
          row['货柜号'] ||
          row['箱号'] ||
          row['集装箱号'] ||
          row['临柜号'] ||
          '',
      );
      const factoryType = row['工厂类别'] ?? row.factory_type ?? '';
      if (containerNo) containersInFile.add(containerNo);
      if (containerNo && isFobFactoryType(factoryType)) containersWithFob.add(containerNo);
    });
  }
  const nonFobContainers = hasFactoryType
    ? [...containersInFile].filter((c) => !containersWithFob.has(c)).sort()
    : [];

  rows.forEach((row, idx) => {
    const merchantCode =
      row.merchant_code ||
      row.merchantcode ||
      row['商家编码'] ||
      row['商家代码'] ||
      row['法人主体'] ||
      row['主体'] ||
      '';
    const containerNo = cleanContainerNo(
      row.container_no ||
        row.containerno ||
        row['柜号'] ||
        row['货柜号'] ||
        row['箱号'] ||
        row['集装箱号'] ||
        row['临柜号'] ||
        '',
    );
    const volume = parseAmount(
      row.volume_cbm || row.volume || row['体积'] || row['体积m3'] || row['体积/m3'],
    );
    const factoryType = row['工厂类别'] ?? row.factory_type ?? '';

    if (hasFactoryType) {
      if (!containerNo || !containersWithFob.has(containerNo)) {
        skippedRows++;
        return;
      }
    }

    if (!merchantCode || !containerNo || volume <= 0) {
      errors.push(`第 ${idx + 2} 行：主体 / 柜号 / 体积 无效`);
      return;
    }

    items.push({
      merchantCode: merchantCode.trim(),
      merchantName: row.merchant_name || row['商家名称'] || row['法人主体'] || row['主体'] || undefined,
      containerNo,
      skuCode: row.sku_code || row['sku'] || row['Sku'] || undefined,
      qty: parseAmount(row.qty || row['总件数'] || row['实发数量']) || undefined,
      volumeCbm: volume,
      weightKg: parseAmount(row.weight_kg || row['重量'] || row['总净重/kg']) || undefined,
      remark:
        row.remark ||
        row['备注'] ||
        (factoryType ? `类别:${factoryType}` : undefined),
    });
  });

  if (!items.length && !nonFobContainers.length && hasFactoryType) {
    errors.push('未解析到体积行（需货柜内至少含一行 FOB，且体积 > 0）');
  }

  return { items, errors, skippedRows, nonFobContainers };
}
