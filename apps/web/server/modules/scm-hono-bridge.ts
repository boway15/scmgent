import { Readable } from 'node:stream';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export type HonoFetch = (request: Request) => globalThis.Response | Promise<globalThis.Response>;

export async function proxyHonoFetch(
  fetchHandler: HonoFetch,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  const response = await fetchHandler(buildFetchRequest(req));
  await writeFetchResponse(res, response);
}

/** 剥掉妙搭 CLIENT_BASE_PATH，Hono 路由统一在 /api/* */
export function stripClientBaseFromPath(pathOnly: string): string {
  const base = (process.env.CLIENT_BASE_PATH || '').trim().replace(/\/$/, '');
  if (base && pathOnly.startsWith(base)) {
    const rest = pathOnly.slice(base.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  const miaoda = pathOnly.match(/^\/app\/app_[^/]+(\/.*)$/);
  if (miaoda) return miaoda[1];
  return pathOnly;
}

export function resolveHonoRequestUrl(req: ExpressRequest): string {
  const host = `${req.protocol}://${req.get('host')}`;
  const raw = req.originalUrl || req.url || '/';
  const qIndex = raw.indexOf('?');
  const pathOnly = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const qs = qIndex >= 0 ? raw.slice(qIndex) : '';
  return `${host}${stripClientBaseFromPath(pathOnly)}${qs}`;
}

export function buildFetchRequest(req: ExpressRequest): Request {
  const url = resolveHonoRequestUrl(req);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }

  return new Request(url, init);
}

export async function writeFetchResponse(res: ExpressResponse, response: globalThis.Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  if (response.status === 204 || response.status === 304) {
    res.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
