import type { CSSProperties, ReactNode } from "react";

export type StackProps = {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
};

export function Stack({ children, gap = 0, style }: StackProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type GridProps = {
  children?: ReactNode;
  columns: number | string;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  style?: CSSProperties;
};

export function Grid({ children, columns, gap = 0, align, style }: GridProps) {
  const template =
    typeof columns === "number" ? `repeat(${columns}, minmax(0, 1fr))` : columns;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: template,
        gap,
        alignItems: align,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function H1({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <h1
      style={{
        margin: 0,
        fontSize: 24,
        fontWeight: 700,
        lineHeight: 1.2,
        ...style,
      }}
    >
      {children}
    </h1>
  );
}

export function Link({
  href,
  children,
  style,
  target,
  rel,
}: {
  href: string;
  children?: ReactNode;
  style?: CSSProperties;
  target?: string;
  rel?: string;
}) {
  return (
    <a href={href} style={style} target={target} rel={rel}>
      {children}
    </a>
  );
}

export function Spacer({ size }: { size?: number }) {
  if (size) {
    return <div style={{ height: size, flexShrink: 0 }} aria-hidden />;
  }
  return <div style={{ flex: 1 }} aria-hidden />;
}

export function Text({
  children,
  size,
  tone,
  style,
}: {
  children?: ReactNode;
  size?: "small" | "medium";
  tone?: "secondary";
  style?: CSSProperties;
}) {
  const fontSize = size === "small" ? 13 : 15;
  const color = tone === "secondary" ? "#666666" : undefined;
  return (
    <p
      style={{
        margin: 0,
        fontSize,
        lineHeight: 1.6,
        color,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

type DAGLayoutOptions = {
  nodes: Array<{ id: string }>;
  edges: Array<{ from: string; to: string }>;
  direction?: "vertical" | "horizontal";
  nodeWidth?: number;
  nodeHeight?: number;
  rankGap?: number;
  nodeGap?: number;
  padding?: number;
};

export function computeDAGLayout(options: DAGLayoutOptions) {
  const {
    nodes,
    edges,
    direction = "vertical",
    nodeWidth = 160,
    nodeHeight = 40,
    rankGap = 64,
    nodeGap = 48,
    padding = 24,
  } = options;

  const nodeIds = nodes.map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  const backEdgeSet = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(nodeId: string) {
    visiting.add(nodeId);
    for (const next of adj.get(nodeId) ?? []) {
      const key = `${nodeId}->${next}`;
      if (visiting.has(next)) backEdgeSet.add(key);
      else if (!visited.has(next)) dfs(next);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) dfs(nodeId);
  }

  const forwardEdges = edges.filter((e) => !backEdgeSet.has(`${e.from}->${e.to}`));
  const inDegree = new Map<string, number>();
  const fwdAdj = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0);
    fwdAdj.set(nodeId, []);
  }
  for (const edge of forwardEdges) {
    fwdAdj.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  for (const id of queue) rank.set(id, 0);

  while (queue.length) {
    const current = queue.shift()!;
    const currentRank = rank.get(current) ?? 0;
    for (const next of fwdAdj.get(current) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, currentRank + 1));
      inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  for (const nodeId of nodeIds) {
    if (!rank.has(nodeId)) rank.set(nodeId, 0);
  }

  const ranksMap = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const r = rank.get(nodeId)!;
    if (!ranksMap.has(r)) ranksMap.set(r, []);
    ranksMap.get(r)!.push(nodeId);
  }

  const maxRank = Math.max(...Array.from(ranksMap.keys()), 0);
  const layoutNodes: Array<{
    id: string;
    x: number;
    y: number;
    rank: number;
    order: number;
  }> = [];
  const ranks: Array<{
    rank: number;
    x: number;
    y: number;
    width: number;
    height: number;
    nodeIds: string[];
  }> = [];

  for (let r = 0; r <= maxRank; r++) {
    const ids = ranksMap.get(r) ?? [];
    const rankWidth =
      direction === "horizontal"
        ? nodeWidth
        : ids.length * nodeWidth + Math.max(0, ids.length - 1) * nodeGap;
    const rankHeight =
      direction === "horizontal"
        ? ids.length * nodeHeight + Math.max(0, ids.length - 1) * nodeGap
        : nodeHeight;

    ids.forEach((id, order) => {
      const x =
        direction === "horizontal"
          ? padding + r * (nodeWidth + rankGap)
          : padding + order * (nodeWidth + nodeGap);
      const y =
        direction === "horizontal"
          ? padding + order * (nodeHeight + nodeGap)
          : padding + r * (nodeHeight + rankGap);
      layoutNodes.push({ id, x, y, rank: r, order });
    });

    ranks.push({
      rank: r,
      x: direction === "horizontal" ? padding + r * (nodeWidth + rankGap) : padding,
      y: direction === "horizontal" ? padding : padding + r * (nodeHeight + rankGap),
      width: rankWidth,
      height: rankHeight,
      nodeIds: ids,
    });
  }

  const pos = Object.fromEntries(layoutNodes.map((n) => [n.id, n]));
  const layoutEdges = edges.map((edge) => {
    const from = pos[edge.from];
    const to = pos[edge.to];
    const isBackEdge = backEdgeSet.has(`${edge.from}->${edge.to}`);
    let sourceX: number;
    let sourceY: number;
    let targetX: number;
    let targetY: number;
    if (direction === "horizontal") {
      sourceX = from.x + nodeWidth;
      sourceY = from.y + nodeHeight / 2;
      targetX = to.x;
      targetY = to.y + nodeHeight / 2;
    } else {
      sourceX = from.x + nodeWidth / 2;
      sourceY = from.y + nodeHeight;
      targetX = to.x + nodeWidth / 2;
      targetY = to.y;
    }
    return { ...edge, sourceX, sourceY, targetX, targetY, isBackEdge };
  });

  const width =
    direction === "horizontal"
      ? padding * 2 + (maxRank + 1) * nodeWidth + maxRank * rankGap
      : padding * 2 + Math.max(...ranks.map((rk) => rk.width), nodeWidth);
  const height =
    direction === "horizontal"
      ? padding * 2 + Math.max(...ranks.map((rk) => rk.height), nodeHeight)
      : padding * 2 + (maxRank + 1) * nodeHeight + maxRank * rankGap;

  return { nodes: layoutNodes, edges: layoutEdges, ranks, direction, width, height };
}
