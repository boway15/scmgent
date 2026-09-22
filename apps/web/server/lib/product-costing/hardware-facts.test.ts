import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseHardwareFacts,
  upsertHardwareFacts,
  ensureAntiTipKit,
  ensureDrawerSlides,
  ensureScrewPack,
  isBundledOtherHardware,
} from './hardware-facts.js';
import type { CostingBomLineDraft } from './types.js';

const line = (overrides: Partial<CostingBomLineDraft> & Pick<CostingBomLineDraft, 'materialName'>): CostingBomLineDraft => ({
  category: '五金',
  spec: '',
  unit: '套',
  qtyNet: 0,
  lossRate: 0,
  sourceRef: '',
  confidence: 'low',
  origin: 'template',
  notes: '',
  ...overrides,
});

describe('parseHardwareFacts', () => {
  it('drops empty qty and unknown names', () => {
    assert.deepEqual(
      parseHardwareFacts([
        { name: '抽屉滑轨', spec: '12寸', qty: 6 },
        { name: '拉手', spec: '', qty: 0 },
        { name: '螺丝', spec: '', qty: 4 },
      ]),
      [{ name: '抽屉滑轨', spec: '12寸', qty: 6 }],
    );
  });

  it('does not keep 拉手 as a short-form hardware fact', () => {
    assert.deepEqual(parseHardwareFacts([{ name: '拉手', spec: '96mm', qty: 6 }]), []);
  });

  it('canonicalizes aliases', () => {
    assert.deepEqual(parseHardwareFacts([{ name: '滚珠滑轨', spec: '14寸', qty: 3 }]), [
      { name: '抽屉滑轨', spec: '14寸', qty: 3 },
    ]);
  });
});

describe('upsertHardwareFacts', () => {
  it('upserts hardware without inventing empty facts', () => {
    const lines = upsertHardwareFacts(
      [line({ materialName: '抽屉滑轨' })],
      [{ name: '抽屉滑轨', spec: '12寸', qty: 6 }],
    );
    assert.equal(lines[0]?.qtyNet, 6);
    assert.equal(lines[0]?.spec, '12寸');
    assert.match(lines[0]?.notes ?? '', /人工补全/);
    assert.equal(lines.length, 1);
  });
});

describe('ensureDrawerSlides', () => {
  it('adds one slide row per drawer for chest categories', () => {
    const lines = ensureDrawerSlides([line({ materialName: '侧板', category: '板材' })], {
      category: '斗柜',
      drawerCount: 9,
    });
    const slide = lines.find((row) => row.materialName === '抽屉滑轨');
    assert.equal(slide?.qtyNet, 9);
    assert.match(slide?.notes ?? '', /一抽一套滑轨/);
  });

  it('aligns overstated slide qty to drawer count', () => {
    const lines = ensureDrawerSlides(
      [line({ materialName: '滚珠滑轨', spec: '12寸', qtyNet: 12, origin: 'explicit' })],
      { category: '床头柜', drawerCount: 6 },
    );
    assert.equal(lines[0]?.materialName, '抽屉滑轨');
    assert.equal(lines[0]?.qtyNet, 6);
    assert.equal(lines[0]?.spec, '12寸');
  });

  it('skips non-chest categories', () => {
    const lines = ensureDrawerSlides([], { category: '书桌', drawerCount: 2 });
    assert.equal(lines.length, 0);
  });
});

describe('ensureAntiTipKit', () => {
  it('adds anti-tip row when document mentions it', () => {
    const lines = ensureAntiTipKit([], { category: '斗柜', seenInDoc: true });
    assert.equal(lines[0]?.materialName, '防倾倒配件');
    assert.equal(lines[0]?.qtyNet, 1);
  });

  it('skips when document has no anti-tip', () => {
    assert.equal(ensureAntiTipKit([], { category: '斗柜', seenInDoc: false }).length, 0);
  });
});

describe('ensureScrewPack', () => {
  it('adds one screw pack and does not treat it as bundled other hardware', () => {
    const lines = ensureScrewPack([]);
    assert.equal(lines[0]?.materialName, '螺丝包');
    assert.equal(lines[0]?.qtyNet, 1);
    assert.equal(lines[0]?.unit, '包');
    assert.equal(isBundledOtherHardware('螺丝包'), false);
    assert.equal(isBundledOtherHardware('螺丝'), true);
  });

  it('collapses template and explicit screw packs into one row', () => {
    const lines = ensureScrewPack([
      line({
        materialName: '螺丝包',
        unit: '包',
        qtyNet: 1,
        lossRate: 0,
        origin: 'template',
      }),
      line({
        materialName: '螺丝包',
        unit: '包',
        qtyNet: 1,
        lossRate: 0.08,
        origin: 'explicit',
        sourceRef: 'p5',
        confidence: 'high',
      }),
    ]);
    const packs = lines.filter((row) => row.materialName === '螺丝包');
    assert.equal(packs.length, 1);
    assert.equal(packs[0]?.qtyNet, 1);
    assert.equal(packs[0]?.lossRate, 0);
    assert.equal(packs[0]?.unit, '包');
    assert.match(packs[0]?.sourceRef ?? '', /p5/);
  });
});
