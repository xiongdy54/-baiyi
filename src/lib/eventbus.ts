// EventBus — 唯一事实通道
// 锁定事件名（v6）：stats/updated, library/changed, todo/changed, pomodoro/tick,
// pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed,
// cards/changed, ai/batchDone, leech/detected
// v36（M8-A）：+ journal/changed（主进程日记写入推送 → 日记页刷新）
// v40（M8-B）：+ insight/changed（主进程洞察运行/反馈变化推送 → 洞察面板刷新）
// v45（M14-UM1）：+ memory/changed（主进程记忆整理/补处理进度推送 → 设置页记忆区刷新）
export const ALLOWED_EVENTS = [
  "stats/updated",
  "library/changed",
  "todo/changed",
  "pomodoro/tick",
  "pomodoro/phaseChange",
  "theme/changed",
  "settings/changed",
  "ai/stream",
  "workflow/changed",
  "cards/changed",
  "ai/batchDone",
  "leech/detected",
  "journal/changed",
  "insight/changed",
  "memory/changed"
] as const;

export type AppEvent = (typeof ALLOWED_EVENTS)[number];

type Handler = (payload?: unknown) => void;

const map = new Map<AppEvent, Set<Handler>>();

export const eventBus = {
  on(event: AppEvent, fn: Handler): () => void {
    if (!ALLOWED_EVENTS.includes(event)) throw new Error(`unknown event: ${event}`);
    let set = map.get(event);
    if (!set) {
      set = new Set();
      map.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  },
  emit(event: AppEvent, payload?: unknown): void {
    if (!ALLOWED_EVENTS.includes(event)) throw new Error(`unknown event: ${event}`);
    map.get(event)?.forEach((fn) => fn(payload));
  }
};
