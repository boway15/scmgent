import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type QueryErrorFallbackProps = {
  error: unknown;
  onRetry?: () => void;
  title?: string;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error) return String(error);
  return '请求失败，请稍后重试';
}

export function QueryErrorFallback({
  error,
  onRetry,
  title = '数据加载失败',
}: QueryErrorFallbackProps) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-text-sub">{formatError(error)}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onRetry()}>
            重试
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
