import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafePublicHttpUrl } from './url-safety.js';

describe('assertSafePublicHttpUrl', () => {
  it('accepts public HTTP and HTTPS URLs', () => {
    assert.equal(assertSafePublicHttpUrl('https://news.google.com/rss/search?q=test').hostname, 'news.google.com');
    assert.equal(assertSafePublicHttpUrl('http://example.com/article').protocol, 'http:');
  });

  it('rejects non-HTTP protocols and credential-bearing URLs', () => {
    for (const value of [
      'file:///etc/passwd',
      'ftp://example.com/file',
      'https://user:password@example.com/private',
    ]) {
      assert.throws(() => assertSafePublicHttpUrl(value), value);
    }
  });

  it('rejects localhost and local hostnames', () => {
    for (const value of ['http://localhost/x', 'http://api.local/x', 'http://LOCALHOST./x']) {
      assert.throws(() => assertSafePublicHttpUrl(value), value);
    }
  });

  it('rejects loopback, link-local and RFC1918 IPv4 addresses', () => {
    for (const value of [
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/x',
      'http://172.16.0.1/x',
      'http://172.31.255.255/x',
      'http://192.168.1.1/x',
    ]) {
      assert.throws(() => assertSafePublicHttpUrl(value), value);
    }
  });

  it('rejects loopback, link-local and ULA IPv6 addresses', () => {
    for (const value of [
      'http://[::1]/x',
      'http://[fe80::1]/x',
      'http://[fc00::1]/x',
      'http://[fd12:3456:789a::1]/x',
    ]) {
      assert.throws(() => assertSafePublicHttpUrl(value), value);
    }
  });
});
