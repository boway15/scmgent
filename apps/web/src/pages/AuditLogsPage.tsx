import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { formatDateTimeCst } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': '邮箱登录',
  'auth.logout': '退出登录',
  'auth.register': '邮箱注册',
  'auth.feishu_login': '飞书登录',
  'user.update': '更新用户',
  'user.password_reset': '重置密码',
  'role.create': '创建角色',
  'role.update': '更新角色',
  'role.delete': '删除角色',
  'role.menus_update': '更新角色菜单',
};

function formatDetail(detail?: string | null): string {
  if (!detail) return '-';
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  } catch {
    return detail;
  }
}

function formatTime(value: string): string {
  return formatDateTimeCst(value);
}

export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => api.getAuditLogs({ page, pageSize }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="操作日志" />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>系统操作记录</CardTitle>
          <span className="text-sm text-text-sub">共 {total} 条</span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">时间</th>
                    <th className="p-2 font-normal">操作人</th>
                    <th className="p-2 font-normal">操作</th>
                    <th className="p-2 font-normal">详情</th>
                    <th className="p-2 font-normal">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((log) => (
                    <tr key={log.id} className="border-b border-border/60 align-top">
                      <td className="p-2 whitespace-nowrap text-text-sub">{formatTime(log.createdAt)}</td>
                      <td className="p-2 text-text-main">
                        <div>{log.userName ?? '-'}</div>
                        <div className="text-xs text-text-hint">{log.userEmail ?? ''}</div>
                      </td>
                      <td className="p-2 text-text-main">{ACTION_LABELS[log.action] ?? log.action}</td>
                      <td className="p-2 max-w-md break-all text-text-sub">{formatDetail(log.detail)}</td>
                      <td className="p-2 font-mono text-xs text-text-hint">{log.ipAddress ?? '-'}</td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-text-hint">
                        暂无操作记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
