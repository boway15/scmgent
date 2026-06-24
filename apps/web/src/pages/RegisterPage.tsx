import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { navigateAfterAuth } from '@/lib/auth-navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { isLoading: configLoading } = useQuery({
    queryKey: ['auth-config'],
    queryFn: api.getAuthConfig,
  });

  const register = useMutation({
    mutationFn: () => api.register({ email, password, name: name.trim() || undefined }),
    onSuccess: async () => {
      await navigateAfterAuth(queryClient, navigate);
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  if (configLoading) {
    return <p className="flex min-h-screen items-center justify-center text-text-sub">加载中...</p>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!email.trim()) {
      setFormError('请输入邮箱');
      return;
    }
    if (password.length < 8) {
      setFormError('密码至少 8 位');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('两次输入的密码不一致');
      return;
    }

    register.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-layout p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-primary">注册账号</CardTitle>
          <p className="text-sm text-text-sub">仅支持邮箱注册，注册后需管理员分配权限方可使用</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
          )}

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="name" className="text-sm font-medium text-text-main">
                姓名（可选）
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="显示名称"
              />
            </div>
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
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium text-text-main">
                密码
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="confirmPassword" className="text-sm font-medium text-text-main">
                确认密码
              </label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={register.isPending}>
              {register.isPending ? '注册中...' : '注册'}
            </Button>
          </form>

          <p className="text-center text-sm text-text-sub">
            已有账号？{' '}
            <Link to="/login" className="text-primary hover:underline">
              去登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
