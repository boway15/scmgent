import {
  getDifyConfigSummary,
  isAlertWorkflowEnabled,
  isDifyEnabled,
  isReplenishmentWorkflowEnabled,
  queryKnowledge,
  runWorkflow,
} from '../../integrations/dify.js';
import type {
  AiProvider,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  WorkflowRunInput,
  WorkflowRunResult,
} from './types.js';

const WORKFLOW_ENV_MAP: Record<string, string> = {
  replenishment: 'DIFY_API_KEY_REPLENISHMENT',
  alert: 'DIFY_API_KEY_ALERT',
};

export class DifyAiProvider implements AiProvider {
  readonly name = 'dify';

  isKnowledgeEnabled(): boolean {
    return isDifyEnabled();
  }

  isWorkflowEnabled(workflowKey: string): boolean {
    if (workflowKey === 'replenishment') return isReplenishmentWorkflowEnabled();
    if (workflowKey === 'alert') return isAlertWorkflowEnabled();
    const envName = WORKFLOW_ENV_MAP[workflowKey];
    return envName ? Boolean(process.env[envName]?.trim()) : false;
  }

  async queryKnowledge(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult> {
    const result = await queryKnowledge(input.query, input.userId, {
      conversationId: input.conversationId,
      inputs: input.inputs,
    });
    return {
      answer: result.answer,
      conversationId: result.conversationId,
      sources: result.sources,
    };
  }

  async runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
    const envName = WORKFLOW_ENV_MAP[input.workflowKey];
    if (!envName) {
      throw new Error(`Unknown Dify workflow key: ${input.workflowKey}`);
    }
    const outputs = await runWorkflow(envName, input.inputs, input.userId ?? 'system-task');
    return { outputs };
  }

  getConfigSummary() {
    return getDifyConfigSummary();
  }
}

export const difyProvider = new DifyAiProvider();
