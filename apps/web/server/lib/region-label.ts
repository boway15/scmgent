import {
  isMappableRegion,
  type MappableRegion,
  type RuntimeRegion,
} from './region-codes.js';

/** 飞书「区域」列汉字 → 标准区域码（受控词表，非站点猜区） */
const FEISHU_REGION_LABELS: Record<string, MappableRegion> = {
  美国: 'US',
  加拿大: 'CA',
  欧洲: 'EU',
  英国: 'UK',
  墨西哥: 'MX',
  巴西: 'BR',
  其他: 'OTHER',
};

/**
 * 将飞书/导入的区域原文归一为区域码。
 * 支持码（US）与确认的汉字标签（美国）；无法识别返回 null（不猜）。
 */
export function normalizeSalesRegionLabel(raw?: string | null): MappableRegion | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  const upper = text.toUpperCase();
  if (isMappableRegion(upper)) return upper;
  return FEISHU_REGION_LABELS[text] ?? null;
}

export type { RuntimeRegion };
