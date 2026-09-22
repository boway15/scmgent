import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { costingAttachments, db } from '@scm/db';
import { classifyPage } from './page-classify.js';
import { parseOverallSizeFromPages, type OverallSize } from './parse-overall-size.js';
import { resolveStoragePath } from './storage.js';
import type { PageKind } from './types.js';

export async function loadClassifiedPageTexts(
  projectId: string,
): Promise<Array<{ pageType: PageKind; text: string }>> {
  const rows = await db
    .select({
      pageNo: costingAttachments.pageNo,
      storagePath: costingAttachments.storagePath,
    })
    .from(costingAttachments)
    .where(and(eq(costingAttachments.projectId, projectId), eq(costingAttachments.kind, 'page_text')));
  const pages: Array<{ pageType: PageKind; text: string }> = [];
  for (const row of rows) {
    try {
      const text = await readFile(resolveStoragePath(row.storagePath), 'utf8');
      pages.push({
        pageType: classifyPage(row.pageNo ?? 0, text),
        text,
      });
    } catch {
      /* page text is optional */
    }
  }
  return pages;
}

export async function loadProjectOverallSize(projectId: string): Promise<OverallSize | null> {
  return parseOverallSizeFromPages(await loadClassifiedPageTexts(projectId));
}
