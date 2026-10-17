"use strict";
// 导图 v2 基准页 · 主进程胶水：窗口、文件对话框、材料抽取（txt/md/docx/epub）、jsonl 持久化、CSV 导出、IPC。
// 重逻辑都在 mindmapBenchRunner.js / mindmapBenchCore.js（可脱离 Electron 测试）。
const path = require("path");
const fs = require("fs");
const Core = require("./mindmapBenchCore.js");
const { createBenchRunner } = require("./mindmapBenchRunner.js");
const { SAMPLE_TITLE, SAMPLE_TEXT } = require("./mindmapBenchSample.js");

const MAX_FILE_BYTES = 60 * 1024 * 1024;

function register({ app, ipcMain, dialog, BrowserWindow, getAIConfig, chatStream }) {
  let win = null;
  const historyFile = () => path.join(app.getPath("userData"), "mindmap-v2-bench.jsonl");
  const send = (ev) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("bench:event", ev);
  };
  const persist = (rec) => {
    try {
      fs.mkdirSync(path.dirname(historyFile()), { recursive: true });
      fs.appendFileSync(historyFile(), JSON.stringify(rec) + "\n", "utf-8");
    } catch (e) {
      send({ t: "warn", message: `写入历史失败：${e.message}` });
    }
  };
  const runner = createBenchRunner({ chatStream, getAIConfig, emit: send, persist });

  const safeConfig = () => {
    const c = getAIConfig();
    return { preset: c.preset, presetName: c.presetName, model: c.model, baseUrl: c.baseUrl, hasKey: Boolean(c.hasKey) || c.preset === "local" };
  };

  ipcMain.handle("bench:open", () => {
    if (win && !win.isDestroyed()) { win.focus(); return true; }
    win = new BrowserWindow({
      width: 1440, height: 920, title: "导图 v2 基准",
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
    });
    win.loadFile(path.join(__dirname, "renderer", "mindmap-bench.html"));
    win.on("closed", () => { win = null; });
    return true;
  });

  ipcMain.handle("bench:config", () => safeConfig());
  ipcMain.handle("bench:sample", () => ({ title: SAMPLE_TITLE, chapters: [{ title: SAMPLE_TITLE, text: SAMPLE_TEXT }] }));

  ipcMain.handle("bench:pickMaterial", async () => {
    const r = await dialog.showOpenDialog(win || undefined, {
      filters: [{ name: "材料", extensions: ["txt", "md", "docx", "epub"] }], properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const p = r.filePaths[0];
    if (fs.statSync(p).size > MAX_FILE_BYTES) throw new Error("文件超过 60MB，请换小一点的材料");
    const ext = path.extname(p).slice(1).toLowerCase();
    const base = path.basename(p, path.extname(p));
    let chapters;
    if (ext === "docx") {
      const mammoth = require("mammoth");
      const out = await mammoth.extractRawText({ path: p });
      chapters = [{ title: base, text: String(out.value || "").replace(/\r/g, "").trim() }];
    } else if (ext === "epub") {
      const JSZip = require("jszip");
      const zip = await JSZip.loadAsync(fs.readFileSync(p));
      chapters = await Core.chaptersFromEpubZip(zip);
    } else {
      chapters = [{ title: base, text: fs.readFileSync(p, "utf-8").replace(/^\uFEFF/, "").replace(/\r/g, "").trim() }];
    }
    chapters = chapters.filter((c) => c.text);
    if (!chapters.length) throw new Error("没有提取到文字内容");
    return { title: base, fileName: path.basename(p), chapters };
  });

  ipcMain.handle("bench:start", (_e, payload) => {
    const p = payload || {};
    const chapters = Array.isArray(p.chapters) ? p.chapters.map((c) => ({ title: String((c && c.title) || ""), text: String((c && c.text) || "") })) : [];
    const { runId, done } = runner.startRun({ title: p.title, chapters, concurrency: p.concurrency });
    done.catch((err) => send({ t: "fatal", runId, message: err && err.message ? err.message : String(err) }));
    return { runId };
  });
  ipcMain.handle("bench:cancel", (_e, runId) => { runner.cancel(String(runId)); return true; });
  ipcMain.handle("bench:expand", async (_e, runId, nodePath) => {
    try { return await runner.expand(String(runId), String(nodePath)); } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle("bench:explain", async (_e, runId, nodePath) => {
    try { return await runner.explain(String(runId), String(nodePath)); } catch (err) { return { error: err.message }; }
  });

  function readHistory() {
    try { return Core.foldHistory(fs.readFileSync(historyFile(), "utf-8")); } catch { return { runs: [], calls: new Map() }; }
  }
  ipcMain.handle("bench:history", () => readHistory().runs);

  // runIds 为空 → 导出全部；弹保存对话框，写两个文件：xxx.csv（run 汇总）与 xxx-calls.csv（逐调用）
  ipcMain.handle("bench:exportCsv", async (_e, runIds) => {
    const h = readHistory();
    const want = Array.isArray(runIds) && runIds.length ? new Set(runIds.map(String)) : null;
    const runs = h.runs.filter((r) => !want || want.has(r.runId));
    if (!runs.length) throw new Error("还没有可导出的历史记录");
    const r = await dialog.showSaveDialog(win || undefined, {
      title: "导出 CSV", defaultPath: `mindmap-v2-bench-${Core.isoLocal(Date.now()).slice(0, 10)}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const callsPath = r.filePath.replace(/\.csv$/i, "") + "-calls.csv";
    const callRows = [];
    for (const run of runs) for (const c of h.calls.get(run.runId) || []) callRows.push(Core.callToRow(c));
    fs.writeFileSync(r.filePath, "\uFEFF" + Core.toCsv(runs.map(Core.runToRow), Core.RUN_COLUMNS), "utf-8");
    fs.writeFileSync(callsPath, "\uFEFF" + Core.toCsv(callRows, Core.CALL_COLUMNS), "utf-8");
    return { runsPath: r.filePath, callsPath, runs: runs.length, calls: callRows.length };
  });
}

module.exports = { register };
