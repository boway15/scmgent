/**
 * Dify integration — Chat RAG + Workflow API.
 * API keys stay server-side only; unset keys keep local algorithm / FAQ paths.
 */

import { existsSync } from 'fs';

const WORKFLOW_TIMEOUT_MS = Number(process.env.DIFY_WORKFLOW_TIMEOUT_MS ?? 120_000);

function runningInDocker(): boolean {
  return process.env.RUNNING_IN_DOCKER === 'true' || existsSync('/.dockerenv');
}

/** Docker 容器内 127.0.0.1 指向容器自身，需改 host.docker.internal 访问宿主机 Dify */
export function resolveDifyBaseUrl(rawUrl?: string): string {
  const raw = (rawUrl ?? process.env.DIFY_BASE_URL ?? 'http://localhost:8080/v1').replace(/\/$/, '');
  if (!runningInDocker()) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      url.hostname = process.env.DIFY_DOCKER_HOST?.trim() || 'host.docker.internal';
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export function getDifyBaseUrl(): string {
  return resolveDifyBaseUrl();
}

export type DifySource = { document_name: string; content: string };

export type DifyChatResult = {
  answer: string;
  conversationId?: string;
  sources?: DifySource[];
  mock?: boolean;
};

type DifyChatResponse = {
  answer: string;
  conversation_id?: string;
  metadata?: {
    retriever_resources?: Array<{ document_name: string; content: string }>;
  };
};

/** True when env var is set and not a documented placeholder. */
export function isDifyKeyConfigured(envName: string): boolean {
  const value = process.env[envName]?.trim();
  if (!value) return false;
  const placeholders = new Set(['app-', 'app-xxxx', 'app-xxx', 'app-yyyy', 'app-zzzz']);
  return !placeholders.has(value);
}

export function isDifyEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_KNOWLEDGE');
}

export function isReplenishmentWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_REPLENISHMENT');
}

export function isAlertWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_ALERT');
}

export function isNewsIntelWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_NEWS_INTEL');
}

export function isCsReplyQualityWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_CS_REPLY_QUALITY');
}

export function isSalesForecastWorkflowEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_SALES_FORECAST');
}

export function getDifyConfigSummary() {
  return {
    mode: isDifyEnabled() ? ('dify' as const) : ('local' as const),
    difyEnabled: isDifyEnabled(),
    replenishmentWorkflow: isReplenishmentWorkflowEnabled(),
    alertWorkflow: isAlertWorkflowEnabled(),
    newsIntelWorkflow: isNewsIntelWorkflowEnabled(),
    csReplyQualityWorkflow: isCsReplyQualityWorkflowEnabled(),
    salesForecastWorkflow: isSalesForecastWorkflowEnabled(),
    baseUrl: getDifyBaseUrl(),
  };
}

function normalizeSources(
  resources?: Array<{ document_name: string; content: string }>,
): DifySource[] | undefined {
  if (!resources?.length) return undefined;
  return resources.map((r) => ({
    document_name: r.document_name,
    content: r.content,
  }));
}

export async function queryKnowledge(
  query: string,
  userId: string,
  options?: {
    conversationId?: string;
    inputs?: Record<string, string>;
  },
): Promise<DifyChatResult> {
  if (!isDifyEnabled()) {
    throw new Error('Dify knowledge API is not configured');
  }

  const apiKey = process.env.DIFY_API_KEY_KNOWLEDGE!;
  const inputs = options?.inputs ?? {};

  const res = await fetch(`${getDifyBaseUrl()}/chat-messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs,
      query,
      response_mode: 'blocking',
      conversation_id: options?.conversationId,
      user: userId,
    }),
    signal: AbortSignal.timeout(WORKFLOW_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dify API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as DifyChatResponse;
  return {
    answer: data.answer,
    conversationId: data.conversation_id,
    sources: normalizeSources(data.metadata?.retriever_resources),
  };
}

export async function runWorkflow(
  apiKeyEnv: string,
  inputs: Record<string, unknown>,
  userId = 'system-task',
): Promise<Record<string, unknown>> {
  if (!isDifyKeyConfigured(apiKeyEnv)) {
    throw new Error(`${apiKeyEnv} is not configured`);
  }

  const apiKey = process.env[apiKeyEnv]!;
  const baseUrl = getDifyBaseUrl();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/workflows/run`, {
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
      signal: AbortSignal.timeout(WORKFLOW_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
    const code =
      (cause && typeof cause === 'object' && 'code' in cause
        ? String((cause as { code?: string }).code)
        : undefined) ??
      (error instanceof Error && 'code' in error ? String((error as { code?: string }).code) : undefined);
    const timedOut = code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNREFUSED';
    const hint = timedOut
      ? `无法连接 Dify（${baseUrl}），请检查网络/VPN、防火墙，或本地开发改用 127.0.0.1:8090 的本地 Dify`
      : `Dify 请求失败（${baseUrl}）`;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${hint}: ${detail}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dify workflow error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { data?: { outputs?: Record<string, unknown> } };
  return data.data?.outputs ?? {};
}
