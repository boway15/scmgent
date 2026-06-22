import { All, Controller, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { proxyHonoFetch } from './scm-hono-bridge';
import { ScmHonoAppService } from './scm-hono-app.service';

/**
 * NestJS 路由层代理 /api/*（配合平台 global prefix = CLIENT_BASE_PATH）。
 * 比 Express app.use() / 纯中间件更可靠（ViewController 之前注册 ScmHonoModule）。
 */
@Controller('api')
export class ScmApiProxyController {
  constructor(private readonly honoApp: ScmHonoAppService) {}

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    if (!this.honoApp.isReady()) {
      throw new ServiceUnavailableException('SCM Hono is not loaded');
    }
    await proxyHonoFetch(this.honoApp.getFetch(), req, res);
  }
}
