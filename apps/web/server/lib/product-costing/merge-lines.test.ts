import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { finalizeExtractedLines, mergeBomLines, mergeSameNameLines, pruneRedundantTemplateLines } from './merge-lines.js';

const board = (
  overrides: Partial<{
    qtyNet: number;
    sourceRef: string;
    confidence: 'high' | 'medium' | 'low';
    notes: string;
  }>,
) => ({
  category: '板材',
  materialName: '多层板',
  spec: '18mm',
  unit: '张',
  qtyNet: 1,
  lossRate: 0.1,
  sourceRef: 'p1',
  confidence: 'high' as const,
  origin: 'explicit' as const,
  notes: '',
  ...overrides,
});

describe('mergeBomLines', () => {
  it('keeps the higher-confidence row instead of summing duplicate pages', () => {
    const merged = mergeBomLines([
      board({ qtyNet: 1, sourceRef: 'p1', confidence: 'high' }),
      board({ qtyNet: 2, sourceRef: 'p2', confidence: 'low', notes: '图上重复出现' }),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyNet, 1);
    assert.equal(merged[0].confidence, 'high');
    assert.equal(merged[0].origin, 'explicit');
    assert.match(merged[0].sourceRef ?? '', /p1/);
    assert.match(merged[0].sourceRef ?? '', /p2/);
    assert.match(merged[0].notes, /图上重复出现/);
  });

  it('prefers a non-zero quantity when confidence is equal', () => {
    const merged = mergeBomLines([
      board({ qtyNet: 0, confidence: 'medium', sourceRef: 'p3' }),
      board({ qtyNet: 2, confidence: 'medium', sourceRef: 'p5' }),
    ]);
    assert.equal(merged[0].qtyNet, 2);
    assert.equal(merged[0].confidence, 'medium');
  });

  it('merges hardware aliases such as 滚珠滑轨 into 抽屉滑轨', () => {
    const merged = mergeBomLines([
      {
        category: '五金',
        materialName: '滚珠滑轨',
        spec: '12寸',
        unit: '套',
        qtyNet: 18,
        lossRate: 0.08,
        sourceRef: 'p4',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '五金',
        materialName: '抽屉滑轨',
        spec: '12寸',
        unit: '套',
        qtyNet: 18,
        lossRate: 0.08,
        sourceRef: 'p4',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.materialName, '抽屉滑轨');
  });
});

describe('mergeSameNameLines', () => {
  it('merges 喷漆 rows that only differ by unit', () => {
    const merged = mergeSameNameLines([
      {
        category: '表面工艺',
        materialName: '喷漆',
        spec: '黑色板边缘',
        unit: '米',
        qtyNet: 1,
        lossRate: 0.08,
        sourceRef: 'p4',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '表面工艺',
        materialName: '喷漆',
        spec: '黑色板边缘',
        unit: '套',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: 'p4',
        confidence: 'low',
        origin: 'template',
        notes: '用量待补',
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.materialName, '喷漆');
    assert.equal(merged[0]?.unit, '米');
    assert.equal(merged[0]?.qtyNet, 1);
    assert.equal(merged[0]?.spec, '黑色板边缘');
  });

  it('keeps two same-name boards when cut sizes differ', () => {
    const merged = mergeSameNameLines([
      {
        category: '板材',
        materialName: '颗粒板',
        spec: '18mm 600×400',
        unit: '张',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p3',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '板材',
        materialName: '颗粒板',
        spec: '18mm 1200×400',
        unit: '张',
        qtyNet: 1,
        lossRate: 0.08,
        sourceRef: 'p5',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
    ]);
    assert.equal(merged.length, 2);
  });

  it('folds duplicate 抽面 that only differ by thickness or size spelling', () => {
    const merged = mergeSameNameLines(
      [
        {
          category: '板材',
          materialName: '抽面',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 9,
          lossRate: 0.08,
          sourceRef: 'p7,p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '抽面',
          spec: '18mm 521.0x210.0',
          unit: '块',
          qtyNet: 0,
          lossRate: 0.08,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
      ],
      '斗柜',
    );
    const fronts = merged.filter((row) => row.materialName === '抽面');
    assert.equal(fronts.length, 1);
    assert.match(fronts[0]?.spec ?? '', /12mm/);
    assert.match(fronts[0]?.spec ?? '', /521×210/);
    assert.equal(fronts[0]?.qtyNet, 9);
  });

  it('folds sized 前拉条/背拉条 with empty 18mm template slots', () => {
    const merged = mergeSameNameLines(
      [
        {
          category: '板材',
          materialName: '前拉条',
          spec: '12mm 1576×50',
          unit: '根',
          qtyNet: 4,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '前拉条',
          spec: '18mm',
          unit: '根',
          qtyNet: 0,
          lossRate: 0.08,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
        {
          category: '板材',
          materialName: '背拉条',
          spec: '12mm 1576×50',
          unit: '根',
          qtyNet: 1,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '背拉条',
          spec: '18mm',
          unit: '根',
          qtyNet: 0,
          lossRate: 0.08,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
      ],
      '斗柜',
    );
    assert.equal(merged.filter((row) => row.materialName === '前拉条').length, 1);
    assert.equal(merged.filter((row) => row.materialName === '背拉条').length, 1);
    assert.match(merged.find((row) => row.materialName === '前拉条')?.spec ?? '', /12mm 1576×50/);
    assert.equal(merged.find((row) => row.materialName === '前拉条')?.qtyNet, 4);
  });

  it('folds aliased 背部拉条 into 背拉条', () => {
    const merged = mergeSameNameLines(
      [
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
        },
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
        },
      ],
      '斗柜',
    );
    assert.equal(merged.filter((row) => row.materialName === '背拉条').length, 1);
    assert.equal(merged.some((row) => row.materialName === '背部拉条'), false);
    assert.match(merged.find((row) => row.materialName === '背拉条')?.spec ?? '', /1576×50/);
  });

  it('attaches a template same-name row to only one cut size', () => {
    const merged = mergeSameNameLines([
      {
        category: '板材',
        materialName: '侧板',
        spec: '18mm 400×785',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p3',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '板材',
        materialName: '侧板',
        spec: '18mm 380×760',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p5',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '板材',
        materialName: '侧板',
        spec: '',
        unit: '块',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: '',
        confidence: 'low',
        origin: 'template',
        notes: '用量待补',
      },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged.filter((row) => row.notes.includes('用量待补')).length, 1);
  });

  it('merges a qty-0 18mm 侧板 template into the sized 12mm 侧板', () => {
    const merged = mergeSameNameLines([
      {
        category: '板材',
        materialName: '侧板',
        spec: '12mm 400×785',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p3',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '板材',
        materialName: '侧板',
        spec: '18mm',
        unit: '块',
        qtyNet: 0,
        lossRate: 0.08,
        sourceRef: '',
        confidence: 'low',
        origin: 'template',
        notes: '用量待补',
      },
    ]);
    assert.equal(merged.length, 1);
    assert.match(merged[0]?.spec ?? '', /12mm/);
    assert.match(merged[0]?.spec ?? '', /400×785/);
    assert.equal(merged[0]?.qtyNet, 2);
  });
});

describe('pruneRedundantTemplateLines', () => {
  it('drops empty template rows when the same part already has size or qty', () => {
    const pruned = pruneRedundantTemplateLines(
      [
        {
          category: '板材',
          materialName: '前拉条',
          spec: '12mm 1176×50',
          unit: '根',
          qtyNet: 4,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '前拉条',
          spec: '18mm',
          unit: '根',
          qtyNet: 0,
          lossRate: 0,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
        {
          category: '板材',
          materialName: '侧板',
          spec: '',
          unit: '块',
          qtyNet: 0,
          lossRate: 0,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
      ],
      '斗柜',
    );
    assert.equal(pruned.filter((row) => row.materialName === '前拉条').length, 1);
    assert.equal(pruned.filter((row) => row.materialName === '侧板').length, 1);
  });
});

const PANEL = {
  carcassThicknessMm: 18,
  sideThicknessMm: 18,
  backThicknessMm: 3,
  bottomThicknessMm: 18,
  drawerBottomThicknessMm: 9,
} as const;

describe('finalizeExtractedLines', () => {
  it('dedupes then fills missing desk structure slots', () => {
    const result = finalizeExtractedLines('书桌', [
      board({ qtyNet: 1 }),
      {
        category: '板材',
        materialName: '桌面',
        spec: '25mm',
        unit: '块',
        qtyNet: 1,
        lossRate: 0.08,
        sourceRef: 'p2',
        confidence: 'medium',
        origin: 'explicit',
        notes: '',
      },
    ]);
    assert.ok(result.some((line) => line.materialName === '桌面' && line.origin === 'explicit'));
    assert.ok(result.some((line) => line.materialName === '侧板' && line.origin === 'template'));
    assert.equal(result.filter((line) => line.materialName === '多层实木板').length, 1);
  });

  it('drops overall-size rows before filling templates', () => {
    const result = finalizeExtractedLines('斗柜', [
      {
        category: '其他',
        materialName: '产品尺寸',
        spec: '1200×400×785 mm',
        unit: '套',
        qtyNet: 1,
        lossRate: 0,
        sourceRef: 'p7',
        confidence: 'high',
        origin: 'explicit',
        notes: '外形尺寸',
      },
    ], PANEL);
    assert.equal(result.some((line) => line.materialName.includes('产品尺寸')), false);
    const side = result.find((line) => line.materialName === '侧板');
    assert.ok(side);
    assert.equal(side?.origin, 'template');
  });

  it('does not auto-cut after extract; waits for apply-facts', () => {
    const result = finalizeExtractedLines(
      '斗柜',
      [
        {
          category: '板材',
          materialName: '桌面板',
          spec: '15mm',
          unit: '张',
          qtyNet: 1,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
      ],
      { overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 }, drawerCount: 6, ...PANEL },
    );
    const top = result.find((line) => line.materialName === '顶底板');
    assert.equal(top?.spec, '15mm');
    assert.equal(result.some((line) => line.materialName === '桌面板'), false);
    const side = result.find((line) => line.materialName === '侧板');
    assert.equal(side?.qtyNet, 0);
    assert.equal(result.some((line) => line.materialName === '保利龙'), false);
    assert.equal(result.filter((line) => line.materialName === '螺丝包').length, 1);
  });

  it('merges explicit drawer cut size from size page into template slot', () => {
    const result = finalizeExtractedLines(
      '斗柜',
      [
        {
          category: '板材',
          materialName: '桌面板',
          spec: '15mm',
          unit: '张',
          qtyNet: 1,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '抽面',
          spec: '598×210',
          unit: '块',
          qtyNet: 0,
          lossRate: 0.08,
          sourceRef: 'p7',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '抽面',
          spec: '',
          unit: '块',
          qtyNet: 0,
          lossRate: 0.08,
          sourceRef: '',
          confidence: 'low',
          origin: 'template',
          notes: '用量待补',
        },
      ],
      { overallSize: { widthMm: 1200, depthMm: 400, heightMm: 785 }, drawerCount: 6, ...PANEL },
    );
    const fronts = result.filter((line) => line.materialName === '抽面');
    assert.equal(fronts.length, 1);
    assert.match(fronts[0]?.spec ?? '', /598×210/);
  });

  it('promotes misnamed 颗粒板 drawer front and avoids duplicate empty 抽面 template', () => {
    const result = finalizeExtractedLines(
      '斗柜',
      [
        {
          category: '板材',
          materialName: '颗粒板',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 9,
          lossRate: 0.08,
          sourceRef: 'p7',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
      ],
      {
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
      },
    );
    assert.equal(result.filter((row) => row.materialName === '抽面').length, 1);
    assert.equal(result.some((row) => row.materialName === '颗粒板' && /521/.test(row.spec ?? '')), false);
    assert.match(result.find((row) => row.materialName === '抽面')?.spec ?? '', /521×210/);
    assert.equal(result.find((row) => row.materialName === '抽面')?.qtyNet, 9);
  });

  it('promotes 颗粒板 drawer front without drawerCount and avoids empty 抽面 template', () => {
    const result = finalizeExtractedLines(
      '斗柜',
      [
        {
          category: '板材',
          materialName: '颗粒板',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 9,
          lossRate: 0.08,
          sourceRef: 'p7',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
      ],
      {
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
      },
    );
    assert.equal(result.filter((row) => row.materialName === '抽面').length, 1);
    assert.equal(result.some((row) => row.materialName === '颗粒板'), false);
    assert.equal(result.find((row) => row.materialName === '抽面')?.qtyNet, 9);
    assert.equal(
      result.filter((row) => row.materialName === '抽面' && row.origin === 'template').length,
      0,
    );
  });

  it('does not duplicate rails and drawer front after extract plus template fill', () => {
    const result = finalizeExtractedLines(
      '斗柜',
      [
        {
          category: '板材',
          materialName: '前拉条',
          spec: '12mm 1176×50',
          unit: '根',
          qtyNet: 4,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '背拉条',
          spec: '12mm 1576×50',
          unit: '根',
          qtyNet: 1,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '落地拉条',
          spec: '12mm 400×50',
          unit: '根',
          qtyNet: 2,
          lossRate: 0.08,
          sourceRef: 'p5',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
        {
          category: '板材',
          materialName: '抽面',
          spec: '12mm 521×210',
          unit: '块',
          qtyNet: 9,
          lossRate: 0.08,
          sourceRef: 'p7',
          confidence: 'high',
          origin: 'explicit',
          notes: '',
        },
      ],
      {
        overallSize: { widthMm: 1600, depthMm: 400, heightMm: 785 },
        drawerCount: 9,
      },
    );
    for (const name of ['前拉条', '背拉条', '落地拉条', '抽面']) {
      assert.equal(result.filter((row) => row.materialName === name).length, 1, name);
    }
    assert.equal(
      result.filter((row) => row.origin === 'template' && row.qtyNet === 0 && /拉条|抽面/.test(row.materialName))
        .length,
      0,
    );
  });

  it('does not leave a second empty 侧板 after filling the template slot', () => {
    const result = finalizeExtractedLines('斗柜', [
      {
        category: '板材',
        materialName: '侧板',
        spec: '12mm 400×785',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p5',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
    ], PANEL);
    assert.equal(result.filter((line) => line.materialName === '侧板').length, 1);
  });

  it('folds CMF 密度板/桌面板 into 顶底板 for chests', () => {
    const result = finalizeExtractedLines('斗柜', [
      {
        category: '板材',
        materialName: '密度板',
        spec: '15mm 桌面板',
        unit: '张',
        qtyNet: 1,
        lossRate: 0.08,
        sourceRef: 'p5',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
      {
        category: '板材',
        materialName: '顶底板',
        spec: '15mm 1200×400',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        sourceRef: 'p7',
        confidence: 'high',
        origin: 'explicit',
        notes: '',
      },
    ], PANEL);
    assert.equal(result.some((line) => line.materialName === '密度板'), false);
    assert.equal(result.some((line) => line.materialName === '桌面板'), false);
    const tops = result.filter((line) => line.materialName === '顶底板');
    assert.equal(tops.length, 1);
    assert.match(tops[0]?.spec ?? '', /1200×400/);
    assert.equal(tops[0]?.substrate, '密度板');
  });
});
