/**
 * 妙搭 nest build 修复（TS6305/TS6306 / 空 tsconfig.node.json）
 *
 * 用法：node source_package/scripts/miaoda-fix-nest-build.cjs
 */
const { existsSync, readFileSync, statSync, writeFileSync } = require('fs');
const { join } = require('path');

const HONO_EXCLUDE = 'server/hono-app';

const DEFAULT_TSCONFIG_NODE = {
  extends: '@lark-apaas/fullstack-presets/lib/simple/tsconfig/tsconfig.node.json',
  compilerOptions: {
    composite: true,
    baseUrl: './',
    outDir: './dist',
    paths: {
      '@server/*': ['server/*'],
      '@shared/*': ['shared/*'],
    },
  },
  watchOptions: {
    excludeDirectories: ['node_modules/**'],
  },
  include: ['server/**/*', 'shared/**/*.ts'],
  exclude: [
    'node_modules',
    'dist',
    'client',
    '**/*.spec.ts',
    '**/*.e2e-spec.ts',
    HONO_EXCLUDE,
  ],
};

function cleanJsonLike(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
}

function tryParseJson(raw, label) {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: `${label} is empty` };
  try {
    return { ok: true, data: JSON.parse(cleanJsonLike(raw)) };
  } catch (err) {
    return { ok: false, reason: `${label}: ${err instanceof Error ? err.message : err}` };
  }
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function loadNodeTemplate(root) {
  const candidates = [
    join(root, 'source_package/miaoda/tsconfig.node.snippet.json'),
    join(root, 'miaoda/tsconfig.node.snippet.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const parsed = tryParseJson(readFileSync(p, 'utf8'), p);
    if (parsed.ok) {
      const data = parsed.data;
      data.compilerOptions = data.compilerOptions ?? {};
      data.compilerOptions.composite = true;
      const exclude = new Set(Array.isArray(data.exclude) ? data.exclude : []);
      exclude.add(HONO_EXCLUDE);
      data.exclude = [...exclude];
      return data;
    }
  }
  return structuredClone(DEFAULT_TSCONFIG_NODE);
}

function isTsconfigNodeUsable(root) {
  const target = join(root, 'tsconfig.node.json');
  if (!existsSync(target)) return false;
  if (statSync(target).size < 10) return false;
  const parsed = tryParseJson(readFileSync(target, 'utf8'), 'tsconfig.node.json');
  if (!parsed.ok) return false;
  const data = parsed.data;
  const exclude = new Set(Array.isArray(data.exclude) ? data.exclude : []);
  return exclude.has(HONO_EXCLUDE) && data.compilerOptions?.composite === true;
}

function ensureTsconfigNode(root = process.cwd()) {
  const target = join(root, 'tsconfig.node.json');
  if (isTsconfigNodeUsable(root)) {
    console.log('[miaoda-fix-nest-build] tsconfig.node.json OK');
    return true;
  }

  const size = existsSync(target) ? statSync(target).size : 0;
  if (size < 10) {
    console.warn(`[miaoda-fix-nest-build] tsconfig.node.json empty or missing (${size} bytes) — restoring template`);
  } else {
    console.warn('[miaoda-fix-nest-build] tsconfig.node.json invalid — restoring template');
  }

  writeJson(target, loadNodeTemplate(root));
  console.log('[miaoda-fix-nest-build] wrote tsconfig.node.json');
  return true;
}

function stripReferencesFromTsconfig(raw) {
  let next = raw.replace(/"references"\s*:\s*\[[\s\S]*?\]\s*,?/m, '');
  next = next.replace(/,(\s*[}\]])/g, '$1');
  return next;
}

function ensureTsconfigRoot(root = process.cwd()) {
  const target = join(root, 'tsconfig.json');
  if (!existsSync(target)) {
    console.log('[miaoda-fix-nest-build] skip tsconfig.json (not found)');
    return true;
  }

  const raw = readFileSync(target, 'utf8');
  if (!/"references"\s*:/.test(raw)) {
    console.log('[miaoda-fix-nest-build] tsconfig.json has no references');
    return true;
  }

  const stripped = stripReferencesFromTsconfig(raw);
  if (stripped === raw) {
    console.warn('[miaoda-fix-nest-build] could not strip references from tsconfig.json — edit manually');
    return false;
  }

  writeFileSync(target, stripped.endsWith('\n') ? stripped : `${stripped}\n`);
  console.log('[miaoda-fix-nest-build] removed references from tsconfig.json');
  return true;
}

const DEFAULT_NEST_CLI = {
  $schema: 'https://json.schemastore.org/nest-cli',
  collection: '@nestjs/schematics',
  sourceRoot: 'server',
  compilerOptions: {
    deleteOutDir: false,
    tsConfigPath: 'tsconfig.node.json',
    assets: [
      {
        include: 'capabilities/**/*.json',
        outDir: 'dist/server',
        watchAssets: true,
      },
      {
        include: 'hono-app/**/*.{js,json}',
        outDir: 'dist/server',
        watchAssets: true,
      },
    ],
  },
};

function loadNestCliTemplate(root) {
  const candidates = [
    join(root, 'source_package/miaoda/nest-cli.snippet.json'),
    join(root, 'miaoda/nest-cli.snippet.json'),
  ];
  for (const p of candidates) {
    const parsed = existsSync(p) ? tryParseJson(readFileSync(p, 'utf8'), p) : { ok: false };
    if (parsed.ok) return parsed.data;
  }
  return structuredClone(DEFAULT_NEST_CLI);
}

function isNestCliUsable(root) {
  const target = join(root, 'nest-cli.json');
  if (!existsSync(target) || statSync(target).size < 10) return false;
  const parsed = tryParseJson(readFileSync(target, 'utf8'), 'nest-cli.json');
  if (!parsed.ok) return false;
  return parsed.data?.compilerOptions?.tsConfigPath === 'tsconfig.node.json';
}

function ensureNestCli(root = process.cwd()) {
  const target = join(root, 'nest-cli.json');
  if (isNestCliUsable(root)) {
    console.log('[miaoda-fix-nest-build] nest-cli.json OK');
    return true;
  }

  const size = existsSync(target) ? statSync(target).size : 0;
  if (size < 10) {
    console.warn(`[miaoda-fix-nest-build] nest-cli.json empty or missing (${size} bytes) — restoring template`);
  } else {
    console.warn('[miaoda-fix-nest-build] nest-cli.json invalid — restoring template');
  }

  writeJson(target, loadNestCliTemplate(root));
  console.log('[miaoda-fix-nest-build] wrote nest-cli.json (tsConfigPath=tsconfig.node.json)');
  return true;
}

function patchBuildServerScript(root = process.cwd()) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return true;

  const parsed = tryParseJson(readFileSync(pkgPath, 'utf8'), 'package.json');
  if (!parsed.ok) return true;

  const pkg = parsed.data;
  const copySuffix = 'rm -rf dist/server/hono-app && cp -r server/hono-app dist/server/hono-app';
  let buildServer = pkg.scripts?.['build:server'] ?? '';
  if (!buildServer.includes('nest build')) return true;

  if (buildServer.includes('-p tsconfig.node.json') || buildServer.includes('--path tsconfig.node.json')) {
    console.log('[miaoda-fix-nest-build] build:server already uses -p tsconfig.node.json');
    return true;
  }

  buildServer = buildServer.replace(/\bnest build\b/g, 'nest build -p tsconfig.node.json');
  if (!buildServer.includes('dist/server/hono-app')) {
    buildServer = `${buildServer} && ${copySuffix}`;
  }
  pkg.scripts = pkg.scripts ?? {};
  pkg.scripts['build:server'] = buildServer;
  writeJson(pkgPath, pkg);
  console.log('[miaoda-fix-nest-build] patched build:server -> nest build -p tsconfig.node.json');
  return true;
}

function fixNestBuild(root = process.cwd()) {
  console.log(`[miaoda-fix-nest-build] cwd=${root}`);
  const nodeOk = ensureTsconfigNode(root);
  const rootOk = ensureTsconfigRoot(root);
  const cliOk = ensureNestCli(root);
  const scriptOk = patchBuildServerScript(root);
  const ok = nodeOk && rootOk && cliOk && scriptOk;
  if (ok) {
    console.log('[miaoda-fix-nest-build] done — run: npm run build:server');
  } else {
    console.error('[miaoda-fix-nest-build] incomplete — check logs above');
  }
  return ok;
}

if (require.main === module) {
  process.exit(fixNestBuild() ? 0 : 1);
}

module.exports = {
  fixNestBuild,
  ensureTsconfigNode,
  ensureTsconfigRoot,
  ensureNestCli,
  patchBuildServerScript,
  loadNodeTemplate,
};

