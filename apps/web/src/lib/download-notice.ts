export type DownloadQueuedNotice = {
  message: string;
  downloadCenterPath: string;
  at: number;
};

type Listener = (notice: DownloadQueuedNotice | null) => void;

const listeners = new Set<Listener>();
let current: DownloadQueuedNotice | null = null;

function emit() {
  for (const listener of listeners) listener(current);
}

/** 导出入队后的非阻断提示（供顶栏订阅） */
export function showDownloadQueuedNotice(
  message: string,
  downloadCenterPath = '/downloads',
) {
  current = {
    message: message.trim() || '已加入下载中心，生成完成后可下载',
    downloadCenterPath: downloadCenterPath || '/downloads',
    at: Date.now(),
  };
  emit();
}

export function clearDownloadNotice() {
  if (!current) return;
  current = null;
  emit();
}

export function subscribeDownloadNotice(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
