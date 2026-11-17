/** 数据中心 / 库存镜像列表共用表格 Token（对齐 scm-design Body 14px + Label 表头） */

export const listTableWrap =
  'max-h-[min(70vh,720px)] overflow-auto rounded-md border border-border bg-card';

/** 勿再叠加 `relative`：会与 sticky 抢 position；调宽柄用绝对定位子元素即可 */
export const listTableThBase =
  'whitespace-nowrap border-b border-border bg-muted text-left text-xs font-medium text-text-sub';

export const listTableTdBase = 'border-b border-border/50 align-middle text-sm';

export const listTableTr = 'group cursor-default hover:bg-muted/30';
