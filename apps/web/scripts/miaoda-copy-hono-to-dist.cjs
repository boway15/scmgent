/** nest build 后把 server/hono-app（CJS .js）复制到 dist/server/hono-app */
const { cpSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');

const cwd = process.cwd();
const src = join(cwd, 'server/hono-app');
const dest = join(cwd, 'dist/server/hono-app');

if (!existsSync(join(src, 'index.js'))) {
  console.error('[miaoda-copy-hono] missing server/hono-app/index.js — run miaoda-build-hono-app.cjs first');
  process.exit(1);
}

mkdirSync(join(cwd, 'dist/server'), { recursive: true });
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[miaoda-copy-hono] ${src} -> ${dest}`);
