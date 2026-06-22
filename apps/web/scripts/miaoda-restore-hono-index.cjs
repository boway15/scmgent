/** 当 index.js 被错误构建为 ~200 字节空壳时，从 bundled 模板恢复 */
const { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const cwd = process.cwd();
const dest = join(cwd, 'server/hono-app/index.js');
const pkgPath = join(cwd, 'server/hono-app/package.json');

const candidates = [
  join(cwd, 'source_package/miaoda/hono-app-index.generated.js'),
  join(cwd, 'miaoda/hono-app-index.generated.js'),
];

const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.error('[miaoda-restore-hono-index] missing hono-app-index.generated.js in source_package/miaoda/');
  process.exit(1);
}

mkdirSync(join(cwd, 'server/hono-app'), { recursive: true });
cpSync(src, dest);
writeFileSync(pkgPath, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

const content = readFileSync(dest, 'utf8');
console.log(`[miaoda-restore-hono-index] ${src} -> ${dest} (${content.length} bytes)`);
if (content.length < 500 || !content.includes('export default')) {
  console.error('[miaoda-restore-hono-index] restored file looks invalid');
  process.exit(1);
}
