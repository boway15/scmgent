import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLeadTimeProfileInput } from './lead-time-profiles.js';

describe('lead-time profile input', () => {
  it('normalizes optional text and accepts non-negative day values', () => {
    assert.deepEqual(
      parseLeadTimeProfileInput({
        merchantCode: ' M1 ',
        originLocation: ' Shenzhen ',
        destinationWarehouseCode: ' US-WEST ',
        transportMode: 'fcl',
        productionDays: 12,
        domesticDays: 2,
        bookingDays: 3,
        transitDays: 18,
        customsDays: 4,
        inboundDays: 1,
        leadTimeStdDev: 5,
        isDefault: true,
      }),
      {
        ok: true,
        value: {
          merchantCode: 'M1',
          originLocation: 'Shenzhen',
          destinationWarehouseCode: 'US-WEST',
          transportMode: 'fcl',
          productionDays: 12,
          domesticDays: 2,
          bookingDays: 3,
          transitDays: 18,
          customsDays: 4,
          inboundDays: 1,
          leadTimeStdDev: 5,
          isDefault: true,
          sourceSystem: null,
          externalId: null,
        },
      },
    );
  });

  it('rejects missing warehouse and invalid day values', () => {
    assert.deepEqual(
      parseLeadTimeProfileInput({
        destinationWarehouseCode: ' ',
        productionDays: -1,
      }),
      {
        ok: false,
        message: 'destinationWarehouseCode is required',
      },
    );

    assert.deepEqual(
      parseLeadTimeProfileInput({
        destinationWarehouseCode: 'US-WEST',
        transitDays: 1.5,
      }),
      {
        ok: false,
        message: 'transitDays must be a non-negative integer',
      },
    );
  });

  it('rejects unsupported transport modes', () => {
    assert.deepEqual(
      parseLeadTimeProfileInput({
        destinationWarehouseCode: 'US-WEST',
        transportMode: 'sea',
      }),
      {
        ok: false,
        message: 'transportMode is invalid',
      },
    );
  });
});
