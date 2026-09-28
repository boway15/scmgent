import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShareParseResult } from './inventory-share-allocation.js';
import { classifySupplyLot } from './inventory-timeline.js';
import {
  addDaysIso,
  buildLotsFromInputs,
  deriveShipReadiness,
  isLotEligibleForTimeline,
  mapDraftToLotPool,
  resolveLocalAvailableAt,
  type SkuAllocationContext,
  type SupplyLotDraftInput,
  type SupplyLotShipmentInput,
  type SupplyLotSnapshotInput,
} from './inventory-supply-lots.js';

const WEST_EAST_SHARE: ShareParseResult = {
  method: 'sales_share',
  shareSum: 1,
  shareSumWarning: false,
  weights: [
    { warehouse: 'US-WEST', weight: 0.6 },
    { warehouse: 'US-EAST', weight: 0.4 },
  ],
};

const WEST_ONLY_SHARE: ShareParseResult = {
  method: 'sales_share',
  shareSum: 1,
  shareSumWarning: false,
  weights: [{ warehouse: 'US-WEST', weight: 1 }],
};

const UNALLOCATED_SHARE: ShareParseResult = {
  method: 'unallocated',
  shareSum: 0,
  shareSumWarning: false,
  weights: [],
};

function allocationMap(
  skuId: string,
  share: ShareParseResult,
  extras?: Partial<SkuAllocationContext>,
): Map<string, SkuAllocationContext> {
  return new Map([
    [
      skuId,
      {
        share,
        transitBuckets: extras?.transitBuckets ?? { d5: 0, d15: 0, d25: 0 },
        earliestAvailableAt: extras?.earliestAvailableAt ?? null,
        earliestPoAvailableAt: extras?.earliestPoAvailableAt ?? null,
      },
    ],
  ]);
}

describe('inventory-supply-lots pure', () => {
  it('maps draft statuses to pools', () => {
    assert.equal(mapDraftToLotPool('in_production'), 'local');
    assert.equal(mapDraftToLotPool('ready_to_ship'), 'local');
    assert.equal(mapDraftToLotPool('confirmed'), 'local');
    assert.equal(mapDraftToLotPool('in_transit'), 'in_transit');
    assert.equal(mapDraftToLotPool('partial_received'), 'in_transit');
    assert.equal(mapDraftToLotPool('received'), null);
    assert.equal(mapDraftToLotPool('cancelled'), null);
  });

  it('derives ship readiness from dates', () => {
    assert.equal(
      deriveShipReadiness({ shipReadyAt: '2026-09-10', today: '2026-09-17' }),
      'ready',
    );
    assert.equal(
      deriveShipReadiness({ shipReadyAt: '2026-09-22', today: '2026-09-17' }),
      'approaching',
    );
    assert.equal(
      deriveShipReadiness({ shipReadyAt: '2026-10-01', today: '2026-09-17' }),
      'not_due',
    );
    assert.equal(
      deriveShipReadiness({ shipReadyAt: null, today: '2026-09-17' }),
      'not_due',
    );
    assert.equal(
      deriveShipReadiness({
        shipReadyAt: '2026-09-10',
        today: '2026-09-17',
        scheduled: true,
      }),
      'scheduled',
    );
  });

  it('resolves local available_at only when ship-ready and logistics remaining known', () => {
    assert.equal(
      resolveLocalAvailableAt({
        shipReadyAt: '2026-09-20',
        remainingLogisticsDays: 52,
      }),
      '2026-11-11',
    );
    assert.equal(
      resolveLocalAvailableAt({
        shipReadyAt: null,
        plannedProductionDoneDate: '2026-09-25',
        remainingLogisticsDays: 50,
      }),
      '2026-11-14',
    );
    assert.equal(
      resolveLocalAvailableAt({
        shipReadyAt: null,
        plannedProductionDoneDate: null,
        etaAvailable: '2026-11-01',
        remainingLogisticsDays: 50,
      }),
      '2026-11-01',
    );
    assert.equal(
      resolveLocalAvailableAt({
        shipReadyAt: null,
        plannedProductionDoneDate: null,
        etaAvailable: null,
        remainingLogisticsDays: 50,
      }),
      null,
    );
  });

  it('marks lots without available_at as not eligible for timeline supply', () => {
    assert.equal(
      isLotEligibleForTimeline({
        pool: 'local',
        availableAt: null,
        productionStatus: 'completed',
        shipReadyAt: '2026-09-10',
        today: '2026-09-17',
      }),
      false,
    );
    assert.equal(
      isLotEligibleForTimeline({
        pool: 'local',
        availableAt: '2026-11-01',
        productionStatus: 'in_production',
        shipReadyAt: '2026-10-01',
        today: '2026-09-17',
      }),
      false,
    );
    assert.equal(
      isLotEligibleForTimeline({
        pool: 'local',
        availableAt: '2026-11-01',
        productionStatus: 'completed',
        shipReadyAt: '2026-09-10',
        today: '2026-09-17',
      }),
      true,
    );
    assert.equal(
      isLotEligibleForTimeline({
        pool: 'in_transit',
        availableAt: '2026-09-24',
        today: '2026-09-17',
      }),
      true,
    );
    assert.equal(
      isLotEligibleForTimeline({
        pool: 'overseas',
        availableAt: '2026-09-17',
        today: '2026-09-17',
      }),
      true,
    );
  });

  it('builds overseas + transit + local lots; unknown-date local excluded from eligible', () => {
    const snapshots: SupplyLotSnapshotInput[] = [
      {
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        qtyAvailable: 1000,
        qtyInTransit: 500,
        qtyReserved: 0,
        recordedDate: '2026-09-17',
      },
    ];
    const drafts: SupplyLotDraftInput[] = [
      {
        draftId: 'd1',
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        status: 'ready_to_ship',
        openQty: 300,
        shipReadyAt: '2026-09-17',
        plannedProductionDoneDate: '2026-09-15',
        etaAvailable: null,
        remainingLogisticsDays: 52,
      },
      {
        draftId: 'd2',
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        status: 'in_production',
        openQty: 200,
        shipReadyAt: null,
        plannedProductionDoneDate: null,
        etaAvailable: null,
        remainingLogisticsDays: 52,
      },
    ];
    const shipments: SupplyLotShipmentInput[] = [
      {
        shipmentId: 's1',
        skuId: 'sku-1',
        warehouseCode: 'US-WEST',
        qty: 500,
        etaAvailable: '2026-09-24',
        status: 'departed',
      },
    ];

    const { lots, eligibleLots } = buildLotsFromInputs({
      snapshots,
      drafts,
      shipments,
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: { 'US-WEST': 52 },
    });

    assert.equal(lots.filter((l) => l.pool === 'overseas').length, 1);
    assert.equal(lots.filter((l) => l.pool === 'in_transit').length, 1);
    assert.equal(lots.filter((l) => l.pool === 'local').length, 2);
    assert.ok(eligibleLots.every((l) => l.availableAt != null));
    assert.equal(
      eligibleLots.filter((l) => l.pool === 'local').length,
      1,
      'only ready local lot enters timeline',
    );
    assert.equal(
      eligibleLots.find((l) => l.pool === 'in_transit')?.availableAt,
      '2026-09-24',
    );
  });

  it('uses estimated ETA for snapshot transit when no shipment rows', () => {
    const { lots, eligibleLots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'OVERSEAS',
          qtyAvailable: 100,
          qtyInTransit: 80,
          qtyReserved: 0,
          recordedDate: '2026-09-17',
        },
      ],
      drafts: [],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: { 'US-WEST': 45, OVERSEAS: 45 },
    });

    const overseas = lots.find((l) => l.pool === 'overseas');
    assert.ok(overseas);
    assert.equal(overseas!.warehouseCode, 'OVERSEAS');
    assert.equal(overseas!.qty, 100);
    assert.equal(overseas!.sourceId, 'avail:sku-1:OVERSEAS');

    const transit = lots.find((l) => l.pool === 'in_transit');
    assert.ok(transit);
    assert.equal(transit!.qty, 80);
    assert.equal(transit!.warehouseCode, 'OVERSEAS');
    assert.equal(transit!.availableAt, null);
    assert.equal(transit!.dateUnknown, true);
    assert.equal(transit!.etaEstimated, true);
    assert.notEqual(transit!.availableAt, addDaysIso('2026-09-17', 45));
    assert.equal(
      eligibleLots.some((l) => l.pool === 'in_transit'),
      false,
    );
  });

  it('splits OVERSEAS on-hand by sales share into destination warehouses', () => {
    const { lots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'OVERSEAS',
          qtyAvailable: 100,
          qtyInTransit: 0,
          qtyReserved: 0,
          recordedDate: '2026-09-17',
        },
      ],
      drafts: [],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: {},
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE),
    });

    const overseas = lots.filter((l) => l.pool === 'overseas');
    assert.equal(overseas.length, 2);
    assert.equal(
      overseas.find((l) => l.warehouseCode === 'US-WEST')?.qty,
      60,
    );
    assert.equal(
      overseas.find((l) => l.warehouseCode === 'US-EAST')?.qty,
      40,
    );
    assert.equal(
      overseas.find((l) => l.warehouseCode === 'US-WEST')?.sourceId,
      'avail-share:sku-1:US-WEST',
    );
    assert.equal(
      overseas.find((l) => l.warehouseCode === 'US-EAST')?.sourceId,
      'avail-share:sku-1:US-EAST',
    );
    assert.equal(
      overseas.some((l) => l.warehouseCode === 'OVERSEAS'),
      false,
    );
  });

  it('deducts shipment transit globally then keeps undated OVERSEAS residual unallocated', () => {
    const { lots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'OVERSEAS',
          qtyAvailable: 0,
          qtyInTransit: 80,
          qtyReserved: 0,
          recordedDate: '2026-09-17',
        },
      ],
      drafts: [],
      shipments: [
        {
          shipmentId: 's-west-30',
          skuId: 'sku-1',
          warehouseCode: 'US-WEST',
          qty: 30,
          etaAvailable: '2026-09-24',
          status: 'departed',
        },
      ],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: { 'US-WEST': 45 },
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE),
    });

    const shipmentLot = lots.find((l) => l.sourceId === 's-west-30');
    assert.ok(shipmentLot);
    assert.equal(shipmentLot!.qty, 30);
    assert.equal(shipmentLot!.warehouseCode, 'US-WEST');
    assert.equal(shipmentLot!.availableAt, '2026-09-24');
    assert.equal(shipmentLot!.etaEstimated, false);

    const residuals = lots.filter(
      (l) => l.source === 'snapshot' && l.pool === 'in_transit',
    );
    assert.equal(residuals.length, 1);
    assert.equal(residuals[0]!.warehouseCode, 'OVERSEAS');
    assert.equal(residuals[0]!.qty, 50);
    assert.equal(residuals[0]!.availableAt, null);
    assert.equal(residuals[0]!.dateUnknown, true);
    assert.equal(residuals[0]!.etaEstimated, true);
    assert.ok(residuals[0]!.sourceId?.startsWith('transit-unalloc:'));
    assert.ok(residuals[0]!.sourceId?.endsWith(':undated'));
  });

  it('deducts in_transit purchase_draft globally then keeps undated OVERSEAS residual', () => {
    const { lots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'OVERSEAS',
          qtyAvailable: 0,
          qtyInTransit: 80,
          qtyReserved: 0,
          recordedDate: '2026-09-17',
        },
      ],
      drafts: [
        {
          draftId: 'd-west-30',
          skuId: 'sku-1',
          warehouseCode: 'US-WEST',
          status: 'in_transit',
          openQty: 30,
          etaAvailable: '2026-09-24',
          remainingLogisticsDays: 7,
        },
      ],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: { 'US-WEST': 45 },
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE),
    });

    const draftLot = lots.find((l) => l.sourceId === 'd-west-30');
    assert.ok(draftLot);
    assert.equal(draftLot!.qty, 30);
    assert.equal(draftLot!.warehouseCode, 'US-WEST');
    assert.equal(draftLot!.pool, 'in_transit');
    assert.equal(draftLot!.availableAt, '2026-09-24');

    const residuals = lots.filter(
      (l) => l.source === 'snapshot' && l.pool === 'in_transit',
    );
    assert.equal(residuals.length, 1);
    assert.equal(residuals[0]!.warehouseCode, 'OVERSEAS');
    assert.equal(residuals[0]!.qty, 50);
    assert.equal(residuals[0]!.availableAt, null);
    assert.equal(residuals[0]!.dateUnknown, true);
    assert.ok(residuals[0]!.sourceId?.startsWith('transit-unalloc:'));
  });

  it('keeps dated residual buckets on OVERSEAS and leaves leftover undated', () => {
    const today = '2026-09-17';
    const { lots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'OVERSEAS',
          qtyAvailable: 0,
          qtyInTransit: 80,
          qtyReserved: 0,
          recordedDate: today,
        },
      ],
      drafts: [],
      shipments: [],
      today,
      defaultTransitLeadDaysByWarehouse: {},
      allocationBySku: allocationMap('sku-1', WEST_ONLY_SHARE, {
        transitBuckets: { d5: 40, d15: 20, d25: 10 },
      }),
    });

    const residuals = lots.filter(
      (l) => l.source === 'snapshot' && l.pool === 'in_transit',
    );
    const d5 = residuals.find((l) => l.sourceId === 'transit-unalloc:sku-1:OVERSEAS:d5');
    const d15 = residuals.find((l) => l.sourceId === 'transit-unalloc:sku-1:OVERSEAS:d15');
    const d25 = residuals.find((l) => l.sourceId === 'transit-unalloc:sku-1:OVERSEAS:d25');
    const undated = residuals.find(
      (l) => l.sourceId === 'transit-unalloc:sku-1:OVERSEAS:undated',
    );

    assert.equal(d5?.qty, 40);
    assert.equal(d5?.availableAt, addDaysIso(today, 5));
    assert.equal(d15?.qty, 20);
    assert.equal(d15?.availableAt, addDaysIso(today, 15));
    assert.equal(d25?.qty, 10);
    assert.equal(d25?.availableAt, addDaysIso(today, 25));
    assert.equal(undated?.qty, 10);
    assert.equal(undated?.availableAt, null);

    for (const dated of [d5, d15, d25]) {
      assert.ok(dated);
      assert.equal(dated!.etaEstimated, true);
      assert.notEqual(dated!.availableAt, null);
      assert.equal(
        classifySupplyLot({
          pool: dated!.pool,
          availableAt: dated!.availableAt,
          etaEstimated: dated!.etaEstimated,
          dateUnknown: dated!.dateUnknown,
          today,
        }),
        'planned',
      );
    }
  });

  it('does not re-split native warehouse snapshots as OVERSEAS share lots', () => {
    const { lots } = buildLotsFromInputs({
      snapshots: [
        {
          skuId: 'sku-1',
          warehouseCode: 'US-WEST',
          qtyAvailable: 10,
          qtyInTransit: 0,
          qtyReserved: 0,
          recordedDate: '2026-09-17',
        },
      ],
      drafts: [],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: {},
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE),
    });

    const overseas = lots.filter((l) => l.pool === 'overseas');
    assert.equal(overseas.length, 1);
    assert.equal(overseas[0]!.warehouseCode, 'US-WEST');
    assert.equal(overseas[0]!.qty, 10);
    assert.equal(overseas[0]!.sourceId, 'avail:sku-1:US-WEST');
  });

  it('keeps warehouse-less local drafts on IN-PRODUCTION regardless of sales share', () => {
    const draft: SupplyLotDraftInput = {
      draftId: 'd-share',
      skuId: 'sku-1',
      warehouseCode: null,
      status: 'in_production',
      openQty: 100,
      remainingLogisticsDays: 0,
    };

    const { lots } = buildLotsFromInputs({
      snapshots: [],
      drafts: [draft],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: {},
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE),
    });
    const local = lots.filter((l) => l.pool === 'local');
    assert.equal(local.length, 1);
    assert.equal(local[0]!.warehouseCode, 'IN-PRODUCTION');
    assert.equal(local[0]!.qty, 100);
    assert.equal(local[0]!.sourceId, 'd-share');
  });

  it('projects IN-PRODUCTION snapshot into local pool after deducting local drafts', () => {
    const { lots, eligibleLots } = buildLotsFromInputs({
      snapshots: [],
      drafts: [
        {
          draftId: 'd-local',
          skuId: 'sku-1',
          warehouseCode: 'US-WEST',
          status: 'in_production',
          openQty: 30,
          remainingLogisticsDays: 52,
        },
      ],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: {},
      allocationBySku: allocationMap('sku-1', WEST_EAST_SHARE, {
        earliestPoAvailableAt: '2026-11-01',
      }),
      inProduction: [{ skuId: 'sku-1', qty: 130 }],
    });

    const snapshotLocal = lots.filter(
      (l) => l.pool === 'local' && l.source === 'snapshot',
    );
    assert.equal(snapshotLocal.length, 1);
    assert.equal(snapshotLocal[0]!.warehouseCode, 'IN-PRODUCTION');
    assert.equal(snapshotLocal[0]!.qty, 100);
    assert.equal(snapshotLocal[0]!.sourceId, 'prod:sku-1:IN-PRODUCTION');
    assert.ok(snapshotLocal.every((l) => l.availableAt === '2026-11-01'));
    assert.equal(
      eligibleLots.filter((l) => l.source === 'snapshot' && l.pool === 'local').length,
      0,
      'in-production without ship-ready stays off the timeline',
    );
  });

  it('keeps unallocated in-production on IN-PRODUCTION local pool with no available_at', () => {
    const { lots } = buildLotsFromInputs({
      snapshots: [],
      drafts: [],
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: {},
      inProduction: [{ skuId: 'sku-2', qty: 80 }],
    });
    assert.equal(lots.length, 1);
    assert.equal(lots[0]!.pool, 'local');
    assert.equal(lots[0]!.warehouseCode, 'IN-PRODUCTION');
    assert.equal(lots[0]!.qty, 80);
    assert.equal(lots[0]!.availableAt, null);
    assert.equal(lots[0]!.sourceId, 'prod:sku-2:IN-PRODUCTION');
  });
});
