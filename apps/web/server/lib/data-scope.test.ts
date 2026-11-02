import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectGroupFilter,
  filterProjectGroupOptions,
  resolveScopedProjectGroups,
  skuInProjectGroupScope,
  type ProjectGroupScope,
} from './data-scope.js';

const all: ProjectGroupScope = { mode: 'all' };
const restricted: ProjectGroupScope = {
  mode: 'restricted',
  groups: ['Amazon项目1组-第一曲线-US', 'Amazon项目2组-第一曲线-EU'],
};

describe('applyProjectGroupFilter', () => {
  it('returns requested filters unchanged when scope is all', () => {
    assert.deepEqual(applyProjectGroupFilter('A', all), ['A']);
    assert.deepEqual(applyProjectGroupFilter(['B', 'A', 'B'], all), ['B', 'A']);
    assert.deepEqual(applyProjectGroupFilter(null, all), []);
  });

  it('returns full allowed groups when restricted and no request filter', () => {
    assert.deepEqual(applyProjectGroupFilter(null, restricted), restricted.groups);
    assert.deepEqual(applyProjectGroupFilter([], restricted), restricted.groups);
  });

  it('intersects requested filters with allowed groups', () => {
    assert.deepEqual(
      applyProjectGroupFilter(['Amazon项目1组-第一曲线-US', 'outside'], restricted),
      ['Amazon项目1组-第一曲线-US'],
    );
  });

  it('returns empty when intersection is empty', () => {
    assert.deepEqual(applyProjectGroupFilter(['outside'], restricted), []);
  });
});

describe('resolveScopedProjectGroups', () => {
  it('marks empty when restricted intersection is empty', () => {
    const result = resolveScopedProjectGroups({
      scope: restricted,
      projectGroup: 'outside',
    });
    assert.equal(result.empty, true);
    assert.deepEqual(result.groups, []);
    assert.ok(result.condition);
  });

  it('does not mark empty when all and no filter', () => {
    const result = resolveScopedProjectGroups({ scope: all });
    assert.equal(result.empty, false);
    assert.deepEqual(result.groups, []);
    assert.equal(result.condition, undefined);
  });

  it('forces condition when restricted without request filter', () => {
    const result = resolveScopedProjectGroups({ scope: restricted });
    assert.equal(result.empty, false);
    assert.deepEqual(result.groups, restricted.groups);
    assert.ok(result.condition);
  });
});

describe('skuInProjectGroupScope', () => {
  it('allows everything when scope is all', () => {
    assert.equal(skuInProjectGroupScope(null, all), true);
    assert.equal(skuInProjectGroupScope('anything', all), true);
  });

  it('hides missing project group for restricted users', () => {
    assert.equal(skuInProjectGroupScope(null, restricted), false);
    assert.equal(skuInProjectGroupScope('  ', restricted), false);
  });

  it('allows only configured groups', () => {
    assert.equal(skuInProjectGroupScope('Amazon项目1组-第一曲线-US', restricted), true);
    assert.equal(skuInProjectGroupScope('outside', restricted), false);
  });
});

describe('filterProjectGroupOptions', () => {
  it('passes through when all', () => {
    assert.deepEqual(filterProjectGroupOptions(['A', 'B'], all), ['A', 'B']);
  });

  it('keeps only allowed groups when restricted', () => {
    assert.deepEqual(
      filterProjectGroupOptions(
        ['Amazon项目1组-第一曲线-US', 'outside', 'Amazon项目2组-第一曲线-EU'],
        restricted,
      ),
      ['Amazon项目1组-第一曲线-US', 'Amazon项目2组-第一曲线-EU'],
    );
  });
});
