import type { NewsIntelPolicy, ResearchQueryTemplate } from './policy.js';

export type ResearchQuery = {
  code: string;
  label: string;
  query: string;
  language: 'zh' | 'en';
  region: string;
};

type DimensionValue = {
  name: string;
  codeValue: string;
};

const DIMENSION_PLACEHOLDERS: Record<ResearchQueryTemplate['dimension'], string[]> = {
  platform: ['{platform}', '{平台}'],
  brand: ['{brand}', '{品牌}'],
  topic: ['{topic}', '{主题}'],
};

function replaceDimension(
  value: string,
  dimension: ResearchQueryTemplate['dimension'],
  replacement: string,
): string {
  return DIMENSION_PLACEHOLDERS[dimension].reduce(
    (result, placeholder) => result.replaceAll(placeholder, replacement),
    value,
  );
}

function normalizeQuery(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function toCodeSegment(value: string): string {
  const segment = value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (segment) return segment;

  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `value_${(hash >>> 0).toString(36)}`;
}

function getDimensionValues(
  policy: NewsIntelPolicy,
  dimension: ResearchQueryTemplate['dimension'],
): DimensionValue[] {
  if (dimension === 'platform') {
    return policy.platformKeywords.map((item) => ({
      name: item.name,
      codeValue: item.aliases.find((alias) => /^[a-z0-9 ]+$/i.test(alias)) ?? item.name,
    }));
  }
  if (dimension === 'brand') {
    return policy.brandKeywords.map((item) => ({
      name: item.name,
      codeValue: item.aliases.find((alias) => /^[a-z0-9 ]+$/i.test(alias)) ?? item.name,
    }));
  }
  return policy.topics.map((item) => ({ name: item.value, codeValue: item.value }));
}

export function buildResearchQueries(policy: NewsIntelPolicy): ResearchQuery[] {
  const candidates = policy.research.queryTemplates.flatMap((template) =>
    getDimensionValues(policy, template.dimension).map(({ name, codeValue }) => {
      const renderedLabel = replaceDimension(template.label, template.dimension, name);
      return {
        code: `${template.code}_${toCodeSegment(codeValue)}`,
        label: renderedLabel === template.label ? `${template.label}：${name}` : renderedLabel,
        query: replaceDimension(template.template, template.dimension, name)
          .trim()
          .replace(/\s+/g, ' '),
        language: template.language,
        region: template.region.toUpperCase(),
      };
    }),
  );

  candidates.sort((left, right) => left.code.localeCompare(right.code));

  const seenCodes = new Set<string>();
  const seenQueries = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const normalizedQuery = normalizeQuery(candidate.query);
    if (!normalizedQuery || seenCodes.has(candidate.code) || seenQueries.has(normalizedQuery)) {
      return false;
    }
    seenCodes.add(candidate.code);
    seenQueries.add(normalizedQuery);
    return true;
  });

  const limit = Math.max(0, Math.floor(policy.research.maxQueriesPerRun));
  return unique.slice(0, limit);
}

export function buildGoogleNewsFeedUrl(query: ResearchQuery, lookbackDays = 7): string {
  const region = query.region.toUpperCase();
  const days = Number.isFinite(lookbackDays) && lookbackDays > 0 ? Math.floor(lookbackDays) : 7;
  const isChinese = query.language === 'zh';
  const url = new URL('https://news.google.com/rss/search');
  const searchParams = new URLSearchParams({
    q: `${query.query.trim()} when:${days}d`,
    hl: isChinese ? 'zh-CN' : region === 'GB' ? 'en-GB' : 'en-US',
    gl: region,
    ceid: `${region}:${isChinese ? 'zh-Hans' : 'en'}`,
  });
  url.search = searchParams.toString();
  return url.toString();
}
