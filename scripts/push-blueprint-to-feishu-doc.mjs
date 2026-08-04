/**
 * Push scm-agent blueprint as Feishu Docx (prose document, no tables).
 * Usage: node --env-file=.env scripts/push-blueprint-to-feishu-doc.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const APP_TOKEN = 'UvD5b2txjau5WksACknccdQknHh';
const DOC_TITLE = '数智驱动 · 计划—采购—物流—运营主轴平台（scm-agent 蓝图报告）';
const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../docs/reports/scm-feishu-ai-blueprint-report.md');

async function getToken() {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function api(token, path, init) {
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (body.code !== 0) {
    throw new Error(`${path} failed (${body.code}): ${body.msg ?? JSON.stringify(body)}`);
  }
  return body;
}

function stripMdInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

function textElements(content) {
  const text = stripMdInline(content).slice(0, 2000);
  if (!text) return [{ text_run: { content: ' ' } }];
  return [{ text_run: { content: text } }];
}

function makeBlock(blockType, content) {
  const typeKey =
    blockType === 2
      ? 'text'
      : blockType === 3
        ? 'heading1'
        : blockType === 4
          ? 'heading2'
          : blockType === 5
            ? 'heading3'
            : blockType === 12
              ? 'bullet'
              : blockType === 13
                ? 'ordered'
                : 'text';
  if (blockType === 22) {
    return { block_type: 22, divider: {} };
  }
  return {
    block_type: blockType,
    [typeKey]: { elements: textElements(content) },
  };
}

/** Parse markdown report into Feishu doc blocks (no tables). */
function markdownToBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (trimmed === '---') {
      blocks.push(makeBlock(22, ''));
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push(makeBlock(3, trimmed.slice(2)));
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push(makeBlock(4, trimmed.slice(3)));
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push(makeBlock(5, trimmed.slice(4)));
      continue;
    }
    if (trimmed.startsWith('- ')) {
      blocks.push(makeBlock(12, trimmed.slice(2)));
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      blocks.push(makeBlock(13, trimmed.replace(/^\d+\.\s*/, '')));
      continue;
    }
    blocks.push(makeBlock(2, trimmed));
  }

  return blocks;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function createDocument(token) {
  const body = await api(token, '/docx/v1/documents', {
    method: 'POST',
    body: JSON.stringify({ title: DOC_TITLE }),
  });
  const documentId = body.data?.document?.document_id;
  if (!documentId) throw new Error('Create document returned no document_id');
  return documentId;
}

async function appendBlocks(token, documentId, blocks) {
  for (const batch of chunk(blocks, 50)) {
    await api(token, `/docx/v1/documents/${documentId}/blocks/${documentId}/children`, {
      method: 'POST',
      body: JSON.stringify({
        children: batch,
        index: -1,
      }),
    });
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function updateProjectDocLink(token, docUrl) {
  const projTableId = 'tblVu4jnB3UiScds';
  let pageToken;
  let targetId;
  do {
    const url = new URL(`${FEISHU_BASE}/bitable/v1/apps/${APP_TOKEN}/tables/${projTableId}/records`);
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    for (const item of body.data?.items ?? []) {
      const name = item.fields?.['项目名称'];
      if (typeof name === 'string' && name.includes('scm-agent')) {
        targetId = item.record_id;
        break;
      }
    }
    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (!targetId && pageToken);

  if (!targetId) {
    console.log('No scm-agent project record found; skip bitable link update');
    return;
  }

  await api(token, `/bitable/v1/apps/${APP_TOKEN}/tables/${projTableId}/records/${targetId}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        立项文档: `scm-agent 蓝图报告（飞书文档）：${docUrl}`,
      },
    }),
  });
  console.log('Updated 立项及项目管理 · 立项文档 link');
}

async function main() {
  const markdown = readFileSync(REPORT_PATH, 'utf8');
  const blocks = markdownToBlocks(markdown);
  const token = await getToken();

  console.log(`Creating Feishu document (${blocks.length} blocks)...`);
  const documentId = await createDocument(token);
  const docUrl = `https://chinabestwo.feishu.cn/docx/${documentId}`;

  console.log('Writing document content...');
  await appendBlocks(token, documentId, blocks);
  await updateProjectDocLink(token, docUrl);

  console.log(`Done.\nDocument: ${docUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
