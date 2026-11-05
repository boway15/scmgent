import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectDemandPlanCalibrationImportFormat,
  parseDemandPlanCalibrationImportCsvBuffer,
} from './demand-plan-calibration-import.js';

describe('demand-plan-calibration-import', () => {
  it('detects wide format from ISO week columns', () => {
    const csv = Buffer.from(
      'SKU,平台,2026-W10,2026-W11\nSKU1,Amazon,1.2,1.3\n',
      'utf8',
    );
    const parsed = parseDemandPlanCalibrationImportCsvBuffer(csv);
    assert.equal(parsed.format, 'wide');
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]?.weekKey, '2026-W10');
  });

  it('detects detail format with 绝对周', () => {
    const format = detectDemandPlanCalibrationImportFormat([
      { 时段: '未来', SKU: 'A', 平台: 'Amazon', 绝对周: '2026-W10', 校准值: '1' },
    ]);
    assert.equal(format, 'detail');
  });
});
