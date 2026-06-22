import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import type { HonoFetch } from './scm-hono-bridge';

function isRunnableHonoAppDir(dir: string): boolean {
  return (
    existsSync(join(dir, 'index.js')) &&
    existsSync(join(dir, 'package.json')) &&
    existsSync(join(dir, 'routes/auth.js'))
  );
}

@Injectable()
export class ScmHonoAppService implements OnModuleInit {
  private readonly logger = new Logger(ScmHonoAppService.name);
  private fetchHandler: HonoFetch | null = null;

  async onModuleInit() {
    const cwd = process.cwd();
    for (const envPath of [join(cwd, '.env'), join(cwd, 'source_package/.env')]) {
      if (existsSync(envPath)) loadEnv({ path: envPath });
    }

    const clientBasePath = process.env.CLIENT_BASE_PATH?.trim() || '(not set)';
    this.logger.log(`CLIENT_BASE_PATH=${clientBasePath}`);
    this.logger.log(
      `AUTH_DEV_MODE=${process.env.AUTH_DEV_MODE === 'true' ? 'true' : 'false'} FEISHU_OAUTH=${process.env.FEISHU_APP_ID ? 'configured' : 'off'}`,
    );

    const isProd = process.env.NODE_ENV === 'production';
    const candidates = [
      ...(isProd
        ? [
            join(__dirname, '../../hono-app/index.js'),
            join(cwd, 'dist/server/hono-app/index.js'),
            join(cwd, 'server/hono-app/index.js'),
          ]
        : [
            join(cwd, 'server/hono-app/index.js'),
            join(__dirname, '../../hono-app/index.js'),
            join(cwd, 'dist/server/hono-app/index.js'),
          ]),
      join(cwd, 'source_package/server/hono-app/index.js'),
      join(cwd, 'server/hono-app/index.ts'),
      join(cwd, 'source_package/server/index.ts'),
      join(cwd, 'server/index.ts'),
    ];

    const seen = new Set<string>();
    const entry = candidates.find((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      if (!existsSync(p)) return false;
      return isRunnableHonoAppDir(join(p, '..'));
    });

    if (!entry) {
      this.logger.error(
        `Hono entry not found (need index.js + package.json + routes/auth.js). Tried: ${[...seen].join(', ')}`,
      );
      return;
    }

    try {
      const mod = await import(entry);
      const honoApp = mod.default;
      if (!honoApp?.fetch) {
        this.logger.error('Hono default export has no fetch');
        return;
      }
      this.fetchHandler = honoApp.fetch.bind(honoApp);
      this.logger.log(`SCM Hono loaded from ${entry}`);
      this.logger.log(`Hono request URL mode: CLIENT_BASE_PATH=${process.env.CLIENT_BASE_PATH?.trim() || '(not set)'}`);
    } catch (err) {
      this.logger.error(
        `Failed to load SCM Hono from ${entry}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  getFetch(): HonoFetch {
    if (!this.fetchHandler) {
      throw new Error('SCM Hono is not loaded');
    }
    return this.fetchHandler;
  }

  isReady(): boolean {
    return this.fetchHandler !== null;
  }
}
