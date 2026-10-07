// v48.61（D103，D94 设计稿 §3.1）：卡详情「来源谱系（血缘树）」纯函数。
// 复用 D87 锚点闭包的邻接表口径（workflow 行 contextRef.parentExtractId）与
// D85 aggregateCardCounts 聚合计数（自身直卡 + 全部后代直卡）——零 IPC、零新写路径。
// 树＝本卡所属摘录节点**向上到根、向下到叶**；脏数据（环/断链）不抛、如实截断。
// 可被 esbuild 打包进测试（禁 window/IPC 依赖）。
import { aggregateCardCounts } from "./reader/marks";

/** 引文首行截断上限（设计稿 §3.1：≤40 字） */
export const LINEAGE_LABEL_MAX = 40;

export interface LineageNode {
  id: string;
  /** 引文首行截断（≤40 字；空正文显示占位） */
  label: string;
  /** 制卡计数徽标（D85 聚合口径：该节点自身 + 全部后代的直卡数） */
  count: number;
  /** 本卡所属节点高亮 */
  isCurrent: boolean;
  /** 视觉缩进层级（根=0，向下递增；祖先链与子孙闭包共用一把连续标尺） */
  depth: number;
  /** 是否可跳原文（摘录行带 documentId 才可跳，与卡详情「跳转原文」同判定精神） */
  documentId: string | null;
  anchorText: string | null;
  anchorRatio: number | null;
}

export interface LineageTree {
  /** false＝空态「无来源锚」（extractId 缺失或摘录行不存在） */
  hasSource: boolean;
  /** 根 → 本卡节点（含本卡节点，isCurrent=true）；断链/环在缺失处如实截断 */
  ancestors: LineageNode[];
  /** 本卡节点的全部子孙（BFS 序，跳过本卡自身） */
  descendants: LineageNode[];
}

/** 引文首行截断：取第一条非空行，按字符（含中文）截断 ≤max */
export function firstLineLabel(text: string | null | undefined, max = LINEAGE_LABEL_MAX): string {
  const line = String(text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean) ?? "";
  const chars = [...line];
  if (chars.length <= max) return line;
  return chars.slice(0, max).join("") + "…";
}

/** 输入行形状：渲染层 DirectExtract 派生面（只读所需字段，多余字段不关心） */
export interface LineageExtractRow {
  id: string;
  contentMarkdown?: string | null;
  documentId?: string | null;
  contextRef?: { parentExtractId?: string | null; anchorText?: string | null; anchorRatio?: number | null } | null;
}

export interface LineageCardRow {
  contextRef?: { extractId?: string | null } | null;
}

/**
 * 建本卡血缘树：祖先链（parentExtractId 上溯）+ 子孙闭包（parentToChildren 下钻）。
 * counts 直接由 cards 派生（contextRef.extractId 计数），聚合走 marks.aggregateCardCounts。
 */
export function buildLineageTree(opts: {
  extractId?: string | null;
  extracts: ReadonlyArray<LineageExtractRow>;
  cards: ReadonlyArray<LineageCardRow>;
}): LineageTree {
  const extractId = opts.extractId ? String(opts.extractId) : "";
  const byId = new Map<string, LineageExtractRow>();
  const parentToChildren = new Map<string, string[]>();
  for (const e of opts.extracts) {
    if (!e?.id) continue;
    byId.set(String(e.id), e);
    const pid = e?.contextRef?.parentExtractId;
    if (pid) {
      const list = parentToChildren.get(String(pid)) ?? [];
      list.push(String(e.id));
      parentToChildren.set(String(pid), list);
    }
  }
  const empty: LineageTree = { hasSource: false, ancestors: [], descendants: [] };
  if (!extractId || !byId.has(extractId)) return empty;

  // 直卡计数 → D85 聚合（记忆化 DFS + 防环）
  const direct: Record<string, number> = {};
  for (const c of opts.cards) {
    const ce = c?.contextRef?.extractId;
    if (ce) direct[String(ce)] = (direct[String(ce)] ?? 0) + 1;
  }
  const agg = aggregateCardCounts(direct, parentToChildren);

  const nodeOf = (id: string, isCurrent: boolean, depth: number): LineageNode => {
    const row = byId.get(id);
    return {
      id,
      label: firstLineLabel(row?.contentMarkdown),
      count: agg[id] ?? 0,
      isCurrent,
      depth,
      documentId: row?.documentId ? String(row.documentId) : null,
      anchorText: row?.contextRef?.anchorText ? String(row.contextRef.anchorText) : null,
      anchorRatio: typeof row?.contextRef?.anchorRatio === "number" ? (row.contextRef.anchorRatio as number) : null
    };
  };

  // 祖先链：current → root，visited 防环；断链（父 id 不在摘录面内）如实止步
  const chain: string[] = [];
  const seenUp = new Set<string>([extractId]);
  let cursor: string | null = extractId;
  while (cursor) {
    chain.push(cursor);
    const pid: string | null | undefined = byId.get(cursor)?.contextRef?.parentExtractId;
    const next: string = pid ? String(pid) : "";
    if (!next || seenUp.has(next) || !byId.has(next)) break;
    seenUp.add(next);
    cursor = next;
  }
  chain.reverse(); // 根 → current
  const baseDepth = chain.length - 1;
  const ancestors = chain.map((id, i) => nodeOf(id, id === extractId, i));

  // 子孙闭包：BFS 下钻（D87 同款邻接表），深度接在祖先链标尺上（current 的子 = baseDepth+1）
  const descendants: LineageNode[] = [];
  const seenDown = new Set<string>([extractId]);
  let frontier = [extractId];
  let level = 0;
  while (frontier.length) {
    level += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of parentToChildren.get(id) ?? []) {
        if (seenDown.has(child)) continue;
        seenDown.add(child);
        descendants.push(nodeOf(child, false, baseDepth + level));
        next.push(child);
      }
    }
    frontier = next;
  }

  return { hasSource: true, ancestors, descendants };
}
