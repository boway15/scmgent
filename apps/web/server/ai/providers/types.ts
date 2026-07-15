import type { AiSource } from '../types.js';

export type KnowledgeQueryInput = {
  query: string;
  userId: string;
  conversationId?: string;
  inputs?: Record<string, string>;
};

export type KnowledgeQueryResult = {
  answer: string;
  conversationId?: string;
  sources?: AiSource[];
};

export type WorkflowRunInput = {
  workflowKey: string;
  inputs: Record<string, unknown>;
  userId?: string;
};

export type WorkflowRunResult = {
  outputs: Record<string, unknown>;
};

export type TextGenerateInput = {
  prompt: string;
  system?: string;
  userId?: string;
};

export type TextGenerateResult = {
  text: string;
};

export interface AiProvider {
  readonly name: string;
  isKnowledgeEnabled(): boolean;
  isWorkflowEnabled(workflowKey: string): boolean;
  queryKnowledge(input: KnowledgeQueryInput): Promise<KnowledgeQueryResult>;
  runWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult>;
  generateText?(input: TextGenerateInput): Promise<TextGenerateResult>;
}
