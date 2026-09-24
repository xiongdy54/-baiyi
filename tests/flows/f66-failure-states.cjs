// F66 逐功能故障注入：数据调用失败时用户看到什么（降级态矩阵）
// @runtime: node  @tier: 1  @gui: true  @id: F66  @timeout: 600
// 运行：node tests/flows/f66-failure-states.cjs
//
// 角度：既有流程测的是"数据对的时候界面对不对"。没有一条测**数据拿不到的时候界面说什么**。
//       而在别人的电脑上（磁盘满、词典库损坏、杀毒软件锁文件、IPC 通道抛错）失败才是常态。
//       本条把每个功能域的主读接口在运行时改造成 reject，重进该屏，量三件事：
//         ① 有没有**面向用户的**错误说明（不是白屏、不是永久转圈、不是静默显示 0）
//         ② 界面是否还能用（导航还在、别的屏还能进）
//         ③ 有没有把内部错误原文（stack / SQL 文案 / 文件路径）直接甩给用户
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F66",
  title: "逐功能故障注入降级态",
  angle: "主读接口 reject 时，界面说什么 / 还能不能用 / 有没有泄漏内部错误原文",
  cites: ["§7.1.8", "§5.4", "§7.1.3"],
  tier: 1,
  gui: true,
});

// 每个功能域：屏名 + 该屏依赖的主读接口（渲染层桥上的方法名）
const CASES = [
  { nav: "数据", api: "statsAPI", method: "getOverview", label: "仪表盘主读数" },
  { nav: "卡片", api: "cardsAPI", method: "listAll", label: "卡片浏览清单" },
  { nav: "队列", api: "workflowAPI", method: "getQueue", label: "今日队列" },
  { nav: "日记", api: "journalAPI", method: "list", label: "日记条目" },
  { nav: "书架", api: "libraryAPI", method: "list", label: "书架书目" },
];

const patchOn = (api, method) => `
  if (!window.${api} || typeof window.${api}.${method} !== 'function') { window.__f66 = 'NO-METHOD'; }
  else {
    window.__f66saved = window.__f66saved || {};
    window.__f66saved.${api} = window.__f66saved.${api} || {};
    window.__f66saved.${api}.${method} = window.${api}.${method};
    window.${api}.${method} = function () {
      return Promise.reject(new Error("Error invoking remote method '${api}:${method}': Error: ENOSPC: no space left on device, read 'C:\\\\Users\\\\x\\\\AppData\\\\library.db' at Object.openSync (node:fs:573)"));
    };
    window.__f66 = 'patched:${api}.${method}';
  }
  window.__f66;`;

const patchOff = (api, method) => `
  const s = window.__f66saved && window.__f66saved.${api};
  if (s && s.${method}) { window.${api}.${method} = s.${method}; delete s.${method}; return 'restored'; }
  return 'nothing-to-restore';`;

const readScreen = () => `
  const t = document.body.innerText || '';
  const chain = (el) => el.tagName.toLowerCase() + '.' + String(el.className || '').split(/\\s+/).filter(Boolean).slice(0,2).join('.');
  return JSON.stringify({
    文本长度: t.replace(/\\s+/g,' ').trim().length,
    导航还在: document.querySelectorAll('.nav-item').length,
    有错误提示: /失败|出错|错误|无法|加载不了|重试|出问题了/.test(t),
    有永久转圈: !!document.querySelector('[class*=loading],[class*=spinner],[class*=skeleton]'),
    泄漏堆栈: /at Object\\.|node:fs|Error invoking remote method|ENOSPC/.test(t),
    泄漏路径: /[A-Za-z]:\\\\\\\\|\\/Users\\/|AppData/.test(t),
    显示为零: /(^|[^0-9])0\\s*(本|张|条|天|%)/.test(t),
    首屏片段: t.replace(/\\s+/g,' ').trim().slice(0, 90)
  });`;

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9920, fresh: false, logName: path.join(RESULTS_DIR, "f66.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    // 先探一遍每个接口在桥上存不存在（不存在就如实记录，不假装测过）
    flow.section("P0 桥面可用性");
    const avail = [];
    for (const c of CASES) {
      const r = await h.evaluate(`return JSON.stringify({有对象:!!window.${c.api}, 有方法:!!(window.${c.api}&&typeof window.${c.api}.${c.method}==='function'), 该方法所在对象上的方法:[...(window.${c.api}?Object.keys(window.${c.api}):[])].slice(0,12)})`);
      const j = JSON.parse(String(r.value || "{}"));
      flow.record(`${c.nav} ← ${c.api}.${c.method}`, j.有方法 ? "可用" : `不可用（对象在=${j.有对象}；桥上方法有 ${JSON.stringify(j.该方法所在对象上的方法)}）`);
      if (j.有方法) avail.push(c);
    }
    flow.check("至少要能探到 2 个真实读接口，否则本条只是空跑", avail.length >= 2, "≥2", avail.map((c) => c.nav));

    flow.section("P1 逐个注入 reject，**整窗重载后再进该屏**（首载失败才是真正的降级场景）");
    // 第一版在这里"切走再切回"，结果三屏都还显示旧数据 ⇒ 数据存在全局 store 里、重挂载并不重新取数，
    // 于是"无错误提示"读到的是"根本没触发失败"，不是产品缺陷。**该版判据不成立，已改成注入后 reload**。
    const bad = [];
    for (const c of avail) {
      // 用 addScriptToEvaluateOnNewDocument 把补丁装进"下一次文档加载"，这样 reload 后应用首载就会撞到失败
      const reg = await h.send("Page.addScriptToEvaluateOnNewDocument", { source: `(function(){${patchOn(c.api, c.method)}})();` });
      await h.send("Page.reload", { ignoreCache: true });
      await wait(9000);
      const p = await h.evaluate(`return String(window.__f66 || 'no-flag');`);
      flow.record(`${c.nav} 注入后重载`, `补丁状态=${String(p.value || p.error)}`);
      await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(c.nav)}); if(el) el.click(); return 1;`);
      await wait(3600);
      const r = await h.evaluate(readScreen());
      const j = JSON.parse(String(r.value || "{}"));
      flow.record(`${c.nav} 首载失败态`, `文本 ${j.文本长度} 字 · 错误提示=${j.有错误提示} · 转圈=${j.有永久转圈} · 泄漏堆栈=${j.泄漏堆栈} · 泄漏路径=${j.泄漏路径} · 显示为零=${j.显示为零} · 导航项=${j.导航还在}`);
      flow.record(`${c.nav} 首屏`, String(j.首屏片段).slice(0, 80));
      await h.shot(`f66-fail-${c.nav}`);
      if (!j.有错误提示 || j.显示为零) bad.push({ 屏: c.nav, 无错误提示: !j.有错误提示, 静默显示零: j.显示为零 });
      // 撤掉注入脚本并 reload 回干净状态
      if (reg && reg.result && reg.result.identifier) {
        await h.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: reg.result.identifier });
      }
      await h.send("Page.reload", { ignoreCache: true });
      await wait(7000);
    }

    flow.section("P2 判定");
    flow.record("降级不合格的屏", bad.length ? JSON.stringify(bad) : "无");
    flow.check(
      "每个功能的主读接口失败时，界面必须给出面向用户的说明（不得静默显示 0 / 不得只转圈 / 不得白屏）",
      bad.length === 0,
      "0 个不合格",
      bad
    );
    // 还原之后必须完全恢复
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='数据'); if(el) el.click(); return 1;`);
    await wait(2600);
    const back = await h.evaluate(readScreen());
    const bj = JSON.parse(String(back.value || "{}"));
    flow.record("全部还原后数据屏", `文本 ${bj.文本长度} 字 · 首屏「${String(bj.首屏片段).slice(0, 40)}」`);
    flow.check("注入还原后界面必须恢复正常（故障注入不得把库或界面弄坏）", bj.文本长度 > 60 && bj.导航还在 === 6, "恢复正常", bj);
  } finally {
    await shutdown(h);
  }
});
