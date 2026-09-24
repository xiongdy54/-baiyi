// F67 逐屏 IPC 调用足迹：每个界面到底打了哪些通道（并回灌 F45 的盲区清单与 F66 的注入靶子）
// @runtime: node  @tier: 1  @gui: true  @id: F67  @timeout: 600
// 运行：node tests/flows/f67-ipc-footprint.cjs
//
// 为什么要这条：F66 想注入"某屏的主读接口失败"，结果改了 cardsAPI.listAll 之后界面照旧显示全量数据
//   ⇒ 说明**我改的根本不是那个屏的取数入口**。要修它，先得知道每个界面**实际**打了哪些通道。
// 做法：在文档加载前把两座桥（window.*API）上的**每一个方法**包一层记录器，
//   然后逐屏导航、清空记录、读回足迹。这同时给出两件新信息：
//     ① 功能 → 通道的**实测**映射（F45 是静态清单，这条是运行时真相）；
//     ② 哪些通道**没有任何界面会调用**（比 F45 的"零测试引用"更强：那是"没测到"，这是"可能根本没人调"）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F67",
  title: "逐屏 IPC 调用足迹",
  angle: "运行时实测：每个界面真的打了哪些桥方法；哪些通道没有任何界面调用",
  cites: ["§4 接口清单", "§7.5", "§7.1.3"],
  tier: 1,
  gui: true,
});

const NAV = ["书架", "队列", "复习", "卡片", "日记", "数据"];

// 装记录器：遍历所有 *API 对象，把每个函数包一层 push
const INSTRUMENT = `
(function(){
  window.__fp = [];
  window.__fpOn = true;
  var names = Object.keys(window).filter(function(k){ return /API$/.test(k) && window[k] && typeof window[k] === 'object'; });
  var wrapped = 0;
  names.forEach(function(k){
    var o = window[k];
    Object.keys(o).forEach(function(m){
      var f = o[m];
      if (typeof f !== 'function') return;
      wrapped++;
      var w = function(){
        try { if (window.__fpOn) window.__fp.push(k + '.' + m); } catch(e){}
        return f.apply(o, arguments);
      };
      try { o[m] = w; } catch(e){}
    });
  });
  window.__fpWrapped = wrapped;
  window.__fpApis = names;
  return wrapped;
})()`;

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9930, fresh: false, logName: path.join(RESULTS_DIR, "f67.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Page.enable");
    await h.send("Runtime.enable");
    // 装进"下一次文档加载"，这样 reload 之后从应用第一行代码起就有记录
    const reg = await h.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    await h.send("Page.reload", { ignoreCache: true });
    await wait(10000);

    flow.section("T0 记录器自检（正向对照：必须真的包上了方法，且调用真的被记到）");
    const meta = await h.evaluate(`return JSON.stringify({包了:window.__fpWrapped||0, 桥对象:(window.__fpApis||[]).length, 桥名:(window.__fpApis||[]).join(' ')});`);
    flow.record("装载情况", String(meta.value || meta.error));
    const probe = await h.evaluate(`
      window.__fp = [];
      var k = (window.__fpApis||[])[0];
      var m = k && Object.keys(window[k]).find(function(x){ return typeof window[k][x]==='function'; });
      if (k && m) { try { window[k][m](); } catch(e){} }
      return JSON.stringify({试调: k+'.'+m, 记到: window.__fp.slice(0,4)});`);
    flow.record("正向对照（主动调一次，看记录器记不记得）", String(probe.value || probe.error));
    const pj = JSON.parse(String(probe.value || "{}"));
    flow.check("记录器必须能记到一次主动调用（记不到 ⇒ 下面所有足迹都是假的）", Array.isArray(pj.记到) && pj.记到.length > 0, "≥1 条", pj);

    flow.section("T1 逐屏足迹");
    const perScreen = {};
    for (const nav of NAV) {
      await h.evaluate(`window.__fp = []; window.__fpOn = true; return 1;`);
      await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(nav)}); if(el) el.click(); return 1;`);
      await wait(3200);
      const r = await h.evaluate(`return JSON.stringify(window.__fp.slice(0,60));`);
      const list = JSON.parse(String(r.value || "[]"));
      const uniq = [...new Set(list)];
      perScreen[nav] = uniq;
      flow.record(`${nav}（${uniq.length} 个不同调用 / ${list.length} 次）`, uniq.slice(0, 14).join(" "));
    }

    flow.section("T2 交互后再采一次（点一下评分/搜索，看写通道是否被记到）");
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='卡片'); if(el) el.click(); return 1;`);
    await wait(2000);
    await h.evaluate(`window.__fp = []; return 1;`);
    await h.evaluate(`const i=document.querySelector('input.cb-search,[class*=search] input'); if(i){ i.value='测试'; i.dispatchEvent(new Event('input',{bubbles:true})); } return !!i;`);
    await wait(2500);
    const searchTrace = JSON.parse(String((await h.evaluate(`return JSON.stringify([...new Set(window.__fp)]);`)).value || "[]"));
    flow.record("搜索框输入的足迹", searchTrace.length ? searchTrace.join(" ") : "（无调用 ⇒ 卡片浏览搜索确实纯渲染层过滤，与 F65 结论一致）");

    flow.section("T3 回灌 F45 的静态清单：哪些桥方法没有任何界面调用过");
    const allBridge = await h.evaluate(`
      var names = window.__fpApis || Object.keys(window).filter(function(k){ return /API$/.test(k); });
      var out = {};
      names.forEach(function(k){ out[k] = Object.keys(window[k]||{}).filter(function(m){ return typeof window[k][m] === 'function'; }); });
      return JSON.stringify(out);`);
    const bridge = JSON.parse(String(allBridge.value || "{}"));
    const seen = new Set(Object.values(perScreen).flat().concat(searchTrace));
    const never = [];
    for (const [k, ms] of Object.entries(bridge)) for (const m of ms) if (!seen.has(k + "." + m)) never.push(k + "." + m);
    const total = Object.values(bridge).reduce((a, v) => a + v.length, 0);
    flow.record("桥面方法总数 / 六屏首载足迹覆盖数 / 未被任何界面调用数", `${total} / ${seen.size} / ${never.length}`);
    flow.record("未被调用的方法（前 30 个）", never.slice(0, 30).join(" "));
    fs.writeFileSync(path.join(RESULTS_DIR, "F67.footprint.json"), JSON.stringify({ perScreen, searchTrace, bridge, never, at: new Date().toISOString() }, null, 2), "utf8");
    flow.record("明细已写出", "results/F67.footprint.json");
    flow.check("六屏首载至少要覆盖桥面方法的 20%（否则说明足迹采集没生效）", seen.size >= total * 0.2, `≥${Math.ceil(total * 0.2)} 个`, { 覆盖: seen.size, 总数: total });

    flow.section("T4 撤掉记录器并确认界面恢复正常");
    if (reg && reg.result && reg.result.identifier) await h.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: reg.result.identifier });
    await h.send("Page.reload", { ignoreCache: true });
    await wait(8000);
    const ok = await h.evaluate(`return JSON.stringify({文本:(document.body.innerText||'').replace(/\\s+/g,' ').length, 导航:document.querySelectorAll('.nav-item').length, 记录器残留:typeof window.__fp});`);
    flow.record("还原后", String(ok.value || ok.error));
    flow.check("采集与还原不得把界面弄坏", JSON.parse(String(ok.value || "{}")).导航 === 6, "导航 6 项健在", ok.value);
  } finally {
    await shutdown(h);
  }
});
