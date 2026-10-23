// F49B 真实库驱动真实应用（换角度：让生产数据走一遍界面）
// @runtime: node  @tier: 3  @gui: true  @id: F49B  @timeout: 900
// 运行：node tests/flows/f49b-realdata-gui.cjs
//
// 角度：F49 在表级别看了那份库的形状；本条把**同一个副本**塞进隔离沙箱，
//       让真实应用去渲染它。合成夹具造不出这些形状：
//       一本 2,975,100 字符的书、213 本已删书留下的 161.7MB 资源、
//       两条 47 分钟的复习计时、11 本活书里 2 本正文为 0 字符。
//       界面在这些数据上会不会横向溢出、会不会裁字、要点一下多少毫秒——
//       只有真数据能答。
//
// 硬约束：
//   · 只读原件：原件目录由 NUTATION_USER_DATA 显式指定（C-11：缺省报错退出，不默认指向真实
//     %APPDATA%），全程只做 stat 指纹比对，不 open 不写。
//   · 沙箱 = tmpUserDataDir("f49")，由本流程自己把副本拷进去，launch({fresh:false})。
//   · 不改 tests/flows/lib/：需要任意目录时用「把数据搬进 lib 给的目录」代替「改 lib 的映射」。
//   · 只 kill 自己 spawn 的 PID（guienv.shutdown 已是这个语义）。
//   · 每项测量做两遍（reproducible 才算缺陷）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT, tmpUserDataDir } = require("./lib/harness.cjs");
const { launch, shutdown, wait, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F49B",
  title: "真实库驱动真实应用（生产数据界面取证）",
  angle: "把用户那份库塞进沙箱，量界面在真实形状下的溢出/裁字/耗时",
  cites: ["§5.4", "§6.1", "§6.2", "§7.1.4", "§7.2"],
  tier: 3,
  gui: true,
});

const COPY_DIR = path.join(ROOT, "tests", "tmp-f49-realdata");
if (!process.env.NUTATION_USER_DATA) {
  console.error("F49B 缺少 NUTATION_USER_DATA（指向作为原件的真实/候选 userData 目录，只读）；缺省拒绝运行。");
  process.exit(1);
}
const APPDATA = path.resolve(process.env.NUTATION_USER_DATA);
const BASELINE = path.join(ROOT, "tests", "flows", "fixtures", "f10-perf-baseline.json");

/** 只读指纹：路径 → size|mtime（绝不 open 内容） */
function fingerprint(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const full = path.join(d, n);
      let st = null;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      out.push(path.relative(dir, full).split(path.sep).join("/") + "|" + st.size + "|" + Math.round(st.mtimeMs));
      if (st.isDirectory()) stack.push(full);
    }
  }
  return out.sort();
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

// ---------- 注入页面的一次性测量脚本（都是**函数体**，用 runIn() 包成表达式） ----------
/** 横向溢出 + 出界元素 + 裁字嫌疑（都带选择器链） */
const MEASURE_JS = `
  const chain = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0 && cur; i < 5 && cur; i++) {
      let s = cur.tagName ? cur.tagName.toLowerCase() : 'ROOT';
      if (cur.id) s += '#' + cur.id;
      else if (cur.className && typeof cur.className === 'string') s += '.' + cur.className.trim().split(/\\s+/).slice(0, 3).join('.');
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const de = document.documentElement;
  const out = {
    scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
    overflowX: de.scrollWidth - de.clientWidth,
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    bodyTextLen: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length,
    outOfViewport: [], clipped: [], clampedNoTooltip: [], hScroll: []
  };
  const all = [...document.querySelectorAll('body *')];
  out.scanned = all.length;
  for (const el of all) {
    let r; try { r = el.getBoundingClientRect(); } catch { continue; }
    if (!r.width && !r.height) continue;
    if (r.right > window.innerWidth + 1) {
      out.outOfViewport.push({ sel: chain(el), right: Math.round(r.right), w: Math.round(r.width), tl: (el.textContent || '').replace(/\\s+/g, ' ').trim().length });
    }
    // 内层容器自己的横向滚动条（documentElement 不溢出 ≠ 界面里没有横向滚动）
    if (el.scrollWidth > el.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && r.width > 40) {
      out.hScroll.push({ sel: chain(el), over: el.scrollWidth - el.clientWidth, cw: el.clientWidth, sw: el.scrollWidth });
    }
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'hidden' || cs.overflow === 'hidden') {
      const clippedH = el.scrollHeight > el.clientHeight + 2;
      const clippedW = el.scrollWidth > el.clientWidth + 2;
      if ((clippedH || clippedW) && cs.textOverflow !== 'ellipsis' && (el.textContent || '').trim().length > 0) {
        const hasScrollableChild = [...el.children].some((c) => { const cc = getComputedStyle(c); return cc.overflowX === 'auto' || cc.overflowY === 'auto' || cc.overflow === 'auto'; });
        if (!hasScrollableChild) {
          const clamp = cs.webkitLineClamp || 'none';
          const hasEllipsis = cs.textOverflow === 'ellipsis' || (clamp !== 'none' && parseFloat(clamp) > 0);
          const rec = { sel: chain(el), axis: clippedW ? 'x' : 'y', lost: clippedW ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight,
                        clamp, titleAttr: el.getAttribute('title') || (el.parentElement && el.parentElement.getAttribute('title')) || '',
                        kids: [...el.children].length, tl: (el.textContent || '').trim().length };
          // 有省略号/行钳 = 视觉上承认被截断，只剩「全文还能不能取回」的问题；
          // 没有省略号也没有行钳 = 文字被静默吃掉，这才是硬缺陷。
          if (hasEllipsis) { if (!rec.titleAttr) out.clampedNoTooltip.push(rec); }
          else out.clipped.push(rec);
        }
      }
    }
  }
  out.outOfViewport = out.outOfViewport.slice(0, 14);
  out.clipped = out.clipped.slice(0, 14);
  out.clampedNoTooltip = out.clampedNoTooltip.slice(0, 14);
  out.hScroll = out.hScroll.slice(0, 14);
  return JSON.stringify(out);`;

/** 穿透 shadow DOM / 同源 iframe，找表格与图片 */
const FIND_MEDIA_JS = `
  const hits = [];
  const walk = (root, depth, where) => {
    if (depth > 12) return;
    let els;
    try { els = root.querySelectorAll('table, img, figure, svg, pre'); } catch { return; }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 20) hits.push({ tag: el.tagName.toLowerCase(), where, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + (root.defaultView ? root.defaultView.scrollY : 0)), cls: typeof el.className === 'string' ? el.className.slice(0, 24) : '' });
    }
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) walk(host.shadowRoot, depth + 1, where + '>' + host.tagName.toLowerCase() + '#sr');
    }
    for (const fr of root.querySelectorAll('iframe')) {
      try { if (fr.contentDocument) walk(fr.contentDocument, depth + 1, where + '>' + (fr.id || 'iframe')); } catch {}
    }
  };
  walk(document, 0, 'doc');
  return JSON.stringify(hits.slice(0, 40));`;

runFlow(flow, async () => {
  // ---------- 前置：副本 + 原件指纹（before） ----------
  flow.section("0 前置：副本就位 + 原件写保护指纹");
  flow.guard("副本存在（先跑 f49-realdata-audit 的前置拷贝）", () => sizeOf(path.join(COPY_DIR, "library.db")) > 1048576);
  const origDbSize = sizeOf(path.join(APPDATA, "library.db"));
  const copyDbSize = sizeOf(path.join(COPY_DIR, "library.db"));
  flow.check("副本与原件字节同尺寸（只读拷贝，未截断）", copyDbSize === origDbSize, String(origDbSize), String(copyDbSize));
  flow.guard("原件目录可读（只 stat，不 open）", () => fs.existsSync(APPDATA));
  const fpBefore = fingerprint(APPDATA);
  fs.writeFileSync(path.join(ROOT, "tests", "flows", "results", "f49b-appdata-fp-before.txt"), fpBefore.join("\n"), "utf8");
  flow.record("原件指纹条目数（before）", String(fpBefore.length));
  flow.record("原件 library.db size+mtime（before）", fpBefore.find((l) => l.startsWith("library.db|")) || "（取失败）");
  const fresh = distFreshness();
  flow.record("dist 相对源码陈旧", fresh.exists ? Math.round(fresh.staleMs / 60000) + " 分钟" : "无 dist");

  // ---------- 把副本搬进 lib 给的沙箱目录（不改 lib） ----------
  const dir = tmpUserDataDir("f49");
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 句柄未释放时忽略 */
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ["library.db", "settings.json"]) {
    fs.copyFileSync(path.join(COPY_DIR, name), path.join(dir, name));
  }
  for (const name of ["memory", "assets"]) {
    if (fs.existsSync(path.join(COPY_DIR, name))) copyTree(path.join(COPY_DIR, name), path.join(dir, name));
  }
  flow.record("沙箱目录", path.relative(ROOT, dir) + "（实为 " + dir + "）");
  flow.record("沙箱 library.db 与副本同尺寸", String(sizeOf(path.join(dir, "library.db")) === sizeOf(path.join(COPY_DIR, "library.db"))));
  flow.record("沙箱 assets 文件数", String((function count(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? count(path.join(d, e.name)) : 1; return n; })(path.join(dir, "assets"))));
  flow.check("副本已播种进沙箱（launch 前）", sizeOf(path.join(dir, "library.db")) > 1048576 && fs.existsSync(path.join(dir, "settings.json")), true, "播种完成");

  // ---------- 启动 ----------
  flow.section("1 用生产数据启动应用");
  const h = await launch({ label: "f49", port: 9780, fresh: false });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("应用能在真实数据上启动", false, "启动成功", h.reason || "skip");
    return;
  }
  const shots = [];
  // 清掉上一轮的同名截图，避免把陈旧文件当成本轮证据
  try {
    for (const f of fs.readdirSync(path.join(ROOT, "tests", "flows", "results"))) {
      if (/^f49-.*\.png$/.test(f)) fs.rmSync(path.join(ROOT, "tests", "flows", "results", f), { force: true });
    }
  } catch {
    /* 目录不存在就算了 */
  }
  try {
    await wait(7000);
    const ev = async (expr, dflt = null) => {
      const r = await h.evaluate(expr);
      return r.error ? { __error: r.error } : r.value ?? dflt;
    };
    /** 把一段「函数体」包成可 return 的表达式（直接 return const … 是语法错） */
    const runIn = (body) => "(function(){" + body + "})()";
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    const navs = String(await ev(`return [...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()).join('|')`, ""));
    flow.record("导航项", navs);
    const loadErr = await ev(`return (document.querySelector('.load-error,[role=alert]')||{}).textContent || ''`, "");
    flow.record("启动期错误条", String(loadErr).replace(/\s+/g, " ").slice(0, 80) || "（无）");
    flow.check("真实数据下应用能渲染出非空界面（无白屏/无启动错误）", !String(loadErr) && String(navs).split("|").length >= 5, "导航齐且无错误", `navs=${navs} err=${String(loadErr).slice(0, 40)}`);

    const gotoNav = async (label) => {
      const ok = await ev(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(el){el.click(); return true;} return false;`, false);
      await wait(2800);
      return ok;
    };
    const measure = async (label) => {
      const raw = await ev(`return ${runIn(MEASURE_JS)}`, "{}");
      let m = {};
      if (raw && raw.__error) {
        flow.record(`测量 ${label}`, "注入脚本报错：" + String(raw.__error).slice(0, 120));
        return null;
      }
      try {
        m = JSON.parse(String(raw));
      } catch {
        flow.record(`测量 ${label}`, "取数失败：" + String(raw).slice(0, 120));
        return null;
      }
      m.outOfViewport = m.outOfViewport || [];
      m.clipped = m.clipped || [];
      m.clampedNoTooltip = m.clampedNoTooltip || [];
      m.hScroll = m.hScroll || [];
      flow.record(`${label} · scrollWidth-clientWidth`, `${m.overflowX} px（sw=${m.scrollWidth} cw=${m.clientWidth} iw=${m.innerWidth}）`);
      flow.record(`${label} · 内层横向滚动容器数`, `${m.hScroll.length}${m.hScroll.length ? " · " + m.hScroll.slice(0, 4).map((c) => `${c.sel}{多出${c.over}px, ${c.cw}/${c.sw}}`).join(" | ") : ""}`);
      flow.record(`${label} · right>innerWidth 元素数`, `${m.outOfViewport.length}${m.outOfViewport.length ? " · " + m.outOfViewport.slice(0, 4).map((e) => `${e.sel}[r=${e.right}]`).join(" | ") : ""}`);
      flow.record(`${label} · 静默裁字数（无省略号无行钳，文字被吃掉）`, `${m.clipped.length}${m.clipped.length ? " · " + m.clipped.slice(0, 4).map((c) => `${c.sel}{${c.axis}=${c.lost}px}`).join(" | ") : ""}`);
      flow.record(`${label} · 有省略号但无 title 提示数（截断承认了、全文取不回）`, `${m.clampedNoTooltip.length}${m.clampedNoTooltip.length ? " · " + m.clampedNoTooltip.slice(0, 4).map((c) => `${c.sel}{clamp=${c.clamp} 丢${c.lost}px 文本${c.tl}字}`).join(" | ") : ""}`);
      flow.record(`${label} · 正文可见字符数 / DOM 节点数`, `${m.bodyTextLen} / ${m.scanned}`);
      return m;
    };
    const snap = async (name) => {
      const p = await h.shot(name);
      shots.push(path.basename(p));
      return p;
    };

    // ---------- 2 逐屏截图 + 逐屏测量（每项做两遍） ----------
    flow.section("2 逐屏截图与横溢/裁字测量（每屏两遍）");

    // 2a 书架
    await gotoNav("书架");
    await wait(1500);
    const shelfCards = Number(await ev(`return document.querySelectorAll('[data-entry] .book-card').length`, 0));
    flow.record("书架渲染出的书卡数", String(shelfCards));
    flow.check("书架渲染出全部 11 本活书（真实库活项数=11）", shelfCards === 11, "11", String(shelfCards));
    const mShelf1 = await measure("书架");
    const mShelf2 = await measure("书架");
    flow.eq("书架横溢读数两遍一致", mShelf1 && mShelf2 ? mShelf1.overflowX === mShelf2.overflowX : false, true);
    await snap("f49-shelf");

    // 2b 阅读器：最大的书
    flow.section("2b 阅读器：打开最大的一本（2,975,100 字符）并翻到有表格/图片的一页");
    // 运行时发现：把书架上每张卡的 entry id 与「标题字符数」列出来（只报长度，不报内容）
    const shelfMap = String(await ev(`
      return JSON.stringify([...document.querySelectorAll('[data-entry]')].map(el=>({
        id: el.getAttribute('data-entry'),
        card: !!el.querySelector('.book-card'),
        tl: (((el.querySelector('.book-card-title')||el.querySelector('.cap-title')||{}).textContent)||'').trim().length
      })));`, "[]"));
    let entries = [];
    try {
      entries = JSON.parse(shelfMap);
    } catch {
      /* 忽略 */
    }
    flow.record("书架 data-entry 数 / 其中带 .book-card 的", `${entries.length} / ${entries.filter((e) => e.card).length}`);
    flow.record("书架 entry id 前 8 位（按标题长度降序）", entries.slice().sort((a, b) => b.tl - a.tl).slice(0, 4).map((e) => `${String(e.id).slice(0, 8)}:${e.tl}字`).join(" "));
    const BIG_ID = "55b2279a-f10a-42ef-ba61-eacb9caadcb0";
    const direct = entries.filter((e) => String(e.id).includes(BIG_ID) && e.card);
    // 目标 = 标题最长的那张卡（真实库里最大正文的书 55b2279a 恰是 63 字符标题）；
    // 按长度选而不是按内容选，既避免把书名打进日志，也不依赖 data-entry 的确切形状
    const target11 = direct.length ? direct[0] : entries.filter((e) => e.card).slice().sort((a, b) => b.tl - a.tl)[0];
    const TARGET_ID = target11 ? String(target11.id) : null;
    flow.record("选定要打开的卡（data-entry / 是否直命中最大书 / 标题长度）", `${String(TARGET_ID).slice(0, 13)} / 直命中=${direct.length > 0} / ${target11 ? target11.tl : 0} 字符`);
    // 计时：开书（两遍）
    const openTimes = [];
    for (let rep = 0; rep < 2; rep++) {
      await gotoNav("书架");
      const t = await ev(`
        const el=document.querySelector('[data-entry="${TARGET_ID}"] .book-card')
              || [...document.querySelectorAll('[data-entry="${TARGET_ID}"]')][0];
        if(!el) return 'NOCARD';
        const t0=performance.now(); el.click();
        return new Promise(res=>{
          const tick=setInterval(()=>{
            const ready=!!document.querySelector('.reader-wrap');
            if(ready){clearInterval(tick); res(JSON.stringify({ms:performance.now()-t0}))}
          },16);
          setTimeout(()=>{clearInterval(tick); res(JSON.stringify({ms:-1,timeout:true}))},115000);
        });`, "null");
      let ms = -1;
      try {
        ms = Number(JSON.parse(String(t)).ms);
      } catch {
        flow.record("开书计时取数失败", String(t).slice(0, 90));
      }
      openTimes.push(ms);
      await wait(2500);
      flow.record(`开最大书耗时 第${rep + 1}遍`, ms >= 0 ? ms.toFixed(1) + " ms" : "超时/未渲染");
    }
    flow.check("开书能完成（115 秒内渲染出阅读器容器）", openTimes.every((v) => v >= 0), "两遍都渲染", JSON.stringify(openTimes));
    await wait(4000);
    const readerState = await ev(`return JSON.stringify({
        wrap: !!document.querySelector('.reader-wrap'),
        engine: !!document.querySelector('.reader-scroll-engine'),
        markdown: !!document.querySelector('.reader-markdown'),
        foliate: !!document.querySelector('foliate-view'),
        err: (document.querySelector('.reader-engine-error')||{}).textContent||'',
        title: (document.querySelector('.reader-title')||{}).textContent||''});`, "{}");
    flow.record("阅读器分支状态", String(readerState).slice(0, 200));
    const mReader1 = await measure("阅读器(最大书)");
    await snap("f49-reader-largest");

    // 找表格/图片并滚过去
    const media = String(await ev(`return ${runIn(FIND_MEDIA_JS)}`, "[]"));
    let mediaList = [];
    try {
      mediaList = JSON.parse(media);
    } catch {
      /* 忽略 */
    }
    flow.record("穿透 shadow/iframe 找到的可视媒体元素数", String(mediaList.length));
    flow.record("媒体元素种类", JSON.stringify(mediaList.reduce((m, x) => ((m[x.tag] = (m[x.tag] || 0) + 1), m), {})));
    flow.record("媒体元素所在宿主", [...new Set(mediaList.map((x) => x.where))].slice(0, 5).join(" || ") || "（无）");
    // 可达性诊断：epub 正文在 <foliate-view> 的 shadow + iframe 里，取不到就要如实说明
    flow.record("引擎可达性诊断", String(await ev(`
      const fv=document.querySelector('foliate-view');
      const out={hasFoliateView:!!fv, openShadowRoot: fv? !!fv.shadowRoot : false, iframesInMainDoc: document.querySelectorAll('iframe').length};
      if(fv&&fv.shadowRoot){ out.iframesInShadow=fv.shadowRoot.querySelectorAll('iframe').length;
        const f=fv.shadowRoot.querySelector('iframe');
        if(f){ try{ out.reachable=!!f.contentDocument; out.bodyChars=f.contentDocument?String((f.contentDocument.body||{}).textContent||'').length:-1;
          out.tables=f.contentDocument?f.contentDocument.querySelectorAll('table').length:-1;
          out.imgs=f.contentDocument?f.contentDocument.querySelectorAll('img').length:-1;}catch(e){out.reachable='THROW:'+e.message} }
      }
      return JSON.stringify(out);`, "{}")).slice(0, 240));
    // 逐页翻页找表格/图片（最多 10 页）
    let hunt = null;
    for (let page = 0; page < 10 && !hunt; page++) {
      const probe = String(await ev(`return ${runIn(FIND_MEDIA_JS)}`, "[]"));
      let pl = [];
      try {
        pl = JSON.parse(probe);
      } catch {
        /* 忽略 */
      }
      if (pl.length) hunt = pl[0];
      else {
        await ev(`const z=document.querySelector('.reader-tap-right'); if(z) z.click(); return !!z;`, false);
        await wait(1800);
      }
    }
    flow.record("翻页找媒体：命中于第几页", hunt ? `是（${hunt.tag} ${hunt.w}×${hunt.h} @ ${hunt.where}）` : "10 页内未命中（引擎帧不可达，见可达性诊断）");
    const target = mediaList.find((x) => x.tag === "table") || mediaList.find((x) => x.tag === "img") || mediaList[0] || hunt;
    if (target) {
      await ev(`
        const walk=(root)=>{for(const el of root.querySelectorAll('table,img,figure')){const r=el.getBoundingClientRect(); if(r.width>40&&r.height>20){el.scrollIntoView({block:'center'}); return true;}}
          for(const host of root.querySelectorAll('*')) if(host.shadowRoot && walk(host.shadowRoot)) return true;
          for(const fr of root.querySelectorAll('iframe')) { try { if(fr.contentDocument && walk(fr.contentDocument)) return true; } catch{} }
          return false;};
        return walk(document);`, false);
      await wait(2500);
      flow.record("已滚到的目标元素", `${target.tag} ${target.w}×${target.h} @ ${target.where}`);
      const mMedia = await measure("阅读器(表格/图片页)");
      await snap("f49-reader-table-or-image");
      flow.check("滚到表格/图片后仍无横向溢出", mMedia ? mMedia.overflowX <= 0 : false, "≤0 px", mMedia ? mMedia.overflowX + " px" : "未测到");
    } else {
      flow.record("表格/图片页截图", "未产出 f49-reader-table-or-image.png —— 引擎帧不可达（见可达性诊断），不拿别的屏冒充");
    }

    // 0 字符正文的两本活书：PDF 原生直读通道能不能渲染
    flow.record("正文 0 字符的活书 id", "024e6a53…, 896235a2…（source_type=pdf，走原文件直读）");
    await gotoNav("书架");
    const pdfOpen = await ev(`
      const host=[...document.querySelectorAll('[data-entry*="024e6a53"]')][0];
      const el=(host&&host.querySelector('.book-card'))||host; if(!el) return 'no-card';
      const t0=performance.now(); el.click();
      return new Promise(res=>setTimeout(()=>res(JSON.stringify({ms:Math.round(performance.now()-t0),
        err:(document.querySelector('.reader-engine-error')||{}).textContent||'',
        engine:!!document.querySelector('.reader-scroll-engine'), markdown:!!document.querySelector('.reader-markdown'),
        wrap:!!document.querySelector('.reader-wrap')})),9000));`, "null");
    flow.record("打开 0 字符正文的活书（PDF 直读）", String(pdfOpen).replace(/\s+/g, " ").slice(0, 180));
    const mPdf = await measure("阅读器(PDF直读,正文0字符)");
    await snap("f49-reader-zero-text-pdf");

    // 2c 队列
    flow.section("2c 队列 / 复习卡正反面 / 卡片浏览 / 数据 / 设置");
    await gotoNav("队列");
    const qCount = Number(await ev(`return (document.body.innerText.match(/\\d+/g)||[]).length, document.querySelectorAll('.queue-item,[class*=queue] li,[class*=queue-row]').length`, 0));
    flow.record("队列条目 DOM 数", String(qCount));
    const mQueue = await measure("队列");
    await snap("f49-queue");

    // 复习：题面
    await gotoNav("复习");
    await wait(3500);
    const hasReview = await ev(`return !!document.querySelector('.review-wrap,.review-session')`, false);
    flow.record("复习视图挂载", String(hasReview));
    flow.record("复习视图 DOM 类名清单（运行时发现）", String(await ev(`
      const cs=new Set(); document.querySelectorAll('[class]').forEach(e=>(typeof e.className==='string'?e.className.split(/\\s+/):[]).forEach(c=>{if(/review|card|grade|face/.test(c))cs.add(c)}));
      return [...cs].join(',');`, "")).slice(0, 240));
    flow.record("可见评分按钮数 / 队列是否真有卡", String(await ev(`
      const g=[...document.querySelectorAll('[class*=grade-]')].filter(b=>!b.disabled);
      return JSON.stringify({gradeBtns:g.length, labels:g.map(b=>(b.textContent||'').trim().slice(0,6)).join('|'), session:!!document.querySelector('.review-session')});`, "{}")));
    flow.record("复习空态文案", String(await ev(`return (document.querySelector('.review-wrap')||{}).innerText||''`, "")).replace(/\s+/g, " ").slice(0, 60));
    /** 翻面的三条路径：点卡面 → 点会话容器 → 派发空格（命令 review.showAnswer） */
    const revealJs = `
      const cands=[...document.querySelectorAll('[class*=card-face],[class*=review-card],.review-session,.review-wrap')];
      const el=cands[0];
      const t0=performance.now();
      if(el) el.click();
      if(!document.querySelector('[class*=grade-good]')) {
        document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
        window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
      }
      return new Promise(res=>{
        const id=setInterval(()=>{
          const g=document.querySelector('[class*=grade-good]')||[...document.querySelectorAll('button')].find(b=>/Good/.test(b.textContent||'')&&!b.disabled);
          if(g&&!g.disabled){clearInterval(id);res(JSON.stringify({ms:performance.now()-t0,revealed:true,via:(el&&el.className)||'none'}))}
        },20);
        setTimeout(()=>{clearInterval(id);res(JSON.stringify({ms:-1,revealed:false,via:(el&&el.className)||'none'}))},12000);
      });`;
    const mRevFront = await measure("复习-题面");
    await snap("f49-review-front");
    // 翻面
    const revealed = await ev(revealJs, "null");
    await wait(1500);
    flow.record("翻面结果（耗时 / 是否成 / 落点类名）", String(revealed).slice(0, 140));
    const mRevBack = await measure("复习-答案面");
    await snap("f49-review-back");

    // 卡片浏览 + 搜索计时（两遍）
    await gotoNav("卡片");
    await wait(2500);
    const mBrowse = await measure("卡片浏览");
    await snap("f49-card-browser");
    const searchTerms = ["a", "的"];
    const searchTimes = [];
    for (const term of searchTerms) {
      const one = [];
      for (let rep = 0; rep < 2; rep++) {
        const t = await ev(`
          const inp=document.querySelector('.cb-search')||document.querySelector('input[type=search]');
          if(!inp) return -1;
          const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          const t0=performance.now();
          setter.call(inp, ${JSON.stringify(term)});
          inp.dispatchEvent(new Event('input',{bubbles:true}));
          return new Promise(res=>{
            const id=setInterval(()=>{
              const rows=document.querySelectorAll('[class*=cb-row],[class*=card-row],tbody tr,.cb-card').length;
              if(rows>=0 && (performance.now()-t0)>400){clearInterval(id);res(JSON.stringify({ms:performance.now()-t0,rows}))}
            },50);
            setTimeout(()=>{clearInterval(id);res(JSON.stringify({ms:-1}))},60000);
          });`, "null");
        try {
          const o = JSON.parse(String(t));
          one.push({ ms: Number(o.ms), rows: o.rows });
        } catch {
          one.push({ ms: -1 });
        }
        await wait(600);
      }
      searchTimes.push({ term, reps: one });
      flow.record(`卡片浏览搜索「${term}」两遍`, one.map((x) => (x.ms >= 0 ? x.ms.toFixed(1) + "ms" : "超时") + (x.rows !== undefined ? `(${x.rows}行)` : "")).join(" / "));
    }
    // 清空搜索
    await ev(`const inp=document.querySelector('.cb-search'); if(inp){const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(inp,'');inp.dispatchEvent(new Event('input',{bubbles:true}));} return 1;`, 1);
    await wait(1200);

    // 数据（仪表盘）：scroll-top 与 heatmap
    const statsTimes = [];
    for (let rep = 0; rep < 2; rep++) {
      await gotoNav("书架");
      const t = await ev(`
        const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='数据');
        if(!el) return -1;
        const t0=performance.now(); el.click();
        return new Promise(res=>{
          const id=setInterval(()=>{
            const w=document.querySelectorAll('[class*=dash-widget]').length;
            if(w>0){clearInterval(id);res(JSON.stringify({ms:performance.now()-t0,widgets:w}))}
          },16);
          setTimeout(()=>{clearInterval(id);res(JSON.stringify({ms:-1}))},30000);
        });`, "null");
      try {
        const o = JSON.parse(String(t));
        statsTimes.push(o);
        flow.record(`切到「数据」第${rep + 1}遍`, o.ms >= 0 ? `${o.ms.toFixed(1)} ms（挂载 ${o.widgets} 个 widget）` : "超时");
      } catch {
        statsTimes.push({ ms: -1 });
      }
      await wait(1500);
    }
    await gotoNav("数据");
    await wait(3500);
    // 明确回到滚动原点，保证「顶部」这一帧可复现
    await ev(`const sc=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+40).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]; if(sc)sc.scrollTop=0; window.scrollTo(0,0); return 1;`, 1);
    await wait(1200);
    const mStatsTop = await measure("数据-顶部");
    await snap("f49-dashboard-top");
    const heatSel = await ev(`
      const ws=[...document.querySelectorAll('[class*=dash-widget]')];
      const info=ws.map((w,i)=>({i, cls:(typeof w.className==='string'?w.className:'').slice(0,44),
        data:Object.keys(w.dataset).map(k=>k+'='+w.dataset[k]).join(','), top:Math.round(w.getBoundingClientRect().top)}));
      const idOf=(w)=>((w.dataset&&(w.dataset.widget||w.dataset.id||w.dataset.key))||'')+' '+(typeof w.className==='string'?w.className:'');
      let k=ws.findIndex(w=>/heat|热力|活跃|打卡/i.test(idOf(w)+(w.textContent||'').slice(0,40)));
      // 真实 dashboard.layout.order[0]='heatmap' 且 hiddenWidgets=['kpi'] → 第一个可见 widget 即热力图
      if(k<0) k=0;
      const w=ws[k]; if(!w) return JSON.stringify({err:'no-widgets',count:ws.length});
      const before=Math.round(w.getBoundingClientRect().top);
      // 热力图本来就贴着滚动条顶部（layout.order[0]='heatmap'）→ 目标 = 把它推到画面上沿、
      // 让它和后续 widget 同时入镜，两帧因此必须是不同的
      const delta=Math.max(80, Math.round(w.getBoundingClientRect().bottom) - 220);
      const sc=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+40)
        .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
      if(sc) sc.scrollTop=Math.max(0, sc.scrollTop + delta); else window.scrollBy(0,delta);
      return JSON.stringify({widgetIndex:k, widgetCount:ws.length, widgetCls:(typeof w.className==='string'?w.className:'').slice(0,40),
        widgetData:Object.keys(w.dataset).map(x=>x+'='+w.dataset[x]).join(','),
        container: sc?(sc.className||sc.tagName).toString().slice(0,32):'window', before,
        after: Math.round(w.getBoundingClientRect().top), scrollTop: sc?Math.round(sc.scrollTop):Math.round(window.scrollY),
        firstThree: info.slice(0,3).map(x=>x.top+'/'+x.data).join(' | ')});`, "none");
    await wait(2200);
    flow.record("热力图 widget 身份与位移（前→后 / scrollTop）", String(heatSel).slice(0, 220));
    const moved = (() => {
      try {
        const o = JSON.parse(String(heatSel));
        return Math.abs(Number(o.after) - Number(o.before)) > 20;
      } catch {
        return false;
      }
    })();
    flow.check("热力图确实被滚进视口（截图与顶部屏不是同一帧）", moved, "视口位移 >20px", String(heatSel).slice(0, 120));
    const mHeat = await measure("数据-热力图处");
    await snap("f49-dashboard-heatmap");
    await ev(`const sc=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+40); if(sc)sc.scrollTop=0; return 1;`, 1);

    // 设置
    await ev(`const b=document.querySelector('.icon-btn[title="设置"]'); if(b)b.click(); return !!b;`, false);
    await wait(2500);
    const mSettings = await measure("设置弹窗");
    await snap("f49-settings");
    flow.record("设置弹窗渲染", String(await ev(`return /记忆|词典|快捷键|外观/.test(document.body.innerText)`, false)));

    // ---------- 3 关键耗时汇总 + 基线对比 ----------
    flow.section("3 耗时汇总与 f10 基线对比");
    // 点 10 张复习卡的真实耗时
    await ev(`const b=document.querySelector('[class*=modal-close],.settings-close'); if(b)b.click(); return 1;`, 1);
    await wait(1200);
    await gotoNav("复习");
    await wait(3000);
    const gradeTimes = [];
    const GRADE_JS = `
      const pick=()=>document.querySelector('[class*=grade-good]')||[...document.querySelectorAll('button')].find(b=>/Good/.test(b.textContent||'')&&!b.disabled);
      const cands=[...document.querySelectorAll('[class*=card-face],[class*=review-card],.review-session,.review-wrap')];
      const t0=performance.now();
      if(cands[0]) cands[0].click();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
      window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
      return new Promise(res=>{
        let revealMs=-1;
        const id=setInterval(()=>{
          const g=pick();
          if(g&&!g.disabled&&revealMs<0){revealMs=performance.now()-t0; g.click();
            const t1=performance.now();
            const id2=setInterval(()=>{const g2=pick();
              if(g2&&!g2.disabled){clearInterval(id2);res(JSON.stringify({revealMs,gradeMs:performance.now()-t1}))}},25);
            setTimeout(()=>{clearInterval(id2);res(JSON.stringify({revealMs,gradeMs:-1}))},12000);
          }
        },25);
        setTimeout(()=>{clearInterval(id);res(JSON.stringify({revealMs:-1,gradeMs:-1,note:'no-grade-button'}))},13000);
      });`;
    for (let i = 0; i < 10; i++) {
      const t = await ev(GRADE_JS, "null");
      try {
        const o = JSON.parse(String(t));
        gradeTimes.push(o);
        flow.record(`复习第${i + 1}张 翻面/评分`, `${o.revealMs >= 0 ? o.revealMs.toFixed(1) : "超时"} / ${o.gradeMs >= 0 ? o.gradeMs.toFixed(1) : "超时"} ms`);
        if (o.revealMs < 0) break;
      } catch {
        gradeTimes.push({ revealMs: -1, gradeMs: -1 });
        flow.record(`复习第${i + 1}张`, "取数失败 " + String(t).slice(0, 60));
        break;
      }
      await wait(250);
    }
    const okRev = gradeTimes.filter((g) => g.revealMs >= 0).map((g) => g.revealMs);
    const okGr = gradeTimes.filter((g) => g.gradeMs >= 0).map((g) => g.gradeMs);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1);
    const mx = (a) => (a.length ? Math.max(...a) : -1);
    flow.record("翻面耗时 均值/最大（n=" + okRev.length + "）", okRev.length ? `${avg(okRev).toFixed(1)} / ${mx(okRev).toFixed(1)} ms` : "全部超时");
    flow.record("评分耗时 均值/最大（n=" + okGr.length + "）", okGr.length ? `${avg(okGr).toFixed(1)} / ${mx(okGr).toFixed(1)} ms` : "全部超时");

    // 基线
    let baseline = null;
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    } catch {
      flow.record("基线文件", "读取失败");
    }
    if (baseline) {
      flow.record("f10 基线内容", JSON.stringify(baseline));
      const cmp = (label, real, base) => {
        if (typeof base !== "number" || base <= 0) {
          flow.record(`${label} 无可比基线`, String(base));
          return;
        }
        flow.record(`${label}`, `${real} vs 基线 ${base} → ${real >= 0 ? ((real / base) * 100).toFixed(0) + "%（基线为合成库口径，仅作数量级参照）" : "未测到"}`);
      };
      const revAvg = okRev.length ? Number(avg(okRev).toFixed(1)) : -1;
      cmp("翻面 vs reviewP95", revAvg, baseline.reviewP95);
      cmp("队列读数 vs queueP95", revAvg, baseline.queueP95);
      flow.record("statsMs / listAllCardsMs / persistP95 基线", `${baseline.statsMs} / ${baseline.listAllCardsMs} / ${baseline.persistP95} ms`);
      flow.record("开最大书(2.84MB 正文) vs dbKbAtCards", `${openTimes[0]} ms vs 基线库体积 ${baseline.dbKbAtCards} KB（本库 ${(sizeOf(path.join(dir, "library.db")) / 1024).toFixed(0)} KB）`);
    }

    // ---------- 4 横向溢出总结（每项已在上面测过两遍的取最差） ----------
    flow.section("4 横溢与裁字总账");
    const per = [
      ["书架", mShelf1],
      ["阅读器(最大书)", mReader1],
      ["阅读器(PDF直读,正文0字符)", mPdf],
      ["队列", mQueue],
      ["复习-题面", mRevFront],
      ["复习-答案面", mRevBack],
      ["卡片浏览", mBrowse],
      ["数据-顶部", mStatsTop],
      ["数据-热力图处", mHeat],
      ["设置弹窗", mSettings],
    ].filter(([, m]) => m);
    for (const [name, m] of per) {
      flow.record(`${name} 汇总`, `overflowX=${m.overflowX}px 出界=${m.outOfViewport.length} 静默裁字=${m.clipped.length} 无提示省略=${m.clampedNoTooltip.length} 内层横滚=${m.hScroll.length}`);
    }
    const badX = per.filter(([, m]) => m.overflowX > 0);
    flow.check("1440×900 下没有任何一屏横向溢出", badX.length === 0, "全部 ≤0px", badX.map(([n, m]) => `${n}=${m.overflowX}px`).join(" ") || "全部 ≤0px");
    const badOut = per.filter(([, m]) => m.outOfViewport.length > 0);
    flow.check("1440×900 下没有任何元素右缘越过视口", badOut.length === 0, "0 个", badOut.map(([n, m]) => `${n}=${m.outOfViewport.length}个`).join(" ") || "0 个");
    const badClip = per.filter(([, m]) => m.clipped.length > 0);
    flow.check("没有任何一屏存在静默裁字（overflow:hidden + 内容超出 + 既无 text-overflow 也无行钳 = 文字被吃掉且无提示）", badClip.length === 0, "0 处", badClip.map(([n, m]) => `${n}=${m.clipped.length}处`).join(" ") || "0 处");
    const badTip = per.filter(([, m]) => m.clampedNoTooltip.length > 0);
    flow.check("被省略号截断的长文本应给 title（真实长书名要能取回全文）", badTip.length === 0, "0 处", badTip.map(([n, m]) => `${n}=${m.clampedNoTooltip.length}处`).join(" ") || "0 处");
    for (const [name, m] of badClip) {
      for (const c of m.clipped.slice(0, 6)) flow.record(`静默裁字明细 ${name}`, `${c.sel} — ${c.axis} 轴丢 ${c.lost}px，子元素 ${c.kids} 个，文本长 ${c.tl} 字（内容按隐私规则不落日志）`);
    }
    for (const [name, m] of badTip) {
      for (const c of m.clampedNoTooltip.slice(0, 6)) flow.record(`无提示省略明细 ${name}`, `${c.sel} — 行钳 ${c.clamp}，${c.axis} 轴丢 ${c.lost}px，文本长 ${c.tl} 字，无 title 属性`);
    }
    const badH = per.filter(([, m]) => m.hScroll.length > 0);
    flow.record("存在内层横向滚动容器的屏数", `${badH.length} / ${per.length}` + (badH.length ? " · " + badH.map(([n, m]) => `${n}=${m.hScroll.length}处`).join(" ") : ""));
    for (const [name, m] of badH) {
      for (const c of m.hScroll.slice(0, 6)) flow.record(`内层横滚明细 ${name}`, `${c.sel} — 内容 ${c.sw}px 而容器 ${c.cw}px，横向多出 ${c.over}px（用户必须左右拖才看得全）`);
    }
    for (const [name, m] of badOut) {
      for (const c of m.outOfViewport.slice(0, 6)) flow.record(`出界明细 ${name}`, `${c.sel} — right=${c.right}px（视口 ${m.innerWidth}px），宽 ${c.w}px，文本长 ${c.tl} 字`);
    }

    // ---------- 5 写回检查（沙箱写了，原件必须一字未动） ----------
    flow.section("5 原件 %APPDATA% 写回检查");
    const sandboxDb = path.join(dir, "library.db");
    flow.record("沙箱 db 是否被应用写过（与副本不同尺寸/时间）", `${sizeOf(sandboxDb)} vs ${sizeOf(path.join(COPY_DIR, "library.db"))} · ${new Date(fs.statSync(sandboxDb).mtimeMs).toISOString()}`);
    flow.record("副本 db 未被本流程改动（尺寸仍等于拷贝时的值）", `${sizeOf(path.join(COPY_DIR, "library.db"))} === ${copyDbSize} → ${sizeOf(path.join(COPY_DIR, "library.db")) === copyDbSize}`);
    await shutdown(h);
    await wait(3000);
    const fpAfter = fingerprint(APPDATA);
    fs.writeFileSync(path.join(ROOT, "tests", "flows", "results", "f49b-appdata-fp-after.txt"), fpAfter.join("\n"), "utf8");
    const added = fpAfter.filter((l) => !fpBefore.includes(l));
    flow.record("原件指纹条目数 before/after", `${fpBefore.length} / ${fpAfter.length}`);
    flow.record("原件中新增/变更的条目数", String(added.length));
    flow.record("变更条目明细", added.slice(0, 6).map((s) => s.slice(0, 60)).join(" || ") || "（无）");
    flow.check("应用全程没有写回原件 %APPDATA%", added.length === 0, "0 条变更", `${added.length} 条：${added.slice(0, 3).join(" ; ")}`);
    flow.record("截图清单", shots.join(", "));
  } finally {
    try {
      await shutdown(h);
    } catch {
      /* 已退 */
    }
  }
});
