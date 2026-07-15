const APP_ID = process.env.FEISHU_APP_ID ?? '';
const APP_SECRET = process.env.FEISHU_APP_SECRET ?? '';
const WIKI_TOKEN = process.argv[2] ?? 'VOOUwBDqpisWWKkJILZc9oKTn9b';

async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.error('Set FEISHU_APP_ID and FEISHU_APP_SECRET');
    process.exit(1);
  }

  const authRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const auth = (await authRes.json()) as { code: number; msg?: string; tenant_access_token?: string };
  console.log('auth', auth.code, auth.msg ?? 'ok');
  if (auth.code !== 0 || !auth.tenant_access_token) process.exit(1);

  const token = auth.tenant_access_token;
  const nodeUrl = new URL('https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node');
  nodeUrl.searchParams.set('token', WIKI_TOKEN);
  const nodeRes = await fetch(nodeUrl, { headers: { Authorization: `Bearer ${token}` } });
  const node = (await nodeRes.json()) as {
    code: number;
    msg?: string;
    data?: { node?: { obj_type?: string; obj_token?: string; title?: string } };
  };
  console.log('wiki node', JSON.stringify(node, null, 2));

  const obj = node.data?.node;
  if (obj?.obj_type !== 'bitable' || !obj?.obj_token) {
    console.error('Wiki node is not a bitable or missing obj_token');
    process.exit(1);
  }

  const appToken = obj.obj_token;
  const tablesRes = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const tables = (await tablesRes.json()) as {
    code: number;
    msg?: string;
    data?: { items?: Array<{ table_id: string; name: string }> };
  };
  console.log('tables', JSON.stringify(tables, null, 2));
  console.log('\nSuggested .env:');
  console.log(`FEISHU_BITABLE_APP_TOKEN=${appToken}`);
  const first = tables.data?.items?.[0];
  if (first) {
    console.log(`FEISHU_BITABLE_TABLE_NEWS_INTEL=${first.table_id}  # ${first.name}`);
    const fieldsRes = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(first.table_id)}/fields?page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const fields = (await fieldsRes.json()) as {
      data?: { items?: Array<{ field_name: string; type: number; ui_type: string }> };
    };
    console.log('\nTable fields:');
    for (const f of fields.data?.items ?? []) {
      console.log(`  - ${f.field_name} (${f.ui_type})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
