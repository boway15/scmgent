import { normalizeSalesPlatform } from './forecast-demand.js';
import {
  FORECAST_V41_PLATFORM_CODES,
  isForecastV41PlatformCode,
} from './forecast-platform-scope.js';

export type ForecastChannelView = 'merged' | 'by_channel';

export type ForecastChannelQuery = {
  channelView: ForecastChannelView;
  /** 分渠道时要逐行列出的渠道。合并视角为空。空数组表示筛选无匹配渠道。 */
  platforms: string[];
};

const V41_ORDER = new Map(FORECAST_V41_PLATFORM_CODES.map((code, index) => [code, index]));

/** 合并行展示名。分渠道行保持渠道码，与列表、导出同一口径。 */
export function formatForecastChannelLabel(platform?: string | null): string {
  const code = platform?.trim();
  if (!code || code.toUpperCase() === 'ALL') return '全渠道';
  return code;
}

function normalizeChannelCodes(raw?: string[] | null): string[] {
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const code = normalizeSalesPlatform(item);
    if (!isForecastV41PlatformCode(code)) continue;
    seen.add(code);
  }
  return [...seen].sort((a, b) => (V41_ORDER.get(a) ?? 0) - (V41_ORDER.get(b) ?? 0));
}

/**
 * 合并：一个 SKU 一行，全渠道加总。
 * 分渠道：一个 SKU 的每个渠道各一行。未选渠道时列出全部已定义渠道。
 * 未传 channelView 时保持旧参数：空 / ALL 为合并，单个渠道码为该渠道一行。
 */
export function resolveForecastChannelQuery(input: {
  channelView?: string | null;
  platform?: string | null;
  platforms?: string[] | null;
}): ForecastChannelQuery {
  const explicit = input.channelView?.trim().toLowerCase();
  const listedProvided = (input.platforms?.length ?? 0) > 0;
  const listed = normalizeChannelCodes(input.platforms);
  const singleRaw = input.platform?.trim() ?? '';
  const singleNorm = singleRaw ? normalizeSalesPlatform(singleRaw) : '';
  const single =
    singleNorm && isForecastV41PlatformCode(singleNorm) ? [singleNorm] : [];
  const singleInvalid = Boolean(singleRaw && singleNorm !== 'ALL' && single.length === 0);
  const listedInvalid = listedProvided && listed.length === 0;

  if (explicit === 'merged') {
    return { channelView: 'merged', platforms: [] };
  }

  if (explicit === 'by_channel') {
    if (listed.length) return { channelView: 'by_channel', platforms: listed };
    if (listedInvalid || singleInvalid) return { channelView: 'by_channel', platforms: [] };
    if (single.length) return { channelView: 'by_channel', platforms: single };
    return { channelView: 'by_channel', platforms: [...FORECAST_V41_PLATFORM_CODES] };
  }

  if (listed.length) return { channelView: 'by_channel', platforms: listed };
  if (listedInvalid || singleInvalid) return { channelView: 'by_channel', platforms: [] };
  if (single.length) return { channelView: 'by_channel', platforms: single };
  return { channelView: 'merged', platforms: [] };
}
