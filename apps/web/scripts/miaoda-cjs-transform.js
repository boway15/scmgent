/**
 * 将本地 ESM Hono 源码转为妙搭 nest build（CJS）可用的 hono-app 副本。
 * 仅用于 zip:miaoda，不修改 apps/web/server/ 源文件。
 */

/** @param {string} content @param {string} relativePath 相对 server/ 的路径 */
export function transformServerFileForMiaoda(content, relativePath) {
  let result = relativePath === 'index.ts' ? transformHonoIndex(content) : content;

  if (relativePath !== 'index.ts') {
    result = stripImportMetaDirname(result);
    // 保留 .js 后缀，供 Node ESM dynamic import 解析相对路径
  }

  result = rewriteScmDbImports(result, relativePath);
  return result;
}

/** nest build 不编译 node_modules 内 .ts；将 @scm/db 改为 hono-app 内 ./_db 相对路径 */
function rewriteScmDbImports(content, relativePath) {
  const depth = (relativePath.match(/\//g) ?? []).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);

  return content
    .replace(/from '@scm\/db\/fee-display-priority'/g, `from '${prefix}_db/fob-fee-display-priority.js'`)
    .replace(/from "@scm\/db\/fee-display-priority"/g, `from "${prefix}_db/fob-fee-display-priority.js"`)
    .replace(/from '@scm\/db'/g, `from '${prefix}_db/index.js'`)
    .replace(/from "@scm\/db"/g, `from "${prefix}_db/index.js"`);
}

function transformHonoIndex(content) {
  const lines = content.split('\n');
  const rest = [];
  let i = 0;

  // 保留 dotenv import，跳过 fileURLToPath / import.meta __dirname 块
  if (lines[i]?.includes("from 'dotenv'") || lines[i]?.includes('from "dotenv"')) {
    rest.push(lines[i]);
    i++;
  }

  rest.push("import { join } from 'path';", '');
  rest.push('const cwd = process.cwd();');
  rest.push("config({ path: join(cwd, '.env') });");
  rest.push("config({ path: join(cwd, 'source_package/.env') });");
  rest.push('');

  // 跳过 path/url import 与 __dirname 定义、原 dotenv config 块，直到 Hono 主体
  const anchors = [
    "from '@hono/node-server'",
    "from 'hono'",
    'import { Hono }',
  ];
  while (i < lines.length && !anchors.some((a) => lines[i].includes(a))) {
    i++;
  }
  if (i >= lines.length) {
    throw new Error('transformHonoIndex: no Hono anchor in index.ts');
  }

  let body = lines.slice(i).join('\n');
  body = rewriteScmDbImports(body, 'index.ts');
  body = body.replace(
    /const distRoot = join\(__dirname, '\.\.\/dist'\);/,
    "const distRoot = join(cwd, 'dist/client');",
  );
  body = body.replace(
    /\/\*\* 本地\/Docker[\s\S]*$/m,
    '/** 妙搭：由 ScmHonoModule 挂载，不在此文件 serve() */\n',
  );
  body = stripMiaodaServeCode(body);
  body = body.replace(/const payload:\s*Record<[^>]+>\s*=\s*/g, 'const payload = ');

  return rest.join('\n') + body;
}

/** 妙搭 SERVE_STATIC=false，NestJS 托管静态；剔除直启 serve / 静态 / 开发 cors 块 */
function stripMiaodaServeCode(body) {
  return body
    .replace(/import \{ serve \} from '@hono\/node-server';\n/, '')
    .replace(/import \{ serveStatic \} from '@hono\/node-server\/serve-static';\n/, '')
    .replace(/import \{ cors \} from 'hono\/cors';\n/, '')
    .replace(/const serveStaticFiles = process\.env\.SERVE_STATIC === 'true';\n/, '')
    .replace(/const distRoot = join\(cwd, 'dist\/client'\);\n\n/, '')
    .replace(/if \(serveStaticFiles\) \{\n[\s\S]*?\n\}\n\n/, '')
    .replace(/if \(!serveStaticFiles\) \{\n[\s\S]*?\n\}\n\n/, '')
    .replace(/\nconst entryScript[\s\S]*?^}\n?/m, '\n');
}

function stripImportMetaDirname(content) {
  let result = content;
  result = result.replace(/import\s*\{\s*fileURLToPath\s*\}\s*from\s*['"]url['"];\s*\n?/g, '');
  result = result.replace(
    /import\s*\{\s*dirname,\s*fileURLToPath\s*\}\s*from\s*['"]url['"];\s*\n?/g,
    '');
  result = result.replace(
    /const\s+__dirname\s*=\s*dirname\(fileURLToPath\(import\.meta\.url\)\);\s*\n?/g,
    '');
  result = result.replace(/import\.meta\.dirname/g, '__dirname');
  result = result.replace(
    /import\s*\{\s*join,\s*dirname\s*\}\s*from\s*['"]path['"];/g,
    "import { join, dirname } from 'path';",
  );
  // 若 dirname 仅用于已删除的 import.meta 行，可保留 import 不变
  return result;
}

function stripJsImportSuffixes(content) {
  return content.replace(/from\s+(['"])(\.\.?\/[^'"]+)\.js\1/g, 'from $1$2$1');
}

export const HONO_APP_SKIP_DIRS = new Set(['modules', 'scripts']);
export const HONO_APP_SKIP_FILE = /\.test\.ts$/;
