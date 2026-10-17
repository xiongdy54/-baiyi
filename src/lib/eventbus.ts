// EventBus — 唯一事实通道
// 锁定事件名（v6）：stats/updated, library/changed, todo/changed, pomodoro/tick,
// pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed,
// cards/changed, ai/batchDone, leech/detected
// v36（M8-A）：+ journal/changed（主进程日记写入推送 → 日记页刷新）
// v40（M8-B）：+ insight/changed（主进程洞察运行/反馈变化推送 → 洞察面板刷新）
// v45（M14-UM1）：+ memory/changed（主进程记忆整理/补处理进度推送 → 设置页记忆区刷新）
// v48（M15 重做，D41/D42）：+ mindmap/changed（导图生成进度与完成广播）
// D192（材料导图 v2）：+ mindmap/delta（主进程 mindmap:delta 增量批次推送 → 导图页签合入）
// v48.80（D124 §11.3）：+ learner/navigate（「下一步」面板 emit、App 订阅分派动作）
//                      + learner/changed（任一 learner 对话框完成写入后 emit、面板重取推荐）
// v49.0（D174 皮肤 API）：+ ui/*（纯表现层动效事件——皮肤经 ctx.onUiEvent 订阅；见 src/skins/runtime/uiEvents.ts）
// （D132 插件变更推送不走本表：实现为 window.pluginsAPI.onChanged 直连 ipcRenderer
//   "plugins:changed"，不经 EventBus——曾登记的 plugins/changed 为死条目，已删除。）
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
  "memory/changed",
  "mindmap/changed", // v48（M15 重做，D41/D42）：导图生成进度与完成广播
  "mindmap/delta", // D192：材料导图 v2 增量批次（≤100ms 一批）
  "learner/navigate", // v48.80（D124）：面板动作 → App 导航（open-book / jump / review / extract-session）
  "learner/changed", // v48.80（D124）：对话框完成写入 → NextStepsPanel 重新请求推荐
  "ui/view-change", // v49.0（D174）：主视图切换（App.changeView）
  "ui/overlay-open", // v49.0（D174）：模态打开（useDialogA11y）
  "ui/overlay-close", // v49.0（D174）：模态关闭
  "ui/review-flip", // v49.0（D174）：复习卡片翻面
  "ui/review-grade", // v49.0（D174）：复习评分提交后
  "ui/session-complete", // v49.0（D174）：复习会话完成
  "ui/card-created" // v49.0（D174）：制卡成功
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
