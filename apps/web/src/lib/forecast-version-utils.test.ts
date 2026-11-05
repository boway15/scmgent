import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransientGatewayError } from './forecast-version-utils.js';

describe('isTransientGatewayError', () => {
  it('treats Cloudflare HTML 502 on the baseline poll as retryable', () => {
    const error = new Error(
      'HTTP 502: 网关超时（收到 HTML 错误页，/api/sales-forecasts/generate-baseline/tasks/93bc8132-3e64-4151-89e7-b333a5c7a52a）。多为后台处理过久；请稍后重试或改用异步任务接口。',
    );
    assert.equal(isTransientGatewayError(error), true);
  });

  it('treats 504 and 524 HTML gateway pages as retryable', () => {
    assert.equal(isTransientGatewayError(new Error('HTTP 504: 网关超时（收到 HTML 错误页，/api/x）')), true);
    assert.equal(isTransientGatewayError(new Error('HTTP 524: 网关超时（收到 HTML 错误页，/api/x）')), true);
  });

  it('treats a dropped browser connection as retryable', () => {
    assert.equal(isTransientGatewayError(new TypeError('Failed to fetch')), true);
  });

  it('does not retry an application JSON error', () => {
    assert.equal(isTransientGatewayError(new Error('HTTP 400: SKU 最多填写 20 个')), false);
    assert.equal(isTransientGatewayError(new Error('HTTP 502: 上游业务失败')), false);
    assert.equal(isTransientGatewayError(new Error('后台生成失败')), false);
  });
});
