import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyFactsToLines, preserveMissingExplicitBoardLines, prepareBomLinesForApplyFacts } from './apply-facts.js';
import { boxSurfaceM2, foamVolumeM3 } from './packaging-facts.js';
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
  notes: '',
  ...overrides,
});

const PANEL = {
  carcassThicknessMm: 18,
  sideThicknessMm: 18,
  backThicknessMm: 3,
  bottomThicknessMm: 18,
  drawerBottomThicknessMm: 9,
} as const;

describe('preserveMissingExplicitBoardLines', () => {
  it('re-appends explicit sized board rows dropped by downstream merge', () => {
    const source = [
      line({ materialName: '侧板', spec: '12mm 400×785', qtyNet: 2, origin: 'explicit' }),
      line({ materialName: '顶底板', spec: '12mm 1600×400', qtyNet: 1, origin: 'explicit' }),
    ];
    const next = [line({ materialName: '顶底板', spec: '12mm 1600×400', qtyNet: 1, origin: 'explicit' })];
    const result = preserveMissingExplicitBoardLines(source, next);
    assert.equal(result.length, 2);
    assert.ok(result.some((row) => row.materialName === '侧板'));
  });
});

describe('prepareBomLinesForApplyFacts', () => {
  it('drops prior template cuts and reverts kept rows to extract snapshot', () => {
    const prepared = prepareBomLinesForApplyFacts([
      {
        category: '板材',
        materialName: '背拉条',
        spec: '12mm 1576×50',
        unit: '根',
        qtyNet: 1,
        lossRate: 0.08,
        sourceRef: '',
        confidence: 'medium',
        origin: 'template',
        notes: '由结构关系推算',
        substrate: '密度板',
        processOverrides: {},
        isManual: false,
        extractSnapshot: {
          materialName: '背部拉条',
          spec: '',
          qtyNet: 0,
          origin: 'explicit',
          sourceRef: 'p2',
        },
      },
      {
        category: '包装',
        materialName: '纸箱',
        spec: '1.2m²',
        unit: '个',
        qtyNet: 1,
        lossRate: 0,
        sourceRef: '',
        confidence: 'medium',
        origin: 'template',
        notes: '',
        substrate: null,
        processOverrides: {},
        isManual: false,
        extractSnapshot: null,
      },
      {
        category: '板材',
        materialName: '背部拉条',
        spec: '',
        unit: '根',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: 'p2',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
        substrate: null,
        processOverrides: {},
        isManual: false,
        extractSnapshot: {
          materialName: '背部拉条',
          spec: '',
          qtyNet: 0,
          origin: 'explicit',
          sourceRef: 'p2',
        },
      },
    ]);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0]?.materialName, '背拉条');
    assert.equal(prepared[0]?.qtyNet, 0);
    assert.equal(prepared[0]?.notes, '');
  });

  it('keeps manual rows unchanged', () => {
    const prepared = prepareBomLinesForApplyFacts([
      {
        category: '五金',
        materialName: '抽屉滑轨',
        spec: '12寸',
        unit: '套',
        qtyNet: 9,
        lossRate: 0,
        sourceRef: '手工',
        confidence: 'high',
        origin: 'explicit',
        notes: '人工补',
        substrate: null,
        processOverrides: {},
        isManual: true,
        extractSnapshot: null,
      },
    ]);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0]?.materialName, '抽屉滑轨');
    assert.equal(prepared[0]?.notes, '人工补');
  });

  it('drops design-rule placeholders when resetting for apply', () => {
    const prepared = prepareBomLinesForApplyFacts([
      {
        category: '板材',
        materialName: '设计规则-箱体板厚',
        spec: '除特别说明外板材厚',
        unit: '张',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: 'p2',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
        substrate: '密度板',
        processOverrides: {},
        isManual: false,
        extractSnapshot: {
          materialName: '设计规则-箱体板厚',
          spec: '除特别说明外板材厚',
          qtyNet: 0,
          origin: 'explicit',
          sourceRef: 'p2',
        },
      },
      {
        category: '板材',
        materialName: '抽面',
        spec: '',
        unit: '块',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: 'p3',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
        substrate: null,
        processOverrides: {},
        isManual: false,
        extractSnapshot: {
          materialName: '抽面',
          spec: '',
          qtyNet: 0,
          origin: 'explicit',
          sourceRef: 'p3',
        },
      },
    ]);
    assert.deepEqual(
      prepared.map((row) => row.materialName),
      ['抽面'],
    );
  });
});

describe('applyFactsToLines', () => {
  it('enriches chest cuts then upserts short-form hardware', () => {
    const result = applyFactsToLines(
      [line({ materialName: '侧板' }), line({ materialName: '抽侧' })],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        ...PANEL,
        hardwareFacts: [{ name: '抽屉滑轨', spec: '12寸', qty: 6 }],
      },
    );
    assert.match(result.find((row) => row.materialName === '抽侧')?.spec ?? '', /350×/);
    const slide = result.find((row) => row.materialName === '抽屉滑轨');
    assert.equal(slide?.qtyNet, 6);
    assert.match(slide?.notes ?? '', /人工补全/);
    assert.equal(result.find((row) => row.materialName === '螺丝包')?.qtyNet, 1);
    const outer = { widthMm: 1280, depthMm: 480, heightMm: 865 };
    assert.equal(result.find((row) => row.materialName === '保利龙')?.qtyNet, foamVolumeM3(outer));
    assert.equal(result.find((row) => row.materialName === '保利龙')?.unit, 'm³');
    assert.equal(result.find((row) => row.materialName === '纸箱')?.qtyNet, boxSurfaceM2(outer));
    assert.equal(result.find((row) => row.materialName === '纸箱')?.unit, 'm²');
  });

  it('auto-adds drawer slides from drawer count without hardware facts', () => {
    const result = applyFactsToLines(
      [line({ materialName: '侧板' }), line({ materialName: '抽面' })],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
        designPrinciples: '滑轨采用2节12寸滚珠滑轨',
        ...PANEL,
      },
    );
    const slide = result.find((row) => row.materialName === '抽屉滑轨');
    assert.equal(slide?.qtyNet, 9);
    assert.match(slide?.spec ?? '', /2节12寸/);
    assert.match(slide?.notes ?? '', /一抽一套滑轨/);
    assert.match(slide?.notes ?? '', /规格来自设计说明/);
  });

  it('auto-adds slide and anti-tip from PPT page texts', () => {
    const result = applyFactsToLines(
      [line({ materialName: '侧板' }), line({ materialName: '抽面' })],
      {
        category: '斗柜',
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
        pageTexts: ['2\n节\n12\n寸滚珠滑轨', '金属防倾倒装置'],
        ...PANEL,
      },
    );
    const slide = result.find((row) => row.materialName === '抽屉滑轨');
    const tip = result.find((row) => row.materialName === '防倾倒配件');
    assert.equal(slide?.qtyNet, 9);
    assert.match(slide?.spec ?? '', /12\s*寸/);
    assert.equal(tip?.qtyNet, 1);
  });

  it('fills board 材质 from project default, 背板/抽底 as 密度板', () => {
    const result = applyFactsToLines(
      [
        line({ materialName: '侧板' }),
        line({ materialName: '背板' }),
        line({ materialName: '抽底' }),
        line({
          materialName: '抽面',
          spec: '12mm 521×210',
          qtyNet: 6,
          origin: 'explicit',
          confidence: 'high',
          substrate: '多层实木板',
        }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        defaultSubstrate: '颗粒板',
        ...PANEL,
      },
    );
    assert.equal(result.find((row) => row.materialName === '侧板')?.substrate, '颗粒板');
    assert.equal(result.find((row) => row.materialName === '背板')?.substrate, '密度板');
    assert.equal(result.find((row) => row.materialName === '抽底')?.substrate, '密度板');
    assert.equal(result.find((row) => row.materialName === '抽面')?.substrate, '多层实木板');
  });

  it('fills 抽底 and rails from overall size even if some project thicknesses are still empty', () => {
    const result = applyFactsToLines(
      [
        line({ materialName: '抽侧', spec: '' }),
        line({ materialName: '抽底', spec: '18mm', qtyNet: 0 }),
        line({ materialName: '前拉条', spec: '18mm', qtyNet: 0, unit: '根' }),
        line({ materialName: '背拉条', spec: '18mm', qtyNet: 0, unit: '根' }),
        line({ materialName: '落地拉条', spec: '18mm', qtyNet: 0, unit: '根' }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 6,
        carcassThicknessMm: 18,
      },
    );
    assert.match(result.find((row) => row.materialName === '抽底')?.spec ?? '', /\d+×\d+/);
    assert.ok((result.find((row) => row.materialName === '抽底')?.qtyNet ?? 0) > 0);
    assert.match(result.find((row) => row.materialName === '前拉条')?.spec ?? '', /\d+×\d+/);
    assert.ok((result.find((row) => row.materialName === '前拉条')?.qtyNet ?? 0) > 0);
    assert.match(result.find((row) => row.materialName === '落地拉条')?.spec ?? '', /\d+×\d+/);
    assert.equal(result.find((row) => row.materialName === '落地拉条')?.qtyNet, 2);
  });

  it('replaces LLM foam volume with six-face 20mm packaging', () => {
    const result = applyFactsToLines(
      [
        line({
          category: '包装',
          materialName: '保利龙',
          spec: '外径 1680×480×865 mm',
          unit: 'm³',
          qtyNet: 0.6975,
          origin: 'explicit',
        }),
        line({
          category: '包装',
          materialName: '纸箱',
          spec: '1680×480×865',
          unit: '个',
          qtyNet: 1,
          origin: 'explicit',
        }),
      ],
      {
        category: '斗柜',
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
      },
    );
    const outer = { widthMm: 1680, depthMm: 480, heightMm: 865 };
    const foam = result.find((row) => row.materialName === '保利龙');
    assert.equal(foam?.qtyNet, foamVolumeM3(outer));
    assert.equal(foam?.unit, 'm³');
    assert.ok((foam?.qtyNet ?? 1) < 0.2);
    assert.equal(result.filter((row) => row.category === '包装' && /保利龙/.test(row.materialName)).length, 1);
    assert.equal(result.find((row) => row.materialName === '纸箱')?.unit, 'm²');
    assert.equal(result.find((row) => row.materialName === '纸箱')?.qtyNet, boxSurfaceM2(outer));
  });

  it('stamps confirmed structure onto template structure lines', () => {
    const result = applyFactsToLines([line({ materialName: '落地拉条', notes: '由结构关系推算' })], {
      category: '斗柜',
      structureSummary: '侧板落地无整块底板',
      designPrinciples: '抽侧长=柜深-50mm',
    });
    assert.match(result[0]?.notes ?? '', /按已确认结构设计/);
    assert.match(result[0]?.notes ?? '', /侧板落地/);
  });

  it('merges duplicate 喷漆 names that only differ by unit', () => {
    const result = applyFactsToLines(
      [
        line({
          category: '表面工艺',
          materialName: '喷漆',
          spec: '黑色板边缘',
          unit: '米',
          qtyNet: 1,
          origin: 'explicit',
          confidence: 'high',
        }),
        line({
          category: '表面工艺',
          materialName: '喷漆',
          spec: '黑色板边缘',
          unit: '套',
          qtyNet: 0,
          origin: 'template',
        }),
      ],
      { category: '斗柜' },
    );
    const paint = result.filter((row) => row.materialName === '喷漆');
    assert.equal(paint.length, 1);
    assert.equal(paint[0]?.unit, '米');
    assert.equal(paint[0]?.qtyNet, 1);
  });

  it('enriches chest cuts from structure summary when overallSize is omitted', () => {
    const result = applyFactsToLines(
      [
        line({ materialName: '侧板' }),
        line({ materialName: '顶底板' }),
        line({ materialName: '背板' }),
        line({ materialName: '抽面' }),
      ],
      {
        category: '斗柜',
        drawerCount: 6,
        structureSummary:
          '成品外尺寸约 W1200×D400×H785 mm。顶板厚15mm；除背板外其他板件默认9mm，背板3mm。',
        carcassThicknessMm: 12,
        sideThicknessMm: 12,
        backThicknessMm: 3,
        bottomThicknessMm: 3,
      },
    );
    const side = result.find((row) => row.materialName === '侧板');
    assert.ok(side?.spec?.includes('×'), side?.spec);
    assert.ok((side?.qtyNet ?? 0) > 0, '侧板应有块数');
    assert.match(side?.notes ?? '', /由结构关系推算/);
  });
});
