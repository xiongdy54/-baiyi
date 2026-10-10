// 制卡台布局与全局信号（v48.79 / D123）
// 职责：① 放置位置（右侧/底部）设置读写与订阅；② 制卡台开合时把「推让」写到 <html> 数据属性
// （CSS 据此给 .app-main 让出宽/高）并在非最大化时请主进程把窗口向右外延；③ 顶栏按钮 ↔ 宿主面板的
// 轻量 DOM 事件桥（不动 eventBus 的锁定事件表）。
import { useEffect, useState } from "react";
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";

export type WorkbenchPlacement = "right" | "bottom";
/** 独立窗口里的制卡台：不占布局、不推让、不外延窗口 */
export type WorkbenchDockPlacement = WorkbenchPlacement | "window";

/** 右侧制卡台宽度（与 theme.css 的 --wb-w 同值） */
export const WB_WIDTH = 400;

export function normalizePlacement(v: unknown): WorkbenchPlacement {
  return v === "bottom" ? "bottom" : "right";
}

/** 订阅 app.workbenchPlacement（设置页改动后即时生效） */
let cachedPlacement: WorkbenchPlacement = "right";
export function useWorkbenchPlacement(): WorkbenchPlacement {
  // 修订 7：初值取上次读到的设置（宿主随页面切换重挂载时不再「先 right 后 bottom」抖一次，避免布局登记反复）
  const [placement, setPlacement] = useState<WorkbenchPlacement>(cachedPlacement);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void settingsStore.get<string>("app", "workbenchPlacement", "right").then((v) => {
        const p = normalizePlacement(v);
        cachedPlacement = p;
        if (!cancelled) setPlacement(p);
      });
    };
    load();
    const off = eventBus.on("settings/changed", (p) => {
      const e = p as { scope?: string; key?: string } | undefined;
      if (e?.scope === "app" && e?.key === "workbenchPlacement") load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return placement;
}

// ---------- 顶栏按钮 ↔ 宿主面板（DOM 事件桥） ----------
export const WB_TOGGLE_EVENT = "wb:toggle";
export const WB_STATE_EVENT = "wb:state";

export interface WorkbenchState {
  /** 制卡台当前展开 */
  open: boolean;
  /** AI 正在生成（静态点提示，不闪烁） */
  busy: boolean;
  /** 手动草稿在场（预留，当前恒由宿主按需填） */
  draft: boolean;
}

// 跨页面保持「制卡台是开着的」：宿主随视图切换卸载/重挂（阅读器 ↔ 摘录页 ↔ 自由宿主），
// 新宿主挂载时按此标记自动展开（面板内草稿属各宿主自己的状态，不跨页携带）。
let lastOpen = false;
export function getLastWorkbenchOpen(): boolean {
  return lastOpen;
}
export function setLastWorkbenchOpen(v: boolean): void {
  lastOpen = v;
}

export function requestWorkbenchToggle(): void {
  window.dispatchEvent(new CustomEvent(WB_TOGGLE_EVENT));
}

export function publishWorkbenchState(s: WorkbenchState): void {
  window.dispatchEvent(new CustomEvent<WorkbenchState>(WB_STATE_EVENT, { detail: s }));
}

// ---------- 推让与窗口外延 ----------
// 多个宿主（阅读器 / 摘录页 / 自由宿主）不会同时存在，但视图切换的交叠帧里新旧宿主的 effect
// 清理与挂载次序不可靠——所以由本模块串行仲裁：登记表里「最后登记且展开」的宿主说了算。
//
// 开合动画（修订 6，用户：侧栏与正文必须同步，不许先收起留白再还原）：
//  · 内推（最大化/余量不足）：data-wb-open 的增删与制卡台滑动在**同一帧**触发（onCommit 内 flushSync），
//    `.app-main` 的 margin-right 与制卡台 transform 用同一时长/缓动 → 正文随侧栏同步收窄/还原。
//  · 外延（窗口向右变宽）：正文宽度本就不该变——开合前把 .app-main 钉死为当前像素宽（data-wb-pin），
//    窗口变宽/还原期间正文纹丝不动，只有制卡台滑入/滑出；动画结束后再解钉。
const owners = new Map<symbol, { placement: WorkbenchPlacement }>();
let extended = false;
let chain: Promise<void> = Promise.resolve();
let bridgeInstalled = false;
const ANIM_MS = 260; // ≥ --dur-panel(240ms)

function root(): HTMLElement {
  return document.documentElement;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function pinMain(on: boolean): void {
  const el = root();
  if (!on) {
    delete el.dataset.wbPin;
    el.style.removeProperty("--wb-main-w");
    return;
  }
  const main = document.querySelector<HTMLElement>(".app-main");
  const w = main ? main.getBoundingClientRect().width : 0;
  if (w > 0) {
    el.style.setProperty("--wb-main-w", `${w}px`);
    el.dataset.wbPin = "1";
  }
}

/** 已落地的布局（null＝未展开）。宿主随页面切换卸载/重挂时，新旧登记在同一轮内先后发生——
    以「已落地 vs 期望」做差，相同则只补一次 onCommit，绝不「先收起再展开」。 */
let applied: WorkbenchPlacement | null = null;
export function isDockLayoutApplied(): boolean {
  return applied !== null;
}
let closeTimer: number | null = null;
let pendingCommit: (() => void) | undefined;

async function applyDesired(): Promise<void> {
  const onCommit = pendingCommit;
  pendingCommit = undefined;
  const active = [...owners.values()].pop();
  const el = root();
  if ((active ? active.placement : null) === applied) {
    onCommit?.(); // 无变化：只同步宿主的 shown 状态（重挂载的新 CardDock 初值已是 shown，此处为空操作）
    return;
  }
  if (!active) {
    // 收起
    if (extended) {
      // 外延：正文钉死 → 制卡台滑出 → 动画结束后窗口还原 → 同帧去掉让位与钉死
      pinMain(true);
      onCommit?.();
      await sleep(ANIM_MS);
      extended = false;
      await window.windowAPI?.dockRestore?.();
      delete el.dataset.wbOpen;
      delete el.dataset.wbPlace;
      delete el.dataset.wbMode;
      pinMain(false);
      applied = null;
      return;
    }
    // 内推：margin 回落与制卡台滑出同帧同步
    el.dataset.wbAnim = "1";
    delete el.dataset.wbOpen;
    onCommit?.();
    await sleep(ANIM_MS);
    delete el.dataset.wbPlace;
    delete el.dataset.wbMode;
    delete el.dataset.wbAnim;
    applied = null;
    return;
  }
  // 展开
  if (active.placement === "right") {
    if (!extended) {
      pinMain(true); // 窗口变宽的瞬间正文不得被拉宽
      const r = await window.windowAPI?.dockExtend?.(WB_WIDTH);
      extended = r?.mode === "extended";
      if (!extended) pinMain(false);
    }
  } else if (extended) {
    extended = false;
    await window.windowAPI?.dockRestore?.();
    pinMain(false);
  }
  const ext = active.placement === "right" && extended;
  el.dataset.wbPlace = active.placement;
  el.dataset.wbMode = ext ? "extended" : "inner";
  if (!ext) el.dataset.wbAnim = "1";
  el.dataset.wbOpen = "1";
  applied = active.placement;
  onCommit?.();
  await sleep(ANIM_MS);
  delete el.dataset.wbAnim;
  if (ext) pinMain(false); // margin-right 已让位，解钉后宽度与钉死值一致
}

function installBridge(): void {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  // 主窗口被最大化时主进程清掉外延记录并告知：此后按内推处理
  window.windowAPI?.onDockMode?.((mode) => {
    if (mode === "inner") {
      extended = false;
      if (root().dataset.wbOpen) root().dataset.wbMode = "inner";
    }
  });
}

/** 宿主登记/注销自己的制卡台展开态（open=false 即注销）。
    展开立即落地；收起经 setTimeout 落地（普通开合 0ms；宿主卸载＝页面切换时给 closeDelayMs 宽限，等新宿主登记，期间若又有登记则取消收起）。 */
export function setDockLayout(owner: symbol, open: boolean, placement: WorkbenchPlacement, onCommit?: () => void, closeDelayMs = 0): Promise<void> {
  installBridge();
  if (open) {
    owners.delete(owner); // 重新登记＝成为「最后登记者」
    owners.set(owner, { placement });
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
    pendingCommit = onCommit;
    chain = chain.then(applyDesired).catch(() => {});
    return chain;
  }
  owners.delete(owner);
  if (owners.size === 0) {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = null;
      if (owners.size !== 0) return;
      pendingCommit = onCommit;
      chain = chain.then(applyDesired).catch(() => {});
    }, closeDelayMs);
  }
  return chain;
}
