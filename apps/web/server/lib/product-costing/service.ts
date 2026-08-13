import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  costingAttachments,
  costingBomLines,
  costingProjects,
  db,
  materialPriceBook,
} from '@scm/db';
import { calcQtyGross } from './bom-math.js';
import { calcCostSummary } from './cost-calc.js';
import { matchPriceBook } from './match-price.js';
import { nextCostingProjectNo } from './project-no.js';
import { removeProjectDir, writeProjectFile } from './storage.js';
import type { BomConfidence, CostSummary } from './types.js';

const MAX_SOURCE_BYTES = 80 * 1024 * 1024;

type CostingLineSource = {
  id: string;
  lineNo: number;
  category: string;
  materialName: string;
  spec: string | null;
  unit: string;
  qtyNet: string;
  lossRate: string;
  qtyGross: string;
  origin: string;
  confidence: string;
  matchStatus: string;
  unitPriceOverride: string | null;
  priceBookId: string | null;
  sourceRef: string | null;
  notes: string | null;
  isManual: boolean;
};

type ActivePriceSource = {
  id: string;
  materialName: string;
  spec: string;
  unit: string;
  unitPrice: string;
};

export type ManualBomLineInput = {
  category: string;
  materialName: string;
  spec?: string | null;
  unit: string;
  qtyNet: number;
  lossRate?: number;
  sourceRef?: string | null;
  confidence?: BomConfidence;
  notes?: string | null;
  unitPriceOverride?: number | null;
};

function toNumericString(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

function toRoundedBomQuantities(qtyNet: number, lossRate: number) {
  const roundedQtyNet = Number(toNumericString(qtyNet));
  const roundedLossRate = Number(toNumericString(lossRate));
  return {
    qtyNet: toNumericString(roundedQtyNet),
    lossRate: toNumericString(roundedLossRate),
    qtyGross: toNumericString(calcQtyGross(roundedQtyNet, roundedLossRate)),
  };
}

export function assertCostingSourceAttachment(fileName: string, byteSize: number): void {
  const name = fileName.trim().toLowerCase();
  if (!name.endsWith('.pptx') && !name.endsWith('.pdf')) {
    throw new Error('仅支持 .pptx 或 .pdf');
  }
  if (byteSize > MAX_SOURCE_BYTES) {
    throw new Error('文件过大，最大 80MB');
  }
}

export function toManualBomLineValues(line: ManualBomLineInput) {
  const lossRate = line.lossRate ?? 0;
  return {
    category: line.category.trim() || '未分类',
    materialName: line.materialName.trim(),
    spec: line.spec?.trim() || null,
    unit: line.unit.trim(),
    ...toRoundedBomQuantities(line.qtyNet, lossRate),
    sourceRef: line.sourceRef?.trim() || null,
    confidence: line.confidence ?? ('medium' as const),
    notes: line.notes?.trim() || null,
    isManual: true,
    origin: 'explicit',
    unitPriceOverride:
      line.unitPriceOverride === undefined || line.unitPriceOverride === null
        ? null
        : toNumericString(line.unitPriceOverride),
    priceBookId: null,
    matchStatus: 'unmatched',
  };
}

export function calculateCostingLines(
  sourceLines: CostingLineSource[],
  activePriceBook: ActivePriceSource[],
): {
  lines: Array<
    CostingLineSource & {
      effectiveUnitPrice: number | null;
      lineAmount: number;
    }
  >;
  summary: CostSummary;
} {
  const matches = sourceLines.map((line) => {
    if (line.unitPriceOverride !== null) {
      return {
        status: line.matchStatus,
        priceBookId: line.priceBookId,
        bookUnitPrice: null,
      };
    }

    const match = matchPriceBook(
      {
        materialName: line.materialName,
        spec: line.spec ?? '',
        unit: line.unit,
      },
      activePriceBook,
    );
    const bookRow = activePriceBook.find((item) => item.id === match.priceBookId);
    return {
      status: match.status,
      priceBookId: match.priceBookId,
      bookUnitPrice: bookRow ? Number(bookRow.unitPrice) : null,
    };
  });

  const summary = calcCostSummary(
    sourceLines.map((line, index) => ({
      qtyNet: Number(line.qtyNet),
      lossRate: Number(line.lossRate),
      unitPriceOverride:
        line.unitPriceOverride === null ? null : Number(line.unitPriceOverride),
      bookUnitPrice: matches[index]?.bookUnitPrice ?? null,
      category: line.category,
    })),
  );

  return {
    lines: sourceLines.map((line, index) => {
      const calculated = summary.lines[index]!;
      const match = matches[index]!;
      return {
        ...line,
        qtyGross: toNumericString(calculated.qtyGross),
        matchStatus: match.status,
        priceBookId: match.priceBookId,
        effectiveUnitPrice: calculated.effectiveUnitPrice,
        lineAmount: calculated.lineAmount,
      };
    }),
    summary,
  };
}

export async function listCostingProjects(): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: Date;
    category: string | null;
  }>
> {
  return db
    .select({
      id: costingProjects.id,
      name: costingProjects.name,
      status: costingProjects.status,
      updatedAt: costingProjects.updatedAt,
      category: costingProjects.category,
    })
    .from(costingProjects)
    .orderBy(desc(costingProjects.updatedAt))
    .limit(20);
}

export async function createCostingProject(input: {
  name: string;
  category?: string;
  userId: string;
}) {
  const [created] = await db
    .insert(costingProjects)
    .values({
      projectNo: nextCostingProjectNo(),
      name: input.name.trim(),
      category: input.category?.trim() || null,
      createdBy: input.userId,
    })
    .returning({
      id: costingProjects.id,
      projectNo: costingProjects.projectNo,
      name: costingProjects.name,
      status: costingProjects.status,
    });
  return created;
}

export async function getCostingProject(id: string) {
  const [project] = await db
    .select({
      id: costingProjects.id,
      projectNo: costingProjects.projectNo,
      name: costingProjects.name,
      category: costingProjects.category,
      status: costingProjects.status,
      extractError: costingProjects.extractError,
    })
    .from(costingProjects)
    .where(eq(costingProjects.id, id))
    .limit(1);
  if (!project) return null;

  const [sourceLines, activePriceBook, attachments] = await Promise.all([
    db
      .select()
      .from(costingBomLines)
      .where(eq(costingBomLines.projectId, id))
      .orderBy(asc(costingBomLines.lineNo)),
    db
      .select({
        id: materialPriceBook.id,
        materialName: materialPriceBook.materialName,
        spec: materialPriceBook.spec,
        unit: materialPriceBook.unit,
        unitPrice: materialPriceBook.unitPrice,
      })
      .from(materialPriceBook)
      .where(eq(materialPriceBook.isActive, true)),
    db
      .select({
        kind: costingAttachments.kind,
      })
      .from(costingAttachments)
      .where(eq(costingAttachments.projectId, id)),
  ]);

  const calculated = calculateCostingLines(sourceLines, activePriceBook);
  await Promise.all(
    calculated.lines
      .filter((line, index) => {
        const source = sourceLines[index]!;
        return (
          source.unitPriceOverride === null &&
          (source.matchStatus !== line.matchStatus || source.priceBookId !== line.priceBookId)
        );
      })
      .map((line) =>
        db
          .update(costingBomLines)
          .set({
            matchStatus: line.matchStatus,
            priceBookId: line.priceBookId,
            updatedAt: new Date(),
          })
          .where(eq(costingBomLines.id, line.id)),
      ),
  );

  return {
    ...project,
    lines: calculated.lines,
    summary: calculated.summary,
    pageCount: attachments.filter((attachment) => attachment.kind === 'page_image').length,
  };
}

export async function updateCostingProject(
  id: string,
  patch: { name?: string; category?: string | null },
) {
  const values: Partial<typeof costingProjects.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.category !== undefined) values.category = patch.category?.trim() || null;
  const [updated] = await db
    .update(costingProjects)
    .set(values)
    .where(eq(costingProjects.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteCostingProject(id: string): Promise<void> {
  await db.delete(costingProjects).where(eq(costingProjects.id, id));
  await removeProjectDir(id).catch(() => undefined);
}

export async function saveSourceAttachment(opts: {
  projectId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}): Promise<void> {
  assertCostingSourceAttachment(opts.fileName, opts.buffer.byteLength);
  const ext = opts.fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'pptx';
  const written = await writeProjectFile(opts.projectId, `source.${ext}`, opts.buffer);
  await db
    .delete(costingAttachments)
    .where(
      and(eq(costingAttachments.projectId, opts.projectId), eq(costingAttachments.kind, 'source')),
    );
  await db.insert(costingAttachments).values({
    projectId: opts.projectId,
    kind: 'source',
    pageNo: null,
    fileName: opts.fileName,
    contentType: opts.contentType,
    storagePath: written.storagePath,
    byteSize: written.byteSize,
  });
  await db
    .update(costingProjects)
    .set({ updatedAt: new Date() })
    .where(eq(costingProjects.id, opts.projectId));
}

export async function listBomLines(projectId: string) {
  return db
    .select()
    .from(costingBomLines)
    .where(eq(costingBomLines.projectId, projectId))
    .orderBy(asc(costingBomLines.lineNo));
}

async function markProjectReady(projectId: string): Promise<void> {
  await db
    .update(costingProjects)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(eq(costingProjects.id, projectId));
}

export async function replaceBomLines(projectId: string, lines: ManualBomLineInput[]) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .update(costingProjects)
      .set({
        ...(lines.length ? { status: 'ready' as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(costingProjects.id, projectId))
      .returning({ id: costingProjects.id });
    if (!project) return null;

    await tx.delete(costingBomLines).where(eq(costingBomLines.projectId, projectId));
    if (!lines.length) return [];

    return tx
      .insert(costingBomLines)
      .values(
        lines.map((line, index) => ({
          projectId,
          lineNo: index + 1,
          ...toManualBomLineValues(line),
        })),
      )
      .returning();
  });
}

export async function createBomLine(projectId: string, line: ManualBomLineInput) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .update(costingProjects)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(costingProjects.id, projectId))
      .returning({ id: costingProjects.id });
    if (!project) return null;

    const [{ maxLineNo }] = await tx
      .select({ maxLineNo: sql<number>`coalesce(max(${costingBomLines.lineNo}), 0)` })
      .from(costingBomLines)
      .where(eq(costingBomLines.projectId, projectId));
    const [created] = await tx
      .insert(costingBomLines)
      .values({
        projectId,
        lineNo: Number(maxLineNo) + 1,
        ...toManualBomLineValues(line),
      })
      .returning();
    return created;
  });
}

export async function updateBomLine(
  projectId: string,
  lineId: string,
  patch: Partial<ManualBomLineInput>,
) {
  const [existing] = await db
    .select()
    .from(costingBomLines)
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
    .limit(1);
  if (!existing) return null;

  const materialFieldsChanged =
    patch.materialName !== undefined || patch.spec !== undefined || patch.unit !== undefined;
  const qtyNet = patch.qtyNet ?? Number(existing.qtyNet);
  const lossRate = patch.lossRate ?? Number(existing.lossRate);
  const quantities = toRoundedBomQuantities(qtyNet, lossRate);
  const [updated] = await db
    .update(costingBomLines)
    .set({
      ...(patch.category !== undefined ? { category: patch.category.trim() || '未分类' } : {}),
      ...(patch.materialName !== undefined ? { materialName: patch.materialName.trim() } : {}),
      ...(patch.spec !== undefined ? { spec: patch.spec?.trim() || null } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit.trim() } : {}),
      ...quantities,
      ...(patch.sourceRef !== undefined ? { sourceRef: patch.sourceRef?.trim() || null } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.unitPriceOverride !== undefined
        ? {
            unitPriceOverride:
              patch.unitPriceOverride === null
                ? null
                : toNumericString(patch.unitPriceOverride),
          }
        : {}),
      ...(materialFieldsChanged ? { priceBookId: null, matchStatus: 'unmatched' } : {}),
      isManual: true,
      origin: 'explicit',
      updatedAt: new Date(),
    })
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
    .returning();
  await markProjectReady(projectId);
  return updated ?? null;
}

export async function deleteBomLine(projectId: string, lineId: string): Promise<boolean> {
  const deleted = await db
    .delete(costingBomLines)
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
    .returning({ id: costingBomLines.id });
  if (deleted.length) {
    await db
      .update(costingProjects)
      .set({ updatedAt: new Date() })
      .where(eq(costingProjects.id, projectId));
  }
  return deleted.length > 0;
}
