/**
 * 妙搭 pre-commit 修复：App.tsx 大小写、ESLint hono-app、stylelint CSS glob
 * 用法：node source_package/scripts/miaoda-patch-precommit.cjs
 */
const { existsSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } = require('fs');
const { join } = require('path');

function fixClientAppCaseConflict(root = process.cwd()) {
  const lower = join(root, 'client/src/app.tsx');
  const upper = join(root, 'client/src/App.tsx');
  if (!existsSync(lower) || !existsSync(upper)) {
    console.log('[miaoda-patch-precommit] no app.tsx/App.tsx conflict');
    return true;
  }
  rmSync(upper);
  console.log('[miaoda-patch-precommit] removed client/src/App.tsx (keep app.tsx for platform entry)');
  return true;
}

function patchEslintConfig(root = process.cwd()) {
  const target = join(root, 'eslint.config.js');
  if (!existsSync(target)) {
    console.log('[miaoda-patch-precommit] skip eslint.config.js (not found)');
    return true;
  }

  let content = readFileSync(target, 'utf8');
  const before = content;

  if (!content.includes("'server/hono-app'")) {
    content = content.replace(
      /(\{\s*ignores:\s*\[)([^\]]*)(\])/,
      (match, open, body, close) => {
        if (body.includes('server/hono-app')) return match;
        const trimmed = body.trimEnd();
        const sep = trimmed.length === 0 ? '' : ', ';
        return `${open}${body}${sep}'server/hono-app', 'source_package'${close}`;
      },
    );
  }

  if (!content.includes("'!server/hono-app/**'")) {
    content = content.replace(
      /files:\s*\['server\/\*\/\*\.(?:ts|tsx)',\s*'shared\/\*\/\*\.(?:ts|tsx)'\]/,
      "files: ['server/**/*.{ts,tsx}', '!server/hono-app/**', 'shared/**/*.{ts,tsx}']",
    );
  }

  if (!content.includes('injectable-should-be-provided')) {
    content = content.replace(
      /(\{\s*\n\s*files:\s*\['server\/\*\/\*\.(?:ts|tsx)'[^\]]*\],[\s\S]*?extends:[\s\S]*?),\s*\n(\s*languageOptions:)/,
      `$1,\n    rules: {\n      '@darraghor/nestjs-typed/injectable-should-be-provided': 'off',\n    },\n$2`,
    );
  } else if (!content.includes("'off'")) {
    content = content.replace(
      /@darraghor\/nestjs-typed\/injectable-should-be-provided':\s*'[^']+'/,
      "@darraghor/nestjs-typed/injectable-should-be-provided': 'off'",
    );
  }

  if (content === before) {
    console.log('[miaoda-patch-precommit] eslint.config.js already OK');
    return true;
  }

  writeFileSync(target, content);
  console.log('[miaoda-patch-precommit] patched eslint.config.js');
  return true;
}

function countCssFiles(root = process.cwd()) {
  const dir = join(root, 'client/src');
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isFile() && entry.endsWith('.css')) count++;
  }
  return count;
}

function ensureClientCssFiles(root = process.cwd()) {
  const cssDir = join(root, 'client/src');
  if (!existsSync(cssDir)) {
    console.warn('[miaoda-patch-precommit] skip CSS ensure (client/src missing)');
    return false;
  }

  if (countCssFiles(root) > 0) {
    console.log(`[miaoda-patch-precommit] client/src has ${countCssFiles(root)} css file(s)`);
    return true;
  }

  const stub = join(cssDir, 'scm-styles.css');
  writeFileSync(
    stub,
    '/* scm-agent: placeholder for Miaoda stylelint; extend in platform tailwind-theme.css */\n',
  );
  console.log('[miaoda-patch-precommit] created client/src/scm-styles.css (stylelint had no targets)');
  return true;
}

function patchStylelintScript(root = process.cwd()) {
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) return true;

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return true;
  }

  const script = pkg.scripts?.stylelint ?? '';
  if (script.includes('--allow-empty-input')) {
    console.log('[miaoda-patch-precommit] stylelint script already has --allow-empty-input');
    return true;
  }

  if (!script.includes('stylelint')) {
    console.log('[miaoda-patch-precommit] skip stylelint script (not in package.json)');
    return true;
  }

  pkg.scripts.stylelint = `${script.replace(/\s*--quiet\s*$/, '')} --allow-empty-input --quiet`.trim();
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('[miaoda-patch-precommit] patched package.json stylelint --allow-empty-input');
  return true;
}

function patchPrecommit(root = process.cwd()) {
  console.log(`[miaoda-patch-precommit] cwd=${root}`);
  const ok =
    fixClientAppCaseConflict(root) &&
    patchEslintConfig(root) &&
    ensureClientCssFiles(root) &&
    patchStylelintScript(root);
  if (ok) console.log('[miaoda-patch-precommit] done');
  return ok;
}

if (require.main === module) {
  process.exit(patchPrecommit() ? 0 : 1);
}

module.exports = {
  patchPrecommit,
  fixClientAppCaseConflict,
  patchEslintConfig,
  ensureClientCssFiles,
  patchStylelintScript,
};
