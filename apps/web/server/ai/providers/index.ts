import { difyProvider } from './dify-provider.js';
import { localProvider } from './local-provider.js';
import type {
  AiProvider,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  WorkflowRunInput,
  WorkflowRunResult,
} from './types.js';

export type { AiProvider } from './types.js';
export { localProvider, difyProvider };

export function getKnowledgeProvider(): AiProvider {
  return difyProvider.isKnowledgeEnabled() ? difyProvider : localProvider;
}

export function getWorkflowProvider(workflowKey: string): AiProvider | null {
  if (difyProvider.isWorkflowEnabled(workflowKey)) return difyProvider;
  return null;
}

export async function queryKnowledgeWithFallback(
  input: KnowledgeQueryInput,
): Promise<{ result: KnowledgeQueryResult; provider: string; fallback: boolean }> {
  if (difyProvider.isKnowledgeEnabled()) {
    try {
      const result = await difyProvider.queryKnowledge(input);
      return { result, provider: 'dify', fallback: false };
    } catch (err) {
      console.warn('[ai] Dify knowledge failed, falling back to local:', err);
      const result = await localProvider.queryKnowledge(input);
      return {
        result: {
          ...result,
          answer: `${result.answer}\n\n（Dify 知识库暂不可用，已切换本地助手）`,
        },
        provider: 'local-fallback',
        fallback: true,
      };
    }
  }

  const result = await localProvider.queryKnowledge(input);
  return { result, provider: 'local', fallback: false };
}

export async function runWorkflowWithProvider(
  input: WorkflowRunInput,
): Promise<WorkflowRunResult | null> {
  const provider = getWorkflowProvider(input.workflowKey);
  if (!provider) return null;
  return provider.runWorkflow(input);
}
