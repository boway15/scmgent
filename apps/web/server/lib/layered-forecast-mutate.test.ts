import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCascadeChildFilter,
  computeImbalance,
} from './layered-forecast-mutate.js';

describe('layered-forecast-mutate', () => {
  it('computes a rounded parent-to-children imbalance', () => {
    assert.equal(computeImbalance(100, [25.555, 74.445]), 0);
    assert.equal(computeImbalance(100, [33.333, 33.333, 33.333]), 0.001);
    assert.equal(computeImbalance(5.1, [1.2, 1.3]), 2.6);
  });

  it('selects direct category children from a project group node', () => {
    assert.deepEqual(
      buildCascadeChildFilter({
        level: 'project_group',
        projectGroup: '办公桌',
        category: 'ALL',
        platform: 'ALL',
        period: '2026-08',
      }),
      {
        level: 'category',
        projectGroup: '办公桌',
        platform: 'ALL',
        period: '2026-08',
      },
    );
  });

  it('selects direct platform and SKU children using their dimensions', () => {
    assert.deepEqual(
      buildCascadeChildFilter({
        level: 'category',
        projectGroup: '办公桌',
        category: '实木',
        platform: 'ALL',
        period: '2026-08',
      }),
      {
        level: 'platform',
        projectGroup: '办公桌',
        category: '实木',
        platformNot: 'ALL',
        period: '2026-08',
      },
    );
    assert.deepEqual(
      buildCascadeChildFilter({
        level: 'platform',
        projectGroup: '办公桌',
        category: '实木',
        platform: 'AMAZON',
        period: '2026-08',
      }),
      {
        level: 'sku',
        projectGroup: '办公桌',
        category: '实木',
        platform: 'AMAZON',
        period: '2026-08',
      },
    );
  });
});
