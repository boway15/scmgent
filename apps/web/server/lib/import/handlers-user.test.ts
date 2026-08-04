import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertImportUserAllowed } from './handlers.js';

describe('import automation user', () => {
  it('allows cron inventory imports without a human UUID', () => {
    assert.doesNotThrow(() => assertImportUserAllowed('inventory', undefined));
  });

  it('still requires a human user for PMC plan creation', () => {
    assert.throws(
      () => assertImportUserAllowed('pmc_plans', undefined),
      /userId required/,
    );
  });
});
