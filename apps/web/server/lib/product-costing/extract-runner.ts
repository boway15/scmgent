import { access, readFile } from 'node:fs/promises';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  costingAttachments,
  costingBomLines,
  costingExtractRuns,
  costingProjects,
  db,
  materialPriceBook,
} from '@scm/db';
import { isCostingBomWorkflowEnabled, runWorkflow } from '../../integrations/dify.js';
import { calcQtyGross } from './bom-math.js';
import { applyCategoryTemplate } from './category-template.js';
import { preparePageImageBase64 } from './compress-page-image.js';
import { matchPriceBook } from './match-price.js';
import { classifyPage, shouldSendPageToDify } from './page-classify.js';
import { parseWorkflowLines } from './parse-workflow-output.js';
import { preprocessDesignFile, type PageBundle } from './preprocess/index.js';
import { resolveStoragePath } from './storage.js';
import type { CostingBomLineDraft, PriceBookEntry } from './types.js';

const COSTING_KEY = 'DIFY_API_KEY_COSTING_BOM';
const BATCH_SIZE = Math.max(
  1,
  Number(process.env.COSTING_EXTRACT_BATCH_SIZE ?? 1) || 1,
);

export type ExtractPageRange = { pageFrom?: number; pageTo?: number };

export function planExtractBatches<T>(pages: T[], batchSize: number): T[][] {
  const size = Math.max(1, Number(batchSize) || 1);
  const batches: T[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    batches.push(pages.slice(index, index + size));
  }
  return batches;
}

async function loadSourceAttachment(projectId: string) {
  const [source] = await db
    .select()
    .from(costingAttachments)
    .where(and(eq(costingAttachments.projectId, projectId), eq(costingAttachments.kind, 'source')))
    .orderBy(asc(costingAttachments.createdAt))
    .limit(1);
  return source ?? null;
}

async function persistPageAttachments(projectId: string, pages: PageBundle[]): Promise<void> {
  await db
    .delete(costingAttachments)
    .where(
      and(eq(costingAttachments.projectId, projectId), ne(costingAttachments.kind, 'source')),
    );

  for (const page of pages) {
    const image = await readFile(page.imagePath);
    await db.insert(costingAttachments).values([
      {
        projectId,
        kind: 'page_image',
        pageNo: page.pageNo,
        fileName: `page-${page.pageNo}.png`,
        contentType: 'image/png',
        storagePath: page.imageStoragePath,
        byteSize: image.byteLength,
      },
      ...(page.textStoragePath
        ? [
            {
              projectId,
              kind: 'page_text' as const,
              pageNo: page.pageNo,
              fileName: `page-${page.pageNo}.txt`,
              contentType: 'text/plain',
              storagePath: page.textStoragePath,
              byteSize: Buffer.byteLength(page.text, 'utf8'),
            },
          ]
        : []),
    ]);
  }
}

async function callDifyBatch(
  category: string,
  pages: Array<PageBundle & { pageType: ReturnType<typeof classifyPage> }>,
  userId: string,
): Promise<CostingBomLineDraft[]> {
  const payload = await Promise.all(
    pages.map(async (page) => ({
      page: page.pageNo,
      page_type: page.pageType,
      text: page.text,
      image_base64: await preparePageImageBase64(await readFile(page.imagePath)),
    })),
  );
  const outputs = await runWorkflow(
    COSTING_KEY,
    {
      category: category || '家具',
      pages_json: JSON.stringify(payload),
    },
    userId,
  );
  const lines = parseWorkflowLines(outputs);
  if (!lines.length) {
    throw new Error('Dify 未返回有效清单行');
  }
  return lines.map((line) => ({
    ...line,
    sourceRef: line.sourceRef || (pages.length === 1 ? `p${pages[0]!.pageNo}` : ''),
  }));
}

function sourceRefContainsPage(sourceRef: string | null, pageNos: Set<number>): boolean {
  if (!sourceRef) return false;
  const matches = sourceRef.matchAll(/(?:\bp(?:age)?\s*[-#:]?\s*|第\s*)(\d+)(?:\s*页)?/gi);
  return Array.from(matches).some((match) => pageNos.has(Number(match[1])));
}

async function loadActivePriceBook(tx: typeof db): Promise<PriceBookEntry[]> {
  return tx
    .select({
      id: materialPriceBook.id,
      materialName: materialPriceBook.materialName,
      spec: materialPriceBook.spec,
      unit: materialPriceBook.unit,
    })
    .from(materialPriceBook)
    .where(eq(materialPriceBook.isActive, true));
}

function toInsertValues(
  projectId: string,
  runId: string,
  lineNo: number,
  draft: CostingBomLineDraft,
  priceBook: PriceBookEntry[],
) {
  const match = matchPriceBook(draft, priceBook);
  return {
    projectId,
    lineNo,
    category: draft.category,
    materialName: draft.materialName,
    spec: draft.spec || null,
    unit: draft.unit,
    qtyNet: String(draft.qtyNet),
    lossRate: String(draft.lossRate),
    qtyGross: String(calcQtyGross(draft.qtyNet, draft.lossRate)),
    sourceRef: draft.sourceRef || null,
    confidence: draft.confidence,
    notes: draft.notes || null,
    isManual: false,
    extractRunId: runId,
    origin: draft.origin,
    priceBookId: match.priceBookId,
    matchStatus: match.status,
  };
}

async function persistSuccessfulBatch(input: {
  projectId: string;
  runId: string;
  drafts: CostingBomLineDraft[];
  pageNos: number[];
  clearWholeAiList: boolean;
}): Promise<void> {
  await db.transaction(async (tx) => {
    if (input.clearWholeAiList) {
      await tx
        .delete(costingBomLines)
        .where(
          and(
            eq(costingBomLines.projectId, input.projectId),
            eq(costingBomLines.isManual, false),
          ),
        );
    } else {
      const existingAi = await tx
        .select({ id: costingBomLines.id, sourceRef: costingBomLines.sourceRef })
        .from(costingBomLines)
        .where(
          and(
            eq(costingBomLines.projectId, input.projectId),
            eq(costingBomLines.isManual, false),
          ),
        );
      const pageNos = new Set(input.pageNos);
      const staleIds = existingAi
        .filter((line) => sourceRefContainsPage(line.sourceRef, pageNos))
        .map((line) => line.id);
      if (staleIds.length) {
        await tx.delete(costingBomLines).where(inArray(costingBomLines.id, staleIds));
      }
    }

    const existing = await tx
      .select({ lineNo: costingBomLines.lineNo })
      .from(costingBomLines)
      .where(eq(costingBomLines.projectId, input.projectId));
    const firstLineNo = existing.reduce((max, line) => Math.max(max, line.lineNo), 0) + 1;
    const priceBook = await loadActivePriceBook(tx as typeof db);
    await tx
      .insert(costingBomLines)
      .values(
        input.drafts.map((draft, index) =>
          toInsertValues(input.projectId, input.runId, firstLineNo + index, draft, priceBook),
        ),
      );
  });
}

async function applyTemplateAndFinish(
  projectId: string,
  runId: string,
  category: string | null,
  batchCurrent: number,
  batchTotal: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const currentAi = await tx
      .select()
      .from(costingBomLines)
      .where(
        and(eq(costingBomLines.projectId, projectId), eq(costingBomLines.isManual, false)),
      )
      .orderBy(asc(costingBomLines.lineNo));
    const priceBook = await loadActivePriceBook(tx as typeof db);
    for (const line of currentAi) {
      const match = matchPriceBook(
        {
          materialName: line.materialName,
          spec: line.spec ?? '',
          unit: line.unit,
        },
        priceBook,
      );
      if (line.matchStatus !== match.status || line.priceBookId !== match.priceBookId) {
        await tx
          .update(costingBomLines)
          .set({
            matchStatus: match.status,
            priceBookId: match.priceBookId,
            updatedAt: new Date(),
          })
          .where(eq(costingBomLines.id, line.id));
      }
    }
    const drafts: CostingBomLineDraft[] = currentAi.map((line) => ({
      category: line.category,
      materialName: line.materialName,
      spec: line.spec ?? '',
      unit: line.unit,
      qtyNet: Number(line.qtyNet),
      lossRate: Number(line.lossRate),
      sourceRef: line.sourceRef ?? '',
      confidence: line.confidence,
      origin: line.origin === 'template' ? 'template' : 'explicit',
      notes: line.notes ?? '',
    }));
    const completed = applyCategoryTemplate(category, drafts);
    const templateAdditions = completed.slice(drafts.length);

    if (templateAdditions.length) {
      const allLines = await tx
        .select({ lineNo: costingBomLines.lineNo })
        .from(costingBomLines)
        .where(eq(costingBomLines.projectId, projectId));
      const firstLineNo = allLines.reduce((max, line) => Math.max(max, line.lineNo), 0) + 1;
      await tx
        .insert(costingBomLines)
        .values(
          templateAdditions.map((draft, index) =>
            toInsertValues(projectId, runId, firstLineNo + index, draft, priceBook),
          ),
        );
    }

    await tx
      .update(costingExtractRuns)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        rawResponse: { batchCurrent, batchTotal },
      })
      .where(eq(costingExtractRuns.id, runId));
    await tx
      .update(costingProjects)
      .set({ status: 'ready', extractError: null, updatedAt: new Date() })
      .where(eq(costingProjects.id, projectId));
  });
}

export async function startExtractRun(
  projectId: string,
  userId: string,
  range?: ExtractPageRange,
): Promise<{ runId: string }> {
  const [project] = await db
    .select({ id: costingProjects.id })
    .from(costingProjects)
    .where(eq(costingProjects.id, projectId))
    .limit(1);
  if (!project) throw new Error('核算单不存在');
  if (!(await loadSourceAttachment(projectId))) throw new Error('请先上传设计方案文件');

  const [run] = await db
    .insert(costingExtractRuns)
    .values({
      projectId,
      status: 'pending',
      pageFrom: range?.pageFrom ?? null,
      pageTo: range?.pageTo ?? null,
      createdBy: userId,
    })
    .returning({ id: costingExtractRuns.id });
  await db
    .update(costingProjects)
    .set({ status: 'extracting', extractError: null, updatedAt: new Date() })
    .where(eq(costingProjects.id, projectId));

  void executeExtractRun(run.id).catch(() => undefined);
  return { runId: run.id };
}

export async function getExtractRun(projectId: string, runId: string) {
  const [run] = await db
    .select({
      id: costingExtractRuns.id,
      status: costingExtractRuns.status,
      pageFrom: costingExtractRuns.pageFrom,
      pageTo: costingExtractRuns.pageTo,
      rawResponse: costingExtractRuns.rawResponse,
      errorMessage: costingExtractRuns.errorMessage,
      startedAt: costingExtractRuns.startedAt,
      finishedAt: costingExtractRuns.finishedAt,
    })
    .from(costingExtractRuns)
    .where(
      and(
        eq(costingExtractRuns.id, runId),
        eq(costingExtractRuns.projectId, projectId),
      ),
    )
    .limit(1);
  if (!run) return null;
  const progress =
    run.rawResponse && typeof run.rawResponse === 'object'
      ? (run.rawResponse as Record<string, unknown>)
      : {};
  return {
    ...run,
    batchCurrent: Number(progress.batchCurrent) || 0,
    batchTotal: Number(progress.batchTotal) || 0,
  };
}

export async function readCostingPageImage(
  projectId: string,
  pageNo: number,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const [attachment] = await db
    .select({
      storagePath: costingAttachments.storagePath,
      contentType: costingAttachments.contentType,
    })
    .from(costingAttachments)
    .where(
      and(
        eq(costingAttachments.projectId, projectId),
        eq(costingAttachments.kind, 'page_image'),
        eq(costingAttachments.pageNo, pageNo),
      ),
    )
    .limit(1);
  if (!attachment) return null;
  return {
    buffer: await readFile(resolveStoragePath(attachment.storagePath)),
    contentType: attachment.contentType,
  };
}

export async function executeExtractRun(runId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(costingExtractRuns)
    .where(eq(costingExtractRuns.id, runId))
    .limit(1);
  if (!run) return;
  const [project] = await db
    .select()
    .from(costingProjects)
    .where(eq(costingProjects.id, run.projectId))
    .limit(1);
  if (!project) return;

  await db
    .update(costingExtractRuns)
    .set({
      status: 'running',
      startedAt: new Date(),
      errorMessage: null,
      rawResponse: { batchCurrent: 0, batchTotal: 0 },
    })
    .where(eq(costingExtractRuns.id, runId));

  try {
    if (!isCostingBomWorkflowEnabled()) {
      throw new Error('未配置 DIFY_API_KEY_COSTING_BOM，无法 AI 拆解；可手工维护清单');
    }
    const source = await loadSourceAttachment(run.projectId);
    if (!source) throw new Error('缺少方案原件，请先上传设计方案');
    try {
      await access(resolveStoragePath(source.storagePath));
    } catch {
      throw new Error('方案原件文件已丢失，请重新上传 PPT/PDF 后再拆解');
    }

    const allPages = await preprocessDesignFile({
      projectId: run.projectId,
      sourceStoragePath: source.storagePath,
      contentType: source.contentType,
      fileName: source.fileName,
    });
    if (allPages.length > 20) {
      throw new Error('超过 20 页，请拆分或指定页范围');
    }
    if (!allPages.length) throw new Error('预处理未得到任何页面');
    await persistPageAttachments(run.projectId, allPages);

    const from = run.pageFrom ?? 1;
    const to = run.pageTo ?? Number.MAX_SAFE_INTEGER;
    const filteredPages = allPages
      .filter((page) => page.pageNo >= from && page.pageNo <= to)
      .map((page) => ({ ...page, pageType: classifyPage(page.pageNo, page.text) }))
      .filter((page) => shouldSendPageToDify(page.pageType, page.text));
    if (!filteredPages.length) throw new Error('指定范围内没有需要 AI 解析的页面');

    const batches = planExtractBatches(filteredPages, BATCH_SIZE);
    const batchTotal = batches.length;
    await db
      .update(costingExtractRuns)
      .set({ rawResponse: { batchCurrent: 0, batchTotal } })
      .where(eq(costingExtractRuns.id, runId));

    const isFullExtract = run.pageFrom == null && run.pageTo == null;
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index]!;
      const pageNos = batch.map((page) => page.pageNo);
      const pageLabel =
        pageNos.length === 1
          ? `第 ${pageNos[0]} 页`
          : `第 ${pageNos[0]}-${pageNos[pageNos.length - 1]} 页`;
      try {
        const drafts = await callDifyBatch(
          project.category ?? '',
          batch,
          run.createdBy ?? 'costing-extract',
        );
        await persistSuccessfulBatch({
          projectId: run.projectId,
          runId,
          drafts,
          pageNos,
          clearWholeAiList: isFullExtract && index === 0,
        });
      } catch (error) {
        await db
          .update(costingExtractRuns)
          .set({ rawResponse: { batchCurrent: index + 1, batchTotal } })
          .where(eq(costingExtractRuns.id, runId));
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${pageLabel} ${detail}`);
      }
      await db
        .update(costingExtractRuns)
        .set({ rawResponse: { batchCurrent: index + 1, batchTotal } })
        .where(eq(costingExtractRuns.id, runId));
    }

    await applyTemplateAndFinish(
      run.projectId,
      runId,
      project.category,
      batchTotal,
      batchTotal,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(costingExtractRuns)
      .set({ status: 'failed', finishedAt: new Date(), errorMessage: message })
      .where(eq(costingExtractRuns.id, runId));
    await db
      .update(costingProjects)
      .set({ status: 'extract_failed', extractError: message, updatedAt: new Date() })
      .where(eq(costingProjects.id, run.projectId));
  }
}
