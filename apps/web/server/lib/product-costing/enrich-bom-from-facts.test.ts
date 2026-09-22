import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichBomFromProductFacts } from './enrich-bom-from-facts.js';
import type { CostingBomLineDraft } from './types.js';

const line = (overrides: Partial<CostingBomLineDraft> & Pick<CostingBomLineDraft, 'materialName'>): CostingBomLineDraft => ({
  category: '板材',
  spec: '',
  unit: '块',
  qtyNet: 0,
  lossRate: 0.08,
  sourceRef: '',
  confidence: 'low',
  origin: 'template',
  notes: '用量待补',
  ...overrides,
});

describe('enrichBomFromProductFacts', () => {
  it('fills panel cut size and counts from overall W×D×H and drawer count', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({ materialName: '侧板' }),
        line({ materialName: '背板' }),
        line({ materialName: '抽面' }),
        line({ materialName: '抽侧' }),
        line({ materialName: '抽屉滑轨', category: '五金', spec: '12寸', unit: '套', origin: 'explicit', confidence: 'high' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    const top = result.find((row) => row.materialName === '桌面板');
    assert.match(top?.spec ?? '', /15mm/);
    assert.match(top?.spec ?? '', /1200×400/);
    assert.equal(result.find((row) => row.materialName === '侧板')?.qtyNet, 2);
    assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /400×785/);
    assert.equal(result.find((row) => row.materialName === '背板')?.qtyNet, 2);
    assert.match(result.find((row) => row.materialName === '背板')?.spec ?? '', /600×785/);
    assert.equal(result.find((row) => row.materialName === '抽面')?.qtyNet, 6);
    assert.equal(result.find((row) => row.materialName === '抽侧')?.qtyNet, 12);
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /593×251/);
    assert.match(result.find((row) => row.materialName === '抽侧')?.spec ?? '', /350×191/);
    assert.match(result.find((row) => row.materialName === '抽后')?.spec ?? '', /548×191/);
    assert.equal(result.find((row) => row.materialName === '前拉条')?.qtyNet, 2);
    assert.equal(result.find((row) => row.materialName === '落地拉条')?.qtyNet, 2);
    assert.match(result.find((row) => row.materialName === '侧板')?.notes ?? '', /结构关系推算|由外形推算/);
  });

  it('keeps explosion front rail qty and rule-based inner width', () => {
    const result = enrichBomFromProductFacts(
      [
        line({
          materialName: '前拉条',
          spec: '12mm 1576×50',
          qtyNet: 4,
          origin: 'explicit',
          sourceRef: 'p4',
        }),
        line({
          materialName: '前拉条',
          spec: '12mm 1576×50',
          qtyNet: 4,
          origin: 'explicit',
          sourceRef: 'p4',
        }),
        line({
          materialName: '前拉条',
          spec: '12mm 1576×50',
          qtyNet: 4,
          origin: 'template',
        }),
        line({ materialName: '侧板', spec: '12mm 400×785', qtyNet: 2, origin: 'template' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        carcassThicknessMm: 18,
        sideThicknessMm: 9,
      },
    );
    const rails = result.filter((row) => row.materialName === '前拉条');
    assert.equal(rails.length, 1);
    assert.match(rails[0]?.spec ?? '', /18mm 1182×50/);
    assert.equal(rails[0]?.qtyNet, 4);
    assert.equal(rails[0]?.origin, 'explicit');
    assert.doesNotMatch(rails[0]?.spec ?? '', /1576/);
  });

  it('caps overstated slide count to drawer count', () => {
    const result = enrichBomFromProductFacts(
      [
        line({
          materialName: '抽屉滑轨',
          category: '五金',
          spec: '12寸',
          unit: '套',
          qtyNet: 2,
          origin: 'explicit',
          confidence: 'high',
        }),
      ],
      { overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 }, drawerCount: 6 },
    );
    assert.equal(result[0]?.qtyNet, 6);
  });

  it('does not treat explosion particle-board cuts as the cabinet overall', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0, origin: 'explicit' }),
        line({
          materialName: '颗粒板',
          spec: '18mm 600×400',
          unit: '张',
          qtyNet: 2,
          origin: 'explicit',
          confidence: 'high',
        }),
        line({
          materialName: '颗粒板',
          spec: '18mm 400×300',
          unit: '张',
          qtyNet: 4,
          origin: 'explicit',
          confidence: 'high',
        }),
        line({ materialName: '侧板' }),
      ],
      { category: '斗柜', drawerCount: 6 },
    );
    assert.equal(result.find((row) => row.materialName === '侧板')?.qtyNet, 0);
    assert.equal(result.find((row) => row.materialName === '侧板')?.spec, '');
  });

  it('uses size-page overall and notes-page carcass thickness, not decorative 9mm', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0, origin: 'explicit' }),
        line({ materialName: '浮雕黑色板', spec: '5mm', unit: '张', qtyNet: 0, origin: 'explicit' }),
        line({
          materialName: '颗粒板',
          spec: '18mm 600×400',
          unit: '张',
          qtyNet: 2,
          origin: 'explicit',
        }),
        line({ materialName: '侧板' }),
        line({ materialName: '抽面' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    const side = result.find((row) => row.materialName === '侧板');
    assert.equal(side?.qtyNet, 2);
    assert.match(side?.spec ?? '', /18mm/);
    assert.match(side?.spec ?? '', /400×785/);
    assert.equal(result.find((row) => row.materialName === '抽面')?.qtyNet, 6);
    assert.equal(result.find((row) => row.materialName === '落地拉条')?.qtyNet, 2);
    assert.equal(result.find((row) => row.materialName === '胡桃色板')?.qtyNet, 0);
    assert.equal(
      result.some((row) => /^(颗粒板|密度板)$/.test(row.materialName)),
      false,
    );
  });

  it('does not overwrite an already sized quantity', () => {
    const result = enrichBomFromProductFacts(
      [line({ materialName: '侧板', spec: '18mm 380×760', qtyNet: 2, origin: 'explicit' })],
      { overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 }, drawerCount: 6 },
    );
    assert.match(result[0]?.spec ?? '', /18mm 400×785/);
    assert.equal(result[0]?.qtyNet, 2);
  });

  it('ignores kick profile height when inferring carcass thickness', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({ materialName: '踢脚线', category: '板材', spec: '60mm', unit: '米', qtyNet: 0, origin: 'explicit' }),
        line({ materialName: '侧板' }),
        line({ materialName: '顶底板' }),
        line({ materialName: '抽面' }),
      ],
      {
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /15mm 400×785/);
    assert.match(result.find((row) => row.materialName === '顶底板')?.spec ?? '', /15mm 1200×400/);
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /593×231/);
  });

  it('defaults back panel to 3mm and ignores decorative veneer thickness', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0, origin: 'explicit', confidence: 'high' }),
        line({ materialName: '浮雕黑色板', spec: '5mm', unit: '张', qtyNet: 0, origin: 'explicit', confidence: 'high' }),
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({ materialName: '背板' }),
      ],
      {
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    assert.match(result.find((row) => row.materialName === '背板')?.spec ?? '', /3mm 600×785/);
    assert.equal(result.find((row) => row.materialName === '背板')?.qtyNet, 2);
  });

  it('keeps explicit drawer-front size and computes 抽侧/抽底 from rules', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({
          materialName: '抽面',
          spec: '598×210',
          unit: '块',
          qtyNet: 0,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p7',
        }),
        line({ materialName: '抽侧', spec: '382×159', origin: 'explicit', confidence: 'high', sourceRef: 'p7' }),
        line({ materialName: '抽后', spec: '400×200', origin: 'explicit', confidence: 'high', sourceRef: 'p7' }),
        line({ materialName: '抽底', spec: '382×400', origin: 'explicit', confidence: 'high', sourceRef: 'p7' }),
      ],
      {
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /598×210/);
    assert.match(result.find((row) => row.materialName === '抽侧')?.spec ?? '', /350×150/);
    assert.equal(result.find((row) => row.materialName === '抽侧')?.qtyNet, 12);
    assert.match(result.find((row) => row.materialName === '抽底')?.spec ?? '', /350×553/);
    assert.equal(result.find((row) => row.materialName === '抽底')?.qtyNet, 6);
    assert.match(result.find((row) => row.materialName === '抽后')?.spec ?? '', /553×150/);
    assert.doesNotMatch(result.find((row) => row.materialName === '抽面')?.spec ?? '', /1200×121/);
  });

  it('keeps p7 抽面 521×210 instead of grid-sized 598×210', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({
          materialName: '抽面',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 6,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p7',
        }),
        line({
          materialName: '颗粒板',
          spec: '18mm 598×210',
          unit: '张',
          qtyNet: 6,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p7',
        }),
        line({ materialName: '抽底', spec: '', qtyNet: 0, origin: 'template' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        carcassThicknessMm: 12,
        sideThicknessMm: 12,
      },
    );
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /521×210/);
    assert.doesNotMatch(result.find((row) => row.materialName === '抽面')?.spec ?? '', /598×/);
    assert.match(result.find((row) => row.materialName === '抽底')?.spec ?? '', /350×476/);
  });

  it('uses size-page 598×210 even when Dify named it 颗粒板 and 抽面 is grid-filled', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({
          materialName: '颗粒板',
          spec: '18mm 598×210',
          unit: '张',
          qtyNet: 9,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p7,p5',
        }),
        line({
          materialName: '密度板',
          spec: '18mm 598×210',
          unit: '张',
          qtyNet: 6,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p6',
        }),
        line({
          materialName: '抽面',
          spec: '12mm 529×251',
          unit: '块',
          qtyNet: 9,
          origin: 'template',
        }),
        line({ materialName: '抽侧', spec: '12mm 350×191', qtyNet: 18, origin: 'template' }),
      ],
      {
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
      },
    );
    const fronts = result.filter((row) => row.materialName === '抽面');
    assert.equal(fronts.length, 1);
    assert.match(fronts[0]?.spec ?? '', /598×210/);
    assert.equal(fronts[0]?.qtyNet, 6);
    assert.equal(
      result.some(
        (row) =>
          /^(颗粒板|密度板)$/.test(row.materialName) && /598\s*[x×]\s*210/.test(row.spec),
      ),
      false,
    );
    assert.match(result.find((row) => row.materialName === '抽侧')?.spec ?? '', /350×150/);
    assert.equal(result.find((row) => row.materialName === '抽侧')?.qtyNet, 12);
  });

  it('replaces implausible full-width drawer front from explosion with grid size', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '桌面板', spec: '15mm', unit: '张', qtyNet: 1, origin: 'explicit', confidence: 'high' }),
        line({
          materialName: '抽面',
          spec: '18mm 1600×87',
          unit: '块',
          qtyNet: 9,
          origin: 'explicit',
          confidence: 'high',
          sourceRef: 'p5',
        }),
      ],
      {
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
      },
    );
    const front = result.find((row) => row.materialName === '抽面')?.spec ?? '';
    assert.match(front, /\d+×251/);
    assert.doesNotMatch(front, /1600×87/);
  });

  it('does not add floor rails for desk', () => {
    const result = enrichBomFromProductFacts(
      [line({ materialName: '桌面' }), line({ materialName: '侧板' })],
      { category: '书桌', overallSize: { widthMm: 1200, depthMm: 600, heightMm: 750 }, drawerCount: 2 },
    );
    assert.equal(result.some((row) => row.materialName === '落地拉条'), false);
    assert.equal(result.some((row) => row.materialName === '前拉条'), false);
  });

  it('uses short-form carcass thickness', () => {
    const result = enrichBomFromProductFacts(
      [line({ materialName: '侧板' })],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        carcassThicknessMm: 18,
      },
    );
    assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /18mm/);
  });

  it('overwrites extracted 18mm with confirmed short-form thicknesses including 3mm bottom', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '侧板', spec: '18mm 400×785', qtyNet: 2, origin: 'explicit' }),
        line({ materialName: '背板', spec: '18mm', qtyNet: 0, origin: 'template' }),
        line({ materialName: '抽底', spec: '18mm', qtyNet: 0, origin: 'template' }),
        line({ materialName: '落地拉条', spec: '18mm', qtyNet: 0, origin: 'template' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        carcassThicknessMm: 12,
        sideThicknessMm: 12,
        backThicknessMm: 3,
        bottomThicknessMm: 3,
        drawerBottomThicknessMm: 9,
      },
    );
    assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /^12mm /);
    assert.match(result.find((row) => row.materialName === '背板')?.spec ?? '', /^3mm /);
    assert.match(result.find((row) => row.materialName === '抽底')?.spec ?? '', /^9mm /);
    assert.match(result.find((row) => row.materialName === '落地拉条')?.spec ?? '', /^3mm /);
    assert.ok((result.find((row) => row.materialName === '抽底')?.qtyNet ?? 0) > 0);
  });

  it('absorbs leftover 颗粒板 rows into named cuts and fills empty templates', () => {
    const result = enrichBomFromProductFacts(
      [
        line({ materialName: '侧板' }),
        line({ materialName: '顶底板' }),
        line({ materialName: '背板' }),
        line({
          materialName: '抽后',
          spec: '12mm 476×150',
          qtyNet: 9,
          origin: 'explicit',
        }),
        line({
          materialName: '背拉条',
          spec: '12mm 1576×50',
          unit: '根',
          qtyNet: 1,
          origin: 'explicit',
        }),
        line({
          materialName: '颗粒板',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 9,
          origin: 'explicit',
          sourceRef: 'p5',
        }),
        line({
          materialName: '颗粒板',
          spec: '12mm 1576×50',
          unit: '根',
          qtyNet: 4,
          origin: 'explicit',
          sourceRef: 'p5',
        }),
        line({
          materialName: '颗粒板',
          spec: '12mm 476×150',
          unit: '块',
          qtyNet: 9,
          origin: 'explicit',
          sourceRef: 'p5',
        }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
        carcassThicknessMm: 12,
        sideThicknessMm: 12,
        backThicknessMm: 3,
      },
    );
    assert.equal(result.some((row) => row.materialName === '颗粒板'), false);
    assert.match(result.find((row) => row.materialName === '侧板')?.spec ?? '', /400×785/);
    assert.ok((result.find((row) => row.materialName === '侧板')?.qtyNet ?? 0) > 0);
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /521×210/);
  });
});
