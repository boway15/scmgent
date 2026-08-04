import type { RssItem } from './types.js';
import { normalizeNewsUrl, stripHtml } from './url-normalize.js';
import {
  readResponseTextLimited,
  safeFetchPublicHttp,
  type SafeHttpDeps,
} from './safe-http.js';

const FETCH_TIMEOUT_MS = 30_000;
const RSS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function extractTag(block: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = block.match(cdata);
  if (cdataMatch?.[1]) return decodeXmlEntities(cdataMatch[1].trim());

  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const plainMatch = block.match(plain);
  if (plainMatch?.[1]) return decodeXmlEntities(stripHtml(plainMatch[1]).trim());
  return undefined;
}

function extractLink(block: string): string | undefined {
  const alt = extractTag(block, 'link');
  if (alt) return alt;
  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return hrefMatch?.[1];
}

function extractSourceUrl(block: string): string | undefined {
  const match = block.match(/<source[^>]+url=["']([^"']+)["']/i);
  return match?.[1] ? decodeXmlEntities(match[1].trim()) : undefined;
}

function parseRssOrAtom(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi),
  ];

  for (const match of blocks) {
    const block = match[1] ?? '';
    const title = extractTag(block, 'title');
    const link = extractLink(block);
    if (!title || !link) continue;

    const pubDate =
      extractTag(block, 'pubDate') ??
      extractTag(block, 'published') ??
      extractTag(block, 'updated');
    const content =
      extractTag(block, 'content:encoded') ??
      extractTag(block, 'content') ??
      extractTag(block, 'description') ??
      extractTag(block, 'summary');
    const snippet = content ? stripHtml(content).slice(0, 500) : undefined;

    items.push({
      title,
      link: normalizeNewsUrl(link),
      pubDate,
      content,
      contentSnippet: snippet,
      sourceUrl: extractSourceUrl(block),
    });
  }

  return items;
}

export async function fetchRssFeed(
  feedUrl: string,
  _sourceType: string,
  deps: SafeHttpDeps = {},
): Promise<RssItem[]> {
  const res = await safeFetchPublicHttp(feedUrl, deps, {
    headers: {
      'User-Agent': 'scm-agent-news-intel/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`RSS fetch failed ${res.status} for ${feedUrl}`);
  }

  const xml = await readResponseTextLimited(res, RSS_MAX_RESPONSE_BYTES);
  // Google News / query feeds frequently return a valid empty <channel>; treat as zero results.
  return parseRssOrAtom(xml);
}

export function parseRssPubDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
