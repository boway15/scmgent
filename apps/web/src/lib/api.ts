import { apiFetch, apiUrl } from './base-path';
import type { HorizonBand } from './forecast-horizon-meta';
import type { SalesAnalyticsCubePayload } from './sales-analytics-types';

export type MenuNode = {
  id: string;
  name: string;
  code: string;
  icon?: string | null;
  path?: string | null;
  sortOrder: number;
  isLeaf: boolean;
  children?: MenuNode[];
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string; code: string };
};

export type Sku = {
  id: string;
  code: string;
  name: string;
  unit: string;
  spuId?: string | null;
  category?: string | null;
  specAttrs?: Record<string, string> | null;
  barcode?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  unitCost?: string | null;
  merchantCode?: string | null;
  merchantName?: string | null;
  replenishLight?: ReplenishLight;
  commercialStatus?: string | null;
  commercialStatusLocked?: boolean;
  isActive: boolean;
};

export type PurchaseDraftStatus =
  | 'draft'
  | 'confirmed'
  | 'in_production'
  | 'ready_to_ship'
  | 'in_transit'
  | 'partial_received'
  | 'received'
  | 'exception'
  | 'cancelled';

export type ProcurementListType = 'bulk_stock_request' | 'purchase_follow_up';

export type ProcurementListConfig = {
  listType: ProcurementListType;
  label: string;
  menuCode: string;
  configured: boolean;
  appTokenConfigured: boolean;
  tableIdConfigured: boolean;
  tableEnvKey: string;
  appTokenEnvKeys: string[];
  tableId?: string;
};

export type ProcurementListMeta = {
  listType: ProcurementListType;
  label: string;
  configured: boolean;
  tableId?: string;
  columnOrder: string[];
  rowCount: number;
  lastSyncAt: string | null;
  lastSyncSource: 'feishu' | 'upload' | 'feishu_push' | 'clear' | null;
  lastSyncByName: string | null;
  updatedAt: string | null;
};

export type ProcurementListRow = {
  id: string;
  rowIndex: number;
  bitableRecordId?: string | null;
  rowData: Record<string, string>;
  createdAt: string;
};

export type CostingProvenanceTag =
  | '设计明示'
  | '规则开料'
  | '模板补全'
  | '库价'
  | '本单补价'
  | '人工修改';

export type CostingExtractSnapshot = {
  materialName: string;
  spec: string | null;
  qtyNet: number;
  origin: string;
  sourceRef: string | null;
};

export type CostingReviewIssue = {
  lineId?: string;
  materialName: string;
  code:
    | 'missing_price'
    | 'missing_qty'
    | 'missing_thickness'
    | 'unmatched'
    | 'template_pending'
    | 'low_confidence'
    | 'inferred_cut'
    | 'front_rail_qty_conflict';
  severity: 'block' | 'warn';
  message: string;
};

export type CostingPriceBookItem = {
  id: string;
  category: string;
  materialName: string;
  spec: string;
  standard: string;
  unit: string;
  unitPrice: string;
  notes: string | null;
  regionId: string | null;
  factoryId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CostingProjectListItem = {
  id: string;
  projectNo: string;
  name: string;
  category: string | null;
  regionName: string | null;
  factoryName: string | null;
  status: string;
  updatedAt: string;
};

export type CostingMatchScope = 'factory' | 'region' | 'global';

export type CostingBomLineInput = {
  category: string;
  materialName: string;
  spec?: string | null;
  unit: string;
  qtyNet: number;
  lossRate?: number;
  sourceRef?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string | null;
  unitPriceOverride?: number | null;
  processOverrides?: Record<string, number | null>;
  substrate?: string | null;
  isManual?: boolean;
};

export type CostingBomLine = {
  id: string;
  lineNo: number;
  category: string;
  materialName: string;
  spec: string | null;
  unit: string;
  qtyNet: string;
  lossRate: string;
  qtyGross: string;
  sourceRef: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  isManual: boolean;
  origin: string;
  substrate?: string | null;
  priceBookId: string | null;
  unitPriceOverride: string | null;
  processOverrides?: Record<string, number | null>;
  matchStatus: 'exact' | 'name_only' | 'unmatched';
  matchScope?: CostingMatchScope | null;
  effectiveUnitPrice: number | null;
  lineAmount: number;
  provenanceTags?: CostingProvenanceTag[];
  extractSnapshot?: CostingExtractSnapshot | null;
  extractDiff?: string | null;
};

export type CostingFeeItem = {
  name: string;
  rate: number;
  amount: number;
  scope: CostingMatchScope;
};

export type CostingBoardSheetRow = {
  lineId?: string;
  materialName: string;
  substrate: string;
  thicknessMm: number | null;
  lengthMm: number;
  widthMm: number;
  usableWidthMm: number;
  usableLengthMm: number;
  qty: number;
  sheetPrice: number;
  piecesPerSheet: number;
  boardCost: number;
  cutMeters: number;
  cutRate: number;
  cutAmount: number;
  bandMeters: number;
  bandRate: number;
  bandAmount: number;
  drillCount: number;
  drillRate: number;
  drillAmount: number;
  grooveMeters: number;
  grooveRate: number;
  grooveAmount: number;
  paintAreaM2: number;
  paintRate: number;
  paintAmount: number;
  subtotal: number;
  pricingMode: 'sheet' | 'area';
};

export type CostingSummary = {
  materialAmount: number;
  processAmount: number;
  feeAmount: number;
  totalAmount: number;
  byCategory: Array<{ category: string; amount: number; share: number }>;
  feeItems: CostingFeeItem[];
  missingPriceCount: number;
  missingQtyCount: number;
  lines: Array<{ qtyGross: number; effectiveUnitPrice: number | null; lineAmount: number }>;
  boardSheet?: CostingBoardSheetRow[];
};

export type CostingHardwareFact = { name: string; spec: string; qty: number };

export type CostingComputeBlocker = {
  lineId?: string;
  materialName: string;
  reason: 'missing_price' | 'missing_qty' | 'missing_thickness';
};

export type CostingProjectDetail = {
  id: string;
  projectNo: string;
  name: string;
  category: string | null;
  constructionType: string | null;
  drawerCount: number | null;
  defaultSubstrate: string | null;
  carcassThicknessMm: number | null;
  drawerBottomThicknessMm: number | null;
  sideThicknessMm: number | null;
  backThicknessMm: number | null;
  bottomThicknessMm: number | null;
  structureSummary: string | null;
  designPrinciples: string | null;
  hardwareFacts: CostingHardwareFact[];
  otherHardwarePct: number | null;
  regionId: string | null;
  factoryId: string | null;
  status: string;
  extractError: string | null;
  lines: CostingBomLine[];
  summary: CostingSummary;
  costComputedAt: string | null;
  costStale: boolean;
  applyFactsStale?: boolean;
  computeBlockers: CostingComputeBlocker[];
  reviewIssues: CostingReviewIssue[];
  priceAsOf: string;
  hasSourceAttachment: boolean;
  pageCount: number;
  structureBrief: {
    title: string;
    summary: string;
    items: string[];
    slots: string[];
  };
  latestExtractRun: Pick<
    CostingExtractRun,
    'id' | 'status' | 'errorMessage' | 'rawResponse'
  > | null;
};

export type CostingExtractRun = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  pageFrom: number | null;
  pageTo: number | null;
  errorMessage: string | null;
  rawResponse: unknown;
  batchCurrent: number;
  batchTotal: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CostingRegion = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type CostingFactory = {
  id: string;
  code: string;
  name: string;
  regionId: string | null;
  sortOrder: number;
  isActive: boolean;
  packProfile?: {
    cornerAllowanceMm?: number;
    foamThicknessMm?: number;
    foamYuanPerM3?: number;
    cartonYuanPerM2?: number;
    cornerYuanEach?: number;
  } | null;
};

export type CostingPackProfileInput = {
  cornerAllowanceMm?: number;
  foamThicknessMm?: number;
  foamYuanPerM3?: number;
  cartonYuanPerM2?: number;
  cornerYuanEach?: number;
};

export type CostingFeeRate = {
  id: string;
  name: string;
  rate: string;
  regionId: string;
  factoryId: string;
  isActive: boolean;
  sortOrder: number;
};

export type ReplenishLight = 'red' | 'yellow' | 'green';

export type InventoryHealth = 'red' | 'yellow' | 'green' | 'blue' | 'gray';

export type SafetyStockMethod = 'coverage_days' | 'z_demand' | 'z_demand_leadtime';

export type SafetyStockSuggestionView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  configured: {
    safetyStockDays: number | null;
    safetyStockQty: number;
    reorderPoint: number;
    safetyStockMethod: SafetyStockMethod;
  };
  suggested: {
    safetyStockQty: number | null;
    safetyStockDays: number | null;
    reorderPoint: number | null;
    confidence: 'high' | 'medium' | 'low';
    flags: string[];
  };
  deltaDays: number | null;
  deltaQty: number | null;
  deltaPctDays: number | null;
};

export type Spu = {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  description?: string | null;
  moq?: number | null;
  isActive: boolean;
};

export type Merchant = {
  id: string;
  code: string;
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  countryCode?: string | null;
  paymentTerms?: string | null;
  productionLeadDays?: number | null;
  remark?: string | null;
  isActive: boolean;
};

export type TransportMode = 'fcl' | 'lcl' | 'air' | 'express' | 'rail' | 'truck_air' | 'direct';

export type LeadTimeProfile = {
  id: string;
  merchantCode?: string | null;
  originLocation?: string | null;
  destinationWarehouseCode: string;
  transportMode?: TransportMode | null;
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
  leadTimeStdDev?: number | null;
  isDefault: boolean;
  sourceSystem?: string | null;
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadTimeProfileInput = Omit<
  LeadTimeProfile,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: string };

export type ShipmentStatus =
  | 'booked'
  | 'loaded'
  | 'departed'
  | 'arrived_port'
  | 'customs'
  | 'received_wh'
  | 'available'
  | 'cancelled';

export type ShipmentMilestone = {
  id: string;
  shipmentId: string;
  milestone: Exclude<ShipmentStatus, 'cancelled'>;
  plannedAt?: string | null;
  actualAt?: string | null;
  remark?: string | null;
  delayDays?: number | null;
  createdAt: string;
};

export type Shipment = {
  id: string;
  shipmentNo: string;
  draftId?: string | null;
  planItemId?: string | null;
  skuId: string;
  qty: number;
  containerNo?: string | null;
  bookingRef?: string | null;
  trackingNo?: string | null;
  transportMode?: string | null;
  destinationWarehouseCode?: string | null;
  status: ShipmentStatus;
  etaAvailable?: string | null;
  sourceSystem?: string | null;
  externalId?: string | null;
  delayDays: number;
  milestones: ShipmentMilestone[];
  createdAt: string;
  updatedAt: string;
};

export type ShipmentMilestoneInput = {
  milestone: ShipmentMilestone['milestone'];
  plannedAt?: string | null;
  actualAt?: string | null;
  remark?: string | null;
};

export type InventoryPositionBreakdown = {
  qtyAvailable: number;
  qtyInProduction: number;
  qtyInTransit: number;
  qtyConfirmedOpen: number;
  qtyReserved: number;
  qtyBackorder: number;
  effectiveQty: number;
  sources: Array<{
    source: 'snapshot' | 'purchase_draft';
    bucket: string;
    qty: number;
    draftId?: string;
    atRisk?: boolean;
  }>;
  dedupeMode: 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';
  unassignedOpenQty: number;
};

export type ResolvedLeadTime = {
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
  shippingDays: number;
  inboundBufferDays: number;
  totalLeadDays: number;
  profileId?: string | null;
  merchantCode?: string | null;
  warehouseCode: string;
};

export type SkuPlanningView = {
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  position: InventoryPositionBreakdown;
  leadTime: ResolvedLeadTime;
  avgDaily: number;
  demandSource: 'forecast' | 'historical';
  coverageDays: number;
  safetyStockDays: number;
  reorderPoint?: number;
  suggestedQty: number;
  suggestedDate: string;
  healthStatus: InventoryHealth;
  /** 覆盖天数影子灯 */
  coverageHealthStatus?: InventoryHealth | string;
  etaAvailableNearest?: string | null;
  stockoutDateEstimate?: string | null;
  timeline?: {
    today: string;
    windowDays: number;
    totalLeadDays: number;
    stockoutDateConfirmed: string | null;
    stockoutDateExpected: string | null;
    safetyBreachDateConfirmed: string | null;
    reorderDate: string | null;
    tooLateForNewPo: boolean;
    uncoverableByNewPo: boolean;
    suggestedQty: number;
    suggestedQtyGross?: number;
    points: Array<{
      horizonDays: number;
      asOf: string;
      confirmedEnding: number;
      expectedEnding: number;
      plannedInbound: number;
      cumulativeDemand: number;
      supplyEvents: Array<{ pool: string; qty: number; availableAt: string; supplyClass: string }>;
    }>;
  };
  allocation?: {
    method: 'sales_share' | 'native_warehouse' | 'unallocated';
    snapshotDate: string | null;
    overseasTotal: number;
    allocatedQty: number;
    undatedTransitQty: number;
    shareSumWarning: boolean;
  };
  unallocatedNetworkQty?: number;
  planningDemandSource?: 'demand_plan' | 'forecast';
  planningDemandFlags?: string[];
  championStockoutDateConfirmed?: string | null;
  championSuggestedQty?: number | null;
  inStockDayRatio?: number | null;
  confirmedCoverageDays?: number | null;
  needsManualConfirm?: boolean;
  demandGateFlags?: string[];
  demandUnconstrainedDaily?: number | null;
  demandStockoutDays?: number | null;
  demandCapped?: boolean;
  suggestedQtyGross?: number | null;
  latePoActions?: Array<{
    kind: 'transfer' | 'fast_ship' | 'accept_stockout';
    label: string;
    detail: string;
    qty?: number;
    days?: number;
  }>;
};

export type DemandPlanVersionListItem = {
  id: string;
  versionNo: string;
  versionName: string;
  status: string;
  projectGroup: string;
  warehouseCode: string;
  startWeek?: string | null;
  horizonWeeks?: number | null;
  startMonth?: string;
  horizonMonths?: number | null;
  publishedAt?: string | null;
  createdAt?: string;
};

export type DemandPlanMonthRow = {
  id: string;
  skuId?: string;
  skuCode?: string;
  period: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  championForecastDaily: string | null;
  source: string;
  adjustReason?: string | null;
};

export type DemandPlanWeekRow = DemandPlanMonthRow;

export type DemandPlanAdoption = {
  id: string;
  projectGroup: string;
  warehouseCode: string;
  source: 'forecast' | 'demand_plan' | string;
  demandPlanVersionId: string | null;
  adoptedAt?: string;
  adoptedBy?: string | null;
};

export type DemandPlanPeriodPage = {
  items: DemandPlanWeekRow[];
  total: number;
  skuTotal: number;
  page: number;
  pageSize: number;
};

export type DemandPlanSkuWeeklyActual = {
  weekKey: string;
  qtySold: number;
  actualDailyAvg: number | null;
  inProgress: boolean;
};

export type DemandPlanSkuWeeklyForecast = {
  weekKey: string;
  anchorMonthLabel: string;
  systemDailyAvg: number;
  manualDailyAvg: number | null;
  effectiveDailyAvg: number;
  hasManual: boolean;
  actualDailyAvg: number | null;
  actualInProgress: boolean;
  qtySold: number | null;
  confidenceLevel: string | null;
  baselineDailyAvg: number | null;
  seasonalityFactor: number | null;
  trendFactor: number | null;
  categoryCombinedFactor: number | null;
  categoryTrendWasClipped: boolean;
  categoryTrendMatched: boolean;
  horizonFactors: {
    nearLevel: number;
    structuralLevel: number;
    yoyMonthLevel: number;
    yoyAnchorLevel: number;
    growthFactor: number;
    wNear: number;
    wYoy: number;
    horizonMonthIndex: number;
  } | null;
  allCatV41Factors: {
    d6: number;
    d3: number;
    trendRatio: number;
    anchorDaily?: number;
    seasonalDaily?: number;
    levelDaily?: number;
    formula: string;
    productCategory?: string | null;
  } | null;
  aiAssistRationale: string | null;
  aiAssistMode: 'auto' | 'human' | null;
  planSystemDailyAvg: string | null;
  planEffectiveDailyAvg: string | null;
  planManualDailyAvg: string | null;
  championForecastDaily: string | null;
  planSource: string | null;
};

export type DemandPlanSkuWeeklyPlan = {
  weekKey: string;
  systemDailyAvg: string;
  manualDailyAvg: string | null;
  effectiveDailyAvg: string;
  championForecastDaily: string | null;
  source: string;
};

export type DemandPlanSkuDetail = {
  sku: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    productCategory: string | null;
    lifecycle: string | null;
    salesCountry: string | null;
    ownerName: string | null;
    developerName: string | null;
    unit: string | null;
    leadTimeDays: number | null;
    moq: number | null;
  };
  historyWeeks: DemandPlanSkuWeeklyActual[];
  planWeeks: DemandPlanSkuWeeklyPlan[];
  forecastWeeks: DemandPlanSkuWeeklyForecast[];
  forecastVersion: { id: string; versionNo: string; versionName: string } | null;
  forecastHorizon: {
    profileSegment: string | null;
    forecastProfileClass: string | null;
    lifecycle: string | null;
    platform: string;
    station: string;
    months: Array<{
      id: string;
      monthLabel: string;
      forecastDailyAvg: number;
      manualDailyAvg: number | null;
      effectiveDailyAvg: number;
      adjustReason: string | null;
      baselineDailyAvg: number | null;
      confidenceLevel: string | null;
      seasonalityFactor: number;
      trendFactor: number;
      categoryCombinedFactor: number;
      categoryTrendWasClipped: boolean;
      categoryTrendMatched: boolean;
      horizonFactors: DemandPlanSkuWeeklyForecast['horizonFactors'];
      allCatV41Factors: DemandPlanSkuWeeklyForecast['allCatV41Factors'];
      aiAssistRationale?: string | null;
      aiAssistMode?: 'auto' | 'human' | null;
    }>;
  } | null;
  forecastContext: SkuForecastContext | null;
};

export type DemandPlanWideRow = {
  skuId: string;
  skuCode: string;
  cells: Record<string, DemandPlanWeekRow>;
};

export type DemandPlanWidePage = {
  items: DemandPlanWideRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type DemandPlanDetailView = 'wide' | 'long';

export type DemandPlanDetail = {
  version: DemandPlanVersionListItem;
  view: DemandPlanDetailView;
  grain: 'week' | 'month';
  periods: string[];
  stats: { rowTotal: number; skuTotal: number };
  long: DemandPlanPeriodPage;
  wide: DemandPlanWidePage;
  adoption?: DemandPlanAdoption | null;
};

export type PlanningDashboard = {
  skuActiveCount: number;
  /** 近 30 天周转表 或 近 90 天有销量 */
  skuOperationalCount: number;
  /** 启用但未满足运营口径 */
  skuDormantCount: number;
  skuPlanningEligibleCount: number;
  skuGrayLifecycleCount: number;
  skuForecastCoveredCount: number;
  skuForecastGapCount: number;
  forecastCoverageRate: number;
  healthRedCount: number;
  healthYellowCount: number;
  healthRedSkuCount: number;
  healthYellowSkuCount: number;
  belowRopCount: number;
  pendingSuggestions: number;
  delayedShipments: number;
  delayedDraftsEtaAvailable: number;
  stockoutRateApprox: number;
  stockoutHorizon7: number;
  stockoutHorizon15: number;
  stockoutHorizon30: number;
  overstockCount: number;
  uncoverableByNewPoCount?: number;
  pendingShipOut: number;
  pendingTransfer: number;
  calculatedAt: string;
  openDataIssueCount?: number;
  openUnallocatedLotCount?: number;
};

export type InventoryDataIssueRow = {
  id: string;
  fingerprint: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string;
  issueType: 'missing_available_at' | 'unallocated_warehouse' | 'share_sum_mismatch';
  impactModule: string;
  example: string;
  qty: number;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  ownerId: string | null;
  resolutionNote: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SupplyLotRow = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string;
  pool: 'overseas' | 'in_transit' | 'local';
  qty: number;
  factoryCode: string | null;
  productionStatus: 'in_production' | 'qc_pending' | 'completed' | null;
  shipReadyAt: string | null;
  latestShipDate: string | null;
  availableAt: string | null;
  source: string;
  sourceId: string | null;
  status: string;
  etaEstimated: boolean;
  dateUnknown: boolean;
  updatedAt: string;
};

export type SupplyLotSummaryRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string;
  overseasQty: number;
  inTransitQty: number;
  localQty: number;
  undatedTransitQty: number;
  inTransitBatchCount: number;
  localBatchCount: number;
  overseasBatchCount: number;
  nextTransitAt: string | null;
  nextTransitQty: number;
  nextTransitEstimated: boolean;
  nextLocalAt: string | null;
  nextLocalQty: number;
  batchCount: number;
  updatedAt: string;
};

export type SupplyLotSummaryFilters = {
  q?: string;
  warehouse?: string;
  hasOverseas?: boolean;
  hasInTransit?: boolean;
  hasLocal?: boolean;
  hasUndatedTransit?: boolean;
  multiTransitBatch?: boolean;
};

export type SupplyLotBatchFilters = {
  pool?: 'overseas' | 'in_transit' | 'local';
  warehouse?: string;
  skuId?: string;
  q?: string;
  dateUnknown?: boolean;
};

export type UnallocatedSupplyRow = SupplyLotRow & {
  suggestedDestinations: Array<{ warehouseCode: string; qty: number }>;
};

export type SkuOverview = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category?: string | null;
  /** 从品类派生的项目组，如 项目1组 */
  projectGroup?: string | null;
  /** A 品类 */
  lifecycle?: string | null;
  /** 销量推断生命周期 */
  commercialStatus?: string | null;
  commercialStatusNorm?: string | null;
  commercialStatusLocked?: boolean;
  /** E 销售国家 */
  salesCountry?: string | null;
  /** E 销售国家 */
  productCategory?: string | null;
  /** F 产品分类 */
  ownerName?: string | null;
  /** H 负责人 */
  developerName?: string | null;
  /** I 开发人员 */
  spuId?: string | null;
  spuCode?: string | null;
  spuName?: string | null;
  externalCode?: string | null;
  skuKind?: string | null;
  divisionCode?: string | null;
  divisionName?: string | null;
  encodingValid?: boolean;
  merchantCode?: string | null;
  merchantName?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  unitCost?: string | null;
  /** 库存周转表：包装长宽高cm */
  packDimensionsCm?: string | null;
  /** 库存周转表：体积（m3） */
  volumeM3?: string | null;
  /** 库存周转表：毛重（Kg） */
  grossWeightKg?: string | null;
  /** 与库存总览一致：SKU / 库存 / 周转快照最晚更新时间 */
  updatedAt?: string | null;
  replenishLight?: ReplenishLight;
  supplierCount: number;
  isActive: boolean;
};

export type InventoryOverview = {
  skuId: string;
  updatedAt?: string | null;
  inventoryRecordedDate?: string | null;
  turnoverSnapshotAt?: string | null;
  dataSource?: string | null;
  category?: string | null;
  code: string;
  lifecycle?: string | null;
  name: string;
  salesCountry?: string | null;
  productCategory?: string | null;
  merchantCode?: string | null;
  ownerName?: string | null;
  developerName?: string | null;
  merchantName?: string | null;
  leadTimeDays?: number | null;
  unitCost?: string | null;
  unit: string;
  qtyInProduction: number;
  qtyPreOrder: number;
  salesQty3d: number;
  salesQty7d: number;
  salesQty14d: number;
  salesQty30d: number;
  replenishLight: ReplenishLight;
  packDimensionsCm?: string | null;
  volumeM3?: string | null;
  grossWeightKg?: string | null;
  turnoverExtras?: Record<string, string>;
  warehouseStocks?: Array<{
    warehouseCode: string;
    qtyAvailable: number;
    qtyInTransit: number;
  }>;
};

export type ImportType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'safety_stock'
  | 'merchants'
  | 'pmc_plans';

export type BitableSyncType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'merchants'
  | 'inventory_policy';

export type BitableSyncTargetStatus = {
  configured: boolean;
  tableId?: string;
  appTokenConfigured: boolean;
};

export type TaskRunSummary = {
  id: string;
  taskName: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt?: string | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
};

export type ImportValidationIssue = {
  row: number;
  field?: string;
  message: string;
};

export type CsReplyScoreDetail = {
  accuracy: number;
  professionalism: number;
  empathy: number;
  resolution: number;
};

export type CsReplyRecordSummary = {
  id: string;
  batchId: string;
  rowNo: number;
  buyerEmail: string | null;
  sentAt: string | null;
  agentName: string | null;
  messageType: string | null;
  orderNo: string | null;
  buyerMessage: string;
  agentReply: string;
  scoreStatus: string;
  overallScore: number | null;
  scoreDetail: CsReplyScoreDetail | null;
  feedback: string | null;
  highlights: string[] | null;
  issues: string[] | null;
  pass: boolean | null;
  errorMessage: string | null;
  scoredAt: string | null;
  createdAt: string;
  batchNo: string | null;
  batchName: string | null;
};

export type CsReplyRecordDetail = CsReplyRecordSummary & {
  passThreshold: number | null;
};

export type ForecastReviewItem = {
  id: string;
  versionId: string;
  skuId: string;
  skuCode: string;
  skuName?: string;
  station: string;
  platform: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestedDailyAvg: number | null;
  reviewedDailyAvg: number | null;
  status: 'pending' | 'reviewed' | 'ignored';
  createdAt: string;
};

/** 复核清单默认按 SKU×渠道 聚合后的行 */
export type ForecastReviewItemGroup = {
  skuId: string;
  skuCode: string;
  skuName: string;
  station: string;
  platform: string;
  status: 'pending' | 'reviewed' | 'ignored';
  severity: 'critical' | 'warning' | 'info';
  issueTypes: string[];
  messages: string[];
  itemIds: string[];
  suggestedDailyAvg: number | null;
};

export type ForecastVersionSummary = {
  monthCount: number;
  monthLabels: string[];
  description: string;
  startMonth: string | null;
};

export type ForecastQtyTotalsResult = {
  status: 'in_progress' | 'empty_actual' | 'ready';
  forecastQty: number;
  actualQty: number;
  label: string;
};

export type ForecastVersionStats = {
  forecastRowCount: number;
  skuCount: number;
  monthCount: number;
  /** 待复核 SKU×渠道 数 */
  reviewPending: number;
  /** 待复核涉及的去重 SKU 数 */
  reviewPendingSkuCount: number;
  reviewCritical: number;
  accuracyWmape: number | null;
};

export type ForecastVersionListItem = {
  id: string;
  versionNo: string;
  versionName: string;
  station?: string | null;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  publishedAt?: string | null;
  /** 预测地平线首月 YYYY-MM；历史版本可能为空 */
  startMonth?: string | null;
  /** 单渠道生成草稿时的渠道码；全平台或未识别时为 null */
  generationPlatform?: string | null;
  stats: ForecastVersionStats;
};

export type ForecastVersionBasic = {
  id: string;
  versionNo: string;
  versionName: string;
  station?: string | null;
  startMonth?: string | null;
  status: string;
  publishedAt?: string | null;
};

export type SkuMonthlyForecastCell = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  forecastDailyAvg: number;
  baselineDailyAvg: number | null;
  horizonFactors: {
    nearLevel: number;
    structuralLevel: number;
    yoyMonthLevel: number;
    yoyAnchorLevel: number;
    growthFactor: number;
    wNear: number;
    wYoy: number;
    horizonMonthIndex: number;
  } | null;
};

export type ForecastAccuracyMetricSummary = {
  key?: string;
  label?: string;
  rows: number;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  ghostRows: number;
  zeroForecastMissRows: number;
  actualDailySum: number;
  forecastDailySum: number;
  forecastQtySum: number;
  actualQtySum: number;
};

export type ForecastAccuracyDiagnostics = {
  scope: {
    versionId?: string;
    versionName?: string;
    versionStatus?: string;
    versionStation?: string | null;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    asOf?: string;
    versionSelection?: 'explicit' | 'auto_published' | 'auto_latest';
  };
  dataQuality: {
    monthlyRows: number;
    monthlySkuCount: number;
    monthlyStartMonth?: string;
    monthlyEndMonth?: string;
    unknownChannelRows: number;
    unknownChannelQty: number;
    totalMonthlyQty: number;
    unknownChannelQtyRate: number | null;
    dailyMonthlyComparedRows: number;
    dailyMonthlyComparedMonths: number;
    dailyMonthlyAbsDiffQty: number;
    dailyMonthlyBaseQty: number;
    dailyMonthlyAbsDiffRate: number | null;
  };
  global: ForecastAccuracyMetricSummary;
  byHorizonBand: ForecastAccuracyMetricSummary[];
  byProfileSegment: ForecastAccuracyMetricSummary[];
  byVolumeTier: ForecastAccuracyMetricSummary[];
  byCategory: ForecastAccuracyMetricSummary[];
  topErrorSkus: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    category: string | null;
    volumeTier: string;
    profileSegment: string;
    rows: number;
    comparableRows: number;
    wmape: number | null;
    weightedBias: number | null;
    ghostRows: number;
    zeroForecastMissRows: number;
    actualDailySum: number;
    forecastDailySum: number;
    absErrorSum: number;
  }>;
  tierHorizonAttribution: {
    flexWindow: { fromK: number; toK: number };
    flexTotalActual: number;
    flexWeightedBias: number | null;
    precisionWeightedBias: number | null;
    cells: Array<{
      tier: string;
      tierLabel: string;
      horizonIndex: number;
      horizonBand: 'precision' | 'flex' | 'strategic';
      comparableRows: number;
      actualDailySum: number;
      forecastDailySum: number;
      weightedBias: number | null;
      wmape: number | null;
      flexContribution: number | null;
      discountProductMedian: number | null;
      discountProductP25: number | null;
      discountProductP75: number | null;
    }>;
    recommendations: string[];
  };
  recommendations: string[];
};

export type ForecastAccuracyReviewQueueResult = {
  sourceVersion: { id: string; versionName: string; status: string };
  targetVersion: { id: string; versionName: string; status: string };
  candidates: number;
  upserted: number;
  skippedCompleted: number;
  items: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    station: string;
    platform: string;
    severity: 'critical' | 'warning';
    wmape: number | null;
    weightedBias: number | null;
    ghostRows: number;
    zeroForecastMissRows: number;
    suggestedDailyAvg: number | null;
  }>;
};
export type SkuForecastContext = {
  lifecycle: string;
  weights: { w90: number; w30: number; wLy: number; wCat: number };
  weightsLabel: string;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg: number;
  categoryReferenceDailyAvg: number | null;
  storedBaselineDailyAvg: number | null;
  storedLifecycle: string | null;
  forecastProfileClass: string | null;
  profileSegment: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await apiFetch(url, init);
  } catch (err) {
    const hint =
      typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? '（Windows Docker 请改用 http://127.0.0.1:8081 访问，localhost 可能走 IPv6 导致请求失败）'
        : '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}${hint}`);
  }
  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      if (res.status === 524 || res.status === 504 || res.status === 502) {
        throw new Error(
          `HTTP ${res.status}: 网关超时（收到 HTML 错误页，${url}）。多为后台处理过久；请稍后重试或改用异步任务接口。`,
        );
      }
      throw new Error(
        `HTTP ${res.status}: 收到 HTML 而非 JSON（${url}）。Hono 可能未挂载，请运行 miaoda-sync 并重新构建。`,
      );
    }
    const text = await res.text();
    let message = res.statusText;
    try {
      const err = JSON.parse(text) as { message?: string };
      message = err.message ?? message;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    if (res.status === 403 && /csrf/i.test(message)) {
      throw new Error(`HTTP 403: ${message}（需 x-suda-csrf-token 请求头）`);
    }
    throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getAuthConfig: () =>
    request<{
      feishuEnabled: boolean;
      emailAuthEnabled: boolean;
      authBypass: boolean;
    }>('/api/auth/config'),
  register: (data: { email: string; password: string; name?: string }) =>
    request<{ ok: boolean; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ ok: boolean; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getFeishuLoginUrl: () => request<{ url: string }>('/api/auth/feishu/url'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getMe: () => request<User>('/api/me'),
  getMyMenus: () => request<MenuNode[]>('/api/me/menus'),
  getMenus: () => request<MenuNode[]>('/api/menus'),
  getUsers: (params?: { page?: number; pageSize?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        name: string;
        email: string;
        feishuUserId?: string | null;
        isActive: boolean;
        roleId: string;
        roleName: string;
        roleCode: string;
        hasPassword: boolean;
      }>
    >(`/api/users${query ? `?${query}` : ''}`);
  },
  updateUser: (id: string, data: { roleId?: string; isActive?: boolean; name?: string }) =>
    request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),
  getAuditLogs: (params?: {
    page?: number;
    pageSize?: number;
    action?: string;
    userId?: string;
    q?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.action) q.set('action', params.action);
    if (params?.userId) q.set('userId', params.userId);
    if (params?.q) q.set('q', params.q);
    const qs = q.toString();
    return request<{
      items: Array<{
        id: string;
        userId?: string | null;
        userName?: string | null;
        userEmail?: string | null;
        action: string;
        resourceType?: string | null;
        resourceId?: string | null;
        detail?: string | null;
        ipAddress?: string | null;
        createdAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/audit-logs${qs ? `?${qs}` : ''}`);
  },
  getTaskRuns: (params?: { page?: number; pageSize?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    const query = qs.toString();
    return request<PaginatedResult<TaskRunSummary>>(`/api/tasks/runs${query ? `?${query}` : ''}`);
  },
  runScheduledTask: (path: string) =>
    request<Record<string, unknown> & { skipped?: boolean; message?: string }>(path, {
      method: 'POST',
    }),
  getNewsIntelStatus: () =>
    request<{
      enabled: boolean;
      bitableConfigured: boolean;
      bitableAppTokenConfigured: boolean;
      bitableTableId?: string;
      rsshubConfigured?: boolean;
      enrichConfigured?: boolean;
      latestRun?: {
        id: string;
        status: string;
        startedAt: string;
        finishedAt?: string | null;
        resultSummary?: string | null;
        errorMessage?: string | null;
      } | null;
    }>('/api/news-intel/status'),
  getNewsIntelOverview: () =>
    request<{
      todayNew: number;
      pendingReview: number;
      pendingSync: number;
      syncFailed: number;
      highPriorityToday: number;
      sourceTotal: number;
      sourceHealthy: number;
    }>('/api/news-intel/overview'),
  getNewsIntelSources: () =>
    request<{
      items: Array<{
        id: string;
        code: string;
        name: string;
        feedUrl: string;
        sourceType: string;
        categoryDefault: string;
        sourceTier?: string;
        isOfficial?: boolean;
        sourceLanguage?: string;
        enabled: boolean;
        fetchIntervalHours: number;
        lastFetchedAt?: string | null;
        lastError?: string | null;
        consecutiveFailures: number;
        configJson?: {
          channel?: string;
          includeKeywords?: string[];
          excludeKeywords?: string[];
          siteDomain?: string;
          note?: string;
          sourceTier?: string;
          isOfficial?: boolean;
          language?: string;
        } | null;
      }>;
    }>('/api/news-intel/sources'),
  getNewsIntelPolicy: () =>
    request<{
      lookbackDays: number;
      maxItemsPerSource: number;
      channels: Record<string, { enabled: boolean; label: string }>;
      negativeKeywords: string[];
      topics?: Array<{ value: string; keywords: string[] }>;
      brandKeywords?: Array<{ name: string; aliases: string[] }>;
    }>('/api/news-intel/policy'),
  createNewsIntelSource: (data: {
    code: string;
    name: string;
    feedUrl: string;
    sourceType?: string;
    categoryDefault?: string;
    fetchIntervalHours?: number;
    sourceTier?: string;
    isOfficial?: boolean;
    sourceLanguage?: string;
    enabled?: boolean;
    configJson?: {
      channel?: string;
      includeKeywords?: string[];
      excludeKeywords?: string[];
      siteDomain?: string;
      note?: string;
      sourceTier?: string;
      isOfficial?: boolean;
      language?: string;
    };
  }) =>
    request('/api/news-intel/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateNewsIntelSource: (
    id: string,
    data: {
      name?: string;
      feedUrl?: string;
      sourceType?: string;
      categoryDefault?: string;
      fetchIntervalHours?: number;
      sourceTier?: string;
      isOfficial?: boolean;
      sourceLanguage?: string;
      enabled?: boolean;
      configJson?: {
        channel?: string;
        includeKeywords?: string[];
        excludeKeywords?: string[];
        siteDomain?: string;
        note?: string;
        sourceTier?: string;
        isOfficial?: boolean;
        language?: string;
      } | null;
    },
  ) => request(`/api/news-intel/sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  disableNewsIntelSource: (id: string) =>
    request(`/api/news-intel/sources/${id}`, { method: 'DELETE' }),
  getNewsIntelArticles: (params?: {
    page?: number;
    pageSize?: number;
    category?: string;
    topicCategory?: string;
    status?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.category) q.set('category', params.category);
    if (params?.topicCategory) q.set('topicCategory', params.topicCategory);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<{
      items: Array<{
        id: string;
        title: string;
        titleZh?: string | null;
        titleOriginal?: string | null;
        summary?: string | null;
        category: string;
        topicCategory?: string | null;
        bitableCategory?: string | null;
        departments?: string[] | null;
        platformTags?: string[] | null;
        countryTags?: string[] | null;
        brandTags?: string[] | null;
        language?: string | null;
        sourceTier?: string | null;
        isOfficialSource?: boolean;
        relevanceScore: number;
        priority: string;
        status: string;
        bitableSyncStatus?: string | null;
        bitableSyncError?: string | null;
        filterHits?: string | null;
        canonicalUrl: string;
        fetchedAt: string;
        sourceName: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/news-intel/articles${qs ? `?${qs}` : ''}`);
  },
  getNewsIntelArticle: (id: string) => request(`/api/news-intel/articles/${id}`),
  updateNewsIntelArticle: (
    id: string,
    data: { businessValidity?: 'valid' | 'invalid' | 'misclassified' },
  ) => request(`/api/news-intel/articles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  syncNewsIntelArticleBitable: (id: string) =>
    request<{ recordId: string | null }>(`/api/news-intel/articles/${id}/sync-bitable`, {
      method: 'POST',
    }),
  triggerNewsIngest: (data?: { force?: boolean; sourceId?: string }) =>
    request('/api/news-intel/ingest/trigger', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
  getNewsIngestLogs: (limit = 30) =>
    request<{
      items: Array<{
        log: {
          id: string;
          fetchedCount: number;
          newCount: number;
          skippedDup: number;
          skippedLowRelevance: number;
          skippedFiltered?: number;
          translatedCount?: number;
          bitableSyncFailedCount?: number;
          errorMessage?: string | null;
          durationMs?: number | null;
          createdAt: string;
        };
        sourceCode: string;
        sourceName: string;
      }>;
    }>(`/api/news-intel/ingest/logs?limit=${limit}`),
  getCsReplyQualityStatus: () =>
    request<{
      difyEnabled: boolean;
      difyBaseUrl: string;
      difyAppName: string | null;
      difyAppMode: string | null;
      workflowReady: boolean;
      difyMessage: string | null;
    }>('/api/cs-reply-quality/status'),
  getCsReplyQualityOverview: () =>
    request<{
      totalRecords: number;
      scoredRecords: number;
      pendingRecords: number;
      failedRecords: number;
      avgScore: number;
      passRate: number;
      topAgents: Array<{
        agentName: string;
        count: number;
        avgScore: number;
        passRate: number;
      }>;
    }>('/api/cs-reply-quality/overview'),
  getCsReplyBatches: () =>
    request<{
      items: Array<{
        id: string;
        batchNo: string;
        name: string | null;
        status: string;
        totalRows: number;
        importedRows: number;
        scoredRows: number;
        failedRows: number;
        passThreshold: number;
        errorSummary: string | null;
        createdAt: string;
        updatedAt: string;
        createdByName: string | null;
      }>;
    }>('/api/cs-reply-quality/batches'),
  getCsReplyAgents: () => request<{ items: string[] }>('/api/cs-reply-quality/agents'),
  getCsReplyRecords: (params?: {
    page?: number;
    pageSize?: number;
    batchId?: string;
    agentName?: string;
    messageType?: string;
    scoreStatus?: string;
    minScore?: number;
    maxScore?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.batchId) q.set('batchId', params.batchId);
    if (params?.agentName) q.set('agentName', params.agentName);
    if (params?.messageType) q.set('messageType', params.messageType);
    if (params?.scoreStatus) q.set('scoreStatus', params.scoreStatus);
    if (params?.minScore !== undefined) q.set('minScore', String(params.minScore));
    if (params?.maxScore !== undefined) q.set('maxScore', String(params.maxScore));
    if (params?.keyword) q.set('keyword', params.keyword);
    const qs = q.toString();
    return request<{
      items: Array<CsReplyRecordSummary>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/cs-reply-quality/records${qs ? `?${qs}` : ''}`);
  },
  getCsReplyRecord: (id: string) => request<CsReplyRecordDetail>(`/api/cs-reply-quality/records/${id}`),
  previewCsReplyImport: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl('/api/cs-reply-quality/import/preview'), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      totalRows: number;
      validRows: number;
      issueCount: number;
      issues: Array<{ row: number; field?: string; message: string }>;
      sample: Array<{
        rowNo: number;
        buyerEmail: string;
        sentAt: string | null;
        agentName: string;
        messageType: string;
        orderNo: string;
        buyerMessagePreview: string;
        agentReplyPreview: string;
      }>;
    }>;
  },
  importCsReplyFile: async (params: {
    file: File;
    name?: string;
    passThreshold?: number;
    autoScore?: boolean;
  }) => {
    const form = new FormData();
    form.append('file', params.file);
    if (params.name) form.append('name', params.name);
    if (params.passThreshold !== undefined) form.append('passThreshold', String(params.passThreshold));
    if (params.autoScore === false) form.append('autoScore', 'false');
    const res = await apiFetch(apiUrl('/api/cs-reply-quality/import'), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) throw new Error(payload.message ?? 'Import failed');
    return payload as {
      id: string;
      batchNo: string;
      name: string | null;
      status: string;
      totalRows: number;
      passThreshold: number;
    };
  },
  scoreCsReplyBatch: (batchId: string, rescore = false) =>
    request(`/api/cs-reply-quality/batches/${batchId}/score`, {
      method: 'POST',
      body: JSON.stringify({ rescore }),
    }),
  rescoreCsReplyRecord: (recordId: string) =>
    request(`/api/cs-reply-quality/records/${recordId}/rescore`, { method: 'POST' }),
  clearCsReplyData: (params?: { batchId?: string }) =>
    request<{ ok: boolean; deletedBatches: number; deletedRecords: number }>(
      '/api/cs-reply-quality/clear',
      { method: 'POST', body: JSON.stringify(params ?? {}) },
    ),
  exportCsReplyRecords: async (params?: {
    batchId?: string;
    agentName?: string;
    messageType?: string;
    scoreStatus?: string;
    minScore?: number;
    maxScore?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.batchId) q.set('batchId', params.batchId);
    if (params?.agentName) q.set('agentName', params.agentName);
    if (params?.messageType) q.set('messageType', params.messageType);
    if (params?.scoreStatus) q.set('scoreStatus', params.scoreStatus);
    if (params?.minScore !== undefined) q.set('minScore', String(params.minScore));
    if (params?.maxScore !== undefined) q.set('maxScore', String(params.maxScore));
    if (params?.keyword) q.set('keyword', params.keyword);
    const qs = q.toString();
    const res = await apiFetch(apiUrl(`/api/cs-reply-quality/records/export${qs ? `?${qs}` : ''}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cs-reply-scores-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  getRoles: () => request<Array<{ id: string; name: string; code: string; isSystem: boolean }>>('/api/roles'),
  createRole: (data: { name: string; code: string; description?: string }) =>
    request('/api/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (id: string, data: { name?: string; description?: string }) =>
    request(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (id: string) => request(`/api/roles/${id}`, { method: 'DELETE' }),
  getRoleMenus: (roleId: string) => request<Array<{ menuId: string; menuCode: string }>>(`/api/roles/${roleId}/menus`),
  updateRoleMenus: (roleId: string, menuIds: string[]) =>
    request(`/api/roles/${roleId}/menus`, { method: 'PUT', body: JSON.stringify({ menuIds }) }),
  getSkus: () => request<Sku[]>('/api/skus'),
  createSku: (data: Partial<Sku> & { spuCode?: string }) =>
    request<Sku>('/api/skus', { method: 'POST', body: JSON.stringify(data) }),
  updateSku: (id: string, data: Partial<Sku>) =>
    request<Sku>(`/api/skus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSpus: (params?: { q?: string; category?: string; brand?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: Spu[]; total: number; page: number; pageSize: number }>(
      `/api/spus${query ? `?${query}` : ''}`,
    );
  },
  createSpu: (data: Partial<Spu>) => request<Spu>('/api/spus', { method: 'POST', body: JSON.stringify(data) }),
  updateSpu: (id: string, data: Partial<Spu>) =>
    request<Spu>(`/api/spus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getMerchantsMaster: (params?: { q?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: Merchant[]; total: number; page: number; pageSize: number }>(
      `/api/merchants/master${query ? `?${query}` : ''}`,
    );
  },
  createMerchant: (data: Partial<Merchant>) =>
    request<Merchant>('/api/merchants', { method: 'POST', body: JSON.stringify(data) }),
  updateMerchant: (id: string, data: Partial<Merchant>) =>
    request<Merchant>(`/api/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSkuOverview: (params?: {
    q?: string;
    category?: string;
    projectGroup?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.projectGroup) qs.set('projectGroup', params.projectGroup);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: SkuOverview[]; total: number; page: number; pageSize: number }>(
      `/api/products/sku-overview${query ? `?${query}` : ''}`,
    );
  },
  getDashboard: () =>
    request<{
      kpis: {
        openAlerts: number;
        pendingReorderSuggestions: number;
        draftPmcPlans: number;
        activePmcPlans: number;
        purchaseTrackingPending: number;
        activeSkus: number;
        salesQtyLast7Days: number;
        openAlertsLast7Days: number;
        latestInventoryDate?: string | null;
        latestSalesDate?: string | null;
      };
      dataFreshness?: {
        latestInventoryDate?: string | null;
        latestSalesDate?: string | null;
      };
      taskRuns?: {
        stockAlert: TaskRunSummary | null;
        replenishmentForecast: TaskRunSummary | null;
      };
      trends: {
        salesLast7Days: Array<{ date: string; qty: number }>;
        salesLast30Days: Array<{ date: string; qty: number }>;
      };
      todos: Array<{
        type: string;
        title: string;
        subtitle?: string;
        href: string;
        priority: 'high' | 'medium' | 'low';
      }>;
      loopFunnel?: {
        pendingReorderSuggestions: number;
        draftPmcPlans: number;
        activePmcPlans: number;
        trackingPendingConfirm: number;
        trackingInFulfillment: number;
        trackingInTransit: number;
        trackingException: number;
        trackingReceived: number;
      };
      forecastContext?: {
        versionId: string;
        versionNo: string;
        publishedAt?: string | null;
        highMapeSkuCount: number;
      } | null;
    }>('/api/dashboard'),
  getSalesHistory: (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
    station?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.station) qs.set('station', params.station);
    if (params?.category) qs.set('category', params.category);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        category?: string | null;
        saleDate: string;
        qtySold: number;
        channel?: string | null;
        station?: string | null;
        warehouseCode?: string | null;
        source: string;
      }>;
      summary: { totalQty: number; rowCount: number };
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales/history${query ? `?${query}` : ''}`);
  },
  exportSalesHistoryCsv: async (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
    station?: string;
    category?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.station) qs.set('station', params.station);
    if (params?.category) qs.set('category', params.category);
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales/history/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-daily-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportSalesHistoryMonthlyCsv: async (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    category?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.category) qs.set('category', params.category);
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales/history/monthly/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-monthly-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  previewImport: (type: ImportType, body: { csv: string }) =>
    request<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
    }>(`/api/import/${type}/preview`, { method: 'POST', body: JSON.stringify(body) }),
  previewImportFile: async (type: ImportType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/import/${type}/preview`), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
      salesDiagnostics?: {
        daily: {
          expandedRowCount: number;
          skuCount: number;
          startDate: string | null;
          endDate: string | null;
        } | null;
      };
    }>;
  },
  previewSalesXiaoshouFiles: async (files: { dailyFile?: File | null }) => {
    if (!files.dailyFile) {
      throw new Error('请选择日销量 CSV（产品销售报表-每日宽表）');
    }
    const form = new FormData();
    form.append('dailyFile', files.dailyFile);
    const res = await apiFetch(apiUrl('/api/import/sales/preview'), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json();
  },
  importSalesXiaoshouFiles: async (files: { dailyFile?: File | null }) => {
    if (!files.dailyFile) {
      throw new Error('请选择日销量 CSV（产品销售报表-每日宽表）');
    }
    const form = new FormData();
    form.append('dailyFile', files.dailyFile);
    const res = await apiFetch(apiUrl('/api/import/sales'), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      errors: string[];
      createdSkus?: number;
      enrichedSkus?: number;
      insertedDailyRows?: number;
      skippedDailyRows?: number;
      upsertedMonthlyRows?: number;
      batchId?: string;
      batchStatus?: string;
      async?: boolean;
      rowCount?: number;
      estimatedDailyRows?: number;
      message?: string;
      validationIssues?: ImportValidationIssue[];
    };
  },
  getBitableStatus: () =>
    request<Record<BitableSyncType, BitableSyncTargetStatus>>('/api/bitable/status'),
  previewBitableSync: (type: BitableSyncType) =>
    request<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
      source: 'feishu-bitable';
    }>(`/api/bitable/sync/${type}/preview`, { method: 'POST' }),
  executeBitableSync: (type: BitableSyncType) =>
    request<{
      imported: number;
      errors: string[];
      batchId?: string;
      batchStatus?: string;
      validationIssues?: ImportValidationIssue[];
      source: 'feishu-bitable';
    }>(`/api/bitable/sync/${type}`, { method: 'POST' }),
  getImportBatches: (type?: ImportType) =>
    request<
      Array<{
        id: string;
        type: string;
        fileName?: string | null;
        rowCount: number;
        successCount: number;
        errorCount: number;
        status: string;
        errorSummary?: string | null;
        createdAt: string;
        dailyRowsWritten?: number;
        progressMeta?: {
          estimatedDailyRows?: number;
          processedSkuWideRows?: number;
          phase?: 'writing' | 'aggregating' | 'pruning';
        } | null;
      }>
    >(`/api/import/batches${type ? `?type=${type}` : ''}`),
  getSkuSuppliers: (skuId: string) =>
    request<
      Array<{
        id: string;
        merchantCode: string;
        merchantName: string;
        unitPrice?: string | null;
        leadTimeDays?: number | null;
        moq?: number | null;
        isDefault: boolean;
      }>
    >(`/api/skus/${skuId}/suppliers`),
  setDefaultSkuSupplier: (supplierId: string) =>
    request(`/api/sku-suppliers/${supplierId}/default`, { method: 'PUT' }),
  getInventoryOverview: (params?: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    page?: number;
    pageSize?: number;
    view?: string;
    columns?: string[];
    snapshotDate?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.view) qs.set('view', params.view);
    if (params?.snapshotDate) qs.set('snapshotDate', params.snapshotDate);
    if (params?.columns?.length) {
      qs.set('columns', params.columns.map((c) => encodeURIComponent(c)).join(','));
    }
    const query = qs.toString();
    return request<{
      items: InventoryOverview[];
      total: number;
      page: number;
      pageSize: number;
      selectedSnapshotDate: string | null;
      latestSnapshotDate: string | null;
      isLatestSnapshot: boolean;
      isStale: boolean;
      columns?: Array<{
        id: string;
        label: string;
        group: string;
        kind: 'meta' | 'sheet' | 'ops';
        excelCol?: string;
        defaultVisible: boolean;
      }>;
      defaultVisibleColumns?: string[];
    }>(`/api/inventory/overview${query ? `?${query}` : ''}`);
  },
  getInventorySnapshotDates: () =>
    request<{
      items: Array<{ snapshotDate: string; syncedAt: string; rowCount: number }>;
    }>('/api/inventory/overview/dates'),
  getInventoryOverviewDetail: (skuId: string, snapshotDate?: string) => {
    const qs = snapshotDate ? `?snapshotDate=${encodeURIComponent(snapshotDate)}` : '';
    return request<InventoryOverview>(`/api/inventory/overview/${skuId}${qs}`);
  },
  getInventoryQueryDates: () =>
    request<{ items: string[] }>('/api/inventory/query/dates'),
  getInventoryQuery: (params?: {
    q?: string;
    category?: string;
    salesCountry?: string;
    lifecycle?: string;
    page?: number;
    pageSize?: number;
    snapshotDate?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.snapshotDate) qs.set('snapshotDate', params.snapshotDate);
    const query = qs.toString();
    return request<{
      items: Array<{
        skuId: string | null;
        skuCode: string;
        payload: Record<string, string>;
      }>;
      total: number;
      page: number;
      pageSize: number;
      selectedSnapshotDate: string | null;
      latestSnapshotDate: string | null;
      isLatestSnapshot: boolean;
      isStale: boolean;
      syncedAt: string | null;
      columns: string[];
      defaultVisibleColumns: string[];
    }>(`/api/inventory/query${query ? `?${query}` : ''}`);
  },
  exportInventoryQueryCsv: async (params?: {
    q?: string;
    category?: string;
    salesCountry?: string;
    lifecycle?: string;
    snapshotDate?: string;
    columns?: string[];
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.snapshotDate) qs.set('snapshotDate', params.snapshotDate);
    if (params?.columns?.length) {
      qs.set('columns', params.columns.map((c) => encodeURIComponent(c)).join(','));
    }
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/inventory/query/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  getSkuPlanning: (skuId: string, warehouseCode?: string) => {
    const query = warehouseCode
      ? `?warehouse=${encodeURIComponent(warehouseCode)}`
      : '';
    return request<SkuPlanningView>(`/api/inventory/planning/${skuId}${query}`);
  },
  getSupplyLotSummaries: (params?: SupplyLotSummaryFilters & { page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.hasOverseas) qs.set('hasOverseas', 'true');
    if (params?.hasInTransit) qs.set('hasInTransit', 'true');
    if (params?.hasLocal) qs.set('hasLocal', 'true');
    if (params?.hasUndatedTransit) qs.set('hasUndatedTransit', 'true');
    if (params?.multiTransitBatch) qs.set('multiTransitBatch', 'true');
    const query = qs.toString();
    return request<PaginatedResult<SupplyLotSummaryRow>>(
      `/api/inventory/pools/summary${query ? `?${query}` : ''}`,
    );
  },
  exportSupplyLotSummariesCsv: async (params?: SupplyLotSummaryFilters) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.hasOverseas) qs.set('hasOverseas', 'true');
    if (params?.hasInTransit) qs.set('hasInTransit', 'true');
    if (params?.hasLocal) qs.set('hasLocal', 'true');
    if (params?.hasUndatedTransit) qs.set('hasUndatedTransit', 'true');
    if (params?.multiTransitBatch) qs.set('multiTransitBatch', 'true');
    const query = qs.toString();
    const res = await apiFetch(
      apiUrl(`/api/inventory/pools/summary/export${query ? `?${query}` : ''}`),
    );
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  getSupplyLotWarehouses: () =>
    request<{ items: string[] }>('/api/inventory/pools/warehouses'),
  getSupplyLots: (params?: SupplyLotBatchFilters & { page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.pool) qs.set('pool', params.pool);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.skuId) qs.set('skuId', params.skuId);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    if (params?.dateUnknown) qs.set('dateUnknown', 'true');
    const query = qs.toString();
    return request<PaginatedResult<SupplyLotRow> & { dateUnknownCount?: number }>(
      `/api/inventory/pools${query ? `?${query}` : ''}`,
    );
  },
  exportSupplyLotsCsv: async (params?: SupplyLotBatchFilters) => {
    const qs = new URLSearchParams();
    if (params?.pool) qs.set('pool', params.pool);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.q) qs.set('q', params.q);
    if (params?.dateUnknown) qs.set('dateUnknown', 'true');
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/inventory/pools/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
  syncSupplyLots: () =>
    request<{ lotCount: number; eligibleCount: number }>('/api/inventory/pools/sync', {
      method: 'POST',
    }),
  updateSupplyLot: (
    id: string,
    data: {
      productionStatus?: 'in_production' | 'qc_pending' | 'completed';
      shipReadyAt?: string | null;
      latestShipDate?: string | null;
      remainingLogisticsDays?: number;
    },
  ) =>
    request(`/api/inventory/pools/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getPlanningDashboard: () =>
    request<PlanningDashboard>('/api/planning/dashboard'),
  getInventoryDataIssues: (params?: {
    status?: string;
    type?: string;
    page?: number;
    pageSize?: number;
    q?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.type) qs.set('type', params.type);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return request<
      PaginatedResult<InventoryDataIssueRow> & {
        count: number;
        openByType: Record<string, number>;
      }
    >(`/api/inventory/data-issues${query ? `?${query}` : ''}`);
  },
  updateInventoryDataIssue: (
    id: string,
    data: {
      status?: InventoryDataIssueRow['status'];
      ownerId?: string | null;
      resolutionNote?: string;
    },
  ) =>
    request(`/api/inventory/data-issues/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  scanInventoryDataIssues: () =>
    request<{
      scannedLots: number;
      scannedSkus: number;
      detected: number;
      inserted: number;
      refreshed: number;
      autoResolved: number;
    }>('/api/tasks/inventory-data-issue-scan', { method: 'POST' }),
  getUnallocatedSupply: (params?: {
    skuId?: string;
    pool?: string;
    page?: number;
    pageSize?: number;
    q?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuId) qs.set('skuId', params.skuId);
    if (params?.pool) qs.set('pool', params.pool);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return request<
      PaginatedResult<UnallocatedSupplyRow> & {
        count: number;
        openCount: number;
        openQty: number;
      }
    >(`/api/inventory/unallocated${query ? `?${query}` : ''}`);
  },
  assignUnallocatedLot: (
    id: string,
    data: { assignments: Array<{ warehouseCode: string; qty: number }> },
  ) =>
    request<{ items: Array<{ warehouseCode: string; qty: number }> }>(
      `/api/inventory/unallocated/${id}/assign`,
      { method: 'POST', body: JSON.stringify(data) },
    ),
  exportInventoryOverviewCsv: async (params?: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    view?: string;
    columns?: string[];
    full?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.view) qs.set('view', params.view);
    if (params?.full) qs.set('full', 'true');
    if (params?.columns?.length) {
      qs.set('columns', params.columns.map((c) => encodeURIComponent(c)).join(','));
    }
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/inventory/overview/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-turnover-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportInventoryCsv: async () => {
    const res = await apiFetch(apiUrl('/api/inventory/export'));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  createInventoryRecord: (data: {
    skuId: string;
    warehouse: string;
    qtyAvailable?: number;
    qtyInTransit?: number;
    qtyInProduction?: number;
    recordedDate: string;
  }) => request('/api/inventory/records', { method: 'POST', body: JSON.stringify(data) }),
  getMerchants: () =>
    request<Array<{ merchantCode: string; merchantName?: string | null }>>('/api/merchants'),
  getWarehouses: () =>
    request<
      Array<{
        id: string;
        code: string;
        name: string;
        regionGroup: string;
        countryCode?: string | null;
        allowCrossFulfill: boolean;
      }>
    >('/api/warehouses'),
  getLeadTimeProfiles: (params?: {
    warehouse?: string;
    merchant?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.merchant) qs.set('merchant', params.merchant);
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<PaginatedResult<LeadTimeProfile>>(
      `/api/lead-time-profiles${query ? `?${query}` : ''}`,
    );
  },
  upsertLeadTimeProfile: (data: LeadTimeProfileInput) =>
    request<LeadTimeProfile>('/api/lead-time-profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteLeadTimeProfile: (id: string) =>
    request<{ ok: true }>(`/api/lead-time-profiles/${id}`, { method: 'DELETE' }),
  getShipments: (params?: {
    delayed?: boolean;
    page?: number;
    pageSize?: number;
    q?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.delayed) qs.set('delayed', '1');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    const query = qs.toString();
    return request<PaginatedResult<Shipment>>(`/api/shipments${query ? `?${query}` : ''}`);
  },
  upsertShipmentMilestone: (shipmentId: string, data: ShipmentMilestoneInput) =>
    request<ShipmentMilestone>(`/api/shipments/${encodeURIComponent(shipmentId)}/milestones`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getChannelWarehousePrefs: () =>
    request<
      Array<{
        channel: string;
        primaryWarehouseCode: string;
        overflowWarehouseCodes?: string | null;
        lastMileCostIndex: string;
      }>
    >('/api/channel-warehouse-prefs'),
  getSafetyStock: (params?: { page?: number; pageSize?: number; q?: string; warehouse?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.warehouse?.trim()) qs.set('warehouse', params.warehouse.trim());
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string | null;
        skuId: string;
        skuCode: string;
        skuName: string;
        warehouseCode: string;
        safetyStockQty: number | null;
        reorderPoint: number | null;
        reorderQty: number | null;
        safetyStockDays: number | null;
        safetyStockMethod: SafetyStockMethod;
        serviceLevel: string | null;
        demandStdDev: string | null;
        leadTimeStdDev: string | null;
        calcMethod: string | null;
        lastCalcAt?: string | null;
      }>
    >(`/api/safety-stock${query ? `?${query}` : ''}`);
  },
  getSafetyStockSuggestions: (params?: {
    warehouse?: string;
    serviceLevel?: number;
    sort?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.serviceLevel != null) qs.set('serviceLevel', String(params.serviceLevel));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<{ items: SafetyStockSuggestionView[]; total: number; limit: number; offset: number }>(
      `/api/safety-stock/suggestions${query ? `?${query}` : ''}`,
    );
  },
  updateSafetyStock: (
    skuId: string,
    data: {
      safetyStockQty: number;
      reorderPoint: number;
      reorderQty: number;
      safetyStockDays?: number | null;
      safetyStockMethod: SafetyStockMethod;
      serviceLevel: number | null;
    },
    warehouseCode?: string,
  ) => {
    const qs = warehouseCode ? `?warehouse=${encodeURIComponent(warehouseCode)}` : '';
    return request(`/api/safety-stock/${skuId}${qs}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  calculateSafetyStock: (
    skuId: string,
    data: { safetyStockMethod: SafetyStockMethod; serviceLevel: number | null },
    warehouseCode?: string,
  ) => {
    const qs = warehouseCode ? `?warehouse=${encodeURIComponent(warehouseCode)}` : '';
    return request(`/api/safety-stock/${skuId}/calculate${qs}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  getAlerts: (params?: {
    page?: number;
    pageSize?: number;
    q?: string;
    horizonDays?: string;
    alertType?: string;
    resolved?: 'open' | 'done';
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.horizonDays) qs.set('horizonDays', params.horizonDays);
    if (params?.alertType) qs.set('alertType', params.alertType);
    if (params?.resolved) qs.set('resolved', params.resolved);
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        warehouseCode?: string | null;
        alertType: string;
        currentQty: number;
        safetyQty: number;
        horizonDays?: number | null;
        projectedQty?: number | null;
        projectedStockoutDate?: string | null;
        localQty: number;
        overseasQty: number;
        inTransitQty: number;
        futureNeedQty: number | null;
        isResolved: boolean;
      }>;
      total: number;
      page: number;
      pageSize: number;
      openCount: number;
    }>(`/api/alerts${query ? `?${query}` : ''}`);
  },
  resolveAlert: (id: string) => request(`/api/alerts/${id}/resolve`, { method: 'PATCH' }),
  getReorderSuggestions: (params?: {
    q?: string;
    sku?: string;
    warehouse?: string;
    status?: 'pending' | 'accepted' | 'ignored';
    queue?: 'auto' | 'manual' | 'all';
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.sku?.trim()) qs.set('sku', params.sku.trim());
    if (params?.warehouse?.trim()) qs.set('warehouse', params.warehouse.trim());
    if (params?.status) qs.set('status', params.status);
    if (params?.queue) qs.set('queue', params.queue);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        merchantCode?: string | null;
        merchantName?: string | null;
        warehouseCode?: string | null;
        suggestedQty: number;
        suggestedDate: string;
        reason: string;
        healthStatus?: InventoryHealth | null;
        coverageDays?: string | null;
        totalLeadDays?: number | null;
        latestOrderDays?: string | null;
        metrics?: Record<string, unknown> | null;
        status: string;
        planId?: string | null;
      }>
    >(`/api/reorder/suggestions${query ? `?${query}` : ''}`);
  },
  updateReorderSuggestion: (id: string, data: { status: 'accepted' | 'ignored'; merchantCode?: string }) =>
    request(`/api/reorder/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getPurchaseTracking: (params?: {
    status?: PurchaseDraftStatus;
    page?: number;
    pageSize?: number;
    q?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        draftNo: string;
        skuCode: string;
        skuName: string;
        qty: number;
        receivedQty: number;
        remainingQty: number;
        expectedDate?: string | null;
        etaAvailable?: string | null;
        confirmedDeliveryDate?: string | null;
        plannedProductionDoneDate?: string | null;
        actualProductionDoneDate?: string | null;
        plannedPickupDate?: string | null;
        etd?: string | null;
        etaPort?: string | null;
        customsDoneDate?: string | null;
        etaWarehouse?: string | null;
        transportMode?: string | null;
        actualShipDate?: string | null;
        actualReceivedDate?: string | null;
        source: string;
        planId?: string | null;
        planItemId?: string | null;
        planNo?: string | null;
        merchantCode?: string | null;
        merchantName?: string | null;
        status: PurchaseDraftStatus;
        statusLabel: string;
        exceptionReason?: string | null;
        remark?: string | null;
      }>
    >(`/api/purchase-drafts${query ? `?${query}` : ''}`);
  },
  updatePurchaseTracking: (
    id: string,
    data: {
      status?: PurchaseDraftStatus;
      remark?: string;
      etaAvailable?: string;
      confirmedDeliveryDate?: string;
      plannedProductionDoneDate?: string | null;
      actualProductionDoneDate?: string | null;
      plannedPickupDate?: string | null;
      etd?: string | null;
      etaPort?: string | null;
      customsDoneDate?: string | null;
      etaWarehouse?: string | null;
      transportMode?: string | null;
      actualShipDate?: string;
      exceptionReason?: string;
    },
  ) => request(`/api/purchase-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  receivePurchaseTracking: (
    id: string,
    data: { qtyReceived: number; receivedDate?: string; idempotencyKey?: string },
  ) =>
    request(`/api/purchase-drafts/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getProcurementListConfig: () =>
    request<Record<ProcurementListType, ProcurementListConfig>>('/api/procurement/lists/config'),
  getProcurementListMeta: (type: ProcurementListType) =>
    request<ProcurementListMeta>(`/api/procurement/lists/${type}/meta`),
  listProcurementRows: (params: {
    type: ProcurementListType;
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.keyword) q.set('keyword', params.keyword);
    const suffix = q.toString() ? `?${q}` : '';
    return request<{
      items: ProcurementListRow[];
      total: number;
      page: number;
      pageSize: number;
      columns: string[];
      meta: ProcurementListMeta;
    }>(`/api/procurement/lists/${params.type}${suffix}`);
  },
  previewProcurementFeishuSync: (type: ProcurementListType) =>
    request<{
      source: 'feishu';
      totalRows: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>(`/api/procurement/lists/${type}/sync/preview`, { method: 'POST' }),
  executeProcurementFeishuSync: (type: ProcurementListType) =>
    request<{
      imported: number;
      columnOrder: string[];
      source: 'feishu';
    }>(`/api/procurement/lists/${type}/sync`, { method: 'POST' }),
  previewProcurementFeishuPush: (type: ProcurementListType) =>
    request<{
      direction: 'to_feishu';
      mode: 'full_replace';
      localRowCount: number;
      feishuRowCount: number;
      toWrite: number;
      toDelete: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>(`/api/procurement/lists/${type}/push/preview`, { method: 'POST' }),
  executeProcurementFeishuPush: async (type: ProcurementListType) => {
    type SyncResult = {
      async?: false;
      direction: 'to_feishu';
      mode: 'full_replace';
      pushed: number;
      created: number;
      deleted: number;
    };
    type AsyncStart = {
      async: true;
      taskRunId: string;
      status: 'running';
      listType: ProcurementListType;
    };

    const initial = await request<SyncResult | AsyncStart>(
      `/api/procurement/lists/${type}/push`,
      { method: 'POST' },
    );
    if (!initial.async) return initial;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 720; attempt++) {
      await sleep(attempt < 5 ? 2000 : 5000);
      const task = await request<{
        taskRunId: string;
        status: 'running' | 'success' | 'failed';
        errorMessage?: string | null;
        result: SyncResult | null;
      }>(`/api/procurement/lists/${type}/push/tasks/${encodeURIComponent(initial.taskRunId)}`);
      if (task.status === 'running') continue;
      if (task.status === 'failed') {
        throw new Error(task.errorMessage ?? '同步到飞书失败');
      }
      if (task.result) return task.result;
      throw new Error('后台任务已完成但未返回结果');
    }
    throw new Error('同步到飞书超时，请稍后刷新列表查看飞书侧是否已更新');
  },
  getProcurementFeishuPushTask: (type: ProcurementListType, taskRunId: string) =>
    request<{
      taskRunId: string;
      listType: ProcurementListType;
      status: 'running' | 'success' | 'failed';
      startedAt: string;
      finishedAt: string | null;
      errorMessage: string | null;
      result: {
        direction: 'to_feishu';
        mode: 'full_replace';
        pushed: number;
        created: number;
        deleted: number;
        fieldsCreated: number;
      } | null;
    }>(`/api/procurement/lists/${type}/push/tasks/${encodeURIComponent(taskRunId)}`),
  previewProcurementUpload: async (type: ProcurementListType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/procurement/lists/${type}/import/preview`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      source: 'upload';
      totalRows: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>;
  },
  executeProcurementUpload: async (type: ProcurementListType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/procurement/lists/${type}/import`), {
      method: 'POST',
      body: form,
    });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      columnOrder: string[];
      source: 'upload';
    };
  },
  listCostingPriceBook: (params?: {
    q?: string;
    category?: string;
    regionId?: string;
    factoryId?: string;
    activeOnly?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.regionId) qs.set('regionId', params.regionId);
    if (params?.factoryId) qs.set('factoryId', params.factoryId);
    if (params?.activeOnly) qs.set('activeOnly', 'true');
    const query = qs.toString();
    return request<{ items: CostingPriceBookItem[] }>(
      `/api/procurement/costing/price-book${query ? `?${query}` : ''}`,
    );
  },
  createCostingPriceBookItem: (
    data: Omit<CostingBomLineInput, 'qtyNet' | 'lossRate' | 'sourceRef' | 'confidence' | 'unitPriceOverride' | 'isManual'> & {
      unitPrice: number;
      standard?: string;
      regionId?: string | null;
      factoryId?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
    },
  ) =>
    request<CostingPriceBookItem>('/api/procurement/costing/price-book', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCostingPriceBookItem: (
    id: string,
    data: Partial<{
      category: string;
      materialName: string;
      spec: string;
      standard: string;
      unit: string;
      unitPrice: number;
      notes: string;
      regionId: string | null;
      factoryId: string | null;
      effectiveFrom: string | null;
      effectiveTo: string | null;
    }>,
  ) =>
    request<CostingPriceBookItem>(`/api/procurement/costing/price-book/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  disableCostingPriceBookItem: (id: string) =>
    request<{ ok: boolean }>(`/api/procurement/costing/price-book/${id}/disable`, {
      method: 'POST',
    }),
  importCostingPriceBook: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl('/api/procurement/costing/price-book/import'), {
      method: 'POST',
      body: form,
    });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) throw new Error(payload.message ?? '导入失败');
    return payload as { imported: number; errors: number };
  },
  listCostingProjects: (params?: { page?: number; pageSize?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return request<PaginatedResult<CostingProjectListItem>>(
      `/api/procurement/costing/projects${query ? `?${query}` : ''}`,
    );
  },
  createCostingProject: (data: { name?: string } = {}) =>
    request<{ id: string; projectNo: string; name: string; status: string }>(
      '/api/procurement/costing/projects',
      { method: 'POST', body: JSON.stringify(data) },
    ),
  getCostingProject: (id: string) =>
    request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}`),
  downloadCostingProject: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/procurement/costing/projects/${id}/export`));
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(payload.message ?? '导出失败');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? `costing-${id}.xlsx`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },
  patchCostingProject: (
    id: string,
    data: {
      name?: string;
      category?: string | null;
      constructionType?: string | null;
      drawerCount?: number | null;
      defaultSubstrate?: string | null;
      carcassThicknessMm?: number | null;
      drawerBottomThicknessMm?: number | null;
      sideThicknessMm?: number | null;
      backThicknessMm?: number | null;
      bottomThicknessMm?: number | null;
      structureSummary?: string | null;
      designPrinciples?: string | null;
      hardwareFacts?: CostingHardwareFact[];
      otherHardwarePct?: number | null;
      regionId?: string | null;
      factoryId?: string | null;
      priceAsOf?: string | null;
    },
  ) =>
    request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCostingProject: (id: string) =>
    request<{ ok: boolean }>(`/api/procurement/costing/projects/${id}`, {
      method: 'DELETE',
    }),
  uploadCostingAttachment: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/procurement/costing/projects/${id}/attachments`), {
      method: 'POST',
      body: form,
    });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) throw new Error(payload.message ?? '上传失败');
    return payload as { ok: boolean };
  },
  analyzeCostingFacts: (id: string) =>
    request<{ started: true }>(`/api/procurement/costing/projects/${id}/analyze-facts`, {
      method: 'POST',
    }),
  confirmCostingDesignForApply: (id: string) =>
    request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}/confirm-design`, {
      method: 'POST',
    }),
  startCostingExtract: (id: string, range?: { pageFrom?: number; pageTo?: number }) =>
    request<{ runId: string }>(`/api/procurement/costing/projects/${id}/extract`, {
      method: 'POST',
      body: JSON.stringify(range ?? {}),
    }),
  applyCostingFacts: (id: string) =>
    request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}/apply-facts`, {
      method: 'POST',
    }),
  computeCostingProject: (id: string) =>
    request<CostingProjectDetail>(`/api/procurement/costing/projects/${id}/compute`, {
      method: 'POST',
    }),
  getCostingExtractRun: (id: string, runId: string) =>
    request<CostingExtractRun>(
      `/api/procurement/costing/projects/${id}/extract/runs/${runId}`,
    ),
  saveCostingBomLines: (id: string, lines: CostingBomLineInput[]) =>
    request<{ items: CostingBomLine[] }>(`/api/procurement/costing/projects/${id}/bom-lines`, {
      method: 'PUT',
      body: JSON.stringify({ lines }),
    }),
  createCostingBomLine: (id: string, line: CostingBomLineInput) =>
    request<CostingBomLine>(`/api/procurement/costing/projects/${id}/bom-lines`, {
      method: 'POST',
      body: JSON.stringify(line),
    }),
  patchCostingBomLine: (id: string, lineId: string, patch: Partial<CostingBomLineInput>) =>
    request<CostingBomLine>(`/api/procurement/costing/projects/${id}/bom-lines/${lineId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  bindCostingBomLinePriceBook: (id: string, lineId: string, priceBookId: string) =>
    request<CostingBomLine>(
      `/api/procurement/costing/projects/${id}/bom-lines/${lineId}/bind-price-book`,
      {
        method: 'POST',
        body: JSON.stringify({ priceBookId }),
      },
    ),
  deleteCostingBomLine: (id: string, lineId: string) =>
    request<{ ok: boolean }>(`/api/procurement/costing/projects/${id}/bom-lines/${lineId}`, {
      method: 'DELETE',
    }),
  getCostingStatus: () =>
    request<{
      difyEnabled: boolean;
      preprocessMode: string;
      productCategories: string[];
      categoryFamilies: Array<{ category: string; familyId: string }>;
      bomLineCategories?: string[];
    }>('/api/procurement/costing/status'),
  listCostingRegions: (activeOnly = false) =>
    request<{ items: CostingRegion[] }>(
      `/api/procurement/costing/regions${activeOnly ? '?activeOnly=true' : ''}`,
    ),
  createCostingRegion: (data: { name: string; code?: string }) =>
    request<CostingRegion>('/api/procurement/costing/regions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listCostingFactories: (activeOnly = false) =>
    request<{ items: CostingFactory[] }>(
      `/api/procurement/costing/factories${activeOnly ? '?activeOnly=true' : ''}`,
    ),
  createCostingFactory: (data: { name: string; code?: string; regionId?: string | null }) =>
    request<CostingFactory>('/api/procurement/costing/factories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  patchCostingFactoryPackProfile: (id: string, packProfile: CostingPackProfileInput | null) =>
    request<CostingFactory>(`/api/procurement/costing/factories/${id}/pack-profile`, {
      method: 'PATCH',
      body: JSON.stringify({ packProfile }),
    }),
  listCostingFeeRates: (params?: { regionId?: string; factoryId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.regionId) qs.set('regionId', params.regionId);
    if (params?.factoryId) qs.set('factoryId', params.factoryId);
    const query = qs.toString();
    return request<{ items: CostingFeeRate[] }>(
      `/api/procurement/costing/fee-rates${query ? `?${query}` : ''}`,
    );
  },
  upsertCostingFeeRate: (data: {
    name: string;
    regionId: string;
    factoryId: string;
    rate: number;
  }) =>
    request<CostingFeeRate>('/api/procurement/costing/fee-rates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  disableCostingFeeRate: (id: string) =>
    request<{ ok: boolean }>(`/api/procurement/costing/fee-rates/${id}/disable`, {
      method: 'POST',
    }),
  clearProcurementList: (type: ProcurementListType) =>
    request<{ deleted: number }>(`/api/procurement/lists/${type}/clear`, { method: 'POST' }),
  getPmcPlans: (params?: { page?: number; pageSize?: number; q?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        planNo: string;
        name: string;
        merchantCode: string;
        merchantName?: string | null;
        targetWarehouseCode?: string | null;
        planDate: string;
        deliveryDate: string;
        status: string;
      }>
    >(`/api/pmc/plans${query ? `?${query}` : ''}`);
  },
  getPmcPlan: (id: string) =>
    request<{
      id: string;
      planNo: string;
      name: string;
      merchantCode: string;
      merchantName?: string | null;
      targetWarehouseCode?: string | null;
      planDate: string;
      deliveryDate: string;
      status: string;
      items: Array<{
        id: string;
        skuCode: string;
        skuName: string;
        warehouseCode?: string | null;
        plannedQty: number;
        completedQty: number | null;
        unit: string;
      }>;
      purchaseTracking?: Array<{
        id: string;
        draftNo: string;
        skuCode: string;
        qty: number;
        receivedQty: number;
        status: string;
        planItemId?: string | null;
        confirmedDeliveryDate?: string | null;
        exceptionReason?: string | null;
      }>;
    }>(`/api/pmc/plans/${id}`),
  exportPmcPlan: async (id: string, planNo?: string, format: 'csv' | 'xlsx' = 'csv') => {
    const qs = format === 'xlsx' ? '?format=xlsx' : '';
    const res = await apiFetch(apiUrl(`/api/pmc/plans/${id}/export${qs}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planNo ?? id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportPmcPlanCsv: async (id: string, planNo?: string) => {
    const res = await apiFetch(apiUrl(`/api/pmc/plans/${id}/export`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planNo ?? id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  createPmcPlan: (data: {
    name: string;
    merchantCode: string;
    merchantName?: string;
    targetWarehouseCode: string;
    planDate: string;
    deliveryDate: string;
    remark?: string;
    items: Array<{ skuId: string; plannedQty: number; unit?: string; warehouseCode?: string }>;
  }) => request('/api/pmc/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePmcPlanStatus: (id: string, status: string) =>
    request(`/api/pmc/plans/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updatePmcPlanItem: (planId: string, itemId: string, data: { completedQty?: number; plannedQty?: number }) =>
    request(`/api/pmc/plans/${planId}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
  receivePmcPlanItem: (
    planId: string,
    itemId: string,
    data: { qtyReceived: number; receivedDate?: string; idempotencyKey?: string },
  ) =>
    request(`/api/pmc/plans/${planId}/items/${itemId}/receive`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importData: (
    type: ImportType,
    body: { csv: string; planName?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  ) =>
    request<{
      imported: number;
      errors: string[];
      createdSkus?: number;
      updatedSkus?: number;
      batchId?: string;
      batchStatus?: string;
      validationIssues?: ImportValidationIssue[];
    }>(`/api/import/${type}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importFile: async (
    type: ImportType,
    file: File,
    meta?: { planName?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (meta?.planName) form.append('planName', meta.planName);
    if (meta?.planDate) form.append('planDate', meta.planDate);
    if (meta?.deliveryDate) form.append('deliveryDate', meta.deliveryDate);
    if (meta?.merchantCode) form.append('merchantCode', meta.merchantCode);
    if (meta?.merchantName) form.append('merchantName', meta.merchantName);
    const res = await apiFetch(apiUrl(`/api/import/${type}`), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      errors: string[];
      createdSkus?: number;
      updatedSkus?: number;
      batchId?: string;
      batchStatus?: string;
      async?: boolean;
      rowCount?: number;
      message?: string;
      validationIssues?: ImportValidationIssue[];
    };
  },
  importInventoryCsv: (csv: string) =>
    request<{ imported: number; errors: string[] }>('/api/import/inventory', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  runStockAlert: () => request('/api/tasks/stock-alert', { method: 'POST' }),
  runReplenishmentForecast: () => request('/api/tasks/replenishment-forecast', { method: 'POST' }),
  getAiConfig: () =>
    request<{
      mode: 'local' | 'dify';
      difyEnabled: boolean;
      replenishmentWorkflow?: boolean;
      alertWorkflow?: boolean;
      salesForecastWorkflow?: boolean;
    }>('/api/ai/config'),
  getAiConversations: () =>
    request<Array<{ id: string; title: string | null; createdAt: string }>>('/api/ai/conversations'),
  getAiMessages: (conversationId: string) =>
    request<{
      conversation: { id: string; title: string | null };
      messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        sources?: Array<{ document_name?: string; content?: string }> | null;
        createdAt: string;
      }>;
    }>(`/api/ai/conversations/${conversationId}/messages`),
  chat: (body: {
    query: string;
    conversationId?: string;
    skuCode?: string;
    skuId?: string;
    warehouseCode?: string;
  }) =>
    request<{
      answer: string;
      conversationId: string;
      sources?: Array<{ document_name?: string; content?: string }>;
      mode?: 'local' | 'dify' | 'local-fallback';
      mock?: boolean;
      fallback?: boolean;
    }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getFobFeeRules: (params?: { sourceBillType?: 'trucking' | 'freight' }) => {
    const q = params?.sourceBillType ? `?sourceBillType=${params.sourceBillType}` : '';
    return request<
      Array<{
        id: string;
        feeType: string | null;
        sourceBillType: string;
        matchPattern: string | null;
        allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
        defaultStage: string;
        priority: number;
        isActive: boolean;
        remark: string | null;
        createdAt: string;
      }>
    >(`/api/logistics/fob-fee-rules${q}`);
  },
  createFobFeeRule: (data: {
    feeType?: string;
    matchPattern?: string;
    sourceBillType: 'trucking' | 'freight';
    allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
    priority?: number;
    remark?: string;
    isActive?: boolean;
  }) =>
    request('/api/logistics/fob-fee-rules', { method: 'POST', body: JSON.stringify(data) }),
  resetFobFeeRulePriorities: () =>
    request<{ ok: boolean; updated: number }>('/api/logistics/fob-fee-rules/reset-priorities', {
      method: 'POST',
    }),
  updateFobFeeRule: (
    id: string,
    data: {
      feeType?: string | null;
      matchPattern?: string | null;
      allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
      defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
      priority?: number;
      remark?: string | null;
      isActive?: boolean;
    },
  ) =>
    request(`/api/logistics/fob-fee-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getFobServiceProviders: (params?: { providerType?: 'trucking' | 'freight'; activeOnly?: boolean }) => {
    const search = new URLSearchParams();
    if (params?.providerType) search.set('providerType', params.providerType);
    if (params?.activeOnly) search.set('activeOnly', 'true');
    const q = search.toString() ? `?${search.toString()}` : '';
    return request<
      Array<{
        id: string;
        code: string;
        name: string;
        providerType: 'trucking' | 'freight';
        sortOrder: number;
        isActive: boolean;
        remark: string | null;
        createdAt: string;
        updatedAt: string;
      }>
    >(`/api/logistics/fob-service-providers${q}`);
  },
  createFobServiceProvider: (data: {
    code: string;
    name: string;
    providerType: 'trucking' | 'freight';
    sortOrder?: number;
    remark?: string;
    isActive?: boolean;
  }) =>
    request('/api/logistics/fob-service-providers', { method: 'POST', body: JSON.stringify(data) }),
  updateFobServiceProvider: (
    id: string,
    data: {
      name?: string;
      providerType?: 'trucking' | 'freight';
      sortOrder?: number;
      remark?: string | null;
      isActive?: boolean;
    },
  ) =>
    request(`/api/logistics/fob-service-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  toggleFobServiceProvider: (id: string) =>
    request(`/api/logistics/fob-service-providers/${id}/toggle`, { method: 'PATCH' }),
  getFobSettlements: (params?: { page?: number; pageSize?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q?.trim()) qs.set('q', params.q.trim());
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        batchNo: string;
        name: string;
        settlementPeriod: string;
        settlementType: 'trucking' | 'freight';
        serviceProviderId: string;
        usdToCnyRate: string;
        status: string;
        createdBy?: string | null;
        createdByName?: string | null;
        createdAt: string;
        serviceProvider: {
          id: string;
          code: string;
          name: string;
          providerType: 'trucking' | 'freight';
        } | null;
      }>
    >(`/api/logistics/fob-settlements${query ? `?${query}` : ''}`);
  },
  getFobSettlement: (id: string) =>
    request<{
      id: string;
      batchNo: string;
      name: string;
      settlementPeriod: string;
      settlementType: 'trucking' | 'freight';
      serviceProviderId: string;
      usdToCnyRate: string;
      status: string;
      createdBy?: string | null;
      createdByName?: string | null;
      createdAt: string;
      serviceProvider: {
        id: string;
        code: string;
        name: string;
        providerType: 'trucking' | 'freight';
      } | null;
      merchantShipments: Array<Record<string, unknown>>;
      containerStats: Array<{
        id: string;
        containerNo: string;
        merchantCode: string;
        merchantName?: string | null;
        volumeCbm: string;
        ticketCount: number;
        businessNos: string;
        factoryType: string;
        skuCodes: string;
      }>;
      truckingItems: Array<Record<string, unknown>>;
      freightItems: Array<Record<string, unknown>>;
      pendingExceptions: number;
      allocations: Array<{
        id: string;
        containerNo: string;
        merchantCode: string;
        stage: string;
        feeType: string;
        sourceBillItemId?: string | null;
        allocationMethod: string;
        sourceAmountCny?: string;
        volumeRatio: string;
        ticketRatio?: string | null;
        allocatedAmountCny: string;
        isManualOverride?: boolean;
        overrideReason?: string | null;
      }>;
      merchantSummary: Array<{
        merchantCode: string;
        merchantName?: string | null;
        truckingTotal: number;
        freightTotal: number;
        customsTotal: number;
        otherTotal: number;
        grandTotal: number;
        paymentStatus: 'paid' | 'unpaid' | 'not_required';
        paymentRemark: string | null;
      }>;
      nonFobContainers?: string[];
      containerMatch?: {
        volumeCount: number;
        billCount: number;
        matchedCount: number;
        matched: string[];
        volumeOnly: string[];
        billOnly: string[];
        nonFobOnly: string[];
        canAllocate: boolean;
      };
    }>(`/api/logistics/fob-settlements/${id}`),
  createFobSettlement: (data: {
    name: string;
    settlementPeriod: string;
    settlementType: 'trucking' | 'freight';
    serviceProviderId: string;
    usdToCnyRate?: number;
    remark?: string;
  }) =>
    request('/api/logistics/fob-settlements', { method: 'POST', body: JSON.stringify(data) }),
  updateFobSettlement: (
    id: string,
    data: { name?: string; usdToCnyRate?: number; status?: string; remark?: string },
  ) =>
    request(`/api/logistics/fob-settlements/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFobSettlement: (id: string) =>
    request<{ ok: boolean }>(`/api/logistics/fob-settlements/${id}`, { method: 'DELETE' }),
  patchFobMerchantPayments: (
    id: string,
    data: {
      updates: Array<{
        merchantCode: string;
        paymentStatus: 'paid' | 'unpaid' | 'not_required';
        remark?: string;
      }>;
    },
  ) =>
    request<{ ok: boolean; updated: number }>(
      `/api/logistics/fob-settlements/${id}/merchant-payments`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
  downloadFobTemplate: async (type: 'volume' | 'trucking' | 'freight') => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/templates/${type}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Download failed');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : `fob-${type}-template.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  importFobTrucking: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/trucking`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      skippedRows: number;
      errors: string[];
      warnings?: string[];
    }>;
  },
  importFobFreight: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/freight`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      skippedRows: number;
      errors: string[];
      warnings?: string[];
    }>;
  },
  importFobShipments: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/shipments`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      merchants: number;
      skippedRows: number;
      errors: string[];
    }>;
  },
  getFobExceptions: (id: string) =>
    request<{
      items: Array<{
        id: string;
        billType: 'trucking' | 'freight';
        containerNo: string;
        feeType: string;
        amountCny: number;
        adjustedAmountCny: number;
        allocationMethod: string | null;
        assignedMerchantCode: string | null;
        exceptionStatus: string | null;
        exceptionReason?: 'unconfigured' | 'remark' | 'amount' | 'fee_name';
        exceptionReasonLabel?: string;
        reviewNote: string | null;
        remark: string | null;
      }>;
      pendingCount: number;
    }>(`/api/logistics/fob-settlements/${id}/exceptions`),
  patchFobException: (
    id: string,
    itemId: string,
    data: {
      billType: 'trucking' | 'freight';
      exceptionStatus?: 'pending' | 'confirmed' | 'rejected';
      assignedMerchantCode?: string;
      adjustedAmountCny?: number;
      allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
      reviewNote?: string;
    },
  ) =>
    request(`/api/logistics/fob-settlements/${id}/exceptions/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getFobReconcile: (id: string) =>
    request<{
      billTotalCny: number;
      allocationTotalCny: number;
      diffCny: number;
      balanced: boolean;
      pendingExceptions: number;
      warnings: string[];
      containerChecks: Array<{
        containerNo: string;
        feeType: string;
        sourceBillType: 'trucking' | 'freight';
        sourceBillItemId: string;
        sourceAmountCny: number;
        allocatedCny: number;
        diffCny: number;
      }>;
    }>(`/api/logistics/fob-settlements/${id}/reconcile`),
  postFobAdjustment: (
    id: string,
    data: {
      allocationId: string;
      adjustType: 'amount' | 'merchant' | 'exclude';
      adjustedValue: string;
      reason?: string;
    },
  ) =>
    request(`/api/logistics/fob-settlements/${id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  calculateFobSettlement: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/calculate`), {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      const err = new Error(body.message ?? '核算失败') as Error & {
        warnings?: string[];
        containerMatch?: {
          volumeCount: number;
          billCount: number;
          matchedCount: number;
          matched: string[];
          volumeOnly: string[];
          billOnly: string[];
          nonFobOnly: string[];
          canAllocate: boolean;
        };
      };
      err.warnings = body.warnings;
      err.containerMatch = body.containerMatch;
      throw err;
    }
    return body as {
      allocationCount: number;
      warnings: string[];
      reconcile: {
        billTotalCny: number;
        allocationTotalCny: number;
        diffCny: number;
        balanced: boolean;
      };
      merchantSummary: Array<{
        merchantCode: string;
        grandTotal: number;
        paymentStatus?: 'paid' | 'unpaid' | 'not_required';
        paymentRemark?: string | null;
      }>;
    };
  },
  downloadFobReconcileTotal: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/export/reconcile-total`));
    await downloadAttachment(res, '分摊总账.xlsx');
  },
  downloadFobReconcileByMerchant: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/export/reconcile-by-merchant`));
    await downloadAttachment(res, '按工厂主体导出.zip');
  },
  getSalesPlatforms: (station?: string) => {
    const qs = station ? `?station=${encodeURIComponent(station)}` : '';
    return request<Array<{ code: string; name: string; station?: string | null }>>(
      `/api/sales-platforms${qs}`,
    );
  },
  getSalesHistoryCategories: () => request<string[]>('/api/sales/categories'),
  getSalesImportPolicy: () =>
    request<{
      mode: 'full_init' | 'incremental';
      importMinSaleDate: string | null;
      recommendedIncrementalDate: string;
      dailyRetentionDays: number;
      isProduction: boolean;
    }>('/api/sales/import-policy'),
  searchSalesHistoryCategories: (q?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set('q', q.trim());
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<string[]>(`/api/sales/categories${query ? `?${query}` : ''}`);
  },
  getSalesHistoryMonthly: (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.category) qs.set('category', params.category);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        category?: string | null;
        saleYear: number;
        month: number;
        saleMonth: string;
        qtySold: number;
        channel: string;
        source: string;
      }>;
      summary: { totalQty: number; rowCount: number };
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales/history/monthly${query ? `?${query}` : ''}`);
  },
  getSalesAnalyticsStatus: () =>
    request<{
      running: boolean;
      generatedAt: string | null;
      meta: SalesAnalyticsCubePayload['meta'] | null;
      errorMessage: string | null;
    }>('/api/sales-analytics/status'),
  getSalesAnalyticsCube: () => request<SalesAnalyticsCubePayload>('/api/sales-analytics/cube'),
  rebuildSalesAnalyticsCube: () =>
    request<{ ok: true }>('/api/sales-analytics/rebuild', { method: 'POST' }),
  getSalesForecastStations: () => request<string[]>('/api/sales-forecast/stations'),
  getSalesForecastCategories: (q?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set('q', q.trim());
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<string[]>(`/api/sales-forecast/categories${query ? `?${query}` : ''}`);
  },
  getSalesForecastProjectGroups: (q?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set('q', q.trim());
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<string[]>(`/api/sales-forecast/project-groups${query ? `?${query}` : ''}`);
  },
  generateSalesForecastBaseline: async (body: {
    station?: string;
    platform?: string;
    projectGroup?: string;
    skuCode?: string;
    versionName?: string;
    targetVersionId?: string;
    monthCount?: number;
    startMonth?: string;
    background?: boolean;
  }) => {
    const url = apiUrl('/api/sales-forecasts/generate-baseline');
    const res = await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = res.statusText;
      try {
        const err = JSON.parse(text) as { message?: string };
        message = err.message ?? message;
      } catch {
        if (text) message = text.slice(0, 200);
      }
      throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { ...data, async: res.status === 202 } as
      | {
          async: true;
          taskRunId: string;
          status: 'running';
          activeSkuCount: number;
          monthCount: number;
          estimatedForecastRows: number;
          maxForecastRows: number;
          platformCount?: number;
        }
      | {
          async: false;
          version: {
            id: string;
            versionNo: string;
            versionName: string;
            station?: string | null;
            status: string;
          };
          forecastRows: number;
          reviewRows: number;
          platformsGenerated?: string[];
          eligibilityStats?: {
            eligible: number;
            skipped: number;
            byTier: { core: number; mid: number; tail: number };
          };
        };
  },
  getSalesForecastBaselineTask: (taskRunId: string) =>
    request<{
      taskRunId: string;
      status: 'running' | 'success' | 'failed';
      startedAt: string;
      finishedAt: string | null;
      errorMessage: string | null;
      result: {
        version: {
          id: string;
          versionNo: string;
          versionName: string;
          station?: string | null;
          status: string;
        };
        forecastRows: number;
        reviewRows: number;
        platformsGenerated?: string[];
        eligibilityStats?: {
          eligible: number;
          skipped: number;
          byTier: { core: number; mid: number; tail: number };
        };
      } | null;
    }>(`/api/sales-forecasts/generate-baseline/tasks/${encodeURIComponent(taskRunId)}`),
  runDifySingleSkuForecast: (body: {
    skuCode: string;
    station: string;
    platform?: string;
    versionId?: string;
    monthCount?: number;
    assistMode?: 'auto' | 'human';
    exogenousFactors?: {
      factors: Array<{
        monthLabel: string;
        reason: 'price_change' | 'ad' | 'promo' | 'listing_change' | 'other';
        intensity?: number;
        note?: string;
      }>;
      operatorNote?: string;
    };
  }) =>
    request<{
      skuCode: string;
      skuName: string;
      tier: string;
      difyEnabled: boolean;
      rationale: string;
      monthlyForecasts: Array<{
        monthLabel: string;
        forecastYear: number;
        month: number;
        forecastDailyAvg: number;
        confidence?: string;
        rationale?: string;
      }>;
      writtenRows: number;
      missingMonths?: string[];
      versionId: string;
    }>('/api/sales-forecasts/dify/single', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastReviewItems: (params?: {
    versionId?: string;
    status?: 'pending' | 'reviewed' | 'ignored';
    severity?: 'critical' | 'warning' | 'info';
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.status) qs.set('status', params.status);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      groupBy: 'sku_platform';
      items: ForecastReviewItemGroup[];
      total: number;
      page: number;
      pageSize: number;
      versionSummary: ForecastVersionSummary | null;
      contexts: Record<string, SkuForecastContext>;
      monthlyForecasts: Record<string, SkuMonthlyForecastCell[]>;
    }>(
      `/api/sales-forecasts/review-items${query ? `?${query}` : ''}`,
    );
  },
  batchUpdateSalesForecastReviewItems: (body: {
    ids: string[];
    status: 'pending' | 'reviewed' | 'ignored';
  }) =>
    request<{ updated: number }>('/api/sales-forecasts/review-items/batch-status', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSalesForecastReviewItem: (
    id: string,
    body: { status?: 'pending' | 'reviewed' | 'ignored' },
  ) =>
    request<ForecastReviewItem>(`/api/sales-forecasts/review-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getSalesForecastReviewStats: (versionId?: string) => {
    const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
    return request<{
      totalRecords: number;
      total: number;
      pending: number;
      pendingSkuCount: number;
      reviewed: number;
      ignored: number;
      pendingBySeverity: { critical: number; warning: number; info: number };
    }>(`/api/sales-forecasts/review-items/stats${qs}`);
  },
  getSalesForecastVersionSummary: (versionId: string) =>
    request<ForecastVersionSummary>(
      `/api/sales-forecasts/version-summary?versionId=${encodeURIComponent(versionId)}`,
    ),
  getSalesForecastSkuDetail: (params: {
    versionId: string;
    skuId?: string;
    skuCode?: string;
    station: string;
    platform: string;
    months?: string[];
  }) => {
    const qs = new URLSearchParams({
      versionId: params.versionId,
      station: params.station,
      platform: params.platform,
    });
    if (params.skuId) qs.set('skuId', params.skuId);
    if (params.skuCode) qs.set('skuCode', params.skuCode);
    if (params.months?.length) qs.set('months', params.months.join(','));
    return request<{
      versionSummary: ForecastVersionSummary;
      context: SkuForecastContext | null;
      reviewItems: ForecastReviewItem[];
      actualByMonth: Array<{
        monthLabel: string;
        actualDailyAvg: number | null;
        inProgress: boolean;
      }>;
      sku: {
        id: string;
        code: string;
        name: string;
        category: string | null;
        productCategory: string | null;
        lifecycle: string | null;
        salesCountry: string | null;
        ownerName: string | null;
        developerName: string | null;
        merchantCode: string | null;
        merchantName: string | null;
        specAttrs: Record<string, string> | null;
        unit: string;
        leadTimeDays: number | null;
        moq: number | null;
      };
    }>(`/api/sales-forecasts/sku-detail?${qs}`);
  },
  clearSalesForecastReviewItems: (body: {
    versionId?: string;
    scope: 'all' | 'version' | 'completed';
    confirmAll?: boolean;
  }) =>
    request<{ deleted: number }>('/api/sales-forecasts/review-items/clear', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  batchSalesForecastReviewItems: (body: {
    versionId: string;
    action: 'accept_suggested' | 'ignore_info' | 'ignore_all_pending';
  }) =>
    request<{ updated: number; skipped: number }>('/api/sales-forecasts/review-items/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastTrends: (params?: {
    dimensionType?: 'category' | 'project_group';
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.dimensionType) qs.set('dimensionType', params.dimensionType);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        dimensionType: 'category' | 'project_group';
        dimensionValue: string;
        month: number;
        seasonalityFactor: number;
        trendFactor: number | null;
        sourceBatchId?: string | null;
        updatedAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts/trends${query ? `?${query}` : ''}`);
  },
  rebuildSalesForecastTrends: () =>
    request<{ factorCount: number; sourceMonthCount: number }>('/api/sales-forecasts/trends/rebuild', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getSalesForecastTrendsHorizon: (params?: {
    dimensionType?: 'category' | 'project_group';
    search?: string;
    page?: number;
    pageSize?: number;
    monthCount?: number;
    historyMonthCount?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.dimensionType) qs.set('dimensionType', params.dimensionType);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.monthCount) qs.set('monthCount', String(params.monthCount));
    if (params?.historyMonthCount != null) qs.set('historyMonthCount', String(params.historyMonthCount));
    const query = qs.toString();
    type HorizonCell = {
      forecastYear: number;
      month: number;
      monthLabel: string;
      calendarMonth: number;
      seasonalityFactor: number;
      trendFactor: number;
      combinedFactor: number;
      wasClipped: boolean;
    };
    return request<{
      horizon: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        calendarMonth: number;
      }>;
      historyHorizon: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        calendarMonth: number;
      }>;
      items: Array<{
        dimensionType: 'category' | 'project_group';
        dimensionValue: string;
        months: HorizonCell[];
        historyMonths: HorizonCell[];
      }>;
      total: number;
      page: number;
      pageSize: number;
      sourceBatch: {
        id: string;
        batchNo: string;
        monthlyStartMonth: string | null;
        monthlyEndMonth: string | null;
        skuCount: number | null;
        rowCount: number | null;
        createdAt: string;
      } | null;
    }>(`/api/sales-forecasts/trends/horizon${query ? `?${query}` : ''}`);
  },
  getSalesForecastHorizon: (params?: {
    versionId?: string;
    station?: string;
    platform?: string;
    skuId?: string;
    skuCode?: string;
    category?: string;
    profileSegment?: string;
    pendingCalibration?: boolean;
    page?: number;
    pageSize?: number;
    monthCount?: number;
    historyMonthCount?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform != null && params.platform !== '') qs.set('platform', params.platform);
    if (params?.skuId) qs.set('skuId', params.skuId);
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.category) qs.set('category', params.category);
    if (params?.profileSegment) qs.set('profileSegment', params.profileSegment);
    if (params?.pendingCalibration) qs.set('pendingCalibration', 'true');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.monthCount != null) qs.set('monthCount', String(params.monthCount));
    if (params?.historyMonthCount != null) qs.set('historyMonthCount', String(params.historyMonthCount));
    const query = qs.toString();
    return request<{
      horizon: Array<{ forecastYear: number; month: number; monthLabel: string }>;
      historyHorizon: Array<{ forecastYear: number; month: number; monthLabel: string }>;
      items: Array<{
        skuId: string;
        skuCode: string;
        skuName: string;
        category: string | null;
        station: string;
        platform: string;
        lifecycle: string | null;
        forecastProfileClass?: string | null;
        profileSegment?: string | null;
        historyMonths: Array<{
          forecastYear: number;
          month: number;
          monthLabel: string;
          qtySold: number;
          actualDailyAvg: number;
        }>;
        months: Array<{
          id: string;
          forecastYear: number;
          month: number;
          monthLabel: string;
          forecastDailyAvg: number;
          manualDailyAvg: number | null;
          effectiveDailyAvg: number;
          adjustReason: string | null;
          baselineDailyAvg: number | null;
          lifecycle: string | null;
          confidenceLevel: string | null;
          skuTrendFactor: number | null;
          seasonalityFactor: number;
          trendFactor: number;
          categoryCombinedFactor: number;
          categoryTrendWasClipped: boolean;
          categoryTrendMatched: boolean;
          horizonFactors: {
            nearLevel: number;
            structuralLevel: number;
            yoyMonthLevel: number;
            yoyAnchorLevel: number;
            growthFactor: number;
            wNear: number;
            wYoy: number;
            horizonMonthIndex: number;
          } | null;
        }>;
      }>;
      total: number;
      page: number;
      pageSize: number;
      version: {
        id: string;
        versionName: string;
        status: string;
        station: string | null;
      } | null;
    }>(`/api/sales-forecasts/horizon${query ? `?${query}` : ''}`);
  },
  exportSalesForecastHorizon: async (params: {
    versionId: string;
    mode: 'wide' | 'detail';
    station?: string;
    platform?: string;
    skuCode?: string;
    category?: string;
    profileSegment?: string;
    pendingCalibration?: boolean;
    monthCount?: number;
    historyMonthCount?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('versionId', params.versionId);
    qs.set('mode', params.mode);
    if (params.station) qs.set('station', params.station);
    if (params.platform != null && params.platform !== '') qs.set('platform', params.platform);
    if (params.skuCode) qs.set('skuCode', params.skuCode);
    if (params.category) qs.set('category', params.category);
    if (params.profileSegment) qs.set('profileSegment', params.profileSegment);
    if (params.pendingCalibration) qs.set('pendingCalibration', 'true');
    if (params.monthCount != null) qs.set('monthCount', String(params.monthCount));
    if (params.historyMonthCount != null) qs.set('historyMonthCount', String(params.historyMonthCount));
    const res = await apiFetch(apiUrl(`/api/sales-forecasts/horizon/export?${qs}`));
    await downloadAttachment(
      res,
      params.mode === 'detail' ? 'forecast-horizon-detail.csv' : 'forecast-horizon-wide.csv',
    );
  },
  resetAllSalesForecastData: () =>
    request<{
      deleted: {
        forecastMonthly: number;
        forecastAccuracy: number;
        reviewItems: number;
        seasonality: number;
        sourceBatches: number;
        versions: number;
      };
    }>('/api/sales-forecasts/reset-all', {
      method: 'POST',
      body: JSON.stringify({ confirmAll: true }),
    }),
  getSalesForecastVersions: (params?: {
    status?: 'draft' | 'published' | 'archived';
    includeStats?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.includeStats) qs.set('includeStats', '1');
    const query = qs.toString();
    if (params?.includeStats) {
      return request<ForecastVersionListItem[]>(
        `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
      );
    }
    return request<ForecastVersionBasic[]>(
      `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
    );
  },
  getSalesForecastVersion: (id: string) =>
    request<ForecastVersionListItem>(`/api/sales-forecast-versions/${id}`),
  getSalesForecastVersionQtyTotals: (id: string) =>
    request<ForecastQtyTotalsResult>(`/api/sales-forecast-versions/${id}/qty-totals`),
  deleteSalesForecastVersion: (id: string) =>
    request<{
      id: string;
      versionNo: string;
      deleted: {
        forecastMonthly: number;
        forecastAccuracy: number;
        reviewItems: number;
      };
    }>(`/api/sales-forecast-versions/${id}`, { method: 'DELETE' }),
  createSalesForecastVersion: (body?: { versionName?: string; station?: string }) =>
    request<{
      id: string;
      versionNo: string;
      versionName: string;
      status: string;
    }>('/api/sales-forecast-versions', { method: 'POST', body: JSON.stringify(body ?? {}) }),
  validateSalesForecastVersion: (id: string) =>
    request<{
      issues: Array<{
        level: 'error' | 'warning' | 'info';
        code: string;
        message: string;
        skuCode?: string;
        forecastMonth?: string;
      }>;
      canPublish: boolean;
      rowCount: number;
    }>(`/api/sales-forecast-versions/${id}/validate`),
  publishSalesForecastVersion: async (id: string) => {
    const url = apiUrl(`/api/sales-forecast-versions/${id}/publish`);
    let res: Response;
    try {
      res = await apiFetch(url, { method: 'POST' });
    } catch (err) {
      const hint =
        typeof window !== 'undefined' && window.location.hostname === 'localhost'
          ? '（Windows Docker 请改用 http://127.0.0.1:8081 访问，localhost 可能走 IPv6 导致请求失败）'
          : '';
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${msg}${hint}`);
    }
    if (!res.ok) {
      const text = await res.text();
      type PublishError = {
        message?: string;
        issues?: Array<{ level: string; code: string; message: string }>;
      };
      let payload: PublishError = {};
      try {
        payload = JSON.parse(text) as PublishError;
      } catch {
        if (text) throw new Error(text.slice(0, 200));
      }
      const blocking = payload.issues?.filter((issue) => issue.level === 'error') ?? [];
      if (blocking.length > 0) {
        throw new Error(blocking.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
      }
      const message = payload.message ?? res.statusText;
      throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ version: unknown; issues: unknown[] }>;
  },
  getSalesForecastReviewSummary: (id: string) =>
    request<{ summary: string; issues: unknown[] }>(
      `/api/sales-forecast-versions/${id}/review-summary`,
    ),
  getSalesForecastImpactPreview: (id: string) =>
    request<{
      versionId: string;
      versionName: string;
      station: string | null;
      skuCount: number;
      forecastRowCount: number;
      lowConfidenceCount: number;
      redSkuCount: number;
      yellowSkuCount: number;
      summary: string;
    }>(`/api/sales-forecast-versions/${id}/impact-preview`),
  getSalesForecasts: (params?: {
    skuCode?: string;
    station?: string;
    platform?: string;
    versionId?: string;
    forecastMonth?: string;
    year?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.forecastMonth) qs.set('forecastMonth', params.forecastMonth);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuCode: string;
        skuName: string;
        station: string;
        platform: string;
        forecastMonth: string;
        forecastYear: number;
        month: number;
        forecastDailyAvg: number;
        baselineDailyAvg?: number | null;
        manualDailyAvg?: number | null;
        adjustReason?: string | null;
        confidenceLevel?: string | null;
        ownerName?: string | null;
        versionId?: string | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts${query ? `?${query}` : ''}`);
  },
  updateSalesForecast: (
    id: string,
    body: {
      forecastDailyAvg?: number;
      baselineDailyAvg?: number;
      manualDailyAvg?: number | null;
      clearManual?: boolean;
      lifecycle?: string;
      ownerName?: string;
      platform?: string;
      adjustReason?: string | null;
      confidenceLevel?: 'high' | 'medium' | 'low';
    },
  ) =>
    request<{
      id: string;
      skuCode: string;
      skuName: string;
      station: string;
      platform: string;
      forecastMonth: string;
      forecastYear: number;
      month: number;
      forecastDailyAvg: number;
      manualDailyAvg?: number | null;
      effectiveDailyAvg: number;
      baselineDailyAvg?: number | null;
      adjustReason?: string | null;
      confidenceLevel?: string | null;
      lifecycle?: string | null;
      ownerName?: string | null;
      versionId?: string | null;
    }>(`/api/sales-forecasts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getSalesForecastAccuracyDiagnostics: (params?: {
    versionId?: string;
    versionName?: string;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    asOf?: string;
    limitTopErrors?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.versionName) qs.set('versionName', params.versionName);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.startMonth) qs.set('startMonth', params.startMonth);
    if (params?.endMonth) qs.set('endMonth', params.endMonth);
    if (params?.asOf) qs.set('asOf', params.asOf);
    if (params?.limitTopErrors != null) qs.set('limitTopErrors', String(params.limitTopErrors));
    const query = qs.toString();
    return request<ForecastAccuracyDiagnostics>(
      `/api/sales-forecasts/accuracy/diagnostics${query ? `?${query}` : ''}`,
    );
  },
  createSalesForecastAccuracyReviewQueue: (body: {
    sourceVersionId?: string;
    sourceVersionName?: string;
    targetVersionId: string;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    limit?: number;
    minWmape?: number;
  }) =>
    request<ForecastAccuracyReviewQueueResult>('/api/sales-forecasts/accuracy/review-queue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastAccuracy: (params?: {
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
    versionId?: string;
    page?: number;
    pageSize?: number;
    rowKind?: 'predicted' | 'miss';
  }) => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.rowKind === 'miss') qs.set('rowKind', 'miss');
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuCode: string;
        projectGroup: string | null;
        station: string;
        platform: string;
        forecastMonth: string;
        forecastDailyAvg: number;
        actualDailyAvg: number;
        biasRate: number | null;
        biasVsActual: number | null;
        mape: number | null;
        profileSegment: string | null;
        profileSegmentLabel: string | null;
        isZeroForecastMiss?: boolean;
      }>;
      summary: string;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts/accuracy${query ? `?${query}` : ''}`);
  },
  exportSalesForecastAccuracy: async (params?: {
    versionId?: string;
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
    groupBy?: 'sku' | 'month';
    rowKind?: 'predicted' | 'miss';
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.groupBy === 'sku') qs.set('groupBy', 'sku');
    if (params?.rowKind === 'miss') qs.set('rowKind', 'miss');
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales-forecasts/accuracy/export${query ? `?${query}` : ''}`));
    const fallback =
      params?.groupBy === 'sku'
        ? params?.rowKind === 'miss'
          ? 'forecast-accuracy-miss-sku-summary.csv'
          : 'forecast-accuracy-sku-summary.csv'
        : params?.rowKind === 'miss'
          ? 'forecast-accuracy-miss.csv'
          : 'forecast-accuracy.csv';
    await downloadAttachment(res, fallback);
  },
  getSalesForecastAccuracySummary: (params?: {
    versionId?: string;
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    const query = qs.toString();
    return request<{
      global: {
        tier: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      };
      byTier: Array<{
        tier: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      }>;
      byCategory: Array<{
        category: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      }>;
      byHorizonBand?: Array<{
        band: string;
        label: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        ghostRowCount: number;
      }>;
      byProfileClass?: Array<{
        profileClass: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
      }>;
      bySegment?: Array<{
        segment: string;
        segmentLabel: string;
        parentClass: string;
        measurable: boolean;
        bands: Record<
          string,
          {
            skuCount: number;
            comparableRows: number;
            wmape: number | null;
            weightedBias: number | null;
            kpiTarget: number | null;
            kpiStatus: string;
            ghostRowCount: number;
          }
        >;
      }>;
      matrix?: {
        cells: Array<{
          segment: string;
          segmentLabel: string;
          band: HorizonBand;
          bandLabel: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          kpiTarget: number | null;
          kpiTargetLabel: string;
          kpiStatus: 'pass' | 'warn' | 'fail' | 'na' | 'display_only';
          ghostRowCount: number;
          intervalCoverage: number | null;
        }>;
      };
    }>(`/api/sales-forecasts/accuracy/summary${query ? `?${query}` : ''}`);
  },
  aggregateSalesHistoryMonthly: (body?: { lookbackMonths?: number }) =>
    request<{
      aggregate: { upsertedRows: number; lookbackMonths: number; cutoffDate: string };
      coverage: {
        rowCount: number;
        skuCount: number;
        startMonth: string | null;
        endMonth: string | null;
      };
    }>('/api/sales-forecasts/monthly-sales/aggregate', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  backtestSalesForecastAccuracy: (body?: {
    monthCount?: number;
    versionId?: string;
    createReviewItems?: boolean;
  }) =>
    request<{
      monthCount: number;
      monthResults: Array<{
        year: number;
        month: number;
        upserted: number;
        highMapeCount: number;
        skipped?: boolean;
      }>;
      totalUpserted: number;
      totalHighMapeCount: number;
      summary: string;
    }>('/api/sales-forecasts/accuracy/backtest', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  walkForwardSalesForecastAccuracy: (body?: {
    asOf?: string;
    monthCount?: number;
    station?: string;
    platform?: string;
    skuCode?: string;
    versionName?: string;
    createReviewItems?: boolean;
    exportCsvPath?: string;
    tierFilter?: 'core' | 'mid' | 'tail' | 'all';
  }) =>
    request<{
      asOf: string;
      monthCount: number;
      version: { id: string; versionName: string; status: string };
      forecastRows: number;
      reviewRows: number;
      eligibilityStats?: {
        eligible: number;
        skipped: number;
        byTier: { core: number; mid: number; tail: number };
      };
      targetMonthLabels: string[];
      monthResults: Array<{
        year: number;
        month: number;
        monthLabel: string;
        upserted: number;
        highMapeCount: number;
        skipped?: boolean;
        avgMape: number | null;
        avgBiasRate: number | null;
        comparableRows: number;
      }>;
      totalUpserted: number;
      totalHighMapeCount: number;
      csvPath: string;
      csvRows: number;
      tierSummary?: {
        global: {
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        };
        byTier: Array<{
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
        byCategory: Array<{
          category: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
      };
      segmentSummary?: {
        global: {
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        };
        byTier: Array<{
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
        matrix?: {
          cells: Array<{
            segment: string;
            segmentLabel: string;
            band: HorizonBand;
            bandLabel: string;
            skuCount: number;
            comparableRows: number;
            wmape: number | null;
            weightedBias: number | null;
            kpiTarget: number | null;
            kpiTargetLabel: string;
            kpiStatus: 'pass' | 'warn' | 'fail' | 'na' | 'display_only';
            ghostRowCount: number;
            intervalCoverage: number | null;
          }>;
        };
      };
      accuracyList?: {
        items: Array<{
          id: string;
          skuCode: string;
          projectGroup: string | null;
          station: string;
          platform: string;
          forecastMonth: string;
          forecastDailyAvg: number;
          actualDailyAvg: number;
          biasRate: number | null;
          biasVsActual: number | null;
          mape: number | null;
          profileSegment: string | null;
          profileSegmentLabel: string | null;
          isZeroForecastMiss?: boolean;
        }>;
        total: number;
        page: number;
        pageSize: number;
      };
      monthTierSummary?: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        profileSegment: string;
        profileSegmentLabel: string;
        comparableRows: number;
        mape: number | null;
        wmape: number | null;
      }>;
      summary: string;
    }>('/api/sales-forecasts/accuracy/walkforward', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  listDemandPlanVersions: (params?: { page?: number; pageSize?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return request<
      PaginatedResult<{
        id: string;
        versionNo: string;
        versionName: string;
        status: string;
        projectGroup: string;
        warehouseCode: string;
        startMonth?: string;
        startWeek?: string | null;
        horizonWeeks?: number | null;
        publishedAt?: string | null;
        createdAt?: string;
      }>
    >(`/api/demand-plans${query ? `?${query}` : ''}`);
  },
  listDemandPlanProjectGroups: () =>
    request<{ items: string[]; horizonWeeks: number }>('/api/demand-plans/project-groups'),
  resolveDemandPlanSkuForecastVersion: (skuId: string) =>
    request<{ versionId: string | null }>(
      `/api/demand-plans/forecast-version-for-sku?skuId=${encodeURIComponent(skuId)}`,
    ),
  getDemandPlanSkuDetail: (versionId: string, skuId: string) =>
    request<DemandPlanSkuDetail>(`/api/demand-plans/${versionId}/sku-detail?skuId=${encodeURIComponent(skuId)}`),
  getDemandPlan: (
    id: string,
    params?: {
      view?: DemandPlanDetailView;
      page?: number;
      pageSize?: number;
      skuCode?: string;
    },
  ) => {
    const search = new URLSearchParams();
    if (params?.view) search.set('view', params.view);
    if (params?.page != null) search.set('page', String(params.page));
    if (params?.pageSize != null) search.set('pageSize', String(params.pageSize));
    if (params?.skuCode) search.set('skuCode', params.skuCode);
    const query = search.toString();
    return request<DemandPlanDetail>(`/api/demand-plans/${id}${query ? `?${query}` : ''}`);
  },
  generateDemandPlan: (body?: { projectGroup?: string; versionName?: string }) =>
    request<{
      version: DemandPlanVersionListItem;
      skipped: Array<{ skuId: string; skuCode: string; reason: string }>;
    }>('/api/demand-plans/generate', { method: 'POST', body: JSON.stringify(body) }),
  publishDemandPlan: (id: string, body?: { adopt?: boolean }) =>
    request<{ version: DemandPlanVersionListItem; adoption: DemandPlanAdoption | null }>(
      `/api/demand-plans/${id}/publish`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),
  adoptDemandPlan: (id: string) =>
    request<DemandPlanAdoption>(`/api/demand-plans/${id}/adopt`, { method: 'POST' }),
  adoptForecast: (body: { projectGroup: string; warehouseCode?: string }) =>
    request<DemandPlanAdoption>('/api/demand-plans/adopt-forecast', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  archiveDemandPlan: (id: string) =>
    request<DemandPlanVersionListItem>(`/api/demand-plans/${id}/archive`, { method: 'POST' }),
  updateDemandPlanWeek: (
    versionId: string,
    weekId: string,
    body: { manualDailyAvg: number | null; adjustReason: string },
  ) =>
    request(`/api/demand-plans/${versionId}/weeks/${weekId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateDemandPlanMonth: (
    versionId: string,
    monthId: string,
    body: { manualDailyAvg: number | null; adjustReason: string },
  ) =>
    request(`/api/demand-plans/${versionId}/months/${monthId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

async function downloadAttachment(res: Response, fallbackName: string) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? '下载失败');
  }
  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error('导出文件为空，请重试或检查筛选条件');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = utf8Match
    ? decodeURIComponent(utf8Match[1])
    : plainMatch
      ? plainMatch[1]
      : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟 revoke，避免部分浏览器在下载开始前打断
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}


