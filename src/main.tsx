import "./lib/cspReport";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// 全局错误边界：渲染异常显示错误信息，绝不允许白屏且无提示
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      // 崩溃兜底：这段必须在 theme.css 本身加载失败时也能显示，所以样式只能内联 ——
      // 是「未 Token 化硬编码」规则的**已记录例外**，做设计债扫描时请勿当成漏改。
      // 颜色仍优先取 Token（CSS 在时跟随主题），取不到才落到字面量。
      return (
        <div style={{ padding: 24, fontFamily: "var(--font-sans, sans-serif)" }}>
          <h2 style={{ fontSize: "var(--fs-title-s, 18px)" }}>界面出现异常，已停止渲染以防数据损坏</h2>
          <pre style={{ fontSize: "var(--fs-meta, 12px)", whiteSpace: "pre-wrap", color: "var(--error, #b42318)" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })}>重试</button>
          <button onClick={() => window.location.reload()} style={{ marginLeft: "var(--sp-2, 8px)" }}>
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </React.StrictMode>
  );
} catch (err) {
  document.body.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
}

// v48.75（D119）：渲染层错误经 IPC 转发主进程统一写盘（logs:rendererError，fire-and-forget
// send 不回执——报告失败不触发新错误）。载荷字段白名单在主进程侧归一（appLog.logRendererError），
// 此处只装配，不写文件（渲染层不持 IO）。
type LogsApi = { openFolder: () => Promise<boolean>; report: (payload: unknown) => void };
const logsApi = (window as { logsAPI?: LogsApi }).logsAPI;
// v48.75 审查修订（D119 ⑥）：出口令牌桶限频（20 条/秒）——渲染层刷屏（如渲染循环每帧
// 抛错、React 无限重渲）不得转为主进程 appendFileSync 同步写风暴，超限直接丢弃（日志是
// best-effort 诊断通道，风暴时保进程优先）；正常单发错误率远低于 20/s，永远有额度。
let reportTokens = 20;
let reportRefillAt = Date.now();
function reportBudget(): boolean {
  const now = Date.now();
  if (now - reportRefillAt >= 1000) {
    reportTokens = 20;
    reportRefillAt = now;
  }
  if (reportTokens <= 0) return false;
  reportTokens--;
  return true;
}
function reportError(
  kind: "error" | "rejection" | "console",
  data: { message?: unknown; stack?: unknown; source?: unknown; line?: unknown; col?: unknown }
) {
  try {
    if (!reportBudget()) return;
    logsApi?.report({ kind, ...data });
  } catch {
    /* 静默：日志通道永不外溢 */
  }
}

// console.error hook：转发真实错误（React/库警告也随之入日志，体积由轮转 + 出口限频控制）。
// 先调原函数保持 DevTools 行为不变；[global]/[unhandled] 前缀跳过——这两类已由下方监听完整
// 记录，防同一条错误双写。
// v48.75 审查修订：取参优先第一个 Error、次选首参 string——多参调用（如
// console.error("ctx", err)）不再丢真实错误与其堆栈。
const TAG_GLOBAL = "[global]";
const TAG_UNHANDLED = "[unhandled]";
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  try {
    const first = args[0];
    if (typeof first === "string" && (first === TAG_GLOBAL || first === TAG_UNHANDLED)) return;
    const err = args.find((a) => a instanceof Error);
    const message =
      err
        ? `${err.name}: ${err.message}`
        : typeof first === "string"
          ? first
          : "";
    if (message) {
      reportError("console", { message, stack: err ? err.stack : undefined });
    }
  } catch {
    /* 静默 */
  }
};

// 兜底：任何漏网异常打印到 DevTools，且不让白屏无提示
window.addEventListener("error", (e) => {
  console.error("[global]", e.error || e.message);
  reportError("error", {
    message: e.error instanceof Error ? e.error.message : e.message,
    stack: e.error instanceof Error ? e.error.stack : undefined,
    source: e.filename,
    line: e.lineno,
    col: e.colno
  });
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled]", e.reason);
  reportError("rejection", {
    message: e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""),
    stack: e.reason instanceof Error ? e.reason.stack : undefined
  });
});
