/** 可写入站点/仓映射的区域码（来自业务映射表，含 MX/BR） */
export const MAPPABLE_REGIONS = ['US', 'CA', 'EU', 'UK', 'MX', 'BR', 'OTHER'] as const;
export const RUNTIME_REGIONS = [...MAPPABLE_REGIONS, 'UNMAPPED'] as const;
export type MappableRegion = (typeof MAPPABLE_REGIONS)[number];
export type RuntimeRegion = (typeof RUNTIME_REGIONS)[number];

export function isMappableRegion(code: string): code is MappableRegion {
  return (MAPPABLE_REGIONS as readonly string[]).includes(code.trim().toUpperCase());
}

export function parseMappableRegion(raw: string): MappableRegion | null {
  const code = raw.trim().toUpperCase();
  return isMappableRegion(code) ? (code as MappableRegion) : null;
}
