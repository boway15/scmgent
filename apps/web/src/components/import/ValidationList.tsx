import type { ImportValidationIssue } from '@/lib/api';

export function ValidationList({ issues }: { issues: ImportValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="mb-2 font-medium">校验问题（{issues.length} 条）</p>
      <ul className="space-y-1">
        {issues.slice(0, 20).map((issue, i) => (
          <li key={i}>
            第 {issue.row} 行{issue.field ? ` [${issue.field}]` : ''}：{issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
