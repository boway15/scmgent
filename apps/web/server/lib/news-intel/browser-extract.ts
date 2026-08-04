import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  getChromiumExecutablePath,
  getNewsIntelMaxBodyChars,
} from './config.js';
import {
  assertPublicHttpUrlResolved,
  type DnsLookup,
} from './safe-http.js';

const NAVIGATION_TIMEOUT_MS = 20_000;
const MIN_BODY_CHARS = 80;
const BLOCKED_PAGE_PATTERN =
  /\b(?:captcha|access denied|sign in|log in|login required)\b|验证码|请登录|访问被拒绝/i;

interface BrowserPage {
  goto(
    url: string,
    options: { timeout: number; waitUntil: 'domcontentloaded' },
  ): Promise<unknown>;
  locator(selector: string): {
    innerText(): Promise<string>;
  };
}

interface BrowserContext {
  route(
    pattern: '**/*',
    handler: (route: {
      request(): { url(): string };
      abort(): Promise<void>;
      continue(): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface BrowserInstance {
  newContext(options: {
    acceptDownloads: false;
    serviceWorkers: 'block';
  }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserLaunchOptions {
  executablePath?: string;
  headless: true;
  downloadsPath: string;
}

export interface BrowserDeps {
  launch(options: BrowserLaunchOptions): Promise<BrowserInstance>;
  lookup?: DnsLookup;
  makeTempDir(): Promise<string>;
  removeTempDir(path: string): Promise<void>;
}

const defaultDeps: BrowserDeps = {
  launch: (options) =>
    chromium.launch(options) as unknown as Promise<BrowserInstance>,
  makeTempDir: () => mkdtemp(join(tmpdir(), 'scm-news-intel-')),
  removeTempDir: (path) => rm(path, { force: true, recursive: true }),
};

async function ignoreCleanupError(action: (() => Promise<void>) | undefined): Promise<void> {
  if (!action) return;
  try {
    await action();
  } catch {
    // Cleanup must never replace the extraction result or primary error.
  }
}

export async function extractBodyWithBrowser(
  rawUrl: string,
  deps: BrowserDeps = defaultDeps,
): Promise<string | undefined> {
  const url = (await assertPublicHttpUrlResolved(rawUrl, deps.lookup)).toString();
  let tempDir: string | undefined;
  let browser: BrowserInstance | undefined;
  let context: BrowserContext | undefined;

  try {
    tempDir = await deps.makeTempDir();
    browser = await deps.launch({
      executablePath: getChromiumExecutablePath(),
      headless: true,
      downloadsPath: tempDir,
    });
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    await context.route('**/*', async (route) => {
      try {
        await assertPublicHttpUrlResolved(route.request().url(), deps.lookup);
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    const page = await context.newPage();
    await page.goto(url, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });

    for (const selector of ['article', 'main', 'body']) {
      let text: string;
      try {
        text = (await page.locator(selector).innerText()).trim();
      } catch {
        continue;
      }
      if (BLOCKED_PAGE_PATTERN.test(text)) return undefined;
      if (text.length >= MIN_BODY_CHARS) {
        return text.slice(0, getNewsIntelMaxBodyChars());
      }
    }
    return undefined;
  } finally {
    await ignoreCleanupError(context ? () => context!.close() : undefined);
    await ignoreCleanupError(browser ? () => browser!.close() : undefined);
    await ignoreCleanupError(tempDir ? () => deps.removeTempDir(tempDir!) : undefined);
  }
}
