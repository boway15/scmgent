import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { proxyHonoFetch, type HonoFetch } from './scm-hono-bridge';

/**
 * @deprecated 妙搭上 ViewController catch-all 先于 Express app.use()；请用 ScmHonoModule.forRoot() + HonoProxyController
 */
export function createHonoExpressMiddleware(fetchHandler: HonoFetch) {
  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    proxyHonoFetch(fetchHandler, req, res).catch(next);
  };
}

export { proxyHonoFetch, buildFetchRequest, writeFetchResponse, type HonoFetch } from './scm-hono-bridge';
