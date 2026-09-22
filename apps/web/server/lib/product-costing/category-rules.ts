import type { PageKind } from './types.js';

export const CONSTRUCTION_TYPES = ['板式', '实木', '混合'] as const;
export type ConstructionType = (typeof CONSTRUCTION_TYPES)[number];

export const SUBSTRATE_OPTIONS = ['颗粒板', '密度板', '多层实木板', '实木', '其他'] as const;
export type SubstrateOption = (typeof SUBSTRATE_OPTIONS)[number];

export const MATERIAL_ALIASES: Record<string, string[]> = {
  密度板: ['MDF', '中纤板', '中密度纤维板'],
  颗粒板: ['刨花板', 'Particle Board', 'PB'],
  多层实木板: ['多层板', '胶合板', '夹板', 'plywood'],
  封边: ['封边条', 'PVC封边'],
  抽屉滑轨: ['滚珠滑轨'],
  拉手: ['把手', '抽屉拉手'],
  防倾倒配件: ['金属防倾倒装置', '防倾倒装置'],
  前拉条: ['正面拉条', '前档条', '档条'],
  背拉条: ['后面拉条', '后档条', '后拉条', '背部拉条'],
  落地拉条: ['地拉条', '底部拉条'],
};

export type CategoryRule = {
  structureSlots: string[];
  hardwareIfSeen: string[];
  defaultLossRate: number;
  pageHints: Partial<Record<PageKind, string>>;
};

const PAGE_TASKS: Record<PageKind, string> = {
  size: '本页抽取整柜外形 W×D×H；尺寸图只识别抽面开料（原样抄图上宽×高，常带 .0，例如 521×210）。禁止用柜宽÷列数推算抽面（会得到 598 这类网格宽）。物料名必须是「抽面」，不要写成颗粒板/密度板。抽侧/抽后/抽底不要从图上拆，由下游按规则计算。禁止输出「产品尺寸」BOM 行，禁止把部门页当物料。',
  explosion: '本页只拆物料清单：结构件/板件名称与图上已标数量或局部尺寸。不要把本页小板开料当成整柜外形。「高度/盖住」不是物料。',
  cmf: '只抽取基材、饰面、封边色/厚度；不要补结构件数量；不要把「材质选择：密度板」拆成无规格数量行；不要输出抽面开料尺寸。',
  bom_list: '只抽取配件/五金名称与数量；名称尽量对齐价目标准名。',
  notes: '本页抽取设计规则与默认标准：箱体基材与板厚、抽底板厚、饰面厚度、滑轨节数/寸数、螺丝/喷漆/斜切。胡桃/浮雕/木皮是饰面，不要输出物料行。「档条高度」不是前拉条开料。不要拆侧板件数。',
  cover: '除非文本含材料关键词，否则不要输出结构件或五金。',
  render: '除非文本含材料关键词，否则不要输出结构件或五金。',
  unknown: '结合页图识别材料；不确定的用量填 0 并标 origin=template。',
};

const SHARED_HARDWARE = ['滑轨', '拉手', '三合一', '封边'] as const;

export const RULE_FAMILY_IDS = ['chest', 'desk', 'vanity', 'none'] as const;
export type RuleFamilyId = (typeof RULE_FAMILY_IDS)[number];

const RULE_FAMILIES: Record<RuleFamilyId, CategoryRule> = {
  chest: {
    structureSlots: ['侧板', '顶底板', '背板', '抽面', '抽侧', '抽后', '抽底', '前拉条', '背拉条', '落地拉条'],
    hardwareIfSeen: [...SHARED_HARDWARE],
    defaultLossRate: 0.08,
    pageHints: {
      notes: '抽屉底板厚度、滑轨规格写进标准，不要按抽屉数造结构件。「档条高度」不要拆成前拉条开料。',
      explosion: '数清抽屉组数、侧板片数；前拉条/正面拉条有标注件数则 origin=explicit；抽面按抽屉组列出。不要拆抽侧/抽后/抽底开料。滑轨按一抽一套。',
      size: '整柜 W×D×H 必抽；尺寸图只输出抽面开料（origin=explicit），数字以图面标注为准，不要按柜宽÷列数改写。抽侧/抽后/抽底不要输出。',
    },
  },
  desk: {
    structureSlots: ['桌面', '侧板', '横撑', '抽面', '抽侧', '抽底'],
    hardwareIfSeen: [...SHARED_HARDWARE],
    defaultLossRate: 0.08,
    pageHints: {
      size: '提取桌面板尺寸与板厚。',
      explosion: '数清抽屉组数、侧板片数；有挡板/横撑则列出。',
    },
  },
  vanity: {
    structureSlots: ['台面', '侧板', '抽面', '抽侧', '抽底'],
    hardwareIfSeen: [...SHARED_HARDWARE],
    defaultLossRate: 0.08,
    pageHints: {},
  },
  none: {
    structureSlots: [],
    hardwareIfSeen: [...SHARED_HARDWARE],
    defaultLossRate: 0.08,
    pageHints: {},
  },
};

/** 品类展示名 → 规则族。检测顺序：更具体的标签写在前面（床头柜先于床）。 */
export const COSTING_CATEGORY_CATALOG: ReadonlyArray<{
  label: string;
  familyId: RuleFamilyId;
  detect: RegExp | null;
}> = [
  { label: '床头柜', familyId: 'chest', detect: /床头柜|bedside|nightstand/i },
  { label: '梳妆台', familyId: 'vanity', detect: /梳妆台|dressing\s*table|vanity/i },
  { label: '斗柜', familyId: 'chest', detect: /斗柜|chest\s*of\s*drawers|\bdresser\b|\bchest\b/i },
  { label: '书桌', familyId: 'desk', detect: /书桌|writing\s*desk|\bdesk\b/i },
  { label: '桌子', familyId: 'desk', detect: /桌子|餐桌|dining\s*table/i },
  { label: '椅子', familyId: 'none', detect: /椅子|餐椅|\bchairs?\b/i },
  { label: '床', familyId: 'none', detect: /床|\bbeds?\b/i },
  { label: '其他', familyId: 'none', detect: null },
];

export const COSTING_PRODUCT_CATEGORIES = [
  '斗柜',
  '床头柜',
  '书桌',
  '桌子',
  '梳妆台',
  '床',
  '椅子',
  '其他',
] as const;

const CATEGORY_FAMILY_BY_LABEL = new Map(
  COSTING_CATEGORY_CATALOG.map((item) => [item.label, item.familyId] as const),
);

export function isConstructionType(value: string): value is ConstructionType {
  return (CONSTRUCTION_TYPES as readonly string[]).includes(value);
}

export function getRuleFamilyId(category: string | null | undefined): RuleFamilyId {
  if (!category) return 'none';
  return CATEGORY_FAMILY_BY_LABEL.get(category.trim()) ?? 'none';
}

export function getCategoryRule(category: string | null | undefined): CategoryRule {
  return RULE_FAMILIES[getRuleFamilyId(category)];
}

/** 是否套用柜体开料（盖板、侧板落地、抽盒公式）。由规则族决定，不写死品类名。 */
export function isChestCategory(category: string | null | undefined): boolean {
  return getRuleFamilyId(category) === 'chest';
}

export function detectCostingCategory(text: string): string | null {
  for (const item of COSTING_CATEGORY_CATALOG) {
    if (item.detect && item.detect.test(text)) return item.label;
  }
  return null;
}

export function canonicalMaterialName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return '';
  for (const [canonical, aliases] of Object.entries(MATERIAL_ALIASES)) {
    const keys = [canonical, ...aliases].map((item) => item.trim().toLowerCase());
    if (keys.includes(normalized)) return canonical;
  }
  return name.trim();
}

const BOARD_PART_NAME =
  /拉条|档条|踢脚|抽面|抽侧|抽后|抽底|侧板|顶底|背板|桌面|台面|底板|盖板|板/;
const HARDWARE_PART_NAME = /滑轨|拉手|螺丝|三合一|防倾倒/;
export const BOM_LINE_CATEGORIES = [
  '板材',
  '五金',
  '表面工艺',
  '包装',
  '加工',
  '其他',
] as const;

const BOM_CATEGORIES = new Set<string>(BOM_LINE_CATEGORIES);

/** 拉条/踢脚等结构件按名称归入板材，避免模型写成「其他/其他部件」。 */
export function inferBomLineCategory(materialName: string, category?: string | null): string {
  const name = canonicalMaterialName(materialName);
  if (HARDWARE_PART_NAME.test(name) && !/封边/.test(name)) return '五金';
  if (BOARD_PART_NAME.test(name) && !/封边/.test(name)) return '板材';
  const raw = category?.trim() ?? '';
  if (raw === '其他部件') return '其他';
  return BOM_CATEGORIES.has(raw) ? raw : '其他';
}

export function pageTaskForKind(pageType: string | null | undefined): string {
  if (!pageType) return PAGE_TASKS.unknown;
  return PAGE_TASKS[pageType as PageKind] ?? PAGE_TASKS.unknown;
}

export function formatCategoryRules(category: string | null | undefined): string {
  const rule = getCategoryRule(category);
  const lines = [
    `品类：${category?.trim() || '未指定'}`,
    rule.structureSlots.length
      ? `必有板件：${rule.structureSlots.join('、')}`
      : '必有板件：无（品类为其他或不识别时不补结构件）',
    `五金仅当图文出现才可列出：${rule.hardwareIfSeen.join('、')}；严禁编造未出现的五金`,
    `材料别名：${Object.entries(MATERIAL_ALIASES)
      .map(([canonical, aliases]) => `${aliases.join('/')}=${canonical}`)
      .join('；')}`,
    `默认损耗：板材 ${rule.defaultLossRate}`,
  ];
  return lines.join('\n');
}
