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
export function useWorkbenchPlacement(): WorkbenchPlacement {
  const [placement, setPlacement] = useState<WorkbenchPlacement>("right");
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void settingsStore.get<string>("app", "workbenchPlacement", "right").then((v) => {
        if (!cancelled) setPlacement(normalizePlacement(v));
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
const owners = new Map<symbol, { placement: WorkbenchPlacement }>();
let extended = false;
let chain: Promise<void> = Promise.resolve();
let bridgeInstalled = false;

function root(): HTMLElement {
  return document.documentElement;
}

async function applyDesired(): Promise<void> {
  const active = [...owners.values()].pop();
  const el = root();
  if (!active) {
    delete el.dataset.wbOpen;
    delete el.dataset.wbPlace;
    delete el.dataset.wbMode;
    if (extended) {
      extended = false;
      await window.windowAPI?.dockRestore?.();
    }
    return;
  }
  el.dataset.wbOpen = "1";
  el.dataset.wbPlace = active.placement;
  if (active.placement === "right") {
    if (!extended) {
      const r = await window.windowAPI?.dockExtend?.(WB_WIDTH);
      extended = r?.mode === "extended";
    }
    el.dataset.wbMode = extended ? "extended" : "inner";
  } else {
    if (extended) {
      extended = false;
      await window.windowAPI?.dockRestore?.();
    }
    el.dataset.wbMode = "inner";
  }
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

/** 宿主登记/注销自己的制卡台展开态（open=false 即注销） */
export function setDockLayout(owner: symbol, open: boolean, placement: WorkbenchPlacement): void {
  installBridge();
  if (open) {
    owners.delete(owner); // 重新登记＝成为「最后登记者」
    owners.set(owner, { placement });
  } else {
    owners.delete(owner);
  }
  chain = chain.then(applyDesired).catch(() => {});
}
