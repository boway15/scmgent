import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableFeishuFetchError,
  withFeishuFetchRetry,
} from './feishu-fetch-retry.js';

describe('isRetryableFeishuFetchError', () => {
  it('retries undici terminated and common network failures', () => {
    assert.equal(isRetryableFeishuFetchError(new Error('terminated')), true);
    assert.equal(isRetryableFeishuFetchError(new TypeError('fetch failed')), true);
    assert.equal(isRetryableFeishuFetchError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })), true);
    assert.equal(isRetryableFeishuFetchError(new Error('RolePermNotAllow')), false);
  });
});

describe('withFeishuFetchRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    let attempts = 0;
    const result = await withFeishuFetchRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('terminated');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 0 },
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('wraps exhausted terminated errors with a clearer message', async () => {
    await assert.rejects(
      () =>
        withFeishuFetchRetry(
          async () => {
            throw new Error('terminated');
          },
          { retries: 2, baseDelayMs: 0 },
        ),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes('飞书请求中断') &&
        err.message.includes('terminated'),
    );
  });
});
