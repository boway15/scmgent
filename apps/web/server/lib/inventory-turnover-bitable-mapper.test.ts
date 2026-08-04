import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calendarMonthLabel,
  isFeishuCompressedTurnoverFormat,
  mapInventoryTurnoverBitableFields,
  mapInventoryTurnoverBitableRecords,
} from './inventory-turnover-bitable-mapper.js';
import { expandFobInventoryRows, isFobInventoryFormat } from './fob-inventory-import.js';

describe('inventory-turnover-bitable-mapper', () => {
  const sampleFields = {
    SKU: 'DJ503970_2',
    SKU名称: 'EU KM 箱式液压床',
    品类: '床Beds',
    销售国家: '法国,德国',
    产品分类: 'C',
    负责人: '齐子婷',
    开发人员: '郜应帅',
    供应商编码: 'SUP23111300027',
    供应商简称: 'XMYS',
    采购周期: '50',
    采购价: '692',
    币种: 'CNY',
    Id: '3565',
    ProductBaseID: '802498',
    SupplierId: '1246084',
    美东: '0.41',
    美西: '0.29',
    美南: '0.12',
    美中: '0',
    美东南: '0.18',
    德国: '0',
    平台仓_美: '0',
    平台仓_欧: '0',
    海外仓在库: '27',
    '预计10天内|10-20天|超20天上架数量': '1|2|3',
    调拨在途合计: '5',
    供应商订单: '10',
    预下单: '4',
    全链条合计库存: '46',
    上月销量: '34',
    上上月销量: '58',
    '3天销量': '2',
    '7天销量': '10',
    '14天销量': '22',
    '30天销量': '52',
    本月预测日均销量: '2',
    下月预测日均销量: '2.1',
    预计海外仓周转天数: '14',
    预计海外在途周转天数: '0',
    预计海外周转天数: '14',
    预计国内周转: '0',
    预计全链条周转: '14',
    预计海外断货天数: '31',
    '全链条断货时间(不含预下单)': '2026-10-27',
    '体积(m3)': '0.1961',
    '毛重(Kg)': '54.3',
    '近30天毛利率(AMZ)': '22.60%',
    已调拨未在途: '0',
  };

  it('maps dual keys, sales shares, and ETA pipe (no fake region stock)', () => {
    const now = new Date('2026-07-24T00:00:00+08:00');
    const mapped = mapInventoryTurnoverBitableFields(sampleFields, { now });
    assert.ok(mapped);
    assert.equal(mapped.row.SKU, 'DJ503970_2');
    assert.equal(mapped.row['美东'], '0.41');
    assert.equal(mapped.row['美西'], '0.29');
    assert.equal(mapped.row['海外仓库存_德国'], undefined);
    assert.equal(mapped.row['海外仓库存_合计'], '27');
    assert.equal(mapped.row['海外仓在库'], '27');
    assert.equal(mapped.row['调拨在途_合计'], '5');
    assert.equal(mapped.row['供应商订单合计'], '10');
    assert.equal(mapped.row['预计10天上架_合计'], '1');
    assert.equal(mapped.row['预计10-20天上架_合计'], '2');
    assert.equal(mapped.row['预计超20天上架_合计'], '3');
    assert.equal(mapped.row['海外周转_合计'], '14');
    assert.equal(mapped.row['体积（m3）'], '0.1961');
    assert.equal(mapped.row['亚马逊近30毛利率'], '22.60%');
    assert.equal(mapped.row['全链条断货时间（不含预下单）_合计'], '2026-10-27');
    assert.equal(mapped.row[`${calendarMonthLabel(now, -1)}月销量`], '34');
    assert.equal(mapped.row[`${calendarMonthLabel(now, 0)}月预测日均销量`], '2');
    assert.equal(mapped.regionOverseasMismatch, false);
    assert.ok(Math.abs(mapped.regionSum - 1) < 0.01);
  });

  it('produces rows accepted by FOB turnover import expand', () => {
    const mapped = mapInventoryTurnoverBitableFields(sampleFields);
    assert.ok(mapped);
    const rows = [mapped.row];
    assert.equal(isFeishuCompressedTurnoverFormat(rows), true);
    assert.equal(isFobInventoryFormat(rows), true);
    const expanded = expandFobInventoryRows(rows, '2026-07-24');
    assert.equal(expanded.length, 1);
    assert.equal(expanded[0]?.qtyInProduction, 10);
    assert.equal(expanded[0]?.qtyPreOrder, 4);
    assert.ok(
      expanded[0]?.warehouseBuckets?.some(
        (b) => b.warehouse === 'OVERSEAS' && b.qtyAvailable === 27 && b.qtyInTransit === 5,
      ),
    );
    assert.equal(expanded[0]?.turnoverSnapshot?.['海外仓库存_合计'], '27');
    assert.equal(expanded[0]?.turnoverSnapshot?.['调拨在途_合计'], '5');
    assert.equal(expanded[0]?.turnoverSnapshot?.['美东'], '0.41');
    // 飞书无生命周期列：展开后不得带上 lifecycle，避免覆盖商品主数据
    assert.equal(expanded[0]?.lifecycle, undefined);
  });

  it('counts sales-share sum anomalies across records', () => {
    const result = mapInventoryTurnoverBitableRecords([
      { record_id: 'r1', fields: sampleFields },
      {
        record_id: 'r2',
        fields: { SKU: 'X', 海外仓在库: '1', 德国: '0.5', 调拨在途合计: '0' },
      },
      { record_id: 'r3', fields: { 品类: 'no-sku' } },
    ]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.mismatchCount, 1);
    assert.equal(result.skipped, 1);
  });
});
