import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { extractPptxSlideTexts } from './pptx-text.js';

/** Build a tiny valid ZIP with central directory for one deflated entry. */
function buildZipWithDeflatedFile(fileName: string, content: string): Buffer {
  const name = Buffer.from(fileName, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const compressed = deflateRawSync(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const localPart = Buffer.concat([local, name, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt32LE(0, 42); // local header offset
  const centralPart = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

describe('pptx-text extract', () => {
  const prevDir = process.env.COSTING_DATA_DIR;
  let tmp: string;

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'costing-pptx-'));
    process.env.COSTING_DATA_DIR = tmp;
  });

  after(() => {
    if (prevDir === undefined) delete process.env.COSTING_DATA_DIR;
    else process.env.COSTING_DATA_DIR = prevDir;
  });

  it('extracts slide text from zip with central directory', async () => {
    const pptx = buildZipWithDeflatedFile(
      'ppt/slides/slide1.xml',
      '<?xml version="1.0"?><p:sld><a:t>台面1800</a:t><a:t>多层板</a:t></p:sld>',
    );
    const file = path.join(tmp, 'mini.pptx');
    await writeFile(file, pptx);
    const texts = await extractPptxSlideTexts(file);
    assert.equal(texts.get(1), '台面1800\n多层板');
  });
});
