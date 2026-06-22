export type ComplianceStatus = 'complete' | 'partial' | 'missing';

export type ComplianceFields = {
  hsCode?: string | null;
  originCountry?: string | null;
  declaredValue?: string | null;
  weightKg?: string | null;
  lengthCm?: string | null;
  widthCm?: string | null;
  heightCm?: string | null;
  batteryType?: string | null;
  isLiquid?: boolean | null;
};

function hasValue(v: string | null | undefined): boolean {
  return v != null && String(v).trim() !== '';
}

function hasNumeric(v: string | null | undefined): boolean {
  if (v == null || String(v).trim() === '') return false;
  return !Number.isNaN(Number(v));
}

export function deriveComplianceStatus(fields: ComplianceFields | null | undefined): ComplianceStatus {
  if (!fields) return 'missing';

  const hasHs = hasValue(fields.hsCode);
  const hasWeight = hasNumeric(fields.weightKg);
  const hasOrigin = hasValue(fields.originCountry);
  const hasAny =
    hasHs ||
    hasWeight ||
    hasOrigin ||
    hasNumeric(fields.declaredValue) ||
    hasNumeric(fields.lengthCm) ||
    hasNumeric(fields.widthCm) ||
    hasNumeric(fields.heightCm) ||
    hasValue(fields.batteryType) ||
    fields.isLiquid === true;

  if (hasHs && hasWeight && hasOrigin) return 'complete';
  if (hasAny) return 'partial';
  return 'missing';
}

export const COMPLIANCE_STATUS_LABEL: Record<ComplianceStatus, string> = {
  complete: '完整',
  partial: '部分缺失',
  missing: '未维护',
};

export function parseBoolField(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === '是';
}
