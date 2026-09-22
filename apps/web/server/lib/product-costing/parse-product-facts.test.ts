import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeProductFacts,
  parseLlmProductFacts,
  parseProductFacts,
} from './parse-product-facts.js';

describe('parseProductFacts', () => {
  it('reads chest category and drawer count', () => {
    const facts = parseProductFacts(['6抽斗柜 CHEST OF DRAWERS 颗粒板']);
    assert.equal(facts.category, '斗柜');
    assert.equal(facts.drawerCount, 6);
    assert.equal(facts.defaultSubstrate, '颗粒板');
    assert.equal(facts.structureSummary, null);
  });

  it('reads Chinese-numeral drawers and name from cover title', () => {
    const facts = parseProductFacts(['六抽菱形斗柜打样文件\n傲杰大件事业部']);
    assert.equal(facts.category, '斗柜');
    assert.equal(facts.drawerCount, 6);
    assert.equal(facts.productName, '六抽菱形斗柜');
  });

  it('reads category and drawers from the source file name', () => {
    const facts = parseProductFacts(['0416菱形斗柜6抽打样文件.pptx']);
    assert.equal(facts.category, '斗柜');
    assert.equal(facts.drawerCount, 6);
  });

  it('does not treat 桌面板 as 书桌 when the title already says 斗柜', () => {
    const facts = parseProductFacts([
      '六抽菱形斗柜打样文件',
      '板材厚度，背板默认为3mm，桌面板为15mm，其他无特别说明9mm。',
    ]);
    assert.equal(facts.category, '斗柜');
    assert.equal(facts.drawerCount, 6);
  });

  it('keeps title identity over a wrong LLM desk guess', () => {
    const title = parseProductFacts(['六抽菱形斗柜打样文件']);
    const llm = parseLlmProductFacts({
      category: '书桌',
      drawer_count: 0,
      structure_summary: '无抽屉设计。',
    });
    const merged = mergeProductFacts(title, llm ?? {});
    assert.equal(merged.category, '斗柜');
    assert.equal(merged.drawerCount, 6);
  });

  it('prefers 床头柜 over generic 柜', () => {
    assert.equal(parseProductFacts(['床头柜 Nightstand 2抽屉'])?.category, '床头柜');
    assert.equal(parseProductFacts(['床头柜 Nightstand 2抽屉'])?.drawerCount, 2);
  });

  it('reads desk without inventing drawers', () => {
    const facts = parseProductFacts(['书桌 DESK 多层实木板 板式']);
    assert.equal(facts.category, '书桌');
    assert.equal(facts.defaultSubstrate, '多层实木板');
    assert.equal(facts.constructionType, '板式');
    assert.equal(facts.drawerCount, null);
  });

  it('maps table/bed/chair titles onto catalog labels without stealing 床头柜', () => {
    assert.equal(parseProductFacts(['北欧餐桌 橡木'])?.category, '桌子');
    assert.equal(parseProductFacts(['实木双人床'])?.category, '床');
    assert.equal(parseProductFacts(['餐椅 两把'])?.category, '椅子');
    assert.equal(parseProductFacts(['床头柜 Nightstand'])?.category, '床头柜');
  });

  it('lets a new identification overwrite stale project fields', () => {
    const identified = mergeProductFacts(
      {
        category: '床头柜',
        constructionType: '板式',
        drawerCount: 2,
        defaultSubstrate: '多层实木板',
        carcassThicknessMm: 18,
        sideThicknessMm: 18,
      },
      {
        category: '斗柜',
        constructionType: '混合',
        drawerCount: 6,
        defaultSubstrate: '颗粒板',
        carcassThicknessMm: 25,
        sideThicknessMm: 25,
      },
    );
    assert.equal(identified.category, '床头柜');
    assert.equal(identified.drawerCount, 2);
    assert.equal(identified.defaultSubstrate, '多层实木板');
    assert.equal(identified.carcassThicknessMm, 18);
    assert.equal(identified.sideThicknessMm, 18);
  });

  it('does not overwrite already confirmed fields', () => {
    const merged = mergeProductFacts(
      {
        category: '书桌',
        constructionType: null,
        drawerCount: 3,
        defaultSubstrate: null,
      },
      {
        category: '斗柜',
        constructionType: '板式',
        drawerCount: 6,
        defaultSubstrate: '颗粒板',
      },
    );
    assert.equal(merged.category, '书桌');
    assert.equal(merged.constructionType, '板式');
    assert.equal(merged.drawerCount, 3);
    assert.equal(merged.defaultSubstrate, '颗粒板');
  });

  it('parses LLM product facts object and ignores BOM lines', () => {
    const facts = parseLlmProductFacts({
      product_name: '六抽菱形斗柜',
      category: '斗柜',
      drawer_count: 6,
      side_thickness_mm: 18,
      back_thickness_mm: 3,
      bottom_thickness_mm: 18,
      structure_summary: '侧板落地，顶板为盖板',
      design_principles: '抽侧长=柜深-50mm',
    });
    assert.equal(facts?.productName, '六抽菱形斗柜');
    assert.equal(facts?.category, '斗柜');
    assert.equal(facts?.structureSummary, '侧板落地，顶板为盖板');
    assert.equal(facts?.sideThicknessMm, 18);
    assert.equal(facts?.backThicknessMm, 3);
    assert.equal(facts?.bottomThicknessMm, 18);
    assert.equal(parseLlmProductFacts({ lines: [{ material_name: '侧板' }] }), null);
  });
});
