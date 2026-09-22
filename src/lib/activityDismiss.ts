// 「这条提示我已经处置过了」的持久化（v48.17，D53）——右下角指示器的关闭必须跨启动生效。
//
// 为什么单开一个模块：activity.ts 的文件头写明它「零副作用、零 IO、可在测试里直接驱动」，
// 把 settingsStore 写盘塞进那个纯归并模块会毁掉这条约定。这里只做一件事：维护一份已关闭
// runId 的清单，并落在 settings.json → activity.dismissedRuns。
//
// 口径（对齐 activity.ts 顶部注释③「终态停留直到用户处置」）：
//   ① 用户点「关闭」或「打开导图」= 已处置 → 记进清单；下次启动播种时跳过，不再出现。
//   ② 没点过的，下次启动仍要提醒（可续跑的运行本来就是待办）。
//   ③ 只过滤**播种**，不过滤实时广播：已关掉的 run 如果继续生成（同 runId 的新广播），
//      说明有新的信息要给用户看，指示器该回来——那时它不再受这份清单约束。

import { settingsStore } from "./settings";

const SCOPE = "activity";
const KEY = "dismissedRuns";
/** 只防无界增长，不保证严格 LRU：超限时从最旧的一端丢，被丢的那条最坏是再提示一次。 */
const CAP = 200;

const ids: string[] = [];
const index = new Set<string>();
let loaded = false;
let dirty = false;

function add(runId: string) {
  if (!runId || index.has(runId)) return;
  index.add(runId);
  ids.push(runId);
  if (ids.length > CAP) {
    for (const dropped of ids.splice(0, ids.length - CAP)) index.delete(dropped);
  }
  dirty = true;
}

function flush() {
  dirty = false;
  void settingsStore.set(SCOPE, KEY, [...ids]).catch(() => {
    /* 写盘失败只影响「下次还提示」，不该打断界面 */
  });
}

/** 读盘（幂等）。播种前必须先于 filterDismissed 完成。 */
export async function ensureDismissalsLoaded(): Promise<void> {
  if (loaded) return;
  const stored = await settingsStore.get<string[]>(SCOPE, KEY, []);
  loaded = true;
  if (Array.isArray(stored)) for (const id of stored.map(String).filter(Boolean)) add(id);
  if (dirty) flush();
}

export function isDismissed(runId: string): boolean {
  return index.has(runId);
}

/** 用户处置掉一条提示（「关闭」/「打开导图」）。内存立即生效，落盘异步。 */
export function rememberDismissed(runId: string): void {
  add(runId);
  // 读盘还没完成就先点关闭：此刻写会把磁盘上还没读进来的历史覆盖掉，留给 ensureDismissalsLoaded 收尾再写
  if (loaded && dirty) flush();
}

/** 测试用：清空内存态（不动磁盘）。 */
export function resetDismissalsForTests(): void {
  ids.length = 0;
  index.clear();
  loaded = false;
  dirty = false;
}
