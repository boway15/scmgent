import { getNewsIntelMaxBodyChars, isJinaReaderEnabled } from './config.js';
import { stripHtml } from './url-normalize.js';

const FETCH_TIMEOUT_MS = 25_000;

export async function extractArticleBody(
  url: string,
  rssContent?: string,
): Promise<string | undefined> {
  if (rssContent && stripHtml(rssContent).length >= 120) {
    return stripHtml(rssContent).slice(0, getNewsIntelMaxBodyChars());
  }

  if (isJinaReaderEnabled()) {
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const res = await fetch(jinaUrl, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.length >= 80) return text.slice(0, getNewsIntelMaxBodyChars());
      }
    } catch {
      // fallback below
    }
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'scm-agent-news-intel/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const html = await res.text();
    const text = stripHtml(html);
    return text.length >= 80 ? text.slice(0, getNewsIntelMaxBodyChars()) : undefined;
  } catch {
    return undefined;
  }
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
