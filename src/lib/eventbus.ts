// EventBus — 唯一事实通道
// 锁定事件名（v6）：stats/updated, library/changed, todo/changed, pomodoro/tick,
// pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed,
// cards/changed, ai/batchDone, leech/detected
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
  "leech/detected"
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
