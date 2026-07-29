import {
  SAP_SOURCE_SYSTEM,
  type SapPoMirrorMapped,
  type SapPurchaseOrderInput,
} from './types.js';

function optionalTrim(value: string | undefined): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

export function mapSapPurchaseOrderToMirror(item: SapPurchaseOrderInput): SapPoMirrorMapped {
  const poId = String(item.poId ?? '').trim();
  const vendorId = String(item.vendorId ?? '').trim();
  if (!poId) throw new Error('poId is required');
  if (!vendorId) throw new Error('vendorId is required');
  if (!Array.isArray(item.lines) || item.lines.length === 0) {
    throw new Error('lines must be a non-empty array');
  }

  const lines = item.lines.map((line, index) => {
    const lineId = String(line.lineId ?? '').trim();
    const materialId = String(line.materialId ?? '').trim();
    if (!lineId) throw new Error(`lines[${index}].lineId is required`);
    if (!materialId) throw new Error(`lines[${index}].materialId is required`);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty)) throw new Error(`lines[${index}].qty must be a number`);

    return {
      externalLineId: lineId,
      skuExternalId: materialId,
      qty: Math.trunc(qty),
      uom: optionalTrim(line.uom),
      deliveryDate: optionalTrim(line.deliveryDate),
      payload: { ...line } as Record<string, unknown>,
    };
  });

  return {
    head: {
      sourceSystem: SAP_SOURCE_SYSTEM,
      externalId: poId,
      externalVersion: optionalTrim(item.version),
      poNumber: optionalTrim(item.poNumber) ?? poId,
      vendorExternalId: vendorId,
      merchantCode: optionalTrim(item.merchantCode),
      orderDate: optionalTrim(item.orderDate),
      statusRaw: optionalTrim(item.status),
      payload: { ...item } as Record<string, unknown>,
    },
    lines,
  };
}
