import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
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
        workbench: resolve(__dirname, "workbench.html")
      }
    }
  }
});
