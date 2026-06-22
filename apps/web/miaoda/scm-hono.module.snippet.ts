// 目标路径：server/modules/scm-hono/scm-hono.module.ts
// 同目录：scm-hono-bridge.ts、scm-hono-app.service.ts、scm-hono-proxy.controller.ts

import { Module } from '@nestjs/common';
import { ScmHonoAppService } from './scm-hono-app.service';
import { ScmApiProxyController } from './scm-hono-proxy.controller';

@Module({
  controllers: [ScmApiProxyController],
  providers: [ScmHonoAppService],
  exports: [ScmHonoAppService],
})
export class ScmHonoModule {
  static forRoot() {
    return { module: ScmHonoModule };
  }
}
