import type { newsArticles, newsSources } from '@scm/db';
import { buildBitableRemark } from './content-filter.js';

type ArticleRow = typeof newsArticles.$inferSelect;
type SourceRow = typeof newsSources.$inferSelect;

function toDateMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

function buildStructuredSummary(article: ArticleRow): string {
  const keyPoints = Array.isArray(article.keyPoints) ? article.keyPoints : [];
  const lines: string[] = [];
  if (keyPoints.length) {
    lines.push('【要点】');
    for (const p of keyPoints) lines.push(`· ${p}`);
  }
  if (article.tags?.length) {
    lines.push(`标签：${article.tags.join('、')}`);
  }
  return lines.join('\n');
}

export function mapArticleToBitableFields(
  article: ArticleRow,
  source?: Pick<SourceRow, 'name'> | null,
  remarkExtra?: { remarkPlatforms?: string[]; remarkCountries?: string[] },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    新闻标题: article.title,
    新闻概要: article.summary ?? '',
    新闻来源: source?.name ?? '',
    新闻链接: { link: article.canonicalUrl, text: article.canonicalUrl },
    新闻分类: article.bitableCategory ?? '市场',
    结构化汇总: buildStructuredSummary(article),
  };

  const remark = buildBitableRemark({
    articleId: article.id,
    remarkPlatforms: remarkExtra?.remarkPlatforms ?? [],
    remarkCountries: remarkExtra?.remarkCountries ?? [],
  });
  if (remark) fields['备注'] = remark;

  const newsDate = toDateMs(article.publishedAt) ?? toDateMs(article.fetchedAt);
  if (newsDate) fields['新闻日期'] = newsDate;

  return fields;
}

export const NEWS_BITABLE_FIELD_ALIASES = {
  title: ['新闻标题', '标题', 'title'],
  summary: ['新闻概要', '摘要', 'summary'],
  sourceUrl: ['新闻链接', '原文链接', 'source_url', 'url'],
  category: ['新闻分类', '分类', 'category'],
  remark: ['备注', 'remark'],
} as const;
