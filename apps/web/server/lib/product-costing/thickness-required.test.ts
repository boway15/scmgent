import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  missingPanelThicknessLabels,
  panelThicknessComplete,
  panelThicknessRequiredMessage,
} from './thickness-required.js';

describe('panel thickness gate', () => {
  it('lists every empty field', () => {
    assert.deepEqual(missingPanelThicknessLabels({}), [
      '箱体默认厚度',
      '侧板默认厚度',
      '背板默认厚度',
      '底板默认厚度',
      '抽底默认厚度',
    ]);
    assert.equal(panelThicknessComplete({ carcassThicknessMm: 18 }), false);
  });

  it('passes only when all five are numbers', () => {
    const facts = {
      carcassThicknessMm: 18,
      sideThicknessMm: 18,
      backThicknessMm: 3,
      bottomThicknessMm: 18,
      drawerBottomThicknessMm: 9,
    };
    assert.equal(panelThicknessComplete(facts), true);
    assert.equal(panelThicknessRequiredMessage(facts), null);
  });
});
