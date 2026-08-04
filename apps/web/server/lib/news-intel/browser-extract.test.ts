import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractArticleBody } from './body-extract.js';
import { extractBodyWithBrowser, type BrowserDeps } from './browser-extract.js';
import {
  getChromiumExecutablePath,
  isBrowserExtractionEnabled,
} from './config.js';
import { fetchRssFeed } from './rss-fetcher.js';

function createBrowserDeps(options: {
  articleText?: string;
  mainText?: string;
  bodyText?: string;
  resolvedAddress?: string;
  subrequestUrl?: string;
  gotoError?: Error;
  contextCloseError?: Error;
  browserCloseError?: Error;
}) {
  const calls = {
    contextClose: 0,
    browserClose: 0,
    cleanup: 0,
    launch: 0,
    routeAbort: 0,
    routeContinue: 0,
    contextOptions: undefined as {
      acceptDownloads?: boolean;
      serviceWorkers?: string;
    } | undefined,
    gotoOptions: undefined as { timeout?: number; waitUntil?: string } | undefined,
    selectors: [] as string[],
  };

  const deps: BrowserDeps = {
    lookup: async () => [
      { address: options.resolvedAddress ?? '93.184.216.34', family: 4 },
    ],
    makeTempDir: async () => 'test-browser-profile',
    removeTempDir: async () => {
      calls.cleanup += 1;
    },
    launch: async () => {
      calls.launch += 1;
      return {
      newContext: async (contextOptions) => {
        calls.contextOptions = contextOptions;
        let routeHandler:
          | ((route: {
              request(): { url(): string };
              abort(): Promise<void>;
              continue(): Promise<void>;
            }) => Promise<void>)
          | undefined;
        return {
          route: async (_pattern, handler) => {
            routeHandler = handler;
          },
          newPage: async () => {
            if (options.subrequestUrl && routeHandler) {
              await routeHandler({
                request: () => ({ url: () => options.subrequestUrl! }),
                abort: async () => {
                  calls.routeAbort += 1;
                },
                continue: async () => {
                  calls.routeContinue += 1;
                },
              });
            }
            return {
              goto: async (_url, gotoOptions) => {
                calls.gotoOptions = gotoOptions;
                if (options.gotoError) throw options.gotoError;
              },
              locator: (selector) => ({
                innerText: async () => {
                  calls.selectors.push(selector);
                  if (selector === 'article') return options.articleText ?? '';
                  if (selector === 'main') return options.mainText ?? '';
                  return options.bodyText ?? '';
                },
              }),
            };
          },
          close: async () => {
            calls.contextClose += 1;
            if (options.contextCloseError) throw options.contextCloseError;
          },
        };
      },
      close: async () => {
        calls.browserClose += 1;
        if (options.browserCloseError) throw options.browserCloseError;
      },
    };
    },
  };

  return { calls, deps };
}

describe('extractBodyWithBrowser', () => {
  it('uses a download-disabled context, 20 second navigation, and article-first text', async () => {
    const { calls, deps } = createBrowserDeps({
      articleText: 'A'.repeat(200),
      mainText: 'M'.repeat(200),
      bodyText: 'B'.repeat(200),
    });

    const result = await extractBodyWithBrowser('https://example.com/article', deps);

    assert.equal(result, 'A'.repeat(200));
    assert.deepEqual(calls.contextOptions, {
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    assert.deepEqual(calls.gotoOptions, { timeout: 20_000, waitUntil: 'domcontentloaded' });
    assert.deepEqual(calls.selectors, ['article']);
  });

  it('returns undefined for captcha and access-denied pages', async () => {
    for (const text of ['请完成验证码后继续', 'Captcha challenge', 'Access Denied']) {
      const { deps } = createBrowserDeps({ articleText: text });
      assert.equal(await extractBodyWithBrowser('https://example.com/article', deps), undefined);
    }
  });

  it('closes context and browser and cleans the profile when extraction throws', async () => {
    const primaryError = new Error('navigation failed');
    const { calls, deps } = createBrowserDeps({ gotoError: primaryError });

    await assert.rejects(
      () => extractBodyWithBrowser('https://example.com/article', deps),
      primaryError,
    );
    assert.equal(calls.contextClose, 1);
    assert.equal(calls.browserClose, 1);
    assert.equal(calls.cleanup, 1);
  });

  it('does not let close errors mask the primary extraction error', async () => {
    const primaryError = new Error('navigation failed');
    const { calls, deps } = createBrowserDeps({
      gotoError: primaryError,
      contextCloseError: new Error('context close failed'),
      browserCloseError: new Error('browser close failed'),
    });

    await assert.rejects(
      () => extractBodyWithBrowser('https://example.com/article', deps),
      primaryError,
    );
    assert.equal(calls.contextClose, 1);
    assert.equal(calls.browserClose, 1);
    assert.equal(calls.cleanup, 1);
  });

  it('rejects unsafe URLs before launching Chromium', async () => {
    let launchCalls = 0;
    const { deps } = createBrowserDeps({ articleText: 'safe body' });
    deps.launch = async () => {
      launchCalls += 1;
      throw new Error('must not launch');
    };

    await assert.rejects(() => extractBodyWithBrowser('http://127.0.0.1/private', deps));
    assert.equal(launchCalls, 0);
  });

  it('rejects a public hostname resolving to loopback before launching Chromium', async () => {
    const { calls, deps } = createBrowserDeps({
      articleText: 'safe body',
      resolvedAddress: '127.0.0.1',
    });

    await assert.rejects(() => extractBodyWithBrowser('https://example.com/article', deps));
    assert.equal(calls.launch, 0);
  });

  it('aborts a browser subrequest whose hostname resolves to a private address', async () => {
    const { calls, deps } = createBrowserDeps({
      articleText: 'A'.repeat(200),
      subrequestUrl: 'http://127.0.0.1/internal',
    });

    await extractBodyWithBrowser('https://example.com/article', deps);
    assert.equal(calls.routeAbort, 1);
    assert.equal(calls.routeContinue, 0);
  });
});

describe('browser extraction config', () => {
  it('can be disabled explicitly', () => {
    const previous = process.env.NEWS_INTEL_BROWSER_ENABLED;
    process.env.NEWS_INTEL_BROWSER_ENABLED = 'false';
    try {
      assert.equal(isBrowserExtractionEnabled(), false);
    } finally {
      if (previous === undefined) delete process.env.NEWS_INTEL_BROWSER_ENABLED;
      else process.env.NEWS_INTEL_BROWSER_ENABLED = previous;
    }
  });

  it('prefers the configured Chromium executable path', () => {
    const previous = process.env.CHROMIUM_EXECUTABLE_PATH;
    process.env.CHROMIUM_EXECUTABLE_PATH = '/custom/chromium';
    try {
      assert.equal(getChromiumExecutablePath(), '/custom/chromium');
    } finally {
      if (previous === undefined) delete process.env.CHROMIUM_EXECUTABLE_PATH;
      else process.env.CHROMIUM_EXECUTABLE_PATH = previous;
    }
  });
});

describe('extractArticleBody browser fallback', () => {
  it('does not call the browser when browser extraction is disabled', async () => {
    let browserCalls = 0;

    const result = await extractArticleBody('https://example.com/article', undefined, {
      fetch: async () => new Response('', { status: 404 }),
      isJinaEnabled: () => false,
      isBrowserEnabled: () => false,
      extractWithBrowser: async () => {
        browserCalls += 1;
        return 'browser body';
      },
    });

    assert.equal(result, undefined);
    assert.equal(browserCalls, 0);
  });

  it('validates the source URL before the ordinary fetch', async () => {
    let fetchCalls = 0;

    await assert.rejects(() =>
      extractArticleBody('http://127.0.0.1/private', undefined, {
        fetch: async () => {
          fetchCalls += 1;
          return new Response('private');
        },
        isJinaEnabled: () => false,
        isBrowserEnabled: () => false,
        extractWithBrowser: async () => undefined,
      }),
    );
    assert.equal(fetchCalls, 0);
  });

  it('stops ordinary body extraction after the 5 MiB response limit', async () => {
    const chunks = [new Uint8Array(3 * 1024 * 1024), new Uint8Array(3 * 1024 * 1024)];
    const result = await extractArticleBody('https://example.com/article', undefined, {
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              const chunk = chunks.shift();
              if (chunk) controller.enqueue(chunk);
              else controller.close();
            },
          }),
        ),
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      isJinaEnabled: () => false,
      isBrowserEnabled: () => false,
      extractWithBrowser: async () => undefined,
    });

    assert.equal(result, undefined);
  });
});

describe('RSS source URL safety', () => {
  it('rejects an unsafe source URL before fetch', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        '<rss><channel><item><title>News</title><link>https://example.com/a</link></item></channel></rss>',
      );
    }) as typeof fetch;

    try {
      await assert.rejects(() => fetchRssFeed('http://127.0.0.1/private', 'rss'));
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
