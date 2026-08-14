import { createRequire } from 'node:module';

const MAX_IMAGE_BYTES = 250 * 1024;
const MAX_IMAGE_EDGE = 1280;
/** Dify workflow input `pages_json` max_length is 500000; leave room for JSON wrapper + text. */
export const MAX_DIFY_IMAGE_BASE64_CHARS = 350_000;
export const MAX_DIFY_PAGES_JSON_CHARS = 480_000;

export type PageImageMimeType = 'image/png' | 'image/jpeg';

export type PreparedPageImage = {
  base64: string;
  mimeType: PageImageMimeType;
};

type SharpFactory = (input: Buffer) => {
  rotate(): ReturnType<SharpFactory>;
  resize(options: {
    width: number;
    height: number;
    fit: 'inside';
    withoutEnlargement: boolean;
  }): ReturnType<SharpFactory>;
  jpeg(options: { quality: number }): ReturnType<SharpFactory>;
  toBuffer(): Promise<Buffer>;
};

function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer.subarray(1, 4).toString('ascii') !== 'PNG'
  ) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function isPlaceholderImage(buffer: Buffer): boolean {
  if (buffer.byteLength < 512) return true;
  const dimensions = pngDimensions(buffer);
  return dimensions?.width === 1 && dimensions.height === 1;
}

export function isPlaceholderPageImage(buffer: Buffer): boolean {
  return isPlaceholderImage(buffer);
}

function loadSharp(): SharpFactory | null {
  try {
    const loaded = createRequire(import.meta.url)('sharp') as
      | SharpFactory
      | { default: SharpFactory };
    return typeof loaded === 'function' ? loaded : loaded.default;
  } catch {
    return null;
  }
}

function fitsDifyBase64Limit(base64: string): boolean {
  return base64.length <= MAX_DIFY_IMAGE_BASE64_CHARS;
}

async function compressWithSharp(buffer: Buffer): Promise<PreparedPageImage | null> {
  const sharp = loadSharp();
  if (!sharp) return null;

  const edges = [MAX_IMAGE_EDGE, 1024, 800];
  const qualities = [78, 65, 50, 38, 28];

  for (const edge of edges) {
    for (const quality of qualities) {
      try {
        const output = await sharp(buffer)
          .rotate()
          .resize({
            width: edge,
            height: edge,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality })
          .toBuffer();
        if (output.byteLength > MAX_IMAGE_BYTES) continue;
        const base64 = output.toString('base64');
        if (fitsDifyBase64Limit(base64)) {
          return { base64, mimeType: 'image/jpeg' };
        }
      } catch {
        /* try next quality/edge */
      }
    }
  }
  return null;
}

/**
 * Tiny placeholders are omitted. Prefer JPEG via sharp; without it, send PNG only when
 * the base64 fits Dify's pages_json limit, otherwise fall back to text-only for the page.
 */
export async function preparePageImage(buffer: Buffer): Promise<PreparedPageImage> {
  if (isPlaceholderImage(buffer)) {
    return { base64: '', mimeType: 'image/png' };
  }

  const compressed = await compressWithSharp(buffer);
  if (compressed) return compressed;

  const rawBase64 = buffer.toString('base64');
  if (fitsDifyBase64Limit(rawBase64)) {
    return { base64: rawBase64, mimeType: 'image/png' };
  }

  return { base64: '', mimeType: 'image/png' };
}

export type DifyPagePayload = {
  page: number;
  page_type: string;
  text: string;
  image_base64: string;
  image_mime_type: PageImageMimeType;
};

export function buildDifyPagesJson(pages: DifyPagePayload[]): string {
  let payload = pages.map((page) => ({
    ...page,
    text: page.text.slice(0, 20_000),
  }));
  let json = JSON.stringify(payload);
  if (json.length <= MAX_DIFY_PAGES_JSON_CHARS) return json;

  payload = payload.map((page) => ({ ...page, image_base64: '' }));
  json = JSON.stringify(payload);
  if (json.length <= MAX_DIFY_PAGES_JSON_CHARS) return json;

  payload = payload.map((page) => ({
    ...page,
    text: page.text.slice(0, 5_000),
  }));
  return JSON.stringify(payload);
}

/** @deprecated Use preparePageImage for mime-aware payloads. */
export async function preparePageImageBase64(buffer: Buffer): Promise<string> {
  return (await preparePageImage(buffer)).base64;
}
