import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div>
        <h1 className="text-page-title text-text-main">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-sub">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
