import { createRequire } from 'node:module';

const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_IMAGE_EDGE = 1280;

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

/**
 * Tiny placeholders are omitted. When optional sharp is available, images are
 * bounded to 1280px and converted to JPEG; deployments without it safely send
 * the original page image.
 */
export async function preparePageImageBase64(buffer: Buffer): Promise<string> {
  if (isPlaceholderImage(buffer)) return '';

  const sharp = loadSharp();
  if (!sharp) return buffer.toString('base64');

  const convert = (quality: number) =>
    sharp(buffer)
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer();

  try {
    let output = await convert(82);
    if (output.byteLength > MAX_IMAGE_BYTES) output = await convert(60);
    return output.toString('base64');
  } catch {
    return buffer.toString('base64');
  }
}
