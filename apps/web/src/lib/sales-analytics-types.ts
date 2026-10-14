/** Client mirror of packages/db `SalesAnalyticsCubePayload`. */

export type SalesAnalyticsCubeMeta = {
  generatedAt: string;
  dateStart: string | null;
  dateEnd: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  recordCount: number;
  totalSales: number;
  sites: string[];
  depts: string[];
  categories: string[];
  platforms: string[];
  scopePending?: boolean;
  note?: string;
};

export type SalesAnalyticsEntity = {
  s: string;
  b: string;
  c: string;
  p: string;
  v: number[];
  vw: number[];
};

export type SalesAnalyticsCubePayload = {
  meta: SalesAnalyticsCubeMeta;
  months: string[];
  weeks: string[];
  data: SalesAnalyticsEntity[];
};

export type SalesAnalyticsGranularity = 'month' | 'week';

export type SalesAnalyticsSelection = {
  s: Set<string>;
  b: Set<string>;
  c: Set<string>;
  p: Set<string>;
};
