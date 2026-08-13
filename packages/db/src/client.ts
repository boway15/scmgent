import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

/** 妙搭 / Serverless PG：从多种环境变量解析连接串 */
export function resolveDatabaseUrl(): string {
  const direct =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUDA_DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.PG_URL?.trim() ||
    process.env.DB_URL?.trim();
  if (direct) return direct;

  const host = process.env.PGHOST?.trim() || process.env.DB_HOST?.trim();
  const port = process.env.PGPORT?.trim() || process.env.DB_PORT?.trim() || '5432';
  const user = process.env.PGUSER?.trim() || process.env.DB_USER?.trim();
  const password = process.env.PGPASSWORD?.trim() || process.env.DB_PASSWORD?.trim();
  const database = process.env.PGDATABASE?.trim() || process.env.DB_NAME?.trim();

  if (host && user && database) {
    const auth = password
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);
    return `postgresql://${auth}@${host}:${port}/${database}`;
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('[db] DATABASE_URL not set; API will fail until platform PG env is injected');
  }
  return 'postgresql://scm:scm_dev_pass@127.0.0.1:5432/scm_dev';
}

/**
 * 连接池大小：
 * - 自建 Docker 导入与 HTTP 同进程，max=1 会让所有接口堵在导入 SQL 后面
 * - 妙搭 Serverless 仍默认 1
 * - 可用 DB_POOL_MAX 覆盖
 */
export function resolveDbPoolMax(
  env: NodeJS.Dict<string> = process.env,
): number {
  const raw = env.DB_POOL_MAX?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.min(parsed, 50);
  }
  if (env.RUNNING_IN_DOCKER === 'true') return 10;
  return env.NODE_ENV === 'production' ? 1 : 10;
}

/** 妙搭 Serverless PG 兼容：prepare:false 适配连接池 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: resolveDbPoolMax(),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return drizzle(client, { schema });
}

type Db = PostgresJsDatabase<typeof schema>;

let dbInstance: Db | null = null;

function getDbInstance(): Db {
  if (!dbInstance) {
    const url = resolveDatabaseUrl();
    console.log(`[db] connecting (${url.replace(/:[^:@/]+@/, ':***@')})`);
    dbInstance = createDb(url);
  }
  return dbInstance;
}

/** 延迟连接：避免 NestJS 挂载 Hono 时环境变量尚未就绪 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const instance = getDbInstance();
    const value = Reflect.get(instance as object, prop, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});
