// 主题插件注入链——渲染层落点（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §6.4）
//
// 宿主（electron/pluginHost.js）fail-closed 校验后的 css **文本** 与装配好的 `--pl-*` 变量一次下发
// （plugins:getActive → {id, css, vars}）；本模块只做两件事：
//  ① `<style data-plugin-css="<id>">` 注入——textContent 赋值 = 纯文本节点，**无 HTML 解析面**（§6.1）；
//  ② `--pl-<id>-<key>` 内联自定义属性写 body 与 documentElement（applyAccent 同纪律：
//     内联写 body 是本仓已验证的动态主题通道——声明在 body 上的规则胜过 :root 继承）。
//
// 失效回落（§6.3）：payload 为 null / 注入异常 → 移除 style + 清变量 → 界面回到 theme.css 基线。
// 多窗口（§6.4）：主窗 App.tsx 顶层级 useThemePlugin()；capture.tsx / workbench.tsx 各调一次
// installThemePluginBridge()（同一模块，无 React 依赖的桥装函数）。
import { useEffect } from "react";
import { eventBus } from "./eventbus";

export interface PluginVar {
  key: string;
  value: string;
}

export interface ThemePluginPayload {
  id: string;
  css: string;
  vars: PluginVar[];
}

declare global {
  interface Window {
    /** D132 §4.4：主窗全量桥（preload.js）；捕获窗为最小子集（getActive/onChanged，preload-capture.js） */
    pluginsAPI?: {
      list: () => Promise<unknown[]>;
      getActive: () => Promise<ThemePluginPayload | null>;
      setActive: (id: string) => Promise<{ ok: boolean; reason?: string }>;
      openFolder: () => Promise<boolean>;
      rescan: () => Promise<boolean>;
      onChanged: (callback: () => void) => () => void;
    };
    /** D119：渲染层错误转发（fire-and-forget；主进程 appLog.logRendererError 白名单归一） */
    logsAPI?: {
      report: (payload: unknown) => void;
    };
  }
}

const STYLE_ATTR = "data-plugin-css";

function varName(pluginId: string, key: string): string {
  return `--pl-${pluginId}-${key}`;
}

/** 清除某插件前缀的全部内联变量（换装/停用时清旧前缀，§6.1） */
function clearPluginVars(host: HTMLElement | null, pluginId: string): void {
  if (!host) return;
  const style = host.style;
  const prefix = `--pl-${pluginId}-`;
  for (let i = style.length - 1; i >= 0; i--) {
    const prop = style[i];
    if (prop && prop.startsWith(prefix)) style.removeProperty(prop);
  }
}

/**
 * 应用/清除主题插件（§6.1 全链路的渲染端）：null = 停用/回落——只移除旧 style 与旧变量。
 * try/catch 兜底（§4.7 渲染层隔离）：最坏情形 = 一段已过校验的 css 把界面画得难看，无脚本执行面。
 */
export function applyThemePlugin(payload: ThemePluginPayload | null | undefined): void {
  try {
    const prev = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
    const prevId = prev?.getAttribute(STYLE_ATTR) || "";
    if (prev) prev.remove();
    if (prevId) {
      for (const host of [document.body, document.documentElement]) clearPluginVars(host, prevId);
    }
    if (!payload || typeof payload.id !== "string" || !payload.id || typeof payload.css !== "string") return;
    const el = document.createElement("style");
    el.setAttribute(STYLE_ATTR, payload.id);
    el.textContent = payload.css;
    document.head.appendChild(el);
    for (const v of Array.isArray(payload.vars) ? payload.vars : []) {
      if (!v || typeof v.key !== "string" || typeof v.value !== "string") continue;
      for (const host of [document.body, document.documentElement]) {
        host?.style.setProperty(varName(payload.id, v.key), v.value);
      }
    }
  } catch (err) {
    console.warn("[themePlugins] 应用主题插件失败，已回落默认外观：", err);
    try {
      // fire-and-forget 错误上报（§6.1）；日志通道失败不再触发新错误
      window.logsAPI?.report?.({ kind: "error", message: `应用主题插件失败：${err instanceof Error ? err.message : String(err)}` });
    } catch {
      /* 上报可选 */
    }
  }
}

/**
 * 无 React 依赖的桥装函数：首拉 + 订阅（主进程 plugins:changed 推送 / EventBus settings/changed
 * 的 plugin.* scope 变更 → 重拉 getActive 并应用）。返回清理函数。
 */
export function installThemePluginBridge(): () => void {
  let alive = true;
  const pull = async () => {
    try {
      const payload = await window.pluginsAPI?.getActive();
      if (alive) applyThemePlugin(payload ?? null);
    } catch (err) {
      console.warn("[themePlugins] 拉取激活主题插件失败：", err);
    }
  };
  void pull();
  const offPush = window.pluginsAPI?.onChanged?.(() => void pull());
  // 设置值改动即时生效（§5.3）：控件 set → settings/changed（scope plugin.<id>）→ 重拉重写变量
  const offSettings = eventBus.on("settings/changed", (p) => {
    const scope = (p as { scope?: string } | null)?.scope || "";
    if (scope.startsWith("plugin.")) void pull();
  });
  return () => {
    alive = false;
    offSettings();
    offPush?.();
  };
}

/** React hook 形态（App.tsx 顶层级调用一次；capture/workbench 无 React 树，直接用桥装函数） */
export function useThemePlugin(): void {
  useEffect(() => installThemePluginBridge(), []);
}
