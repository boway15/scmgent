/**
 * 妙搭：当 hono-app 仅有 *.ts 时，生成 nest 可用的 *.js（CJS 变换，同 zip:miaoda）。
 */
const { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require('fs');
const { dirname, join, relative } = require('path');

const SKIP_DIRS = new Set(['modules', 'scripts', '_db']);
const SKIP_FILE = /\.test\.ts$/;

function transformServerFileForMiaoda(content, relativePath) {
  let result = relativePath === 'index.ts' ? transformHonoIndex(content) : content;

  if (relativePath !== 'index.ts') {
    result = stripImportMetaDirname(result);
    result = stripJsImportSuffixes(result);
  }

  return rewriteScmDbImports(result, relativePath);
}

function rewriteScmDbImports(content, relativePath) {
  const depth = (relativePath.match(/\//g) ?? []).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);

  return content
    .replace(/from '@scm\/db\/fee-display-priority'/g, `from '${prefix}_db/fob-fee-display-priority'`)
    .replace(/from "@scm\/db\/fee-display-priority"/g, `from "${prefix}_db/fob-fee-display-priority"`)
    .replace(/from '@scm\/db'/g, `from '${prefix}_db'`)
    .replace(/from "@scm\/db"/g, `from "${prefix}_db"`);
}

function transformHonoIndex(content) {
  const lines = content.split('\n');
  const rest = [];
  let i = 0;

  if (lines[i]?.includes("from 'dotenv'") || lines[i]?.includes('from "dotenv"')) {
    rest.push(lines[i]);
    i++;
  }

  rest.push("import { join } from 'path';", '');
  rest.push('const cwd = process.cwd();');
  rest.push("config({ path: join(cwd, '.env') });");
  rest.push("config({ path: join(cwd, 'source_package/.env') });");
  rest.push('');

  while (i < lines.length && !lines[i].includes("from '@hono/node-server'")) {
    i++;
  }

  let body = lines.slice(i).join('\n');
  body = stripJsImportSuffixes(body);
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

  return rest.join('\n') + body;
}

function stripMiaodaServeCode(body) {
  return body
    .replace(/import \{ serve \} from '@hono\/node-server';\n/, '')
    .replace(/import \{ serveStatic \} from '@hono\/node-server\/serve-static';\n/, '')
    .replace(/import \{ cors \} from 'hono\/cors';\n/, '')
    .replace(/const serveStaticFiles = process\.env\.SERVE_STATIC === 'true';\n/, '')
    .replace(/const distRoot = join\(cwd, 'dist\/client'\);\n\n/, '')
    .replace(/if \(serveStaticFiles\) \{\n[\s\S]*?\n\}\n\n/, '')
    .replace(/if \(!serveStaticFiles\) \{\n[\s\S]*?\n\}\n\n/, '');
}

function stripImportMetaDirname(content) {
  let result = content;
  result = result.replace(/import\s*\{\s*fileURLToPath\s*\}\s*from\s*['"]url['"];\s*\n?/g, '');
  result = result.replace(
    /import\s*\{\s*dirname,\s*fileURLToPath\s*\}\s*from\s*['"]url['"];\s*\n?/g,
    '',
  );
  result = result.replace(
    /const\s+__dirname\s*=\s*dirname\(fileURLToPath\(import\.meta\.url\)\);\s*\n?/g,
    '',
  );
  result = result.replace(/import\.meta\.dirname/g, '__dirname');
  return result;
}

function stripJsImportSuffixes(content) {
  return content.replace(/from\s+(['"])(\.\.?\/[^'"]+)\.js\1/g, 'from $1$2$1');
}

function walkTsFiles(dir, baseDir, onFile) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(baseDir, abs).replace(/\\/g, '/');
    const st = statSync(abs);

    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walkTsFiles(abs, baseDir, onFile);
      continue;
    }

    if (!entry.endsWith('.ts')) continue;
    if (SKIP_FILE.test(entry)) continue;

    onFile(abs, rel);
  }
}

function ensureDbVendored(honoAppDir, dbSrcDir) {
  const dest = join(honoAppDir, '_db');
  if (!existsSync(dbSrcDir)) {
    console.log(`[miaoda-build-hono] skip _db (missing ${dbSrcDir})`);
    return;
  }
  if (existsSync(dest)) return;
  cpSync(dbSrcDir, dest, { recursive: true });
  console.log(`[miaoda-build-hono] vendored _db from ${dbSrcDir}`);
}

function buildHonoAppCjs(honoAppDir, dbSrcDir) {
  if (!existsSync(join(honoAppDir, 'index.ts'))) {
    throw new Error(`hono-app/index.ts not found in ${honoAppDir}`);
  }

  ensureDbVendored(honoAppDir, dbSrcDir);

  let count = 0;
  walkTsFiles(honoAppDir, honoAppDir, (absPath, relPath) => {
    const raw = readFileSync(absPath, 'utf8');
    const transformed = transformServerFileForMiaoda(raw, relPath);
    const outRel = relPath.replace(/\.ts$/, '.js');
    const outPath = join(honoAppDir, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, transformed);
    count++;
  });

  console.log(`[miaoda-build-hono] wrote ${count} .js files under ${honoAppDir}`);
  return count;
}

if (require.main === module) {
  const cwd = process.cwd();
  const honoDir = join(cwd, 'server/hono-app');
  const dbSrc = join(cwd, 'packages/db/src');
  buildHonoAppCjs(honoDir, dbSrc);
  if (!existsSync(join(honoDir, 'index.js'))) {
    process.exitCode = 1;
  }
}

module.exports = { buildHonoAppCjs, ensureDbVendored };
