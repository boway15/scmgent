import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveFeishuEmailBindAction,
  resolveFeishuLoginEmail,
} from './auth-context.js';

describe('resolveFeishuLoginEmail', () => {
  it('uses provided email when present', () => {
    assert.equal(
      resolveFeishuLoginEmail('ou_abc', '  user@company.com '),
      'user@company.com',
    );
  });

  it('falls back to synthetic @feishu.local email', () => {
    assert.equal(
      resolveFeishuLoginEmail('ou_8285af38683799e85555407fb8db1c61'),
      'ou_8285af38683799e85555407fb8db1c61@feishu.local',
    );
  });
});

describe('resolveFeishuEmailBindAction', () => {
  it('binds synthetic @feishu.local even when feishu_user_id mismatches', () => {
    assert.equal(
      resolveFeishuEmailBindAction({
        openId: 'ou_new',
        email: 'ou_new@feishu.local',
        existingFeishuUserId: 'ou_old',
      }),
      'bind',
    );
  });

  it('binds when existing feishu_user_id is empty', () => {
    assert.equal(
      resolveFeishuEmailBindAction({
        openId: 'ou_new',
        email: 'user@company.com',
        existingFeishuUserId: null,
      }),
      'bind',
    );
  });

  it('binds when existing feishu_user_id already matches openId', () => {
    assert.equal(
      resolveFeishuEmailBindAction({
        openId: 'ou_same',
        email: 'user@company.com',
        existingFeishuUserId: 'ou_same',
      }),
      'bind',
    );
  });

  it('rejects when real email is linked to another Feishu identity', () => {
    assert.equal(
      resolveFeishuEmailBindAction({
        openId: 'ou_new',
        email: 'user@company.com',
        existingFeishuUserId: 'ou_other',
      }),
      'reject_other_identity',
    );
  });
});
