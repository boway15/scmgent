export type BomConfidence = 'high' | 'medium' | 'low';
export type BomOrigin = 'explicit' | 'template';
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
};

export type PriceBookEntry = {
  id: string;
  materialName: string;
  spec: string;
  unit: string;
};

export type CostLineInput = {
  qtyNet: number;
  lossRate: number;
  unitPriceOverride: number | null;
  bookUnitPrice: number | null;
  category: string;
};

export type CostSummary = {
  totalAmount: number;
  byCategory: Array<{ category: string; amount: number; share: number }>;
  missingPriceCount: number;
  missingQtyCount: number;
  lines: Array<{ qtyGross: number; effectiveUnitPrice: number | null; lineAmount: number }>;
};
