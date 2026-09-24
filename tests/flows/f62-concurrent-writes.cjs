// F62 并发面定位：主进程写 API 是同步的，那么"双击/并发"到底在哪个窗口里能咬人
// @runtime: electron  @tier: 2  @gui: false  @id: F62  @timeout: 300
// 运行：npx electron tests/flows/f62-concurrent-writes.cjs
//
// 本条第一版想用 Promise.all 在同一进程里并发调 saveReview，结果当场撞出
//   `TypeError: p.then is not a function` ⇒ **主进程写 API 全是同步函数**，
//   同进程内不存在交错窗口（Node 单线程 + 同步函数 = 天然串行）。
// 于是真正能咬人的并发面只剩两处，本条把这两处量清楚：
//   A. `ipcMain.handle` 里**带 await 且写库 ≥2 次**的 handler —— await 会让出主线程，别的 invoke 能插进来；
//   B. 多进程同开一个 dataDir —— 已由 D-TEST-24/25 证实（整库互相覆盖），本条只复核"同步 API"这个前提还成立。
"use strict";
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F62",
  title: "并发面定位（同步写 API 与 async handler 重入窗口）",
  angle: "先证明同进程无交错窗口，再把 async+多写的 IPC handler 全列出来",
  cites: ["§4.4.9", "§7.1.3", "§7.2"],
  tier: 2,
  gui: false,
});

const WRITE_RE = /\b(db|dbModule|Module)\s*\.\s*(create|save|insert|update|delete|set|apply|undo|persist|add|remove|resolve|mark|send|restore)[A-Za-z0-9_]*\s*\(/g;

/**
 * 取第 i 行上那个 ipcMain.handle 的**自己的**函数体。
 * 坑（本条第一版就栽在这）：`ipcMain.handle("x", (_e,id) => fn(id));` 是**简洁箭头体、没有大括号**，
 * 按大括号配平会一直读到 120 行之外，把**后面几个 handler** 全吞进来 ⇒ 凭空造出"带 await"的假阳性。
 * 所以：先看本行 `=>` 之后有没有 `{`；没有就只取到本行的收尾分号。
 */
function handlerBody(lines, i) {
  const line = lines[i];
  const arrow = line.indexOf("=>");
  if (arrow >= 0) {
    const after = line.slice(arrow + 2);
    if (!after.includes("{")) return line; // 简洁体：就这一行
  }
  let depth = 0;
  let started = false;
  const out = [];
  for (let j = i; j < Math.min(lines.length, i + 120); j++) {
    out.push(lines[j]);
    for (const ch of lines[j]) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") depth--;
    }
    if (started && depth <= 0) break;
    if (j > i && /^\s*ipcMain\.handle\(/.test(lines[j])) break; // 兜底：撞到下一个 handler 就停
  }
  return out.join("\n");
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f62"));
    app.setPath("userData", dir);
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();

    await runFlow(flow, async () => {
      flow.section("A1 前提复核：主进程写函数确实是同步的吗（决定并发面在哪）");
      const item = db.createFromPaste("F62 并发书", "# 章\n\n内容。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const cid = db.createCard({ itemId, frontMarkdown: "甲", backMarkdown: "乙", cardType: "qa" }).id;
      const st = db.getCard(cid).fsrs;
      const ret = db.saveReview(cid, { ...st, reps: 1, due: Date.now() + 86400000 }, "Good", 900, st);
      const isThenable = !!(ret && typeof ret.then === "function");
      flow.record("saveReview 返回是否 thenable", String(isThenable));
      const probes = ["saveSkip", "undoLastReview", "createJournalEntry", "setActiveFsrsConfig", "persistNow"];
      const shapes = {};
      for (const p of probes) {
        if (typeof db[p] !== "function") {
          shapes[p] = "不存在";
          continue;
        }
        try {
          let r;
          if (p === "saveSkip" || p === "undoLastReview") r = db[p](cid);
          else if (p === "createJournalEntry") r = db[p]({ contentMarkdown: "F62 探针", source: "app" });
          else r = db[p]();
          shapes[p] = r && typeof r.then === "function" ? "async" : "sync";
          if (r && typeof r.then === "function") await r;
        } catch (e) {
          shapes[p] = "抛错:" + String((e && e.message) || e).slice(0, 40);
        }
      }
      flow.record("关键写函数形状", JSON.stringify(shapes));
      const allSync = !isThenable && Object.values(shapes).every((v) => v === "sync" || v === "不存在" || v.startsWith("抛错"));
      flow.check(
        "同进程内主写路径必须是同步串行的（若出现 async，则本条要重做 Promise.all 交错测试）",
        allSync,
        "全同步",
        { saveReview: isThenable ? "async" : "sync", shapes }
      );

      flow.section("A2 真正的并发窗口：ipcMain.handle 里「带 await 且写库 ≥2 次」的 handler");
      const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8").replace(/\r\n/g, "\n");
      const lines = main.split("\n");
      const handlers = [];
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/ipcMain\.handle\(\s*["'`]([^"'`]+)["'`]/);
        if (!m) continue;
        // 取该 handler **自己的**体（简洁箭头体只取本行，见 handlerBody 的注释）
        const b = handlerBody(lines, i);
        const writes = (b.match(WRITE_RE) || []).length;
        const hasAwait = /\bawait\b/.test(b);
        if (hasAwait && writes >= 2) handlers.push({ ch: m[1], writes, line: i + 1, awaits: (b.match(/\bawait\b/g) || []).length, body: b });
      }
      flow.record("带 await 且写库≥2 的 handler 数", handlers.length);
      for (const h of handlers) flow.record("重入窗口候选", `main.js:${h.line} ${h.ch}（await×${h.awaits}，写×${h.writes}）`);

      flow.section("A3 这些 handler 有没有重入保护");
      const GUARD = /isRunning|busy|lock|mutex|inFlight|pending|reentr|already|queue|debounce|throttle|inprogress/i;
      const unguarded = [];
      for (const h of handlers) {
        const idx = lines.findIndex((l) => l.includes(`"${h.ch}"`) || l.includes(`'${h.ch}'`));
        let depth = 0;
        let started = false;
        const body = [];
        for (let j = idx; j < Math.min(lines.length, idx + 120); j++) {
          body.push(lines[j]);
          for (const ch of lines[j]) {
            if (ch === "{") {
              depth++;
              started = true;
            } else if (ch === "}") depth--;
          }
          if (started && depth <= 0) break;
        }
        if (!GUARD.test(body.join("\n"))) unguarded.push(h.ch);
      }
      flow.record("无重入保护的 handler", unguarded.length ? unguarded.join(" ") : "无");
      for (const u of unguarded) flow.record("  待人工判断", `${u}：await 让出主线程期间，第二次 invoke 可以插进来，且看不到任何互斥/在途标记`);

      flow.section("A4 判定");
      flow.record(
        "本条结论口径",
        handlers.length === 0
          ? "没有 await+多写的 handler ⇒ 同进程并发面收敛为「全同步串行」，双击风险在渲染层与多进程面（D-TEST-24/25）"
          : `有 ${handlers.length} 个 handler 存在让出窗口的形状，其中 ${unguarded.length} 个看不到保护 ⇒ 需要逐条人工判断是否真能被第二次 invoke 插进来`
      );
      flow.check(
        "存在 await+多写形状的 handler 时，每一个都必须能看到在途/互斥标记（本条按设计就是红的，逐条收口才转绿）",
        unguarded.length === 0,
        "0 个无保护",
        { 候选: handlers.length, 无保护: unguarded }
      );
    });
    setTimeout(() => app.exit(0), 200);
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.stack) || e));
    setTimeout(() => app.exit(1), 200);
  });
