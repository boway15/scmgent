import { extractBodyWithBrowser } from './browser-extract.js';
import {
  getNewsIntelMaxBodyChars,
  isBrowserExtractionEnabled,
  isJinaReaderEnabled,
} from './config.js';
import {
  readResponseTextLimited,
  safeFetchPublicHttp,
  type DnsLookup,
} from './safe-http.js';
import { stripHtml } from './url-normalize.js';
import { assertSafePublicHttpUrl } from './url-safety.js';

const FETCH_TIMEOUT_MS = 25_000;
const BODY_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface BodyExtractDeps {
  fetch: typeof fetch;
  lookup?: DnsLookup;
  isJinaEnabled: () => boolean;
  isBrowserEnabled: () => boolean;
  extractWithBrowser: (url: string) => Promise<string | undefined>;
}

const defaultDeps: BodyExtractDeps = {
  fetch: globalThis.fetch,
  isJinaEnabled: isJinaReaderEnabled,
  isBrowserEnabled: isBrowserExtractionEnabled,
  extractWithBrowser: extractBodyWithBrowser,
};

export async function extractArticleBody(
  url: string,
  rssContent?: string,
  deps: BodyExtractDeps = defaultDeps,
): Promise<string | undefined> {
  if (rssContent && stripHtml(rssContent).length >= 120) {
    return stripHtml(rssContent).slice(0, getNewsIntelMaxBodyChars());
  }

  if (deps.isJinaEnabled()) {
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const res = await safeFetchPublicHttp(jinaUrl, {
        fetch: deps.fetch,
        lookup: deps.lookup,
      }, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = (await readResponseTextLimited(res, BODY_MAX_RESPONSE_BYTES)).trim();
        if (text.length >= 80) return text.slice(0, getNewsIntelMaxBodyChars());
      }
    } catch {
      // fallback below
    }
  }

  const safeSourceUrl = assertSafePublicHttpUrl(url);
  try {
    const res = await safeFetchPublicHttp(safeSourceUrl.toString(), {
      fetch: deps.fetch,
      lookup: deps.lookup,
    }, {
      headers: { 'User-Agent': 'scm-agent-news-intel/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const html = await readResponseTextLimited(res, BODY_MAX_RESPONSE_BYTES);
      const text = stripHtml(html);
      if (text.length >= 80) return text.slice(0, getNewsIntelMaxBodyChars());
    }
  } catch {
    // browser fallback below
  }

  if (deps.isBrowserEnabled()) {
    try {
      return await deps.extractWithBrowser(safeSourceUrl.toString());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function buildSummaryFallback(
  title: string,
  bodyText: string | undefined,
  snippet?: string,
): string {
  const source = bodyText?.trim() || snippet?.trim() || title;
  return source.slice(0, 280);
}

/**
 * 相关性硬过滤只用标题 + RSS 摘要/内容，避免 Jina 全文里的「相关推荐」
 * （如侧栏「物流分拣」）造成误放行。
 */
export function buildRelevanceProbeText(params: {
  title: string;
  snippet?: string;
  rssContent?: string;
}): string {
  const parts = [
    params.title,
    params.snippet?.trim() || '',
    params.rssContent ? stripHtml(params.rssContent) : '',
  ].filter(Boolean);
  return parts.join('\n').slice(0, 2_000);
}
