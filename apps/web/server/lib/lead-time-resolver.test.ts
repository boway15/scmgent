import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as leadTimeResolver from './lead-time-resolver.js';

type ProfileRow = {
  id: string;
  merchantCode: string | null;
  destinationWarehouseCode: string;
  transportMode: string | null;
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
};

type PickProfile = (
  rows: ProfileRow[],
  params: {
    merchantCode?: string | null;
    warehouseCode: string;
    transportMode?: string | null;
  },
) => ProfileRow | undefined;

const zeros = {
  domesticDays: 0,
  bookingDays: 0,
  transitDays: 0,
  customsDays: 0,
  inboundDays: 0,
};

describe('lead-time-resolver', () => {
  const pickLeadTimeProfile = Reflect.get(
    leadTimeResolver,
    'pickLeadTimeProfile',
  ) as PickProfile | undefined;

  it('exports the profile picker', () => {
    assert.equal(typeof pickLeadTimeProfile, 'function');
  });

  it('prefers merchant+warehouse+mode over merchant+warehouse', () => {
    assert.ok(pickLeadTimeProfile);
    const picked = pickLeadTimeProfile(
      [
        {
          id: 'a',
          merchantCode: 'M1',
          destinationWarehouseCode: 'US-WEST',
          transportMode: null,
          productionDays: 20,
          ...zeros,
        },
        {
          id: 'b',
          merchantCode: 'M1',
          destinationWarehouseCode: 'US-WEST',
          transportMode: 'fcl',
          productionDays: 25,
          ...zeros,
        },
      ],
      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'fcl' },
    );

    assert.equal(picked?.id, 'b');
  });

  it('falls back from merchant profile to warehouse default profile', () => {
    assert.ok(pickLeadTimeProfile);
    const picked = pickLeadTimeProfile(
      [
        {
          id: 'warehouse-mode',
          merchantCode: null,
          destinationWarehouseCode: 'US-WEST',
          transportMode: 'air',
          productionDays: 12,
          ...zeros,
        },
        {
          id: 'warehouse-generic',
          merchantCode: null,
          destinationWarehouseCode: 'US-WEST',
          transportMode: null,
          productionDays: 18,
          ...zeros,
        },
      ],
      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
    );

    assert.equal(picked?.id, 'warehouse-mode');
  });

  it('prefers merchant generic profile over warehouse mode profile', () => {
    assert.ok(pickLeadTimeProfile);
    const picked = pickLeadTimeProfile(
      [
        {
          id: 'warehouse-mode',
          merchantCode: null,
          destinationWarehouseCode: 'US-WEST',
          transportMode: 'air',
          productionDays: 12,
          ...zeros,
        },
        {
          id: 'merchant-generic',
          merchantCode: 'M1',
          destinationWarehouseCode: 'US-WEST',
          transportMode: null,
          productionDays: 18,
          ...zeros,
        },
      ],
      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
    );

    assert.equal(picked?.id, 'merchant-generic');
  });

  it('uses warehouse generic profile when merchant and mode profiles are absent', () => {
    assert.ok(pickLeadTimeProfile);
    const picked = pickLeadTimeProfile(
      [
        {
          id: 'warehouse-generic',
          merchantCode: null,
          destinationWarehouseCode: 'US-WEST',
          transportMode: null,
          productionDays: 18,
          ...zeros,
        },
      ],
      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: 'air' },
    );

    assert.equal(picked?.id, 'warehouse-generic');
  });

  it('returns undefined when no profile matches so legacy resolution can run', () => {
    assert.ok(pickLeadTimeProfile);
    const picked = pickLeadTimeProfile(
      [
        {
          id: 'other-warehouse',
          merchantCode: 'M1',
          destinationWarehouseCode: 'US-EAST',
          transportMode: null,
          productionDays: 20,
          ...zeros,
        },
      ],
      { merchantCode: 'M1', warehouseCode: 'US-WEST', transportMode: null },
    );

    assert.equal(picked, undefined);
  });
});
