import { Navigate, useSearchParams } from 'react-router-dom';
import { importRedirectPath } from '@/components/import/import-templates';

/** 兼容旧书签 /data/import?type=... */
export function ImportLegacyRedirect() {
  const [searchParams] = useSearchParams();
  const type = searchParams.get('type');
  return <Navigate to={importRedirectPath(type)} replace />;
}
