import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyFactsToLines, prepareBomLinesForApplyFacts } from './apply-facts.js';
import { finalizeExtractedLines } from './merge-lines.js';

const ZHL0_FACTS = {
  category: '斗柜',
  drawerCount: 9,
  structureSummary: '成品尺寸约 W1600×D400×H785。九抽斗柜。',
  designPrinciples: '以W1600×D400×H785为外部尺寸依据；抽屉底板为5mm',
  carcassThicknessMm: 12,
  sideThicknessMm: 12,
  backThicknessMm: 5,
  drawerBottomThicknessMm: 5,
  bottomThicknessMm: 5,
  defaultSubstrate: '密度板',
  overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
} as const;

const ZHL0_EXTRACT = [
  { category: '其他', materialName: '密度板', spec: '', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p6', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '胡桃色板', spec: '18mm', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p6', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '浮雕黑色板', spec: '18mm', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p6', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '设计标准-抽屉底板', spec: '5mm', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '浮雕黑色板', spec: '5mm', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '五金', materialName: '设计标准-抽屉滑轨', spec: '2节12寸滚珠滑轨', unit: '套', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '五金', materialName: '设计标准-抽屉面板斜切拉手', spec: '45度', unit: '套', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '表面工艺', materialName: '油漆', spec: '黑色喷漆', unit: '升', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
];

const CM5F_EXTRACT = [
  { category: '板材', materialName: '密度板', spec: '18mm 宽×高, 如抽面开料', unit: '张', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '抽屉底板厚度标准', spec: '抽屉底板用5mm板', unit: '项', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '板材', materialName: '抽屉结构标准', spec: '9mm胡桃+5mm浮雕', unit: '项', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '五金', materialName: '抽屉滑轨规格标准', spec: '2节12寸滚珠滑轨', unit: '套', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
  { category: '表面工艺', materialName: '喷漆', spec: '黑色板边缘喷漆处理', unit: '项', qtyNet: 0, lossRate: 0.08, sourceRef: 'p4', confidence: 'high' as const, origin: 'explicit' as const, notes: '' },
];

const CM5F_FACTS = {
  category: '斗柜',
  drawerCount: 9,
  structureSummary: '整体尺寸约 W1600×D400×H785 mm。九个抽屉。',
  carcassThicknessMm: 12,
  sideThicknessMm: 12,
  backThicknessMm: 5,
  defaultSubstrate: '密度板',
  overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
} as const;

describe('applyFactsToLines idempotency (ZHL0)', () => {
  it('first apply without category template slots still fills full chest', () => {
    const { overallSize: _drop, ...factsNoPageSize } = ZHL0_FACTS;
    const first = applyFactsToLines(ZHL0_EXTRACT, factsNoPageSize);
    const boards = first.filter((line) => line.category === '板材' && line.qtyNet > 0);
    assert.ok(boards.some((line) => line.materialName === '侧板'), '侧板');
    assert.ok(boards.some((line) => line.materialName === '顶底板'), '顶底板');
    assert.ok(boards.length >= 8, `got ${boards.map((l) => l.materialName).join(', ')}`);
    assert.equal(first.some((line) => /设计标准/.test(line.materialName)), false);
  });

  it('first apply without page overallSize still fills structure from structureSummary', () => {
    const extracted = finalizeExtractedLines('斗柜', ZHL0_EXTRACT, ZHL0_FACTS);
    const { overallSize: _drop, ...factsNoPageSize } = ZHL0_FACTS;
    const first = applyFactsToLines(extracted, factsNoPageSize);
    const boards = first.filter((line) => line.category === '板材' && line.qtyNet > 0);
    assert.ok(boards.some((line) => line.materialName === '侧板'), '侧板');
    assert.ok(boards.length >= 8, `expected full chest, got ${boards.map((l) => l.materialName).join(', ')}`);
  });

  it('first apply fills full chest structure from extract-only decorative rows', () => {
    const extracted = finalizeExtractedLines('斗柜', ZHL0_EXTRACT, ZHL0_FACTS);
    const first = applyFactsToLines(extracted, ZHL0_FACTS);
    const boards = first.filter((line) => line.category === '板材');
    assert.ok(boards.some((line) => line.materialName === '侧板' && line.qtyNet > 0), '侧板');
    assert.ok(boards.some((line) => line.materialName === '顶底板' && line.qtyNet > 0), '顶底板');
    assert.ok(boards.some((line) => line.materialName === '背板' && line.qtyNet > 0), '背板');
    assert.ok(boards.some((line) => line.materialName === '抽面' && line.qtyNet > 0), '抽面');
    const bad = first.filter((line) => /设计标准|胡桃色板|浮雕黑色/.test(line.materialName));
    assert.equal(bad.length, 0, `unexpected decorative rows: ${bad.map((l) => l.materialName).join(', ')}`);
    const second = applyFactsToLines(first, ZHL0_FACTS);
    assert.deepEqual(
      second.filter((line) => line.category === '板材').map((line) => line.materialName).sort(),
      first.filter((line) => line.category === '板材').map((line) => line.materialName).sort(),
    );
  });

  it('second apply after prepare resets template cuts without duplicating board rows', () => {
    const extracted = finalizeExtractedLines('斗柜', ZHL0_EXTRACT, ZHL0_FACTS);
    const first = applyFactsToLines(extracted, ZHL0_FACTS);
    const prepared = prepareBomLinesForApplyFacts(
      first.map((line) => ({
        category: line.category,
        materialName: line.materialName,
        spec: line.spec,
        unit: line.unit,
        qtyNet: line.qtyNet,
        lossRate: line.lossRate,
        sourceRef: line.sourceRef,
        confidence: line.confidence,
        origin: line.origin,
        notes: line.notes,
        substrate: line.substrate ?? null,
        processOverrides: line.processOverrides ?? {},
        isManual: false,
        extractSnapshot: {
          materialName: line.materialName,
          spec: line.spec || null,
          qtyNet: line.qtyNet,
          origin: line.origin,
          sourceRef: line.sourceRef || null,
        },
      })),
    );
    const second = applyFactsToLines(prepared, ZHL0_FACTS);
    const firstBoardNames = first.filter((line) => line.category === '板材').map((line) => line.materialName).sort();
    const secondBoardNames = second.filter((line) => line.category === '板材').map((line) => line.materialName).sort();
    assert.deepEqual(secondBoardNames, firstBoardNames);
    assert.equal(second.some((line) => /设计标准|设计规则|胡桃色板/.test(line.materialName)), false);
  });
});
