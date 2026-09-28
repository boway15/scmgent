import type { Context } from 'hono';

export const ANALYSIS_ONLY_MESSAGE =
  '本系统只同步和分析数据，不在此修改业务事实。请在迅捷 ERP 操作。';

export function analysisOnlyResponse(c: Context) {
  return c.json({ message: ANALYSIS_ONLY_MESSAGE }, 403);
}
