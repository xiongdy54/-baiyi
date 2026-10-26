import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { cspPlugin } from "./src/lib/cspPolicy";

/**
 * v49.66（D237）：KaTeX 字体只留 woff2。Electron 内核（Chromium）按 @font-face 的 src 顺序恒取第一项 woff2，
 * 其后的 woff / ttf 回退源永远不会被请求，却会被 Vite 当作资源原样产出（20 款 × 2 格式 ≈ 0.8MB）。
 * 在 CSS 进入 Vite 资源管线**之前**（enforce: "pre"）删掉这两类回退 url()，产物里就不再有它们。
 * 只作用于 katex.min.css / katex.css 的普通导入；`?raw`（合成 EPUB 内嵌样式）按原文不动。
 */
export function katexWoff2Only(): Plugin {
  return {
    name: "nutation:katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(?:\.min)?\.css$/.test(id)) return null;
      const out = code.replace(/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g, "");
      return out === code ? null : { code: out, map: null };
    }
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin(), katexWoff2Only()],
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    // v36（M8-A）：多入口——主窗口 index.html + 快速记录窗口 capture.html
    // （主进程按 dist/capture.html 载入；dev 下走 http://localhost:5173/capture.html）
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        capture: resolve(__dirname, "capture.html"),
        // D123：独立制卡台窗口（主进程按 dist/workbench.html 载入）
        workbench: resolve(__dirname, "workbench.html"),
        // v49.24 / D197：独立结构图窗口（主进程按 dist/lens.html 载入）
        lens: resolve(__dirname, "lens.html")
      }
    }
  }
});
