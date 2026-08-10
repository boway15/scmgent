import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { preprocessDesignFile } from './index.js';
import { writeProjectFile } from '../storage.js';

describe('preprocessDesignFile fixture mode', () => {
  const prevDir = process.env.COSTING_DATA_DIR;
  const prevMode = process.env.COSTING_PREPROCESS_MODE;
  let tmp: string;

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'costing-'));
    process.env.COSTING_DATA_DIR = tmp;
    process.env.COSTING_PREPROCESS_MODE = 'fixture';
  });

  after(() => {
    if (prevDir === undefined) delete process.env.COSTING_DATA_DIR;
    else process.env.COSTING_DATA_DIR = prevDir;
    if (prevMode === undefined) delete process.env.COSTING_PREPROCESS_MODE;
    else process.env.COSTING_PREPROCESS_MODE = prevMode;
  });

  it('produces at least one page in fixture mode', async () => {
    const projectId = '22222222-2222-2222-2222-222222222222';
    const written = await writeProjectFile(
      projectId,
      'source.txt',
      Buffer.from('台面 1800x800 多层板', 'utf8'),
    );
    const pages = await preprocessDesignFile({
      projectId,
      sourceStoragePath: written.storagePath,
      contentType: 'text/plain',
      fileName: 'source.txt',
    });
    assert.ok(pages.length >= 1);
    assert.equal(pages[0].pageNo, 1);
    assert.ok(pages[0].imagePath);
  });

  it('fails clearly when source file is missing', async () => {
    await assert.rejects(
      () =>
        preprocessDesignFile({
          projectId: '33333333-3333-3333-3333-333333333333',
          sourceStoragePath: '33333333-3333-3333-3333-333333333333/missing.pptx',
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          fileName: 'missing.pptx',
        }),
      /不存在|重新上传/,
    );
  });
});

