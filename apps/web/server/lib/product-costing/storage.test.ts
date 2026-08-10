import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStoragePath } from './storage.js';

describe('resolveStoragePath', () => {
  it('rejects path traversal', () => {
    assert.throws(() => resolveStoragePath('../etc/passwd'));
    assert.throws(() => resolveStoragePath('foo/../../etc/passwd'));
  });

  it('accepts project-relative paths', () => {
    const abs = resolveStoragePath('11111111-1111-1111-1111-111111111111/source.pptx');
    assert.match(abs, /11111111-1111-1111-1111-111111111111/);
  });
});
