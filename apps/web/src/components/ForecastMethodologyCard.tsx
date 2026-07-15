import { useMemo } from 'react';
import { FORECAST_METHODOLOGY_SECTIONS, type ForecastMethodologyTable } from '@/lib/forecast-methodology';
import { cn } from '@/lib/utils';

type Props = {
  /** 策略页默认展开；预测页用折叠 */
  defaultExpanded?: boolean;
};

function sectionTables(section: (typeof FORECAST_METHODOLOGY_SECTIONS)[number]): ForecastMethodologyTable[] {
  if (section.tables?.length) return section.tables;
  if (section.table) return [section.table];
  return [];
}

function slugify(title: string): string {
  return title.replace(/\s+/g, '-');
}

function MethodologyTable({ table }: { table: ForecastMethodologyTable }) {
  return (
    <div className="mt-3">
      {table.caption && (
        <p className="mb-1 text-xs font-medium text-text-main">{table.caption}</p>
      )}
      <div className="overflow-auto rounded-md border border-border">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {table.headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium text-text-main">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border/50 align-top">
                {row.map((cell, idx) => (
                  <td
                    key={idx}
                    className={cn(
                      'px-3 py-2 text-text-sub',
                      idx === 0 && 'font-medium text-text-main whitespace-nowrap',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ForecastMethodologyCard({ defaultExpanded = false }: Props) {
  const navSections = useMemo(
    () => FORECAST_METHODOLOGY_SECTIONS.filter((s) => s.title !== '模块导航'),
    [],
  );

  const body = (
    <div className="space-y-8 text-text-sub">
      {FORECAST_METHODOLOGY_SECTIONS.map((section) => {
        const tables = sectionTables(section);
        const sectionId = slugify(section.title);

        return (
          <section key={section.title} id={sectionId} className="scroll-mt-4">
            <h4 className="text-base font-semibold text-text-main">{section.title}</h4>
            {section.paragraphs?.map((p) => (
              <p key={p} className="mt-2 leading-relaxed">
                {p}
              </p>
            ))}
            {section.items && (
              <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {tables.map((table, idx) => (
              <MethodologyTable key={table.caption ?? `${section.title}-${idx}`} table={table} />
            ))}
          </section>
        );
      })}
    </div>
  );

  if (defaultExpanded) {
    return (
      <div className="text-sm">
        <nav className="mb-6 rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-text-main">快速跳转</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {navSections.map((s) => (
              <a
                key={s.title}
                href={`#${slugify(s.title)}`}
                className="text-primary hover:underline"
              >
                {s.title.replace(/^[一二三四五六七八九十]+、/, '')}
              </a>
            ))}
          </div>
        </nav>
        {body}
      </div>
    );
  }

  return (
    <details className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-text-main">预测口径与算法说明</summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}
