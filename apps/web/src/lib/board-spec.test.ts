import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeBoardSpecParts } from './board-spec.js';

describe('composeBoardSpecParts', () => {
  it('changes thickness without dropping cut size', () => {
    assert.equal(composeBoardSpecParts('18mm 1200×400', { thickness: '15' }), '15mm 1200×400');
    assert.equal(composeBoardSpecParts('18mm 1200×400', { thickness: '15mm' }), '15mm 1200×400');
  });

  it('changes cut size without dropping thickness', () => {
    assert.equal(composeBoardSpecParts('18mm 1200×400', { size: '1164×400' }), '18mm 1164×400');
  });

  it('treats a lone mm value in the size field as thickness', () => {
    assert.equal(composeBoardSpecParts('18mm 1200×400', { size: '15mm' }), '15mm 1200×400');
  });

  it('clears thickness and keeps size', () => {
    assert.equal(composeBoardSpecParts('18mm 1200×400', { thickness: '' }), '1200×400');
  });
});
