/**
 * 妙搭 nest build 修复：
 * 1. tsconfig.node.json — composite: true + exclude server/hono-app
 * 2. tsconfig.json — 移除 references（避免 TS6305/TS6306 与 client 冲突）
 */
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const HONO_EXCLUDE = 'server/hono-app';

function cleanJsonLike(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonLoose(raw, label) {
  try {
    return JSON.parse(cleanJsonLike(raw));
  } catch (err) {
    throw new Error(`${label}: ${err instanceof Error ? err.message : err}`);
  }
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function patchTsconfigNode(root = process.cwd()) {
  const target = join(root, 'tsconfig.node.json');
  if (!existsSync(target) || readFileSync(target, 'utf8').trim().length < 10) {
    try {
      const { ensureTsconfigNode } = require('./miaoda-fix-nest-build.cjs');
      return ensureTsconfigNode(root);
    } catch {
      console.error('[miaoda-patch-tsconfig] tsconfig.node.json empty — run miaoda-fix-nest-build.cjs');
      return false;
    }
  }

  let data;
  try {
    data = parseJsonLoose(readFileSync(target, 'utf8'), 'tsconfig.node.json');
  } catch (err) {
    console.error(`[miaoda-patch-tsconfig] ${err instanceof Error ? err.message : err}`);
    return regexPatchTsconfigNode(target);
  }

  let changed = false;

  data.compilerOptions = data.compilerOptions ?? {};
  if (data.compilerOptions.composite !== true) {
    data.compilerOptions.composite = true;
    changed = true;
  }

  const exclude = new Set(Array.isArray(data.exclude) ? data.exclude : []);
  if (!exclude.has(HONO_EXCLUDE)) {
    exclude.add(HONO_EXCLUDE);
    changed = true;
  }
  data.exclude = [...exclude];

  if (!changed) {
    console.log('[miaoda-patch-tsconfig] tsconfig.node.json already OK');
    return true;
  }

  writeJson(target, data);
  console.log('[miaoda-patch-tsconfig] patched tsconfig.node.json (composite + exclude hono-app)');
  return true;
}

function regexPatchTsconfigNode(target) {
  let raw = readFileSync(target, 'utf8');
  const original = raw;

  if (!/"composite"\s*:\s*true/.test(raw)) {
    if (/"compilerOptions"\s*:\s*\{/.test(raw)) {
      raw = raw.replace(
        /"compilerOptions"\s*:\s*\{/,
        '"compilerOptions": {\n    "composite": true,',
      );
    }
  }

  if (!raw.includes(HONO_EXCLUDE)) {
    if (/"exclude"\s*:/.test(raw)) {
      raw = raw.replace(/"exclude"\s*:\s*\[([\s\S]*?)\]/m, (match, body) => {
        if (body.includes(HONO_EXCLUDE)) return match;
        const trimmed = body.trimEnd();
        const sep = trimmed.length === 0 ? '' : ',';
        return `"exclude": [${body}${sep}\n    "${HONO_EXCLUDE}"\n  ]`;
      });
    } else {
      raw = raw.replace(
        /}(\s*)$/,
        `,
  "exclude": [
    "node_modules",
    "dist",
    "client",
    "**/*.spec.ts",
    "**/*.e2e-spec.ts",
    "${HONO_EXCLUDE}"
  ]
}$1`,
      );
    }
  }

  if (raw === original) {
    console.error(
      `[miaoda-patch-tsconfig] failed — manually add composite:true and "${HONO_EXCLUDE}" to tsconfig.node.json`,
    );
    return false;
  }

  writeFileSync(target, raw);
  console.log('[miaoda-patch-tsconfig] regex-patched tsconfig.node.json');
  return true;
}

/** 根 tsconfig 同时 extends client 又 references node 时，TS 5.9 nest build 报 TS6305 */
function patchTsconfigRoot(root = process.cwd()) {
  const target = join(root, 'tsconfig.json');
  if (!existsSync(target)) {
    console.log('[miaoda-patch-tsconfig] skip tsconfig.json (not found)');
    return true;
  }

  let data;
  try {
    data = parseJsonLoose(readFileSync(target, 'utf8'), 'tsconfig.json');
  } catch (err) {
    console.warn(`[miaoda-patch-tsconfig] skip tsconfig.json (${err instanceof Error ? err.message : err})`);
    return false;
  }

  if (!Array.isArray(data.references) || data.references.length === 0) {
    console.log('[miaoda-patch-tsconfig] tsconfig.json has no references');
    return true;
  }

  delete data.references;
  writeJson(target, data);
  console.log('[miaoda-patch-tsconfig] removed references from tsconfig.json (fix TS6305)');
  return true;
}

function patchAllTsconfig(root = process.cwd()) {
  const nodeOk = patchTsconfigNode(root);
  const rootOk = patchTsconfigRoot(root);
  return nodeOk && rootOk;
}

if (require.main === module) {
  process.exit(patchAllTsconfig() ? 0 : 1);
}

module.exports = { patchTsconfigNode, patchTsconfigRoot, patchAllTsconfig, parseJsonLoose, cleanJsonLike };
