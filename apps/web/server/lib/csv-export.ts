function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

/** ASCII fallback for filename= ; 完整名走 filename*=UTF-8''（避免 Node ERR_INVALID_CHAR） */
export function contentDispositionAttachment(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, '')
    .replace(/[\\/]/g, '_')
    .trim() || 'download.csv';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function csvAttachment(filename: string, content: string): Response {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDispositionAttachment(filename),
    },
  });
}
