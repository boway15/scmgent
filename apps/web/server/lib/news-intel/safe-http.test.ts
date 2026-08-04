import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPublicHttpUrlResolved,
  readResponseTextLimited,
  safeFetchPublicHttp,
  type DnsLookup,
} from './safe-http.js';

const publicLookup: DnsLookup = async () => [
  { address: '93.184.216.34', family: 4 },
  { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
];

describe('assertPublicHttpUrlResolved', () => {
  it('rejects when any resolved A or AAAA address is private', async () => {
    await assert.rejects(
      () =>
        assertPublicHttpUrlResolved('https://example.com/feed', async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]),
      /private|public/i,
    );
  });

  it('accepts a host only when every resolved address is public', async () => {
    const url = await assertPublicHttpUrlResolved('https://example.com/feed', publicLookup);
    assert.equal(url.hostname, 'example.com');
  });

  it('rejects non-public shared, documentation, and multicast ranges', async () => {
    for (const address of [
      '100.64.0.1',
      '192.0.2.1',
      '224.0.0.1',
      '2001:db8::1',
      'ff02::1',
    ]) {
      await assert.rejects(
        () =>
          assertPublicHttpUrlResolved('https://example.com/feed', async () => [
            { address, family: address.includes(':') ? 6 : 4 },
          ]),
        address,
      );
    }
  });
});

describe('safeFetchPublicHttp', () => {
  it('validates every redirect target and uses manual redirect handling', async () => {
    const fetched: Array<{ url: string; redirect?: RequestInit['redirect'] }> = [];
    const response = await safeFetchPublicHttp('https://example.com/start', {
      lookup: publicLookup,
      fetch: async (input, init) => {
        const url = String(input);
        fetched.push({ url, redirect: init?.redirect });
        if (url.endsWith('/start')) {
          return new Response(null, {
            status: 302,
            headers: { Location: '/next' },
          });
        }
        return new Response('ok');
      },
    });

    assert.equal(await response.text(), 'ok');
    assert.deepEqual(fetched, [
      { url: 'https://example.com/start', redirect: 'manual' },
      { url: 'https://example.com/next', redirect: 'manual' },
    ]);
  });

  it('rejects redirects whose DNS result is private before fetching the target', async () => {
    const fetched: string[] = [];
    await assert.rejects(
      () =>
        safeFetchPublicHttp('https://public.example/start', {
          lookup: async (hostname) =>
            hostname === 'private.example'
              ? [{ address: '10.0.0.8', family: 4 }]
              : [{ address: '93.184.216.34', family: 4 }],
          fetch: async (input) => {
            fetched.push(String(input));
            return new Response(null, {
              status: 302,
              headers: { Location: 'http://private.example/admin' },
            });
          },
        }),
    );
    assert.deepEqual(fetched, ['https://public.example/start']);
  });

  it('rejects redirects without Location and chains beyond five redirects', async () => {
    await assert.rejects(
      () =>
        safeFetchPublicHttp('https://example.com/no-location', {
          lookup: publicLookup,
          fetch: async () => new Response(null, { status: 302 }),
        }),
      /location/i,
    );

    let calls = 0;
    await assert.rejects(
      () =>
        safeFetchPublicHttp('https://example.com/0', {
          lookup: publicLookup,
          fetch: async () => {
            calls += 1;
            return new Response(null, {
              status: 302,
              headers: { Location: `/${calls}` },
            });
          },
        }),
      /redirect/i,
    );
    assert.equal(calls, 6);
  });
});

describe('readResponseTextLimited', () => {
  it('rejects oversized Content-Length before reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('body'));
        controller.close();
      },
    });

    await assert.rejects(
      () =>
        readResponseTextLimited(
          new Response(body, { headers: { 'Content-Length': '11' } }),
          10,
        ),
      /large|limit|size/i,
    );
  });

  it('cancels an unbounded stream as soon as its bytes exceed the limit', async () => {
    let cancelled = false;
    const chunks = [new Uint8Array(6), new Uint8Array(6)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    await assert.rejects(
      () => readResponseTextLimited(new Response(body), 10),
      /large|limit|size/i,
    );
    assert.equal(cancelled, true);
  });
});
