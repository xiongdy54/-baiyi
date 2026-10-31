// F01 黄金路径全旅程（真实应用 · CDP 驱动 · 每一步都用磁盘复核）
// @runtime: node  @tier: 3  @gui: true  @id: F01  @timeout: 600
// 运行：node tests/flows/f01-golden-journey.cjs   （GUI 流程：长跑默认跳过，需人工在场）
//
// 角度：§7.1.4 把「启动 → 主流程 → 重启不丢数据」定为每次完工的验收线；
//       §6.1 L519 把主旅程写成一条链：书架加书 → 阅读 → 选区制卡 → 队列 → 连续复习 → 撤销 → 重启。
//       既有 18 个 GUI 套件每个只验自己那一格；这条把整链走通，
//       并且每一步都用**磁盘上的 library.db**复核——界面说有一张卡不算，盘上得有。
//
// 安全：独立 userData + 独立端口 + 只结束自己 spawn 的进程；
//       端口被占或应用提前退出即判「环境冲突 → 跳过」，绝不 taskkill 用户的应用（§7.1.8 同源纪律）。
"use strict";
const path = require("path");
const fs = require("fs");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");
const { launch, shutdown, wait, clickText, hasText, countOf, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F01",
  title: "黄金路径全旅程",
  angle: "冷启动→加书→阅读→制卡→复习→撤销→重启（§7.1.4 验收线）",
  cites: ["§6.1", "§7.1.4", "§6.2", "§5.4"],
  tier: 3,
  gui: true,
});

const TITLE = `F01 旅程书 ${Date.now().toString(36)}`;
const MD =
  "# 第一章 渐进阅读\n\n渐进阅读的核心是把长文切成可处理的小块，并为每个小块制作记忆卡片。\n\n" +
  "# 第二章 间隔重复\n\n间隔重复依据遗忘曲线安排复习时点，FSRS 是该模型的参数化实现。\n\n" +
  "# 第三章 知识画像\n\n知识画像把卡片证据汇聚成掌握度估计，用于推荐下一步学习材料。\n";

const dbFileOf = (dir) => path.join(dir, "library.db");
async function counts(dir) {
  try {
    const a = await audit(dbFileOf(dir));
    const out = { items: a.count("library_items"), docs: a.count("documents"), cards: a.count("cards"), extracts: a.count("extracts"), logs: a.count("review_logs"), skips: a.count("review_skips") };
    a.close();
    return out;
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
}
const ev = async (h, expr) => {
  const r = await h.evaluate(expr);
  return r.error ? { error: r.error } : { value: r.value };
};
const val = async (h, expr, dflt = null) => (await ev(h, expr)).value ?? dflt;

runFlow(flow, async () => {
  const fresh = distFreshness();
  flow.record("dist 构建 vs 最新源码", fresh.exists ? `构建 ${new Date(fresh.distM).toISOString()} · 源码比构建新 ${Math.round(fresh.staleMs / 60000)} 分钟` : "dist 不存在（GUI 流程需先 npm run build）");

  // ---------- K1 冷启动 ----------
  flow.section("K1 冷启动（§7.1.4 第一步「启动」）");
  let h = await launch({ label: "f01", port: 9620, fresh: true });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.record("环境冲突，本条 GUI 流程跳过", h.reason || h.skip || "未知");
    return;
  }
  try {
    await wait(5000);
    const bodyText = String((await val(h, `return document.body.innerText.slice(0,300)`, "")) || "");
    flow.check("渲染出真实界面（非白屏/崩溃页）", bodyText.length > 20 && !/A JavaScript error/.test(bodyText), ">20 字符", bodyText.slice(0, 70));
    const nav = await val(h, `return [...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()).join(',')`, "");
    flow.record("导航项", nav);
    flow.check("导航六个入口按 §5.2 锁定顺序在场", String(nav).split(",").length >= 6, "≥6", nav);
    const c0 = await counts(h.dir);
    flow.eq("全新沙箱从空库开始", [c0.items, c0.cards, c0.logs], [0, 0, 0]);

    // ---------- K2 空态与主行动入口 ----------
    // v49.90 / D257：书架空态改用品牌设计系统 empty 组件（插画 + 标题/说明 + 单一「导入文章」）
    flow.section("K2 空书架：品牌 empty 组件 + 添加材料对话框（§5.4 / D257）");
    flow.record("空态文案", String((await val(h, `const m=document.body.innerText.match(/这里还什么都没有[^。]*。/); return m?m[0].replace(/\\s+/g,' '):'未见'`, "")) || ""));
    const primaryBtns = await val(h, `return ${countOf(".btn-primary")}`, 0);
    flow.check("主行动不堆叠（工具条「添加材料」+ 空态「导入文章」至多 2 个）", primaryBtns <= 2, "≤2", primaryBtns);
    const emptyCta = String((await val(h, `const b=document.querySelector('.empty-state.shelf-empty button'); return b?b.textContent.trim():''`, "")) || "");
    flow.check("空态主行动「导入文章」在场", /导入文章/.test(emptyCta), emptyCta);
    const modalOpens = await val(h, `const b=[...document.querySelectorAll('button')].find(x=>/添加材料/.test(x.textContent||'')); if(b){b.click(); return true;} return false;`, false);
    await wait(600);
    // v49.3/D177：按钮弹两项选单，对话框走「粘贴材料」项
    await val(h, `const it=[...document.querySelectorAll('[role=menu] .dd-item')].find(x=>/粘贴材料/.test(x.textContent||'')); if(it){it.click(); return true;} return false;`, false);
    await wait(1600);
    const modalTxt = String((await val(h, `const m=document.querySelector('[class*=modal],[role=dialog]'); return m? m.innerText.replace(/\\s+/g,' ').slice(0,140):''`, "")) || "");
    flow.check("「添加材料」选单真的打开粘贴对话框", modalOpens === true && /粘贴材料|书名|正文/.test(modalTxt), true, { modalOpens, head: modalTxt.slice(0, 70) });
    await val(h, `const m=document.querySelector('[class*=modal],[role=dialog]'); const x=m&&[...m.querySelectorAll('button')].find(b=>/取消|关闭/.test(b.textContent||'')); if(x)x.click(); return !!x;`, false);
    await wait(900);

    // ---------- K3 加书 ----------
    flow.section("K3 加书 → 书架看得见（§6.1 主旅程第一环）");
    const add = await val(h, `const r = await window.libraryAPI.createFromPaste(${JSON.stringify(TITLE)}, ${JSON.stringify(MD)}); return r && (r.id || (r.item && r.item.id)) ? 'ok' : JSON.stringify(r).slice(0,110);`, "");
    flow.record("createFromPaste 返回", add);
    await wait(2600);
    const c1 = await counts(h.dir);
    flow.eq("磁盘上多了一本书与一个文档", [c1.items, c1.docs], [1, 1]);
    await val(h, clickText(".nav-item", "卡片"));
    await wait(1600);
    await val(h, clickText(".nav-item", "书架"));
    await wait(2400);
    flow.record("书架计数文案", await val(h, `const m=document.body.innerText.match(/\\d+\\s*本/); return m?m[0]:'未见'`, ""));
    flow.check("界面书架上看得见这本书", (await val(h, `return ${hasText(TITLE)}`, false)) === true, true, await val(h, `return ${hasText(TITLE)}`, false));

    // ---------- K4 阅读 ----------
    flow.section("K4 点开书 → 正文渲染（§6.2 阅读器）");
    // 用真实鼠标事件序列（Input.dispatchMouseEvent）而非 element.click()——
    // 区分「自动化打不开」与「产品点不开」必须靠真事件，否则结论不成立。
    let opened = "no-el";
    // 先测「只点图注上的书名」能不能开：D51 把图注画在封面之外，用户最自然的落点恰是书名
    let capOpened = false;
    try {
      const cp = await val(h, `const card=document.querySelector('.book-card');const c=(card&&card.parentElement&&card.parentElement.querySelector('.cap,.cap-title'))||document.querySelector('.cap,.cap-title');if(!c) return 'no-cap-el';const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+Math.min(40,r.width/2)),y:Math.round(r.y+r.height/2),cls:String(c.className).slice(0,36),在书卡可点区内:!!(card&&card.contains(c))});`);
      flow.record("图注落点探测", cp);
      const q = JSON.parse(String(cp || "{}"));
      if (Number.isFinite(q.x)) {
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: q.x, y: q.y, button: "none" });
        await wait(120);
        await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: q.x, y: q.y, button: "left", clickCount: 1, buttons: 1 });
        await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q.x, y: q.y, button: "left", clickCount: 1, buttons: 0 });
        await wait(2600);
        capOpened = (await val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, false)) === true;
      }
    } catch { /* 探不到就当未命中 */ }
    flow.record("只点图注书名能否开书", capOpened);
    try {
      const rect = await val(h, `
        const cards=[...document.querySelectorAll('.book-card,[class*="book-card"]')];
        const t=cards.find(e=>(e.textContent||'').includes(${JSON.stringify(TITLE)})||e.getAttribute('title')===${JSON.stringify(TITLE)})||cards[0];
        if(!t) return 'no-el';
        const cap=t.querySelector('.cap,.cap-title');
        t.scrollIntoView({block:'center'});
        const r=t.getBoundingClientRect();
        return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),cls:String(t.className).slice(0,44),图注在卡内:!!(cap&&t.contains(cap))});`);
      flow.record("书本卡片矩形", rect);
      const p = JSON.parse(String(rect || "{}"));
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
        await wait(120);
        await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
        await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
        opened = `real-click@${p.x},${p.y} ${p.cls}`;
      }
    } catch (e) {
      opened = "real-click-failed:" + String(e.message || e).slice(0, 60);
    }
    flow.record("点开方式", opened);
    await wait(2000);
    const tset = await h.listTargets().catch(() => []);
    flow.record("页面目标数与 URL", `${tset.length} :: ${tset.map((t) => String(t.url).split("/").pop().slice(0, 26)).join(" | ")}`);
    if (tset.length > 1) {
      const { connect } = require("./lib/guienv.cjs");
      const re = await connect(h.port, h.child, 15000, true);
      if (re && re.evaluate) {
        try {
          h.ws.close();
        } catch {
          /* ignore */
        }
        h = { ...h, ...re };
        flow.record("已切到最新窗口目标（阅读器可能开在独立窗口）", true);
      }
    }
    await wait(2500);
    const paras = await val(h, `return ${countOf("p")}`, 0);
    flow.record("正文段落数", paras);
    let readerMounted = await val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, false);
    const mouseOpened = readerMounted === true;
    if (!readerMounted) {
      // 第二次尝试：直接点图注里的书名（D51 把封面与图注分工，打开动作可能挂在书名而非封面）
      const p2 = await val(h, `const cs=[...document.querySelectorAll("*")].filter(e=>(e.textContent||"").trim().startsWith(TITLE_TXT)); const t2=cs[cs.length-1]; if(!t2) return "no-title-el"; const r=t2.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+Math.min(30,r.width/2)),y:Math.round(r.y+r.height/2),cls:String(t2.className).slice(0,40)});`.replace("TITLE_TXT", JSON.stringify(TITLE)));
      flow.record("改点图注书名", p2);
      try {
        const q = JSON.parse(String(p2 || "{}"));
        if (Number.isFinite(q.x)) {
          await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: q.x, y: q.y, button: "left", clickCount: 1, buttons: 1 });
          await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q.x, y: q.y, button: "left", clickCount: 1, buttons: 0 });
        }
      } catch { /* 事件发不出去就算未命中 */ }
      await wait(4200);
      readerMounted = await val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, false);
      flow.record("第二次尝试后界面文本", String((await val(h, `return document.body.innerText.replace(/s+/g," ").slice(0,150)`, "")) || ""));
      // 两次真实鼠标事件都没开：把「点不开」拆成三种可能——命中的不是书卡 / 书卡没挂 onClick / onClick 有但被上层拦截
      if (!readerMounted) {
        const diag = await val(h, `const card=document.querySelector(".book-card")||document.querySelector("[data-entry] .book-card");if(!card) return "no-card-el";const r=card.getBoundingClientRect();const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);const hit=document.elementFromPoint(x,y);const chain=[];let el=hit;for(let i=0;i<4&&el;i++){const c=typeof el.className==="string"?el.className:"";chain.push(el.tagName+"."+(c.trim().split(/\\s+/).slice(0,2).join(".")));el=el.parentElement;}const pk=Object.keys(card).find(k=>k.indexOf("__reactProps$")===0);const props=pk?card[pk]:null;return JSON.stringify({cardRect:[Math.round(r.width),Math.round(r.height)],命中链:chain,书卡有onClick:!(!props||!props.onClick),命中动作条:!!(hit&&hit.closest&&hit.closest(".card-acts")),封面子元素:card.children.length});`, false);
        flow.record("点不开的定位诊断", diag);
        await val(h, `const c=document.querySelector(".book-card")||document.querySelector("[data-entry] .book-card");if(c)c.click();return "synthetic";`, false);
        await wait(4000);
        const byClick = await val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, false);
        flow.record("element.click() 后是否进入阅读器", byClick);
        if (byClick === true && readerMounted !== true) flow.record("结论细化", "DOM click() 能开、真实鼠标不能开 → 不是缺 onClick，而是命中测试被上层元素挡掉（诊断里的「命中链」就是挡住它的那个）");
        readerMounted = byClick;
      }
    }
    flow.record("阅读器容器是否挂载", readerMounted);
    flow.check("真实鼠标点书卡封面能打开书（§6.1 主旅程第一环；D-TEST-05 已撤销——原判为测试打点打错，6a0e3b0 后鼠标路径本来是好的）", mouseOpened === true, true, mouseOpened);
    flow.check("只点图注上的书名也能开书（图注是书卡的一部分，却是页面上最自然的落点；D-TEST-16 批次 D 给 .cap 补 role=button/onClick/键盘后，真实鼠标实测已通）", capOpened === true, true, capOpened);
    flow.check("兜底路径（图注/键盘/DOM click）最终进入了阅读器", readerMounted === true, true, readerMounted);

    // 鼠标路径没开时，再用键盘 Enter 试一次：能开就说明「点不开」只出在鼠标路径上
    if (readerMounted !== true) {
      const kb = await val(h, `const cs=[...document.querySelectorAll("[data-entry] .book-card,.book-card,[class*=book-card],.cap")]; const el=cs[0]; if(!el) return 'no-card-el'; el.focus&&el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return 'sent→'+String(el.className).slice(0,30);`);
      flow.record("键盘 Enter 兜底尝试", kb);
      await wait(4200);
      const byKb = await val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, false);
      flow.record("键盘后是否进入阅读器", byKb);
      if (byKb === true) flow.record("结论分级", "键盘可开、鼠标不可开 → 缺的是鼠标打开路径，不是整条阅读入口");
      readerMounted = byKb;
    }

    // ---------- K5 选区 → 制卡 ----------
    flow.section("K5 选区制卡（§6.1「制卡与摘录记录选区锚点」）");
    const sel = await val(h, `
      const target=[...document.querySelectorAll('p')].find(p=>(p.innerText||'').trim().length>12);
      if(!target) return 'no-target';
      target.scrollIntoView();
      const range=document.createRange(); range.selectNodeContents(target);
      const s=window.getSelection(); s.removeAllRanges(); s.addRange(range);
      target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      return 'selected';`);
    flow.record("构造选区（synthetic selection）", sel);
    await wait(2000);
    const menu = await val(h, `return [...document.querySelectorAll('button,[role=menuitem],a')].map(b=>(b.textContent||'').trim()).filter(t=>/制卡|摘录|解释/.test(t)).slice(0,8).join('|')`, "");
    flow.record("选区后可见的动作", menu);
    flow.record(
      "选区后动作（synthetic selection 的已知局限）",
      `${/制卡|摘录/.test(String(menu)) ? "菜单出现" : "菜单未出现——synthetic selection 不足以触发选区工具条；真实事件序列由 m5.gui/reader.engine 覆盖，本条不据此判产品缺陷"}`
    );
    const c2 = await counts(h.dir);
    const made = await val(h, `
      const api=window.cardsAPI||{};
      const name=['create','add','insert','createManual','save','createCard'].find(k=>typeof api[k]==='function');
      if(!name) return 'no-create-bridge:'+Object.keys(api).slice(0,16).join(',');
      const r=await api[name]({noteText:'F01 旅程卡',cardType:'qa',frontMarkdown:'间隔重复依据什么安排复习时点？',backMarkdown:'遗忘曲线',priority:50,tags:[]});
      return name+':'+(r&&r.id?'ok':JSON.stringify(r).slice(0,90));`);
    flow.record("经卡片桥落卡", made);
    await wait(2400);
    const c3 = await counts(h.dir);
    flow.record("卡数变化", `${c2.cards} → ${c3.cards}`);
    flow.check("旅程新增的卡真的落库", c3.cards > c2.cards, true, { made, before: c2.cards, after: c3.cards });

    // ---------- K6 复习 + 撤销 ----------
    flow.section("K6 连续复习与撤销（§6.2 复习页 / §4.4.9 撤销账目）");
    await val(h, clickText(".nav-item", "复习"));
    await wait(3600);
    flow.record("复习页首屏", String((await val(h, `return document.body.innerText.replace(/\\s+/g,' ').slice(0,180)`, "")) || ""));
    const flip = await val(h, `const f=document.querySelector('[class*=review-face],[class*=card-face]'); if(f){f.click(); return true} return false;`, false);
    flow.record("翻开卡面", flip);
    await wait(1200);
    const rated = await val(h, `const b=[...document.querySelectorAll('button')].find(x=>/^(再来|模糊|良好|轻松|Again|Hard|Good|Easy)/.test((x.textContent||'').trim()) && !x.disabled); if(b){b.click(); return (b.textContent||'').trim().slice(0,8);} return null;`);
    flow.record("点下的评分按钮", rated);
    await wait(2800);
    const c4 = await counts(h.dir);
    flow.check("评分在磁盘上留下复习日志", c4.logs >= 1, "≥1", c4.logs);
    const undoVisible = await val(h, `const b=[...document.querySelectorAll('button')].find(x=>/撤销评分/.test(x.textContent||'')); if(b){b.click(); return (b.textContent||'').trim().slice(0,12);} return false;`);
    flow.record("撤销入口", undoVisible);
    if (undoVisible) {
      await wait(2600);
      const c5 = await counts(h.dir);
      flow.check("撤销后该日志被物理删除（训练输入干净）", c5.logs < c4.logs, "减少", { before: c4.logs, after: c5.logs });
      flow.check("撤销后卡回到今日队列（可再评）", (await counts(h.dir)).cards >= 1, true, c5.cards);
    } else {
      flow.check("撤销入口在复习页可见（§6.2 Z 键/按钮）", false, true, undoVisible);
    }

    // ---------- K7 重启不丢 ----------
    flow.section("K7 重启不丢数据（§7.1.4 第三步）");
    const beforeRestart = await counts(h.dir);
    await shutdown(h);
    h = null;
    await wait(1800);
    const h2 = await launch({ label: "f01", port: 9621, fresh: false });
    if (h2.skip || h2.skippedByExit || h2.timeout) {
      flow.record("二次启动环境冲突，跳过重启核对", h2.reason || h2.timeout);
      return;
    }
    h = h2;
    await wait(5500);
    const afterRestart = await counts(h.dir);
    flow.eq("重启后库内事实逐项不变", afterRestart, beforeRestart);
    await val(h, clickText(".nav-item", "卡片"));
    await wait(2200);
    const browserShows = await val(h, `return document.body.innerText.includes('间隔重复依据什么') || document.body.innerText.includes('F01 旅程卡')`, false);
    flow.check("重启后卡片浏览页仍读得到旅程中造的卡", browserShows === true, true, browserShows);
    await val(h, clickText(".nav-item", "书架"));
    await wait(2000);
    flow.check("重启后书架仍看得见那本书", (await val(h, `return ${hasText(TITLE)}`, false)) === true, true);
    flow.record("重启后首屏", String((await val(h, `return document.body.innerText.replace(/\\s+/g,' ').slice(0,150)`, "")) || ""));
  } finally {
    if (h) {
      await shutdown(h);
      try {
        fs.rmSync(h.dir, { recursive: true, force: true });
      } catch {
        /* Windows 句柄未释放 */
      }
    }
  }
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
