export type BomConfidence = 'high' | 'medium' | 'low';
export type BomOrigin = 'explicit' | 'template';
import type { MatchScope } from './costing-scope.js';

export type { MatchScope };
export type MatchStatus = 'exact' | 'name_only' | 'unmatched';
export type PageKind =
  | 'bom_list'
  | 'cmf'
  | 'size'
  | 'explosion'
  | 'notes'
  | 'cover'
  | 'render'
  | 'unknown';

export type CostingBomLineDraft = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyNet: number;
  lossRate: number;
  sourceRef: string;
  confidence: BomConfidence;
  origin: BomOrigin;
  notes: string;
  substrate?: string | null;
  processOverrides?: import('./board-sheet.js').ProcessOverrides;
};

export type PriceBookEntry = {
  id: string;
  materialName: string;
  spec: string;
  unit: string;
  unitPrice?: number;
  regionId?: string | null;
  factoryId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type CostLineInput = {
  lineId?: string;
  qtyNet: number;
  lossRate: number;
  unitPriceOverride: number | null;
  bookUnitPrice: number | null;
  bookUnit?: string | null;
  pricePerM2?: number | null;
  category: string;
  materialName?: string;
  spec?: string;
  unit?: string;
  defaultSubstrate?: string | null;
  processOverrides?: import('./board-sheet.js').ProcessOverrides;
};

export type CostFeeItem = {
  name: string;
  rate: number;
  amount: number;
  scope: MatchScope;
};

export type CostSummary = {
  materialAmount: number;
  processAmount: number;
  feeAmount: number;
  totalAmount: number;
  byCategory: Array<{ category: string; amount: number; share: number }>;
  feeItems: CostFeeItem[];
  missingPriceCount: number;
  missingQtyCount: number;
  lines: Array<{
    qtyGross: number;
    effectiveUnitPrice: number | null;
    lineAmount: number;
    usageAreaM2?: number | null;
  }>;
  boardSheet?: import('./board-sheet.js').BoardSheetRow[];
};
