import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReinspectionBitableFields,
  buildReinspectionRefreshFields,
  collectFactoryWhitelist,
  formatShanghaiDate,
  selectNewReinspectionSourceIds,
} from './qc-reinspection-plan.js';

describe('formatShanghaiDate', () => {
  it('uses the Asia/Shanghai calendar date', () => {
    assert.equal(formatShanghaiDate(Date.parse('2026-10-22T16:30:00Z')), '2026-10-23');
  });
});

describe('selectNewReinspectionSourceIds', () => {
  it('keeps whitelist factories that have not been inserted', () => {
    assert.deepEqual(
      selectNewReinspectionSourceIds({
        source: [
          { recordId: 'a', factoryName: '甲公司' },
          { recordId: 'b', factoryName: '乙公司' },
          { recordId: 'c', factoryName: '甲公司' },
          { recordId: 'd', factoryName: ' 甲公司 ' },
        ],
        whitelist: ['甲公司'],
        existingSourceIds: ['c'],
      }),
      ['a', 'd'],
    );
  });
});

describe('collectFactoryWhitelist', () => {
  it('reads factory full names only from placeholder rows', () => {
    assert.deepEqual(
      collectFactoryWhitelist([
        { factoryName: '甲公司', sourceRecordId: '' },
        { factoryName: '甲公司', sourceRecordId: '' },
        { factoryName: '乙公司', sourceRecordId: 'rec1' },
        { factoryName: '  ', sourceRecordId: '' },
      ]),
      ['甲公司'],
    );
  });
});

describe('buildReinspectionBitableFields', () => {
  it('writes the short name and insertion time, and leaves the full name out', () => {
    const fields = buildReinspectionBitableFields(
      {
        recordId: 'rec1',
        factoryName: '漳州贝杰森工贸有限公司',
        supplierShortName: 'ZZBJS',
        inspectionStatus: '合格',
        purchaseOrderNo: 'PO1',
        demandNo: 'D1',
        sku: 'DJ1',
        productName: '椅子',
        cartonCount: '2',
        pieceCount: '',
        destWarehouse: '美西',
        factoryType: 'FOB',
        expectedShipDate: '2026-10-22',
        containerCartonCount: '1',
        containerPieceCount: '3',
        transferStatus: '已放舱',
        followUpReadyAtMs: Date.parse('2026-05-15T00:00:00Z'),
        goodsReadyAtMs: null,
        loadingNote: '',
        gapDays: 90,
      },
      Date.parse('2026-10-23T01:00:00Z'),
    );

    assert.equal(fields['供应商简称'], 'ZZBJS');
    assert.equal(fields['来源记录ID'], 'rec1');
    assert.equal(fields['首次插入时间'], Date.parse('2026-10-23T01:00:00Z'));
    assert.equal(fields['数据同步时间'], Date.parse('2026-10-23T01:00:00Z'));
    assert.equal('插入时间' in fields, false);
    assert.equal(fields['跟单货好时间-期望出货时间差'], 90);
    assert.equal(fields['总箱数'], 2);
    assert.equal(fields['工厂名称'], undefined);
    assert.equal(fields['供应商名称'], undefined);
    assert.equal('货好时间' in fields, false);
    assert.equal('装柜备注' in fields, false);
  });

  it('refreshes the sync time and keeps the first insert time untouched', () => {
    const row = {
      recordId: 'rec1',
      factoryName: '漳州贝杰森工贸有限公司',
      supplierShortName: 'ZZBJS',
      inspectionStatus: '合格',
      purchaseOrderNo: 'PO1',
      demandNo: 'D1',
      sku: 'DJ1',
      productName: '椅子',
      cartonCount: '2',
      pieceCount: '',
      destWarehouse: '美西',
      factoryType: 'FOB',
      expectedShipDate: '2026-10-22',
      containerCartonCount: '1',
      containerPieceCount: '3',
      transferStatus: '已放舱',
      followUpReadyAtMs: Date.parse('2026-05-15T00:00:00Z'),
      goodsReadyAtMs: null,
      loadingNote: '',
      gapDays: 90,
    };
    const syncedAt = Date.parse('2026-10-24T01:00:00Z');
    const refreshed = buildReinspectionRefreshFields(row, syncedAt, null);
    assert.equal(refreshed['数据同步时间'], syncedAt);
    assert.equal('首次插入时间' in refreshed, false);

    const backfilled = buildReinspectionRefreshFields(row, syncedAt, Date.parse('2026-10-23T01:00:00Z'));
    assert.equal(backfilled['首次插入时间'], Date.parse('2026-10-23T01:00:00Z'));
    assert.equal(backfilled['数据同步时间'], syncedAt);
  });
});
