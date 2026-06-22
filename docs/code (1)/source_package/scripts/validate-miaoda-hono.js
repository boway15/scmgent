/**
 * 校验 zip:miaoda 的 hono-app CJS 转换结果（本地运行，不打 ZIP）
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformServerFileForMiaoda, HONO_APP_SKIP_DIRS, HONO_APP_SKIP_FILE } from './miaoda-cjs-transform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = join(__dirname, '../server');

const issues = [];

walk(serverDir);

if (issues.length) {
  console.error(`hono-app transform issues (${issues.length}):`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

console.log('OK: hono-app transform passes Miaoda CJS checks');
process.exit(0);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (HONO_APP_SKIP_DIRS.has(entry)) continue;
      walk(abs);
      continue;
    }
    if (!entry.endsWith('.ts') || HONO_APP_SKIP_FILE.test(entry)) continue;

    const rel = relative(serverDir, abs).replace(/\\/g, '/');
    const out = transformServerFileForMiaoda(readFileSync(abs, 'utf8'), rel);

    if (out.includes('import.meta')) issues.push(`${rel}: contains import.meta`);
    if (/from ['"][^'"]+\.js['"]/.test(out)) issues.push(`${rel}: contains .js import suffix`);
    if (/@scm\/db/.test(out)) issues.push(`${rel}: still imports @scm/db (nest may not resolve)`);
    if (rel === 'index.ts' && /serveStaticFiles/.test(out)) {
      issues.push(`${rel}: still references serveStaticFiles`);
    }
  }
}
