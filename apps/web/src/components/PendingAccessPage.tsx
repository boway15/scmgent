import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PendingAccessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['my-menus'] });
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-layout p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-primary">等待权限分配</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-text-sub">
            您已成功登录，但当前角色尚未配置任何菜单权限。请联系管理员在「角色与菜单」中分配权限，或在「用户管理」中切换角色。
          </p>
          <Button className="w-full" variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {logout.isPending ? '退出中...' : '退出登录'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
