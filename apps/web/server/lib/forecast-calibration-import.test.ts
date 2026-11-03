import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyImportEquals,
  detectCalibrationImportFormat,
  normalizeImportMonthLabel,
  parseCalibrationDaily,
  parseCalibrationImportCsvBuffer,
  parseCalibrationImportPlatform,
  shouldApplyCalibrationImport,
  shouldApplyCalibrationWideImport,
} from './forecast-calibration-import.js';

describe('parseCalibrationImportPlatform', () => {
  it('rejects merged ALL label', () => {
    assert.deepEqual(parseCalibrationImportPlatform('全平台'), { error: 'merged' });
    assert.deepEqual(parseCalibrationImportPlatform('ALL'), { error: 'merged' });
  });

  it('accepts v41 platform codes', () => {
    assert.deepEqual(parseCalibrationImportPlatform('AMAZON'), { platform: 'AMAZON' });
  });
});

describe('shouldApplyCalibrationWideImport', () => {
  it('skips when incoming equals system', () => {
    assert.equal(
      shouldApplyCalibrationWideImport({ incoming: 0.83, systemForecast: 0.83 }),
      false,
    );
  });

  it('skips when incoming matches system at 2-decimal export precision', () => {
    assert.equal(
      shouldApplyCalibrationWideImport({ incoming: 61.29, systemForecast: 61.2934 }),
      false,
    );
  });

  it('applies when incoming differs from system', () => {
    assert.equal(
      shouldApplyCalibrationWideImport({ incoming: 1.1, systemForecast: 0.9 }),
      true,
    );
  });
});

describe('shouldApplyCalibrationImport', () => {
  it('skips when incoming equals current manual', () => {
    assert.equal(
      shouldApplyCalibrationImport({
        incoming: 1.5,
        currentManual: 1.5,
        systemForecast: 2,
      }),
      false,
    );
  });

  it('skips when no manual and incoming equals system', () => {
    assert.equal(
      shouldApplyCalibrationImport({
        incoming: 0.83,
        currentManual: null,
        systemForecast: 0.83,
      }),
      false,
    );
  });

  it('applies when manual differs', () => {
    assert.equal(
      shouldApplyCalibrationImport({
        incoming: 1.2,
        currentManual: 0.9,
        systemForecast: 0.8,
      }),
      true,
    );
  });

  it('applies when new manual overrides system', () => {
    assert.equal(
      shouldApplyCalibrationImport({
        incoming: 1.1,
        currentManual: null,
        systemForecast: 0.9,
      }),
      true,
    );
  });
});

describe('parseCalibrationDaily', () => {
  it('treats blank as null', () => {
    assert.equal(parseCalibrationDaily(''), null);
    assert.equal(parseCalibrationDaily('  '), null);
  });

  it('rounds to export compare precision', () => {
    assert.equal(parseCalibrationDaily('1.23456'), 1.23);
    assert.equal(parseCalibrationDaily('61.29'), 61.29);
  });
});

describe('dailyImportEquals', () => {
  it('compares at export precision (2 decimals)', () => {
    assert.equal(dailyImportEquals(61.29, 61.2934), true);
    assert.equal(dailyImportEquals(61.29, 61.3), false);
  });
});

describe('normalizeImportMonthLabel', () => {
  it('parses excel formula month cells', () => {
    assert.equal(normalizeImportMonthLabel('="2026-07"'), '2026-07');
    assert.equal(normalizeImportMonthLabel('2026-07'), '2026-07');
  });
});

describe('detectCalibrationImportFormat', () => {
  it('detects wide table by month columns', () => {
    assert.equal(
      detectCalibrationImportFormat([
        { SKU: 'A', 平台: 'AMAZON', '2026-07': '1.0', '2026-08': '' },
      ]),
      'wide',
    );
  });

  it('detects detail table', () => {
    assert.equal(
      detectCalibrationImportFormat([
        {
          时段: '未来',
          SKU: 'A',
          平台: 'AMAZON',
          绝对月: '2026-07',
          校准值: '1.2',
        },
      ]),
      'detail',
    );
  });
});

describe('parseCalibrationImportCsvBuffer wide', () => {
  it('expands one wide row into multiple month cells', () => {
    const csv = 'SKU,平台,2026-07,2026-08\r\nSKU-A,AMAZON,1.50,\r\n';
    const parsed = parseCalibrationImportCsvBuffer(Buffer.from(csv, 'utf8'));
    assert.equal(parsed.format, 'wide');
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.monthLabel, '2026-07');
    assert.equal(parsed.rows[0]?.calibrationRaw, '1.50');
    assert.equal(parsed.rows[1]?.calibrationRaw, '');
  });
});
