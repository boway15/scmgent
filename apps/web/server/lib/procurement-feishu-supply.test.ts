import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDestWarehouseByRequestNo,
  createWarehouseLabelResolver,
  feishuFollowUpRowsToDraftInputs,
  mapFeishuFollowUpStatus,
} from './procurement-feishu-supply.js';
import { buildLotsFromInputs } from './inventory-supply-lots.js';

describe('procurement-feishu-supply', () => {
  const resolveWarehouse = createWarehouseLabelResolver({
    warehouseCodes: ['US-EAST', 'US-WEST'],
    warehouseNames: { 'US-EAST': '美东仓' },
  });

  it('maps feishu status strings to internal pool statuses', () => {
    assert.equal(mapFeishuFollowUpStatus('生产中'), 'in_production');
    assert.equal(mapFeishuFollowUpStatus('在途'), 'in_transit');
    assert.equal(mapFeishuFollowUpStatus('已收货'), 'received');
  });

  it('resolves 目的仓 from bulk index by 需求单号', () => {
    const destByRequestNo = buildDestWarehouseByRequestNo(
      [{ rowData: { 需求单号: 'R-1', 目的仓: '美东仓' } }],
      resolveWarehouse,
    );
    assert.equal(destByRequestNo.get('R-1'), 'US-EAST');

    const drafts = feishuFollowUpRowsToDraftInputs({
      rows: [
        {
          rowIndex: 1,
          rowData: {
            需求单号: 'R-1',
            SKU: 'SKU-A',
            状态: '生产中',
            未入库数量: '100',
            确认交期: '2026-11-01',
          },
        },
      ],
      skuCodeToId: new Map([['SKU-A', 'sku-a-id']]),
      destByRequestNo,
      resolveWarehouse,
    });

    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.warehouseCode, 'US-EAST');
    assert.equal(drafts[0]?.openQty, 100);
    assert.equal(drafts[0]?.etaAvailable, '2026-11-01');
  });

  it('keeps OVERSEAS when bulk has no 目的仓', () => {
    const destByRequestNo = buildDestWarehouseByRequestNo(
      [{ rowData: { 需求单号: 'R-2', 目的仓: '' } }],
      resolveWarehouse,
    );
    const drafts = feishuFollowUpRowsToDraftInputs({
      rows: [
        {
          rowIndex: 2,
          rowData: {
            需求单号: 'R-2',
            SKU: 'SKU-B',
            状态: '在途',
            采购数量: '50',
            确认交期: '2026-10-15',
          },
        },
      ],
      skuCodeToId: new Map([['SKU-B', 'sku-b-id']]),
      destByRequestNo,
      resolveWarehouse,
    });

    assert.equal(drafts[0]?.warehouseCode, null);

    const { lots } = buildLotsFromInputs({
      snapshots: [],
      drafts,
      shipments: [],
      today: '2026-09-17',
      defaultTransitLeadDaysByWarehouse: { OVERSEAS: 60 },
    });
    const transit = lots.find((l) => l.skuId === 'sku-b-id');
    assert.ok(transit);
    assert.equal(transit.warehouseCode, 'OVERSEAS');
    assert.equal(transit.pool, 'in_transit');
  });
});
