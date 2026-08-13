import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDbPoolMax } from './client.js';

describe('resolveDbPoolMax', () => {
  it('uses 10 connections in self-hosted Docker so import cannot starve HTTP', () => {
    assert.equal(
      resolveDbPoolMax({ NODE_ENV: 'production', RUNNING_IN_DOCKER: 'true' }),
      10,
    );
  });

  it('keeps max 1 for production without Docker (serverless / 妙搭)', () => {
    assert.equal(resolveDbPoolMax({ NODE_ENV: 'production' }), 1);
  });

  it('honors DB_POOL_MAX when set', () => {
    assert.equal(resolveDbPoolMax({ NODE_ENV: 'production', DB_POOL_MAX: '8' }), 8);
  });
});
