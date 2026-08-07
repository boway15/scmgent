export type BomConfidence = 'high' | 'medium' | 'low';

export type CostingBomLineDraft = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyNet: number;
  lossRate: number;
  sourceRef: string;
  confidence: BomConfidence;
  notes: string;
};
