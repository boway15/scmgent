import { normalizeSalesPlatform } from './forecast-demand.js';

const BASELINE_PLATFORM_LABEL: Record<string, string> = {
  ALL: '全平台',
  AMAZON: '亚马逊',
  WALMART: '沃尔玛',
  TEMU: 'Temu',
  TIKTOK: 'TikTok',
  UNKNOWN: '未知',
};

const BASELINE_PLATFORM_LABEL_REVERSE = new Map(
  Object.entries(BASELINE_PLATFORM_LABEL).map(([code, label]) => [label, code]),
);

/** 从自动生成的 version_name 解析生成渠道；全平台或无法识别时返回 null */
export function parseBaselinePlatformFromVersionName(versionName?: string | null): string | null {
  const parts = versionName?.trim().split(' · ');
  if (!parts || parts.length < 2) return null;
  const platformLabel = parts[1]?.trim();
  if (!platformLabel) return null;

  const code = BASELINE_PLATFORM_LABEL_REVERSE.get(platformLabel);
  if (code && code !== 'ALL') return code;

  const normalized = normalizeSalesPlatform(platformLabel);
  if (normalized && normalized !== 'ALL') return normalized;
  return null;
}

/** 生成草稿的人类可读范围标签（写入 version_name，列表用于区分 3M/6M/渠道/单 SKU） */
export function buildBaselineDraftVersionName(input: {
  monthCount: number;
  platform?: string | null;
  category?: string | null;
  skuCode?: string | null;
  now?: Date;
}): string {
  const monthCount = Math.max(1, Math.floor(input.monthCount));
  const platformCode = normalizeSalesPlatform(input.platform?.trim() || 'ALL');
  const platformLabel = BASELINE_PLATFORM_LABEL[platformCode] ?? platformCode;
  const skuCode = input.skuCode?.trim().toUpperCase();
  const category = input.category?.trim();
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);

  let scopeLabel = '全量 SKU';
  if (skuCode) {
    scopeLabel = `单 SKU ${skuCode}`;
  } else if (category) {
    scopeLabel = `品类 ${category}`;
  }

  return `${monthCount} 个月 · ${platformLabel} · ${scopeLabel} · ${date}`;
}
