// 全局后台任务状态（v48.13，M15 批 P2）——右下角指示器的唯一数据源。
//
// 设计要点（§4.19-12）：
// ① 导图生成/深化由**主进程**持有（mindmapEngine），渲染层任何界面都只是查看者；
//    因此进度必须经全局事件总线汇聚，而不是某个组件自己的 useState。
// ② 本模块只做「把广播归并成任务状态」这一件事：零副作用、零 IO、可在测试里直接驱动。
// ③ 终态停留直到用户处置（打开/关闭），避免「生成完成」一闪而过看不见。

import { eventBus } from "./eventbus";

export type ActivityPhase =
  | "running"
  | "section_ready"
  | "completed"
  | "partial"
  | "review_failed"
  | "failed"
  | "cancelled"
  /** v48.13 P3：应用关闭打断（**不是失败**）——可继续生成，缓存保留 */
  | "interrupted";

export interface ActivityTask {
  runId: string;
  documentId: string | null;
  title: string | null;
  phase: ActivityPhase;
  /** 引擎阶段标签（waiting_model 时为当前调用名，如「深挖·本原问题」） */
  label: string | null;
  done: number;
  total: number;
  calls: number;
  budget: number;
  mapId: string | null;
  /** v48.13 发布模型：false = 本次产物只是候选，当前显示的是旧版 */
  published: boolean;
  issues: number | null;
  code: string | null;
  updatedAt: number;
}

export interface MindmapProgressPayload {
  runId?: string;
  documentId?: string | null;
  title?: string | null;
  stage?: string;
  label?: string;
  done?: number;
  total?: number;
  calls?: number;
  budget?: number;
  mapId?: string | null;
  published?: boolean;
  issues?: number;
  code?: string;
}

const TERMINAL: ActivityPhase[] = ["completed", "partial", "review_failed", "failed", "cancelled"];

/**
 * 引擎内部阶段 → 用户可见阶段。
 *
 * **这是一个真实踩过的坑**：引擎除终态外还会广播若干**子事件**（`expand` 每完成一个深挖作业发一次、
 * `coverage_audit`、`retry`、`waiting_model`…）。P2 首版把它们直接当成「阶段」存了下来，
 * 于是 `describeTask` 的 `default` 分支把运行中的任务显示成 **「已取消」**——用户在一次正常运行里
 * 看到了两次「已取消」，正是这些子事件到达的时刻。
 */
const STAGE_ALIAS: Record<string, ActivityPhase> = {
  waiting_model: "running",
  expand: "running",
  gapfill: "running",
  coverage_audit: "running",
  retry: "running",
  analyze: "running",
  deepen: "running",
  validate: "running",
  editorial: "running",
  editorial_skipped: "running",
  review: "running"
};
const KNOWN_PHASES: string[] = [
  "running",
  "section_ready",
  "completed",
  "partial",
  "review_failed",
  "failed",
  "cancelled",
  "interrupted"
];

function normalizeStage(raw: string, prev: ActivityTask | undefined): ActivityPhase {
  if (STAGE_ALIAS[raw]) return STAGE_ALIAS[raw];
  if (KNOWN_PHASES.includes(raw)) return raw as ActivityPhase;
  // 未知事件**绝不编造状态**：沿用上一次；连上一次都没有就按「运行中」处理
  return prev ? prev.phase : "running";
}
/** 「待用户处置」而非「跑完」：可继续生成/深化，指示器要长期保留入口 */
const RESUMABLE: ActivityPhase[] = ["interrupted", "section_ready"];

const tasks = new Map<string, ActivityTask>();
const listeners = new Set<() => void>();

function emitChange() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* 单个订阅者异常不影响其他订阅者 */
    }
  }
}

/** 广播 → 任务状态归并。导出以便测试直接驱动（不需要 React）。 */
export function applyProgress(p: MindmapProgressPayload): ActivityTask | null {
  const runId = String(p.runId || "");
  if (!runId) return null;
  const prev = tasks.get(runId);
  const stage = normalizeStage(String(p.stage || ""), prev);
  const next: ActivityTask = {
    runId,
    documentId: p.documentId ?? prev?.documentId ?? null,
    title: p.title ?? prev?.title ?? null,
    phase: stage,
    // waiting_model 带 label；running 不带 → 保留上一次的 label（「当前处理什么」不要闪断）
    label: String(p.label || prev?.label || "") || null,
    done: Number.isFinite(p.done as number) ? Number(p.done) : prev?.done ?? 0,
    total: Number.isFinite(p.total as number) ? Number(p.total) : prev?.total ?? 0,
    calls: Number.isFinite(p.calls as number) ? Number(p.calls) : prev?.calls ?? 0,
    budget: Number.isFinite(p.budget as number) ? Number(p.budget) : prev?.budget ?? 0,
    mapId: p.mapId ?? prev?.mapId ?? null,
    published: typeof p.published === "boolean" ? p.published : prev?.published ?? false,
    issues: Number.isFinite(p.issues as number) ? Number(p.issues) : prev?.issues ?? null,
    code: p.code ?? prev?.code ?? null,
    updatedAt: Date.now()
  };
  // completed/partial/review_failed 的 done/total 收尾（避免停在 97% 这种不诚实读数）
  if (TERMINAL.includes(next.phase) && next.total > 0) next.done = next.total;
  tasks.set(runId, next);
  emitChange();
  return next;
}

export function dismissTask(runId: string) {
  if (tasks.delete(runId)) emitChange();
}

export function dismissAllFinished() {
  let changed = false;
  for (const [id, t] of tasks) {
    if (TERMINAL.includes(t.phase)) {
      tasks.delete(id);
      changed = true;
    }
  }
  if (changed) emitChange();
}

export function listTasks(): ActivityTask[] {
  return [...tasks.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

/** 当前应展示的任务：优先未收敛的运行，否则最近一条终态。 */
export function primaryTask(): ActivityTask | null {
  const all = listTasks();
  if (!all.length) return null;
  const active = all.filter((t) => !TERMINAL.includes(t.phase));
  const pool = active.length ? active : all;
  return pool[pool.length - 1];
}

/**
 * v48.13 P3（D47）：应用启动时用「可续跑运行」播种指示器。
 * 这些 run 在内存里没有对应任务（应用重启过），但用户需要看到「上次那轮可以继续」。
 */
export function seedFromRuns(runs: { id: string; documentId: string; status: string; materialTitle?: string | null; callsDone?: number | null; updatedAt?: number }[]) {
  let changed = false;
  for (const r of runs || []) {
    if (tasks.has(r.id)) continue;
    // 只接受「可继续」的两种状态；其余（completed/failed/...）一律不播种——
    // 宁可少提示，也不能把已完成的图显示成「被中断可继续」。
    if (r.status !== "interrupted" && r.status !== "section_ready") continue;
    const phase: ActivityPhase = r.status === "section_ready" ? "section_ready" : "interrupted";
    tasks.set(r.id, {
      runId: r.id,
      documentId: r.documentId || null,
      title: r.materialTitle || null,
      phase,
      label: null,
      done: Number(r.callsDone) || 0,
      total: 0,
      calls: Number(r.callsDone) || 0,
      budget: 0,
      mapId: null,
      published: phase === "section_ready",
      issues: null,
      code: r.status === "section_ready" ? null : "interrupted",
      updatedAt: Number(r.updatedAt) || Date.now()
    });
    changed = true;
  }
  if (changed) emitChange();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 测试/退出用：清空全部状态 */
export function resetActivity() {
  tasks.clear();
  emitChange();
}

let installed = false;
/** App 级安装（与 installMindmapBridge 同处）：把导图广播接进本 store。 */
export function installActivityStore(): () => void {
  if (installed) return () => {};
  installed = true;
  const off = eventBus.on("mindmap/changed", (payload: unknown) => {
    applyProgress((payload || {}) as MindmapProgressPayload);
  });
  return () => {
    installed = false;
    off();
  };
}

// ---------- 展示口径（纯函数，供组件与测试共用） ----------

export type IndicatorTone = "busy" | "done" | "partial" | "warn" | "error";

export interface IndicatorView {
  /** 收起态一行文案 */
  short: string;
  /** 展开态标题 */
  heading: string;
  /** 展开态详情行（可为空） */
  detail: string;
  tone: IndicatorTone;
  /** 百分比（0-100），未知为 null */
  percent: number | null;
  /** 是否可打开导图 */
  canOpen: boolean;
}

export function describeTask(t: ActivityTask | null): IndicatorView | null {
  if (!t) return null;
  const pct = t.total > 0 ? Math.max(0, Math.min(100, Math.round((t.done / t.total) * 100))) : null;
  const callsLine = t.budget > 0 ? `${t.calls} / ${t.budget} 次调用` : t.calls > 0 ? `${t.calls} 次调用` : "";
  const title = t.title || "材料知识导图";

  switch (t.phase) {
    case "running":
      return {
        short: pct === null ? "导图生成中" : `导图生成中 · ${pct}%`,
        heading: title,
        detail: [t.label ? `正在处理：${t.label}` : "正在分析材料结构", pct === null ? "" : `${t.done} / ${t.total}`, callsLine]
          .filter(Boolean)
          .join(" · "),
        tone: "busy",
        percent: pct,
        canOpen: Boolean(t.mapId)
      };
    case "section_ready":
      // 首层就绪即已可用；深挖是「可继续」而不是「未完成」——不得显示成失败
      return {
        short: t.published ? "导图已可用 · 可继续深化" : "已生成候选版本",
        heading: title,
        detail: t.published
          ? "首层结构已就绪，可打开查看；更深的分支按需继续生成。"
          : "新版首层已生成并保存为候选版本（已发布的旧版本不受影响）；打开即可查看这一版。",
        tone: t.published ? "done" : "partial",
        percent: 100,
        canOpen: true
      };
    case "completed":
      // 「已更新」而非「生成完成」：深化随时会让它继续长大
      return { short: "导图已更新", heading: title, detail: callsLine ? `共 ${callsLine}` : "", tone: "done", percent: 100, canOpen: true };
    case "partial":
      return {
        short: "导图已部分更新",
        heading: title,
        detail: "部分阶段未完成，旧版本仍然可用。" + (callsLine ? ` · ${callsLine}` : ""),
        tone: "partial",
        percent: pct,
        canOpen: Boolean(t.mapId)
      };
    case "review_failed":
      return {
        short: "导图待确认",
        heading: title,
        detail: `语义评审提出 ${t.issues ?? 0} 处问题，已生成的结构在确认修复前不发布；旧版本仍然可用。`,
        tone: "warn",
        percent: null,
        canOpen: false
      };
    case "failed":
      return {
        short: "导图生成失败",
        heading: title,
        detail: `${t.code ? failureReason(t.code) : "生成中断"}（旧版本仍然可用）`,
        tone: "error",
        percent: null,
        canOpen: false
      };
    case "interrupted":
      return {
        short: "导图生成被中断 · 可继续",
        heading: title,
        detail: "应用关闭时这一轮没跑完（不是失败）。已完成的阶段保留在缓存，继续生成零重复计费。",
        tone: "partial",
        percent: pct,
        canOpen: true
      };
    case "cancelled":
      return { short: "已取消", heading: title, detail: "已完成的阶段保留在缓存，重新生成会自动续跑。", tone: "warn", percent: null, canOpen: false };
    default:
      // 阶段已由 normalizeStage 收敛；这里再兜一层：**宁可什么都不显示，也不编造状态**
      return null;
  }
}

function failureReason(code: string): string {
  const map: Record<string, string> = {
    timeout: "调用超时",
    network: "网络中断",
    rate_limit: "触发限流",
    validation: "本地结构校验未通过",
    prepare: "材料准备失败",
    json: "模型输出无法解析",
    cancelled: "已取消"
  };
  return map[code] || "生成中断";
}
