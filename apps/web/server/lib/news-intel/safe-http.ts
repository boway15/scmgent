import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  assertSafePublicHttpUrl,
  isPrivateIpAddress,
} from './url-safety.js';

export type DnsLookupResult = {
  address: string;
  family: number;
};

export type DnsLookup = (
  hostname: string,
) => Promise<readonly DnsLookupResult[]>;

export type SafeHttpDeps = {
  fetch?: typeof fetch;
  lookup?: DnsLookup;
  maxRedirects?: number;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultLookup: DnsLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function assertPublicHttpUrlResolved(
  raw: string,
  lookup: DnsLookup = defaultLookup,
): Promise<URL> {
  const url = assertSafePublicHttpUrl(raw);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname);

  if (!addresses.length) {
    throw new Error(`Public DNS resolution returned no addresses for ${hostname}`);
  }
  for (const result of addresses) {
    if (!isIP(result.address) || isPrivateIpAddress(result.address)) {
      throw new Error(`Private or invalid DNS address is not allowed for ${hostname}`);
    }
  }
  return url;
}

export async function safeFetchPublicHttp(
  raw: string,
  deps: SafeHttpDeps = {},
  init: RequestInit = {},
): Promise<Response> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const maxRedirects = deps.maxRedirects ?? 5;
  let current = raw;

  for (let redirects = 0; ; redirects += 1) {
    const safeUrl = await assertPublicHttpUrlResolved(current, lookup);
    const response = await fetchImpl(safeUrl.toString(), {
      ...init,
      redirect: 'manual',
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) {
      await response.body?.cancel('redirect location missing');
      throw new Error(`Redirect response ${response.status} is missing Location`);
    }
    if (redirects >= maxRedirects) {
      await response.body?.cancel('redirect limit exceeded');
      throw new Error(`HTTP redirect limit exceeded (${maxRedirects})`);
    }
    await response.body?.cancel('following validated redirect');
    current = new URL(location, safeUrl).toString();
  }
}

export async function readResponseTextLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error(`Response body size exceeds ${maxBytes} byte limit`);
    }
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel('response body size limit exceeded');
        throw new Error(`Response body size exceeds ${maxBytes} byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
