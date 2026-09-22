import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSliceLookups } from './costing-scope.js';

const genericRegionId = 'r-generic';
const genericFactoryId = 'f-generic';
const changzhou = 'r-cz';
const yueshuya = 'f-ysy';

describe('buildSliceLookups', () => {
  it('uses factory then region then global when both are selected', () => {
    assert.deepEqual(
      buildSliceLookups({
        regionId: changzhou,
        factoryId: yueshuya,
        genericRegionId,
        genericFactoryId,
      }),
      [
        { regionId: changzhou, factoryId: yueshuya, scope: 'factory' },
        { regionId: changzhou, factoryId: genericFactoryId, scope: 'region' },
        { regionId: genericRegionId, factoryId: genericFactoryId, scope: 'global' },
      ],
    );
  });

  it('skips factory slice when only a region is selected', () => {
    assert.deepEqual(
      buildSliceLookups({
        regionId: changzhou,
        factoryId: null,
        genericRegionId,
        genericFactoryId,
      }),
      [
        { regionId: changzhou, factoryId: genericFactoryId, scope: 'region' },
        { regionId: genericRegionId, factoryId: genericFactoryId, scope: 'global' },
      ],
    );
  });

  it('tries generic-region plus named factory when only a factory is selected', () => {
    assert.deepEqual(
      buildSliceLookups({
        regionId: null,
        factoryId: yueshuya,
        genericRegionId,
        genericFactoryId,
      }),
      [
        { regionId: genericRegionId, factoryId: yueshuya, scope: 'factory' },
        { regionId: genericRegionId, factoryId: genericFactoryId, scope: 'global' },
      ],
    );
  });

  it('uses only the global slice when nothing is selected', () => {
    assert.deepEqual(
      buildSliceLookups({
        regionId: null,
        factoryId: null,
        genericRegionId,
        genericFactoryId,
      }),
      [{ regionId: genericRegionId, factoryId: genericFactoryId, scope: 'global' }],
    );
  });
});
