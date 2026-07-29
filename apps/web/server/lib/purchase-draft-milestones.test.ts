import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMilestonePatch } from './purchase-draft-milestones.js';

describe('buildMilestonePatch', () => {
  it('maps every supplied milestone field', () => {
    assert.deepEqual(
      buildMilestonePatch({
        plannedProductionDoneDate: '2026-08-01',
        actualProductionDoneDate: '2026-08-02',
        plannedPickupDate: '2026-08-03',
        etd: '2026-08-04',
        etaPort: '2026-08-20',
        customsDoneDate: '2026-08-22',
        etaWarehouse: '2026-08-25',
        transportMode: 'fcl',
      }),
      {
        plannedProductionDoneDate: '2026-08-01',
        actualProductionDoneDate: '2026-08-02',
        plannedPickupDate: '2026-08-03',
        etd: '2026-08-04',
        etaPort: '2026-08-20',
        customsDoneDate: '2026-08-22',
        etaWarehouse: '2026-08-25',
        transportMode: 'fcl',
      },
    );
  });

  it('preserves explicit nulls so nullable milestones can be cleared', () => {
    assert.deepEqual(buildMilestonePatch({ etd: null, etaPort: null }), {
      etd: null,
      etaPort: null,
    });
  });

  it('ignores omitted fields', () => {
    assert.deepEqual(buildMilestonePatch({ etaWarehouse: '2026-08-25' }), {
      etaWarehouse: '2026-08-25',
    });
  });
});
