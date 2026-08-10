const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
]);

export function isRetryableFeishuFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code && RETRYABLE_CODES.has(code)) return true;

  const message = err.message.toLowerCase();
  return (
    message === 'terminated' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('aborted')
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFeishuFetchRetry<T>(
  operation: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const retryable = isRetryableFeishuFetchError(err);
      if (!retryable || attempt >= retries) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  if (lastError instanceof Error && lastError.message.toLowerCase() === 'terminated') {
    throw new Error(
      `飞书请求中断（terminated）：连接被对端或中间层关闭，已重试 ${retries} 次仍失败`,
      { cause: lastError },
    );
  }
  throw lastError;
}
