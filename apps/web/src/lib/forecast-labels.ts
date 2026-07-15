export const FORECAST_LIFECYCLE_LABEL: Record<string, string> = {
  mature: '成熟',
  growth: '增长',
  decline: '下滑',
  new: '新品',
  intermittent: '间歇',
  stockout_suspected: '疑似断货',
};

export const FORECAST_CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export function formatLifecycleLabel(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_LIFECYCLE_LABEL[value] ?? value;
}

export function formatConfidenceLabel(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_CONFIDENCE_LABEL[value] ?? value;
}

export const FORECAST_PROFILE_SEGMENT_LABEL: Record<string, string> = {
  'A:core': 'A·常青款·主力',
  'A:mid': 'A·常青款·腰部',
  'A:tail': 'A·常青款·长尾',
  'B:core': 'B·爆款趋势款·主力',
  'B:mid': 'B·爆款趋势款·腰部',
  'B:tail': 'B·爆款趋势款·长尾',
  'C:pool': 'C·长尾款·品类池',
  'C:sku-core': 'C·长尾款·分解·主力',
  'C:sku-mid': 'C·长尾款·分解·腰部',
  'C:sku-tail': 'C·长尾款·分解·长尾',
  'D:floor': 'D·问题款·保底',
  'D:skipped': 'D·问题款·跳过',
};

export const FORECAST_ALLCAT_V41_TIER_LABEL: Record<string, string> = {
  T1: 'T1 主力稳定',
  T2: 'T2 核心高量',
  T3: 'T3 中量',
  T3P: 'T3P 非亚马逊稳定',
  T4A: 'T4A 亚马逊边界',
  T4B: 'T4B 稳定保底',
  T99: 'T99 不预测',
};

export const FORECAST_ALLCAT_V41_TIER_OPTIONS = [
  { value: '', label: '全部分层' },
  ...Object.entries(FORECAST_ALLCAT_V41_TIER_LABEL).map(([value, label]) => ({ value, label })),
] as const;

export function formatAllCatV41TierLabel(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_ALLCAT_V41_TIER_LABEL[value] ?? formatProfileSegmentLabel(value);
}

export function formatProfileSegmentLabel(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_PROFILE_SEGMENT_LABEL[value] ?? value;
}

/** 商品分层展示：V4.1 中文名 + 可选 AI 辅助后缀 */
export function formatTierDisplayLabel(
  profileSegment?: string | null,
  aiAssistMode?: 'auto' | 'human' | null,
): string {
  if (!profileSegment) return '-';
  const base = formatAllCatV41TierLabel(profileSegment);
  if (!aiAssistMode) return base;
  const aiTag = aiAssistMode === 'human' ? 'AI+' : 'AI';
  return `${base} · ${aiTag}`;
}

const LEGACY_T99_REVIEW_MESSAGE_RE =
  /^T99 no-forecast exception by AllCategory V4\.1: (.+) category=([^,]+), platform=([^;]+); unstable \/ low continuity \/ insufficient core-channel signal; cv6=([\d.]+), trend=([\d.]+)$/;

function formatForecastPlatformLabel(platform: string): string {
  const normalized = platform.trim().toUpperCase() || 'UNKNOWN';
  return normalized === 'UNKNOWN' ? '未知' : platform.trim();
}

export const FORECAST_REVIEW_ISSUE_LABEL: Record<string, string> = {
  missing_history: '缺少历史',
  trend_shift: '趋势突变',
  stockout_suspected: '疑似断货',
  category_deviation: '品类偏差',
  precision_review: '精度复核',
  forecast_skipped: '跳过预测',
  low_accuracy: '准确率低',
  exogenous_shock: '外生冲击',
  high_value: '高价值 SKU',
  daily_monthly_mismatch: '日月偏差',
};

export const FORECAST_REVIEW_SEVERITY_LABEL: Record<string, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
};

export function formatReviewIssueType(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_REVIEW_ISSUE_LABEL[value] ?? value;
}

export function formatReviewSeverityLabel(value?: string | null): string {
  if (!value) return '-';
  return FORECAST_REVIEW_SEVERITY_LABEL[value] ?? value;
}

/** 复核项 T99 说明：新数据已为中文；历史英文文案在展示时转为中文 */
export function formatT99ReviewMessage(message: string): string {
  const legacy = message.match(LEGACY_T99_REVIEW_MESSAGE_RE);
  if (!legacy) return message;
  const [, skuCode, category, platform, cv6, trend] = legacy;
  const platformLabel = formatForecastPlatformLabel(platform);
  return (
    `T99 系统不预测（全品类 V4.1）：${skuCode}，商品分类 ${category}，平台 ${platformLabel}；` +
    `波动较大 / 销量连续性不足 / 核心渠道信号不足；` +
    `近6月变异系数 cv6=${cv6}，趋势比 trend=${trend}`
  );
}
