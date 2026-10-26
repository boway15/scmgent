type BaseSpec = { label: string; help?: string };
export type IntSpec = BaseSpec & { kind: 'int'; unit?: string; default: number; min: number; max: number };
export type NumberSpec = BaseSpec & { kind: 'number'; unit?: string; default: number; min: number; max: number };
export type BooleanSpec = BaseSpec & { kind: 'boolean'; default: boolean };
export type EnumSpec = BaseSpec & {
  kind: 'enum';
  default: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};
export type ParamSpec = IntSpec | NumberSpec | BooleanSpec | EnumSpec;
export type ParamSchema = Record<string, ParamSpec>;

type ValueOf<P extends ParamSpec> = P extends BooleanSpec ? boolean : P extends EnumSpec ? string : number;
export type ParamValues<S extends ParamSchema> = { [K in keyof S]: ValueOf<S[K]> };
export type ParamScalar = number | boolean | string;

export function defaultsOf<S extends ParamSchema>(schema: S): ParamValues<S> {
  const out: Record<string, ParamScalar> = {};
  for (const [key, spec] of Object.entries(schema)) out[key] = spec.default;
  return out as ParamValues<S>;
}

/** 单值校验；通过返回 null，否则返回中文错误。 */
export function checkParamValue(key: string, spec: ParamSpec, value: unknown): string | null {
  switch (spec.kind) {
    case 'int':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${spec.label}（${key}）须为数字`;
      if (spec.kind === 'int' && !Number.isInteger(value)) return `${spec.label}（${key}）须为整数`;
      if (value < spec.min || value > spec.max) {
        return `${spec.label}（${key}）须在 ${spec.min}–${spec.max} 之间`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${spec.label}（${key}）须为是/否`;
    case 'enum':
      return typeof value === 'string' && spec.options.some((o) => o.value === value)
        ? null
        : `${spec.label}（${key}）取值无效`;
  }
}

export function validateParamPatch(
  schema: ParamSchema,
  patch: unknown,
): { ok: true; value: Record<string, ParamScalar> } | { ok: false; errors: string[] } {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: ['参数须为对象'] };
  }
  const errors: string[] = [];
  const value: Record<string, ParamScalar> = {};
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const spec = schema[key];
    if (!spec) {
      errors.push(`未知参数 ${key}`);
      continue;
    }
    const err = checkParamValue(key, spec, raw);
    if (err) errors.push(err);
    else value[key] = raw as ParamScalar;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
