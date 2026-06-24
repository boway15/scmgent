import { api } from '@/lib/api';
import { getDefaultHomePath } from '@/lib/menu-utils';
import type { QueryClient } from '@tanstack/react-query';

/** 登录/注册成功后刷新身份与菜单，并跳转到首个可访问页面 */
export async function navigateAfterAuth(
  queryClient: QueryClient,
  navigate: (to: string, options?: { replace?: boolean }) => void,
) {
  queryClient.removeQueries({ queryKey: ['my-menus'] });
  await queryClient.invalidateQueries({ queryKey: ['me'] });

  const user = await queryClient.fetchQuery({ queryKey: ['me'], queryFn: api.getMe });
  const menus = await queryClient.fetchQuery({
    queryKey: ['my-menus', user.id, user.role.id],
    queryFn: api.getMyMenus,
  });

  navigate(getDefaultHomePath(menus, user.role.code), { replace: true });
}
