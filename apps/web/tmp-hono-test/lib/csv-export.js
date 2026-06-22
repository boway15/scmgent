function csvCell(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
export function buildCsv(headers, rows) {
    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push(row.map(csvCell).join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
}
export function csvAttachment(filename, content) {
    return new Response(content, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    });
}
