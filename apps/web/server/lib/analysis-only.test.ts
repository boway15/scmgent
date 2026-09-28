import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANALYSIS_ONLY_MESSAGE } from './analysis-only.js';

describe('analysis-only', () => {
  it('uses the agreed refusal message', () => {
    assert.equal(
      ANALYSIS_ONLY_MESSAGE,
      '本系统只同步和分析数据，不在此修改业务事实。请在迅捷 ERP 操作。',
    );
  });
});
