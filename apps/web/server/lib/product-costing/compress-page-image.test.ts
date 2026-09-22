import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDifyPagesJson,
  MAX_DIFY_PAGES_JSON_CHARS,
  preparePageImage,
  preparePageImageBase64,
} from './compress-page-image.js';

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

  it('returns png mime for small uncompressed page images', async () => {
    const sample = Buffer.alloc(600, 0xff);
    const image = await preparePageImage(sample);
    assert.equal(image.mimeType, 'image/png');
    assert.ok(image.base64.length > 0);
  });

  it('drops oversized images that would exceed the Dify pages_json limit', async () => {
    const huge = Buffer.alloc(700_000, 0xab);
    const image = await preparePageImage(huge);
    assert.equal(image.base64, '');
  });
});

describe('buildDifyPagesJson', () => {
  it('keeps images and only truncates text when the payload is too large', () => {
    const json = buildDifyPagesJson([
      {
        page: 2,
        page_type: 'explosion',
        text: 'x'.repeat(600_000),
        image_base64: 'abc123',
        image_mime_type: 'image/jpeg',
      },
    ]);
    assert.ok(json.length <= MAX_DIFY_PAGES_JSON_CHARS);
    assert.match(json, /"image_base64":"abc123"/);
    assert.doesNotMatch(json, /"image_base64":""/);
  });

  it('throws when text and image together still exceed the Dify limit', () => {
    assert.throws(
      () =>
        buildDifyPagesJson([
          {
            page: 2,
            page_type: 'render',
            text: '产品方案',
            image_base64: 'a'.repeat(600_000),
            image_mime_type: 'image/jpeg',
          },
        ]),
      /超出 Dify 单批上限/,
    );
  });
});
