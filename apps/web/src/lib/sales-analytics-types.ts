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

export type ForecastPoint = {
  ym: string;
  val: number;
};

export type ForecastModelType = 'trend' | 'seasonal' | 'avg' | 'naive';

export type LinearFit = {
  n: number;
  a: number;
  b: number;
  r2: number;
  my: number;
};

export type SeasonalParams = {
  sIdx: Record<number, number>;
  peakM: number;
  troughM: number;
  strength: number;
};

export type ChosenModel = {
  type: ForecastModelType;
  fit: LinearFit;
  params: Partial<SeasonalParams> & { W?: number; base?: number };
  last: number;
};
