import { queryLocalAssistant } from '../../lib/local-assistant.js';
import type { AiChatContext } from '../types.js';
import type {
  AiProvider,
  KnowledgeQueryInput,
  KnowledgeQueryResult,
  WorkflowRunInput,
  WorkflowRunResult,
} from './types.js';

export class LocalAiProvider implements AiProvider {
  readonly name = 'local';

  isKnowledgeEnabled(): boolean {
    return true;
  }

  isWorkflowEnabled(): boolean {
    return false;
  }

  async queryKnowledge(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult> {
    const context: AiChatContext = {};
    if (input.inputs?.sku_code) context.skuCode = input.inputs.sku_code;
    if (input.inputs?.warehouse_code) context.warehouseCode = input.inputs.warehouse_code;

    const result = await queryLocalAssistant(input.query, context);
    return {
      answer: result.answer,
      sources: result.sources,
    };
  }

  async runWorkflow(_input: WorkflowRunInput): Promise<WorkflowRunResult> {
    throw new Error('Local provider does not support workflows');
  }
}

export const localProvider = new LocalAiProvider();
