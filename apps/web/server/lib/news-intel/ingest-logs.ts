import { desc, eq } from 'drizzle-orm';
import { db, newsIngestLogs, newsSources } from '@scm/db';

export async function listRecentIngestLogs(limit = 30) {
  return db
    .select({
      log: newsIngestLogs,
      sourceCode: newsSources.code,
      sourceName: newsSources.name,
    })
    .from(newsIngestLogs)
    .innerJoin(newsSources, eq(newsIngestLogs.sourceId, newsSources.id))
    .orderBy(desc(newsIngestLogs.createdAt))
    .limit(limit);
}
