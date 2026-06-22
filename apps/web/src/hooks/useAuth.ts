import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
  });
}

export function useMyMenus() {
  return useQuery({
    queryKey: ['my-menus'],
    queryFn: api.getMyMenus,
  });
}
