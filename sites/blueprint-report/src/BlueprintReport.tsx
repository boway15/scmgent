import {
  computeDAGLayout,
  Grid,
  H1,
  Link,
  Spacer,
  Stack,
  Text,
} from "cursor/canvas";

/* ───────────────── Mobbin 风 · 扁平黑白 ───────────────── */

const D = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  muted: "#F3F3F3",
  text: "#000000",
  textSecondary: "#666666",
  textTertiary: "#999999",
  border: "#EBEBEB",
  borderSoft: "#F0F0F0",
  blue: "#0066FF",
  font:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Helvetica, Arial, sans-serif',
  radiusLg: 16,
  radiusMd: 12,
  radiusPill: 999,
  shadow: "0 2px 16px rgba(0, 0, 0, 0.06)",
  shadowSm: "0 1px 4px rgba(0, 0, 0, 0.04)",
} as const;

const shellStyle = {
  fontFamily: D.font,
  background: D.bg,
  color: D.text,
  colorScheme: "light" as const,
  minHeight: "100%",
  padding: "64px 32px",
  boxSizing: "border-box" as const,
  WebkitFontSmoothing: "antialiased" as const,
};

const contentStyle = {
  maxWidth: 880,
  margin: "0 auto",
};

const softCard = {
  background: D.surface,
  borderRadius: D.radiusLg,
  boxShadow: D.shadow,
  border: `1px solid ${D.borderSoft}`,
};

const captionStyle = {
  fontSize: 13,
  lineHeight: 1.5,
  color: D.textSecondary,
};

const bodyStyle = { fontSize: 15, lineHeight: 1.6, color: D.textSecondary };
const bodySecondary = bodyStyle;

function FigureTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: D.text, letterSpacing: "-0.01em" }}>
      {children}
    </div>
  );
}

function MobbinBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "18px",
        background: "#E8F1FF",
        color: D.blue,
      }}
    >
      {children}
    </span>
  );
}

function EditorialNote({ title, children }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ ...softCard, padding: "20px 24px" }}>
      <div style={{ fontWeight: 600, fontSize: 15, color: D.text, marginBottom: 6, lineHeight: 1.4 }}>{title}</div>
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}

function PillTrack({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexWrap: "wrap" as const,
        gap: 4,
        padding: 4,
        background: D.muted,
        borderRadius: D.radiusPill,
      }}
    >
      {children}
    </div>
  );
}

function EditorialPill({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "8px 16px",
        borderRadius: D.radiusPill,
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.2,
        background: active ? D.text : D.surface,
        color: active ? "#FFFFFF" : D.textSecondary,
        boxShadow: active ? D.shadowSm : "none",
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: "-0.02em",
        color: D.text,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function FigureCaption({ children }: { children: React.ReactNode }) {
  return <div style={captionStyle}>{children}</div>;
}

function EditorialTable({
  headers,
  rows,
  title,
  trailing,
}: {
  headers: string[];
  rows: string[][];
  title?: string;
  trailing?: string;
}) {
  return (
    <div style={{ ...softCard, overflow: "hidden", padding: title ? 0 : undefined }}>
      {title ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            padding: "20px 24px 16px",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: D.text, letterSpacing: "-0.01em" }}>{title}</span>
          {trailing ? <MobbinBadge>{trailing}</MobbinBadge> : null}
        </div>
      ) : null}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          lineHeight: 1.55,
          background: D.surface,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 24px",
                  fontWeight: 500,
                  fontSize: 12,
                  color: D.textTertiary,
                  borderBottom: `1px solid ${D.borderSoft}`,
                  background: D.surface,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "14px 24px",
                    borderBottom: ri === rows.length - 1 ? "none" : `1px solid ${D.borderSoft}`,
                    color: ci === 0 ? D.text : D.textSecondary,
                    verticalAlign: "top",
                    fontWeight: ci === 0 ? 600 : 400,
                  }}
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditorialStat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ ...softCard, padding: "28px 20px", textAlign: "left" }}>
      <div style={{ fontSize: 13, color: D.textSecondary, marginBottom: 8, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1,
          color: D.text,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EditorialBarChart({
  categories,
  data,
  yMax,
  unit = "",
}: {
  categories: string[];
  data: number[];
  yMax: number;
  unit?: string;
}) {
  const w = 520;
  const h = 168;
  const pad = { l: 16, r: 16, t: 20, b: 52 };
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;
  const gap = chartW / categories.length;
  const barW = gap * 0.42;
  return (
    <div style={{ padding: "8px 0", background: D.surface }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" style={{ display: "block" }}>
        <line
          x1={pad.l}
          y1={pad.t + chartH}
          x2={w - pad.r}
          y2={pad.t + chartH}
          stroke={D.borderSoft}
          strokeWidth={1}
        />
        {categories.map((cat, i) => {
          const val = data[i] ?? 0;
          const barH = Math.max(4, (val / yMax) * chartH);
          const x = pad.l + i * gap + (gap - barW) / 2;
          const y = pad.t + chartH - barH;
          return (
            <g key={cat}>
              <rect x={x} y={y} width={barW} height={barH} rx={6} fill={D.text} />
              <text
                x={x + barW / 2}
                y={y - 8}
                textAnchor="middle"
                fontSize={11}
                fill={D.text}
                fontWeight={600}
                fontFamily={D.font}
              >
                {val}
                {unit}
              </text>
              <text
                x={x + barW / 2}
                y={h - 18}
                textAnchor="middle"
                fontSize={11}
                fill={D.textSecondary}
                fontFamily={D.font}
              >
                {cat}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 多备货 = 迅捷 ERP 审核需求备货 − 财务 BI SKU 预报（2025 参考 12−8=4） */
function ForecastStockBaselineChart() {
  const total = 12;
  const forecast = 8;
  const diff = 4;
  const w = 520;
  const x = 24;
  const barY = 36;
  const barH = 32;
  const barW = w - 48;
  const forecastW = (forecast / total) * barW;
  const diffW = (diff / total) * barW;
  return (
    <div style={{ padding: "8px 0", background: D.surface }}>
      <div style={{ fontSize: 13, color: D.textSecondary, marginBottom: 16, paddingLeft: 4 }}>
        迅捷 ERP 审核需求备货 <span style={{ color: D.text, fontWeight: 600 }}>12 亿</span>（2025 参考）
      </div>
      <svg width="100%" viewBox={`0 0 ${w} 120}`} role="img" style={{ display: "block" }}>
        <rect x={x} y={barY} width={barW} height={barH} rx={8} fill={D.muted} stroke={D.borderSoft} strokeWidth={1} />
        <rect x={x} y={barY} width={forecastW} height={barH} fill={D.textSecondary} />
        <rect x={x + forecastW} y={barY} width={diffW} height={barH} fill={D.border} />
        <rect x={x} y={barY} width={barW} height={barH} rx={8} fill="none" stroke={D.borderSoft} strokeWidth={1} />
        <text x={x + forecastW / 2} y={barY + barH / 2 + 4} textAnchor="middle" fontSize={11} fill="#FFFFFF" fontWeight={500} fontFamily={D.font}>
          8 亿 · 财务 BI SKU 预报
        </text>
        <text x={x + forecastW + diffW / 2} y={barY + barH / 2 + 4} textAnchor="middle" fontSize={11} fill={D.textSecondary} fontFamily={D.font}>
          4 亿 · 差额
        </text>
        <text x={x} y={barY + barH + 20} fontSize={11} fill={D.textSecondary} fontFamily={D.font}>
          多备货 = 迅捷 ERP 审核需求备货 − 财务 BI SKU 预报 = 4 亿
        </text>
      </svg>
    </div>
  );
}

function EditorialH3({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: D.text, marginTop: 20, letterSpacing: "-0.01em" }}>
      {children}
    </div>
  );
}

function EditorialStrong({ children }: { children: React.ReactNode }) {
  return <span style={{ fontWeight: 600, color: D.text }}>{children}</span>;
}

function EditorialMiniCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...softCard, padding: "24px", height: "100%", boxSizing: "border-box" as const }}>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25, color: D.text, marginBottom: 6, letterSpacing: "-0.01em" }}>
        {title}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: D.textSecondary }}>{children}</div>
    </div>
  );
}

function EditorialPanel({ children, padding = 24 }: { children: React.ReactNode; padding?: number }) {
  return (
    <div style={{ ...softCard, padding, color: D.text }}>
      {children}
    </div>
  );
}

function EditorialUsageBar({
  total,
  topLeftLabel,
  topRightLabel,
  segments,
}: {
  total: number;
  topLeftLabel?: string;
  topRightLabel?: string;
  segments: { id: string; value: number; accent?: boolean }[];
}) {
  const sum = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const remainder = Math.max(0, total - sum);
  const all = [...segments, ...(remainder > 0 ? [{ id: "rest", value: remainder, accent: false }] : [])];
  return (
    <div style={{ ...softCard, padding: "20px 24px" }}>
      {(topLeftLabel || topRightLabel) && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: D.text }}>{topLeftLabel}</span>
          <span style={{ fontSize: 13, color: D.textSecondary, textAlign: "right" }}>{topRightLabel}</span>
        </div>
      )}
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: D.radiusPill,
          overflow: "hidden",
          background: D.muted,
          padding: 2,
          gap: 2,
        }}
      >
        {all.map((seg) => (
          <div
            key={seg.id}
            style={{
              flex: seg.value,
              borderRadius: D.radiusPill,
              background: seg.accent ? D.text : D.border,
              minWidth: seg.value > 0 ? 4 : 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EditorialCollapsible({
  title,
  trailing,
  defaultOpen = false,
  children,
}: {
  title: string;
  trailing?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} style={{ ...softCard, overflow: "hidden" }}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "20px 24px",
          cursor: "pointer",
          listStyle: "none",
          fontFamily: D.font,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: D.text }}>{title}</span>
        <span style={{ fontSize: 13, color: D.textSecondary }}>{trailing}</span>
      </summary>
      <div style={{ padding: "0 24px 24px", borderTop: `1px solid ${D.borderSoft}` }}>{children}</div>
    </details>
  );
}

/* ───────────────── 示意图组件（主题色 SVG / DAG） ───────────────── */

function LayerStackDiagram() {
  const layers = [
    { title: "访问层 · 飞书妙搭", sub: "统一工作台 · SSO · 规划接入" },
    { title: "协同层 · 飞书多维表格 / 群 / aily", sub: "台账 · 消息 · 审批 · 已落地" },
    { title: "智能层 · Dify Workflow / RAG / Agent", sub: "催办 · 预测 · 知识 · 部分落地" },
    { title: "引擎层 · scm-agent Docker", sub: "算法 · 状态机 · Cron · API · 已生产" },
    { title: "数据层 · PostgreSQL 日快照", sub: "权威口径 · 审计 · 已生产" },
  ];
  const h = 48;
  const gap = 8;
  const w = 520;
  const totalH = layers.length * (h + gap) + 16;
  return (
    <Stack gap={20}>
      <FigureTitle>图 1 · 飞书 AI+ 五层架构</FigureTitle>
      <div style={{ ...softCard, padding: "16px 12px" }}>
      <svg width="100%" height={totalH} viewBox={`0 0 ${w} ${totalH}`} role="img">
        {layers.map((layer, i) => {
          const y = 8 + i * (h + gap);
          return (
            <g key={layer.title}>
              <rect
                x={12}
                y={y}
                width={w - 24}
                height={h}
                rx={12}
                fill={D.surface}
                stroke={D.borderSoft}
              />
              <text x={28} y={y + 20} fill={D.text} fontSize={13} fontWeight={600} fontFamily={D.font}>
                {layer.title}
              </text>
              <text x={28} y={y + 36} fill={D.textSecondary} fontSize={12} fontFamily={D.font}>
                {layer.sub}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <FigureCaption>
        Face（妙搭）→ Blood（飞书）→ Neural（Dify）→ Brain（引擎）→ Memory（快照）
      </FigureCaption>
    </Stack>
  );
}

function DataFlowDiagram() {
  const boxes = [
    { id: "xj", label: "迅捷 ERP", sub: "库存 / 采购 / 周转" },
    { id: "fs", label: "飞书多维表格", sub: "业务协作台账" },
    { id: "scm", label: "scm-agent", sub: "计算 · 闭环 · API" },
    { id: "out", label: "看板 / 催办 / 建议", sub: "人确认 · AI 推送" },
  ];
  const layout = computeDAGLayout({
    nodes: boxes.map((b) => ({ id: b.id })),
    edges: [
      { from: "xj", to: "fs" },
      { from: "fs", to: "scm" },
      { from: "scm", to: "out" },
    ],
    direction: "horizontal",
    nodeWidth: 128,
    nodeHeight: 52,
    rankGap: 56,
    nodeGap: 24,
    padding: 16,
  });
  const label = Object.fromEntries(boxes.map((b) => [b.id, b]));
  return (
    <Stack gap={20}>
      <FigureTitle>图 2 · 数据智能路径（双跳自动化）</FigureTitle>
      <div style={{ ...softCard, padding: 16 }}>
      <svg width="100%" height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img">
        {layout.edges.map((e) => (
          <g key={`${e.from}-${e.to}`}>
            <line
              x1={e.sourceX}
              y1={e.sourceY}
              x2={e.targetX}
              y2={e.targetY}
              stroke={D.border}
              strokeWidth={1}
            />
            <polygon
              points={`${e.targetX},${e.targetY} ${e.targetX - 7},${e.targetY - 3.5} ${e.targetX - 7},${e.targetY + 3.5}`}
              fill={D.text}
            />
          </g>
        ))}
        {layout.nodes.map((n) => {
          const b = label[n.id];
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={128}
                height={52}
                rx={12}
                fill={D.surface}
                stroke={D.borderSoft}
              />
              <text
                x={n.x + 64}
                y={n.y + 22}
                textAnchor="middle"
                fill={D.text}
                fontSize={13}
                fontWeight={600}
                fontFamily={D.font}
              >
                {b.label}
              </text>
              <text
                x={n.x + 64}
                y={n.y + 40}
                textAnchor="middle"
                fill={D.textSecondary}
                fontSize={11}
                fontFamily={D.font}
              >
                {b.sub}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <FigureCaption>
        第一跳迅捷→飞书 · 第二跳飞书→引擎（07:20–08:05 Cron）· 输出看板与 AI 催办
      </FigureCaption>
    </Stack>
  );
}

function EnginesDiagram() {
  return (
    <Stack gap={20}>
      <FigureTitle>图 3 · 四大核心引擎</FigureTitle>
      <Grid columns={2} gap={20}>
        <EditorialMiniCard title="数据智能引擎">数据从哪来、是否可信</EditorialMiniCard>
        <EditorialMiniCard title="库存规划引擎">该不该补、补多少、何时下单</EditorialMiniCard>
        <EditorialMiniCard title="供应商 PMC 引擎">计划如何下发、履约到哪步</EditorialMiniCard>
        <EditorialMiniCard title="AI 增强引擎">谁该处理、怎么解释、SOP 怎查</EditorialMiniCard>
      </Grid>
    </Stack>
  );
}

function MainLoopDiagram() {
  const nodes = [
    { id: "n1", label: "入湖" },
    { id: "n2", label: "主数据" },
    { id: "n3", label: "预测" },
    { id: "n4", label: "规划" },
    { id: "n5", label: "计划" },
    { id: "n6", label: "履约" },
    { id: "n7", label: "到货" },
    { id: "n8", label: "复盘" },
  ];
  const edges = nodes.slice(0, -1).map((_, i) => ({
    from: nodes[i].id,
    to: nodes[i + 1].id,
  }));
  edges.push({ from: "n8", to: "n3" });
  const layout = computeDAGLayout({
    nodes: nodes.map((n) => ({ id: n.id })),
    edges,
    direction: "horizontal",
    nodeWidth: 64,
    nodeHeight: 36,
    rankGap: 28,
    nodeGap: 16,
    padding: 20,
  });
  const labels = Object.fromEntries(nodes.map((n) => [n.id, n.label]));
  return (
    <Stack gap={20}>
      <FigureTitle>图 4 · 主闭环八节点（复盘回流预测）</FigureTitle>
      <div style={{ ...softCard, padding: 16 }}>
      <svg width="100%" height={Math.max(layout.height, 100)} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img">
        {layout.edges.map((e) => (
          <line
            key={`${e.from}-${e.to}-${e.isBackEdge}`}
            x1={e.sourceX}
            y1={e.sourceY}
            x2={e.targetX}
            y2={e.targetY}
            stroke={e.isBackEdge ? D.border : D.border}
            strokeWidth={1}
            strokeDasharray={e.isBackEdge ? "4 3" : undefined}
          />
        ))}
        {layout.nodes.map((n) => {
          const hot = n.id === "n4" || n.id === "n6";
          return (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={64}
              height={36}
              rx={18}
              fill={hot ? D.text : D.surface}
              stroke={hot ? D.text : D.borderSoft}
              strokeWidth={1}
            />
            <text
              x={n.x + 32}
              y={n.y + 22}
              textAnchor="middle"
              fill={hot ? "#FFFFFF" : D.text}
              fontSize={11}
              fontWeight={600}
              fontFamily={D.font}
            >
              {labels[n.id]}
            </text>
          </g>
          );
        })}
      </svg>
      </div>
      <FigureCaption>
        实线主路径 · 虚线复盘回流 · 高亮节点为规划与履约（引擎核心）
      </FigureCaption>
    </Stack>
  );
}

function CoverageChart() {
  const cats = ["产研", "计划", "采购", "生产", "质检", "物流", "运营", "客服"];
  const vals = [1, 3, 2.5, 1, 1, 1.5, 2.5, 1];
  return (
    <Stack gap={20}>
      <FigureTitle>图 5 · 八列流程覆盖度（示意评分）</FigureTitle>
      <div style={{ ...softCard, padding: "16px 12px" }}>
        <EditorialBarChart categories={cats} data={vals} yMax={3} />
      </div>
      <FigureCaption>
        Source: 职能节点对照自评 · 0 未覆盖 / 1 部分 / 2 较强 / 3 主轴核心 · 质检=1（飞书看板已有，待接入系统）
      </FigureCaption>
    </Stack>
  );
}

function MaturityChart() {
  const cats = ["L1 数字化", "L2 自动化", "L3 智能化", "L4 妙搭入口", "L5 全链路"];
  const vals = [70, 55, 20, 5, 2];
  return (
    <Stack gap={20}>
      <FigureTitle>图 6 · 成熟度 L1–L5（保守自评）</FigureTitle>
      <div style={{ ...softCard, padding: "16px 12px" }}>
        <EditorialBarChart categories={cats} data={vals} yMax={100} unit="%" />
      </div>
      <FigureCaption>
        Source: 保守自评 · 按可验收交付口径 · L1–L2 核心场景已跑通 · L3 试点 · L4–L5 规划展望
      </FigureCaption>
    </Stack>
  );
}

/* ───────────────── 数据表 ───────────────── */

const painPoints = [
  ["数据孤岛", "迅捷 ERP、Excel、飞书表多套并存，库存与主数据口径经常不一致"],
  ["预测不准", "销量预测偏差大，备货决策缺乏可靠输入，计划与执行经常脱节"],
  ["备货效率低", "评审依赖人工导出整理，效率低、口径不统一，准确性难以保障"],
  ["调拨组柜薄弱", "调拨/组柜销量占比低，规则与标准不一，跨仓协同与组柜决策困难"],
  ["采购跟单繁琐", "逐笔查表、重复沟通、进度汇总耗时长，大件待确认与超期靠人工筛选"],
  ["流程断档", "预测、计划、跟单、到货之间缺少系统串联，进度靠人工盯人"],
  ["时效滞后", "手工导出上传，补货决策常落后 T+1 甚至更久，断货积压事后才发现"],
];

const valueProps = [
  ["定位", "scm-agent 定位为 SCM 效率工程平台：数据入湖、引擎计算、权限审计、飞书/妙搭/Dify 集成"],
  ["价值归属", "可量化收益归属各业务能力点，不把整系统当作「一笔总账」承诺收益"],
  ["战略对齐", "落实集团「数智驱动高效」——效率工程 + 数据与知识双驱动"],
  ["主轴突破", "在计划 · 采购 · 物流 · 运营四列验证「数字化 → 自动化 → 智能化」递进"],
  ["效率范式", "数据自动到位 · AI 推送待办 · 人只做确认与例外处理"],
  ["安全可控", "自建 Docker · 飞书 SSO · 敏感字段分级 · 推送脱敏"],
];

/** 各业务能力点 · 价值归属（量化在点上，平台不背总账） */
const capabilityValueMap = [
  [
    "销量预测及自动备货",
    "运营 · 计划",
    "资金占用 · 转投毛利 · 缺货挽回 · 备货评审工时",
    "公式已建 · 待验收",
    "主价值点 A",
  ],
  [
    "库存健康 / 缺货预警",
    "库存 · 计划",
    "断货发现时效 · 红黄灯可行动 · 减少事后救火",
    "待采基线（响应时效）",
    "支撑预测备货",
  ],
  [
    "PMC 履约闭环",
    "计划 · 采购",
    "计划到货周期 · 跟单可视 · 异常定位时间",
    "待采基线（准时到货率）",
    "执行层闭环",
  ],
  [
    "采购跟单 / 大件催办",
    "采购",
    "降本（延期/加急等）· 提效工时 · 作业模式升级",
    "提效假设 · 试用中",
    "采购主价值点",
  ],
  [
    "数据自动化五链路",
    "平台基建",
    "日导入工时 → 0 · 口径一致性 · T 日数据就绪",
    "定性 + 任务日志可证",
    "使能层，不独占收益",
  ],
  [
    "FOB 分账",
    "物流",
    "头程费用分摊提效 · 对账工时下降",
    "已上线 · 待明细验收",
    "主价值点 C",
  ],
  [
    "质检待检协同",
    "质检",
    "待检清单可视 · 自动化通知",
    "飞书看板 + 通知已建，待接入 scm-agent",
    "飞书侧已有",
  ],
  [
    "客服质量评分",
    "客服",
    "质检工时 · 培训针对性",
    "待采基线",
    "局部能力点",
  ],
  [
    "跨境资讯",
    "情报",
    "人工刷新闻时间 · 信息覆盖面",
    "定性为主",
    "辅助决策点",
  ],
];

/** 能力点：销量预测及备货 · 四维量化 */
const forecastStockValueRows = [
  [
    "减少库存资金占用",
    "提升预测准确率，削减冗余备货",
    "预计释放资金 = 4亿元 × 冗余库存削减比例",
    "2025 多备货约 4 亿（迅捷 ERP 审核需求备货 12 亿 − 财务 BI SKU 预报 8 亿）",
  ],
  [
    "创造盈利机会",
    "释放资金转投高需求/高周转/高毛利商品",
    "预计新增毛利 = 可释放资金 × 可转投比例 × 相关商品毛利率",
    "新增毛利 ≠ 释放资金本身，需结合投入规模与周转测算",
  ],
  [
    "减少缺货损失",
    "提高 SKU 级预测准确率，降低断货概率",
    "预计挽回毛利 = 受影响 SKU 销售额 × 缺货率降幅（结合毛利率验证）",
    "实际收益需按 SKU 销售额、缺货率、毛利率复盘",
  ],
  [
    "提升备货决策效率",
    "自动趋势分析、预测结果与评审明细",
    "评审侧工时单独测算",
    "与多备货资金基线分开；有效次数与单次节省待业务采数",
  ],
];

const forecastStockScenarios = [
  ["保守", "5%", "约 0.20 亿", "按 50% 转投、毛利率 25% → 约 250 万毛利量级"],
  ["基准", "10%", "约 0.40 亿", "按 50% 转投、毛利率 25% → 约 500 万毛利量级"],
  ["进取", "20%", "约 0.80 亿", "按 50% 转投、毛利率 25% → 约 1,000 万毛利量级"],
];

/** 能力点：采购跟单 / 大件催办 · 价值（与预测备货分账） */
const procurementValueRows = [
  [
    "降本",
    "减少人工查表、重复沟通与进度汇总；提前发现延期风险",
    "降低加急生产、临时调拨、改船期及缺货等成本",
    "需进一步跟进量化（建议建：加急单占比、临时调拨次数、改船期次数、缺货损失）",
  ],
  [
    "提效",
    "按系统待办/异常清单处理，替代逐笔翻表跟进",
    "单人日节省约 20 分钟（试用估算）",
    "团队 10 人+ · 优先试用中 · 基线采集中，暂不以固定工时对外承诺",
  ],
  [
    "作业模式升级",
    "从「逐笔跟进全部订单」转为「待办 + 异常清单」",
    "订单状态统一展示，减少跨部门重复确认与交接成本",
    "定性为主；可用「跨部门确认次数 / 交接耗时」采基线",
  ],
];

const procurementEffortRows = [
  ["单人日节省", "约 20 分钟", "采购跟进 + 查询（试用抽样）"],
  ["团队规模", "10 人+", "采购跟单相关岗位"],
  ["当前阶段", "优先试用中", "推送覆盖与时长基线采集中"],
  ["对外表述", "待基线确认", "试用稳定后再固化工时收益口径"],
];

const fobEffortRows = [
  ["人数", "3 人", "FOB 分账 / 对账相关"],
  ["每人每月", "2 天", "手工分摊与核对（现状）"],
  ["年合计", "72 人天", "3 × 2 天/月 × 12 月"],
  ["现状工时", "约 576 小时/年", "按 8 小时/人天"],
  ["系统上线后", "仅直接计算 + 导出", "分摊由系统完成，无需手工计算"],
  ["预计节省", "约 80%", "≈ 461 工时/年；剩余 ≈ 115 工时/年"],
];

/** 能力点：FOB 分账 · 价值 */
const fobValueRows = [
  [
    "提效",
    "系统按工厂/柜号直接计算分摊，用户导出核对即可",
    "较现状 576 工时/年节省约 80%（≈461 工时）；剩余约 115 工时/年",
    "归属【FOB 分账】能力点，与预测备货、采购催办分账",
  ],
  [
    "准确与可追溯",
    "分摊规则固化、结果可复查",
    "降低分摊差错与反复核对成本",
    "定性为主；可另采「差错率 / 复核次数」基线",
  ],
];

const architectureLayers = [
  ["① 访问层", "飞书妙搭", "统一工作台 · 飞书 SSO · 菜单导航", "规划中", "Face"],
  ["② 协同层", "飞书多维表格 / 群 / aily", "业务台账 · 消息卡片 · 审批流", "已上线", "Blood"],
  ["③ 智能层", "Dify Workflow / RAG / Agent", "催办 · 评分 · 预测增强 · 知识问答", "试点中", "Neural"],
  ["④ 引擎层", "scm-agent · Docker Compose", "算法 · 状态机 · Cron · REST API", "已上线", "Brain"],
  ["⑤ 数据层", "PostgreSQL · 日快照 · 审计", "权威口径 · 历史可追溯 · 任务日志", "已上线", "Memory"],
];

const enginesDetail = [
  [
    "数据智能引擎",
    "数据从哪来、是否可信、何时就绪",
    "双跳同步 · 字段映射 · 日快照 · 主数据联动 · 任务互斥",
    "Eliminate 手工导入；T 日数据就绪",
  ],
  [
    "库存规划引擎",
    "该不该补 · 补多少 · 何时下单 · 断货/积压",
    "库存位置 · 覆盖天数 · 健康灯 · 提前期 · metrics",
    "红黄灯可行动；建议可采纳",
  ],
  [
    "供应商 PMC 引擎",
    "计划如何下发 · 履约到哪步 · 何时可售",
    "PMC 计划 · 跟单状态机 · 交期提醒 · 到货回写",
    "履约可追踪；到货闭环库存",
  ],
  [
    "AI 增强引擎",
    "谁该处理 · 怎么解释 · SOP 怎查",
    "Dify 催办 · 预警摘要 · 评分 · 预测 · RAG",
    "AI 找人；人确认；数量本地算",
  ],
];

const dataPipelines = [
  ["库存查询", "07:20", "分仓明细 · 约 200 列", "日快照归档", "只读，不驱动补货"],
  ["库存周转", "07:30", "周转宽表 · 5800+ SKU", "总览 + 补货输入 + 主数据", "规划主数据源"],
  ["大件备货", "08:00", "备货申请表", "全量覆盖本地", "Dify 超期推送"],
  ["采购跟单", "08:05", "履约台账", "与 PMC 跟单对齐", "Dify 每日催办"],
  ["商品主数据", "随周转", "SKU 基础字段", "自动创建/增量更新", "生命周期自动算"],
];

const mainLoop = [
  ["N1", "数据入湖", "Cron 拉取飞书五类台账", "数据智能引擎", "快照发布"],
  ["N2", "主数据对齐", "SKU 创建/更新 · 生命周期", "数据智能引擎", "无变化跳过"],
  ["N3", "需求发布", "预测版本 + 影响预览", "库存规划引擎", "人工确认"],
  ["N4", "智能规划", "补货建议 · 健康灯 · 预警", "规划 + AI 摘要", "可解释"],
  ["N5", "计划确认", "PMC 草稿 → 确认", "PMC 引擎", "生成跟单"],
  ["N6", "履约协同", "状态推进 · 交期 · 异常", "PMC + AI 催办", "Dify 推送"],
  ["N7", "到货闭环", "登记收货 · 回写库存", "PMC 引擎", "计划完成"],
  ["N8", "经营复盘", "看板漏斗 · 驾驶舱", "全引擎汇总", "回流预测"],
];

const followUpStates = [
  ["待确认", "draft", "计划确认后自动生成"],
  ["已确认", "confirmed", "供应商已确认交期"],
  ["生产中", "in_production", "工厂生产中"],
  ["待发货", "ready_to_ship", "生产完成待发货"],
  ["在途", "in_transit", "已发货在途"],
  ["部分到货", "partial_received", "累计收货 < 计划量"],
  ["已收货", "received", "全部到货 · 闭环完成"],
  ["异常 / 取消", "exception / cancelled", "人工处理或终止"],
];

const subLoops = [
  ["库存健康闭环", "快照 → 健康计算 → 补货灯回写 → 总览 → 预警推群", "红/黄/超备灯规则", "07:00 主动发现"],
  ["采购催办闭环", "飞书 → 同步 → Dify 筛超期 → 企微 → 人处理", "大件超期 + 跟单待办", "不用翻表"],
  ["预测准确率闭环", "基线 → 发布 → 补货采用 → 回测 → 纠偏", "规则主力 + AI 补长尾", "质量可验收"],
  ["资讯情报闭环", "采集 → 审核 → 采用入飞书", "研究 Agent + Dify", "替代刷新闻"],
];

const modules = [
  ["经营看板", "漏斗 · 待办 · 趋势", "经营复盘入口", "已上线"],
  ["库存总览 / 查询", "多仓 · 日快照 · 问 AI", "规划输入与查看", "已上线"],
  ["安全库存 / 预警", "策略 · 每日巡检", "健康闭环前端", "试点中"],
  ["SKU 规划 / 交期 / 驾驶舱", "单 SKU · 提前期 · KPI", "规划引擎深化", "建设中"],
  ["销售预测", "版本 · 复核 · 准确率", "需求发布节点", "已上线"],
  ["补货建议 / PMC / 跟单", "采纳 · 计划 · 状态机", "主闭环核心", "已上线"],
  ["发运管理", "里程碑 · 预计可售日", "发货计划演进", "建设中"],
  ["大件备货 / 采购跟单", "飞书同步 · Dify 催办", "采购列主交付", "试点中"],
  ["FOB 分账", "头程按工厂/柜分摊", "物流费用数字化", "已上线"],
  ["质检协同", "飞书看板 · 待检自动化通知", "待检任务协同", "飞书已有"],
  ["客服质量", "导入 + Dify 评分", "客服列局部", "已上线"],
  ["跨境资讯", "研究 + 审核入飞书", "情报子闭环", "已上线"],
  ["AI 助手", "FAQ · 待启用 RAG", "知识服务", "建设中"],
];

const digitalizationMap = [
  ["产研", "录入 / 更新", "SKU 主数据随周转自动维护", "试点中"],
  ["计划", "需求计划", "PMC + 补货建议合并", "试点中"],
  ["计划", "跟进采造", "跟单状态机 + 到货回写", "已上线"],
  ["计划", "发货计划", "发运里程碑演进", "建设中"],
  ["计划", "排柜调拨", "FOB 柜号；调拨建议规划", "规划中"],
  ["采购", "跟单", "飞书同步 + Dify 催办", "已上线"],
  ["采购", "出货", "待发货/在途 + 大件备货", "试点中"],
  ["运营", "销售预测", "工作台 + 版本 + AI 增强", "已上线"],
  ["运营", "规划/采购/出货协同", "影响预览 · 飞书协同", "试点中"],
  ["物流", "库存盘点（展示）", "总览 / 查询快照", "试点中"],
  ["物流", "费用计划与账单核对", "FOB 头程分账", "已上线"],
  ["质检", "待检任务 / 质检看板", "飞书看板 + 自动化通知（未接入 scm-agent）", "飞书已有 · 正常应用"],
  ["客服", "客诉邮件管理", "回复质量评估", "试点中"],
];

const aiCapabilities = [
  ["缺货预警摘要", "试点中", "本地 + Dify", "07:00", "可读摘要推群"],
  ["大件待供应商确认超期", "已上线", "Dify Workflow", "09:00", "按供应商汇总脱敏"],
  ["大件待采购确认超期", "已上线", "Dify Workflow", "09:00", "采购 SLA 监控"],
  ["采购跟单催办", "试点中", "Dify Workflow", "每日", "超期待办找人"],
  ["补货文案增强", "可选启用", "Dify Workflow", "周一", "不改数量"],
  ["客服质量评分", "已上线", "Dify 四维", "批量", "准确/专业/共情/解决"],
  ["跨境资讯研究", "已上线", "研究 Agent", "08:00", "审核后入飞书"],
  ["AI 单 SKU 预测", "进行中", "Dify + API", "长尾 SKU", "人工确认发布"],
  ["批量预测智能体", "规划", "Dify Agent", "月报", "ABCD + LLM 报告"],
  ["知识库 RAG", "进行中", "Chat + SOP", "配 Key", "即时问答"],
  ["aily 审批", "规划", "aily", "计划确认", "流程在飞书"],
];

const securityRows = [
  ["身份认证", "飞书 OAuth + 邮箱；可强制登录"],
  ["权限控制", "菜单级 RBAC；按岗位配置可见模块"],
  ["数据主权", "PostgreSQL 自建 Docker，不上公有云 SaaS"],
  ["网络边界", "Cloudflare Tunnel + HTTPS"],
  ["任务安全", "Cron 需 X-Cron-Secret"],
  ["密钥管理", "密钥存 .env，不进仓库"],
  ["敏感隔离", "成本/供货方权限可见；推送脱敏"],
  ["AI 边界", "数量本地算；建议态人工确认"],
  ["审计追溯", "操作日志 + task_runs"],
];

const roadmap = [
  ["L1 数字化底座", "基本落地", "五条数据链核心已跑通 · 主数据/PMC/FOB/预测 · 部分口径待完善"],
  ["L2 自动化协同", "部分落地", "Cron · Dify 催办 · 预警/补货定时 · 覆盖范围仍在扩展"],
  ["L3 智能化增强", "试点中", "AI 预测 · 知识库 RAG · 驾驶舱 · 发运 · 尚未规模化"],
  ["L4 飞书原生入口", "规划中", "妙搭统一访问 · aily 审批 · 经营看板"],
  ["L5 全链路扩展", "展望", "质检接入 · 物流 Agent · 调拨 · 平台 API"],
];

const dailyTimeline = [
  ["07:00", "缺货预警", "规划引擎 + AI 摘要"],
  ["07:20", "库存查询拉取", "分仓明细入湖"],
  ["07:30", "库存周转拉取", "总览 + 主数据联动"],
  ["08:00", "大件备货拉取", "采购台账对齐"],
  ["08:00", "跨境资讯采集", "采集时下相关内容热点等"],
  ["08:05", "采购跟单拉取", "履约台账对齐"],
  ["09:00", "Dify 催办推送", "超期/待办 → 企微"],
  ["周一 09:00", "补货预测任务", "建议生成 · 可选文案增强"],
];

const STATUS_LEGEND = [
  ["已上线", "核心场景在用，可按 task_runs / 业务操作验收"],
  ["试点中", "小范围跑通或局部流程覆盖，尚未全量推广"],
  ["飞书已有", "能力在飞书侧（看板/通知/台账），尚未接入 scm-agent"],
  ["建设中", "开发或联调中，暂无稳定业务验收"],
  ["规划中", "方案阶段，无生产验收"],
];

const confirmedDecisions = [
  ["多备货基线", "迅捷 ERP 审核需求备货 − 财务 BI SKU 预报（2025 约 4 亿）", "已确认"],
  ["备货评审工时", "单次节省时长 × 有效备货次数", "另算 · 待单独测算"],
  ["已上线能力试用", "采购催办、缺货预警", "优先试用中"],
  ["质检飞书应用", "待检看板 + 自动化通知", "飞书侧已正常应用"],
  ["质检接入 scm-agent", "统一入口与数据闭环", "前置依赖已满足 · 待开发排期"],
];

const quarterAcceptance = [
  ["FOB 分账", "576 工时基线 · 系统分摊后节省约 80%", "物流费用负责人"],
  ["五条数据链", "07:00–09:00 Cron 稳定 · task_runs 可追溯", "IT / 计划"],
  ["采购催办试用", "超期推送覆盖率 · 人均查表时长抽样", "采购负责人"],
];

/** 能力点验收（一点一账） */
const capabilityAcceptance = [
  ["A · 销量预测及备货", "多备货基线；备货评审工时（另算）；预测版本发布", "计划负责人", "口径已确认 · 工时待测算"],
  ["B · 采购跟单/催办", "超期推送覆盖率；人均跟单查询时长", "采购负责人", "优先试用中 · 待抽样"],
  ["C · FOB 分账", "对账/分摊工时；差错复核次数", "物流费用负责人", "现状576h · 节省约80%"],
  ["库存健康/预警", "07:00 预警响应；红灯 SKU 处理周期", "计划负责人", "待采基线"],
  ["质检待检协同", "待检清单闭环率；通知触达时效", "质检负责人", "飞书已正常应用 · 待接入"],
];

const unifiedDeliveryStatus = [
  ["库存周转 / 总览", "计划 · 运营", "scm-agent 日快照 + 补货输入", "已上线", "07:30 链路稳定"],
  ["补货建议 / PMC / 跟单", "计划 · 采购", "主闭环核心", "已上线", "状态机 + 到货回写"],
  ["大件备货 / 采购跟单", "采购", "飞书同步 + Dify 催办", "试点中", "催办优先试用 · 基线采集中"],
  ["销售预测", "运营", "版本发布 + 复核", "已上线", "准确率指标待固化"],
  ["FOB 分账", "物流", "头程分摊与核对", "已上线", "现状576h · 节省约80%"],
  ["缺货预警", "计划", "07:00 推群 + 摘要", "试点中", "响应时效待采基线"],
  ["SKU 驾驶舱 / 发运", "计划 · 物流", "单 SKU 深化 / 里程碑", "建设中", "非主汇报验收项"],
  ["质检待检", "质检", "飞书看板 + 自动化通知", "飞书已有", "飞书侧已正常应用"],
  ["妙搭统一入口", "全列", "REST 挂载 scm-agent", "规划中", "L4 路线"],
  ["AI 批量预测", "运营", "Dify Agent + 月报", "规划中", "L3 试点延伸"],
];

export default function ScmFeishuAiBlueprint() {
  return (
    <div style={shellStyle}>
      <div style={contentStyle}>
        <Stack gap={56}>
          <Stack gap={24} style={{ textAlign: "center" as const, alignItems: "center" }}>
            <Text size="small" style={{ ...captionStyle, color: D.textSecondary }}>
              scm-agent · SCM 效率工程 · 飞书 AI+
            </Text>
            <H1
              style={{
                fontSize: 38,
                fontWeight: 700,
                lineHeight: 1.12,
                color: D.text,
                letterSpacing: "-0.03em",
                margin: 0,
                maxWidth: 720,
              }}
            >
              scm-agent · SCM 效率工程
            </H1>
            <Text style={{ ...bodyStyle, maxWidth: 600, fontSize: 15 }}>
              跨境电商供应链效率工程平台，覆盖计划—采购—物流—运营主轴。以飞书为协同底座、妙搭为统一入口、Dify
              为 AI 神经，回答「该不该补、补多少、何时下单、能否按期到货」。
            </Text>
            <PillTrack>
              <EditorialPill active>scm-agent</EditorialPill>
              <EditorialPill active>SCM 效率工程</EditorialPill>
              <EditorialPill>飞书 AI+</EditorialPill>
              <EditorialPill>四大引擎</EditorialPill>
            </PillTrack>
          </Stack>

          <Stack gap={32}>
            <SectionTitle>一、背景 · 现状 · 要解决的问题</SectionTitle>
        <EditorialTable title="核心痛点" trailing="7 项" headers={["类别", "具体表现"]} rows={painPoints} />
        <EditorialNote title="业务部门集中反馈">
          以上痛点来自计划、采购、运营等业务线日常协作中的共性诉求；详细案例与量化反馈见飞书多维表格{" "}
          <Link
            href="https://chinabestwo.feishu.cn/base/UvD5b2txjau5WksACknccdQknHh?from=from_copylink"
            style={{ color: D.blue, textDecoration: "none", fontWeight: 500 }}
          >
            供应链业务痛点与改进建议汇总
          </Link>
          。
        </EditorialNote>
        <Grid columns={3} gap={20}>
          <EditorialMiniCard title="业务诉求">
            PMC 要可解释建议；采购要超期自动找人；管理者要看板漏斗。
          </EditorialMiniCard>
          <EditorialMiniCard title="IT / 飞书诉求">
            统一入口、统一身份、敏感数据可控、对齐妙搭/AI+。
          </EditorialMiniCard>
          <EditorialMiniCard title="不做清单">
            正式 PO/付款、MES、船司 API、供应商门户、SAP 实对接。
          </EditorialMiniCard>
        </Grid>
      </Stack>

      <Stack gap={32}>
        <SectionTitle>二、价值模型 · 平台基建 + 能力点量化</SectionTitle>
        <EditorialNote title="价值记账原则">
          工时、资金、毛利分属不同能力点（A 预测备货 / B 采购催办 / C FOB 等），各点单独验收、单独对外表述；平台本身背「使能」——数据到位、引擎可算、飞书可协同。多备货口径（迅捷审核备货 − 财务 BI 预报）已确认，4 亿为 2025 历史参考基线。
        </EditorialNote>
        <EditorialTable
          title="能力点验收一览"
          trailing="一点一账"
          headers={["能力点", "验收指标（草案）", "业务负责人", "当前状态"]}
          rows={capabilityAcceptance}
        />
        <EditorialTable
          title="本季度验收重点"
          trailing="3 条"
          headers={["能力点", "验收要点", "业务负责人"]}
          rows={quarterAcceptance}
        />
        <EditorialTable
          title="业务核对结论"
          trailing="5 项"
          headers={["事项", "内容", "结论"]}
          rows={confirmedDecisions}
        />

        <EditorialH3>2.1 平台基建价值（定性 · 不背总账）</EditorialH3>
        <EditorialTable headers={["维度", "表述"]} rows={valueProps} />
        <Grid columns={3} gap={20}>
          <EditorialMiniCard title="数据基建">
            五条链路日更入湖 · 主数据联动 · 快照权威口径
          </EditorialMiniCard>
          <EditorialMiniCard title="引擎基建">
            规划 / PMC / AI 引擎可复用 · API 供妙搭挂载
          </EditorialMiniCard>
          <EditorialMiniCard title="协同基建">
            飞书登录 · RBAC · 任务日志 · 后续妙搭统一入口
          </EditorialMiniCard>
        </Grid>

        <EditorialH3>2.2 各能力点价值归属总表</EditorialH3>
        <EditorialTable headers={["能力点", "所属列", "价值类型", "量化状态", "角色"]} rows={capabilityValueMap} />
        <EditorialNote accent="neutral" title="效率飞轮（平台使能）">
          数据自动到位 → AI 自动筛推 → 人在飞书确认 → 闭环回写 → 次日再驱动各能力点业务。
        </EditorialNote>

        <EditorialH3>2.3 能力点 A · 销量预测及自动备货（价值量化）</EditorialH3>
        <EditorialNote title="本点范围">
          以下「多备货基线构成」「资金释放情景」仅针对【销量预测 +
          自动备货】能力点，不计入采购跟单/催办，也不作为整平台总收益。
        </EditorialNote>
        <Text tone="secondary" style={bodySecondary}>
          本点收益目标：降低库存资金占用、提升资金使用效率、减少缺货损失，并缩短备货评审时间。4
          亿元为去年多备货历史参考，不代表本点可直接释放或已实现收益。
        </Text>
        <EditorialNote accent="warm" title="该点口径说明">
          「多备货」= 迅捷 ERP 中审核的需求备货 − 财务 BI SKU 预报数据。2025 全年参考：审核需求备货约 12
          亿、财务 BI SKU 预报约 8 亿，差额约 4 亿作历史基线。数据来源：迅捷 ERP 审核备货台账、财务 BI SKU 预报报表（2025 全年）。实际释放资金 = 4 亿 ×
          冗余库存削减比例，须上线后验证；新增毛利不能直接等同于释放资金。
        </EditorialNote>
        <EditorialTable title="四维价值模型" trailing="仅预测/备货点" headers={["价值维度", "作用机制", "测算公式", "基线 / 约束"]} rows={forecastStockValueRows} />

        <EditorialStrong>【预测/备货点】多备货基线构成（2025）</EditorialStrong>
        <Text size="small" style={bodySecondary}>
          基线口径：迅捷 ERP 审核需求备货 − 财务 BI SKU 预报 = 多备货差额（2025 参考约 4 亿）；下图仅表达计算关系。
        </Text>
        <EditorialPanel>
          <Stack gap={8}>
            <FigureTitle>图 · 多备货基线（2025）· 迅捷审核备货 − 财务 BI 预报</FigureTitle>
            <ForecastStockBaselineChart />
            <div style={{ fontSize: 13, lineHeight: 1.5, color: D.textSecondary }}>
              数据来源：迅捷 ERP 审核备货台账、财务 BI SKU 预报报表 · 2025 全年参考 · 仅归属能力点 A
            </div>
          </Stack>
        </EditorialPanel>
        <EditorialCollapsible title="附录 · 资金释放情景测算" trailing="待财务确认 · 默认收起" defaultOpen={false}>
          <Text size="small" style={{ ...bodySecondary, marginBottom: 12 }}>
            下列数字为公式推演示意（4 亿 × 削减比例；转投毛利 = 可释放 × 50% × 25%），参数待业务确认，不作为承诺。
          </Text>
          <EditorialTable headers={["情景", "冗余削减比例", "预计释放资金", "转投毛利示意"]} rows={forecastStockScenarios} />
        </EditorialCollapsible>

        <EditorialNote title="备货评审工时">
          与多备货资金基线分开计量，有效次数与单次节省时长待业务单独采数，本报告暂不展开乘积测算。
        </EditorialNote>

        <EditorialH3>2.4 能力点 B · 采购跟单 / 大件催办（价值量化）</EditorialH3>
        <EditorialNote title="本点范围">
          降本、提效、作业模式升级仅针对【采购跟单 + 大件备货催办】（飞书同步 + Dify
          每日推送），与上方预测/备货资金账本分开计量。
        </EditorialNote>
        <EditorialTable title="价值模型" trailing="仅采购点"
              headers={["维度", "作用机制", "价值表述", "量化状态"]}
              rows={procurementValueRows}
             
            />
        <EditorialStrong>【采购点】提效试用</EditorialStrong>
        <Grid columns={3} gap={20}>
          <EditorialStat value="20" label="单人日节省(分钟·估)" />
          <EditorialStat value="10+" label="团队人数" />
          <EditorialStat value="试用中" label="工时基线采集中" />
        </Grid>
        <EditorialTable
              headers={["项", "数值", "说明"]}
              rows={procurementEffortRows}
             
            />
        <EditorialNote accent="warm" title="采购降本 · 待跟进量化">
          延期风险前置可降低加急生产、临时调拨、改船期及缺货等成本，金额需业务继续采数。建议指标：加急单占比、临时调拨次数、改船期次数、因延期导致的缺货损失。提效收益待试用基线确认后再对外固化。
        </EditorialNote>
        <EditorialNote accent="neutral" title="作业模式变化（本点）">
          采购从逐笔跟进全部订单，转为按系统待办与异常清单处理；订单状态统一展示，减少跨部门重复确认，降低交接成本。
        </EditorialNote>

        <EditorialH3>2.5 能力点 C · FOB 分账（价值量化）</EditorialH3>
        <EditorialNote title="本点范围">
          以下工时收益仅针对【FOB 头程费用分账】功能点（按工厂/柜号分摊与核对），与 A
          预测备货、B 采购催办分开计量。
        </EditorialNote>
        <EditorialTable title="价值模型" trailing="仅 FOB 点"
              headers={["维度", "作用机制", "价值表述", "量化状态"]}
              rows={fobValueRows}
             
            />
        <Grid columns={3} gap={20}>
          <EditorialStat value="576" label="现状手工工时/年" />
          <EditorialStat value="≈461" label="预计节省（80%）" />
          <EditorialStat value="≈115" label="系统后剩余（导出复核）" />
        </Grid>
        <EditorialTable headers={["项", "数值", "说明"]} rows={fobEffortRows} />
        <EditorialNote accent="neutral" title="提效表述（本点）">
          FOB 分账现状：3 人各每月约 2 天手工分摊与对账，折合约 576 工时/年。系统上线后分摊由系统直接计算，仅需导出结果核对，不再需要手工计算步骤，预计节省约
          80% 工时。
        </EditorialNote>

        <EditorialH3>2.6 其他能力点 · 量化方向（待采基线）</EditorialH3>
        <EditorialTable
              headers={["能力点", "建议指标", "说明"]}
              rows={[
                ["库存健康 / 预警", "预警响应时效 · 红灯 SKU 环比", "可与预测备货点的缺货挽回联动验证"],
                ["PMC 履约闭环", "准时到货率 · 异常关闭周期", "执行质量，不直接等于资金释放"],
                ["数据自动化", "日手工导入次数 → 0", "基建使能指标，不折算为平台总收益"],
              ]}
             
            />
      </Stack>

      <Stack gap={24}>
        <SectionTitle>三、架构 · 引擎 · 数据与闭环（概要）</SectionTitle>
        <Text size="small" style={bodySecondary}>
          飞书为协同底座、scm-agent 为引擎与数据层、Dify 为 AI 增强；下列图示与表为技术概要，细节见运维文档。
        </Text>
        <EditorialPanel>
            <LayerStackDiagram />
        </EditorialPanel>
        <EditorialTable
              headers={["层级", "平台", "职责", "状态", "隐喻"]}
              rows={architectureLayers}
            />
        <EnginesDiagram />
        <EditorialTable
              headers={["引擎", "回答的问题", "能力构成", "业务产出"]}
              rows={enginesDetail}
            />
        <EditorialPanel>
            <DataFlowDiagram />
        </EditorialPanel>
        <EditorialTable
              headers={["链路", "时间", "飞书源", "系统产出", "说明"]}
              rows={dataPipelines}
            />
        <EditorialPanel>
            <MainLoopDiagram />
        </EditorialPanel>
        <EditorialTable
              headers={["节点", "名称", "业务动作", "引擎", "控制点"]}
              rows={mainLoop}
            />
        <EditorialNote accent="neutral" title="子闭环速览">
          库存健康（07:00 预警推群）· 采购催办（飞书→Dify→企微）· 预测准确率（发布→回测）· 跨境资讯（采集→审核入飞书）。跟单状态：待确认 → 已确认 → 生产中 → 待发货 → 在途 → 部分到货 → 已收货。
        </EditorialNote>
      </Stack>

      <Stack gap={32}>
        <SectionTitle>四、分模块能力地图</SectionTitle>
        <EditorialTable headers={["状态", "含义"]} rows={STATUS_LEGEND} />
        <EditorialTable
          title="交付状态总表"
          trailing="统一口径"
          headers={["能力 / 节点", "所属列", "落点", "状态", "验收要点"]}
          rows={unifiedDeliveryStatus}
        />
        <EditorialH3>模块明细（状态同总表）</EditorialH3>
        <EditorialTable
              headers={["模块", "能力", "闭环角色", "状态"]}
              rows={modules}
             
            />
        <EditorialNote title="质检 · 现状说明">
          质检侧飞书待检看板与自动化通知已正常应用；scm-agent 统一入口与数据闭环的前置条件已满足，待开发排期。
        </EditorialNote>
      </Stack>

      <Stack gap={32}>
        <SectionTitle>五、对齐集团数字化蓝图</SectionTitle>
        <EditorialPanel>
            <CoverageChart />
        </EditorialPanel>
        <EditorialTable
              headers={["流程列", "数字化节点", "落点", "状态"]}
              rows={digitalizationMap}
             
            />
        <FigureCaption>状态定义见第四章；「已上线 / 试点中 / 飞书已有 / 建设中 / 规划中」与模块地图一致。</FigureCaption>
      </Stack>

      <Stack gap={32}>
        <SectionTitle>六、AI 能力矩阵</SectionTitle>
        <EditorialTable
              headers={["场景", "状态", "形态", "触发", "价值"]}
              rows={aiCapabilities}
             
            />
      </Stack>

      <Stack gap={32}>
        <SectionTitle>七、安全与治理</SectionTitle>
        <EditorialTable headers={["层级", "措施"]} rows={securityRows} />
      </Stack>

      <Stack gap={32}>
        <SectionTitle>八、成熟度路线 · 展望</SectionTitle>
        <EditorialNote title="成熟度口径（保守）">
          下图与下表按「可验收、可演示、可运维」保守自评，不将规划能力计为已完成；L1–L2 指核心场景跑通，非全模块 100% 覆盖。
        </EditorialNote>
        <EditorialPanel>
            <MaturityChart />
        </EditorialPanel>
        <EditorialTable
              headers={["层级", "状态", "关键交付"]}
              rows={roadmap}
             
            />
        <EditorialNote accent="neutral" title="结语">
          scm-agent 作为 SCM 效率工程平台，五条数据链自动入湖、四大引擎分工清晰、主闭环可验收、AI
          催办已上线。下一步挂妙搭、启知识库与 AI 预测，并推进质检能力接入 scm-agent。
        </EditorialNote>
      </Stack>

      <Spacer size={16} />
      <Text size="small" style={captionStyle}>
        scm-agent · 飞书 AI+ 蓝图 · 对齐集团数字化蓝图 · 2026-07-30
      </Text>
        </Stack>
      </div>
    </div>
  );
}
