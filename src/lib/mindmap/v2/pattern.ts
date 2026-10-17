// 材料导图 v2 · 版式选择（MINDMAP-V2-IMPL-PLAN §5.1 pattern.ts；设计稿 §15.4 / §15.8 S5）。
// 组级优先级：① 手动（view.patterns）> ② 模型提示（父行 `{版式}`，校验前提成立）> ③ 规则表 1–7。
// 选择器只决定「想要的版式」；某版式尚未实现时由 layout.ts 回落到 tree 并在 Display.groups 记 fallbackFrom。
// 材料级标签 materialLabel() 只用于画布左上角提示，不覆盖组级选择。
// S5 lockPattern()：一个任务内版式最多变更一次（开始按提示/规则定，结束时规则复核一次，之后锁定）。

import type { GraphState, PatternKey, RelCode, V2Edge } from "./types";
import { ROOT_ID } from "./types";

export type PatternHow = "manual" | "hint" | "rule";

export const PATTERN_NAMES: Record<PatternKey, string> = {
  tree: "大纲树",
  chain: "链",
  timeline: "时间线",
  layered: "分层图",
  argument: "论证图",
  compare: "对照",
  grid: "网格",
};

export const HOW_NAMES: Record<PatternHow, string> = { manual: "手动", hint: "模型提示", rule: "自动推断" };

export interface PatternSelection {
  pattern: PatternKey;
  how: PatternHow;
  /** 规则表命中行号 1–7；手动 / 提示为 null */
  rule: number | null;
}

/** 选择器输入（与 GraphState 解耦，便于单测逐行构造正反例） */
export interface GroupFacts {
  /** 父节点类型（合成根为 "材料"） */
  parentType: string;
  patternHint: PatternKey | null;
  manual: PatternKey | null;
  /** 可见子（未做 LOD 截断），原文顺序 */
  kids: { id: string; type: string; timeText: string | null; hasChildren: boolean }[];
  /** 两端都在 kids 内的关系（去重，确定性顺序） */
  siblingEdges: { from: string; to: string; code: RelCode }[];
}

const FLOW_CODES: ReadonlySet<string> = new Set(["据", "推", "因"]);
const CHAIN_TYPES: ReadonlySet<string> = new Set(["步骤", "推导", "前提", "结论"]);

/** 模型提示 / 手动版式的前提（不成立则不采用提示，落到规则表） */
export function hintValid(hint: PatternKey, facts: GroupFacts): boolean {
  const n = facts.kids.length;
  switch (hint) {
    case "tree":
    case "chain":
    case "argument":
      return n >= 1;
    case "timeline":
    case "layered":
    case "compare":
    case "grid":
      return n >= 2;
    default:
      return false;
  }
}

/** §15.4 规则表（按序取第一个命中）；返回版式与行号 */
export function ruleOf(facts: GroupFacts): { pattern: PatternKey; rule: number } {
  const kids = facts.kids;
  const n = kids.length;
  const share = (f: (t: string) => boolean) => (n ? kids.filter((k) => f(String(k.type))).length / n : 0);
  // 1 时间线：子全部带时间元信息，或 ≥75% 为「叙事」
  if (n > 0 && (kids.every((k) => !!(k.timeText && k.timeText.trim())) || share((t) => t === "叙事") >= 0.75))
    return { pattern: "timeline", rule: 1 };
  // 2 论证图：父为「论点」，或子含「反方观点」，或「理由/证据」≥50%
  if (facts.parentType === "论点" || kids.some((k) => k.type === "反方观点") || share((t) => t === "理由" || t === "证据") >= 0.5)
    return { pattern: "argument", rule: 2 };
  // 3 对照：（父为「对比」或子间存在「比」关系）且子 ≥2
  if ((facts.parentType === "对比" || facts.siblingEdges.some((e) => e.code === "比")) && n >= 2)
    return { pattern: "compare", rule: 3 };
  // 4 分层图：子 ≥3 且子间「据/推/因」边数 ≥ 子数−1
  if (n >= 3 && facts.siblingEdges.filter((e) => FLOW_CODES.has(e.code)).length >= n - 1)
    return { pattern: "layered", rule: 4 };
  // 5 链：「步骤/推导/前提/结论」≥60%
  if (n > 0 && share((t) => CHAIN_TYPES.has(t)) >= 0.6) return { pattern: "chain", rule: 5 };
  // 6 网格：子 ≥6、都没有子节点、彼此无关系
  if (n >= 6 && kids.every((k) => !k.hasChildren) && facts.siblingEdges.length === 0) return { pattern: "grid", rule: 6 };
  // 7 其余
  return { pattern: "tree", rule: 7 };
}

export function selectPattern(facts: GroupFacts): PatternSelection {
  if (facts.manual) return { pattern: facts.manual, how: "manual", rule: null };
  if (facts.patternHint && hintValid(facts.patternHint, facts)) return { pattern: facts.patternHint, how: "hint", rule: null };
  const r = ruleOf(facts);
  return { pattern: r.pattern, how: "rule", rule: r.rule };
}

/** 从图状态取某组的选择器输入；kidIds 为可见子（原文顺序） */
export function groupFacts(state: GraphState, parentId: string, kidIds: readonly string[]): GroupFacts {
  const node = parentId === ROOT_ID ? null : state.nodes[parentId];
  const ids = new Set(kidIds);
  const kids = kidIds.map((id) => {
    const k = state.nodes[id];
    return {
      id,
      type: k ? String(k.type) : "其他",
      timeText: k ? k.timeText : null,
      hasChildren: (state.children[id]?.length ?? 0) > 0,
    };
  });
  const siblingEdges: GroupFacts["siblingEdges"] = [];
  for (const id of kidIds) {
    for (const e of state.outEdges[id] ?? ([] as readonly V2Edge[])) {
      if (ids.has(e.to)) siblingEdges.push({ from: e.from, to: e.to, code: e.code });
    }
  }
  return {
    parentType: node ? String(node.type) : "材料",
    patternHint: node ? node.patternHint ?? null : null,
    manual: state.view.patterns[parentId] ?? null,
    kids,
    siblingEdges,
  };
}

// ───────────────────────── 材料级图式标签 ─────────────────────────

export type MaterialKey = "argument" | "proof" | "expository" | "narrative" | "mixed";
export const MATERIAL_NAMES: Record<MaterialKey, string> = {
  argument: "论证型",
  proof: "证明型",
  expository: "说明型",
  narrative: "叙事型",
  mixed: "混合型",
};

const FAMILY: Record<string, [MaterialKey, number][]> = {};
for (const t of ["论点", "理由", "证据", "例证", "反方观点", "反驳", "让步"]) FAMILY[t] = [["argument", 1]];
for (const t of ["命题", "前提", "定义", "引理", "推导", "分情形"]) FAMILY[t] = [["proof", 1]];
for (const t of ["引言", "背景", "问题", "方案", "分类", "对比", "因果", "步骤", "总结"]) FAMILY[t] = [["expository", 1]];
for (const t of ["叙事", "案例"]) FAMILY[t] = [["narrative", 1]];
// 「结论」同属论证族与证明族，各计半票
FAMILY["结论"] = [["argument", 0.5], ["proof", 0.5]];

/** 主导族占比阈值：最高族 ≥ 此值才给单一标签，否则「混合型」 */
export const MATERIAL_DOMINANCE = 0.5;

export interface MaterialLabel {
  key: MaterialKey;
  label: string;
  /** 各族占比（四舍五入到 0.001，保证确定性输出） */
  shares: Record<Exclude<MaterialKey, "mixed">, number>;
  typed: number;
}

/** 按全图节点类型族占比给整体图式标签（「其他」不计）；无有效类型时为说明型 */
export function materialLabel(nodes: Iterable<{ type: string }>): MaterialLabel {
  const acc = { argument: 0, proof: 0, expository: 0, narrative: 0 };
  let typed = 0;
  for (const n of nodes) {
    const fam = FAMILY[String(n.type)];
    if (!fam) continue;
    typed++;
    for (const [k, w] of fam) acc[k as keyof typeof acc] += w;
  }
  const shares = { argument: 0, proof: 0, expository: 0, narrative: 0 };
  let best: keyof typeof acc = "expository";
  let bestV = -1;
  for (const k of ["argument", "proof", "expository", "narrative"] as const) {
    shares[k] = typed ? Math.round((acc[k] / typed) * 1000) / 1000 : 0;
    if (acc[k] > bestV) {
      bestV = acc[k];
      best = k;
    }
  }
  const key: MaterialKey = !typed ? "expository" : acc[best] / typed >= MATERIAL_DOMINANCE ? best : "mixed";
  return { key, label: MATERIAL_NAMES[key], shares, typed };
}

// ───────────────────────── S5 版式迟定一次 ─────────────────────────

export interface PatternLockEntry {
  pattern: PatternKey;
  how: PatternHow;
  rule: number | null;
  /** 该锁所属任务（组节点的 jobId；无任务＝null） */
  jobId: string | null;
  /** 本任务内已发生的变更次数（≤1） */
  changes: number;
  /** 任务结束复核后锁定 */
  locked: boolean;
}

export type PatternLocks = Readonly<Record<string, PatternLockEntry>>;

export interface LockPhase {
  /** 组节点正在流式生成（node.state === 'streaming'） */
  streaming: boolean;
  jobId: string | null;
}

/**
 * S5 状态机（纯）：
 * - 手动选择永远直接生效（how='manual'），并锁定。
 * - 新任务（无旧锁，或 jobId 变化）：无旧锁 → 采用当前提议（通常是模型提示）；有旧锁 → 沿用旧版式（避免首子到达时跳变），changes 归零。
 * - 流式期间：忽略提议，保持锁内版式。
 * - 任务结束（streaming=false）且未锁：提议与锁内不同且 changes<1 → 变更一次；随后锁定。
 * - 已锁：保持，直到下一个任务或手动。
 * 返回新锁项（未变化时返回原对象引用）与生效选择。
 */
export function lockPattern(
  prev: PatternLockEntry | undefined,
  proposed: PatternSelection,
  phase: LockPhase,
): { entry: PatternLockEntry; selection: PatternSelection } {
  const sel = (e: PatternLockEntry): PatternSelection => ({ pattern: e.pattern, how: e.how, rule: e.rule });
  if (proposed.how === "manual") {
    if (prev && prev.locked && prev.how === "manual" && prev.pattern === proposed.pattern) return { entry: prev, selection: sel(prev) };
    const entry: PatternLockEntry = { ...proposed, jobId: phase.jobId, changes: prev ? prev.changes : 0, locked: true };
    return { entry, selection: proposed };
  }
  let entry: PatternLockEntry;
  if (!prev) {
    entry = { ...proposed, jobId: phase.jobId, changes: 0, locked: false };
  } else if (prev.how === "manual") {
    // 用户撤销手动：按新任务处理，采用提议
    entry = { ...proposed, jobId: phase.jobId, changes: 0, locked: false };
  } else if (prev.jobId !== phase.jobId) {
    entry = { ...prev, jobId: phase.jobId, changes: 0, locked: false };
  } else {
    entry = prev;
  }
  if (!phase.streaming && !entry.locked) {
    if (entry.pattern !== proposed.pattern && entry.changes < 1) entry = { ...proposed, jobId: entry.jobId, changes: entry.changes + 1, locked: true };
    else entry = { ...entry, locked: true };
  }
  if (prev && entry !== prev && sameEntry(prev, entry)) entry = prev;
  return { entry, selection: sel(entry) };
}

function sameEntry(a: PatternLockEntry, b: PatternLockEntry): boolean {
  return a.pattern === b.pattern && a.how === b.how && a.rule === b.rule && a.jobId === b.jobId && a.changes === b.changes && a.locked === b.locked;
}
