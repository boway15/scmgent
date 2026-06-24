/**
 * SKU 编码解析（HJ-IT-STP-2025-001 v02）
 *
 * 内部标准 SKU：9 位 = [事业部1][分销1][SPU5][变参2]
 * 外部标准 SKU：15 位 = [品牌2][小类3][内部9][工厂1]
 */

export type SkuKind = 'standard' | 'accessory' | 'multi_box' | 'return' | 'legacy';

/** 业务 legacy 格式（预测表/ERP 常用） */
export type LegacyDjFormat = 'dj_standard' | 'dj_sku_accessory' | 'dj_spu_accessory';

export type SkuParseResult = {
  kind: SkuKind;
  valid: boolean;
  /** 入库主键用 code（内部码或 legacy 原样） */
  normalizedCode: string;
  internalCode: string | null;
  externalCode: string | null;
  /** SPU 码：标准 7 位数字，或 legacy 如 DJ502313 */
  spuCode: string | null;
  divisionCode: string | null;
  distributionNo: number | null;
  spuNumericCode: string | null;
  variantNo: string | null;
  brandCode: string | null;
  categoryCode: string | null;
  factorySuffix: string | null;
  accessoryNo: string | null;
  boxNo: string | null;
  divisionName: string | null;
  /** legacy DJ 子类型 */
  legacyFormat?: LegacyDjFormat | null;
  /** SKU 级配件依附的主 SKU，如 DJ478585_2 */
  parentSkuCode?: string | null;
  /** 配件作用域：sku=单品配件, spu=款式下全部 SKU 通用配件 */
  accessoryScope?: 'sku' | 'spu' | null;
  warnings: string[];
};

export const DIVISION_NAMES: Record<string, string> = {
  '1': '大件',
  '3': '家具',
  '5': '海外',
  '7': '宠物',
};

const VALID_DIVISIONS = new Set(['1', '3', '5', '7']);
const RESERVED_FACTORY = new Set(['B', 'P', 'R']);

/** legacy 前缀 → 标准事业部（可扩展 HW/JJ 等） */
const LEGACY_PREFIX_DIVISION: Record<string, { divisionCode: string; divisionName: string }> = {
  DJ: { divisionCode: '1', divisionName: '大件' },
};

function legacyDivisionFromPrefix(prefix: string) {
  return LEGACY_PREFIX_DIVISION[prefix] ?? null;
}

function buildLegacyDj(
  kind: SkuKind,
  spuCode: string,
  spuNum: string,
  prefix: string,
  extras: {
    normalizedCode: string;
    variantNo?: string | null;
    accessoryNo?: string | null;
    legacyFormat: LegacyDjFormat;
    parentSkuCode?: string | null;
    accessoryScope?: 'sku' | 'spu' | null;
  },
): SkuParseResult {
  const div = legacyDivisionFromPrefix(prefix);
  return {
    kind,
    valid: true,
    normalizedCode: extras.normalizedCode,
    internalCode: null,
    externalCode: null,
    spuCode,
    divisionCode: div?.divisionCode ?? null,
    distributionNo: 0,
    spuNumericCode: spuNum,
    variantNo: extras.variantNo ?? null,
    brandCode: prefix,
    categoryCode: null,
    factorySuffix: null,
    accessoryNo: extras.accessoryNo ?? null,
    boxNo: null,
    divisionName: div?.divisionName ?? null,
    legacyFormat: extras.legacyFormat,
    parentSkuCode: extras.parentSkuCode ?? null,
    accessoryScope: extras.accessoryScope ?? null,
    warnings: [],
  };
}

/**
 * 业务 legacy 编码（预测宽表常用）：
 * - DJ502313_34        → SPU=DJ502313, 变参=34
 * - DJ478585_2P02      → SKU=DJ478585_2 的配件 P02
 * - DJ485882P01        → SPU=DJ485882 下全部 SKU 通用配件 P01
 */
function parseLegacyDj(raw: string): SkuParseResult | null {
  const code = raw.trim().toUpperCase();
  if (!code) return null;

  // 须先于 SPU 通用配件、标准 SKU 匹配
  const skuAccessory = /^([A-Z]{2})(\d+)_(\d+)P(\d{2,3})$/.exec(code);
  if (skuAccessory) {
    const [, prefix, spuNum, variant, accNo] = skuAccessory;
    const spuCode = `${prefix}${spuNum}`;
    return buildLegacyDj('accessory', spuCode, spuNum, prefix, {
      normalizedCode: code,
      variantNo: variant,
      accessoryNo: accNo,
      legacyFormat: 'dj_sku_accessory',
      parentSkuCode: `${spuCode}_${variant}`,
      accessoryScope: 'sku',
    });
  }

  const spuAccessory = /^([A-Z]{2})(\d+)P(\d{2,3})$/.exec(code);
  if (spuAccessory) {
    const [, prefix, spuNum, accNo] = spuAccessory;
    const spuCode = `${prefix}${spuNum}`;
    return buildLegacyDj('accessory', spuCode, spuNum, prefix, {
      normalizedCode: code,
      accessoryNo: accNo,
      legacyFormat: 'dj_spu_accessory',
      accessoryScope: 'spu',
    });
  }

  const standard = /^([A-Z]{2})(\d+)_(\d+)$/.exec(code);
  if (standard) {
    const [, prefix, spuNum, variant] = standard;
    const spuCode = `${prefix}${spuNum}`;
    return buildLegacyDj('standard', spuCode, spuNum, prefix, {
      normalizedCode: code,
      variantNo: variant,
      legacyFormat: 'dj_standard',
    });
  }

  return null;
}

function hasThreeConsecutiveSameDigits(five: string): boolean {
  return /(.)\1\1/.test(five);
}

function validateSpuNumeric(spuNumeric: string, warnings: string[]): boolean {
  if (!/^\d{5}$/.test(spuNumeric)) {
    warnings.push('SPU 五位序号必须为数字');
    return false;
  }
  if (hasThreeConsecutiveSameDigits(spuNumeric)) {
    warnings.push('SPU 五位序号不可含连续三位相同数字');
    return false;
  }
  return true;
}

function buildFromBase9(
  base9: string,
  kind: SkuKind,
  extras: {
    externalCode?: string | null;
    factorySuffix?: string | null;
    accessoryNo?: string | null;
    boxNo?: string | null;
    normalizedCode: string;
    internalCode: string;
  },
): SkuParseResult {
  const warnings: string[] = [];
  const divisionCode = base9[0] ?? null;
  const distributionNo = base9[1] != null ? Number(base9[1]) : null;
  const spuNumericCode = base9.slice(2, 7);
  const variantNo = kind === 'standard' ? base9.slice(7, 9) : null;

  let valid = true;
  if (!divisionCode || !VALID_DIVISIONS.has(divisionCode)) {
    warnings.push(`未知事业部号段: ${divisionCode ?? '空'}`);
    valid = false;
  }
  if (distributionNo == null || distributionNo < 0 || distributionNo > 9) {
    warnings.push('分销序号必须为 0-9');
    valid = false;
  }
  if (!validateSpuNumeric(spuNumericCode, warnings)) valid = false;

  const spuCode = `${divisionCode}${distributionNo}${spuNumericCode}`;

  return {
    kind,
    valid,
    normalizedCode: extras.normalizedCode,
    internalCode: extras.internalCode,
    externalCode: extras.externalCode ?? null,
    spuCode,
    divisionCode,
    distributionNo,
    spuNumericCode,
    variantNo,
    brandCode: extras.externalCode ? extras.externalCode.slice(0, 2) : null,
    categoryCode: extras.externalCode ? extras.externalCode.slice(2, 5) : null,
    factorySuffix: extras.factorySuffix ?? null,
    accessoryNo: extras.accessoryNo ?? null,
    boxNo: extras.boxNo ?? null,
    divisionName: divisionCode ? (DIVISION_NAMES[divisionCode] ?? null) : null,
    warnings,
  };
}

function parseExternal(external: string): SkuParseResult | null {
  const ext = external.trim().toUpperCase();
  if (!ext) return null;

  // 标准 15 位
  const std = /^([A-Z]{2})([A-Z0-9]{3})(\d{9})([A-Z])$/.exec(ext);
  if (std) {
    const [, brandCode, categoryCode, base9, factory] = std;
    if (RESERVED_FACTORY.has(factory) && factory !== 'A') {
      // B/P/R 在外部码中也可能出现，按工厂后缀保留
    }
    return buildFromBase9(base9, 'standard', {
      externalCode: ext,
      factorySuffix: factory,
      normalizedCode: base9,
      internalCode: base9,
    });
  }

  // 配件 18 位
  const acc = /^([A-Z]{2})([A-Z0-9]{3})(\d{9}P\d{2,3})([A-Z])$/.exec(ext);
  if (acc) {
    const [, , , internal, factory] = acc;
    const base9 = internal.slice(0, 9);
    const accessoryNo = internal.slice(10);
    return buildFromBase9(base9, 'accessory', {
      externalCode: ext,
      factorySuffix: factory,
      accessoryNo,
      normalizedCode: internal,
      internalCode: internal,
    });
  }

  // 多箱 17 位
  const box = /^([A-Z]{2})([A-Z0-9]{3})(\d{9}B\d)([A-Z])$/.exec(ext);
  if (box) {
    const [, , , internal, factory] = box;
    const base9 = internal.slice(0, 9);
    const boxNo = internal.slice(10);
    return buildFromBase9(base9, 'multi_box', {
      externalCode: ext,
      factorySuffix: factory,
      boxNo,
      normalizedCode: internal,
      internalCode: internal,
    });
  }

  // 退货 16 位
  const ret = /^([A-Z]{2})([A-Z0-9]{3})(\d{9}R)([A-Z])$/.exec(ext);
  if (ret) {
    const [, , , internal, factory] = ret;
    const base9 = internal.slice(0, 9);
    return buildFromBase9(base9, 'return', {
      externalCode: ext,
      factorySuffix: factory,
      normalizedCode: internal,
      internalCode: internal,
    });
  }

  return null;
}

function parseInternal(raw: string): SkuParseResult | null {
  const code = raw.trim().toUpperCase();

  if (/^\d{9}$/.test(code)) {
    return buildFromBase9(code, 'standard', {
      normalizedCode: code,
      internalCode: code,
    });
  }

  const acc = /^(\d{9})P(\d{2,3})$/.exec(code);
  if (acc) {
    const [, base9, accessoryNo] = acc;
    return buildFromBase9(base9, 'accessory', {
      accessoryNo,
      normalizedCode: code,
      internalCode: code,
    });
  }

  const box = /^(\d{9})B(\d)$/.exec(code);
  if (box) {
    const [, base9, boxNo] = box;
    return buildFromBase9(base9, 'multi_box', {
      boxNo,
      normalizedCode: code,
      internalCode: code,
    });
  }

  const ret = /^(\d{9})R$/.exec(code);
  if (ret) {
    const [, base9] = ret;
    return buildFromBase9(base9, 'return', {
      normalizedCode: code,
      internalCode: code,
    });
  }

  return null;
}

export function parseSkuCode(input: string, externalInput?: string | null): SkuParseResult {
  const raw = (input ?? '').trim();
  const ext = externalInput?.trim();

  if (ext) {
    const fromExt = parseExternal(ext);
    if (fromExt) return fromExt;
  }

  if (raw) {
    const fromInt = parseInternal(raw);
    if (fromInt) {
      if (ext && !fromInt.externalCode) {
        fromInt.externalCode = ext.toUpperCase();
        const parsedExt = parseExternal(ext);
        if (parsedExt?.brandCode) fromInt.brandCode = parsedExt.brandCode;
        if (parsedExt?.categoryCode) fromInt.categoryCode = parsedExt.categoryCode;
        if (parsedExt?.factorySuffix) fromInt.factorySuffix = parsedExt.factorySuffix;
      }
      return fromInt;
    }

    const fromLegacy = parseLegacyDj(raw);
    if (fromLegacy) return fromLegacy;
  }

  return {
    kind: 'legacy',
    valid: false,
    normalizedCode: raw.toUpperCase() || raw,
    internalCode: null,
    externalCode: ext ? ext.toUpperCase() : null,
    spuCode: null,
    divisionCode: null,
    distributionNo: null,
    spuNumericCode: null,
    variantNo: null,
    brandCode: null,
    categoryCode: null,
    factorySuffix: null,
    accessoryNo: null,
    boxNo: null,
    divisionName: null,
    warnings: ['非标准 SKU 编码，已标记为 legacy'],
  };
}

/** 将解析结果映射为 skus 表可写字段 */
export function skuEncodingToColumns(parse: SkuParseResult): Record<string, unknown> {
  return {
    externalCode: parse.externalCode,
    internalCode: parse.internalCode,
    skuKind: parse.kind,
    divisionCode: parse.divisionCode,
    distributionNo: parse.distributionNo,
    spuNumericCode: parse.spuNumericCode,
    variantNo: parse.variantNo,
    brandCode: parse.brandCode,
    categoryCode: parse.categoryCode,
    factorySuffix: parse.factorySuffix,
    accessoryNo: parse.accessoryNo,
    boxNo: parse.boxNo,
    encodingValid: parse.valid,
    encodingMeta: {
      warnings: parse.warnings,
      spuCode: parse.spuCode,
      divisionName: parse.divisionName,
      legacyFormat: parse.legacyFormat ?? undefined,
      parentSkuCode: parse.parentSkuCode ?? undefined,
      accessoryScope: parse.accessoryScope ?? undefined,
    },
  };
}

/** 将解析结果映射为 spus 表可写字段（由 SKU 自动提炼） */
export function spuFieldsFromParse(
  parse: SkuParseResult,
  name: string,
  opts?: { moq?: number; category?: string },
): Record<string, unknown> | null {
  if (!parse.spuCode || !parse.valid) return null;
  return {
    code: parse.spuCode,
    name,
    divisionCode: parse.divisionCode,
    distributionNo: parse.distributionNo ?? 0,
    spuNumericCode: parse.spuNumericCode,
    brandCode: parse.brandCode,
    categoryCode: parse.categoryCode,
    divisionName: parse.divisionName,
    brand: parse.brandCode ?? undefined,
    category: opts?.category ?? parse.categoryCode ?? undefined,
    encodingSource: 'sku_derived',
    moq: opts?.moq,
  };
}
