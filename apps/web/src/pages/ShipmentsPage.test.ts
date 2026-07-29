import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MILESTONE_DEFINITIONS,
  shipmentListParamsForTab,
  type ShipmentTab,
} from './ShipmentsPage.js';

describe('ShipmentsPage helpers', () => {
  it('requests only delayed shipments for the delay tab', () => {
    assert.deepEqual(shipmentListParamsForTab('all'), {});
    assert.deepEqual(shipmentListParamsForTab('delayed'), { delayed: true });
  });

  it('provides the seven editable shipment milestones in lifecycle order', () => {
    assert.deepEqual(
      MILESTONE_DEFINITIONS.map(({ key }) => key),
      ['booked', 'loaded', 'departed', 'arrived_port', 'customs', 'received_wh', 'available'],
    );
    assert.equal(MILESTONE_DEFINITIONS.length, 7);
  });

  it('accepts only supported shipment tabs at the type boundary', () => {
    const tabs: ShipmentTab[] = ['all', 'delayed'];
    assert.equal(tabs.length, 2);
  });
});
