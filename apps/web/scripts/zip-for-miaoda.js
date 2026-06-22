import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import archiver from 'archiver';
import {
  HONO_APP_SKIP_DIRS,
  HONO_APP_SKIP_FILE,
  transformServerFileForMiaoda,
} from './miaoda-cjs-transform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { generateHonoAppJsArtifacts } = require('./miaoda-build-hono-app.cjs');
const webDir = join(__dirname, '..');
const repoRoot = join(__dirname, '../../..');
const serverDir = join(webDir, 'server');
const outputPath = join(webDir, 'scm-agent-miaoda.zip');

const EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'scm-agent-miaoda.zip',
  '.env',
  '.env.local',
  'scripts/zip-for-miaoda.js',
  'scripts/miaoda-cjs-transform.js',
  'server',
];

mkdirSync(dirname(outputPath), { recursive: true });

const validate = spawnSync(process.execPath, ['scripts/validate-miaoda-hono.js'], {
  cwd: webDir,
  stdio: 'inherit',
});
if (validate.status !== 0) {
  throw new Error('Miaoda hono-app validation failed');
}

const bundledIndexJs = transformServerFileForMiaoda(
  readFileSync(join(webDir, 'server/index.ts'), 'utf8'),
  'index.ts',
);
if (!bundledIndexJs.includes('export default') || bundledIndexJs.length < 500) {
  throw new Error('generated hono-app index invalid');
}
assertBundledIndexImportsExist(bundledIndexJs);

const output = createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`Created ${outputPath} (${archive.pointer()} bytes)`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// 前端等（不含 server/，hono-app 单独打包）
archive.glob('**/*', {
  cwd: webDir,
  ignore: EXCLUDE.map((p) => `**/${p}/**`).concat([...EXCLUDE, 'package.json']),
  dot: false,
});

// 妙搭全栈模板以前端 `client/` 为编译入口。显式提供入口，避免平台默认空页面接管。
archive.file(join(webDir, 'miaoda/client-index.html'), { name: 'client/index.html' });
archive.glob('**/*', {
  cwd: join(webDir, 'src'),
  ignore: ['index.css', 'App.tsx', 'main.tsx'],
  dot: false,
}, { prefix: 'client/src' });
archive.file(join(webDir, 'miaoda/client-index.tsx'), { name: 'client/src/index.tsx' });
archive.file(join(webDir, 'miaoda/client-index.css'), { name: 'client/src/index.css' });
archive.file(join(webDir, 'miaoda/client-app.tsx'), { name: 'client/src/app.tsx' });
archive.file(join(webDir, 'miaoda/client-home.tsx'), { name: 'client/src/pages/Home/Home.tsx' });

// hono-app：与妙搭可运行快照一致 —— 源码 .ts + 预置 index.js（bundled）+ index.ts（妙搭入口）
let honoAppTsCount = 0;
walkServerForHonoApp(serverDir, (absPath, relPath) => {
  if (relPath === 'index.ts') return;
  archive.file(absPath, { name: `server/hono-app/${relPath.replace(/\\/g, '/')}` });
  honoAppTsCount++;
});
archive.file(join(webDir, 'miaoda/hono-app-index.ts'), { name: 'server/hono-app/index.ts' });
archive.append(bundledIndexJs, { name: 'server/hono-app/index.js' });
const honoJsArtifacts = generateHonoAppJsArtifacts(serverDir, join(repoRoot, 'packages/db/src'));
let honoAppJsCount = 0;
for (const [relPath, jsContent] of honoJsArtifacts) {
  archive.append(jsContent, { name: `server/hono-app/${relPath}` });
  honoAppJsCount++;
}
archive.file(join(webDir, 'miaoda/hono-app-tsconfig.json'), {
  name: 'server/hono-app/tsconfig.json',
});
archive.append(`${JSON.stringify({ type: 'module' }, null, 2)}\n`, {
  name: 'server/hono-app/package.json',
});
console.log(`Packed server/hono-app/ (${honoAppTsCount} .ts + ${honoAppJsCount} .js + index.js/index.ts)`);

// 完整 Hono 源（供本地/重建 fallback）
archive.file(join(webDir, 'server/index.ts'), { name: 'server/index.ts' });

// bundled 模板（sync 恢复 index.js 用）
archive.append(bundledIndexJs, {
  name: 'miaoda/hono-app-index.generated.js',
});
archive.file(join(webDir, 'miaoda/hono-app-index.ts'), {
  name: 'miaoda/hono-app-index.ts',
});

// @scm/db 嵌入 hono-app/_db/
archive.directory(join(repoRoot, 'packages/db/src'), 'server/hono-app/_db');
console.log('Packed server/hono-app/_db/ (@scm/db vendored)');

// ScmHonoModule + NestJS Controller 桥接
const SCM_HONO_FILES = [
  'scm-hono-bridge.ts',
  'scm-hono-app.service.ts',
  'scm-hono-proxy.controller.ts',
];
for (const name of SCM_HONO_FILES) {
  archive.file(join(webDir, `server/modules/${name}`), {
    name: `server/modules/scm-hono/${name}`,
  });
}
const scmHonoModule = readFileSync(join(webDir, 'miaoda/scm-hono.module.snippet.ts'), 'utf8')
  .replace(/^\/\/.*\n/gm, '')
  .trimStart();
archive.append(scmHonoModule, { name: 'server/modules/scm-hono/scm-hono.module.ts' });

// source_package/package.json（工具链；平台根 package.json 由 sync patch）
const webPkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'));
webPkg.dependencies['@scm/db'] = 'file:./packages/db';
delete webPkg.type;
webPkg.scripts = {
  ...webPkg.scripts,
  'miaoda:sync': 'node scripts/miaoda-sync-to-server.js',
  prebuild: 'node scripts/miaoda-sync-to-server.js',
};
archive.append(JSON.stringify(webPkg, null, 2), { name: 'package.json' });

// 妙搭脚本
for (const name of [
  'miaoda-sync-to-server.js',
  'miaoda-build-hono-app.cjs',
  'miaoda-copy-hono-to-dist.cjs',
  'miaoda-restore-hono-index.cjs',
  'miaoda-patch-tsconfig.cjs',
  'miaoda-fix-nest-build.cjs',
  'miaoda-patch-precommit.cjs',
]) {
  archive.file(join(webDir, `scripts/${name}`), { name: `scripts/${name}` });
}

// @scm/db
archive.directory(join(repoRoot, 'packages/db/src'), 'packages/db/src');
const dbPkg = JSON.parse(readFileSync(join(repoRoot, 'packages/db/package.json'), 'utf8'));
delete dbPkg.type;
archive.append(JSON.stringify(dbPkg, null, 2), { name: 'packages/db/package.json' });
archive.file(join(repoRoot, 'packages/db/tsconfig.json'), { name: 'packages/db/tsconfig.json' });

// drizzle SQL
archive.directory(join(repoRoot, 'packages/db/drizzle'), 'drizzle');
archive.file(join(repoRoot, 'docs/sql/seed-fob-fee-rules.sql'), { name: 'drizzle/seed-fob-fee-rules.sql' });
archive.file(join(repoRoot, 'docs/sql/miaoda-seed-roles-menus.sql'), { name: 'drizzle/miaoda-seed-roles-menus.sql' });
archive.file(join(repoRoot, 'docs/sql/0014-miaoda-plain.sql'), { name: 'drizzle/0014-miaoda-plain.sql' });
archive.file(join(repoRoot, 'docs/sql/miaoda-init-all.sql'), { name: 'drizzle/miaoda-init-all.sql' });

// 文档
for (const name of [
  'MIAODA-SETUP.md',
  'hono-app-checklist.md',
  'app-module.snippet.txt',
  'scm-hono.module.snippet.ts',
  'platform-prebuild.snippet.txt',
  'hono-app-tsconfig.json',
  'tsconfig.node.snippet.json',
  'nest-cli.snippet.json',
  'eslint.config.snippet.txt',
  'tsconfig-build.snippet.txt',
]) {
  archive.file(join(webDir, `miaoda/${name}`), { name: `miaoda/${name}` });
}

archive.file(join(repoRoot, '.env.example'), { name: '.env.example' });

archive.finalize();

/** @param {string} dir @param {(abs: string, rel: string) => void} onFile */
function walkServerForHonoApp(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(serverDir, abs);
    const st = statSync(abs);

    if (st.isDirectory()) {
      if (HONO_APP_SKIP_DIRS.has(entry)) continue;
      walkServerForHonoApp(abs, onFile);
      continue;
    }

    if (!entry.endsWith('.ts')) continue;
    if (HONO_APP_SKIP_FILE.test(entry)) continue;

    onFile(abs, rel);
  }
}

function assertBundledIndexImportsExist(content) {
  const missing = [];
  const importRe = /from\s+['"]\.\/([^'"]+\.js)['"]/g;
  for (const match of content.matchAll(importRe)) {
    const rel = match[1];
    if (rel.startsWith('_db/')) {
      const dbSourceRel = rel.replace(/^_db\//, '').replace(/\.js$/, '.ts');
      if (!statSafe(join(repoRoot, 'packages/db/src', dbSourceRel))) missing.push(rel);
      continue;
    }
    const sourceRel = rel.replace(/\.js$/, '.ts');
    const sourcePath = join(serverDir, sourceRel);
    if (!statSafe(sourcePath)) missing.push(rel);
  }
  if (missing.length) {
    throw new Error(`generated hono-app index imports missing files: ${missing.join(', ')}`);
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
