// F79 卡片浏览的日文检索（渲染层过滤 vs 主进程检索，两套归一口径的正面碰撞）
// @runtime: node  @tier: 2  @gui: true  @id: F79  @timeout: 420
// 运行：node tests/flows/f79-jp-renderer-search.cjs
//
// 起因：F76 量到主进程侧 listJournalEntries/listKnowledgePoints 至少把查询词做了 NFKC，
// 而渲染层 CardBrowser.tsx:141 只有 `query.trim().toLowerCase()` —— 完全不做归一。
// 于是同一个词在"日记/知识点"里能搜到的，在"卡片浏览"里可能搜不到。这条把两条路径
// 跑在**同一份播种数据**上直接对表，并用真键盘（CDP Input.insertText）走渲染层。
// 子进程分工：F79_SEED=1 播种并在同一进程内先出主进程侧命中集（避免二次 initDb 死锁，F71 踩过）。
"use strict";
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir } = require("./lib/harness.cjs");
const { launch, shutdown, wait, ELECTRON } = require("./lib/guienv.cjs");

const C = (...a) => String.fromCodePoint(...a);
const V = {
  K0: { 名: "合成ガ", body: C(0x30ac) },
  K1: { 名: "分解ガ", body: C(0x30ab, 0x3099) },
  K2: { 名: "半角ガ", body: C(0xff76, 0xff9e) },
  K3: { 名: "全角数字", body: C(0xff12, 0xff10, 0xff12, 0xff16) },
  K4: { 名: "半角数字", body: "2026" },
  K5: { 名: "ASCII", body: "DOJO" },
};
const Q = {
  用合成形查: C(0x30ac),
  用分解形查: C(0x30ab, 0x3099),
  用半角形查: C(0xff76, 0xff9e),
  用全角数字查: C(0xff12, 0xff10, 0xff12, 0xff16),
  用半角数字查: "2026",
  用小写ascii查: "dojo",
};
// 主进程侧（做了 NFKC）按 F76 实测应能互通的范围；渲染层若也互通则两边命中集应相同
const WANT = {
  用合成形查: ["K0", "K1", "K2"],
  用分解形查: ["K0", "K1", "K2"],
  用半角形查: ["K0", "K1", "K2"],
  用全角数字查: ["K3", "K4"],
  用半角数字查: ["K3", "K4"],
  用小写ascii查: ["K5"],
};
const line = (k) => `[${k}] ${V[k].body} F79 取样句`;

if (process.env.F79_SEED) {
  const { app } = require("electron");
  app.whenReady().then(async () => {
    const dir = tmpUserDataDir("f79");
    app.setPath("userData", dir);
    fs.mkdirSync(dir, { recursive: true });
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const it = db.createFromPaste("F79 检索对照书", "# 章\n\n为两条检索路径对表而造。\n");
    const itemId = it && (it.id || (it.item && it.item.id));
    for (const k of Object.keys(V)) {
      db.createCard({ itemId, frontMarkdown: line(k), backMarkdown: `答 ${k}`, cardType: "qa" });
      db.createJournalEntry({ contentMarkdown: line(k), source: "app" });
      db.createKnowledgePoint({ canonicalLabel: line(k) });
    }
    db.persistNow();
    const hit = (list) => Object.keys(V).filter((k) => list.some((m) => String(m).includes(`[${k}]`)));
    const dbSide = {};
    for (const [qn, q] of Object.entries(Q)) {
      const jr = db.listJournalEntries({ query: q, limit: 100 });
      const kl = db.listKnowledgePoints({ query: q, limit: 100 });
      const jlist = (Array.isArray(jr) ? jr : jr?.entries || []).map((e) => e.contentMarkdown || e.content_markdown || "");
      const klist = (Array.isArray(kl) ? kl : kl?.points || []).map((e) => e.canonicalLabel || e.canonical_label || "");
      dbSide[qn] = { 日记: hit(jlist), 知识点: hit(klist) };
    }
    console.log("F79DB " + JSON.stringify(dbSide));
    app.exit(0);
  });
  return;
}

const flow = new Flow({
  id: "F79",
  title: "卡片浏览日文检索与主进程对表",
  angle: "同一份数据、同一个查询词，渲染层过滤与主进程检索的命中集是否一致（NFKC 只在一边）",
  cites: ["§4.16", "§5.3", "D-TEST-82"],
  tier: 2,
  gui: true,
});

async function bindablePort(from, to) {
  for (let p = from; p <= to; p++) {
    const ok = await new Promise((res) => {
      const sv = net.createServer();
      sv.once("error", () => res(false));
      sv.listen(p, "127.0.0.1", () => sv.close(() => res(true)));
    });
    if (ok) return p;
  }
  return 0;
}

runFlow(flow, async () => {
  const r = spawnSync(ELECTRON, [path.join(__dirname, "f79-jp-renderer-search.cjs")], {
    cwd: ROOT, env: { ...process.env, F79_SEED: "1" }, encoding: "utf-8", timeout: 180000,
  });
  const dl = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("F79DB ")).pop();
  let dbSide = null;
  try { dbSide = JSON.parse(dl.slice(6)); } catch { /* 子进程没出结果 */ }
  if (!dbSide) {
    flow.check("播种子进程必须给出主进程侧命中集", false, "F79DB …", `status ${r.status} / err ${String(r.stderr || "").slice(-160)}`);
    return;
  }
  flow.record("主进程侧命中集（已做 NFKC）", Object.entries(dbSide).map(([k, v]) => `${k}=${v.日记.join("") || "无"}`).join(" · "));

  const port = await bindablePort(9971, 9995);
  if (!port) { flow.check("找到可绑定的 CDP 端口", false, "可绑定", "9971-9995 全占"); return; }
  let h = await launch({ label: "f79", port, fresh: false, logName: path.join(RESULTS_DIR, "f79.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  const setInput = async (txt) => {
    await h.evaluate(`
      const el=document.querySelector('input[placeholder*="搜索"]'); if(!el) return 'no-input';
      el.focus();
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(el,''); el.dispatchEvent(new Event('input',{bubbles:true}));
      return 'cleared';`);
    await wait(180);
    if (txt) await h.send("Input.insertText", { text: txt });
    await wait(900);
  };
  const readRows = async () => {
    const raw = await h.evaluate(`
      const rows=[...document.querySelectorAll('.cb-row')].filter(e=>!e.className.includes('head'));
      return JSON.stringify(rows.slice(0,400).map(e=>String(e.children[0]?.textContent||'')).filter(s=>/\[K\d\]/.test(s)));`);
    try {
      const arr = JSON.parse(String(raw.value || "[]"));
      return Object.keys(V).filter((k) => arr.some((s) => s.includes(`[${k}]`)));
    } catch { return null; }
  };

  try {
    await wait(8000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='卡片'); if(el) el.click(); return 1;`);
    await wait(3000);

    flow.section("S0 正向对照：搜 F79 应见 6 条、搜乱码应见 0 条");
    await setInput("F79");
    const all6 = (await readRows()) || [];
    flow.check("对照 A：搜共同子串 F79 必须见 6 条", all6.length === 6, "6", `${all6.length}（${all6.join(",")}）`);
    await setInput("zzz不可能存在zzz");
    const none = (await readRows()) || [];
    flow.check("对照 B：搜不存在的串必须 0 条（否则读数是假全量）", none.length === 0, "0", none.length);

    flow.section("S1 六种写法逐条走渲染层，与主进程命中集对表");
    const diffs = [];
    for (const [qn, q] of Object.entries(Q)) {
      await setInput(q);
      const ui = (await readRows()) || [];
      const main = (dbSide[qn] || {}).日记 || [];
      const same = ui.slice().sort().join() === main.slice().sort().join();
      flow.record(`${qn}（${[...q].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase()).join(" ")}）`, `渲染层=${ui.join(",") || "无"} · 主进程=${main.join(",") || "无"} · ${same ? "一致" : "不一致"}`);
      if (!same) diffs.push(`${qn}: 渲染层 ${ui.join(",") || "无"} vs 主进程 ${main.join(",") || "无"}`);
      const want = WANT[qn];
      const lost = want.filter((k) => !ui.includes(k));
      if (lost.length) flow.record(`  该写法在卡片浏览里查不到`, lost.map((k) => V[k].名).join("、"));
    }
    flow.check("同一个查询词在卡片浏览与日记/知识点应给出同一命中集", diffs.length === 0, "两边一致", diffs.join(" ||| ") || "一致");
    await h.send("Page.captureScreenshot", { format: "png" }).then((p) => {
      try { fs.writeFileSync(path.join(RESULTS_DIR, "f79-jp-search.png"), Buffer.from(p.data, "base64")); } catch { /* 截图失败不影响判定 */ }
    });
  } finally {
    if (h && h.child) { try { await shutdown(h); } catch { try { h.child.kill(); } catch { /* 已退 */ } } }
  }
});
