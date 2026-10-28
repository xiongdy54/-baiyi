// BDI（D248 / T6）：eventBus → 行为事件桥（单例，StrictMode 安全：install 幂等 + 返回解绑）。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7（F17 既有事件）。
import { eventBus } from "../eventbus";
import { track } from "./track";

let installed = false;
let offs: Array<() => void> = [];

/** 订阅既有 eventBus 事件并投影为 BDI 事件；重复调用返回同一解绑函数。 */
export function installBdiBridges(): () => void {
  if (installed) return uninstallBdiBridges;
  installed = true;
  const overlayOpenedAt = new Map<string, number>();

  offs.push(eventBus.on("ui/view-change", (payload) => {
    const p = (payload || {}) as { from?: string; to?: string };
    track("nav.view", { props: { from: p.from ?? null, to: p.to ?? null } });
  }));
  offs.push(eventBus.on("ui/overlay-open", (payload) => {
    const p = (payload || {}) as { kind?: string };
    const id = p.kind || "dialog";
    overlayOpenedAt.set(id, Date.now());
    track("nav.overlay", { props: { overlayId: id, action: "open" } });
  }));
  offs.push(eventBus.on("ui/overlay-close", (payload) => {
    const p = (payload || {}) as { kind?: string };
    const id = p.kind || "dialog";
    const at = overlayOpenedAt.get(id);
    overlayOpenedAt.delete(id);
    track("nav.overlay", { props: { overlayId: id, action: "close", durMs: at ? Date.now() - at : null } });
  }));
  offs.push(eventBus.on("leech/detected", (payload) => {
    track("review.leech", { cardId: typeof payload === "string" ? payload : undefined });
  }));
  offs.push(eventBus.on("learner/navigate", (payload) => {
    const p = (payload || {}) as { type?: string };
    track("learner.panel_action", { origin: "recommend", props: { action: p.type ?? null } });
  }));
  return uninstallBdiBridges;
}

export function uninstallBdiBridges(): void {
  while (offs.length) {
    try { offs.pop()!(); } catch { /* 已解绑 */ }
  }
  installed = false;
}
