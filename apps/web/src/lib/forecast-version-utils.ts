export const mutationErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请稍后重试';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatForecastWmape(wmape: number | null | undefined): string {
  if (wmape == null || Number.isNaN(wmape)) return '-';
  const capped = Math.min(Math.max(wmape, 0), 9.99);
  return `${(capped * 100).toFixed(1)}%`;
}

export function formatForecastDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 版本号与名称相同时只展示一遍，避免 DRAFT-xxx · DRAFT-xxx */
export function formatForecastVersionTitle(
  versionNo: string,
  versionName?: string | null,
): string {
  const name = versionName?.trim();
  if (!name || name === versionNo) return versionNo;
  return `${versionNo} · ${name}`;
}

/** 版本详情页 query：保留 view / 单渠道 platform */
export function buildForecastVersionDetailSearch(input?: {
  view?: string;
  platform?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input?.view?.trim()) params.set('view', input.view.trim());
  if (input?.platform?.trim() && input.platform.trim().toUpperCase() !== 'ALL') {
    params.set('platform', input.platform.trim());
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** 详情页渠道筛选初始值：URL 优先，其次版本生成渠道 */
export function resolveForecastExplorerPlatform(input: {
  urlPlatform?: string | null;
  generationPlatform?: string | null;
  resolveScope?: (raw?: string | null) => string;
}): string {
  const resolveScope = input.resolveScope ?? ((raw) => raw?.trim().toUpperCase() || 'ALL');
  const raw = input.urlPlatform?.trim() || input.generationPlatform?.trim();
  if (!raw) return '';
  const normalized = resolveScope(raw);
  return normalized === 'ALL' ? '' : normalized;
}
