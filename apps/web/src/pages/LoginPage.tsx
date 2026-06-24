import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { navigateAfterAuth } from '@/lib/auth-navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const error = params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['auth-config'],
    queryFn: api.getAuthConfig,
  });

  const { data: user, isSuccess } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    retry: false,
    enabled: !!config,
  });

  const feishuLogin = useMutation({
    mutationFn: api.getFeishuLoginUrl,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const emailLogin = useMutation({
    mutationFn: () => api.login({ email, password }),
    onSuccess: async () => {
      await navigateAfterAuth(queryClient, navigate);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  useEffect(() => {
    if (isSuccess && user) {
      void navigateAfterAuth(queryClient, navigate);
    }
  }, [isSuccess, user, navigate, queryClient]);

  const errorMsg: Record<string, string> = {
    invalid_oauth_state: '登录状态无效，请重试',
    oauth_failed: '飞书授权失败，请重试',
    feishu_not_configured: '飞书登录未配置',
  };

  if (configLoading) {
    return <p className="flex min-h-screen items-center justify-center text-text-sub">加载中...</p>;
  }

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !password) {
      setFormError('请输入邮箱和密码');
      return;
    }
    emailLogin.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-layout p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-primary">AJ-Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || formError) && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError ?? errorMsg[error!] ?? '登录失败，请重试'}
            </p>
          )}

          {config?.emailAuthEnabled !== false && (
            <form className="space-y-3" onSubmit={handleEmailLogin}>
              <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium text-text-main">
                  邮箱
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium text-text-main">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位"
                />
              </div>
              <Button className="w-full" type="submit" disabled={emailLogin.isPending}>
                {emailLogin.isPending ? '登录中...' : '邮箱登录'}
              </Button>
            </form>
          )}

          {config?.feishuEnabled && (
            <>
              {config?.emailAuthEnabled !== false && (
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-text-hint">或</span>
                  </div>
                </div>
              )}
              <Button
                className="w-full"
                variant="outline"
                onClick={() => feishuLogin.mutate()}
                disabled={feishuLogin.isPending}
              >
                {feishuLogin.isPending ? '跳转中...' : '飞书登录'}
              </Button>
            </>
          )}

          {config?.emailAuthEnabled !== false && (
            <p className="text-center text-sm text-text-sub">
              还没有账号？{' '}
              <Link to="/register" className="text-primary hover:underline">
                邮箱注册
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
