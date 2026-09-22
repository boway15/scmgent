import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeProductStructure } from './describe-product-structure.js';

describe('describeProductStructure', () => {
  it('explains chest rails from drawer count and omits hardware', () => {
    const brief = describeProductStructure({
      category: '斗柜',
      drawerCount: 6,
      defaultSubstrate: '颗粒板',
      carcassThicknessMm: 18,
    });
    assert.match(brief.title, /斗柜/);
    assert.match(brief.items.join('\n'), /前拉条：爆炸图明示优先；未识别时抽屉数 6 → 2 根/);
    assert.match(brief.items.join('\n'), /顶板为盖板/);
    assert.match(brief.summary, /五金在第二步/);
    assert.equal(
      brief.items.some((item) => /滑轨|拉手|防倾倒/.test(item)),
      false,
    );
  });

  it('does not apply chest floor rails to desks', () => {
    const brief = describeProductStructure({ category: '书桌', drawerCount: 2 });
    assert.match(brief.summary, /不套用侧板落地/);
    assert.equal(
      brief.items.some((item) => /落地拉条/.test(item)),
      false,
    );
  });

  it('uses the desk family brief for 桌子', () => {
    const brief = describeProductStructure({ category: '桌子', drawerCount: 0 });
    assert.match(brief.title, /桌子/);
    assert.match(brief.summary, /不套用侧板落地/);
  });

  it('does not apply chest cuts to 床', () => {
    const brief = describeProductStructure({ category: '床' });
    assert.match(brief.summary, /未套用斗柜/);
    assert.deepEqual(brief.slots, []);
  });
});
