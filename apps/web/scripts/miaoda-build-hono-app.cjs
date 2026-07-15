/**
 * 妙搭：当 hono-app 仅有 *.ts 时，生成 nest 可用的 *.js（CJS 变换，同 zip:miaoda）。
 */
const { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('fs');
const { dirname, join, relative } = require('path');
const ts = require('typescript');

const SKIP_DIRS = new Set(['modules', 'scripts', '_db']);
const SKIP_FILE = /\.test\.ts$/;

function transformServerFileForMiaoda(content, relativePath) {
  let result = relativePath === 'index.ts' ? transformHonoIndex(content) : content;

  if (relativePath !== 'index.ts') {
    result = stripImportMetaDirname(result);
    // 保留 .js 后缀，供 Node ESM dynamic import 解析相对路径
  }

  return rewriteScmDbImports(result, relativePath);
}

function rewriteScmDbImports(content, relativePath) {
  const depth = (relativePath.match(/\//g) ?? []).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);

  return content
    .replace(/from '@scm\/db\/fee-display-priority'/g, `from '${prefix}_db/fob-fee-display-priority.js'`)
    .replace(/from "@scm\/db\/fee-display-priority"/g, `from "${prefix}_db/fob-fee-display-priority.js"`)
    .replace(/from '@scm\/db\/password'/g, `from '${prefix}_db/password.js'`)
    .replace(/from "@scm\/db\/password"/g, `from "${prefix}_db/password.js"`)
    .replace(/from '@scm\/db'/g, `from '${prefix}_db/index.js'`)
    .replace(/from "@scm\/db"/g, `from "${prefix}_db/index.js"`);
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
    '',
  );
  result = result.replace(
    /const\s+__dirname\s*=\s*dirname\(fileURLToPath\(import\.meta\.url\)\);\s*\n?/g,
    '',
  );
  result = result.replace(/import\.meta\.dirname/g, '__dirname');
  return result;
}

function addJsExtensionToRelativeImports(content) {
  return content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(?<!\.js)(['"])/g,
    (_m, before, p, after) => `${before}${p}.js${after}`,
  );
}

function transpileTsToEsm(content, fileName) {
  const result = ts.transpileModule(content, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  });
  return result.outputText;
}

function ensureHonoAppPackageJson(honoAppDir) {
  const p = join(honoAppDir, 'package.json');
  writeFileSync(p, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  console.log('[miaoda-build-hono] wrote server/hono-app/package.json (type: module)');
}

function walkTsFilesInDir(dir, baseDir, onFile) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(baseDir, abs).replace(/\\/g, '/');
    const st = statSync(abs);

    if (st.isDirectory()) {
      walkTsFilesInDir(abs, baseDir, onFile);
      continue;
    }

    if (!entry.endsWith('.ts')) continue;
    if (SKIP_FILE.test(entry)) continue;

    onFile(abs, rel);
  }
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

const HONO_APP_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'node',
    strict: false,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
  },
  include: ['./**/*.ts'],
  exclude: ['./**/*.js', 'node_modules'],
};

function ensureHonoAppTsconfig(honoAppDir) {
  const p = join(honoAppDir, 'tsconfig.json');
  writeFileSync(p, `${JSON.stringify(HONO_APP_TSCONFIG, null, 2)}\n`);
  console.log('[miaoda-build-hono] wrote server/hono-app/tsconfig.json (ESLint project scope)');
}

function findIndexSource(honoAppDir, cwd) {
  const candidates = [
    join(cwd, 'source_package/server/index.ts'),
    join(cwd, 'server/index.ts'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, 'utf8');
    if (raw.includes('export default app') && raw.includes('new Hono()')) return p;
  }
  const honoTs = join(honoAppDir, 'index.ts');
  if (existsSync(honoTs)) {
    const raw = readFileSync(honoTs, 'utf8');
    if (raw.includes("from '@hono/node-server'") || raw.includes("from 'hono'")) return honoTs;
  }
  return null;
}

function purgeHonoJsFiles(honoAppDir) {
  if (!existsSync(honoAppDir)) return 0;
  let removed = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (entry === 'node_modules') continue;
        walk(abs);
        continue;
      }
      if (!entry.endsWith('.js') && !entry.endsWith('.js.map')) continue;
      rmSync(abs);
      removed++;
    }
  }

  walk(honoAppDir);
  if (removed > 0) {
    console.log(`[miaoda-build-hono] purged ${removed} stale .js file(s) under hono-app`);
  }
  return removed;
}

function assertHonoRouteSources(honoAppDir, indexSourcePath) {
  const indexRaw = readFileSync(indexSourcePath, 'utf8');
  const missing = [];

  for (const match of indexRaw.matchAll(/from\s+['"]\.\/(routes\/[^'"]+)\.js['"]/g)) {
    const relTs = `${match[1]}.ts`;
    if (!existsSync(join(honoAppDir, relTs))) missing.push(relTs);
  }

  if (missing.length > 0) {
    throw new Error(
      `hono-app missing route .ts (re-run: node source_package/scripts/miaoda-sync-to-server.js): ${missing.join(', ')}`,
    );
  }
}

function validateIndexNamedImports(honoAppDir, indexJsPath) {
  const indexJs = readFileSync(indexJsPath, 'utf8');
  const problems = [];

  for (const match of indexJs.matchAll(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"](\.\/[^'"]+)['"]/g)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const rel = match[2].replace(/^\.\//, '');
    const jsPath = join(honoAppDir, rel);

    if (!existsSync(jsPath)) {
      problems.push(`missing ${rel}`);
      continue;
    }

    const body = readFileSync(jsPath, 'utf8');
    for (const name of names) {
      const exported =
        new RegExp(`export\\s+(?:const|function|class|async function)\\s+${name}\\b`).test(body) ||
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(body);
      if (!exported) problems.push(`${rel} missing export ${name}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`hono-app export mismatch: ${problems.join('; ')}`);
  }
}

function transpileOneHonoFile(raw, relPath, absPathForTs = relPath) {
  return addJsExtensionToRelativeImports(
    transpileTsToEsm(transformServerFileForMiaoda(raw, relPath), absPathForTs),
  );
}

/** zip:miaoda 预生成 route/lib .js，妙搭无需再 transpile */
function generateHonoAppJsArtifacts(serverDir, dbSrcDir) {
  const artifacts = new Map();

  walkTsFiles(serverDir, serverDir, (absPath, relPath) => {
    if (relPath === 'index.ts') return;
    const raw = readFileSync(absPath, 'utf8');
    artifacts.set(relPath.replace(/\.ts$/, '.js'), transpileOneHonoFile(raw, relPath, absPath));
  });

  if (existsSync(dbSrcDir)) {
    walkTsFilesInDir(dbSrcDir, dbSrcDir, (absPath, relPath) => {
      const raw = readFileSync(absPath, 'utf8');
      artifacts.set(
        `_db/${relPath.replace(/\.ts$/, '.js')}`,
        addJsExtensionToRelativeImports(
          transpileTsToEsm(stripImportMetaDirname(raw), absPath),
        ),
      );
    });
  }

  return artifacts;
}

function buildHonoAppCjs(honoAppDir, dbSrcDir, cwd = process.cwd()) {
  const indexSource = findIndexSource(honoAppDir, cwd);
  if (!indexSource) {
    throw new Error(
      `hono-app index source not found (tried source_package/server/index.ts and ${honoAppDir}/index.ts)`,
    );
  }

  ensureDbVendored(honoAppDir, dbSrcDir);
  assertHonoRouteSources(honoAppDir, indexSource);
  purgeHonoJsFiles(honoAppDir);

  let count = 0;
  const indexOutPath = join(honoAppDir, 'index.js');

  try {
    const indexRaw = readFileSync(indexSource, 'utf8');
    const indexOut = addJsExtensionToRelativeImports(
      transpileTsToEsm(transformServerFileForMiaoda(indexRaw, 'index.ts'), indexSource),
    );
    if (!indexOut.includes('export default')) {
      throw new Error('transform produced no export default');
    }
    writeFileSync(indexOutPath, indexOut);
    count++;
    console.log(`[miaoda-build-hono] index.js from ${indexSource} (${indexOut.length} bytes)`);
  } catch (err) {
    const bundledIndex = join(cwd, 'source_package/miaoda/hono-app-index.generated.js');
    const existing = existsSync(indexOutPath) ? readFileSync(indexOutPath, 'utf8') : '';
    if (existing.includes('export default') && existing.length > 500) {
      console.warn(`[miaoda-build-hono] skip index.js (${err instanceof Error ? err.message : err})`);
    } else if (existsSync(bundledIndex)) {
      cpSync(bundledIndex, indexOutPath);
      count++;
      console.log(`[miaoda-build-hono] restored index.js from ${bundledIndex}`);
    } else if (existsSync(join(cwd, 'source_package/server/hono-app/index.js'))) {
      const zipIndex = join(cwd, 'source_package/server/hono-app/index.js');
      cpSync(zipIndex, indexOutPath);
      count++;
      console.log(`[miaoda-build-hono] restored index.js from ${zipIndex}`);
    } else {
      throw err;
    }
  }

  walkTsFiles(honoAppDir, honoAppDir, (absPath, relPath) => {
    if (relPath === 'index.ts') return;
    const raw = readFileSync(absPath, 'utf8');
    const transformed = transpileOneHonoFile(raw, relPath, absPath);
    const outRel = relPath.replace(/\.ts$/, '.js');
    const outPath = join(honoAppDir, outRel);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, transformed);
    count++;
  });

  const dbDir = join(honoAppDir, '_db');
  if (existsSync(dbDir)) {
    walkTsFilesInDir(dbDir, dbDir, (absPath, relPath) => {
      const raw = readFileSync(absPath, 'utf8');
      const transformed = addJsExtensionToRelativeImports(
        transpileTsToEsm(stripImportMetaDirname(raw), absPath),
      );
      const outPath = join(dbDir, relPath.replace(/\.ts$/, '.js'));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, transformed);
      count++;
    });
  }

  console.log(`[miaoda-build-hono] wrote ${count} .js files under ${honoAppDir}`);
  validateIndexNamedImports(honoAppDir, indexOutPath);
  console.log('[miaoda-build-hono] index.js imports validated');
  ensureHonoAppPackageJson(honoAppDir);
  ensureHonoAppTsconfig(honoAppDir);
  return count;
}

/** 妙搭常态：index.js 用 bundled 模板，仅编译 routes/lib 等子模块 .ts → .js */
function buildHonoAppRoutesOnly(honoAppDir, dbSrcDir, cwd = process.cwd()) {
  ensureDbVendored(honoAppDir, dbSrcDir);
  let count = 0;
  walkTsFiles(honoAppDir, honoAppDir, (absPath, relPath) => {
    if (relPath === 'index.ts') return;
    const raw = readFileSync(absPath, 'utf8');
    const transformed = transpileOneHonoFile(raw, relPath, absPath);
    const outPath = join(honoAppDir, relPath.replace(/\.ts$/, '.js'));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, transformed);
    count++;
  });

  const dbDir = join(honoAppDir, '_db');
  if (existsSync(dbDir)) {
    walkTsFilesInDir(dbDir, dbDir, (absPath, relPath) => {
      const raw = readFileSync(absPath, 'utf8');
      const transformed = addJsExtensionToRelativeImports(
        transpileTsToEsm(stripImportMetaDirname(raw), absPath),
      );
      const outPath = join(dbDir, relPath.replace(/\.ts$/, '.js'));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, transformed);
      count++;
    });
  }

  console.log(`[miaoda-build-hono] wrote ${count} route/lib/_db .js files (index.js untouched)`);
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

module.exports = {
  buildHonoAppCjs,
  buildHonoAppRoutesOnly,
  ensureDbVendored,
  generateHonoAppJsArtifacts,
  transpileOneHonoFile,
  purgeHonoJsFiles,
  validateIndexNamedImports,
};
