import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaselineDraftVersionName } from './forecast-version-label.js';
import {
  FORECAST_VERSION_NAME_MAX_LEN,
  FORECAST_VERSION_NO_MAX_LEN,
  clampDraftVersionName,
  isSafeForecastVersionNo,
} from './forecast-version.js';

describe('forecast draft version identity', () => {
  it('documents that long category labels exceed version_no varchar(50)', () => {
    const name = buildBaselineDraftVersionName({
      monthCount: 6,
      platform: 'ALL',
      category:
        'DJ01-郑州大件\\非Amazon项目6组-第二曲线-US\\客厅-电视柜 TV Stands & Entertainment Centers',
      now: new Date('2026-07-23T00:00:00.000Z'),
    });
    assert.ok(name.length > FORECAST_VERSION_NO_MAX_LEN);
    assert.equal(isSafeForecastVersionNo(name), false);
  });

  it('clamps draft version_name to column limit and keeps room for uniqueness suffix', () => {
    const long = `品类 ${'很长品类路径'.repeat(40)} · 2026-07-23`;
    const clamped = clampDraftVersionName(long);
    assert.ok(clamped.length <= FORECAST_VERSION_NAME_MAX_LEN);
    assert.ok(clamped.length < long.length);

    const withSuffix = clampDraftVersionName(`${long} · #2`);
    assert.ok(withSuffix.length <= FORECAST_VERSION_NAME_MAX_LEN);
    assert.match(withSuffix, /· #2$/);
  });

  it('accepts short DRAFT-* codes as version_no', () => {
    assert.equal(isSafeForecastVersionNo(`DRAFT-${Date.now()}`), true);
    assert.equal(isSafeForecastVersionNo('DRAFT-1783563749953'), true);
  });
});
