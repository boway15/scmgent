export function buildProjectNo(d: Date, rand: string): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const suffix = rand.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase().padEnd(4, '0');
  return `CST-${y}${m}${day}-${suffix}`;
}

export function randomProjectSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
