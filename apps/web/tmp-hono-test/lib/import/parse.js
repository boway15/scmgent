/** Parse CSV or TSV text into rows (first row = header) */
export function parseDelimitedText(text) {
    return text
        .trim()
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')));
}
export function rowsToObjects(rows) {
    if (rows.length < 2)
        return [];
    const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    return rows.slice(1).map((line) => {
        const obj = {};
        header.forEach((key, i) => {
            obj[key] = line[i] ?? '';
        });
        return obj;
    });
}
export function normalizeHeaderKey(key) {
    return key.toLowerCase().replace(/\s+/g, '_');
}
export function pickField(row, ...keys) {
    for (const key of keys) {
        const v = row[normalizeHeaderKey(key)] ?? row[key];
        if (v != null && v !== '')
            return v;
    }
    return '';
}
