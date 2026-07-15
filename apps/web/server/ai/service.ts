import {
  appendMessage,
  ensureConversation,
  updateDifyConversationId,
} from './conversation.js';
import { getAiRuntimeConfig } from './config.js';
import { queryKnowledgeWithFallback } from './providers/index.js';
import { buildFullSkuContext } from './tools/index.js';
import { finishAiRun, startAiRun } from './trace.js';
import type { AiChatInput, AiChatResult } from './types.js';

export async function chat(input: AiChatInput): Promise<AiChatResult> {
  const cfg = getAiRuntimeConfig();
  const conv = await ensureConversation({
    userId: input.userId,
    conversationId: input.conversationId,
    title: input.query,
  });

  if (!conv) {
    throw new Error('Conversation not found');
  }

  await appendMessage({
    conversationId: conv.conversationId,
    role: 'user',
    content: input.query,
  });

  const run = await startAiRun({
    graphName: 'ai_chat',
    userId: input.userId,
    conversationId: conv.conversationId,
    triggeredBy: input.userId,
    input: { query: input.query, context: input.context },
  });

  try {
    const skuContext = input.context ? await buildFullSkuContext(input.context) : null;
    const inputs: Record<string, string> = {};
    if (skuContext) inputs.sku_context = skuContext;
    if (input.context?.skuCode) inputs.sku_code = input.context.skuCode;
    if (input.context?.warehouseCode) inputs.warehouse_code = input.context.warehouseCode;

    const { result, provider, fallback } = await queryKnowledgeWithFallback({
      query: input.query,
      userId: input.userId,
      conversationId: conv.difyConversationId,
      inputs,
    });

    const answer = result.answer;
    const sources = result.sources;
    const mode: AiChatResult['mode'] =
      provider === 'dify' ? 'dify' : provider === 'local-fallback' ? 'local-fallback' : 'local';

    if (result.conversationId && !conv.difyConversationId) {
      await updateDifyConversationId(conv.conversationId, result.conversationId);
    }

    await appendMessage({
      conversationId: conv.conversationId,
      role: 'assistant',
      content: answer,
      sources: sources ?? null,
    });

    await finishAiRun(run.id, {
      success: true,
      output: { mode, fallback, answerLength: answer.length },
    });

    return {
      answer,
      conversationId: conv.conversationId,
      sources,
      mode,
      fallback,
      difyEnabled: cfg.difyEnabled,
      runId: run.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    await finishAiRun(run.id, { success: false, errorMessage: message });
    throw err;
  }
}
