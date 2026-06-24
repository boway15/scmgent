import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
  });
}

export function useMyMenus() {
  const { data: user } = useCurrentUser();
  return useQuery({
    queryKey: ['my-menus', user?.id, user?.role?.id],
    queryFn: api.getMyMenus,
    enabled: !!user,
  });
}
