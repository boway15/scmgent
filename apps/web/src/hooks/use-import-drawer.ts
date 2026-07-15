import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useImportDrawer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(() => searchParams.get('import') === '1');

  useEffect(() => {
    if (searchParams.get('import') === '1') {
      setOpen(true);
    }
  }, [searchParams]);

  const openDrawer = useCallback(() => setOpen(true), []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    if (searchParams.get('import') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('import');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return { open, openDrawer, closeDrawer };
}
