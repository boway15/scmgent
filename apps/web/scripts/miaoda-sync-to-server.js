/**
 * 妙搭导入后：将 source_package 内的 Hono / scm-hono / db 同步到平台编译树，
 * 并自动 patch server/app.module.ts 注册 ScmHonoModule。
 *
 * 触发方式（任选）：
 * 1. 导入后手动：node source_package/scripts/miaoda-sync-to-server.js
 * 2. 平台 package.json prebuild（脚本会自动尝试写入）
 */
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');

function loadHonoAppBuilder() {
  const candidates = [
    join(__dirname, 'miaoda-build-hono-app.cjs'),
    join(process.cwd(), 'source_package/scripts/miaoda-build-hono-app.cjs'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return require(p);
  }
  return null;
}

const cwd = process.cwd();

function main() {
  const sourceRoot = resolveSourceRoot(cwd);
  console.log(`[miaoda-sync] cwd=${cwd}`);
  console.log(`[miaoda-sync] sourceRoot=${sourceRoot}`);

  const copies = [
    [join(sourceRoot, 'client'), join(cwd, 'client')],
    [join(sourceRoot, 'server/hono-app'), join(cwd, 'server/hono-app')],
    [join(sourceRoot, 'server/modules/scm-hono'), join(cwd, 'server/modules/scm-hono')],
    [join(sourceRoot, 'packages/db'), join(cwd, 'packages/db')],
  ];

  let copied = 0;
  for (const [src, dest] of copies) {
    if (copyDir(src, dest)) copied++;
  }

  if (copied === 0) {
    console.warn('[miaoda-sync] nothing copied — check source_package/server/hono-app exists');
  }

  ensureHonoAppRuntime(join(cwd, 'server/hono-app'), join(sourceRoot, 'packages/db/src'), sourceRoot);
  validateClientRuntime(join(cwd, 'client'));

  patchTsconfigBuildExclude(cwd);
  runNestBuildFix(cwd);
  patchAppModule(join(cwd, 'server/app.module.ts'));
  removeServeStaticModulePatch(join(cwd, 'server/app.module.ts'));
  runPrecommitPatches(cwd);
  ensurePlatformPrebuild(cwd);
  ensureBuildServerCopiesHono(cwd);
  patchNestCliHonoAssets(cwd);

  console.log('[miaoda-sync] done');
}

/** nest build 之后：把 server/hono-app 复制到 dist/server/hono-app（修复 503） */
function copyHonoToDist(root = process.cwd()) {
  const src = join(root, 'server/hono-app');
  const dest = join(root, 'dist/server/hono-app');

  if (!existsSync(join(src, 'index.js'))) {
    console.error('[miaoda-sync] copyHonoToDist: missing server/hono-app/index.js — run miaoda-build-hono-app.cjs first');
    return false;
  }

  mkdirSync(join(root, 'dist/server'), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[miaoda-sync] hono-app copied ${src} -> ${dest}`);
  return true;
}

function resolveSourceRoot(root) {
  const nested = join(root, 'source_package');
  if (existsSync(join(nested, 'server/hono-app'))) return nested;
  if (existsSync(join(root, 'server/hono-app'))) return root;
  return nested;
}

function copyDir(src, dest) {
  if (!existsSync(src)) {
    console.log(`[miaoda-sync] skip (missing): ${src}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[miaoda-sync] ${src} -> ${dest}`);
  return true;
}

function validateClientRuntime(clientDir) {
  const indexPath = join(clientDir, 'src/index.tsx');
  const appPath = join(clientDir, 'src/app.tsx');
  const homePath = join(clientDir, 'src/pages/Home/Home.tsx');
  const apiPath = join(clientDir, 'src/lib/api.ts');
  const basePathPath = join(clientDir, 'src/lib/base-path.ts');
  if (!existsSync(indexPath)) {
    throw new Error('[miaoda-sync] client/src/index.tsx missing — platform empty page may be used');
  }

  const index = readFileSync(indexPath, 'utf8');
  if (index.includes('@lark-apaas/client-toolkit')) {
    throw new Error('[miaoda-sync] client/src/index.tsx still uses platform toolkit entry — SCM entry was not copied');
  } else {
    console.log('[miaoda-sync] client entry ready');
  }

  if (!existsSync(appPath) || !readFileSync(appPath, 'utf8').includes('AppRouter')) {
    throw new Error('[miaoda-sync] client/src/app.tsx must render SCM AppRouter');
  }

  if (!existsSync(homePath)) {
    throw new Error('[miaoda-sync] client/src/pages/Home/Home.tsx missing — route-parser may generate empty home');
  }

  if (!existsSync(basePathPath)) {
    throw new Error('[miaoda-sync] client/src/lib/base-path.ts missing');
  }
  const basePath = readFileSync(basePathPath, 'utf8');
  if (!basePath.includes('apiFetch') || !basePath.includes('x-suda-csrf-token')) {
    throw new Error('[miaoda-sync] base-path.ts must keep apiFetch with x-suda-csrf-token');
  }

  if (!existsSync(apiPath)) {
    throw new Error('[miaoda-sync] client/src/lib/api.ts missing');
  }
  const api = readFileSync(apiPath, 'utf8');
  if (api.includes('mockDelay') || api.includes('Mock') || !api.includes("request<") || !api.includes("apiFetch")) {
    throw new Error('[miaoda-sync] client/src/lib/api.ts must use real Hono API calls, not mock data');
  }
}

/** 妙搭：从 server/index.ts 与 hono-app/*.ts 完整生成 index.js + routes/*.js */
function ensureHonoAppRuntime(honoAppDir, dbSrcDir, sourceRoot) {
  const builder = loadHonoAppBuilder();
  if (builder?.buildHonoAppCjs) {
    try {
      builder.buildHonoAppCjs(honoAppDir, dbSrcDir, cwd);
      removeHonoAppIndexTs(honoAppDir);
      return;
    } catch (err) {
      console.error('[miaoda-sync] hono-app full build failed:', err instanceof Error ? err.message : err);
    }
  }

  ensureValidHonoIndex(honoAppDir, sourceRoot);

  if (builder?.buildHonoAppRoutesOnly) {
    try {
      builder.buildHonoAppRoutesOnly(honoAppDir, dbSrcDir, cwd);
    } catch (err) {
      console.error('[miaoda-sync] hono-app route build failed:', err instanceof Error ? err.message : err);
    }
  } else {
    console.log('[miaoda-sync] skip route .js build (miaoda-build-hono-app.cjs missing)');
  }
}

function ensureValidHonoIndex(honoAppDir, sourceRoot) {
  const indexJs = join(honoAppDir, 'index.js');
  const content = existsSync(indexJs) ? readFileSync(indexJs, 'utf8') : '';
  const ok = content.includes('export default') && content.length > 500;
  if (ok) {
    removeHonoAppIndexTs(honoAppDir);
    return;
  }

  const bundledCandidates = [
    join(sourceRoot, 'miaoda/hono-app-index.generated.js'),
    join(sourceRoot, 'server/hono-app/index.js'),
  ];
  const bundled = bundledCandidates.find((p) => existsSync(p));
  if (!bundled) {
    console.warn('[miaoda-sync] hono-app/index.js invalid and no miaoda/hono-app-index.generated.js — fix manually');
    return;
  }

  cpSync(bundled, indexJs);
  writeFileSync(join(honoAppDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  const spIndexJs = join(sourceRoot, 'server/hono-app/index.js');
  mkdirSync(dirname(spIndexJs), { recursive: true });
  cpSync(bundled, spIndexJs);
  console.log(`[miaoda-sync] restored hono-app/index.js from ${bundled} (${readFileSync(indexJs, 'utf8').length} bytes)`);
  removeHonoAppIndexTs(honoAppDir);
}

function removeHonoAppIndexTs(honoAppDir) {
  const indexTs = join(honoAppDir, 'index.ts');
  if (!existsSync(indexTs)) return;
  rmSync(indexTs);
  console.log('[miaoda-sync] removed server/hono-app/index.ts (runtime uses index.js)');
}

function cleanJsonLike(raw) {
  try {
    const { cleanJsonLike: shared } = require('./miaoda-patch-tsconfig.cjs');
    return shared(raw);
  } catch {
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1');
  }
}

function runNestBuildFix(root) {
  const candidates = [
    join(root, 'source_package/scripts/miaoda-fix-nest-build.cjs'),
    join(__dirname, 'miaoda-fix-nest-build.cjs'),
  ];
  for (const script of candidates) {
    if (!existsSync(script)) continue;
    try {
      const { fixNestBuild } = require(script);
      if (typeof fixNestBuild === 'function') {
        fixNestBuild(root);
        return;
      }
    } catch (err) {
      console.warn('[miaoda-sync] nest build fix:', err instanceof Error ? err.message : err);
    }
  }
}

function patchTsconfigBuildExclude(root) {
  const patchCandidates = [
    join(root, 'source_package/scripts/miaoda-patch-tsconfig.cjs'),
    join(__dirname, 'miaoda-patch-tsconfig.cjs'),
  ];
  for (const patchScript of patchCandidates) {
    if (!existsSync(patchScript)) continue;
    try {
      const { patchAllTsconfig, patchTsconfigNode, patchTsconfigRoot } = require(patchScript);
      if (typeof patchAllTsconfig === 'function') {
        if (patchAllTsconfig(root)) return;
        break;
      }
      const nodeOk = patchTsconfigNode(root);
      const rootOk = typeof patchTsconfigRoot === 'function' ? patchTsconfigRoot(root) : true;
      if (nodeOk && rootOk) return;
    } catch (err) {
      console.log('[miaoda-patch-tsconfig] inline fallback:', err instanceof Error ? err.message : err);
    }
  }
  let nodeOk = false;
  for (const name of ['tsconfig.node.json', 'tsconfig.build.json']) {
    if (patchOneTsconfigExclude(join(root, name), 'server/hono-app')) {
      if (name === 'tsconfig.node.json') nodeOk = true;
    }
  }
  if (!nodeOk) {
    console.warn(
      '[miaoda-sync] tsconfig.node.json exclude server/hono-app NOT applied — nest build will compile hono-app .ts and fail',
    );
  }
}

function patchOneTsconfigExclude(filePath, needed) {
  if (!existsSync(filePath)) return false;

  const name = filePath.split(/[/\\]/).pop();
  let raw = readFileSync(filePath, 'utf8');
  if (raw.includes(`"${needed}"`)) {
    console.log(`[miaoda-sync] ${name} already excludes hono-app`);
    return true;
  }

  try {
    const json = JSON.parse(cleanJsonLike(raw));
    const exclude = new Set(Array.isArray(json.exclude) ? json.exclude : []);
    exclude.add(needed);
    json.exclude = [...exclude];
    writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`[miaoda-sync] patched ${name} exclude ${needed}`);
    return true;
  } catch {
    const patched = raw.replace(/("exclude"\s*:\s*\[)([\s\S]*?)(\n\s*\])/m, (match, open, body, close) => {
      if (body.includes(needed)) return match;
      const trimmed = body.trimEnd();
      const sep = trimmed.length === 0 ? '' : ',';
      return `${open}${body}${sep}\n    "${needed}"${close}`;
    });

    if (patched !== raw && patched.includes(`"${needed}"`)) {
      writeFileSync(filePath, patched);
      console.log(`[miaoda-sync] regex-patched ${name} exclude ${needed}`);
      return true;
    }

    console.log(`[miaoda-sync] skip ${name} (invalid JSON — add "${needed}" to exclude manually)`);
    return false;
  }
}

function patchAppModule(appModulePath) {
  if (!existsSync(appModulePath)) {
    console.log('[miaoda-sync] skip app.module.ts (not found)');
    return;
  }

  let content = readFileSync(appModulePath, 'utf8');

  if (content.includes('ScmHonoModule.forRoot()')) {
    content = content.replace(/ScmHonoModule\.forRoot\(\)/g, 'ScmHonoModule');
    writeFileSync(appModulePath, content);
    console.log('[miaoda-sync] normalized ScmHonoModule.forRoot() -> ScmHonoModule');
    return;
  }

  if (content.includes('ScmHonoModule')) {
    console.log('[miaoda-sync] app.module.ts already has ScmHonoModule');
    return;
  }

  const importLine = "import { ScmHonoModule } from './modules/scm-hono/scm-hono.module';";
  if (!content.includes(importLine)) {
    const anchor = content.match(/^import .+ from '@nestjs\/common';$/m);
    content = anchor
      ? content.replace(anchor[0], `${anchor[0]}\n${importLine}`)
      : `${importLine}\n${content}`;
  }

  if (content.includes('@route-section: business-modules START')) {
    content = content.replace(
      /(\/\/ =+ @route-section: business-modules START =+[^\n]*\n)/,
      `$1    ScmHonoModule,\n`,
    );
  } else if (content.includes('ViewModule,')) {
    content = content.replace(/(\s*)(ViewModule,)/, `$1ScmHonoModule,\n$1$2`);
  } else {
    content = content.replace(/(imports:\s*\[\s*\n)/, `$1    ScmHonoModule,\n`);
  }

  writeFileSync(appModulePath, content);
  console.log('[miaoda-sync] patched server/app.module.ts');
}

/** 妙搭平台无 @nestjs/serve-static；SERVE_STATIC=false，静态资源由平台 ViewModule 托管 */
function runPrecommitPatches(root) {
  const candidates = [
    join(root, 'source_package/scripts/miaoda-patch-precommit.cjs'),
    join(__dirname, 'miaoda-patch-precommit.cjs'),
  ];
  for (const script of candidates) {
    if (!existsSync(script)) continue;
    try {
      const { patchPrecommit } = require(script);
      if (typeof patchPrecommit === 'function') {
        patchPrecommit(root);
        return;
      }
    } catch (err) {
      console.warn('[miaoda-sync] precommit patch:', err instanceof Error ? err.message : err);
    }
  }
}

function removeServeStaticModulePatch(appModulePath) {
  if (!existsSync(appModulePath)) return;

  let content = readFileSync(appModulePath, 'utf8');
  const before = content;

  content = content.replace(/\s*ServeStaticModule\.forRoot\(\{[\s\S]*?\}\),?\n?/m, '\n');
  content = content.replace(/^import \{ ServeStaticModule \} from '@nestjs\/serve-static';\n/m, '');
  if (!/\bjoin\s*\(/.test(content)) {
    content = content.replace(/^import \{ join \} from 'path';\n/m, '');
  }

  if (content !== before) {
    writeFileSync(appModulePath, content);
    console.log('[miaoda-sync] removed ServeStaticModule from app.module.ts (package not on Miaoda)');
  }
}

function ensureBuildServerCopiesHono(root) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return;
  }

  const copySuffix = 'rm -rf dist/server/hono-app && cp -r server/hono-app dist/server/hono-app';
  const buildServer = pkg.scripts?.['build:server'] ?? '';
  if (buildServer.includes('dist/server/hono-app') && buildServer.includes('cp -r server/hono-app')) {
    console.log('[miaoda-sync] build:server already copies hono-app to dist');
    return;
  }

  const nestBuild =
    buildServer
      .replace(/\s*&&\s*node -e[\s\S]*copyHonoToDist[\s\S]*/g, '')
      .replace(/\s*&&\s*node source_package\/scripts\/miaoda-copy-hono-to-dist\.cjs\s*/g, '')
      .replace(/\s*&&\s*rm -rf dist\/server\/hono-app && cp -r server\/hono-app dist\/server\/hono-app\s*/g, '')
      .trim() || 'NODE_ENV=production nest build';
  const nestWithPath = nestBuild.includes('-p tsconfig.node.json')
    ? nestBuild
    : nestBuild.replace(/\bnest build\b/g, 'nest build -p tsconfig.node.json');
  pkg.scripts = pkg.scripts ?? {};
  pkg.scripts['build:server'] = `${nestWithPath} && ${copySuffix}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('[miaoda-sync] patched build:server to copy hono-app -> dist/server/hono-app');
}

function patchNestCliHonoAssets(root) {
  const nestCliPath = join(root, 'nest-cli.json');
  if (!existsSync(nestCliPath)) {
    console.log('[miaoda-sync] skip nest-cli.json (not found)');
    return;
  }

  let json;
  try {
    let raw = readFileSync(nestCliPath, 'utf8');
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    raw = raw.replace(/,(\s*[}\]])/g, '$1');
    json = JSON.parse(raw);
  } catch {
    console.log('[miaoda-sync] skip nest-cli.json (invalid JSON)');
    return;
  }

  const assets = Array.isArray(json.compilerOptions?.assets) ? json.compilerOptions.assets : [];
  const hasHono = assets.some(
    (a) => typeof a === 'object' && a?.include && String(a.include).includes('hono-app'),
  );
  if (hasHono) {
    console.log('[miaoda-sync] nest-cli.json already copies hono-app assets');
    return;
  }

  json.compilerOptions = json.compilerOptions ?? {};
  json.compilerOptions.assets = [
    ...assets,
    {
      include: 'hono-app/**/*.{js,json}',
      outDir: 'dist/server',
      watchAssets: true,
    },
  ];
  writeFileSync(nestCliPath, `${JSON.stringify(json, null, 2)}\n`);
  console.log('[miaoda-sync] patched nest-cli.json hono-app assets');
}

function ensurePlatformPrebuild(root) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return;
  }

  const syncCmd = 'node source_package/scripts/miaoda-sync-to-server.js';
  const prebuild = pkg.scripts?.prebuild ?? '';
  if (prebuild.includes('miaoda-sync-to-server')) return;

  pkg.scripts = pkg.scripts ?? {};
  pkg.scripts.prebuild = prebuild ? `${syncCmd} && ${prebuild}` : syncCmd;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('[miaoda-sync] added prebuild to platform package.json');
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveSourceRoot,
  copyDir,
  copyHonoToDist,
  patchAppModule,
  ensurePlatformPrebuild,
  patchTsconfigBuildExclude,
};
