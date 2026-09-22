import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcCostSummary } from './cost-calc.js';
import {
  buildBoardSheetExportAoa,
  buildCostingConfirmSheetAoa,
  buildCostingExportAoa,
} from './export-costing.js';

describe('buildCostingExportAoa', () => {
  it('builds material rows with calculated price and matching metadata', () => {
    const summary = calcCostSummary([
      {
        category: '板材',
        qtyNet: 2,
        lossRate: 0.1,
        unitPriceOverride: null,
        bookUnitPrice: 50,
      },
    ]);

    const result = buildCostingExportAoa({
      lines: [
        {
          category: '板材',
          materialName: '多层实木板',
          spec: '18mm',
          unit: '张',
          qtyNet: 2,
          lossRate: 0.1,
          qtyGross: 2.2,
          effectiveUnitPrice: 50,
          lineAmount: 110,
          origin: 'explicit',
          sourceRef: 'p3',
          confidence: 'high',
          matchStatus: 'exact',
          matchScope: 'global',
        },
      ],
      summary,
    });

    assert.deepEqual(result.list, [
      [
        '大类',
        '名称',
        '材质',
        '规格',
        '单位',
        '净用量',
        '损耗',
        '毛用量',
        '生效单价',
        '金额',
        '来源标签',
        '提取原值',
        '来源类型',
        '出处',
        '置信度',
        '匹配状态',
        '价层',
      ],
      [
        '板材',
        '多层实木板',
        '',
        '18mm',
        '张',
        2,
        0.1,
        2.2,
        50,
        110,
        '',
        '',
        'explicit',
        'p3',
        'high',
        'exact',
        '全局通用',
      ],
    ]);
  });

  it('builds category totals and one missing-data statistics row', () => {
    const summary = calcCostSummary([
      {
        category: '五金',
        qtyNet: 0,
        lossRate: 0,
        unitPriceOverride: null,
        bookUnitPrice: null,
      },
    ]);

    const result = buildCostingExportAoa({ lines: [], summary });

    assert.deepEqual(result.summary, [
      ['项目', '金额', '占比'],
      ['材料小计', 0, 0],
      ['加工费', 0, 0],
      ['费用小计', 0, 0],
      ['五金', 0, 0],
      ['总成本', 0, 1],
      ['缺价行数', 1, '缺用量行数', 1],
    ]);
  });

  it('exports a board sheet with yield columns', () => {
    const summary = calcCostSummary([
      {
        category: '板材',
        materialName: '侧板',
        spec: '18mm 1200×400',
        qtyNet: 2,
        lossRate: 0,
        unitPriceOverride: null,
        bookUnitPrice: 68,
        bookUnit: '张',
      },
    ]);
    const sheet = buildBoardSheetExportAoa({ summary, computed: true });
    assert.equal(sheet[0]?.[0], '板材成本核算（按照每个板材的规格进行核算）');
    assert.equal(sheet[2]?.[1], '侧板');
    assert.equal(sheet[2]?.[8], 1200);
    assert.equal(sheet[2]?.[9], 2400);
    assert.equal(sheet[2]?.[10], 6);
  });

  it('builds confirm sheet sections in template order', () => {
    const summary = calcCostSummary([
      {
        category: '板材',
        materialName: '侧板',
        spec: '12mm 400×785',
        qtyNet: 2,
        lossRate: 0.08,
        unitPriceOverride: null,
        bookUnitPrice: 65,
        bookUnit: '张',
      },
      {
        category: '五金',
        materialName: '抽屉滑轨',
        spec: '2节12寸',
        qtyNet: 9,
        lossRate: 0.08,
        unitPriceOverride: null,
        bookUnitPrice: 2,
        bookUnit: '套',
      },
    ]);
    const lines = [
      {
        category: '板材',
        materialName: '侧板',
        spec: '12mm 400×785',
        unit: '块',
        qtyNet: 2,
        lossRate: 0.08,
        qtyGross: 2.16,
        effectiveUnitPrice: 65,
        lineAmount: 140.4,
        origin: 'template',
        sourceRef: '',
        confidence: 'high',
        matchStatus: 'exact',
        matchScope: 'global',
        substrate: '密度板',
      },
      {
        category: '五金',
        materialName: '抽屉滑轨',
        spec: '2节12寸',
        unit: '套',
        qtyNet: 9,
        lossRate: 0.08,
        qtyGross: 9.72,
        effectiveUnitPrice: 2,
        lineAmount: 19.44,
        origin: 'explicit',
        sourceRef: 'p4',
        confidence: 'high',
        matchStatus: 'exact',
        matchScope: 'global',
        substrate: null,
      },
    ];
    const sheet = buildCostingConfirmSheetAoa({
      projectNo: 'CST-TEST',
      projectName: '测试斗柜',
      lines,
      summary,
      computed: true,
    });
    const titles = sheet.filter((row) => typeof row[0] === 'string' && /^[一二三四五]、/.test(row[0])).map((row) => row[0]);
    assert.deepEqual(titles, [
      '一、相关涉及的原材料成本单价',
      '二、板材成本核算',
      '三、配件与包装',
      '四、小计',
      '五、成本看板数据',
    ]);
    assert.ok(sheet.some((row) => row[0] === '抽屉滑轨'));
  });
});
