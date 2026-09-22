import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const file = process.argv[2];
const buf = await readFile(file);

let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocd = i;
    break;
  }
}
console.log('fileSize', buf.length, 'eocd', eocd);
if (eocd < 0) process.exit(1);

const entryCount = buf.readUInt16LE(eocd + 10);
const cdSize = buf.readUInt32LE(eocd + 12);
const cdOffset = buf.readUInt32LE(eocd + 16);
console.log({ entryCount, cdSize, cdOffset });

// ZIP64?
const zip64Loc = buf.length > 100 ? buf.readUInt32LE(eocd - 20) : 0;
console.log('maybe zip64 locator sig', zip64Loc.toString(16));

let offset = cdOffset;
const slides = [];
for (let i = 0; i < entryCount; i++) {
  if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
    console.log('broken at entry', i, 'offset', offset);
    break;
  }
  const compression = buf.readUInt16LE(offset + 10);
  const compressedSize = buf.readUInt32LE(offset + 20);
  const nameLen = buf.readUInt16LE(offset + 28);
  const extraLen = buf.readUInt16LE(offset + 30);
  const commentLen = buf.readUInt16LE(offset + 32);
  const localHeaderOffset = buf.readUInt32LE(offset + 42);
  const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
  if (/ppt\/slides\/slide\d+\.xml$/i.test(name)) {
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let xml = '';
    try {
      xml =
        compression === 0
          ? compressed.toString('utf8')
          : inflateRawSync(compressed).toString('utf8');
    } catch (e) {
      xml = `ERR ${e}`;
    }
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    slides.push({ name, page: name.match(/(\d+)/)?.[1], textLen: texts.join('\n').length, preview: texts.join('|').slice(0, 100) });
  }
  offset += 46 + nameLen + extraLen + commentLen;
}
console.log('slideFiles', slides.length);
console.log(JSON.stringify(slides.slice(0, 12), null, 2));
