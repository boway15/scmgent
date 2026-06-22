import { Module } from '@nestjs/common';
import { ScmHonoAppService } from './scm-hono-app.service';
import { ScmApiProxyController } from './scm-hono-proxy.controller';

/** 妙搭 NestJS 外壳挂载 Hono（勿改 main.ts） */
@Module({
  controllers: [ScmApiProxyController],
  providers: [ScmHonoAppService],
  exports: [ScmHonoAppService],
})
export class ScmHonoModule {
  /** 兼容旧 app.module 中的 ScmHonoModule.forRoot() */
  static forRoot() {
    return { module: ScmHonoModule };
  }
}
