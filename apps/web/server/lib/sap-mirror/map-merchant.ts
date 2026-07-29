import { SAP_SOURCE_SYSTEM, type SapMerchantMapped, type SapVendorInput } from './types.js';

export function mapSapVendorToMerchant(item: SapVendorInput): SapMerchantMapped {
  const vendorId = String(item.vendorId ?? '').trim();
  const name = String(item.name ?? '').trim();
  if (!vendorId) throw new Error('vendorId is required');
  if (!name) throw new Error('name is required');

  const code = String(item.code ?? vendorId).trim() || vendorId;

  return {
    sourceSystem: SAP_SOURCE_SYSTEM,
    externalId: vendorId,
    code,
    name,
  };
}
