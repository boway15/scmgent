export const ARTICLE_REVIEW_STATUSES = [
  'pending_review',
  'published',
  'ignored',
] as const;

export type ArticleReviewStatus = (typeof ARTICLE_REVIEW_STATUSES)[number];

export function isArticleReviewStatus(status: unknown): status is ArticleReviewStatus {
  return (
    typeof status === 'string' &&
    ARTICLE_REVIEW_STATUSES.includes(status as ArticleReviewStatus)
  );
}

export function buildReviewPatch(status: unknown, reviewerId: string, now: Date) {
  if (!isArticleReviewStatus(status)) {
    throw new Error('Invalid article review status');
  }

  if (status === 'pending_review') {
    return {
      status,
      reviewedAt: null,
      reviewedBy: null,
    };
  }

  if (status === 'published') {
    return {
      status,
      reviewedAt: now,
      reviewedBy: reviewerId,
      bitableSyncStatus: 'pending' as const,
      bitableSyncError: null,
    };
  }

  return {
    status,
    reviewedAt: now,
    reviewedBy: reviewerId,
  };
}
