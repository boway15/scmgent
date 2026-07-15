import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  excelSerialToIsoDate,
  formatTurnoverDateValue,
  formatXlsxCellValue,
  isTurnoverDateColumn,
} from './turnover-date-format.js';

describe('turnover-date-format', () => {
  it('detects turnover date columns', () => {
    assert.equal(isTurnoverDateColumn('采购单最早上架时间'), true);
    assert.equal(isTurnoverDateColumn('海外仓断货时间_美东'), true);
    assert.equal(isTurnoverDateColumn('最早上架_美西'), true);
    assert.equal(isTurnoverDateColumn('预计10天上架_美东'), false);
    assert.equal(isTurnoverDateColumn('海外断货天数_美东'), false);
    assert.equal(isTurnoverDateColumn('30天销量'), false);
  });

  it('converts Excel serial numbers to ISO dates', () => {
    assert.equal(excelSerialToIsoDate(46247), '2026-08-13');
    assert.equal(excelSerialToIsoDate(46202), '2026-06-29');
    assert.equal(formatTurnoverDateValue('采购单最早上架时间', '46247'), '2026-08-13');
    assert.equal(formatTurnoverDateValue('最早上架_美东', 46202), '2026-06-29');
  });

  it('leaves non-date columns unchanged', () => {
    assert.equal(formatTurnoverDateValue('海外断货天数_美东', '55'), '55');
    assert.equal(formatTurnoverDateValue('预计10天上架_美东', '0'), '0');
  });

  it('formats xlsx numeric date cells on parse', () => {
    assert.equal(formatXlsxCellValue('采购单最早上架时间', 46247), '2026-08-13');
    assert.equal(formatXlsxCellValue('30天销量', 46247), '46247');
  });
});
