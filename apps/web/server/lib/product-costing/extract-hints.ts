import {
  formatCategoryRules,
  getCategoryRule,
  pageTaskForKind,
} from './category-rules.js';
import { formatOverallSize, type OverallSize } from './parse-overall-size.js';

export type ExtractHintInput = {
  category?: string | null;
  constructionType?: string | null;
  drawerCount?: number | null;
  defaultSubstrate?: string | null;
  overallSize?: OverallSize | null;
  pageType?: string | null;
  structureSummary?: string | null;
  designPrinciples?: string | null;
  priceBookNames?: string[];
  priorLines?: Array<{ materialName: string; spec: string; unit: string; qtyNet: number }>;
};

const MAX_PRICE_BOOK_NAMES = 80;
const MAX_HINTS_CHARS = 8000;

export function uniquePriceBookNames(
  entries: ReadonlyArray<{ materialName: string }>,
  limit = MAX_PRICE_BOOK_NAMES,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = entry.materialName.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

export function buildExtractHints(input: ExtractHintInput): string {
  const category = input.category?.trim() || '';
  const rule = getCategoryRule(category);
  const lines: string[] = [
    '【第一步已确认，拆物料必须遵守】以下品类、结构、抽屉数、基材、板厚、结构说明与拆料原则已由人工确认。爆炸图/尺寸图与之不一致时，以已确认为准，并在该行 notes 说明「按已确认结构设计」。禁止按未确认猜测改品类或补造结构件。',
  ];

  if (input.structureSummary?.trim()) {
    lines.push(`【已确认结构】${input.structureSummary.trim()}`);
  }
  if (input.designPrinciples?.trim()) {
    lines.push(`【已确认拆料原则】${input.designPrinciples.trim()}`);
  }

  lines.push(formatCategoryRules(category || null));

  if (input.constructionType?.trim()) {
    lines.push(`结构类型：${input.constructionType.trim()}`);
  }
  if (typeof input.drawerCount === 'number' && Number.isFinite(input.drawerCount)) {
    lines.push(`抽屉数：${input.drawerCount}`);
  }
  if (input.defaultSubstrate?.trim()) {
    lines.push(`默认基材：${input.defaultSubstrate.trim()}`);
  }
  if (input.overallSize) {
    lines.push(`外形尺寸：${formatOverallSize(input.overallSize)}`);
  }

  const pageType = input.pageType?.trim() || '';
  if (pageType) {
    const extra = rule.pageHints[pageType as keyof typeof rule.pageHints];
    const task = `${pageTaskForKind(pageType)}${extra ? ` ${extra}` : ''}`;
    lines.push(`【本页任务 page_type=${pageType}】${task}`);
  }

  lines.push(
    '【文档分工】设计说明页=板厚与默认标准；爆炸图页=零件名称、数量与五金；产品尺寸页=整柜 W×D×H + 抽面开料（名称必须是「抽面」）；抽侧/抽后/抽底由下游按规则计算，不要从图上拆。CMF/材质页只写基材与饰面，不要带抽面开料尺寸，避免与抽面重复。爆炸图上的小板开料不能当成整柜外形。封面「事业部/十七部」不是物料。',
  );

  const names = uniquePriceBookNames(
    (input.priceBookNames ?? []).map((materialName) => ({ materialName })),
  );
  if (names.length) {
    lines.push(`【价目标准名】材料名称请优先使用：${names.join('、')}`);
  }

  const prior = (input.priorLines ?? [])
    .filter((line) => line.materialName.trim())
    .slice(0, 40)
    .map(
      (line) =>
        `${line.materialName}|${line.spec || '-'}|${line.unit}|qty=${line.qtyNet}`,
    );
  if (prior.length) {
    lines.push(`【已拆清单，请连贯补全规格与数量，不要重复造行】\n${prior.join('\n')}`);
  }

  lines.push(
    '板材 spec 请写成「厚度 + 开料尺寸」，例如 18mm 1200×400。板件单位用张/块，不要用米。qty_net 为件数或张数，不要把面积写进名称。',
  );
  lines.push(
    '禁止输出「产品尺寸」物料行；「抽屉盖住/高度」不是物料。缺开料的抽面必须按尺寸图补 spec，名称用「抽面」，宽×高抄图面数字，禁止用柜宽÷列数推算。抽侧/抽后/抽底不要输出，由下游计算。滑轨数量按一抽一套。',
    '禁止把工艺说明或设计标准/设计规则拆成 BOM 行：不要输出「设计标准-抽屉滑轨」「设计规则-箱体板厚」等；胡桃/浮雕/木皮饰面只写 notes，不要输出物料行。',
    '五金同义词只输出一行：滚珠滑轨=抽屉滑轨、金属防倾倒装置=防倾倒配件；已拆清单里有的不要再重复造行。',
  );

  const text = lines.join('\n');
  return text.length > MAX_HINTS_CHARS ? `${text.slice(0, MAX_HINTS_CHARS)}\n…(截断)` : text;
}
