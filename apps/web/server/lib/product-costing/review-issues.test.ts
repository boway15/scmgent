import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lineProvenanceTags, listReviewIssues } from './review-issues.js';

describe('listReviewIssues', () => {
  it('maps blockers to block issues', () => {
    const issues = listReviewIssues({
      blockers: [{ lineId: 'a1', materialName: '滑轨', reason: 'missing_price' }],
      lines: [
        {
          id: 'a1',
          materialName: '滑轨',
          category: '五金',
          origin: 'explicit',
          isManual: false,
          confidence: 'high',
          matchStatus: 'unmatched',
          unitPriceOverride: null,
          effectiveUnitPrice: null,
          qtyNet: 6,
        },
      ],
    });
    assert.equal(issues.some((item) => item.code === 'missing_price' && item.severity === 'block'), true);
  });

  it('warns on template packaging without blocking when priced', () => {
    const issues = listReviewIssues({
      blockers: [],
      lines: [
        {
          id: 'p1',
          materialName: '纸箱',
          category: '包装',
          origin: 'template',
          isManual: false,
          confidence: 'high',
          matchStatus: 'exact',
          unitPriceOverride: null,
          effectiveUnitPrice: 4.9,
          qtyNet: 2,
        },
      ],
    });
    assert.equal(issues.some((item) => item.code === 'template_pending'), true);
    assert.equal(issues.some((item) => item.severity === 'block'), false);
  });

  it('warns when explicit front rail qty differs from drawer formula', () => {
    const issues = listReviewIssues({
      blockers: [],
      category: '斗柜',
      drawerCount: 6,
      lines: [
        {
          id: 'r1',
          materialName: '前拉条',
          category: '板材',
          origin: 'explicit',
          isManual: false,
          confidence: 'high',
          matchStatus: 'exact',
          unitPriceOverride: null,
          effectiveUnitPrice: 8,
          qtyNet: 4,
        },
      ],
    });
    assert.equal(issues.some((item) => item.code === 'front_rail_qty_conflict'), true);
  });

  it('tags inferred cut on template board structure parts', () => {
    const tags = lineProvenanceTags({
      origin: 'template',
      category: '板材',
      isManual: false,
      matchStatus: 'exact',
      unitPriceOverride: null,
      materialName: '抽侧',
    });
    assert.deepEqual(tags, ['规则开料', '库价']);
  });
});
