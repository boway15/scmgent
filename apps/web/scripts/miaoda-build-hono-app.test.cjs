const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { transpileOneHonoFile } = require('./miaoda-build-hono-app.cjs');

describe('miaoda-build-hono-app', () => {
  it('rewrites @scm/db password subpath imports for generated hono app files', () => {
    const output = transpileOneHonoFile(
      "export { hashPassword } from '@scm/db/password';\n",
      'lib/password.ts',
    );

    assert.match(output, /from\s+['"]\.\.\/_db\/password\.js['"]/);
    assert.doesNotMatch(output, /@scm\/db\/password/);
  });
});
