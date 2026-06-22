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
