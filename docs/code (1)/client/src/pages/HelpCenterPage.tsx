import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';

type HelpSection = {
  id: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: HelpSection[] = [
  {
    id: 'intro',
    title: '1. 平台简介',
    body: (
      <>
        <p>
          本平台面向<strong>跨境家具供应链</strong>，覆盖商品主数据、多仓库存、安全库存与补货预测、PMC 下单计划、合规属性、FOB 分账及本地 AI 助手。
          本地开发完成后可通过 ZIP 导入飞书妙搭运行。
        </p>
        <p className="mt-2 text-text-sub">
          默认登录：<code className="rounded bg-muted px-1">admin@scm.local</code>（开发模式免密）。生产环境请配置飞书 OAuth 与
          <code className="rounded bg-muted px-1">ENFORCE_RBAC=true</code>。
        </p>
      </>
    ),
  },
  {
    id: 'quickstart',
    title: '2. 快速上手（推荐顺序）',
    body: (
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <Link to="/data/import" className="text-primary hover:underline">数据导入</Link>
          ：按序导入 <code className="rounded bg-muted px-1">docs/samples/import/01-skus.csv</code> → 02 库存 → 03 销量 → 04 安全库存 →
          05 PMC 计划 → 06 合规（家具 Demo 数据）。
        </li>
        <li>
          <Link to="/data/products" className="text-primary hover:underline">商品主数据</Link>
          ：核对 SPU/SKU、商家与补货亮灯。
        </li>
        <li>
          <Link to="/inventory/overview" className="text-primary hover:underline">库存总览</Link>
          ：查看各仓有效库存、ROP 与亮灯状态。
        </li>
        <li>
          <Link to="/inventory/safety" className="text-primary hover:underline">安全库存</Link>
          ：手工维护或点击「本地计算」生成 ROP/EOQ。
        </li>
        <li>
          手动触发补货预测（需 CRON 权限）：<code className="rounded bg-muted px-1">POST /api/tasks/replenishment-forecast</code>，随后在{' '}
          <Link to="/pmc/suggestions" className="text-primary hover:underline">补货建议</Link> 采纳并入 PMC 计划。
        </li>
        <li>
          <Link to="/pmc/list" className="text-primary hover:underline">计划列表</Link>
          ：确认计划 → 自动生成 <Link to="/pmc/tracking" className="text-primary hover:underline">采购跟单</Link>。
        </li>
        <li>
          <Link to="/dashboard" className="text-primary hover:underline">经营看板</Link>
          ：查看 KPI 与今日待办。
        </li>
      </ol>
    ),
  },
  {
    id: 'roles',
    title: '3. 角色与菜单',
    body: (
      <>
        <p>系统预设五种角色，菜单在「系统设置 → 角色与菜单」中按角色勾选可见项：</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-sub">
              <th className="p-2 font-normal">角色</th>
              <th className="p-2 font-normal">典型职责</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="p-2">超级管理员</td>
              <td className="p-2 text-text-sub">用户、角色、全部业务菜单</td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="p-2">PMC 计划员</td>
              <td className="p-2 text-text-sub">补货建议、PMC 计划、合规查看、数据导入</td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="p-2">仓库员</td>
              <td className="p-2 text-text-sub">库存录入、预警处理、跟单查看</td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="p-2">采购员</td>
              <td className="p-2 text-text-sub">安全库存、预警、跟单跟进、商品主数据</td>
            </tr>
            <tr>
              <td className="p-2">只读查看</td>
              <td className="p-2 text-text-sub">看板、库存、计划、合规只读</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    id: 'products',
    title: '4. 商品主数据',
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>SPU</strong>：款式/系列（如「北欧布艺单人沙发」）；可设置 SPU 级 MOQ（主商品起订量）。
        </li>
        <li>
          <strong>SKU</strong>：可售规格（颜色、尺寸等），归属 SPU；支持默认供货商家。
        </li>
        <li>
          <strong>商家</strong>：供应商主数据；SKU 导入时可自动创建。
        </li>
        <li>
          合规状态标签链至 <Link to="/compliance/skus" className="text-primary hover:underline">SKU 合规</Link> 页维护 HS 编码、重量尺寸等。
        </li>
      </ul>
    ),
  },
  {
    id: 'replenish-light',
    title: '5. 补货亮灯机制',
    body: (
      <>
        <p>每个 SKU 可设置补货亮灯，控制自动补货建议是否生成：</p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-sub">
              <th className="p-2 font-normal">亮灯</th>
              <th className="p-2 font-normal">含义</th>
              <th className="p-2 font-normal">补货行为</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60">
              <td className="p-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> 红灯</td>
              <td className="p-2">必补 SKU</td>
              <td className="p-2 text-text-sub">有效库存低于 ROP 时必须生成补货建议</td>
            </tr>
            <tr className="border-b border-border/60">
              <td className="p-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> 黄灯</td>
              <td className="p-2">联动 SKU</td>
              <td className="p-2 text-text-sub">仅当同 SPU 下有红灯 SKU 也需补货时才建议补货（如沙发不同颜色）</td>
            </tr>
            <tr>
              <td className="p-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" /> 绿灯</td>
              <td className="p-2">不补 SKU</td>
              <td className="p-2 text-text-sub">不参与自动补货建议（仍可记录缺货预警）</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-text-sub">
          在 <Link to="/inventory/overview" className="text-primary hover:underline">库存总览</Link> 可查看「可补 / 不补」；在商品主数据 SKU 列表可修改亮灯。
        </p>
      </>
    ),
  },
  {
    id: 'inventory',
    title: '6. 库存与补货',
    body: (
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>本仓有效</strong> = 可售 + 在途（在途已指向目的仓）；<strong>在产</strong> 为 SKU 级未分仓池。
        </li>
        <li>
          <strong>US 仓网</strong>：美西/美东等仓可互调，单仓低于 ROP 但仓网合计充足时可能推迟补货。
        </li>
        <li>
          <strong>安全库存 / ROP / EOQ</strong>：基于近 90 天销量本地计算；交期取自 SKU 主数据。
        </li>
        <li>
          <strong>缺货预警</strong>：每日任务检测（或手动触发 <code className="rounded bg-muted px-1">POST /api/tasks/stock-alert</code>），支持飞书群推送（需配置环境变量）。
        </li>
        <li>
          <strong>补货建议</strong>：采纳后按商家 + 目标仓合并到 PMC 草稿计划。
        </li>
      </ul>
    ),
  },
  {
    id: 'pmc',
    title: '7. PMC 计划与采购跟单',
    body: (
      <>
        <p>PMC 计划 = 向家具工厂/商家下发的 SKU×数量×交期需求（非正式采购单）：</p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>状态流转：草稿 → 已确认 → 进行中 → 已完成 / 已取消</li>
          <li>一个计划对应一个商家 + 一个目标仓</li>
          <li>确认计划后系统自动生成采购跟单台账（内部跟进用，非 PO 审批）</li>
          <li>支持导出 CSV / XLSX 发给商家</li>
        </ul>
      </>
    ),
  },
  {
    id: 'compliance',
    title: '8. 合规管理',
    body: (
      <p>
        维护 SKU 跨境申报字段：HS 编码、原产国、申报价值、重量尺寸、电池/液体标识。
        <Link to="/compliance/overview" className="ml-1 text-primary hover:underline">合规总览</Link>
        展示完整 / 部分缺失 / 未维护统计；本期不做自动规则拦截与 Agent 审查。
      </p>
    ),
  },
  {
    id: 'import',
    title: '9. 数据导入',
    body: (
      <>
        <p>支持 CSV 粘贴或文件上传，导入前可先「预览校验」。主要类型：</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-sub">
          <li>SKU 主数据（含 spu_code、replenish_light、merchant_code）</li>
          <li>库存盘点（warehouse 支持 US-WEST、IN-PRODUCTION 等）</li>
          <li>销量历史（含 warehouse_code 发货仓）</li>
          <li>安全库存（warehouse_code 分仓）</li>
          <li>PMC 计划行 + 页面填写计划名称/日期/商家</li>
          <li>SKU 合规批量 upsert</li>
        </ul>
      </>
    ),
  },
  {
    id: 'fob',
    title: '10. FOB 分账',
    body: (
      <p>
        头程物流费用分摊：创建 FOB 分账单 → 导入拖车/海运费 CSV → 执行分摊计算。
        商家发货明细导入为预留能力。入口：
        <Link to="/logistics/fob-settlement" className="ml-1 text-primary hover:underline">物流管理 → FOB 分账</Link>。
      </p>
    ),
  },
  {
    id: 'ai',
    title: '11. AI 助手',
    body: (
      <p>
        未配置 Dify 时使用<strong>本地 FAQ</strong>，可解答安全库存、ROP、亮灯机制、PMC 流程等。
        在库存总览点击「问 AI」可携带 SKU 上下文。
        配置 <code className="rounded bg-muted px-1">DIFY_API_KEY_KNOWLEDGE</code> 后可切换 RAG 模式（后续 Phase）。
      </p>
    ),
  },
  {
    id: 'faq',
    title: '12. 常见问题',
    body: (
      <dl className="space-y-4">
        <div>
          <dt className="font-medium text-text-main">页面空白怎么办？</dt>
          <dd className="mt-1 text-text-sub">按 F12 查看控制台报错；Docker 模式改代码后需 <code className="rounded bg-muted px-1">pnpm docker:up</code> 重新构建，并 Ctrl+F5 强刷。</dd>
        </div>
        <div>
          <dt className="font-medium text-text-main">补货建议为空？</dt>
          <dd className="mt-1 text-text-sub">确认已有销量历史与安全库存；检查 SKU 是否为绿灯；黄灯需同 SPU 红灯 SKU 低于 ROP。</dd>
        </div>
        <div>
          <dt className="font-medium text-text-main">菜单看不到某功能？</dt>
          <dd className="mt-1 text-text-sub">联系管理员在「角色与菜单」中为您的角色勾选对应菜单项。</dd>
        </div>
        <div>
          <dt className="font-medium text-text-main">如何迁移到妙搭？</dt>
          <dd className="mt-1 text-text-sub">执行 <code className="rounded bg-muted px-1">pnpm zip:miaoda</code>，按 docs/miaoda-import-checklist.md 导入 Schema 与自动化任务。</dd>
        </div>
      </dl>
    ),
  },
];

export function HelpCenterPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="帮助中心">
        <Link to="/ai/chat" className="text-sm text-primary hover:underline">
          仍有问题？去问 AI →
        </Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">目录</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {SECTIONS.map((s) => (
              <UniversalLink
                key={s.id}
                to={`#${s.id}`}
                className="block rounded-md px-2 py-1.5 text-text-sub hover:bg-muted hover:text-text-main"
              >
                {s.title}
              </UniversalLink>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <Card key={s.id} id={s.id} className="scroll-mt-6">
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-text-main">{s.body}</CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
