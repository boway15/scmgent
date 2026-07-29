import type { SapMirrorEntityType } from '@scm/db';

export type { SapMirrorEntityType };

export const SAP_SOURCE_SYSTEM = 'sap' as const;
export type SapSourceSystem = typeof SAP_SOURCE_SYSTEM;

export interface SapMirrorTransport {
  fetchBatch(
    entityType: SapMirrorEntityType,
    cursor?: string,
  ): Promise<{
    items: unknown[];
    nextCursor?: string;
  }>;
}

export interface SapMirrorIngestResult {
  runId: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ externalId?: string; message: string }>;
}

/** JSON fixture: entity type → raw SAP-shaped rows */
export type SapMirrorFixture = Partial<Record<SapMirrorEntityType, unknown[]>>;

export type SapVendorInput = {
  vendorId: string;
  name: string;
  code?: string;
};

export type SapMerchantMapped = {
  sourceSystem: SapSourceSystem;
  externalId: string;
  code: string;
  name: string;
};

export type SapMaterialInput = {
  materialId: string;
  name: string;
  unit?: string;
};

export type SapSkuMapped = {
  sourceSystem: SapSourceSystem;
  externalId: string;
  code: string;
  name: string;
  unit: string;
};

export type SapPurchaseOrderLineInput = {
  lineId: string;
  materialId: string;
  qty: number;
  uom?: string;
  deliveryDate?: string;
};

export type SapPurchaseOrderInput = {
  poId: string;
  poNumber?: string;
  vendorId: string;
  merchantCode?: string;
  orderDate?: string;
  status?: string;
  version?: string;
  lines: SapPurchaseOrderLineInput[];
};

export type SapPoMirrorLineMapped = {
  externalLineId: string;
  skuExternalId: string;
  qty: number;
  uom?: string;
  deliveryDate?: string;
  payload: Record<string, unknown>;
};

export type SapPoMirrorMapped = {
  head: {
    sourceSystem: SapSourceSystem;
    externalId: string;
    externalVersion?: string;
    poNumber?: string;
    vendorExternalId: string;
    merchantCode?: string;
    orderDate?: string;
    statusRaw?: string;
    payload: Record<string, unknown>;
  };
  lines: SapPoMirrorLineMapped[];
};
