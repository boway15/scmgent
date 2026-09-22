import { COSTING_PRODUCT_CATEGORIES, detectCostingCategory } from './category-rules.js';

const SUBSTRATES = ['多层实木板', '颗粒板', '密度板', '实木', '其他'] as const;
const CONSTRUCTION_TYPES = ['板式', '实木', '混合'] as const;

export type ParsedProductFacts = {
  productName: string | null;
  category: string | null;
  constructionType: string | null;
  drawerCount: number | null;
  defaultSubstrate: string | null;
  carcassThicknessMm: number | null;
  drawerBottomThicknessMm: number | null;
  sideThicknessMm: number | null;
  backThicknessMm: number | null;
  bottomThicknessMm: number | null;
  structureSummary: string | null;
  designPrinciples: string | null;
};

export const EMPTY_PRODUCT_FACTS: ParsedProductFacts = {
  productName: null,
  category: null,
  constructionType: null,
  drawerCount: null,
  defaultSubstrate: null,
  carcassThicknessMm: null,
  drawerBottomThicknessMm: null,
  sideThicknessMm: null,
  backThicknessMm: null,
  bottomThicknessMm: null,
  structureSummary: null,
  designPrinciples: null,
};

function joinedText(texts: string[]): string {
  return texts
    .map((text) => text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function parseCategory(text: string): string | null {
  return detectCostingCategory(text);
}

const CN_DRAWER_COUNT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseDrawerCount(text: string): number | null {
  const labeled = text.match(
    /(?:抽屉|drawer)[^\d一二两三四五六七八九十]{0,8}(\d{1,2}|[一二两三四五六七八九十])/i,
  );
  const prefixed = text.match(/(\d{1,2}|[一二两三四五六七八九十])\s*(?:抽(?:屉)?|drawer)/i);
  const token = labeled?.[1] ?? prefixed?.[1];
  if (!token) return null;
  const raw = CN_DRAWER_COUNT[token] ?? Number(token);
  if (!Number.isInteger(raw) || raw < 1 || raw > 30) return null;
  return raw;
}

function parseProductName(text: string): string | null {
  const normalized = text
    .replace(/\.(pptx?|pdf)$/i, ' ')
    .replace(/打样文件/g, ' ')
    .replace(/[｜|]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalized.split(' ').filter(Boolean);
  for (const raw of tokens) {
    const name = raw.replace(/^\d{3,8}/, '');
    if (/部门|设计部|研发部|事业部/.test(name)) continue;
    if (name.length < 2 || name.length > 40) continue;
    if (/柜|桌|台/.test(name)) return name;
  }
  return null;
}

function parseSubstrate(text: string): string | null {
  if (/多层实木|多层板|胶合板/i.test(text)) return '多层实木板';
  if (/颗粒板|刨花板|particle/i.test(text)) return '颗粒板';
  if (/密度板|中纤板|MDF/i.test(text)) return '密度板';
  if (/实木/i.test(text) && !/多层实木|实木皮|木皮/i.test(text)) return '实木';
  return null;
}

function parseConstruction(text: string): string | null {
  if (/板木结合|混合结构|\b混合\b/.test(text)) return '混合';
  if (/板式/.test(text)) return '板式';
  if (/实木结构|实木框架/.test(text)) return '实木';
  return null;
}

function normalizeCategory(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if ((COSTING_PRODUCT_CATEGORIES as readonly string[]).includes(text)) return text;
  return parseCategory(text) ?? (text.length <= 20 ? '其他' : null);
}

function normalizeConstruction(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((CONSTRUCTION_TYPES as readonly string[]).includes(text)) return text;
  return parseConstruction(text);
}

function normalizeSubstrate(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((SUBSTRATES as readonly string[]).includes(text)) return text;
  return parseSubstrate(text);
}

function optionalInt(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

/** Infer product-level facts from design-page OCR / slide texts. Empty fields stay null. */
export function parseProductFacts(texts: string[]): ParsedProductFacts {
  const text = joinedText(texts);
  if (!text) return { ...EMPTY_PRODUCT_FACTS };
  return {
    ...EMPTY_PRODUCT_FACTS,
    productName: parseProductName(text),
    category: parseCategory(text),
    constructionType: parseConstruction(text),
    drawerCount: parseDrawerCount(text),
    defaultSubstrate: parseSubstrate(text),
  };
}

export function parseLlmProductFacts(raw: unknown): ParsedProductFacts | null {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonText = fenced?.[1]?.trim() || trimmed;
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      value = JSON.parse(jsonText.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.lines) || Array.isArray(obj.material_name)) return null;
  const facts: ParsedProductFacts = {
    productName: optionalText(obj.product_name ?? obj.productName ?? obj.name),
    category: normalizeCategory(obj.category ?? obj.product_category),
    constructionType: normalizeConstruction(obj.construction_type ?? obj.constructionType),
    drawerCount: optionalInt(obj.drawer_count ?? obj.drawerCount, 0, 30),
    defaultSubstrate: normalizeSubstrate(obj.default_substrate ?? obj.defaultSubstrate),
    carcassThicknessMm: optionalInt(obj.carcass_thickness_mm ?? obj.carcassThicknessMm, 8, 40),
    drawerBottomThicknessMm: optionalInt(
      obj.drawer_bottom_thickness_mm ?? obj.drawerBottomThicknessMm,
      3,
      18,
    ),
    sideThicknessMm: optionalInt(obj.side_thickness_mm ?? obj.sideThicknessMm, 8, 40),
    backThicknessMm: optionalInt(obj.back_thickness_mm ?? obj.backThicknessMm, 2, 18),
    bottomThicknessMm: optionalInt(obj.bottom_thickness_mm ?? obj.bottomThicknessMm, 8, 40),
    structureSummary: optionalText(obj.structure_summary ?? obj.structureSummary),
    designPrinciples: optionalText(obj.design_principles ?? obj.designPrinciples),
  };
  const hasAny = Object.values(facts).some((item) => item != null && item !== '');
  return hasAny ? facts : null;
}

export function parseWorkflowProductFacts(outputs: Record<string, unknown>): ParsedProductFacts | null {
  return (
    parseLlmProductFacts(outputs.product_facts) ||
    parseLlmProductFacts(outputs.productFacts) ||
    parseLlmProductFacts(outputs.result) ||
    parseLlmProductFacts(outputs)
  );
}

/** Prefer `current` (already confirmed or higher-priority), fill gaps from `parsed`. */
export function mergeProductFacts(
  current: Partial<ParsedProductFacts>,
  parsed: Partial<ParsedProductFacts>,
): ParsedProductFacts {
  return {
    productName: current.productName || parsed.productName || null,
    category: current.category || parsed.category || null,
    constructionType: current.constructionType || parsed.constructionType || null,
    drawerCount: current.drawerCount ?? parsed.drawerCount ?? null,
    defaultSubstrate: current.defaultSubstrate || parsed.defaultSubstrate || null,
    carcassThicknessMm: current.carcassThicknessMm ?? parsed.carcassThicknessMm ?? null,
    drawerBottomThicknessMm:
      current.drawerBottomThicknessMm ?? parsed.drawerBottomThicknessMm ?? null,
    sideThicknessMm: current.sideThicknessMm ?? parsed.sideThicknessMm ?? null,
    backThicknessMm: current.backThicknessMm ?? parsed.backThicknessMm ?? null,
    bottomThicknessMm: current.bottomThicknessMm ?? parsed.bottomThicknessMm ?? null,
    structureSummary: current.structureSummary || parsed.structureSummary || null,
    designPrinciples: current.designPrinciples || parsed.designPrinciples || null,
  };
}
