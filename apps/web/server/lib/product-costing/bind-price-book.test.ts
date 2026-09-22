import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertPriceBookBindable,
  BindPriceBookError,
  isPriceBookUsableForProject,
  resolvePriceBookEntryScope,
} from './bind-price-book.js';
import type { SliceContext } from './costing-scope.js';

const genericRegionId = 'region-generic';
const genericFactoryId = 'factory-generic';
const projectRegionId = 'region-a';
const projectFactoryId = 'factory-a';

const ctx: SliceContext = {
  regionId: projectRegionId,
  factoryId: projectFactoryId,
  genericRegionId,
  genericFactoryId,
};

describe('resolvePriceBookEntryScope', () => {
  it('returns global for generic slice', () => {
    assert.equal(
      resolvePriceBookEntryScope(
        { regionId: genericRegionId, factoryId: genericFactoryId },
        genericRegionId,
        genericFactoryId,
      ),
      'global',
    );
  });

  it('returns factory for project factory slice', () => {
    assert.equal(
      resolvePriceBookEntryScope(
        { regionId: projectRegionId, factoryId: projectFactoryId },
        genericRegionId,
        genericFactoryId,
      ),
      'factory',
    );
  });

  it('returns region for region-only slice', () => {
    assert.equal(
      resolvePriceBookEntryScope(
        { regionId: projectRegionId, factoryId: genericFactoryId },
        genericRegionId,
        genericFactoryId,
      ),
      'region',
    );
  });
});

describe('isPriceBookUsableForProject', () => {
  it('accepts factory, region, and global slices', () => {
    assert.equal(
      isPriceBookUsableForProject(
        { regionId: projectRegionId, factoryId: projectFactoryId },
        { regionId: projectRegionId, factoryId: projectFactoryId },
        ctx,
      ),
      true,
    );
    assert.equal(
      isPriceBookUsableForProject(
        { regionId: projectRegionId, factoryId: genericFactoryId },
        { regionId: projectRegionId, factoryId: projectFactoryId },
        ctx,
      ),
      true,
    );
    assert.equal(
      isPriceBookUsableForProject(
        { regionId: genericRegionId, factoryId: genericFactoryId },
        { regionId: projectRegionId, factoryId: projectFactoryId },
        ctx,
      ),
      true,
    );
  });

  it('rejects unrelated factory slice', () => {
    assert.equal(
      isPriceBookUsableForProject(
        { regionId: projectRegionId, factoryId: 'factory-other' },
        { regionId: projectRegionId, factoryId: projectFactoryId },
        ctx,
      ),
      false,
    );
  });
});

describe('assertPriceBookBindable', () => {
  it('throws when price is inactive', () => {
    assert.throws(
      () =>
        assertPriceBookBindable(
          {
            regionId: genericRegionId,
            factoryId: genericFactoryId,
            isActive: false,
            effectiveFrom: '2000-01-01',
            effectiveTo: null,
          },
          { regionId: projectRegionId, factoryId: projectFactoryId },
          ctx,
          new Date('2026-08-20'),
        ),
      (error: unknown) =>
        error instanceof BindPriceBookError && error.message === '价目已停用',
    );
  });

  it('throws when price is outside effective range', () => {
    assert.throws(
      () =>
        assertPriceBookBindable(
          {
            regionId: genericRegionId,
            factoryId: genericFactoryId,
            isActive: true,
            effectiveFrom: '2027-01-01',
            effectiveTo: null,
          },
          { regionId: projectRegionId, factoryId: projectFactoryId },
          ctx,
          new Date('2026-08-20'),
        ),
      (error: unknown) =>
        error instanceof BindPriceBookError && error.message === '价目在计价日无效',
    );
  });
});
