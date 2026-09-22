import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROCESS_RATES,
  buildBoardSheetRow,
  isRolledProcessLine,
  perimeterMeters,
  piecesPerSheet,
} from './board-sheet.js';

describe('piecesPerSheet', () => {
  it('cuts on usable 1200×2400 with length along the long side', () => {
    assert.equal(piecesPerSheet(1200, 400), 6);
    assert.equal(piecesPerSheet(770, 388), 9);
    assert.equal(piecesPerSheet(517, 345), 12);
    assert.equal(piecesPerSheet(203, 60), 220);
    assert.equal(piecesPerSheet(527, 210), 20);
  });

  it('does not rotate to a denser layout', () => {
    assert.equal(piecesPerSheet(527, 210), 20);
  });

  it('returns 0 when the part does not fit the usable sheet', () => {
    assert.equal(piecesPerSheet(2500, 1300), 0);
  });
});

describe('perimeterMeters', () => {
  it('uses both dimensions times qty in meters', () => {
    assert.equal(perimeterMeters(1200, 400, 2), 6.4);
  });
});

describe('isRolledProcessLine', () => {
  it('only rolls 加工 named 开料/封边/打孔/开槽/喷漆', () => {
    assert.equal(isRolledProcessLine('加工', '开料'), true);
    assert.equal(isRolledProcessLine('板材', '封边'), false);
    assert.equal(isRolledProcessLine('加工', '加工打包'), false);
  });
});

describe('buildBoardSheetRow', () => {
  it('costs by sheet price over integer yield without loss', () => {
    const row = buildBoardSheetRow({
      materialName: '侧板',
      spec: '18mm 1200×400',
      qtyNet: 2,
      sheetPrice: 68,
      defaultSubstrate: '密度板',
      rates: DEFAULT_PROCESS_RATES,
    });
    assert.equal(row?.piecesPerSheet, 6);
    assert.equal(row?.usableWidthMm, 1200);
    assert.equal(row?.usableLengthMm, 2400);
    assert.equal(row?.boardCost, 22.67);
    assert.equal(row?.cutMeters, 6.4);
    assert.equal(row?.cutAmount, 1.92);
    assert.equal(row?.bandAmount, 3.2);
    assert.equal(row?.drillAmount, 0);
    assert.equal(row?.subtotal, 27.79);
    assert.equal(row?.pricingMode, 'sheet');
    assert.equal(row?.substrate, '密度板');
  });

  it('matches business excel board cost for drawer bottom', () => {
    const row = buildBoardSheetRow({
      materialName: '抽屉底板',
      spec: '5mm 515×370',
      qtyNet: 9,
      sheetPrice: 50,
      defaultSubstrate: '密度板',
      rates: DEFAULT_PROCESS_RATES,
    });
    assert.equal(row?.piecesPerSheet, 12);
    assert.equal(row?.boardCost, 37.5);
    assert.equal(row?.usableWidthMm, 1200);
    assert.equal(row?.usableLengthMm, 2400);
  });

  it('applies drill override', () => {
    const row = buildBoardSheetRow({
      materialName: '侧板',
      spec: '18mm 1200×400',
      qtyNet: 1,
      sheetPrice: 60,
      rates: DEFAULT_PROCESS_RATES,
      overrides: { drillCount: 10 },
    });
    assert.equal(row?.drillCount, 10);
    assert.equal(row?.drillAmount, 1.5);
  });
});
