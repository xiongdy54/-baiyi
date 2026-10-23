// C-09：CSP 违规上报——构建产物才有策略（cspPlugin），开发模式 listener 空转。
// 主进程日志通道只认 error/rejection/console（appLog.logRendererError 白名单），故按 console 类别转发。
type LogsApi = { report?: (payload: { kind: "console"; message: string }) => void };

const reported = new Set<string>();

export function installCspReporter(): void {
  document.addEventListener("securitypolicyviolation", (e) => {
    const line = `[CSP] ${e.violatedDirective} ${e.blockedURI}`;
    if (reported.has(line) || reported.size >= 20) return; // 同一违规只记一次，防刷屏日志
    reported.add(line);
    console.warn(`[CSP] blocked ${e.violatedDirective}: ${e.blockedURI}`);
    try {
      (window as unknown as { logsAPI?: LogsApi }).logsAPI?.report?.({ kind: "console", message: line });
    } catch {
      /* 无日志通道（capture 窗口）时只保留 console.warn */
    }
  });
}

installCspReporter();
