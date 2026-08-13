import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preparePageImageBase64 } from './compress-page-image.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('preparePageImageBase64', () => {
  it('returns empty base64 for a 1x1 placeholder image', async () => {
    assert.equal(await preparePageImageBase64(Buffer.concat([TINY_PNG, Buffer.alloc(600)])), '');
  });

  it('returns empty base64 for files smaller than 512 bytes', async () => {
    assert.equal(await preparePageImageBase64(Buffer.alloc(511)), '');
  });
});
