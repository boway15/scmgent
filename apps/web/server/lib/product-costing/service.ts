import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  costingAttachments,
  costingBomLines,
  costingExtractRuns,
  costingFactories,
  costingFactoryFeeRates,
  costingProjects,
  costingRegions,
  db,
  materialPriceBook,
} from '@scm/db';
import { calcQtyGross } from './bom-math.js';
import { canonicalMaterialName } from './category-rules.js';
import { calcCostSummary } from './cost-calc.js';
import { parseProcessOverrides, resolveProcessRatesFromBook } from './board-sheet.js';
import { applyFactsToLines, prepareBomLinesForApplyFacts } from './apply-facts.js';
import { detectApplyFactsStale, patchTouchesStructureFacts } from './apply-facts-stale.js';
import { buildExtractSnapshotFromDraft, snapshotDiffText } from './extract-snapshot.js';
import { replaceProjectBomDrafts } from './sync-bom-lines.js';
import { dedupePriceBookByDate, formatDateOnly, parseDateOnlyInput } from './price-effective.js';
import { mergePackProfile } from './pack-profile.js';
import { lineProvenanceTags, listReviewIssues } from './review-issues.js';
import { listComputeBlockers, resolveDisplaySummary } from './compute-gate.js';
import { describeProductStructure } from './describe-product-structure.js';
import { reconcileOrphanExtractRuns } from './extract-runner.js';
import { parseHardwareFacts } from './hardware-facts.js';
import { loadClassifiedPageTexts, loadProjectOverallSize } from './costing-page-texts.js';
import {
  assertPriceBookBindable,
  BindPriceBookError,
  resolvePriceBookEntryScope,
} from './bind-price-book.js';
import { loadGenericSliceIds } from './costing-catalog.js';
import type { SliceContext } from './costing-scope.js';
import { appendMatchHint, matchCostingLine, resolveFeeRates } from './match-price.js';
import { nextCostingProjectNo } from './project-no.js';
import { removeProjectDir, writeProjectFile } from './storage.js';
import { isRasterImageFile } from './preprocess/raster-image.js';
import type { BomConfidence, CostingBomLineDraft, CostSummary, MatchScope } from './types.js';

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
  matchScope?: string | null;
  unitPriceOverride: string | null;
  priceBookId: string | null;
  sourceRef: string | null;
  notes: string | null;
  processOverrides?: unknown;
  isManual: boolean;
  substrate?: string | null;
  extractSnapshot?: {
    materialName: string;
    spec: string | null;
    qtyNet: number;
    origin: string;
    sourceRef: string | null;
  } | null;
};

type ActivePriceSource = {
  id: string;
  materialName: string;
  spec: string;
  unit: string;
  unitPrice: string;
  regionId?: string | null;
  factoryId?: string | null;
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
  processOverrides?: import('./board-sheet.js').ProcessOverrides;
  substrate?: string | null;
  isManual?: boolean;
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

function parseStoredSummary(raw: unknown): CostSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CostSummary>;
  if (typeof value.totalAmount !== 'number') return null;
  return value as CostSummary;
}

export async function clearCostSnapshot(projectId: string): Promise<void> {
  await db
    .update(costingProjects)
    .set({ costComputedAt: null, costSummary: null, updatedAt: new Date() })
    .where(eq(costingProjects.id, projectId));
}

export function assertCostingSourceAttachment(fileName: string, byteSize: number): void {
  const name = fileName.trim().toLowerCase();
  const allowed =
    name.endsWith('.pptx') ||
    name.endsWith('.pdf') ||
    isRasterImageFile(name);
  if (!allowed) {
    throw new Error('仅支持 .pptx、.pdf 或图片（jpg/png/webp）');
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
    processOverrides: line.processOverrides ?? {},
    isManual: true,
    origin: 'explicit',
    unitPriceOverride:
      line.unitPriceOverride === undefined || line.unitPriceOverride === null
        ? null
        : toNumericString(line.unitPriceOverride),
    substrate: line.substrate?.trim() || null,
    priceBookId: null,
    matchStatus: 'unmatched',
  };
}

export function calculateCostingLines(
  sourceLines: CostingLineSource[],
  activePriceBook: ActivePriceSource[],
  options?: {
    slice?: SliceContext;
    fees?: Array<{ name: string; rate: number; regionId: string; factoryId: string; isActive?: boolean }>;
    defaultSubstrate?: string | null;
    otherHardwarePct?: number | null;
  },
): {
  lines: Array<
    CostingLineSource & {
      effectiveUnitPrice: number | null;
      lineAmount: number;
      matchScope: MatchScope | null;
    }
  >;
  summary: CostSummary;
} {
  const matches = sourceLines.map((line) => {
    const match = matchCostingLine(
      {
        category: line.category,
        materialName: line.materialName,
        spec: line.spec ?? '',
        unit: line.unit,
      },
      activePriceBook,
      options?.slice,
      line.substrate?.trim() || options?.defaultSubstrate,
    );
    const bookRow = activePriceBook.find((item) => item.id === match.priceBookId);
    return {
      status: match.status,
      priceBookId: match.priceBookId,
      scope: match.scope,
      bookUnitPrice:
        line.unitPriceOverride !== null
          ? null
          : bookRow
            ? Number(bookRow.unitPrice)
            : null,
      bookUnit: match.bookUnit ?? bookRow?.unit ?? null,
      pricePerM2: match.pricePerM2 ?? null,
      hint: match.hint,
    };
  });

  const resolvedFees = options?.slice
    ? resolveFeeRates(options.slice, options.fees ?? [])
    : [];
  const summary = calcCostSummary(
    sourceLines.map((line, index) => ({
      qtyNet: Number(line.qtyNet),
      lossRate: Number(line.lossRate),
      unitPriceOverride:
        line.unitPriceOverride === null ? null : Number(line.unitPriceOverride),
      bookUnitPrice: matches[index]?.bookUnitPrice ?? null,
      bookUnit: matches[index]?.bookUnit ?? null,
      pricePerM2: matches[index]?.pricePerM2 ?? null,
      category: line.category,
      materialName: line.materialName,
      spec: line.spec ?? '',
      unit: line.unit,
      defaultSubstrate: line.substrate?.trim() || options?.defaultSubstrate || null,
      processOverrides: parseProcessOverrides(line.processOverrides),
      lineId: line.id,
    })),
    resolvedFees,
    {
      otherHardwarePct: options?.otherHardwarePct ?? null,
      processRates: resolveProcessRatesFromBook(activePriceBook),
    },
  );

  return {
    lines: sourceLines.map((line, index) => {
      const calculated = summary.lines[index]!;
      const match = matches[index]!;
      return {
        ...line,
        qtyGross: toNumericString(calculated.qtyGross),
        matchStatus: match.status,
        matchScope: match.scope,
        priceBookId: match.priceBookId,
        notes: appendMatchHint(
          line.notes,
          match.status === 'unmatched' ? match.hint : undefined,
        ),
        effectiveUnitPrice: calculated.effectiveUnitPrice,
        lineAmount: calculated.lineAmount,
      };
    }),
    summary,
  };
}

export type CostingProjectListRow = {
  id: string;
  projectNo: string;
  name: string;
  status: string;
  updatedAt: Date;
  category: string | null;
  regionName: string | null;
  factoryName: string | null;
};

function buildCostingProjectConditions(q?: string) {
  const keyword = q?.trim();
  if (!keyword) return undefined;
  const pattern = `%${keyword}%`;
  return or(
    ilike(costingProjects.projectNo, pattern),
    ilike(costingProjects.name, pattern),
    ilike(costingProjects.category, pattern),
    ilike(costingRegions.name, pattern),
    ilike(costingFactories.name, pattern),
  )!;
}

export async function listCostingProjects(params?: {
  page?: number;
  pageSize?: number;
  offset?: number;
  q?: string;
}): Promise<{
  items: CostingProjectListRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, params?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
  const offset = params?.offset ?? (page - 1) * pageSize;
  const where = buildCostingProjectConditions(params?.q);

  const [items, countRow] = await Promise.all([
    db
      .select({
        id: costingProjects.id,
        projectNo: costingProjects.projectNo,
        name: costingProjects.name,
        status: costingProjects.status,
        updatedAt: costingProjects.updatedAt,
        category: costingProjects.category,
        regionName: costingRegions.name,
        factoryName: costingFactories.name,
      })
      .from(costingProjects)
      .leftJoin(costingRegions, eq(costingProjects.regionId, costingRegions.id))
      .leftJoin(costingFactories, eq(costingProjects.factoryId, costingFactories.id))
      .where(where)
      .orderBy(desc(costingProjects.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(costingProjects)
      .leftJoin(costingRegions, eq(costingProjects.regionId, costingRegions.id))
      .leftJoin(costingFactories, eq(costingProjects.factoryId, costingFactories.id))
      .where(where),
  ]);

  return {
    items,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function createCostingProject(input: {
  name?: string;
  category?: string;
  constructionType?: string | null;
  drawerCount?: number | null;
  defaultSubstrate?: string | null;
  regionId?: string | null;
  factoryId?: string | null;
  userId: string;
}) {
  const projectNo = nextCostingProjectNo();
  const [created] = await db
    .insert(costingProjects)
    .values({
      projectNo,
      name: input.name?.trim() || projectNo,
      category: input.category?.trim() || null,
      constructionType: input.constructionType?.trim() || null,
      drawerCount: input.drawerCount ?? null,
      defaultSubstrate: input.defaultSubstrate?.trim() || null,
      regionId: input.regionId || null,
      factoryId: input.factoryId || null,
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
      constructionType: costingProjects.constructionType,
      drawerCount: costingProjects.drawerCount,
      defaultSubstrate: costingProjects.defaultSubstrate,
      carcassThicknessMm: costingProjects.carcassThicknessMm,
      drawerBottomThicknessMm: costingProjects.drawerBottomThicknessMm,
      sideThicknessMm: costingProjects.sideThicknessMm,
      backThicknessMm: costingProjects.backThicknessMm,
      bottomThicknessMm: costingProjects.bottomThicknessMm,
      structureSummary: costingProjects.structureSummary,
      designPrinciples: costingProjects.designPrinciples,
      hardwareFacts: costingProjects.hardwareFacts,
      otherHardwarePct: costingProjects.otherHardwarePct,
      costComputedAt: costingProjects.costComputedAt,
      costSummary: costingProjects.costSummary,
      priceAsOf: costingProjects.priceAsOf,
      regionId: costingProjects.regionId,
      factoryId: costingProjects.factoryId,
      status: costingProjects.status,
      extractError: costingProjects.extractError,
    })
    .from(costingProjects)
    .where(eq(costingProjects.id, id))
    .limit(1);
  if (!project) return null;

  await reconcileOrphanExtractRuns(id, project.status);

  const [sourceLines, activePriceBook, attachments, latestExtractRuns] = await Promise.all([
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
        regionId: materialPriceBook.regionId,
        factoryId: materialPriceBook.factoryId,
        effectiveFrom: materialPriceBook.effectiveFrom,
        effectiveTo: materialPriceBook.effectiveTo,
      })
      .from(materialPriceBook)
      .where(eq(materialPriceBook.isActive, true)),
    db
      .select({
        kind: costingAttachments.kind,
      })
      .from(costingAttachments)
      .where(eq(costingAttachments.projectId, id)),
    db
      .select({
        id: costingExtractRuns.id,
        status: costingExtractRuns.status,
        errorMessage: costingExtractRuns.errorMessage,
        rawResponse: costingExtractRuns.rawResponse,
      })
      .from(costingExtractRuns)
      .where(eq(costingExtractRuns.projectId, id))
      .orderBy(desc(costingExtractRuns.createdAt))
      .limit(1),
  ]);

  const genericIds = await loadGenericSliceIds().catch(() => null);
  const feeRows = genericIds
    ? await db
        .select({
          name: costingFactoryFeeRates.name,
          rate: costingFactoryFeeRates.rate,
          regionId: costingFactoryFeeRates.regionId,
          factoryId: costingFactoryFeeRates.factoryId,
          isActive: costingFactoryFeeRates.isActive,
        })
        .from(costingFactoryFeeRates)
        .where(eq(costingFactoryFeeRates.isActive, true))
    : [];
  const priceAsOf = project.priceAsOf ? new Date(String(project.priceAsOf)) : new Date();
  const scopedPriceBook = dedupePriceBookByDate(
    activePriceBook.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom ? String(row.effectiveFrom) : '2000-01-01',
      effectiveTo: row.effectiveTo ? String(row.effectiveTo) : null,
    })),
    priceAsOf,
  );
  const calculated = calculateCostingLines(sourceLines, scopedPriceBook, {
    slice: genericIds
      ? {
          regionId: project.regionId,
          factoryId: project.factoryId,
          ...genericIds,
        }
      : undefined,
    fees: feeRows.map((row) => ({
      name: row.name,
      rate: Number(row.rate),
      regionId: row.regionId,
      factoryId: row.factoryId,
      isActive: row.isActive,
    })),
    defaultSubstrate: project.defaultSubstrate,
  });
  const { costSummary: storedCostSummary, ...projectFields } = project;
  const snapshot =
    project.costComputedAt && storedCostSummary ? parseStoredSummary(storedCostSummary) : null;
  const display = resolveDisplaySummary({ snapshot, live: calculated.summary });
  const computeBlockers = listComputeBlockers(
    calculated.lines.map((line) => ({
      id: line.id,
      materialName: line.materialName,
      category: line.category,
      spec: line.spec,
      unit: line.unit,
      qtyNet: Number(line.qtyNet),
      effectiveUnitPrice: line.effectiveUnitPrice,
    })),
  );
  const reviewIssues = listReviewIssues({
    blockers: computeBlockers,
    lines: calculated.lines.map((line) => ({
      id: line.id,
      materialName: line.materialName,
      category: line.category,
      origin: line.origin,
      isManual: line.isManual,
      confidence: line.confidence,
      matchStatus: line.matchStatus,
      unitPriceOverride:
        line.unitPriceOverride === null ? null : Number(line.unitPriceOverride),
      effectiveUnitPrice: line.effectiveUnitPrice,
      qtyNet: Number(line.qtyNet),
      spec: line.spec,
      unit: line.unit,
    })),
    drawerCount: project.drawerCount,
    category: project.category,
  });
  await Promise.all(
    calculated.lines
      .filter((line, index) => {
        const source = sourceLines[index]!;
        return (
          source.unitPriceOverride === null &&
          (source.matchStatus !== line.matchStatus ||
            source.matchScope !== line.matchScope ||
            source.priceBookId !== line.priceBookId ||
            source.notes !== line.notes)
        );
      })
      .map((line) =>
        db
          .update(costingBomLines)
          .set({
            matchStatus: line.matchStatus,
            matchScope: line.matchScope,
            priceBookId: line.priceBookId,
            notes: line.notes,
            updatedAt: new Date(),
          })
          .where(eq(costingBomLines.id, line.id)),
      ),
  );

  const applyFactsStale = detectApplyFactsStale(
    {
      status: project.status,
      drawerCount: project.drawerCount,
      category: project.category,
      carcassThicknessMm: project.carcassThicknessMm,
    },
    calculated.lines.map((line) => ({
      materialName: line.materialName,
      qtyNet: Number(line.qtyNet),
      spec: line.spec,
      origin: line.origin,
      notes: line.notes,
    })),
  );

  return {
    ...projectFields,
    priceAsOf: formatDateOnly(priceAsOf),
    hardwareFacts: parseHardwareFacts(project.hardwareFacts),
    otherHardwarePct: project.otherHardwarePct == null ? null : Number(project.otherHardwarePct),
    lines: calculated.lines.map((line) => ({
      ...line,
      provenanceTags: lineProvenanceTags({
        origin: line.origin,
        category: line.category,
        isManual: line.isManual,
        matchStatus: line.matchStatus,
        unitPriceOverride:
          line.unitPriceOverride === null ? null : Number(line.unitPriceOverride),
        materialName: line.materialName,
      }),
      extractSnapshot: line.extractSnapshot ?? null,
      extractDiff: snapshotDiffText(line.extractSnapshot, {
        materialName: line.materialName,
        spec: line.spec,
        qtyNet: line.qtyNet,
      }),
    })),
    summary: display.summary,
    calculatedSummary: calculated.summary,
    costComputedAt: project.costComputedAt,
    costStale: display.costStale,
    applyFactsStale,
    computeBlockers,
    reviewIssues,
    hasSourceAttachment: attachments.some((attachment) => attachment.kind === 'source'),
    pageCount: attachments.filter((attachment) => attachment.kind === 'page_image').length,
    structureBrief: describeProductStructure({
      category: project.category,
      constructionType: project.constructionType,
      drawerCount: project.drawerCount,
      defaultSubstrate: project.defaultSubstrate,
      carcassThicknessMm: project.carcassThicknessMm,
      drawerBottomThicknessMm: project.drawerBottomThicknessMm,
      sideThicknessMm: project.sideThicknessMm,
      backThicknessMm: project.backThicknessMm,
      bottomThicknessMm: project.bottomThicknessMm,
    }),
    latestExtractRun: latestExtractRuns[0] ?? null,
  };
}

export async function updateCostingProject(
  id: string,
  patch: {
    name?: string;
    category?: string | null;
    constructionType?: string | null;
    drawerCount?: number | null;
    defaultSubstrate?: string | null;
    carcassThicknessMm?: number | null;
    drawerBottomThicknessMm?: number | null;
    sideThicknessMm?: number | null;
    backThicknessMm?: number | null;
    bottomThicknessMm?: number | null;
    structureSummary?: string | null;
    designPrinciples?: string | null;
    hardwareFacts?: unknown;
    otherHardwarePct?: number | null;
    regionId?: string | null;
    factoryId?: string | null;
    priceAsOf?: string | null;
  },
) {
  const [current] = await db
    .select({ status: costingProjects.status })
    .from(costingProjects)
    .where(eq(costingProjects.id, id))
    .limit(1);
  const values: Partial<typeof costingProjects.$inferInsert> = {
    updatedAt: new Date(),
    costComputedAt: null,
    costSummary: null,
  };
  if (patchTouchesStructureFacts(patch) && current?.status === 'ready') {
    values.status = 'draft';
  }
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.category !== undefined) values.category = patch.category?.trim() || null;
  if (patch.constructionType !== undefined) {
    values.constructionType = patch.constructionType?.trim() || null;
  }
  if (patch.drawerCount !== undefined) values.drawerCount = patch.drawerCount;
  if (patch.defaultSubstrate !== undefined) {
    values.defaultSubstrate = patch.defaultSubstrate?.trim() || null;
  }
  if (patch.carcassThicknessMm !== undefined) values.carcassThicknessMm = patch.carcassThicknessMm;
  if (patch.drawerBottomThicknessMm !== undefined) {
    values.drawerBottomThicknessMm = patch.drawerBottomThicknessMm;
  }
  if (patch.sideThicknessMm !== undefined) values.sideThicknessMm = patch.sideThicknessMm;
  if (patch.backThicknessMm !== undefined) values.backThicknessMm = patch.backThicknessMm;
  if (patch.bottomThicknessMm !== undefined) values.bottomThicknessMm = patch.bottomThicknessMm;
  if (patch.structureSummary !== undefined) values.structureSummary = patch.structureSummary;
  if (patch.designPrinciples !== undefined) values.designPrinciples = patch.designPrinciples;
  if (patch.hardwareFacts !== undefined) {
    values.hardwareFacts = parseHardwareFacts(patch.hardwareFacts);
  }
  if (patch.otherHardwarePct !== undefined) {
    values.otherHardwarePct =
      patch.otherHardwarePct === null ? null : toNumericString(patch.otherHardwarePct);
  }
  if (patch.regionId !== undefined) values.regionId = patch.regionId || null;
  if (patch.factoryId !== undefined) values.factoryId = patch.factoryId || null;
  if (patch.priceAsOf !== undefined) {
    const parsed = patch.priceAsOf ? parseDateOnlyInput(patch.priceAsOf) : new Date();
    values.priceAsOf = formatDateOnly(parsed ?? new Date());
  }
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
    .set({
      status: 'ready',
      updatedAt: new Date(),
      costComputedAt: null,
      costSummary: null,
    })
    .where(eq(costingProjects.id, projectId));
}

export async function replaceBomLines(projectId: string, lines: ManualBomLineInput[]) {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .update(costingProjects)
      .set({
        ...(lines.length ? { status: 'ready' as const } : {}),
        updatedAt: new Date(),
        costComputedAt: null,
        costSummary: null,
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

  if (
    patch.isManual === true &&
    patch.category === undefined &&
    patch.materialName === undefined &&
    patch.spec === undefined &&
    patch.unit === undefined &&
    patch.qtyNet === undefined &&
    patch.lossRate === undefined &&
    patch.sourceRef === undefined &&
    patch.confidence === undefined &&
    patch.notes === undefined &&
    patch.processOverrides === undefined &&
    patch.unitPriceOverride === undefined &&
    patch.substrate === undefined
  ) {
    const [updated] = await db
      .update(costingBomLines)
      .set({ isManual: true, updatedAt: new Date() })
      .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
      .returning();
    await markProjectReady(projectId);
    return updated ?? null;
  }

  const materialFieldsChanged =
    patch.category !== undefined ||
    patch.materialName !== undefined ||
    patch.spec !== undefined ||
    patch.unit !== undefined ||
    patch.substrate !== undefined;
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
      ...(patch.substrate !== undefined ? { substrate: patch.substrate?.trim() || null } : {}),
      ...quantities,
      ...(patch.sourceRef !== undefined ? { sourceRef: patch.sourceRef?.trim() || null } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.processOverrides !== undefined ? { processOverrides: patch.processOverrides } : {}),
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

export { BindPriceBookError };

export async function bindBomLinePriceBook(
  projectId: string,
  lineId: string,
  priceBookId: string,
) {
  const [project] = await db
    .select()
    .from(costingProjects)
    .where(eq(costingProjects.id, projectId))
    .limit(1);
  if (!project) return null;

  const [existing] = await db
    .select()
    .from(costingBomLines)
    .where(and(eq(costingBomLines.id, lineId), eq(costingBomLines.projectId, projectId)))
    .limit(1);
  if (!existing) return null;

  const [entry] = await db
    .select()
    .from(materialPriceBook)
    .where(eq(materialPriceBook.id, priceBookId))
    .limit(1);
  if (!entry) {
    throw new BindPriceBookError('价目不存在', 400);
  }

  const genericIds = await loadGenericSliceIds();
  const sliceContext: SliceContext = {
    regionId: project.regionId,
    factoryId: project.factoryId,
    ...genericIds,
  };
  const priceAsOf = project.priceAsOf
    ? parseDateOnlyInput(project.priceAsOf) ?? new Date()
    : new Date();

  assertPriceBookBindable(entry, project, sliceContext, priceAsOf);

  const matchScope = resolvePriceBookEntryScope(
    entry,
    genericIds.genericRegionId,
    genericIds.genericFactoryId,
  );

  const [updated] = await db
    .update(costingBomLines)
    .set({
      category: entry.category.trim() || '未分类',
      materialName: entry.materialName.trim(),
      spec: entry.spec?.trim() || null,
      unit: entry.unit.trim(),
      priceBookId: entry.id,
      matchStatus: 'exact',
      matchScope,
      unitPriceOverride: null,
      isManual: true,
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
      .set({
        updatedAt: new Date(),
        costComputedAt: null,
        costSummary: null,
      })
      .where(eq(costingProjects.id, projectId));
  }
  return deleted.length > 0;
}

/** 规则优先：确认设计标准后进入开料步骤，清空 AI 清单占位，不调用 Dify 物料识别。 */
export async function confirmCostingDesignForApply(projectId: string) {
  const [project] = await db.select().from(costingProjects).where(eq(costingProjects.id, projectId)).limit(1);
  if (!project) return null;

  await db.transaction(async (tx) => {
    await tx
      .delete(costingBomLines)
      .where(and(eq(costingBomLines.projectId, projectId), eq(costingBomLines.isManual, false)));
    await tx
      .update(costingProjects)
      .set({
        status: 'draft',
        extractError: null,
        costComputedAt: null,
        costSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(costingProjects.id, projectId));
  });

  await reconcileOrphanExtractRuns(projectId, 'draft');
  return getCostingProject(projectId);
}

export async function applyCostingFacts(projectId: string) {
  const [project] = await db.select().from(costingProjects).where(eq(costingProjects.id, projectId)).limit(1);
  if (!project) return null;
  let packProfile = null;
  if (project.factoryId) {
    const [factory] = await db
      .select({ packProfile: costingFactories.packProfile })
      .from(costingFactories)
      .where(eq(costingFactories.id, project.factoryId))
      .limit(1);
    packProfile = factory?.packProfile ?? null;
  }
  const sourceLines = await listBomLines(projectId);
  const drafts = prepareBomLinesForApplyFacts(
    sourceLines.map((line) => ({
      category: line.category,
      materialName: line.materialName,
      spec: line.spec,
      unit: line.unit,
      qtyNet: line.qtyNet,
      lossRate: line.lossRate,
      sourceRef: line.sourceRef,
      confidence: line.confidence,
      origin: line.origin,
      notes: line.notes,
      substrate: line.substrate,
      processOverrides: line.processOverrides,
      isManual: line.isManual,
      extractSnapshot: line.extractSnapshot ?? null,
    })),
  );
  const pageTexts = (await loadClassifiedPageTexts(projectId)).map((page) => page.text);
  const next = applyFactsToLines(drafts, {
    category: project.category,
    drawerCount: project.drawerCount,
    defaultSubstrate: project.defaultSubstrate,
    carcassThicknessMm: project.carcassThicknessMm,
    drawerBottomThicknessMm: project.drawerBottomThicknessMm,
    sideThicknessMm: project.sideThicknessMm,
    backThicknessMm: project.backThicknessMm,
    bottomThicknessMm: project.bottomThicknessMm,
    structureSummary: project.structureSummary,
    designPrinciples: project.designPrinciples,
    overallSize: await loadProjectOverallSize(projectId),
    hardwareFacts: parseHardwareFacts(project.hardwareFacts),
    packProfile: mergePackProfile(packProfile),
    pageTexts,
  });

  await db.transaction(async (tx) => {
    await replaceProjectBomDrafts(tx, projectId, next, {
      clearNonManualOverrides: true,
      preserveExtractSnapshot: true,
    });
    await tx
      .update(costingProjects)
      .set({
        status: 'ready',
        costComputedAt: null,
        costSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(costingProjects.id, projectId));
  });

  await reconcileOrphanExtractRuns(projectId, 'ready');

  return getCostingProject(projectId);
}

export async function computeCostingProject(projectId: string) {
  const project = await getCostingProject(projectId);
  if (!project) return { ok: false as const, notFound: true as const };
  if (project.computeBlockers.length) {
    return { ok: false as const, blockers: project.computeBlockers, project };
  }
  await db
    .update(costingProjects)
    .set({
      costComputedAt: new Date(),
      costSummary: project.calculatedSummary,
      updatedAt: new Date(),
    })
    .where(eq(costingProjects.id, projectId));
  const next = await getCostingProject(projectId);
  return { ok: true as const, project: next };
}
