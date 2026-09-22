import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRasterImageFile } from './raster-image.js';

describe('isRasterImageFile', () => {
  it('accepts common raster extensions', () => {
    assert.equal(isRasterImageFile('size.png'), true);
    assert.equal(isRasterImageFile('photo.JPG'), true);
    assert.equal(isRasterImageFile('cover.webp'), true);
    assert.equal(isRasterImageFile('design.pptx'), false);
  });
});
