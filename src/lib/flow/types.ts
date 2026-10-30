// 结构流 v3.1（STRUCTURE-FLOW-PLAN §5.2 + §12.2 / §12.3.2 / §12.4）：场景与版式数据类型。
// 纯类型文件（只含类型与封闭联合），运行时代码在 layout.ts / presence.ts。

export type FlowMode = "off" | "inside" | "shift" | "reserve" | "compact" | "whisper";
export type FlowPattern = "tree" | "grid" | "argument" | "timeline" | "chain" | "layered" | "compare";
/** steady＝静息；conveyor/zoom 见 §12.4.5 */
export type FlowMotion =
  | "open"
  | "close"
  | "steady"
  | "turn"
  | "track"
  | "regroup-down"
  | "regroup-up"
  | "split"
  | "merge"
  | "conveyor-down"
  | "conveyor-up"
  | "zoom-in"
  | "zoom-out";

export interface FlowEnv {
  on: boolean;
  /** `.reader-engine-viewport`（含已预留的槽位） */
  viewport: { left: number; top: number; right: number; bottom: number };
  /** 未平移、未预留时的文本版心 */
  textLeft: number;
  textRight: number;
}

export interface FlowPlan {
  mode: FlowMode;
  shift: number;
  reserve: number;
  barX: number;
  labelX: number;
  labelW: number;
  right: number;
}

export interface FlowColors {
  dark: boolean;
  bg: string;
  fg: string;
  accent: string;
  accentOn: string;
  hairline: string;
  counter: string;
  /** 8 个实色 */
  palette: string[];
  /** 高亮矩形不透明度（档位 base / focus / hover） */
  aHL: [number, number, number];
  /** 流带落点不透明度（档位 base / focus / hover） */
  aEnd: [number, number, number];
  aDim: number;
  strandA: number;
}

/** HTML 标签项 */
export interface FlowItem {
  id: string;
  nodeId: string | null;
  kind: "head" | "node" | "more" | "kid";
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  fs: number;
  lh: number;
  weight: number;
  /** 前景不透明度 % */
  tone: number;
  chip: { text: string; style: "solid" | "outline" | "counter" } | null;
  /** 行尾淡色信息（类型名 / +N / 关系计数） */
  meta: string;
  /** 时间线：标题上方的时间 */
  time: string | null;
  /** 链：步骤号（圆内数字由 prim 画，这里只给读屏） */
  num: number | null;
  reading: boolean;
  selected: boolean;
  hasKids: boolean;
  expanded: boolean;
  moreKind?: "above" | "below" | "kids";
  moreCount?: number;
  /** v3.1 泳道（0..3），渲染器写 data-lane */
  lane?: number;
  /** v3.1 邻组预览项（渲染器缩小 + 降色调） */
  peek?: boolean;
}

/** 流带落点（朝左的竖线段） */
export interface FlowPort {
  nodeId: string;
  x: number;
  y0: number;
  y1: number;
  color: string;
}

/** 上层 SVG 图元（全部由版式布局产出，渲染器只管画）；off＝该图元整体的竖向偏移（邻组预览拼接用） */
export type FlowPrim = (
  | {
      k: "path";
      id: string;
      d: string;
      stroke: string;
      strokeW: number;
      dash?: string;
      opacity?: number;
      grad?: { from: string; to: string; x1: number; y1: number; x2: number; y2: number };
      draw?: boolean;
      endMark?: "arrow" | "bar" | "open" | "dot";
      startMark?: "dot";
      layer: "under" | "over";
    }
  | { k: "rect"; id: string; x: number; y: number; w: number; h: number; rx?: number; fill: string; opacity?: number; hatch?: boolean; layer: "under" | "over" }
  | { k: "circle"; id: string; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeW?: number; opacity?: number; layer: "under" | "over" }
  | { k: "text"; id: string; x: number; y: number; text: string; fs: number; fill: string; weight?: number; anchor?: "start" | "middle" | "end"; opacity?: number; layer: "under" | "over" }
) & { off?: number };

/** 高亮流带：左段＝文字高亮矩形，右段＝Sankey 流带，同一个路径 */
export interface FlowShape {
  id: string;
  nodeId: string;
  color: string;
  L: number;
  xs: number;
  s0: number;
  s1: number;
  x1: number;
  t0: number;
  t1: number;
  tone: 0 | 1 | 2;
  stub: "" | "above" | "below";
  ribbon: boolean;
  order: number;
}

export interface FlowStrand {
  id: string;
  from: string;
  to: string;
  code: string;
  xa: number;
  ya: number;
  xb: number;
  yb: number;
  bulge: number;
  colorA: string;
  colorB: string;
  strong: boolean;
  reverse: boolean;
  order: number;
}

export interface PatternLayout {
  items: FlowItem[];
  ports: FlowPort[];
  prims: FlowPrim[];
  /** 已被版式本身表达的关系（"from>to>code"），不再画关系线 */
  expressed: string[];
  /** 要高亮 / 出流带的节点 */
  leafIds: string[];
  /** 局部坐标总高（自 0 起） */
  height: number;
  /** 阅读节点中心的局部 y（对齐用） */
  readingY: number | null;
  noStrands?: boolean;
  /** 对照版式：动作行固定排在表底（宿主/渲染器按此定位） */
  inlineAt?: { x: number; y: number; w: number };
  /** 预览节点离视口方向的提示（buildShapes 的 stub 用；宿主写入） */
  sideOf?: Record<string, "above" | "below" | "here">;
}

export interface FlowScene {
  seq: number;
  mode: FlowMode;
  motion: FlowMotion;
  tracking: boolean;
  /** §8.8：正文平移中——高亮先隐去，落定后从节点伸回 */
  shifting: boolean;
  plan: FlowPlan;
  viewport: FlowEnv["viewport"];
  colors: FlowColors;
  pattern: FlowPattern;
  patternName: string;
  /** 局部 → client 的竖向偏移 */
  dy: number;
  layout: PatternLayout;
  shapes: FlowShape[];
  strands: FlowStrand[];
  inline: { forId: string | null; explainOpen: boolean; explainText: string; explainBusy: boolean; status: string };
  hoverId: string | null;
  focusId: string | null;
  canBack: boolean;
  panel: { kind: "ok" | "empty" | "feeding" | "nokey" | "busy"; feedDone: number; feedTotal: number };
  /** 开场 / 翻页进场：首帧先画折叠态，下一帧交由 CSS 过渡展开（§8.1 / §8.3） */
  armed: boolean;
  /** §13.3：滚动模式平滑彩带（矩形画在正文 iframe 里，混合层只画颈部） */
  smooth?: boolean;
}
