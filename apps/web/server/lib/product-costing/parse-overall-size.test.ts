import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatOverallSize,
  parseOverallSize,
  parseOverallSizeFromPages,
  parseOverallSizeFromProjectContext,
  resolveOverallSize,
} from './parse-overall-size.js';

describe('parseOverallSize', () => {
  it('reads compact W×D×H triples', () => {
    assert.deepEqual(parseOverallSize(['产品尺寸 1800x800x750']), {
      widthMm: 1800,
      depthMm: 800,
      heightMm: 750,
    });
  });

  it('reads labeled W D H values', () => {
    assert.deepEqual(parseOverallSize(['PRODUCT SIZE\nW 1400 D 600 H 750']), {
      widthMm: 1400,
      depthMm: 600,
      heightMm: 750,
    });
  });

  it('joins split digits like D 4 00', () => {
    assert.deepEqual(parseOverallSize(['W 1 8 00\nD 8 00\nH 7 50']), {
      widthMm: 1800,
      depthMm: 800,
      heightMm: 750,
    });
  });

  it('reads PPTX size-page tokens W 1200 * D 4 00 * H 785', () => {
    assert.deepEqual(
      parseOverallSize(['W 1200 * D 4 00 * H 785 mm 产品尺寸 PRODUCT SIZE']),
      { widthMm: 1200, depthMm: 400, heightMm: 785 },
    );
  });

  it('reads newline-separated PPTX tokens', () => {
    assert.deepEqual(parseOverallSize(['W\n1200\n*\nD\n4\n00\n*\nH\n785\nmm']), {
      widthMm: 1200,
      depthMm: 400,
      heightMm: 785,
    });
  });

  it('returns null when dimensions are missing', () => {
    assert.equal(parseOverallSize(['设计说明：实木桌面']), null);
    assert.equal(parseOverallSize([]), null);
  });
});

describe('parseOverallSizeFromPages', () => {
  it('prefers the 产品尺寸 page over other slide text', () => {
    assert.deepEqual(
      parseOverallSizeFromPages([
        { pageType: 'notes', text: '桌面板 1600x400' },
        { pageType: 'size', text: 'W 1200 * D 4 00 * H 785 mm 产品尺寸' },
      ]),
      { widthMm: 1200, depthMm: 400, heightMm: 785 },
    );
  });
});

describe('formatOverallSize', () => {
  it('formats a stable prompt fragment', () => {
    assert.equal(
      formatOverallSize({ widthMm: 1800, depthMm: 800, heightMm: 750 }),
      'W1800 × D800 × H750 mm',
    );
  });
});

describe('parseOverallSizeFromProjectContext', () => {
  it('reads W×D×H from confirmed structure summary', () => {
    assert.deepEqual(
      parseOverallSizeFromProjectContext({
        structureSummary: '成品外尺寸约 W1200×D400×H785 mm。顶板厚15mm',
      }),
      { widthMm: 1200, depthMm: 400, heightMm: 785 },
    );
  });

  it('falls back to design principles when summary lacks dimensions', () => {
    assert.deepEqual(
      parseOverallSizeFromProjectContext({
        structureSummary: '侧板落地，顶板为盖板',
        designPrinciples: '按成品尺寸W1200×D400×H785制作',
      }),
      { widthMm: 1200, depthMm: 400, heightMm: 785 },
    );
  });
});

describe('resolveOverallSize', () => {
  it('prefers size-page OCR over confirmed text', () => {
    assert.deepEqual(
      resolveOverallSize({
        pageOverallSize: { widthMm: 1400, depthMm: 600, heightMm: 750 },
        structureSummary: 'W1200×D400×H785',
      }),
      { widthMm: 1400, depthMm: 600, heightMm: 750 },
    );
  });

  it('uses confirmed text when OCR is missing', () => {
    assert.deepEqual(
      resolveOverallSize({
        pageOverallSize: null,
        structureSummary: '成品外尺寸约 W1200×D400×H785 mm',
      }),
      { widthMm: 1200, depthMm: 400, heightMm: 785 },
    );
  });
});
