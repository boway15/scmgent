import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inferAntiTipSeen, inferDrawerSlideSpec } from './infer-hardware-spec.js';

describe('inferDrawerSlideSpec', () => {
  it('reads compound section-inch spec from design principles', () => {
    assert.equal(
      inferDrawerSlideSpec([
        '以W1600×D400×H785为外部尺寸依据；滑轨采用2节12寸滚珠滑轨',
      ]),
      '2节12寸滚珠滑轨',
    );
  });

  it('reads spec near 滑轨 keyword', () => {
    assert.equal(
      inferDrawerSlideSpec(['抽屉滑轨：2节 12寸']),
      '2节 12寸',
    );
  });

  it('returns null when text has no slide context', () => {
    assert.equal(inferDrawerSlideSpec(['侧板落地，顶板为盖板']), null);
  });

  it('returns null for empty input', () => {
    assert.equal(inferDrawerSlideSpec([]), null);
  });

  it('reads slide spec from OCR page text with broken line breaks', () => {
    assert.equal(
      inferDrawerSlideSpec(['2\n节\n12\n寸滚珠滑轨']),
      '2 节 12 寸滚珠滑轨',
    );
  });
});

describe('inferAntiTipSeen', () => {
  it('detects anti-tip from explosion page text', () => {
    assert.equal(inferAntiTipSeen(['金属防倾倒装置']), true);
    assert.equal(inferAntiTipSeen(['只有滑轨']), false);
  });
});
