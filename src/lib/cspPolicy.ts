// C-09：渲染页 CSP（唯一来源）。构建期由 cspPlugin 注入 <meta>；开发模式不注入（Vite HMR 依赖内联脚本）。
// media-src 的 https: 是在线词典真人发音（settings.app.dictAudioSource="online" 时渲染层 new Audio(url) 直连）。
// img-src 的 https: 对应决策 D-08（未答复前按报告默认保留）。
import type { Plugin } from "vite";

export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: bookasset: https:",
  "font-src 'self' data: blob: pdfres:",
  "media-src 'self' data: blob: bookasset: https:",
  "connect-src 'self' data: blob: bookasset: pdfres:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
];

export const CSP_POLICY = CSP_DIRECTIVES.join("; ");

export function cspPlugin(): Plugin {
  return {
    name: "nutation-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`);
    }
  };
}
