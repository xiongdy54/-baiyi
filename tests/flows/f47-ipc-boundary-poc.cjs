// F47 真实渲染层穿 IPC 边界：视觉取证 + 盲区通道可达性 PoC
// @runtime: node  @tier: 3  @gui: true  @id: F47  @timeout: 900
// 运行：node tests/flows/f47-ipc-boundary-poc.cjs
//
// 角度：F45 查出 52 条 IPC 通道在测试代码里零引用；流程层历来直接 require electron/db.js 测功能，
//       等于**从来没穿过主进程这一层**。本条把渲染层真实暴露的 API 当对手：
//       一是每个界面截图交主会话做视觉判读（用户要求：必须用多模态视觉能力）；
//       二是把高危盲区通道在活应用里打一次，看主进程有没有校验、能不能落到不该落的地方。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F47",
  title: "渲染层穿 IPC 边界（视觉取证 + 盲区可达性）",
  angle: "主进程 handler 的参数校验与落点约束，在真实应用里实测",
  cites: ["§7.5", "§7.2", "§5.4", "§7.1.4"],
  tier: 3,
  gui: true,
});

const MD =
  "# 渐进阅读的三个约束\n\n把长文切成小块不是目的，**让每个小块都能被独立回忆**才是。下面这张表是三个约束的对照。\n\n" +
  "| 约束 | 含义 | 违约代价 |\n|---|---|---|\n| 原子性 | 一张卡只问一件事 | 复习时无法定位失败点 |\n| 可回忆 | 提示足够自足 | 靠上下文猜对，等于没测 |\n| 最小化 | 不制造图像卡 | 语义压缩失败 |\n\n" +
  "```\nfor card in queue:\n    grade = review(card)\n    schedule(card, grade)\n```\n\n" +
  "很长的一段：" +
  "间隔重复的历史可以一直追溯到艾宾浩斯，而真正把这套做法工程化的是 SuperMemo 系列与后来的 Anki，" +
  "它们共同的问题是把排期当成算法而不是把记忆当成一个可观测系统，这也是为什么 FSRS 要把复习证据重新纳回参数估计里来。".repeat(6) +
  "\n\n日本語テキスト：段階的に語彙を増やしていく読書法。\n\n# 第二章 附录\n\n短句。\n";

const canaryDir = path.join(os.tmpdir(), `f47-canary-${Date.now().toString(36)}`);
const canaryFile = path.join(canaryDir, "top-secret.txt");
const CANARY_TEXT = "F47-CANARY-CONTENT-1f9c";

function walk(dir, depth, out) {
  if (depth > 4) return out;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const full = path.join(dir, n);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, depth + 1, out);
    else out.push(full);
  }
  return out;
}

runFlow(flow, async () => {
  const fresh = distFreshness();
  flow.record("dist 相对源码陈旧", fresh.exists ? `${Math.round(fresh.staleMs / 60000)} 分钟` : "无 dist");

  fs.mkdirSync(canaryDir, { recursive: true });
  fs.writeFileSync(canaryFile, CANARY_TEXT, "utf8");

  const h = await launch({ label: "f47", port: 9760, fresh: true });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("应用能在本沙箱启动", false, "启动成功", h.reason || "skip");
    return;
  }
  try {
    await wait(6000);
    const ev = async (expr, dflt = null) => {
      const r = await h.evaluate(expr);
      return r.error ? { __error: r.error } : r.value ?? dflt;
    };

    // ---------- V1 桥面普查：渲染层到底能调到什么 ----------
    flow.section("V1 渲染层 API 面普查");
    const bridge = await ev(`
      const out={};
      for(const k of Object.keys(window)){
        if(!/API$/.test(k)) continue;
        const v=window[k]; if(!v||typeof v!=='object') continue;
        out[k]=Object.keys(v);
      }
      return JSON.stringify(out);`, "{}");
    const bridgeObj = JSON.parse(String(bridge));
    const totalMethods = Object.values(bridgeObj).reduce((a, v) => a + v.length, 0);
    flow.record("桥面对象", Object.keys(bridgeObj).map((k) => `${k}(${bridgeObj[k].length})`).join(" "));
    flow.record("渲染层可达方法总数", totalMethods);
    const findApi = (m) => Object.keys(bridgeObj).find((k) => bridgeObj[k].includes(m)) || null;
    flow.check("readFileBytes 确实挂在渲染层可达的桥上", !!findApi("readFileBytes"), "存在", findApi("readFileBytes"));

    // ---------- V2 加书 + 逐屏截图（交主会话视觉判读） ----------
    flow.section("V2 有内容状态下的逐屏截图");
    await ev(`return await window.libraryAPI.createFromPaste(${JSON.stringify("F47 视觉取证书")},${JSON.stringify(MD)}).then(r=>JSON.stringify(Object.keys(r||{})))`, "");
    await wait(3000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1200);
    const navs = await ev(`return [...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()).join('|')`, "");
    flow.record("导航项", String(navs));
    const shots = [];
    for (const label of String(navs).split("|").filter(Boolean).slice(0, 7)) {
      await ev(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(el)el.click(); return !!el;`, false);
      await wait(2600);
      const safe = label.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, "").slice(0, 10) || "screen";
      const p = await h.shot(`f47-v2-${safe}`);
      shots.push(path.basename(p));
      const txt = await ev(`return document.body.innerText.replace(/\\s+/g,' ').slice(0,60)`, "");
      flow.record(`截图 ${path.basename(p)}`, `首屏文本「${String(txt).slice(0, 30)}」`);
    }
    flow.check("每一屏都渲染出了非空内容（无白屏屏）", shots.length >= 5 && shots.length === String(navs).split("|").filter(Boolean).slice(0, 7).length, "每屏一张", shots);

    // ---------- V3 任意本地文件读（F45-A 的活体取证） ----------
    flow.section("V3 盲区通道实测：library:readFileBytes 能读到 userData 之外吗");
    const readApi = findApi("readFileBytes");
    const got = await ev(
      `return window.${readApi}.readFileBytes(${JSON.stringify(canaryFile)}).then(b=>{
         if(!b) return JSON.stringify({null:true});
         const arr=b instanceof Uint8Array?Array.from(b):Array.from(new Uint8Array(b));
         return JSON.stringify({len:arr.length,text:new TextDecoder().decode(new Uint8Array(arr)).slice(0,40)});
       }).catch(e=>'ERR:'+String(e&&e.message||e))`,
      "no-result"
    );
    const parsed = typeof got === "string" ? JSON.parse(got) : got;
    const leaked = parsed && Number(parsed.len) > 0 && String(parsed.text || "").includes(CANARY_TEXT);
    flow.record("userData 之外的 canary 读取结果", JSON.stringify(parsed));
    flow.check("主进程应拒绝 userData 之外的任意路径（§7.5 信任边界）", !leaked, "拒绝并返回 null", leaked ? "读到了 canary 全文" : "未读到");
    const sysFile = await ev(
      `return window.${readApi}.readFileBytes("C:\\\\Windows\\\\win.ini").then(b=>b?("bytes:"+ (b.length||b.byteLength)):"null").catch(e=>"ERR:"+String(e&&e.message||e))`,
      "no-result"
    );
    flow.record("读系统文件 C:\\Windows\\win.ini", JSON.stringify(sysFile));

    // ---------- V4 落点约束：assets 写入会不会逃出 assets 目录 ----------
    flow.section("V4 盲区通道实测：assets 写入的落点约束");
    const saveApi = findApi("saveImage") || findApi("saveOcclusion");
    flow.record("写入型图片通道", String(saveApi) + ":" + (saveApi ? "存在" : "桥面未暴露"));
    if (saveApi) {
      const b64 = Buffer.from("f47-traversal-probe").toString("base64");
      const r = await ev(
        `return window.${saveApi}.saveImage("..\\\\..\\\\..\\\\f47-escape\\\\owned.png", "png", ${JSON.stringify(b64)}, "image-occlusion").then(x=>JSON.stringify(x).slice(0,160)).catch(e=>'ERR:'+String(e&&e.message||e))`,
        "no-result"
      );
      flow.record("traversal ownerKey 返回值", JSON.stringify(r));
      await wait(1500);
      const escapeCandidates = [
        path.join(h.dir, "..", "..", "..", "f47-escape"),
        path.join(ROOT, "f47-escape"),
        path.join(os.tmpdir(), "f47-escape"),
      ];
      const landed = escapeCandidates.filter((p) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });
      flow.record("userData 之外的落点扫描", landed.length ? landed.join(" ") : "未发现越界文件");
      flow.check("图片写入不得逃出 userData/assets", landed.length === 0, "无越界落点", landed);
      const inside = walk(h.dir, 0, []).filter((f) => f.includes("f47-escape") || f.endsWith("owned.png"));
      flow.record("沙箱内可疑文件", inside.length ? inside.map((f) => path.relative(h.dir, f)).join(" ") : "无");
    }

    // ---------- V5 参数清洗：同一批通道喂垃圾参数 ----------
    flow.section("V5 盲区通道的参数清洗（主进程侧，不是 db 层）");
    const probes = [
      ["dict:cacheSet", findApi("cacheSet"), ["cacheSet", "p", 1, { a: 1 }]],
      ["journal:draftSave", findApi("draftSave"), ["draftSave", { nested: { deep: "x" } }]],
      ["memory:setEnabled", findApi("setEnabled"), ["setEnabled", "yes-please"]],
      ["cards:setSuspended", findApi("setSuspended"), ["setSuspended", "not-a-number", true]],
      ["library:setItemTitle", findApi("setItemTitle"), ["setItemTitle", 999999, ""]],
    ];
    for (const [label, api, args] of probes) {
      if (!api) {
        flow.record(`跳过 ${label}`, "桥面未暴露该方法");
        continue;
      }
      const expr = `return window.${api}.${args[0]}(${args.slice(1).map((a) => JSON.stringify(a)).join(",")})` +
        `.then(x=>'OK:'+JSON.stringify(x).slice(0,90)).catch(e=>'THROW:'+String(e&&e.message||e).slice(0,90))`;
      const out = await ev(expr, "no-result");
      const isErr = /^THROW|^ERR/.test(String(out));
      flow.record(`${label}(${args.slice(1).map((a) => JSON.stringify(a)).join(",")})`, String(out).slice(0, 120));
      flow.check(`${label}：垃圾参数必须被拒且界面状态不变`, isErr === true || String(out).startsWith("OK:null"), "明确拒绝或明确空值", String(out).slice(0, 60));
    }

    // ---------- V6 界面在后：这些垃圾调用有没有把界面搞坏 ----------
    flow.section("V6 垃圾调用之后的界面健康度");
    const health = await ev(
      `return JSON.stringify({body:document.body.innerText.replace(/\\s+/g,' ').length,
        hasError:/A JavaScript error|Something went wrong|无法渲染/.test(document.body.innerText),
        nav:[...document.querySelectorAll('.nav-item')].length});`,
      "{}"
    );
    flow.record("调用后界面体检", String(health));
    const hp = JSON.parse(String(health));
    flow.check("垃圾 IPC 调用不会把界面打崩", !hp.hasError && hp.body > 20, "界面仍在", hp);
    await h.shot("f47-v6-after-probes");
    flow.record("末屏截图", "f47-v6-after-probes.png");
  } finally {
    await shutdown(h);
    try {
      fs.rmSync(canaryDir, { recursive: true, force: true });
    } catch {
      /* 自己造的 canary，清不掉就留着 */
    }
  }
});
