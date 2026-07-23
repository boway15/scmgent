import type { newsArticles, newsSources } from '@scm/db';
import { validityLabel } from './bitable-schema.js';

type ArticleRow = typeof newsArticles.$inferSelect;
type SourceRow = typeof newsSources.$inferSelect;

function toDateMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

function multiSelect(values?: string[] | null): string[] {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function tierLabel(tier?: string | null): string {
  if (tier === 'tier_1') return '一级';
  if (tier === 'tier_3') return '三级';
  return '二级';
}

function priorityLabel(priority?: string | null): string {
  if (priority === 'high') return '高';
  if (priority === 'low') return '低';
  return '中';
}

function languageLabel(language?: string | null): string {
  if (language === 'en') return '英文';
  return '中文';
}

export function mapArticleToBitableFields(
  article: ArticleRow,
  source?: Pick<SourceRow, 'name' | 'sourceTier' | 'isOfficial'> | null,
): Record<string, unknown> {
  const primaryTitle = article.titleZh || article.titleOriginal || article.title;
  const fields: Record<string, unknown> = {
    '标题（主键）': primaryTitle,
    // 无中文标题时留空，便于飞书多维表格 AI 插件从「原文标题」生成翻译
    中文标题: article.titleZh ?? '',
    中文摘要: article.summary ?? '',
    原文标题: article.titleOriginal ?? article.title,
    原文链接: { link: article.canonicalUrl, text: article.canonicalUrl },
    信源名称: source?.name ?? '',
    信源等级: tierLabel(article.sourceTier ?? source?.sourceTier),
    官方来源: Boolean(article.isOfficialSource ?? source?.isOfficial),
    原文语言: languageLabel(article.language),
    主题分类: article.topicCategory ?? article.bitableCategory ?? '',
    相关部门: multiSelect(article.departments),
    平台标签: multiSelect(article.platformTags ?? article.affectedPlatforms),
    '国家/区域标签': multiSelect(article.countryTags ?? article.affectedRegions),
    业务标签: multiSelect(article.businessTags),
    品牌标签: multiSelect(article.brandTags),
    相关度评分: article.relevanceScore ?? 0,
    重要等级: priorityLabel(article.priority),
    筛选命中依据: article.filterHits ?? '',
    业务有效性: validityLabel(article.businessValidity),
    系统文章ID: article.id,
  };

  const published = toDateMs(article.publishedAt);
  if (published) fields['发布时间'] = published;
  const fetched = toDateMs(article.fetchedAt);
  if (fetched) fields['采集时间'] = fetched;

  return fields;
}

export const NEWS_BITABLE_FIELD_ALIASES = {
  titleZh: ['中文标题', '新闻标题', '标题'],
  summary: ['中文摘要', '新闻概要', '摘要'],
  titleOriginal: ['原文标题'],
  sourceUrl: ['原文链接', '新闻链接', 'source_url', 'url'],
  topicCategory: ['主题分类', '新闻分类', '分类'],
  departments: ['相关部门'],
  platforms: ['平台标签'],
  countries: ['国家/区域标签', '国家标签'],
  brands: ['品牌标签'],
  filterHits: ['筛选命中依据'],
  businessValidity: ['业务有效性'],
  articleId: ['系统文章ID', '系统文章 ID'],
} as const;
