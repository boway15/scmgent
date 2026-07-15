/** 让出事件循环，避免长时间 CPU 计算阻塞 HTTP 与其它请求 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
