import { SAP_SOURCE_SYSTEM, type SapMaterialInput, type SapSkuMapped } from './types.js';

const DEFAULT_UNIT = 'EA';

export function mapSapMaterialToSku(item: SapMaterialInput): SapSkuMapped {
  const materialId = String(item.materialId ?? '').trim();
  const name = String(item.name ?? '').trim();
  if (!materialId) throw new Error('materialId is required');
  if (!name) throw new Error('name is required');

  const unit = String(item.unit ?? DEFAULT_UNIT).trim() || DEFAULT_UNIT;

  return {
    sourceSystem: SAP_SOURCE_SYSTEM,
    externalId: materialId,
    code: materialId,
    name,
    unit,
  };
}
