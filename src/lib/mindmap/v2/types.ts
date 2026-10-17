// 材料导图 v2 · 渲染层数据类型（MINDMAP-V2-IMPL-PLAN §3.1 / §4.2 / §5.1）。
// 与主进程 DTO 字段一一对应：表列 snake_case → DTO camelCase（node_id→id、parent_id→parentId、
// time_text→timeText、pattern_hint→patternHint、block_start→blockStart、block_end→blockEnd、
// spans_json→spans、warnings_json→warnings、explain_json→explain、job_id→jobId …）。
// user_id / map_id / sync_version / is_deleted 不进 DTO（map_id 由外层 meta / delta 携带）。
// 纯类型文件：无运行时代码以外的常量。

/** §8.1 类型表（封闭枚举，中文短标签）；未知类型由解析器归为「其他」。 */
export const NODE_TYPES = [
  "论点", "理由", "证据", "例证", "反方观点", "反驳", "让步", "结论",
  "命题", "前提", "定义", "引理", "推导", "分情形",
  "引言", "背景", "问题", "方案", "分类", "对比", "因果", "步骤", "总结",
  "叙事", "案例",
  "其他",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** §8.2 八类关系码；语义统一为「本节点 —码→ 目标」（「据」画成目标 → 本节点）。 */
export const REL_CODES = ["支", "驳", "据", "推", "因", "比", "例", "答"] as const;
export type RelCode = (typeof REL_CODES)[number];

/** §15.3 七版式英文键（解析器已把 `{对照}` 等中文提示映射为英文键）。 */
export const PATTERN_KEYS = ["tree", "chain", "timeline", "layered", "argument", "compare", "grid"] as const;
export type PatternKey = (typeof PATTERN_KEYS)[number];

/** 持久化状态（streaming 只在内存，由 delta.states 下发）。 */
export type V2NodeState = "more" | "open" | "floor" | "stub" | "streaming";
export type V2NodeSource = "toc" | "ai" | "local" | "v1ext";

export interface V2Node {
  /** 路径式 id（X6）：outline＝作用域 id + 层级号（t3.2.1），expand＝目标 id + 相对层级号 */
  id: string;
  /** 顶层节点为 null */
  parentId: string | null;
  /** ord = 起始块号*1000 + 序（S1 原文顺序）；同组按 (ord, id) 升序 */
  ord: number;
  title: string;
  /** §8.1 中文类型；兼容未来扩展用 string */
  type: NodeType | string;
  /** `〈时间〉` 元信息；无则 null */
  timeText: string | null;
  /** 父行 `{版式}` 提示（英文键）；无则 null */
  patternHint: PatternKey | null;
  blockStart: number | null;
  blockEnd: number | null;
  spans: [number, number][] | null;
  state: V2NodeState;
  source: V2NodeSource;
  warnings: string[] | null;
  /** explain 全文（缓存命中时随 graphLoad 下发）；流式增量走 GraphState.explain */
  explain?: string | null;
  jobId: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export type V2EdgeOrigin = "text" | string;

export interface V2Edge {
  /** 关系承载节点（「本节点」） */
  from: string;
  /** 关系目标 */
  to: string;
  code: RelCode;
  origin?: V2EdgeOrigin;
  jobId?: string | null;
  createdAt?: number;
}

/** material_maps.view_json */
export interface V2View {
  /** 用户手动「排列方式」：nodeId → 版式 */
  patterns: Record<string, PatternKey>;
  /** 折叠的节点 id */
  collapsed: string[];
}

/** structure_json 元信息（§3.1 末段）+ graphLoad 附带的定位字段 */
export interface V2Meta {
  schemaVersion?: 2;
  mapId?: string;
  documentId?: string;
  title: string;
  blocksVersion?: number;
  outlineVersion?: number;
  promptVersions?: { outline?: number | string; expand?: number | string; explain?: number | string };
  model?: string;
}

/** `mindmap:graphLoad` 返回 */
export interface GraphLoad {
  meta: V2Meta;
  nodes: V2Node[];
  edges: V2Edge[];
  view: V2View | null;
  textReady?: boolean;
}

export interface RunMetrics {
  model: string;
  startedAt: number;
  ttfnMs: number | null;
  firstTtftMs: number | null;
  frameworkMs: number | null;
  calls: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  reasoningChars: number;
  lines: number;
  linesDropped: number;
  byReason: Record<string, number>;
  relsDropped: number;
  concurrencyNow: number;
  rateLimitDowngrades: number;
}

export interface JobDone {
  ok: boolean;
  error?: string;
  finishReason?: string;
}

/** 推送 `mindmap:delta`（§4.2），≤100ms 一批 */
export interface Delta {
  documentId?: string;
  mapId: string;
  jobId?: string | null;
  kind: string;
  nodes?: V2Node[];
  states?: { id: string; state: V2NodeState }[];
  edges?: V2Edge[];
  explainDelta?: { nodeId: string; text: string };
  jobDone?: JobDone;
  metrics?: RunMetrics;
}

/** 渲染层合入后的图状态（graph.ts 维护；不可变，结构共享）。 */
export interface GraphState {
  mapId: string | null;
  meta: V2Meta | null;
  nodes: Readonly<Record<string, V2Node>>;
  /** parentId（顶层用 ROOT_ID）→ 子 id，按 (ord, id) 升序；含父节点尚未到达的孤儿组 */
  children: Readonly<Record<string, readonly string[]>>;
  /** from → 出边，按 (to, code) 升序（与到达顺序无关，保证确定性） */
  outEdges: Readonly<Record<string, readonly V2Edge[]>>;
  /** to → 入边，按 (from, code) 升序 */
  inEdges: Readonly<Record<string, readonly V2Edge[]>>;
  edgeCount: number;
  view: V2View;
  /** view.collapsed 的集合形态（与 view 同步替换） */
  collapsed: ReadonlySet<string>;
  /** explain 流式文本：nodeId → 已到全文 */
  explain: Readonly<Record<string, string>>;
  jobs: Readonly<Record<string, JobDone>>;
  metrics: RunMetrics | null;
  /**
   * 子树修订号：节点自身、其后代、其子之间的关系任一变化时，该节点及全部祖先（直至 ROOT_ID）
   * 被打上新的 clock。布局缓存据此判断「脏祖先链」（S2）。
   */
  rev: Readonly<Record<string, number>>;
  clock: number;
}

/** 合成根（材料标题卡）的 id；不会与路径式 id 冲突 */
export const ROOT_ID = "@root";
