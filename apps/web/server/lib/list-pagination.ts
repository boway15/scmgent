export function parseListPagination(
  pageRaw?: string,
  pageSizeRaw?: string,
  defaultPageSize = 20,
) {
  const page = Math.max(1, Number(pageRaw ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw ?? defaultPageSize)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
