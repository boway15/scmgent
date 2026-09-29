import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, inventoryDataIssues } from '@scm/db';
import { chunkRowsForInsert } from './inventory-health-store.js';
import {
  planDataIssueUpsert,
  type DataIssueCandidate,
  type ExistingDataIssue,
} from './inventory-data-issues.js';

export async function loadExistingDataIssues(
  detectedFingerprints: string[],
): Promise<ExistingDataIssue[]> {
  const openRows = await db
    .select({
      id: inventoryDataIssues.id,
      fingerprint: inventoryDataIssues.fingerprint,
      status: inventoryDataIssues.status,
    })
    .from(inventoryDataIssues)
    .where(inArray(inventoryDataIssues.status, ['open', 'in_progress']));

  if (!detectedFingerprints.length) return openRows;

  const dismissedRows = await db
    .select({
      id: inventoryDataIssues.id,
      fingerprint: inventoryDataIssues.fingerprint,
      status: inventoryDataIssues.status,
    })
    .from(inventoryDataIssues)
    .where(
      and(
        eq(inventoryDataIssues.status, 'dismissed'),
        inArray(inventoryDataIssues.fingerprint, detectedFingerprints),
      ),
    );

  return [...openRows, ...dismissedRows];
}

export async function applyDataIssueUpsert(detected: DataIssueCandidate[]): Promise<{
  inserted: number;
  refreshed: number;
  autoResolved: number;
}> {
  const existing = await loadExistingDataIssues(detected.map((row) => row.fingerprint));
  const plan = planDataIssueUpsert({ existing, detected });
  const now = new Date();

  if (plan.insert.length) {
    const values = plan.insert.map((row) => ({
      fingerprint: row.fingerprint,
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      issueType: row.issueType,
      impactModule: row.impactModule,
      example: row.example,
      qty: row.qty,
      lastSeenAt: now,
      updatedAt: now,
    }));
    for (const chunk of chunkRowsForInsert(values, 200)) {
      await db.insert(inventoryDataIssues).values(chunk);
    }
  }

  for (const row of plan.refresh) {
    await db
      .update(inventoryDataIssues)
      .set({
        example: row.candidate.example,
        qty: row.candidate.qty,
        impactModule: row.candidate.impactModule,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(inventoryDataIssues.id, row.id));
  }

  if (plan.autoResolve.length) {
    await db
      .update(inventoryDataIssues)
      .set({
        status: 'resolved',
        resolutionNote: 'scan_cleared',
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        inArray(
          inventoryDataIssues.id,
          plan.autoResolve.map((row) => row.id),
        ),
      );
  }

  return {
    inserted: plan.insert.length,
    refreshed: plan.refresh.length,
    autoResolved: plan.autoResolve.length,
  };
}

export async function countOpenDataIssues(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryDataIssues)
    .where(inArray(inventoryDataIssues.status, ['open', 'in_progress']));
  return Number(row?.count ?? 0);
}

export async function countOpenDataIssuesByType(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      issueType: inventoryDataIssues.issueType,
      count: sql<number>`count(*)::int`,
    })
    .from(inventoryDataIssues)
    .where(inArray(inventoryDataIssues.status, ['open', 'in_progress']))
    .groupBy(inventoryDataIssues.issueType);
  const result: Record<string, number> = {
    missing_available_at: 0,
    unallocated_warehouse: 0,
    share_sum_mismatch: 0,
    unmapped_warehouse: 0,
    position_source_mismatch: 0,
    position_share_gap: 0,
  };
  for (const row of rows) {
    result[row.issueType] = Number(row.count ?? 0);
  }
  return result;
}
