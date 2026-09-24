// F69 极端值渲染量测（真实界面 · 真实数据形状 · 只读）
// @runtime: node  @tier: 2  @gui: true  @id: F69  @timeout: 900
// 运行：node tests/flows/f69-extreme-values.cjs
//       （缺清单时自动派生 npx electron tests/flows/f69b-seed.cjs；F69_RESEED=1 强制重播）
//
// 盲区定位：F19 喂的是**非法参数**，F26 比的是**静态字符串**，F44 量的是**视口几何**。
// 没有人把"极端但可信的值"塞进真实界面看它输出什么。一个用了四年的库不会给出干净的两位数：
// 1.2 万张卡、400 天连续、0.5% 与 99.6% 的进度、200 字书名、stability 1e12、U+202E 反向标题。
// 本流程量三件事，全部**只在真实 DOM 上取值**：
//   ① 坏值指纹：NaN / Infinity / undefined / [object Object] / null / 1e+21 / 无限长无空白串；
//   ② 同一个量在两处长得不一样（计数缩写、取整口径、百分比），报出双方的实际读数；
//   ③ 同一条 200 字书名在各处的截断长度与"全文是否仍可达"（title 属性）。
// 正对照两次：(A) 注入一条含全部坏值指纹的人造样张，证明扫描真的扫得到；
//            (B) 播种进去一张 due=null 的卡，看界面自带防线（mapCardRow 值域闸门）拦不拦得住。
//
// 纪律：① 只用 f69 自己的沙箱；端口必须先用 net 实测可绑定再交给 electron
//         （guienv 的 portFree 只看"能不能连上"，撞上别人独占绑定的端口会 90s 连不上 CDP —— 实测踩过）；
//       ② 不 monkey-patch 上下文桥（f48/f68 已证 window.libraryAPI 不可写），全程只读 DOM；
//       ③ 每一次 evaluate 都有墙钟预算，超时按事实报告而不是把整条流程挂死；
//       ④ shutdown 只杀自己 spawn 的 PID。
"use strict";
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir } = require("./lib/harness.cjs");
const { launch, shutdown, wait, clickText, ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F69",
  title: "极端值渲染量测",
  angle: "极端但可信的值（1.2 万卡 / 400 天 / 0.5% 与 99.6% / 200 字书名 / 1e12 / RTL 覆盖）在真实界面上渲染成什么",
  cites: ["§5.1", "§5.4", "§6.1", "§6.2", "D51", "D53"],
  tier: 2,
  gui: true,
});

const UDIR = tmpUserDataDir("f69");
const MANIFEST = path.join(UDIR, "f69-seed-manifest.json");

/** 实测可绑定的端口（连得上 ≠ 绑得住；Windows 上端口被别的进程独占时 electron 会 bind 失败） */
async function bindablePort(start, span) {
  for (let p = start; p < start + span; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once("error", () => res(false));
      s.listen(p, "127.0.0.1", () => s.close(() => res(true)));
    });
    if (ok) return p;
  }
  return start;
}

/** 给每次 evaluate 套墙钟预算，并把耗时记下来（一万二千行页面可能慢到没有读数） */
async function ev(h, expr, tag, budget = 60000) {
  const t0 = Date.now();
  const out = await Promise.race([
    h.evaluate(expr),
    new Promise((res) => setTimeout(() => res({ error: `墙钟超时 ${budget}ms` }), budget)),
  ]);
  const ms = Date.now() - t0;
  if (out && out.error) flow.record(`${tag} 取数失败`, `${String(out.error).slice(0, 90)} · ${ms}ms`);
  else flow.record(`${tag} 取数耗时`, `${ms}ms`);
  return out;
}

// ---------- 扫描器：一次 evaluate 把一屏的全部读数取回来 ----------
function pageScan(probes, injectControl) {
  return `
  const TOKS=["NaN","Infinity","undefined","[object Object]","null","1e+21","1e+12","1e21","-0%","%%","NaN-NaN","Invalid Date","NaN%","0/0","NaN 张","NaN天"];
  if(${JSON.stringify(!!injectControl)}){
    const d=document.createElement("div");
    d.id="__f69ctl";
    d.style.cssText="position:fixed;left:8px;top:8px;z-index:99999;font-size:11px;color:#000;background:#fff";
    d.textContent="F69对照样张 NaN Infinity undefined [object Object] null 1e+21 "+("渐进阅读极端值对照长串".repeat(30));
    document.body.appendChild(d);
  }
  const text=document.body.innerText||"";
  const hits=[];
  for(const t of TOKS){
    let idx=0,n=0;
    while((idx=text.indexOf(t,idx))>=0&&n<8){
      hits.push({token:t,上下文:text.slice(Math.max(0,idx-30),idx+t.length+30).replace(/\\s+/g," ")});
      idx+=t.length;n++;
    }
  }
  const runs=[];
  const pre=/\\S{200,}/g;let m;
  while((m=pre.exec(text))&&runs.length<8){runs.push({长度:m[0].length,开头:m[0].slice(0,40),结尾:m[0].slice(-12)});}
  const pcts=[];
  const pre2=/(\\d+(?:\\.\\d+)?)\\s*%/g;
  while((m=pre2.exec(text))&&pcts.length<120){pcts.push({值:m[1],上下文:text.slice(Math.max(0,m.index-26),m.index+m[0].length+14).replace(/\\s+/g," ")});}
  const labs={};
  for(const L of ["今日到期","待复习","连续","共","总计","卡片","本","已读","损坏","暂缓","逾期","总卡数","全部卡片","张"]){
    const r=new RegExp(L+"[^0-9\\\\-]{0,10}([0-9][0-9,\\\\.]*[万千]?)");
    const g=text.match(r);
    if(g)labs[L]={读数:g[1],上下文:text.slice(Math.max(0,g.index-24),g.index+g[0].length+18).replace(/\\s+/g," ")};
  }
  const titleSpots=[];
  const all=[...document.querySelectorAll("*")];
  const leaves=all.filter(e=>e.children.length===0&&e.textContent&&e.textContent.length>2).slice(0,9000);
  const PROBES=${JSON.stringify(probes)};
  for(const e of leaves){
    const t=e.textContent;
    for(const p of PROBES){
      if(!t.includes(p.prefix))continue;
      const cs=getComputedStyle(e);
      const own=e.textContent.trim();
      titleSpots.push({取样:p.key,标签:e.tagName.toLowerCase(),类:String(e.className||"").split(/\\s+/).slice(0,2).join("."),
        渲染码点:[...own].length,渲染单元:own.length,全码点:p.codes,
        截断:cs.textOverflow,溢出:cs.overflow,可见宽:e.clientWidth,内容宽:e.scrollWidth,
        裁切:e.scrollWidth>e.clientWidth+1,省略号:/…|\\.{3}$/.test(own),
        title属性:(e.getAttribute("title")||e.closest("[title]")?.getAttribute("title")||"").length});
      break;
    }
    if(titleSpots.length>=40)break;
  }
  const emptyCaps=all.filter(e=>e.children.length===0&&e.textContent.length>0&&e.textContent.trim()===""&&/cap|title|name|label/i.test(String(e.className))).length;
  const widest=all.filter(e=>e.scrollWidth>document.documentElement.clientWidth+4).slice(0,6).map(e=>({标签:e.tagName.toLowerCase(),类:String(e.className||"").split(/\\s+/)[0],超出px:e.scrollWidth-document.documentElement.clientWidth}));
  if(${JSON.stringify(!!injectControl)})document.getElementById("__f69ctl")?.remove();
  return JSON.stringify({正文长度:text.length,元素数:all.length,坏值指纹:hits.slice(0,40),指纹种数:new Set(hits.map(h=>h.token)).size,
    无空白长串:runs,百分比:pcts.slice(0,60),标量读数:labs,书名落点:titleSpots,空白图注格数:emptyCaps,横向溢出:widest});`;
}

async function scan(h, tag, probes, control = false, budget = 60000) {
  const raw = await ev(h, pageScan(probes, control), tag, budget);
  try {
    const j = JSON.parse(String(raw.value));
    flow.record(
      `${tag} 读数`,
      `正文 ${j.正文长度} 字 / ${j.元素数} 元素 · 指纹 ${j.指纹种数} 种/${j.坏值指纹.length} 处 · 长串 ${j.无空白长串.length} · 百分比 ${j.百分比.length} · 溢出元素 ${j.横向溢出.length}`
    );
    return j;
  } catch {
    flow.record(`${tag} 无读数`, String(raw.error || raw.value).slice(0, 120));
    return null;
  }
}

const num = (s) => {
  const t = String(s).replace(/,/g, "");
  const mul = t.includes("万") ? 10000 : t.includes("千") ? 1000 : 1;
  const v = parseFloat(t);
  return Number.isFinite(v) ? Math.round(v * mul) : null;
};

/** 同一个量在两处：数值不同 → 报数；只是写法不同 → 报写法 */
function compare(label, places) {
  const list = Object.entries(places).filter(([, v]) => v != null && v !== "null" && v !== "undefined");
  if (list.length < 2) {
    flow.record(`跨屏比对 ${label} 跳过`, `只有 ${list.length} 处有读数：${JSON.stringify(places)}`);
    return;
  }
  const vals = list.map(([, v]) => num(v));
  const same = vals.every((x) => x === vals[0]);
  const sameText = list.every(([, v]) => String(v) === String(list[0][1]));
  flow.record(`跨屏比对 ${label}`, list.map(([k, v]) => `${k}=${v}`).join(" · "));
  if (!same) flow.check(`同一个量「${label}」各处数值一致`, false, "各处相等", list.map(([k, v]) => `${k}=${v}`).join(" · "));
  else if (!sameText) flow.check(`同一个量「${label}」各处写法一致（数值相同但格式化不同）`, false, "同一写法", list.map(([k, v]) => `${k}=${v}`).join(" · "));
}

runFlow(flow, async () => {
  // ---------- 0) 播种（幂等：清单在就复用） ----------
  flow.section("S0 极端数据集");
  if (!fs.existsSync(MANIFEST) || process.env.F69_RESEED === "1") {
    flow.record("播种方式", "派生 electron 跑 f69b-seed.cjs（沙箱 " + UDIR + "）");
    const r = spawnSync(ELECTRON, [path.join(ROOT, "tests", "flows", "f69b-seed.cjs")], {
      cwd: ROOT,
      env: { ...process.env, M7_TEST_USERDATA: UDIR },
      timeout: 240000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    const out = String(r.stdout || "") + String(r.stderr || "");
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, "f69b-seed.log"), out, "utf8");
    flow.record("播种器退出码", `${r.status} · 日志 tests/flows/results/f69b-seed.log`);
    const bad = out.split("\n").filter((l) => l.includes("✗ ")).slice(0, 6);
    if (bad.length) flow.record("播种器自报失败项", bad.join(" | ").slice(0, 300));
  } else {
    flow.record("播种方式", "复用已有清单（F69_RESEED=1 强制重播）");
  }
  if (!fs.existsSync(MANIFEST)) {
    flow.check("极端数据集清单存在（无清单则本流程一切读数为空）", false, "存在", MANIFEST);
    return;
  }
  const man = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  flow.record("实际播种量", JSON.stringify(man.truth));
  flow.record("库侧真值", JSON.stringify(man.dbTruth));
  flow.record("批量卡实建条数", `${man.cardsActuallySeeded} 张（目标 12000）`);
  flow.record("极端标题清单", man.extremeTitles.map((t) => `${t.key}=${[...t.title].length}码点/${t.title.length}单元`).join(" · "));

  const probes = man.extremeTitles
    .filter((t) => [...t.title].join("").trim().length > 0)
    .map((t) => ({ key: t.key, prefix: [...t.title].slice(0, 6).join(""), codes: [...t.title].length }));
  const t200 = probes.find((p) => p.key === "t200");
  flow.check("探针标题可用（≥6 种）", probes.length >= 6, "≥6", probes.length);

  const port = await bindablePort(9950, 60);
  flow.record("CDP 端口（实测可绑定）", String(port));
  let h = await launch({ label: "f69", port, fresh: false, logName: path.join(RESULTS_DIR, "f69.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("在已播种沙箱上打开真实界面（f69 专用目录/端口）", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(9000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);
    const boot = await ev(h, `return JSON.stringify({导航:[...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()),正文:(document.body.innerText||'').length,报错:(document.body.innerText||'').slice(0,120)});`, "启动自检", 40000);
    flow.record("启动后界面", String(boot.value || boot.error).slice(0, 260));
    if (!String(boot.value || "").includes("书架")) {
      flow.check("应用已渲染出主导航（否则后续读数全为空气）", false, "含「书架」", String(boot.value || boot.error).slice(0, 200));
      return;
    }

    // ---------- 1) 正对照 A：证明坏值指纹扫描抓得住人造样张 ----------
    flow.section("S1 正对照 A：证明扫描抓得住坏值");
    const ctl = await scan(h, "对照样张", [{ key: "ctl", prefix: "F69对照样张", codes: 8 }], true, 40000);
    const seen = new Set((ctl?.坏值指纹 || []).map((x) => x.token));
    const missing = ["NaN", "Infinity", "undefined", "[object Object]", "null", "1e+21"].filter((w) => !seen.has(w));
    flow.record("对照样张被抓到的指纹", [...seen].join(" / ") || "零命中");
    flow.check("自检：注入含全部坏值指纹的样张后必须逐项抓到（抓不到 ⇒ 本流程的绿不算数）", missing.length === 0, "6/6 全中", missing.length ? `漏掉 ${missing.join(",")}` : "全中");
    flow.check("自检：400 字无空白长串必须被长串规则抓到", (ctl?.无空白长串 || []).some((r) => r.长度 >= 400), "命中", JSON.stringify((ctl?.无空白长串 || []).slice(0, 2)));

    // ---------- 2) 逐屏量测 ----------
    const SCREENS = [
      ["书架", "shelf"],
      ["队列", "queue"],
      ["复习", "review"],
      ["卡片", "browse"],
      ["日记", "journal"],
      ["数据", "stats"],
    ];
    const found = {};
    const scalars = {};
    for (const [label, key] of SCREENS) {
      flow.section(`S2 屏 · ${label}`);
      const clicked = await h.evaluate(clickText(".nav-item", label));
      flow.check(`导航到「${label}」`, clicked.value === true, "true", String(clicked.value));
      await wait(key === "stats" ? 6000 : 4500);
      const j = await scan(h, label, probes);
      if (!j) continue;
      found[key] = j;
      scalars[key] = j.标量读数;
      await h.shot(`f69-${key}`);
      if (j.坏值指纹.length) flow.record(`${label} 坏值指纹`, j.坏值指纹.slice(0, 8).map((x) => `[${x.token}] ${x.上下文}`).join(" ⏎ ").slice(0, 600));
      if (j.无空白长串.length) flow.record(`${label} 无空白长串`, j.无空白长串.slice(0, 3).map((r) => `${r.长度}字(${r.开头}…) 尾「${r.结尾}」`).join(" ⏎ "));
      if (j.百分比.length) flow.record(`${label} 百分比读数`, j.百分比.slice(0, 16).map((p) => `${p.值}%`).join(" "));
      if (j.横向溢出.length) flow.record(`${label} 横向溢出元素`, JSON.stringify(j.横向溢出).slice(0, 300));
    }

    // ---------- 3) 阅读内核 + 设置面板 ----------
    flow.section("S3 屏 · 阅读内核（从书架点开 200 字书名那本）");
    await h.evaluate(clickText(".nav-item", "书架"));
    await wait(4500);
    const openBook = await h.evaluate(`
      const p=${JSON.stringify(t200 ? t200.prefix : "关于渐进")};
      const el=[...document.querySelectorAll("[class*=cap],[class*=title],.book-card,td,div,button")].find(e=>e.textContent.includes(p)&&e.textContent.trim().length<400);
      if(!el) return "notfound";
      (el.closest(".book-card,[class*=shelf-item],tr")||el).click();
      return "clicked";`);
    flow.record("点开 200 字书名", String(openBook.value || openBook.error));
    await wait(7000);
    const reader = await scan(h, "阅读内核", probes);
    await h.shot("f69-reader");
    if (reader) {
      found.reader = reader;
      scalars.reader = reader.标量读数;
      if (reader.坏值指纹.length) flow.record("阅读内核 坏值指纹", reader.坏值指纹.slice(0, 8).map((x) => `[${x.token}] ${x.上下文}`).join(" ⏎ ").slice(0, 600));
    }
    await h.evaluate(`const b=[...document.querySelectorAll("button,[class*=back],[aria-label*=返回],[title*=返回]")].find(x=>/返回|关闭|书架/.test((x.textContent||"")+(x.getAttribute("aria-label")||"")+(x.getAttribute("title")||"")));if(b)b.click();return !!b;`);
    await wait(2500);

    flow.section("S4 屏 · 设置面板");
    const sopen = await h.evaluate(`const b=document.querySelector('button.icon-btn[title="设置"]');if(b){b.click();return true}return false;`);
    flow.check("打开设置面板", sopen.value === true, "true", String(sopen.value));
    await wait(4500);
    const settings = await scan(h, "设置面板", probes);
    await h.shot("f69-settings");
    if (settings) {
      found.settings = settings;
      scalars.settings = settings.标量读数;
      if (settings.坏值指纹.length) flow.record("设置面板 坏值指纹", settings.坏值指纹.slice(0, 8).map((x) => `[${x.token}] ${x.上下文}`).join(" ⏎ ").slice(0, 600));
    }
    await h.evaluate(`const b=[...document.querySelectorAll("button,[aria-label],[class*=close]")].find(x=>/关闭|取消/.test((x.getAttribute("aria-label")||"")+(x.textContent||"")+(x.className||"")));if(b)b.click();return !!b;`);
    await wait(1500);

    // ---------- 4) 判定 A：坏值指纹（命中项复现一次） ----------
    flow.section("S5 判定 A · 坏值指纹（命中项逐条复现）");
    const allHits = [];
    // 自文排除：播种内容里本来就写着 "due=null / 皆 null"，那不是渲染产物（本流程实测踩过：
    // 卡片浏览的两处 "null" 命中全部来自正对照卡自己的题面文字）。
    const SEEDED = ["due=null", "皆 null", "null 且 stability"];
    for (const [k, j] of Object.entries(found))
      for (const x of j.坏值指纹 || []) {
        if (x.token === "null" && SEEDED.some((s) => x.上下文.includes(s))) {
          flow.record(`自文排除（题面里就写着 null，非渲染产物）`, `[${k}] ${x.上下文}`.slice(0, 120));
          continue;
        }
        allHits.push({ 屏: k, ...x });
      }
    const byToken = {};
    for (const x of allHits) (byToken[x.token] = byToken[x.token] || []).push(`${x.屏}`);
    flow.record("坏值指纹命中分布", Object.keys(byToken).length ? Object.entries(byToken).map(([t, v]) => `${t}×${v.length}(${[...new Set(v)].join("/")})`).join(" · ") : "零命中");
    flow.check("界面上不出现 NaN/Infinity/undefined/[object Object]/null/科学计数法", allHits.length === 0, "0 处", allHits.slice(0, 8).map((x) => `[${x.屏}] ${x.token} → ${x.上下文}`).join(" ⏎ ").slice(0, 900));

    flow.section("S5b 命中项复现（第二遍独立取值）");
    let repro = 0;
    let total = 0;
    for (const [label, key] of SCREENS) {
      const j = found[key];
      if (!j || !j.坏值指纹.length) continue;
      await h.evaluate(clickText(".nav-item", label));
      await wait(key === "stats" ? 5000 : 3500);
      const again = await scan(h, label + "·复现", probes);
      const second = new Set((again?.坏值指纹 || []).map((x) => x.token + "|" + x.上下文));
      for (const f of j.坏值指纹) {
        total++;
        if (second.has(f.token + "|" + f.上下文)) repro++;
        else flow.record(`复现失败 ${label}`, `${f.token} ${f.上下文}`.slice(0, 140));
      }
    }
    if (total) flow.check("命中的坏值指纹第二遍仍在（可复现，不是抖读）", repro === total, `${total}/${total}`, `${repro}/${total}`);

    // ---------- 5) 判定 B：同一个量的两处读数 ----------
    flow.section("S6 判定 B · 同一个量在两处是否一致");
    const truth = man.dbTruth;
    flow.record("库侧真值参照", `今日到期(kpi) ${truth.kpi?.dueToday} · 队列实发 ${truth.queueCards} · 全部卡 ${truth.listAll} · 连续 ${truth.kpi?.streak} 天 · 暂缓 ${truth.queueDeferred} · 损坏 ${truth.queueDamaged} · 分钟 ${truth.kpi?.minutesToday}`);
    flow.check("库侧自洽：kpi 今日到期 应等于队列实发数", truth.kpi?.dueToday === truth.queueCards, `kpi=${truth.queueCards}`, `kpi=${truth.kpi?.dueToday} vs 队列=${truth.queueCards}（差 ${Number(truth.kpi?.dueToday) - Number(truth.queueCards)}）`);
    const grab = (label) => {
      const o = {};
      for (const [screen, sc] of Object.entries(scalars)) if (sc && sc[label]) o[screen] = sc[label].读数;
      return o;
    };
    compare("今日到期", { ...grab("今日到期"), 库侧kpi: String(truth.kpi?.dueToday), 库侧队列: String(truth.queueCards) });
    // 标签撞词自限（实测踩过）：日记正文里播种者自己写了「连续 399 天」；卡片浏览的「全部卡片」是页签
    // 而不是计数器（CardBrowser.tsx:190）；书架页脚「N 本」与队列「N 本」不是同一个量。
    // 这些都只记录、不判定；判定只走界面**真计数器**（卡片浏览的「共 N 张」CardBrowser.tsx:185）。
    const grabNoProse = (label) => {
      const o = grab(label);
      delete o.journal;
      return o;
    };
    compare("连续", { ...grabNoProse("连续"), 库侧: String(truth.kpi?.streak) });
    flow.record("（不判定）连续·含日记正文", JSON.stringify(grab("连续")));
    compare("待复习", { ...grabNoProse("待复习"), 库侧: String(truth.kpi?.pendingToday) });
    compare("逾期", grabNoProse("逾期"));
    compare("暂缓", { ...grabNoProse("暂缓"), 库侧: String(truth.queueDeferred) });
    compare("共（卡片浏览计数器）", { ...grabNoProse("共"), 库侧: String(truth.listAll) });
    flow.record("（不判定）标签撞词读数", JSON.stringify({ 卡片: grab("卡片"), 本: grab("本"), 全部卡片: grab("全部卡片"), 总计: grab("总计") }));

    // ---------- 6) 判定 C：百分比取整口径 ----------
    flow.section("S7 判定 C · 百分比取整口径（0.4 / 0.5 / 99.6 / 100 四档）");
    for (const [, v] of Object.entries(man.ratios || {})) {
      const r = typeof v.ratio === "number" ? v.ratio : null;
      if (r === null) {
        flow.record("口径分家", `${v.renderedLabel}：progress_json 里是 ${JSON.stringify(v.ratio)}（非数字）→ 渲染侧应给 0%`);
        continue;
      }
      const x = r * 100;
      flow.record("口径分家", `${v.renderedLabel}: round=${Math.round(x)} toFixed0=${Number(x).toFixed(0)} trunc=${Math.trunc(x)} toFixed1=${Number(x).toFixed(1)}`);
    }
    const pctSeen = {};
    for (const [screen, j] of Object.entries(found)) for (const p of j.百分比 || []) (pctSeen[p.值] = pctSeen[p.值] || []).push(screen);
    flow.record("界面上出现过的百分比值", Object.keys(pctSeen).sort((a, b) => Number(a) - Number(b)).slice(0, 40).join(" "));
    for (const [k, v] of Object.entries(pctSeen)) flow.record(`百分比 ${k}% 出现在`, [...new Set(v)].join(","));
    const oddPcts = Object.keys(pctSeen).filter((k) => /NaN|Infinity/.test(k) || Number(k) < 0 || Number(k) > 100);
    flow.check("界面上不出现负数/超过 100%/NaN 的百分比", oddPcts.length === 0, "0 个", oddPcts.map((k) => `${k}%→${[...new Set(pctSeen[k])].join(",")}`).join(" · ") || "无");

    // ---------- 7) 判定 D：长标题截断一致性 + 全文可达性 ----------
    flow.section("S8 判定 D · 长标题截断一致性与全文可达性");
    const spots = {};
    for (const [screen, j] of Object.entries(found)) for (const s of j.书名落点 || []) (spots[s.取样] = spots[s.取样] || []).push({ 屏: screen, ...s });
    for (const [key, list] of Object.entries(spots)) {
      flow.record(`落点 ${key}`, list.slice(0, 7).map((x) => `${x.屏}/${x.类 || x.标签}[${x.标签}] 渲染${x.渲染单元}单元·${x.渲染码点}码点(全${x.全码点}) 裁切${x.裁切 ? "是" : "否"} 省略号${x.省略号 ? "有" : "无"} title${x.title属性}字 可见${x.可见宽}/内容${x.内容宽}`).join(" ⏎ ").slice(0, 900));
    }
    const l200 = spots["t200"] || [];
    if (l200.length >= 2) {
      const lens = [...new Set(l200.map((x) => x.渲染码点))];
      flow.record("200 字书名各处渲染码点数", `${lens.length} 种取值：${lens.join(" / ")}（覆盖 ${l200.length} 处：${l200.map((x) => x.屏 + "/" + (x.类 || x.标签)).join(", ")}）`);
      flow.check("同一条长标题在各处截到同一长度（或都保留全文）", lens.length <= 1, "≤1 种长度", lens.join(",") + " 于 " + l200.map((x) => x.屏 + "/" + (x.类 || x.标签)).join(","));
    } else {
      flow.record("200 字书名落点数", `${l200.length} 处（少于 2 处则本判定不成立，须报"驱动不到"）`);
    }
    const unreachable = l200.filter((x) => x.裁切 && x.title属性 === 0);
    flow.check("被裁切的长标题必须在 title 属性里保留全文（悬停可达）", unreachable.length === 0, "0 处不可达", unreachable.map((x) => `${x.屏}/${x.类 || x.标签}`).join(",") || "无");
    flow.record("空白标题渲染出的空图注格数", String(found.shelf ? found.shelf.空白图注格数 : "无读数"));
    const rtl = (spots["tRtl"] || [])[0];
    if (rtl) flow.record("U+202E 标题落点", JSON.stringify(rtl).slice(0, 260));

    // ---------- 8) 判定 E：正对照 B —— 界面自带防线拦不拦得住 due=null ----------
    flow.section("S9 正对照 B · due=null 的卡被界面渲染成什么");
    await h.evaluate(clickText(".nav-item", "卡片"));
    await wait(4000);
    const typed = await h.evaluate(`
      const inp=[...document.querySelectorAll("input")].find(x=>/搜索|筛选|filter|search/i.test((x.placeholder||"")+(x.type||"")+(x.getAttribute("aria-label")||"")))||document.querySelector("input");
      if(!inp) return "no-input";
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
      set.call(inp,"正对照");
      inp.dispatchEvent(new Event("input",{bubbles:true}));
      return "typed:"+String(inp.placeholder||inp.type);`);
    flow.record("卡片浏览搜索框", String(typed.value || typed.error));
    await wait(5000);
    const ctlScan = await scan(h, "正对照卡过滤后", probes);
    await h.shot("f69-positive-control");
    flow.record("正对照卡渲染出的指纹", (ctlScan?.坏值指纹 || []).slice(0, 8).map((x) => `[${x.token}] ${x.上下文}`).join(" ⏎ ") || "零命中（渲染侧值域闸门挡住，属好消息）");
    flow.record("正对照过滤后正文长度", String(ctlScan ? ctlScan.正文长度 : "无读数"));

    flow.section("S10 收尾");
    flow.record("截图清单", ["shelf", "queue", "review", "browse", "journal", "stats", "reader", "settings", "positive-control"].map((s) => `f69-${s}.png`).join(" "));
    const alive = await ev(h, `return JSON.stringify({仍活着:!!document.querySelector(".nav-item"),正文:(document.body.innerText||"").length});`, "收尾自检", 30000);
    flow.record("全程结束后界面仍活着", String(alive.value || alive.error));
  } finally {
    await shutdown(h);
  }
});
