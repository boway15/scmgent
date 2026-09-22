import { frontRailCount, inferDrawerGrid } from './carcass-cut-rules.js';
import { getCategoryRule, getRuleFamilyId } from './category-rules.js';

export type ProductStructureFacts = {
  category?: string | null;
  constructionType?: string | null;
  drawerCount?: number | null;
  defaultSubstrate?: string | null;
  carcassThicknessMm?: number | null;
  drawerBottomThicknessMm?: number | null;
  sideThicknessMm?: number | null;
  backThicknessMm?: number | null;
  bottomThicknessMm?: number | null;
};

export type ProductStructureBrief = {
  title: string;
  summary: string;
  items: string[];
  slots: string[];
};

/** Human-readable structure + design-standard brief for step 1. No BOM / hardware. */
export function describeProductStructure(facts: ProductStructureFacts): ProductStructureBrief {
  const category = facts.category?.trim() || '';
  const drawers = typeof facts.drawerCount === 'number' ? facts.drawerCount : null;
  const rule = getCategoryRule(category || null);
  const slots = rule.structureSlots;
  const standards: string[] = [];
  if (facts.constructionType?.trim()) standards.push(`结构类型：${facts.constructionType.trim()}`);
  if (facts.defaultSubstrate?.trim()) standards.push(`默认基材：${facts.defaultSubstrate.trim()}`);
  if (facts.carcassThicknessMm) standards.push(`箱体默认厚度：${facts.carcassThicknessMm}mm`);
  if (facts.sideThicknessMm) standards.push(`侧板默认厚度：${facts.sideThicknessMm}mm`);
  if (facts.backThicknessMm) standards.push(`背板默认厚度：${facts.backThicknessMm}mm`);
  if (facts.bottomThicknessMm) standards.push(`底板默认厚度：${facts.bottomThicknessMm}mm`);
  if (facts.drawerBottomThicknessMm) standards.push(`抽底默认厚度：${facts.drawerBottomThicknessMm}mm`);
  else if (drawers && drawers > 0) standards.push('抽底默认厚度：文档未标明时按 9mm 作为设计标准推断');

  if (!category) {
    return {
      title: '待识别结构',
      summary: '请先上传设计方案。系统会从文档识别品类、抽屉数、基材等产品信息，再套用该类目设计标准。',
      items: standards,
      slots: [],
    };
  }

  const family = getRuleFamilyId(category || null);

  if (family === 'chest') {
    const rails = drawers == null ? null : frontRailCount(drawers);
    const grid = drawers == null ? null : inferDrawerGrid(drawers);
    const items = [
      '顶板为盖板：顶板长 = 柜宽，宽 = 柜深，盖住侧板。',
      '侧板落地：无整块底板；柜内宽方向两根 50mm 落地拉条。',
      drawers == null
        ? '前拉条：第二步爆炸图明示件数优先；未识别时按 ceil((抽屉数-2)/2) 预估（1–2 抽为 0）。'
        : `前拉条：爆炸图明示优先；未识别时抽屉数 ${drawers} → ${rails} 根（公式 ceil((n-2)/2)）。`,
      '抽盒：第二步只识别抽面；抽侧长 = 柜深 − 50mm；抽侧宽 = 抽面高 − 60mm；抽底长 = 抽侧长；抽底宽 = 抽面宽 − 45mm；抽后长 = 抽底宽；抽后高 = 抽侧宽；抽侧数量 = 抽屉数 × 2。',
      grid && drawers
        ? `抽屉布局按 ${grid.cols} 列 × ${grid.rows} 行推断（可用尺寸图抽面标注覆盖）。`
        : '抽屉布局在确认抽屉数后按网格推断。',
      '柜宽大于柜深时背板对开，并加一根背拉条。',
      ...standards,
    ];
    return {
      title: `${category}结构设计`,
      summary: '按斗柜/床头柜设计标准分析箱体与抽盒关系。滑轨、拉手、防倾倒等五金在第二步随物料清单识别，不在此补造。',
      items,
      slots,
    };
  }

  if (family === 'desk') {
    return {
      title: `${category}结构设计`,
      summary: '不套用侧板落地与前拉条。按桌面、侧板、横撑、抽盒槽位核对。五金在第二步按文档识别。',
      items: [
        '必核槽位：桌面、侧板、横撑；有抽屉则核抽面/抽侧/抽底。',
        drawers ? `文档抽屉数：${drawers}。` : '未识别到抽屉数时不按斗柜公式补拉条。',
        ...standards,
      ],
      slots,
    };
  }

  if (family === 'vanity') {
    return {
      title: `${category}结构设计`,
      summary: '不套用侧板落地与前拉条。按台面、侧板、抽盒核对。五金在第二步按文档识别。',
      items: [
        '必核槽位：台面、侧板；有抽盒则核抽面/抽侧/抽底。',
        drawers ? `文档抽屉数：${drawers}。` : '未识别到抽屉数时不强行补抽盒件数。',
        ...standards,
      ],
      slots,
    };
  }

  return {
    title: `${category || '其他'}结构设计`,
    summary: '未套用斗柜/床头柜默认落地与前拉条。结构件以文档明示为准，第二步再拆物料清单。',
    items: standards.length ? standards : ['请核对该品类在文档中的结构说明与板件关系。'],
    slots,
  };
}
