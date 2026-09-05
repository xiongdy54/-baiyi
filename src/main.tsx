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
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif" }}>
          <h2 style={{ fontSize: 18 }}>界面出现异常，已停止渲染以防数据损坏</h2>
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "#b42318" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })}>重试</button>
          <button onClick={() => window.location.reload()} style={{ marginLeft: 8 }}>
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

// 兜底：任何漏网异常打印到 DevTools，且不让白屏无提示
window.addEventListener("error", (e) => {
  console.error("[global]", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled]", e.reason);
});
