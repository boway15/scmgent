import assert from 'node:assert/strict';
import {
  buildBusinessNosByContainer,
  buildFactoryTypesByContainerMerchant,
  buildSkuCodesByContainerMerchant,
  enrichContainerStats,
  parseFactoryTypeFromRemark,
} from './fob-allocation-base-meta.js';

assert.equal(parseFactoryTypeFromRemark('业务编号:D001；类别:FOB'), 'FOB');
assert.equal(parseFactoryTypeFromRemark(null), null);

const truckingBiz = buildBusinessNosByContainer('trucking', [
  { containerNo: 'C1', internalNo: 'B002' },
  { containerNo: 'C1', internalNo: 'B001' },
  { containerNo: 'C1', internalNo: 'B001' },
  { containerNo: 'C2', internalNo: '' },
], []);
assert.equal(truckingBiz.get('C1'), 'B001,B002');
assert.equal(truckingBiz.get('C2'), undefined);

const freightBiz = buildBusinessNosByContainer('freight', [], [
  { containerNo: 'C3', orderNo: 'HW-9' },
]);
assert.equal(freightBiz.get('C3'), 'HW-9');

const factoryTypes = buildFactoryTypesByContainerMerchant([
  {
    containerNo: 'C1',
    merchantCode: 'M1',
    remark: '类别:FOB',
  },
  {
    containerNo: 'C1',
    merchantCode: 'M1',
    remark: '类别:退税',
  },
  {
    containerNo: 'C1',
    merchantCode: 'M2',
    remark: '类别:FOB',
  },
]);
assert.equal(factoryTypes.get('C1|M1'), '退税,FOB');
assert.equal(factoryTypes.get('C1|M2'), 'FOB');

const skuCodes = buildSkuCodesByContainerMerchant([
  { containerNo: 'C1', merchantCode: 'M1', skuCode: 'SKU-B' },
  { containerNo: 'C1', merchantCode: 'M1', skuCode: 'SKU-A' },
  { containerNo: 'C1', merchantCode: 'M1', skuCode: 'SKU-A' },
]);
assert.equal(skuCodes.get('C1|M1'), 'SKU-A,SKU-B');

const enriched = enrichContainerStats(
  [{ id: '1', containerNo: 'C1', merchantCode: 'M1', volumeCbm: '1', ticketCount: 1 }],
  {
    settlementType: 'trucking',
    truckingItems: [{ containerNo: 'C1', internalNo: 'B100' }],
    freightItems: [],
    merchantShipments: [
      { containerNo: 'C1', merchantCode: 'M1', remark: '类别:FOB', skuCode: 'SKU-1' },
    ],
  },
);
assert.equal(enriched[0]?.businessNos, 'B100');
assert.equal(enriched[0]?.factoryType, 'FOB');
assert.equal(enriched[0]?.skuCodes, 'SKU-1');

console.log('fob-allocation-base-meta.test.ts ok');
