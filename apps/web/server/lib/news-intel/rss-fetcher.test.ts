import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchRssFeed } from './rss-fetcher.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('fetchRssFeed', () => {
  it('preserves the original publisher URL exposed by news aggregators', async () => {
    const [item] = await fetchRssFeed(
      'https://news.google.com/rss/search?q=amazon',
      'query_feed',
      {
        lookup: publicLookup,
        fetch: async () =>
          new Response(`
            <rss><channel><item>
              <title>Amazon seller policy update</title>
              <link>https://news.google.com/rss/articles/example</link>
              <source url="https://sellercentral.amazon.com/">Amazon Seller Central</source>
            </item></channel></rss>
          `),
      },
    );
    assert.equal(item?.sourceUrl, 'https://sellercentral.amazon.com/');
  });

  it('rejects RSS responses larger than 2 MiB before parsing', async () => {
    await assert.rejects(
      () =>
        fetchRssFeed('https://example.com/feed', 'rss', {
          lookup: publicLookup,
          fetch: async () =>
            new Response('<rss />', {
              headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
            }),
        }),
      /size|limit|large/i,
    );
  });

  it('treats a valid empty Google News channel as zero items, not a parse failure', async () => {
    const items = await fetchRssFeed(
      'https://news.google.com/rss/search?q=Wayfair+partner+home+OR+seller+policy+when:7d&hl=en-US&gl=US&ceid=US:en',
      'rss',
      {
        lookup: publicLookup,
        fetch: async () =>
          new Response(
            `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Wayfair - Google News</title><item></item></channel></rss>`.replace(
              '<item></item>',
              '',
            ),
          ),
      },
    );
    assert.deepEqual(items, []);
  });
});
