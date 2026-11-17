import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCalibrationWritableLeaf,
  canEditForecastCalibration,
  canExportCalibrationTable,
  isMergedRegionCalibrationView,
} from './forecast-calibration-guard.js';

describe('forecast-calibration-guard', () => {
  it('blocks ALL platform and ALL region rows', () => {
    assert.equal(assertCalibrationWritableLeaf({ platform: 'ALL', salesRegion: 'US' }).ok, false);
    assert.equal(assertCalibrationWritableLeaf({ platform: 'AMAZON', salesRegion: 'ALL' }).ok, false);
    assert.equal(assertCalibrationWritableLeaf({ platform: 'AMAZON', salesRegion: 'US' }).ok, true);
  });

  it('detects merged region view and treats a single selected region as a leaf', () => {
    assert.equal(isMergedRegionCalibrationView({ splitByRegion: true }), false);
    assert.equal(isMergedRegionCalibrationView({ splitByRegion: false }), true);
    assert.equal(
      isMergedRegionCalibrationView({ splitByRegion: false, salesRegions: ['US'] }),
      false,
    );
    assert.equal(
      isMergedRegionCalibrationView({ splitByRegion: false, salesRegions: ['US', 'EU'] }),
      true,
    );
  });

  it('canEditForecastCalibration allows split region or exactly one selected region', () => {
    assert.equal(
      canEditForecastCalibration({
        mergedChannelView: true,
        splitByRegion: true,
      }),
      false,
    );
    assert.equal(
      canEditForecastCalibration({
        mergedChannelView: false,
        splitByRegion: false,
      }),
      false,
    );
    assert.equal(
      canEditForecastCalibration({
        mergedChannelView: false,
        splitByRegion: false,
        salesRegions: ['US', 'EU'],
      }),
      false,
    );
    assert.equal(
      canEditForecastCalibration({
        mergedChannelView: false,
        splitByRegion: true,
      }),
      true,
    );
    assert.equal(
      canEditForecastCalibration({
        mergedChannelView: false,
        splitByRegion: false,
        salesRegions: ['US'],
      }),
      true,
    );
  });

  it('canExportCalibrationTable requires split platform and a leaf region view', () => {
    assert.equal(canExportCalibrationTable({ channelView: 'merged', splitByRegion: true }), false);
    assert.equal(canExportCalibrationTable({ channelView: 'by_channel', splitByRegion: false }), false);
    assert.equal(canExportCalibrationTable({ channelView: 'by_channel', splitByRegion: true }), true);
    assert.equal(
      canExportCalibrationTable({
        channelView: 'by_channel',
        splitByRegion: false,
        salesRegions: ['EU'],
      }),
      true,
    );
  });
});
