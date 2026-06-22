import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const error = params.get('error');

  const { data: config } = useQuery({
    queryKey: ['auth-config'],
    queryFn: api.getAuthConfig,
  });

  const { data: user, isSuccess } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    retry: false,
  });

  const login = useMutation({
    mutationFn: api.getFeishuLoginUrl,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  useEffect(() => {
    if (isSuccess && user) {
      navigate('/', { replace: true });
    }
  }, [isSuccess, user, navigate]);

  useEffect(() => {
    if (config && !config.feishuEnabled) {
      navigate('/', { replace: true });
    }
  }, [config, navigate]);

  const errorMsg: Record<string, string> = {
    invalid_oauth_state: '登录状态无效，请重试',
    oauth_failed: '飞书授权失败，请重试',
    feishu_not_configured: '飞书登录未配置',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-layout p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-primary">SCM Agent</CardTitle>
          <p className="text-sm text-text-sub">跨境电商供应链智能体平台</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMsg[error] ?? '登录失败，请重试'}
            </p>
          )}
          <p className="text-sm text-text-sub">请使用飞书账号登录。首次登录默认为只读角色，请联系管理员分配权限。</p>
          <Button
            className="w-full"
            onClick={() => login.mutate()}
            disabled={login.isPending || !config?.feishuEnabled}
          >
            {login.isPending ? '跳转中...' : '飞书登录'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
