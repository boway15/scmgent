import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcCostSummary } from './cost-calc.js';
import { buildCostingExportAoa } from './export-costing.js';

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
          confidence: 'high',
          matchStatus: 'exact',
        },
      ],
      summary,
    });

    assert.deepEqual(result.list, [
      [
        '大类',
        '名称',
        '规格',
        '单位',
        '净用量',
        '损耗',
        '毛用量',
        '生效单价',
        '金额',
        '来源',
        '置信度',
        '匹配状态',
      ],
      ['板材', '多层实木板', '18mm', '张', 2, 0.1, 2.2, 50, 110, 'explicit', 'high', 'exact'],
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
      ['大类', '金额', '占比'],
      ['五金', 0, 0],
      ['总成本', 0, 1],
      ['缺价行数', 1, '缺用量行数', 1],
    ]);
  });
});
