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

const cwd = process.cwd();

function main() {
  const sourceRoot = resolveSourceRoot(cwd);
  console.log(`[miaoda-sync] cwd=${cwd}`);
  console.log(`[miaoda-sync] sourceRoot=${sourceRoot}`);

  const copies = [
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

  patchAppModule(join(cwd, 'server/app.module.ts'));
  ensurePlatformPrebuild(cwd);

  console.log('[miaoda-sync] done');
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
  patchAppModule,
  ensurePlatformPrebuild,
};
