import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBoardSpec, specDisplayParts } from './parse-board-spec.js';

describe('parseBoardSpec', () => {
  it('reads thickness from 18mm 1200x600', () => {
    assert.deepEqual(parseBoardSpec('18mm 1200x600'), {
      thickness: '18mm',
      thicknessMm: 18,
      size: '1200×600',
    });
  });

  it('reads thickness as the small axis of 1200x400x18mm', () => {
    assert.deepEqual(parseBoardSpec('1200x400x18mm'), {
      thickness: '18mm',
      thicknessMm: 18,
      size: '1200×400',
    });
  });

  it('reads a lone thickness', () => {
    assert.equal(parseBoardSpec('15mm 贴三胺').thicknessMm, 15);
    assert.equal(parseBoardSpec('9mm').thickness, '9mm');
  });

  it('returns empty for placeholders', () => {
    assert.equal(parseBoardSpec('未指定').thicknessMm, null);
    assert.equal(parseBoardSpec('').thickness, '');
  });

  it('does not treat cabinet or pack outer size as board thickness', () => {
    const parsed = parseBoardSpec('外径 1680×480×865 mm');
    assert.equal(parsed.thicknessMm, null);
    assert.equal(parsed.size, '1680×480×865');
  });
});

describe('specDisplayParts', () => {
  it('does not repeat a lone thickness in the size column', () => {
    assert.deepEqual(specDisplayParts('9mm'), { thickness: '9mm', size: '' });
    assert.deepEqual(specDisplayParts('15mm 贴三胺'), { thickness: '15mm', size: '贴三胺' });
    assert.deepEqual(specDisplayParts('15mm 1200x600'), { thickness: '15mm', size: '1200×600' });
  });
});
