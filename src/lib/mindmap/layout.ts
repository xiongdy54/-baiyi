// 材料知识导图——确定性树布局（v48 批3，M15，D42 / §4.19-9）。
// 纯函数、无随机源、同一输入恒同一输出（100 次布局逐字节一致入测试）。
// 算法：可见子树（折叠子树不参与布局，大图性能红线）后序遍历——叶按序纵向均布、内部节点
// 居中于其子、x 按层累计（层右缘 + gap）。同层互不重叠、跨层互不重叠，正交肘形连线无交叉。
// 水平层级树（v1 唯一布局；Non-Goals：不做多布局引擎）。

export interface MapNodeLike {
  id: string;
  parentId: string | null;
  title: string;
  childIds: string[];
  authorialRole?: string | null;
}

export interface LayoutOptions {
  /** 已展开节点集合：其子可见；不在集合内且有子 → 折叠（子树整体不布局） */
  expandedIds: Set<string>;
}

export interface LayoutNode {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 子树存在子节点（可能可见或折叠） */
  hasChildren: boolean;
  /** 折叠态（显示 +N 徽标） */
  collapsed: boolean;
  /** 折叠子树的可见后代数（徽标数字；0=无） */
  collapsedCount: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  /** SVG path d（正交肘形：父右缘中点 → 层间水平中线 → 垂直 → 子左缘中点） */
  d: string;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { w: number; h: number };
}

// 视觉常量（§4.19-9；数值锁死保证快照稳定；4px 网格取整）
const NODE_H = 40;
const PAD_X = 12;
const CHAR_W = 14; // 13px CJK 字符近似宽（含字距）
const MIN_W = 128;
const MAX_W = 264;
const H_GAP = 48;
const V_GAP = 12;

export function nodeWidth(title: string): number {
  const w = PAD_X * 2 + String(title || "").length * CHAR_W;
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(w / 4) * 4));
}

export function layoutMap(nodesIn: MapNodeLike[], rootNodeId: string, opts: LayoutOptions): LayoutResult {
  const byId = new Map(nodesIn.map((n) => [n.id, n]));
  const root = byId.get(rootNodeId);
  if (!root) return { nodes: [], edges: [], bounds: { w: 0, h: 0 } };
  const expanded = opts.expandedIds;

  // ① 可见树：折叠子树整体不入布局（§4.19-9 性能红线）
  const visible: string[] = [];
  const collapsedCount = new Map<string, number>();
  const countDescendants = (id: string): number => {
    let n = 0;
    const node = byId.get(id);
    for (const c of (node?.childIds || []).filter((x) => byId.has(x))) {
      n += 1 + countDescendants(c);
    }
    return n;
  };
  const walkVisible = (id: string) => {
    visible.push(id);
    const node = byId.get(id);
    const kids = (node?.childIds || []).filter((c) => byId.has(c));
    if (kids.length && !expanded.has(id)) {
      collapsedCount.set(id, countDescendants(id));
      return;
    }
    for (const c of kids) walkVisible(c);
  };
  walkVisible(rootNodeId);
  const visibleSet = new Set(visible);

  // ② y 分配：后序遍历——叶按序纵向均布，内部节点居中于可见子
  const yOf = new Map<string, number>();
  let cursor = 0;
  const assignY = (id: string): number => {
    const node = byId.get(id);
    const visibleKids = (node?.childIds || []).filter((c) => visibleSet.has(c));
    if (!visibleKids.length) {
      const y = cursor;
      cursor += NODE_H + V_GAP;
      yOf.set(id, y);
      return y;
    }
    const ys = visibleKids.map(assignY);
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    yOf.set(id, y);
    return y;
  };
  assignY(rootNodeId);

  // ③ x 分配：按层累计——层 d 的 x = 层 d-1 的最大右缘 + H_GAP
  const depthOf = new Map<string, number>();
  const setDepth = (id: string, d: number) => {
    depthOf.set(id, d);
    const node = byId.get(id);
    for (const c of (node?.childIds || []).filter((x) => visibleSet.has(x))) setDepth(c, d + 1);
  };
  setDepth(rootNodeId, 0);
  const layerX = new Map<number, number>();
  const maxRightPerLayer = new Map<number, number>();
  const byDepth = [...visible].sort((a, b) => (depthOf.get(a) || 0) - (depthOf.get(b) || 0));
  for (const id of byDepth) {
    const d = depthOf.get(id) || 0;
    if (!layerX.has(d)) layerX.set(d, d === 0 ? 0 : (maxRightPerLayer.get(d - 1) || 0) + H_GAP);
    const w = nodeWidth(byId.get(id)?.title || "");
    maxRightPerLayer.set(d, Math.max(maxRightPerLayer.get(d) || 0, (layerX.get(d) || 0) + w));
  }

  // ④ 产出节点 + 正交肘形边
  const layoutNodes: LayoutNode[] = visible.map((id) => {
    const n = byId.get(id);
    const allKids = (n?.childIds || []).filter((c) => byId.has(c));
    return {
      id,
      parentId: n?.parentId ?? null,
      title: n?.title || "",
      depth: depthOf.get(id) || 0,
      x: layerX.get(depthOf.get(id) || 0) || 0,
      y: yOf.get(id) || 0,
      w: nodeWidth(n?.title || ""),
      h: NODE_H,
      hasChildren: allKids.length > 0,
      collapsed: collapsedCount.has(id),
      collapsedCount: collapsedCount.get(id) || 0
    };
  });
  const layoutById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edges: LayoutEdge[] = [];
  for (const n of layoutNodes) {
    const parent = n.parentId ? layoutById.get(n.parentId) : null;
    if (!parent) continue;
    const x1 = parent.x + parent.w;
    const y1 = parent.y + parent.h / 2;
    const x2 = n.x;
    const y2 = n.y + n.h / 2;
    const mx = x1 + Math.max(H_GAP / 2, (x2 - x1) / 2);
    edges.push({ fromId: parent.id, toId: n.id, d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}` });
  }

  const maxRight = layoutNodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
  const maxBottom = layoutNodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
  return {
    nodes: layoutNodes,
    edges,
    bounds: { w: maxRight + PAD_X, h: Math.max(maxBottom, 0) }
  };
}
