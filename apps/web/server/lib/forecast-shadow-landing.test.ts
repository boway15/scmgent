import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldRunShadowLandingAfterGenerate } from './forecast-shadow-landing.js';

describe('forecast-shadow-landing', () => {
  it('runs full landing only for shadow mode', () => {
    assert.equal(shouldRunShadowLandingAfterGenerate('shadow'), true);
    assert.equal(shouldRunShadowLandingAfterGenerate('on'), false);
    assert.equal(shouldRunShadowLandingAfterGenerate('off'), false);
  });
});
