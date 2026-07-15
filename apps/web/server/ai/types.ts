export type AiSource = { document_name: string; content: string };

export type AiChatMode = 'dify' | 'local' | 'local-fallback';

export type AiChatContext = {
  skuId?: string;
  skuCode?: string;
  warehouseCode?: string;
};

export type AiChatInput = {
  query: string;
  userId: string;
  conversationId?: string;
  context?: AiChatContext;
};

export type AiChatResult = {
  answer: string;
  conversationId: string;
  sources?: AiSource[];
  mode: AiChatMode;
  fallback: boolean;
  difyEnabled: boolean;
  runId?: string;
};

export type GraphName = 'ai_chat';

export type ToolContext = {
  runId?: string;
  stepId?: string;
};
