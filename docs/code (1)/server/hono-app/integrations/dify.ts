/**
 * Dify integration — reserved for future phase.
 * MVP uses mock responses when DIFY_API_KEY_* is not configured.
 */

const DIFY_ENABLED =
  !!process.env.DIFY_API_KEY_KNOWLEDGE &&
  process.env.DIFY_API_KEY_KNOWLEDGE !== 'app-';

const DIFY_BASE_URL = process.env.DIFY_BASE_URL ?? 'http://localhost:8080/v1';

type DifyChatResponse = {
  answer: string;
  conversation_id?: string;
  metadata?: {
    retriever_resources?: Array<{ document_name: string; content: string }>;
  };
};

export function isDifyEnabled(): boolean {
  return DIFY_ENABLED;
}

export async function queryKnowledge(
  query: string,
  userId: string,
  conversationId?: string,
): Promise<{ answer: string; conversationId?: string; sources?: unknown[]; mock?: boolean }> {
  if (!DIFY_ENABLED) {
    console.info('[dify] Mock mode — Dify integration not enabled for MVP');
    return {
      mock: true,
      answer: `【Mock 模式】Dify 对接待后续 Phase 启用。\n\n您的问题：「${query}」\n\n供应链知识库上线后，将基于 Dify RAG 返回 SOP/政策文档的准确答案。`,
      conversationId,
    };
  }

  const apiKey = process.env.DIFY_API_KEY_KNOWLEDGE!;

  const res = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {},
      query,
      response_mode: 'blocking',
      conversation_id: conversationId,
      user: userId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dify API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as DifyChatResponse;
  return {
    answer: data.answer,
    conversationId: data.conversation_id,
    sources: data.metadata?.retriever_resources,
  };
}

export async function runWorkflow(
  apiKeyEnv: string,
  inputs: Record<string, unknown>,
  userId = 'system-task',
): Promise<Record<string, unknown>> {
  const apiKey = process.env[apiKeyEnv];

  if (!apiKey || apiKey === 'app-') {
    throw new Error(`${apiKeyEnv} is not configured — use local algorithm for MVP`);
  }

  const res = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs,
      response_mode: 'blocking',
      user: userId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dify workflow error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { data?: { outputs?: Record<string, unknown> } };
  return data.data?.outputs ?? {};
}
