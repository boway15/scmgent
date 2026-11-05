export type HorizonChannelView = 'merged' | 'by_channel';

export function channelQuery(input: {
  split: boolean;
  primaryPlatform: string;
  platforms: string[];
}): { channelView: HorizonChannelView; platforms: string[] } {
  if (!input.split) {
    const code = input.primaryPlatform.trim();
    if (!code) return { channelView: 'merged', platforms: [] };
    return { channelView: 'by_channel', platforms: [code] };
  }
  return { channelView: 'by_channel', platforms: input.platforms };
}

export function initialChannelSelection(initialPlatform: string): {
  split: boolean;
  primaryPlatform: string;
  platforms: string[];
} {
  const code = initialPlatform.trim();
  if (!code || code.toUpperCase() === 'ALL') {
    return { split: false, primaryPlatform: '', platforms: [] };
  }
  return { split: false, primaryPlatform: code, platforms: [code] };
}
