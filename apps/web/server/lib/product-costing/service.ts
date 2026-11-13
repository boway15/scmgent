import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  db,
  costingAttachments,
  costingBomLines,
  costingExtractRuns,
  costingProjects,
} from '@scm/db';
import { canConfirmBom, calcQtyGross } from './bom-math.js';
import { buildBomXlsx } from './export-bom.js';
import { buildProjectNo, randomProjectSuffix } from './project-no.js';
import { removeProjectDir, writeProjectFile } from './storage.js';
import type { BomConfidence } from './types.js';

export async function listCostingProjects(opts: {
  page: number;
  pageSize: number;
  status?: string;
  keyword?: string;
}) {
  const conditions = [];
  if (opts.status) {
    conditions.push(
      eq(
        costingProjects.status,
        opts.status as
          | 'draft'
          | 'extracting'
          | 'bom_draft'
          | 'bom_ready'
          | 'costed'
          | 'extract_failed',
      ),
    );
  }
  if (opts.keyword?.trim()) {
    const q = `%${opts.keyword.trim()}%`;
    conditions.push(or(ilike(costingProjects.name, q), ilike(costingProjects.projectNo, q)));
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(costingProjects).where(where);
  const items = await db
    .select()
    .from(costingProjects)
    .where(where)
    .orderBy(desc(costingProjects.createdAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  return { items, total: Number(total), page: opts.page, pageSize: opts.pageSize };
}

export async function createCostingProject(input: {
  name: string;
  category?: string;
  skuId?: string | null;
  userId: string;
}) {
  const projectNo = buildProjectNo(new Date(), randomProjectSuffix());
  const [row] = await db
    .insert(costingProjects)
    .values({
      projectNo,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      skuId: input.skuId || null,
      createdBy: input.userId,
    })
    .returning();
  return row;
}

export async function getCostingProject(id: string) {
  const [project] = await db.select().from(costingProjects).where(eq(costingProjects.id, id)).limit(1);
  if (!project) return null;
  const attachments = await db
    .select()
    .from(costingAttachments)
    .where(eq(costingAttachments.projectId, id))
    .orderBy(asc(costingAttachments.pageNo));
  const lines = await db
    .select()
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, id))
    .orderBy(asc(costingBomLines.lineNo));
  const pageCount = attachments.filter((a) => a.kind === 'page_image').length;
  const hasSource = attachments.some((a) => a.kind === 'source');
  return { ...project, attachments, lines, pageCount, hasSource };
}

export async function updateCostingProject(
  id: string,
  patch: { name?: string; category?: string | null; skuId?: string | null },
) {
  const [row] = await db
    .update(costingProjects)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.skuId !== undefined ? { skuId: patch.skuId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(costingProjects.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCostingProject(id: string) {
  await db.delete(costingProjects).where(eq(costingProjects.id, id));
  await removeProjectDir(id).catch(() => undefined);
}

export async function saveSourceAttachment(opts: {
  projectId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  await db
    .delete(costingAttachments)
    .where(
      and(eq(costingAttachments.projectId, opts.projectId), eq(costingAttachments.kind, 'source')),
    );
  const ext = opts.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  const written = await writeProjectFile(opts.projectId, `source.${ext}`, opts.buffer);
  const [row] = await db
    .insert(costingAttachments)
    .values({
      projectId: opts.projectId,
      kind: 'source',
      pageNo: null,
      fileName: opts.fileName,
      contentType: opts.contentType,
      storagePath: written.storagePath,
      byteSize: written.byteSize,
    })
    .returning();
  await db
    .update(costingProjects)
    .set({ status: 'draft', updatedAt: new Date() })
    .where(eq(costingProjects.id, opts.projectId));
  return row;
}

export async function listBomLines(projectId: string) {
  return db
    .select()
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, projectId))
    .orderBy(asc(costingBomLines.lineNo));
}

function toNumericString(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

export async function replaceBomLines(
  projectId: string,
  lines: Array<{
    category: string;
    materialName: string;
    spec?: string | null;
    unit: string;
    qtyNet: number;
    lossRate?: number;
    sourceRef?: string | null;
    confidence?: BomConfidence;
    notes?: string | null;
    isManual?: boolean;
  }>,
) {
  await db.delete(costingBomLines).where(eq(costingBomLines.projectId, projectId));
  if (!lines.length) return [];
  const values = lines.map((line, idx) => {
    const lossRate = line.lossRate ?? 0;
    return {
      projectId,
      lineNo: idx + 1,
      category: line.category || '未分类',
      materialName: line.materialName,
      spec: line.spec ?? null,
      unit: line.unit,
      qtyNet: toNumericString(line.qtyNet),
      lossRate: toNumericString(lossRate),
      qtyGross: toNumericString(calcQtyGross(line.qtyNet, lossRate)),
      sourceRef: line.sourceRef ?? null,
      confidence: line.confidence ?? 'medium',
      notes: line.notes ?? null,
      isManual: line.isManual ?? true,
    };
  });
  return db.insert(costingBomLines).values(values).returning();
}

export async function createBomLine(
  projectId: string,
  line: {
    category: string;
    materialName: string;
    spec?: string | null;
    unit: string;
    qtyNet: number;
    lossRate?: number;
    sourceRef?: string | null;
    confidence?: BomConfidence;
    notes?: string | null;
  },
) {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${costingBomLines.lineNo}), 0)` })
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, projectId));
  const lossRate = line.lossRate ?? 0;
  const [row] = await db
    .insert(costingBomLines)
    .values({
      projectId,
      lineNo: Number(max) + 1,
      category: line.category || '未分类',
      materialName: line.materialName,
      spec: line.spec ?? null,
      unit: line.unit,
      qtyNet: toNumericString(line.qtyNet),
      lossRate: toNumericString(lossRate),
      qtyGross: toNumericString(calcQtyGross(line.qtyNet, lossRate)),
      sourceRef: line.sourceRef ?? null,
      confidence: line.confidence ?? 'medium',
      notes: line.notes ?? null,
      isManual: true,
    })
    .returning();
  return row;
}

export async function updateBomLine(
  projectId: string,
  lineId: string,
  patch: Partial<{
    category: string;
    materialName: string;
    spec: string | null;
    unit: string;
    qtyNet: number;
    lossRate: number;
    sourceRef: string | null;
    confidence: BomConfidence;
    notes: string | null;
  }>,
) {
  const [existing] = await db
    .select()
    .from(costingBomLines)
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
    .limit(1);
  if (!existing) return null;
  const qtyNet = patch.qtyNet ?? Number(existing.qtyNet);
  const lossRate = patch.lossRate ?? Number(existing.lossRate);
  const [row] = await db
    .update(costingBomLines)
    .set({
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.materialName !== undefined ? { materialName: patch.materialName } : {}),
      ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
      qtyNet: toNumericString(qtyNet),
      lossRate: toNumericString(lossRate),
      qtyGross: toNumericString(calcQtyGross(qtyNet, lossRate)),
      ...(patch.sourceRef !== undefined ? { sourceRef: patch.sourceRef } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      isManual: true,
      updatedAt: new Date(),
    })
    .where(eq(costingBomLines.id, lineId))
    .returning();
  return row;
}

export async function deleteBomLine(projectId: string, lineId: string) {
  await db
    .delete(costingBomLines)
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)));
}

export async function confirmBom(projectId: string, force = false) {
  const lines = await listBomLines(projectId);
  const check = canConfirmBom(
    lines.map((l) => ({
      materialName: l.materialName,
      unit: l.unit,
      qtyNet: l.qtyNet,
      confidence: l.confidence,
    })),
    force,
  );
  if (!check.ok) {
    return { ok: false as const, reasons: check.reasons };
  }
  const [row] = await db
    .update(costingProjects)
    .set({ status: 'bom_ready', confirmedBomAt: new Date(), updatedAt: new Date() })
    .where(eq(costingProjects.id, projectId))
    .returning();
  return { ok: true as const, project: row };
}

export async function exportBomBuffer(projectId: string) {
  const lines = await listBomLines(projectId);
  return buildBomXlsx(
    lines.map((l) => ({
      category: l.category,
      materialName: l.materialName,
      spec: l.spec,
      unit: l.unit,
      qtyNet: l.qtyNet,
      lossRate: l.lossRate,
      qtyGross: l.qtyGross,
      sourceRef: l.sourceRef,
      confidence: l.confidence,
      notes: l.notes,
    })),
  );
}

export async function listExtractRuns(projectId: string) {
  return db
    .select()
    .from(costingExtractRuns)
    .where(eq(costingExtractRuns.projectId, projectId))
    .orderBy(desc(costingExtractRuns.createdAt));
}

export async function getExtractRun(projectId: string, runId: string) {
  const [run] = await db
    .select()
    .from(costingExtractRuns)
    .where(and(eq(costingExtractRuns.id, runId), eq(costingExtractRuns.projectId, projectId)))
    .limit(1);
  return run ?? null;
}
