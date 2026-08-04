import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORECAST_WRITE_MENU_CODE,
  userCanWriteForecast,
} from './rbac.js';
import type { AuthUser } from './auth-context.js';

function authUser(roleCode: string): AuthUser {
  return {
    id: 'u1',
    name: 'Test',
    email: 'test@example.com',
    role: { id: 'r1', name: roleCode, code: roleCode },
  };
}

describe('forecast write permissions', () => {
  it('uses data.forecast menu as the write gate', () => {
    assert.equal(FORECAST_WRITE_MENU_CODE, 'data.forecast');
  });

  it('allows super_admin to write forecast (menu wildcard)', async () => {
    assert.equal(await userCanWriteForecast(authUser('super_admin')), true);
  });
});
