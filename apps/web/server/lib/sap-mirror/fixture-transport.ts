import { readFileSync } from 'node:fs';
import type { SapMirrorEntityType, SapMirrorFixture, SapMirrorTransport } from './types.js';

const DEFAULT_BATCH_SIZE = 100;

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Load fixture from JSON file or return in-memory object as-is. */
export function loadSapMirrorFixture(fixture: SapMirrorFixture | string): SapMirrorFixture {
  if (typeof fixture !== 'string') return fixture;
  const raw = readFileSync(fixture, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as SapMirrorFixture;
}

export type CreateFixtureTransportOptions = {
  fixture: SapMirrorFixture | string;
  batchSize?: number;
};

/** In-memory / file JSON transport; no SAP network calls. */
export function createFixtureTransport(options: CreateFixtureTransportOptions): SapMirrorTransport {
  const data = loadSapMirrorFixture(options.fixture);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  return {
    async fetchBatch(entityType: SapMirrorEntityType, cursor?: string) {
      const items = data[entityType] ?? [];
      const offset = parseCursor(cursor);
      const slice = items.slice(offset, offset + batchSize);
      const nextOffset = offset + slice.length;
      const nextCursor = nextOffset < items.length ? String(nextOffset) : undefined;
      return { items: slice, nextCursor };
    },
  };
}
