import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import {
  formatForecastChannelLabel,
  resolveForecastChannelQuery,
} from './forecast-channel-view.js';

describe('resolveForecastChannelQuery', () => {
  it('defaults to merged when view and platform are empty', () => {
    assert.deepEqual(resolveForecastChannelQuery({}), {
      channelView: 'merged',
      platforms: [],
    });
  });

  it('keeps a legacy single platform as one by-channel row', () => {
    assert.deepEqual(resolveForecastChannelQuery({ platform: 'amazon' }), {
      channelView: 'by_channel',
      platforms: ['AMAZON'],
    });
  });

  it('treats explicit merged as a full-channel sum and ignores channel picks', () => {
    assert.deepEqual(
      resolveForecastChannelQuery({
        channelView: 'merged',
        platforms: ['AMAZON', 'WALMART'],
      }),
      { channelView: 'merged', platforms: [] },
    );
  });

  it('lists every channel when by-channel is selected with no filter', () => {
    assert.deepEqual(
      resolveForecastChannelQuery({ channelView: 'by_channel' }),
      { channelView: 'by_channel', platforms: [...FORECAST_V41_PLATFORM_CODES] },
    );
  });

  it('keeps only the selected channels, in canonical order, without summing them', () => {
    assert.deepEqual(
      resolveForecastChannelQuery({
        channelView: 'by_channel',
        platforms: ['walmart', 'AMAZON', 'AMAZON', 'ALL'],
      }),
      { channelView: 'by_channel', platforms: ['AMAZON', 'WALMART'] },
    );
  });

  it('returns no channels when the filter is not a known channel', () => {
    assert.deepEqual(resolveForecastChannelQuery({ platform: 'NOT_A_CHANNEL' }), {
      channelView: 'by_channel',
      platforms: [],
    });
  });
});

describe('formatForecastChannelLabel', () => {
  it('labels the merged row as 全渠道', () => {
    assert.equal(formatForecastChannelLabel('ALL'), '全渠道');
    assert.equal(formatForecastChannelLabel(''), '全渠道');
  });

  it('keeps a single channel code', () => {
    assert.equal(formatForecastChannelLabel('AMAZON'), 'AMAZON');
  });
});
