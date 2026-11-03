export type ForecastSkuQuery =
  | { kind: 'none' }
  | { kind: 'fuzzy'; token: string }
  | { kind: 'exact'; codes: string[] };

const SKU_TOKEN_SPLIT = /[\s,，;；]+/;

/** 生成预测用：无论几个词都按编码精确匹配（大写、去重）。 */
export function splitForecastSkuCodes(raw?: string | null): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(SKU_TOKEN_SPLIT)
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** 逗号、中文逗号、分号、空格、换行都可分隔。一个词模糊匹配，多个词按编码精确匹配。 */
export function parseForecastSkuQuery(raw?: string | null): ForecastSkuQuery {
  const tokens = (raw ?? '')
    .split(SKU_TOKEN_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { kind: 'none' };
  if (tokens.length === 1) return { kind: 'fuzzy', token: tokens[0]! };
  return { kind: 'exact', codes: [...new Set(tokens.map((code) => code.toUpperCase()))] };
}
