export type PackProfile = {
  cornerAllowanceMm?: number;
  foamThicknessMm?: number;
  foamYuanPerM3?: number;
  cartonYuanPerM2?: number;
  cornerYuanEach?: number;
};

export const DEFAULT_PACK_PROFILE: Required<PackProfile> = {
  cornerAllowanceMm: 80,
  foamThicknessMm: 20,
  foamYuanPerM3: 280,
  cartonYuanPerM2: 4.9,
  cornerYuanEach: 0.5,
};

export function mergePackProfile(raw: unknown): Required<PackProfile> {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PackProfile) : {};
  return {
    cornerAllowanceMm:
      typeof value.cornerAllowanceMm === 'number' && value.cornerAllowanceMm >= 0
        ? value.cornerAllowanceMm
        : DEFAULT_PACK_PROFILE.cornerAllowanceMm,
    foamThicknessMm:
      typeof value.foamThicknessMm === 'number' && value.foamThicknessMm >= 0
        ? value.foamThicknessMm
        : DEFAULT_PACK_PROFILE.foamThicknessMm,
    foamYuanPerM3:
      typeof value.foamYuanPerM3 === 'number' && value.foamYuanPerM3 >= 0
        ? value.foamYuanPerM3
        : DEFAULT_PACK_PROFILE.foamYuanPerM3,
    cartonYuanPerM2:
      typeof value.cartonYuanPerM2 === 'number' && value.cartonYuanPerM2 >= 0
        ? value.cartonYuanPerM2
        : DEFAULT_PACK_PROFILE.cartonYuanPerM2,
    cornerYuanEach:
      typeof value.cornerYuanEach === 'number' && value.cornerYuanEach >= 0
        ? value.cornerYuanEach
        : DEFAULT_PACK_PROFILE.cornerYuanEach,
  };
}

export function parsePackProfileInput(raw: unknown): PackProfile | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const profile: PackProfile = {};
  for (const key of [
    'cornerAllowanceMm',
    'foamThicknessMm',
    'foamYuanPerM3',
    'cartonYuanPerM2',
    'cornerYuanEach',
  ] as const) {
    const num = Number(value[key]);
    if (Number.isFinite(num) && num >= 0) profile[key] = num;
  }
  return Object.keys(profile).length ? profile : null;
}
