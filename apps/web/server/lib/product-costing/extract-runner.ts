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
import { buildDifyPagesJson, preparePageImage, isPlaceholderPageImage } from './compress-page-image.js';
import { appendMatchHint, matchPriceBook } from './match-price.js';
import { classifyPage, shouldSendPageToDify } from './page-classify.js';
import { parseWorkflowLines } from './parse-workflow-output.js';
import { preprocessDesignFile, type PageBundle } from './preprocess/index.js';
import { resolveStoragePath } from './storage.js';
import type { CostingBomLineDraft, PriceBookEntry } from './types.js';

const COSTING_KEY = 'DIFY_API_KEY_COSTING_BOM';
const BATCH_SIZE = 1;
/** Dify `pages_json` input max is 500k chars; image batches must stay one page. */
const _configuredBatchSize = Math.max(
  1,
  Number(process.env.COSTING_EXTRACT_BATCH_SIZE ?? 1) || 1,
);
if (_configuredBatchSize > 1) {
  console.warn(
    `[costing-extract] COSTING_EXTRACT_BATCH_SIZE=${_configuredBatchSize} ignored; forcing 1 page per Dify batch (pages_json 500k limit)`,
  );
}
const STALE_EXTRACT_RUN_MS = 15 * 60 * 1000;

export type ExtractPageRange = { pageFrom?: number; pageTo?: number };

export type ExtractRunProgress = {
  batchCurrent: number;
  batchTotal: number;
  lastHeartbeatAt: string;
};

export class ExtractAlreadyRunningError extends Error {
  constructor() {
    super('正在解析中，请稍候');
    this.name = 'ExtractAlreadyRunningError';
  }
}

export class ExtractRunAbortedError extends Error {
  constructor() {
    super('解析任务已中止');
    this.name = 'ExtractRunAbortedError';
  }
}

export function buildExtractProgress(
  batchCurrent: number,
  batchTotal: number,
  at: Date = new Date(),
): ExtractRunProgress {
  return {
    batchCurrent,
    batchTotal,
    lastHeartbeatAt: at.toISOString(),
  };
}

export function extractRunLastActivityAt(run: {
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  rawResponse?: unknown;
}): Date {
  const heartbeat = extractHeartbeatFromProgress(run.rawResponse);
  if (heartbeat) return heartbeat;
  if (run.status === 'pending') return run.createdAt;
  return run.startedAt ?? run.createdAt;
}

function extractHeartbeatFromProgress(rawResponse: unknown): Date | null {
  if (!rawResponse || typeof rawResponse !== 'object') return null;
  const value = (rawResponse as Record<string, unknown>).lastHeartbeatAt;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function hasActiveExtractRun(
  projectStatus: string,
  runs: ReadonlyArray<{ status: string }>,
): boolean {
  return (
    projectStatus === 'extracting' ||
    runs.some((run) => run.status === 'pending' || run.status === 'running')
  );
}

export function planExtractBatches<T>(pages: T[], batchSize: number): T[][] {
  const size = Math.max(1, Number(batchSize) || 1);
  const batches: T[][] = [];
  for (let index = 0; index < pages.length; index += size) {
    batches.push(pages.slice(index, index + size));
  }
  return batches;
}

export function selectPagesInRange<T extends { pageNo: number }>(
  pages: T[],
  range: ExtractPageRange,
): T[] {
  const from = range.pageFrom ?? 1;
  const to = range.pageTo ?? Number.MAX_SAFE_INTEGER;
  const selected = pages.filter((page) => page.pageNo >= from && page.pageNo <= to);
  if (selected.length > 20) {
    throw new Error('超过 20 页，请拆分或指定页范围');
  }
  return selected;
}

export function isStaleExtractRun(
  run: {
    status: string;
    startedAt: Date | null;
    createdAt: Date;
    rawResponse?: unknown;
  },
  now = new Date(),
): boolean {
  if (run.status !== 'pending' && run.status !== 'running') return false;
  const lastActivity = extractRunLastActivityAt(run);
  return now.getTime() - lastActivity.getTime() > STALE_EXTRACT_RUN_MS;
}

async function ensureRunStillActive(runId: string): Promise<void> {
  const [run] = await db
    .select({ status: costingExtractRuns.status })
    .from(costingExtractRuns)
    .where(eq(costingExtractRuns.id, runId))
    .limit(1);
  if (!run || run.status !== 'running') {
    throw new ExtractRunAbortedError();
  }
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
    pages.map(async (page) => {
      const imageBuffer = await readFile(page.imagePath);
      const hasRealImage = !isPlaceholderPageImage(imageBuffer);
      const image = await preparePageImage(imageBuffer);
      if (hasRealImage && !image.base64) {
        throw new Error(
          `第 ${page.pageNo} 页页图过大且压缩失败，无法多模态解析；请缩小 PPT 或联系管理员`,
        );
      }
      return {
        page: page.pageNo,
        page_type: page.pageType,
        text: page.text,
        image_base64: image.base64,
        image_mime_type: image.mimeType,
      };
    }),
  );
  const outputs = await runWorkflow(
    COSTING_KEY,
    {
      category: category || '家具',
      pages_json: buildDifyPagesJson(payload),
    },
    userId,
  );
  const lines = parseWorkflowLines(outputs);
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
    notes: appendMatchHint(draft.notes, match.status === 'unmatched' ? match.hint : undefined),
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
      const notes = appendMatchHint(
        line.notes,
        match.status === 'unmatched' ? match.hint : undefined,
      );
      if (
        line.matchStatus !== match.status ||
        line.priceBookId !== match.priceBookId ||
        line.notes !== notes
      ) {
        await tx
          .update(costingBomLines)
          .set({
            matchStatus: match.status,
            priceBookId: match.priceBookId,
            notes,
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
        rawResponse: buildExtractProgress(batchCurrent, batchTotal),
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
  const runId = await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: costingProjects.id, status: costingProjects.status })
      .from(costingProjects)
      .where(eq(costingProjects.id, projectId))
      .limit(1)
      .for('update');
    if (!project) throw new Error('核算单不存在');

    const activeRuns = await tx
      .select({
        id: costingExtractRuns.id,
        status: costingExtractRuns.status,
        startedAt: costingExtractRuns.startedAt,
        createdAt: costingExtractRuns.createdAt,
        rawResponse: costingExtractRuns.rawResponse,
      })
      .from(costingExtractRuns)
      .where(
        and(
          eq(costingExtractRuns.projectId, projectId),
          inArray(costingExtractRuns.status, ['pending', 'running']),
        ),
      );
    const staleRuns = activeRuns.filter((run) => isStaleExtractRun(run));
    const activeRunIds = new Set(staleRuns.map((run) => run.id));
    const currentRuns = activeRuns.filter((run) => !activeRunIds.has(run.id));
    let projectStatus = project.status;
    if (staleRuns.length) {
      const message = '解析任务超过 15 分钟无进度更新，已自动标记失败，请重试';
      await tx
        .update(costingExtractRuns)
        .set({ status: 'failed', finishedAt: new Date(), errorMessage: message })
        .where(inArray(costingExtractRuns.id, staleRuns.map((run) => run.id)));
      if (!currentRuns.length) {
        await tx
          .update(costingProjects)
          .set({ status: 'extract_failed', extractError: message, updatedAt: new Date() })
          .where(eq(costingProjects.id, projectId));
        projectStatus = 'extract_failed';
      }
    }
    if (hasActiveExtractRun(projectStatus, currentRuns)) {
      throw new ExtractAlreadyRunningError();
    }

    const [source] = await tx
      .select({ id: costingAttachments.id })
      .from(costingAttachments)
      .where(
        and(
          eq(costingAttachments.projectId, projectId),
          eq(costingAttachments.kind, 'source'),
        ),
      )
      .limit(1);
    if (!source) throw new Error('请先上传设计方案文件');

    const [run] = await tx
      .insert(costingExtractRuns)
      .values({
        projectId,
        status: 'pending',
        pageFrom: range?.pageFrom ?? null,
        pageTo: range?.pageTo ?? null,
        createdBy: userId,
      })
      .returning({ id: costingExtractRuns.id });
    await tx
      .update(costingProjects)
      .set({ status: 'extracting', extractError: null, updatedAt: new Date() })
      .where(eq(costingProjects.id, projectId));
    return run.id;
  });

  void executeExtractRun(runId).catch(() => undefined);
  return { runId };
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
      createdAt: costingExtractRuns.createdAt,
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
  if (isStaleExtractRun(run)) {
    const message = '解析任务超过 15 分钟无进度更新，已自动标记失败，请重试';
    const finishedAt = new Date();
    await db
      .update(costingExtractRuns)
      .set({ status: 'failed', finishedAt, errorMessage: message })
      .where(eq(costingExtractRuns.id, run.id));
    await db
      .update(costingProjects)
      .set({ status: 'extract_failed', extractError: message, updatedAt: finishedAt })
      .where(eq(costingProjects.id, projectId));
    run.status = 'failed';
    run.finishedAt = finishedAt;
    run.errorMessage = message;
  }
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
      rawResponse: buildExtractProgress(0, 0),
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
    if (!allPages.length) throw new Error('预处理未得到任何页面');
    await persistPageAttachments(run.projectId, allPages);

    const rangedPages = selectPagesInRange(allPages, {
      pageFrom: run.pageFrom ?? undefined,
      pageTo: run.pageTo ?? undefined,
    }).map((page) => ({ ...page, pageType: classifyPage(page.pageNo, page.text) }));

    const filteredPages: Array<(typeof rangedPages)[number]> = [];
    for (const page of rangedPages) {
      const imageBuffer = await readFile(page.imagePath);
      const hasRealImage = !isPlaceholderPageImage(imageBuffer);
      if (
        shouldSendPageToDify(page.pageType, page.text, {
          pageNo: page.pageNo,
          hasRealImage,
        })
      ) {
        filteredPages.push(page);
      }
    }
    if (!filteredPages.length) throw new Error('指定范围内没有需要 AI 解析的页面');

    const batches = planExtractBatches(filteredPages, BATCH_SIZE);
    const batchTotal = batches.length;
    await db
      .update(costingExtractRuns)
      .set({ rawResponse: buildExtractProgress(0, batchTotal) })
      .where(eq(costingExtractRuns.id, runId));

    const isFullExtract = run.pageFrom == null && run.pageTo == null;
    let clearedAiList = false;
    for (let index = 0; index < batches.length; index += 1) {
      await ensureRunStillActive(runId);
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
        await ensureRunStillActive(runId);
        if (drafts.length) {
          await persistSuccessfulBatch({
            projectId: run.projectId,
            runId,
            drafts,
            pageNos,
            clearWholeAiList: isFullExtract && !clearedAiList,
          });
          clearedAiList = true;
        }
      } catch (error) {
        if (error instanceof ExtractRunAbortedError) throw error;
        await db
          .update(costingExtractRuns)
          .set({ rawResponse: buildExtractProgress(index + 1, batchTotal) })
          .where(eq(costingExtractRuns.id, runId));
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${pageLabel} ${detail}`);
      }
      await db
        .update(costingExtractRuns)
        .set({ rawResponse: buildExtractProgress(index + 1, batchTotal) })
        .where(eq(costingExtractRuns.id, runId));
    }

    const aiLines = await db
      .select({ id: costingBomLines.id })
      .from(costingBomLines)
      .where(
        and(eq(costingBomLines.projectId, run.projectId), eq(costingBomLines.isManual, false)),
      )
      .limit(1);
    if (!aiLines.length) {
      throw new Error(
        '所有页面均未解析出材料清单，请确认 Dify 已使用多模态模型，且设计方案含爆炸图/尺寸/CMF 等页',
      );
    }

    await ensureRunStillActive(runId);
    await applyTemplateAndFinish(
      run.projectId,
      runId,
      project.category,
      batchTotal,
      batchTotal,
    );
  } catch (error) {
    if (error instanceof ExtractRunAbortedError) return;
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
