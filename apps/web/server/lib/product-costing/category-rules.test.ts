import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalMaterialName,
  COSTING_PRODUCT_CATEGORIES,
  formatCategoryRules,
  getCategoryRule,
  getRuleFamilyId,
  inferBomLineCategory,
  isChestCategory,
  pageTaskForKind,
} from './category-rules.js';

describe('rule family mapping', () => {
  it('maps multiple chest labels onto the same family and cut gate', () => {
    assert.equal(getRuleFamilyId('斗柜'), 'chest');
    assert.equal(getRuleFamilyId('床头柜'), 'chest');
    assert.equal(isChestCategory('斗柜'), true);
    assert.equal(isChestCategory('床头柜'), true);
    assert.deepEqual(getCategoryRule('斗柜').structureSlots, getCategoryRule('床头柜').structureSlots);
  });

  it('maps 桌子 onto the desk family without chest cuts', () => {
    assert.equal(getRuleFamilyId('书桌'), 'desk');
    assert.equal(getRuleFamilyId('桌子'), 'desk');
    assert.equal(isChestCategory('桌子'), false);
    assert.deepEqual(getCategoryRule('桌子').structureSlots, getCategoryRule('书桌').structureSlots);
  });

  it('maps 床 and 椅子 onto none so they do not get chest slots', () => {
    assert.equal(getRuleFamilyId('床'), 'none');
    assert.equal(getRuleFamilyId('椅子'), 'none');
    assert.deepEqual(getCategoryRule('床').structureSlots, []);
    assert.deepEqual(getCategoryRule('椅子').structureSlots, []);
    assert.equal(isChestCategory('床'), false);
  });

  it('lists selectable categories including future families mapped to none/desk', () => {
    assert.deepEqual(COSTING_PRODUCT_CATEGORIES, [
      '斗柜',
      '床头柜',
      '书桌',
      '桌子',
      '梳妆台',
      '床',
      '椅子',
      '其他',
    ]);
  });
});

describe('getCategoryRule', () => {
  it('returns desk structure slots without fabricating hardware', () => {
    const rule = getCategoryRule('书桌');
    assert.deepEqual(rule.structureSlots, ['桌面', '侧板', '横撑', '抽面', '抽侧', '抽底']);
    assert.ok(rule.hardwareIfSeen.includes('滑轨'));
  });

  it('returns empty structure slots for unknown categories', () => {
    assert.deepEqual(getCategoryRule('其他').structureSlots, []);
    assert.deepEqual(getCategoryRule(null).structureSlots, []);
  });
});

describe('canonicalMaterialName', () => {
  it('maps common board aliases to the purchase name', () => {
    assert.equal(canonicalMaterialName('中纤板'), '密度板');
    assert.equal(canonicalMaterialName('MDF'), '密度板');
    assert.equal(canonicalMaterialName('刨花板'), '颗粒板');
    assert.equal(canonicalMaterialName('多层板'), '多层实木板');
    assert.equal(canonicalMaterialName('滚珠滑轨'), '抽屉滑轨');
    assert.equal(canonicalMaterialName('把手'), '拉手');
    assert.equal(canonicalMaterialName('正面拉条'), '前拉条');
    assert.equal(canonicalMaterialName('背部拉条'), '背拉条');
  });

  it('keeps unknown names unchanged', () => {
    assert.equal(canonicalMaterialName('  滑轨  '), '滑轨');
  });
});

describe('inferBomLineCategory', () => {
  it('classifies rails as 板材 instead of 其他部件', () => {
    assert.equal(inferBomLineCategory('正面拉条', '其他部件'), '板材');
    assert.equal(inferBomLineCategory('前拉条', '其他'), '板材');
    assert.equal(inferBomLineCategory('抽屉滑轨', '其他'), '五金');
  });
});

describe('formatCategoryRules', () => {
  it('includes required boards and a no-invent-hardware rule', () => {
    const text = formatCategoryRules('书桌');
    assert.match(text, /必有板件：桌面、侧板、横撑/);
    assert.match(text, /严禁编造未出现的五金/);
    assert.match(text, /中纤板\/MDF\/中密度纤维板=密度板|中纤板/);
  });
});

describe('pageTaskForKind', () => {
  it('gives each page a document-role task', () => {
    assert.match(pageTaskForKind('size'), /整柜外形/);
    assert.match(pageTaskForKind('size'), /只识别抽面/);
    assert.match(pageTaskForKind('explosion'), /物料清单/);
    assert.match(pageTaskForKind('notes'), /板厚|默认标准/);
  });
});
