import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MILESTONE_DEFINITIONS,
  buildShipmentCreatePrefill,
  defaultShipmentNoFromDraft,
  shipmentListParamsForTab,
  shipmentsForDraftId,
  type ShipmentTab,
} from './ShipmentsPage.js';
import type { Shipment } from '@/lib/api';

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

  it('filters shipments by draftId for weak tracking links', () => {
    const items = [
      { id: 's1', draftId: 'draft-a' },
      { id: 's2', draftId: 'draft-b' },
      { id: 's3', draftId: null },
    ] as Shipment[];

    assert.deepEqual(shipmentsForDraftId(items, 'draft-a').map((item) => item.id), ['s1']);
    assert.deepEqual(shipmentsForDraftId(items, 'missing'), []);
  });

  it('builds create prefill from tracking draft fields', () => {
    assert.equal(defaultShipmentNoFromDraft('PD-001'), 'SHP-PD-001');
    assert.deepEqual(
      buildShipmentCreatePrefill({
        id: 'draft-a',
        draftNo: 'PD-001',
        skuId: 'sku-1',
        skuCode: 'SKU-1',
        qty: 100,
        remainingQty: 60,
        planItemId: 'plan-item-1',
        etaAvailable: '2026-08-01',
        status: 'ready_to_ship',
      }),
      {
        shipmentNo: 'SHP-PD-001',
        draftId: 'draft-a',
        planItemId: 'plan-item-1',
        skuId: 'sku-1',
        qty: 60,
        etaAvailable: '2026-08-01',
        transportMode: '',
      },
    );
  });
});
