/**
 * 校验 zip:miaoda 打包前置条件（bundled index + routes 可编译为 ESM .js）
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformServerFileForMiaoda, HONO_APP_SKIP_DIRS, HONO_APP_SKIP_FILE } from './miaoda-cjs-transform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, '..');
const serverDir = join(webDir, 'server');

const issues = [];

const bundledPath = join(webDir, 'miaoda/hono-app-index.generated.js');
if (!existsSync(bundledPath)) {
  issues.push('missing miaoda/hono-app-index.generated.js');
} else {
  const bundled = readFileSync(bundledPath, 'utf8');
  if (!bundled.includes('export default')) issues.push('bundled index missing export default');
  if (bundled.length < 500) issues.push(`bundled index too small (${bundled.length} bytes)`);
  if (/:\s*Record</.test(bundled)) issues.push('bundled index contains TypeScript type syntax');
}

walk(serverDir);

if (issues.length) {
  console.error(`Miaoda hono-app validation failed (${issues.length}):`);
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

console.log('OK: Miaoda hono-app bundle + route transforms valid');
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
    if (rel === 'index.ts') continue;

    const out = transformServerFileForMiaoda(readFileSync(abs, 'utf8'), rel);

    if (out.includes('import.meta')) issues.push(`${rel}: transform still contains import.meta`);
    if (/@scm\/db/.test(out)) issues.push(`${rel}: still imports @scm/db`);
  }
}
