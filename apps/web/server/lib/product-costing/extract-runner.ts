import { and, asc, eq, ne } from 'drizzle-orm';
import {
  db,
  costingAttachments,
  costingBomLines,
  costingExtractRuns,
  costingProjects,
} from '@scm/db';
import { isCostingBomWorkflowEnabled, runWorkflow } from '../../integrations/dify.js';
import { calcQtyGross } from './bom-math.js';
import { mergeBomLines } from './merge-lines.js';
import { parseWorkflowLines } from './parse-workflow-output.js';
import { preprocessDesignFile } from './preprocess/index.js';
import type { CostingBomLineDraft } from './types.js';
import { readFile } from 'node:fs/promises';

const BATCH_SIZE = 4;
const COSTING_KEY = 'DIFY_API_KEY_COSTING_BOM';

export type ExtractPageRange = { pageFrom?: number; pageTo?: number };

async function loadSourceAttachment(projectId: string) {
  const [source] = await db
    .select()
    .from(costingAttachments)
    .where(and(eq(costingAttachments.projectId, projectId), eq(costingAttachments.kind, 'source')))
    .orderBy(asc(costingAttachments.createdAt))
    .limit(1);
  return source ?? null;
}

async function persistPageAttachments(
  projectId: string,
  pages: Awaited<ReturnType<typeof preprocessDesignFile>>,
) {
  await db
    .delete(costingAttachments)
    .where(
      and(
        eq(costingAttachments.projectId, projectId),
        ne(costingAttachments.kind, 'source'),
      ),
    );
  for (const page of pages) {
    await db.insert(costingAttachments).values([
      {
        projectId,
        kind: 'page_image',
        pageNo: page.pageNo,
        fileName: `page-${page.pageNo}.png`,
        contentType: 'image/png',
        storagePath: page.imageStoragePath,
        byteSize: 0,
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
  pages: Awaited<ReturnType<typeof preprocessDesignFile>>,
  userId: string,
): Promise<{ lines: CostingBomLineDraft[]; raw: Record<string, unknown> }> {
  const payload = [];
  for (const page of pages) {
    const img = await readFile(page.imagePath);
    payload.push({
      page: page.pageNo,
      text: page.text,
      image_base64: img.toString('base64'),
    });
  }
  const outputs = await runWorkflow(
    COSTING_KEY,
    {
      category: category || '家具',
      pages_json: JSON.stringify(payload),
    },
    userId,
  );
  return { lines: parseWorkflowLines(outputs), raw: outputs };
}

export async function startExtractRun(
  projectId: string,
  userId: string,
  range?: ExtractPageRange,
): Promise<{ runId: string }> {
  const [project] = await db
    .select()
    .from(costingProjects)
    .where(eq(costingProjects.id, projectId))
    .limit(1);
  if (!project) throw new Error('核算单不存在');

  const source = await loadSourceAttachment(projectId);
  if (!source) throw new Error('请先上传设计方案文件');

  const [run] = await db
    .insert(costingExtractRuns)
    .values({
      projectId,
      status: 'pending',
      pageFrom: range?.pageFrom ?? null,
      pageTo: range?.pageTo ?? null,
      createdBy: userId,
    })
    .returning();

  await db
    .update(costingProjects)
    .set({ status: 'extracting', extractError: null, updatedAt: new Date() })
    .where(eq(costingProjects.id, projectId));

  void executeExtractRun(run.id).catch(() => {
    /* errors persisted inside */
  });

  return { runId: run.id };
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
    .set({ status: 'running', startedAt: new Date(), errorMessage: null })
    .where(eq(costingExtractRuns.id, runId));

  try {
    if (!isCostingBomWorkflowEnabled()) {
      throw new Error('未配置 DIFY_API_KEY_COSTING_BOM，无法 AI 拆解；可手工维护清单后导出');
    }

    const source = await loadSourceAttachment(run.projectId);
    if (!source) throw new Error('缺少方案原件');

    let pages = await preprocessDesignFile({
      projectId: run.projectId,
      sourceStoragePath: source.storagePath,
      contentType: source.contentType,
      fileName: source.fileName,
    });
    if (run.pageFrom != null || run.pageTo != null) {
      const from = run.pageFrom ?? 1;
      const to = run.pageTo ?? Number.MAX_SAFE_INTEGER;
      pages = pages.filter((p) => p.pageNo >= from && p.pageNo <= to);
    }
    if (!pages.length) throw new Error('预处理未得到任何页面');

    await persistPageAttachments(run.projectId, pages);

    const allDrafts: CostingBomLineDraft[] = [];
    let lastRaw: Record<string, unknown> = {};
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      const { lines, raw } = await callDifyBatch(
        project.category ?? '',
        batch,
        run.createdBy ?? 'costing-extract',
      );
      allDrafts.push(...lines);
      lastRaw = raw;
    }

    const merged = mergeBomLines(allDrafts);
    if (!merged.length) {
      const rawHint = Object.keys(lastRaw).length
        ? ` outputs keys=${Object.keys(lastRaw).join(',')}`
        : ' outputs 为空';
      throw new Error(
        `AI 未返回有效清单行，请检查 Dify 结束节点是否输出 lines，并确认 LLM/Code 节点运行成功。${rawHint}`,
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(costingBomLines)
        .where(
          and(eq(costingBomLines.projectId, run.projectId), eq(costingBomLines.isManual, false)),
        );

      const manual = await tx
        .select()
        .from(costingBomLines)
        .where(and(eq(costingBomLines.projectId, run.projectId), eq(costingBomLines.isManual, true)))
        .orderBy(asc(costingBomLines.lineNo));

      let lineNo = 1;
      const inserts = [
        ...manual.map((m) => ({
          id: m.id,
          lineNo: lineNo++,
        })),
        ...merged.map((d) => ({
          projectId: run.projectId,
          lineNo: lineNo++,
          category: d.category,
          materialName: d.materialName,
          spec: d.spec || null,
          unit: d.unit,
          qtyNet: String(d.qtyNet),
          lossRate: String(d.lossRate),
          qtyGross: String(calcQtyGross(d.qtyNet, d.lossRate)),
          sourceRef: d.sourceRef || null,
          confidence: d.confidence,
          notes: d.notes || null,
          isManual: false,
          extractRunId: runId,
        })),
      ];

      for (const m of manual) {
        const next = inserts.find((x) => 'id' in x && x.id === m.id) as { lineNo: number };
        await tx
          .update(costingBomLines)
          .set({ lineNo: next.lineNo, updatedAt: new Date() })
          .where(eq(costingBomLines.id, m.id));
      }

      const aiRows = inserts.filter((x) => !('id' in x)) as Array<{
        projectId: string;
        lineNo: number;
        category: string;
        materialName: string;
        spec: string | null;
        unit: string;
        qtyNet: string;
        lossRate: string;
        qtyGross: string;
        sourceRef: string | null;
        confidence: 'high' | 'medium' | 'low';
        notes: string | null;
        isManual: boolean;
        extractRunId: string;
      }>;
      if (aiRows.length) await tx.insert(costingBomLines).values(aiRows);

      await tx
        .update(costingExtractRuns)
        .set({
          status: 'succeeded',
          finishedAt: new Date(),
          rawResponse: lastRaw,
        })
        .where(eq(costingExtractRuns.id, runId));

      await tx
        .update(costingProjects)
        .set({ status: 'bom_draft', extractError: null, updatedAt: new Date() })
        .where(eq(costingProjects.id, run.projectId));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

/** Test helper: apply AI drafts while preserving manual semantics without Dify. */
export function mergeAiWithManual(
  manual: CostingBomLineDraft[],
  ai: CostingBomLineDraft[],
): CostingBomLineDraft[] {
  return [...manual, ...mergeBomLines(ai)];
}
