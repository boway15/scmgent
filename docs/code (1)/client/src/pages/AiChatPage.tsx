import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { AiBanner } from '@/components/AiBanner';
import { AiProgressBar } from '@/components/AiProgressBar';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ document_name?: string; content?: string }> | null;
};

export function AiChatPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const skuCode = searchParams.get('sku') ?? undefined;
  const skuId = searchParams.get('skuId') ?? undefined;
  const warehouseCode = searchParams.get('warehouse') ?? undefined;

  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');

  const { data: config } = useQuery({
    queryKey: ['ai-config'],
    queryFn: api.getAiConfig,
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: api.getAiConversations,
  });

  const loadMessages = useQuery({
    queryKey: ['ai-messages', conversationId],
    queryFn: () => api.getAiMessages(conversationId!),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (loadMessages.data?.messages) {
      setMessages(loadMessages.data.messages);
    }
  }, [loadMessages.data]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadMessages.isFetching]);

  const mutation = useMutation({
    mutationFn: (text: string) =>
      api.chat({
        query: text,
        conversationId,
        skuCode,
        skuId,
        warehouseCode,
      }),
    onSuccess: (data) => {
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources },
      ]);
      qc.invalidateQueries({ queryKey: ['ai-conversations'] });
      qc.invalidateQueries({ queryKey: ['ai-messages', data.conversationId] });
      setQuery('');
    },
  });

  const send = (text: string) => {
    if (!text.trim() || mutation.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    mutation.mutate(text);
  };

  const startNew = () => {
    setConversationId(undefined);
    setMessages([]);
    setQuery('');
  };

  const selectConversation = (id: string) => {
    setConversationId(id);
    setMessages([]);
  };

  const contextHint =
    skuCode || skuId
      ? `已绑定 SKU 上下文：${skuCode ?? skuId}${warehouseCode ? ` @ ${warehouseCode}` : ''}`
      : null;

  return (
    <div className="space-y-4">
      <PageHeader title="AI 知识库问答" />

      {config?.mode === 'local' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          本地助手模式：基于供应链 FAQ 与业务数据摘要回答。配置 Dify 后将自动切换为知识库 RAG。
        </div>
      )}

      {contextHint && (
        <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-text-sub">
          {contextHint}
          <Button
            size="sm"
            variant="outline"
            className="ml-3 h-7"
            onClick={() => send(`请分析 SKU ${skuCode ?? ''} 的库存与补货情况`)}
            disabled={mutation.isPending}
          >
            分析此 SKU
          </Button>
        </div>
      )}

      <div className="flex gap-4">
        <Card className="w-56 shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">历史对话</CardTitle>
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={startNew}>
              新建对话
            </Button>
          </CardHeader>
          <CardContent className="max-h-[480px] space-y-1 overflow-y-auto p-2">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectConversation(c.id)}
                className={cn(
                  'w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                  conversationId === c.id && 'bg-accent font-medium text-primary',
                )}
              >
                <div className="truncate">{c.title ?? '未命名'}</div>
                <div className="text-text-hint">{String(c.createdAt).slice(0, 10)}</div>
              </button>
            ))}
            {!conversations.length && (
              <p className="px-2 text-xs text-text-hint">暂无历史，发送首条问题开始</p>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 flex-1">
          <CardHeader>
            <CardTitle>对话</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AiProgressBar active={mutation.isPending || loadMessages.isFetching} />
            {mutation.isError && (
              <AiBanner
                message={(mutation.error as Error).message}
                onFix={() => mutation.reset()}
              />
            )}

            <div className="max-h-[420px] min-h-[280px] space-y-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
              {!messages.length && (
                <p className="text-sm text-text-hint">
                  可提问：安全库存如何计算？补货建议流程？PMC 计划如何下发？合规字段在哪里维护？
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={m.id ?? i}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'ml-8 bg-primary/10 text-text-main'
                      : 'mr-8 bg-card border border-border text-text-main',
                  )}
                >
                  <div className="mb-1 text-xs font-medium text-text-sub">
                    {m.role === 'user' ? '你' : '助手'}
                  </div>
                  {m.content}
                  {m.role === 'assistant' && m.sources?.length ? (
                    <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                      <p className="text-xs text-text-hint">参考来源</p>
                      {m.sources.map((s, j) => (
                        <div key={j} className="rounded bg-muted/50 px-2 py-1 text-xs text-text-sub">
                          {s.document_name ?? '来源'}
                          {s.content ? ` — ${s.content}` : ''}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="输入问题..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send(query)}
              />
              <Button onClick={() => send(query)} disabled={!query.trim() || mutation.isPending}>
                {mutation.isPending ? '思考中...' : '发送'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
