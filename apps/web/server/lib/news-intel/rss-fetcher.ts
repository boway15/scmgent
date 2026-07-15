import type { RssItem } from './types.js';
import { getRsshubBaseUrl } from './config.js';
import { normalizeNewsUrl, stripHtml } from './url-normalize.js';

const FETCH_TIMEOUT_MS = 30_000;

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
    });
  }

  return items;
}

export function resolveFeedUrl(feedUrl: string, sourceType: string): string {
  if (sourceType !== 'rsshub') return feedUrl;
  const base = getRsshubBaseUrl();
  if (!base) return feedUrl;
  if (feedUrl.startsWith('http://') || feedUrl.startsWith('https://')) return feedUrl;
  const path = feedUrl.startsWith('/') ? feedUrl : `/${feedUrl}`;
  return `${base}${path}`;
}

export async function fetchRssFeed(feedUrl: string, sourceType: string): Promise<RssItem[]> {
  const url = resolveFeedUrl(feedUrl, sourceType);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'scm-agent-news-intel/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`RSS fetch failed ${res.status} for ${url}`);
  }

  const xml = await res.text();
  const items = parseRssOrAtom(xml);
  if (!items.length) {
    throw new Error(`RSS parse returned 0 items for ${url}`);
  }
  return items;
}

export function parseRssPubDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
