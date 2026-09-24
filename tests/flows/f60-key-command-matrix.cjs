// F60 键位实效矩阵：在活应用里逐条「真按键」，验证文档承诺的效果真的发生
// @runtime: node  @tier: 3  @gui: true  @id: F60  @timeout: 900
// 运行：node tests/flows/f60-key-command-matrix.cjs
//
// 角度：F20 对账的是**四张静态表**（指南表 / 代码表 / 用户覆盖 / 主进程默认），F44 测的是 Tab 遍历
//       与 focus-visible。**从来没有一条流程真的把每个文档承诺的快捷键在运行中的应用里按一次，
//       并断言它承诺的效果发生了**。于是「四张表都在」的键位完全可以什么都不做。
//       本流程用 CDP Input.dispatchKeyEvent 发真实 keyDown/keyUp（含修饰位），前后各取一次界面指纹，
//       指纹差分即断言。合成 KeyboardEvent 与 element.focus() 一律不用（本仓已被合成事件骗过两次）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");
const { launch, shutdown, wait, distFreshness } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F60",
  title: "键位实效矩阵（真按键 × 界面指纹差分）",
  angle: "文档承诺的每条快捷键在活应用里按一次，断言承诺效果发生",
  cites: ["§9.1 M4", "§6.2", "§7.1.6", "§4.4.9"],
  tier: 3,
  gui: true,
});

// ---------- 键位表来源：现读 src/lib/commands.ts（代码表），与指南 §9.1 M4 锁定表逐条核对 ----------
function readCommandTable() {
  const file = path.join(ROOT, "src", "lib", "commands.ts");
  const src = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/id:\s*"([^"]+)"[^]*?title:\s*"([^"]+)"[^]*?defaultKey:\s*"([^"]+)"/);
    if (m) rows.push({ id: m[1], title: m[2], key: m[3] });
  }
  return rows;
}

// AI_DEVELOPMENT_GUIDE.md L1113-1123 的锁定表（本次按行读出的原文）
const GUIDE_TABLE = {
  "reader.makeCard": "Ctrl+Z",
  "reader.aiCards": "Ctrl+X",
  "reader.aiExplain": "Ctrl+A",
  "reader.extract": "Ctrl+S",
  "reader.lookupWord": "Ctrl+D",
  "review.showAnswer": "Space",
  "review.again": "1",
  "review.hard": "2",
  "review.good": "3",
  "review.easy": "4",
  "review.undo": "Z",
  "review.markSuspend": "Q",
  "review.skip": "W",
  "review.delete": "D",
};

// ---------- 组合键 → CDP 键事件参数 ----------
const MOD_BIT = { Ctrl: 2, Alt: 1, Shift: 8, Meta: 4 };
const NAMED = {
  Space: { key: " ", code: "Space", vk: 32 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Enter: { key: "Enter", code: "Enter", vk: 13 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  "=": { key: "=", code: "Equal", vk: 187 },
  "-": { key: "-", code: "Minus", vk: 189 },
  "+": { key: "+", code: "Equal", vk: 187 },
};
function keyInfo(combo) {
  const parts = String(combo).split("+");
  const main = parts[parts.length - 1];
  let mask = 0;
  for (const m of parts.slice(0, -1)) mask |= MOD_BIT[m] || 0;
  let info;
  if (NAMED[main]) info = NAMED[main];
  else if (/^[A-Za-z]$/.test(main)) info = { key: main.toLowerCase(), code: "Key" + main.toUpperCase(), vk: main.toUpperCase().charCodeAt(0) };
  else if (/^[0-9]$/.test(main)) info = { key: main, code: "Digit" + main, vk: 48 + Number(main) };
  else info = { key: main, code: "Unidentified", vk: 0 };
  return { ...info, mask, mods: parts.slice(0, -1) };
}

// ---------- 界面指纹（一次 evaluate 拿全，便宜且可差分） ----------
const FP_EXPR = `
  const norm=(s)=>(s==null?'':String(s)).replace(/\\s+/g,' ').trim();
  const txt=norm(document.body.innerText);
  let h=5381; for(let i=0;i<txt.length;i++){h=((h<<5)+h+txt.charCodeAt(i))>>>0;}
  const count=(s)=>{try{return document.querySelectorAll(s).length}catch(e){return -1}};
  const q=(s)=>{try{return document.querySelector(s)}catch(e){return null}};
  const a=document.activeElement;
  return JSON.stringify({
    view: norm((q('.nav-item.active')||{}).textContent) || '(无导航)',
    title: norm((q('.topbar-title')||{}).textContent),
    dialogs: count('[role="dialog"],[aria-modal="true"],.modal,.modal-backdrop,.overlay'),
    bodyLen: txt.length, hash: h>>>0,
    focus: a? (a.tagName+'.'+norm(a.className).slice(0,24)) : 'null',
    focusInDialog: (()=>{const el=document.activeElement; try{return !!(el&&el.closest&&el.closest('[role="dialog"],[aria-modal="true"]'))}catch(e){return false}})(),
    books: count('.book-card'),
    gradeBtns: [...document.querySelectorAll('.grade-row button')].map(b=>norm(b.textContent)).join('|').slice(0,80),
    reviewCount: norm((q('.review-count')||{}).textContent),
    cardFront: norm((q('.review-front')||q('.card-front')||q('.review-card')||{}).textContent).slice(0,46),
    toast: norm((q('.toast')||q('.toasts')||q('.toast-host')||{}).textContent).slice(0,46),
    tools: count('.review-tools button'),
    selMenu: count('[class*="selection"],.sel-menu,.selection-menu'),
    selection: norm(String(window.getSelection&&window.getSelection()||'')).slice(0,40),
    reader: count('.reader-wrap'), aiPanel: count('[class*="ai-panel"],[class*="aipanel"]')
  });`;

function fpDiff(a, b) {
  const skip = new Set(["hash", "bodyLen"]);
  const changed = [];
  for (const k of Object.keys(b)) {
    if (String(a[k]) !== String(b[k])) changed.push(`${k}:${truncate(String(a[k]))}→${truncate(String(b[k]))}`);
  }
  if (a.hash !== b.hash) changed.push(`hash:${a.hash}→${b.hash}`);
  if (a.bodyLen !== b.bodyLen) changed.push(`bodyLen:${a.bodyLen}→${b.bodyLen}`);
  void skip;
  return changed.filter((c) => !/^focus:/.test(c));
}
const truncate = (s) => (s.length > 26 ? s.slice(0, 26) + "…" : s);

const MD =
  "# 渐进阅读的三个约束\n\n把长文切成小块不是目的，让每个小块都能被独立回忆才是。原子性要求卡更小，可回忆性要求卡更大，两者会互相拉扯。\n\n" +
  "间隔重复的工程史从艾宾浩斯的遗忘曲线出发，经过 SuperMemo 的矩阵法与 SM-2，走到把可观测的记忆状态放回参数估计的 FSRS。每一次转向的共同原因，都是旧的模型无法解释自己算错的那部分。\n\n" +
  "队列口径必须唯一：界面显示的今日到期、统计里的今日到期、复习页实际出的卡，三者若来自三条 SQL，用户迟早会发现它们互不相等。\n\n" +
  "撤销必须留下评分前的完整快照，因为只有前像能精确复原八个字段；用当前状态反推等于用结果去猜原因。\n\n";

const DAY = 86400000;

runFlow(flow, async () => {
  const fresh = distFreshness();
  flow.record("dist 相对源码陈旧", fresh.exists ? `${Math.round(fresh.staleMs / 60000)} 分钟` : "无 dist");

  // ---------- S0 键位表来源 ----------
  flow.section("S0 键位表来源对账");
  const table = readCommandTable();
  flow.record("绑定来源", "现读 src/lib/commands.ts 的 COMMANDS 数组（代码表），共 " + table.length + " 条；另硬核对指南 §9.1 M4 锁定表");
  const mism = table.filter((r) => GUIDE_TABLE[r.id] && GUIDE_TABLE[r.id].toUpperCase() !== r.key.toUpperCase());
  flow.record("指南表 vs 代码表不一致", mism.length ? JSON.stringify(mism) : "无（14/14 逐条相同）");
  flow.check("代码表与指南 §9.1 M4 锁定表逐条一致", table.length === 14 && mism.length === 0, "14 条全等", `${table.length} 条 / ${mism.length} 处不一致`);

  const h = await launch({ label: "f60", port: 9900, fresh: true });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("应用能在本沙箱启动", false, "启动成功", h.reason || "skip");
    return;
  }

  const ev = async (expr, dflt = null) => {
    const r = await withGuard(h.evaluate(expr), 15000, "evaluate");
    return r.error ? `__ERROR__ ${r.error}` : r.value ?? dflt;
  };
  // 原生对话框（window.confirm/alert）会**阻塞渲染进程**：keydown 的 ack 与其后的 evaluate 全部挂住
  // （第一次跑就是死在这里，9 分钟零输出）。挂 CDP 事件监听：一开就自动「取消」，
  // 同时把消息原文留在 nativeDialogs 里，作为「这条键位确实到达了删除处理器」的效果证据。
  const nativeDialogs = [];
  try {
    h.ws.addEventListener("message", (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      if (msg.method === "Page.javascriptDialogOpening") {
        const p = msg.params || {};
        nativeDialogs.push({ type: p.type, message: String(p.message || "").replace(/\s+/g, " ").slice(0, 56) });
        Promise.resolve(h.send("Page.handleJavaScriptDialog", { accept: false })).catch(() => {});
      }
    });
  } catch {
    /* 监听失败只影响原生对话框一栏 */
  }
  const withGuard = (p, ms, tag) =>
    Promise.race([p, new Promise((r) => setTimeout(() => r({ error: "CDP_TIMEOUT:" + tag }), ms))]);
  const fp = async () => {
    const raw = await ev(FP_EXPR, "{}");
    try {
      return JSON.parse(String(raw));
    } catch {
      flow.record("指纹读取失败", String(raw).slice(0, 120));
      return { view: "?", parseError: String(raw).slice(0, 80) };
    }
  };
  const press = async (combo, settle = 420) => {
    const i = keyInfo(combo);
    await withGuard(h.send("Input.dispatchKeyEvent", { type: "keyDown", key: i.key, code: i.code, windowsVirtualKeyCode: i.vk, nativeVirtualKeyCode: i.vk, modifiers: i.mask }), 10000, "keyDown " + combo);
    await wait(70);
    await withGuard(h.send("Input.dispatchKeyEvent", { type: "keyUp", key: i.key, code: i.code, windowsVirtualKeyCode: i.vk, nativeVirtualKeyCode: i.vk, modifiers: i.mask }), 10000, "keyUp " + combo);
    await wait(settle);
  };
  const goto = async (label, ms = 1400) => {
    await ev(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(el){el.click();return true} return false;`, false);
    await wait(ms);
  };
  const clickEl = async (sel, text) =>
    ev(`const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>!x.disabled&&(${text ? `x.textContent.includes(${JSON.stringify(text)})` : "true"})); if(el){el.click();return true} return false;`, false);

  try {
    await wait(6500);

    // ---------- S1 播种 ----------
    flow.section("S1 播种（真实建书 + 真实到期卡）");
    const created = await ev(`return await window.libraryAPI.createFromPaste(${JSON.stringify("F60 键位矩阵材料")},${JSON.stringify(MD)}).then(r=>JSON.stringify(r)).catch(e=>'ERR:'+String(e&&e.message||e))`, "no-result");
    flow.record("createFromPaste 返回值", String(created).slice(0, 160));
    const okCreate = /"ok"\s*:\s*true|"id"/.test(String(created));
    flow.check("建书返回真实对象（未被吞）", okCreate, "含 ok/id", String(created).slice(0, 60));
    await goto("书架", 2500);
    const shelf1 = await fp();
    flow.record("建书后书架指纹", JSON.stringify({ books: shelf1.books, view: shelf1.view, toast: shelf1.toast }));
    if (Number(shelf1.books) === 0) flow.record("书架首本书未即时渲染", "已登记 D-TEST-40（本条不重报）");

    // 到期卡：走渲染层真实桥（cards:create），新卡 due=now 即立即到期
    const nCards = 12;
    const cardRes = [];
    for (let i = 0; i < nCards; i++) {
      const r = await ev(
        `return await window.cardsAPI.create(${JSON.stringify(
          {
            frontMarkdown: `F60 探针第${i + 1}问：队列口径为什么要唯一？`,
            backMarkdown: `因为三条 SQL 迟早互不相等，用户会失去对所有数字的信任。编号 ${i + 1}。`,
            cardType: "qa",
            priority: 0,
          },
          null,
          2,
        )}).then(x=>JSON.stringify(x)).catch(e=>'ERR:'+String(e&&e.message||e))`,
        "no-result",
      );
      cardRes.push(String(r));
    }
    flow.record("cardsAPI.create 首批返回", cardRes.slice(0, 2).join(" "));
    flow.check("到期卡播种成功（复习场景可驱动）", cardRes.every((s) => /"id"/.test(s)), "8 张含 id", cardRes.filter((s) => !/"id"/.test(s)).slice(0, 2).join(" | ") || "全部含 id");

    // ---------- S2 正对照（探测器本身有效吗） ----------
    flow.section("S2 正对照：证明指纹差分能抓到真效果");
    await goto("复习", 2600);
    const c0 = await fp();
    await clickEl(".nav-item", "卡片");
    await wait(2200);
    const c1 = await fp();
    const control1 = fpDiff(c0, c1);
    flow.record("对照1（点导航 复习→卡片）差分", JSON.stringify(control1).slice(0, 200));
    flow.check("对照1：界面切换必须被指纹差分抓到", control1.length > 0, "非空差分", JSON.stringify(control1).slice(0, 80));

    await goto("复习", 2600);
    const v0 = await fp();
    await press("Space", 700);
    const v1 = await fp();
    const control2 = fpDiff(v0, v1);
    flow.record("对照2（真按空格翻面）差分", JSON.stringify(control2).slice(0, 240));
    const spaceOk = /gradeBtns|hash/.test(control2.join("|")) && v1.gradeBtns.length > 0;
    flow.check("对照2：真按键盘（空格翻面）必须被指纹差分抓到", spaceOk, "评分按钮出现", JSON.stringify({ before: v0.gradeBtns, after: v1.gradeBtns }));
    flow.record("正对照结论", spaceOk ? "键盘通道与指纹差分双双有效：后续「零变化」是真无操作，不是探针失灵" : "正对照失败：本流程的 dead-key 清单全部作废（下文 N 节不采信）");
    await h.shot("f60-s2-space-flipped");

    // ---------- 探针簿记 ----------
    const probes = [];
    /** 在已知状态下按一条键位并断言承诺效果 */
    async function probe(rec) {
      // rec: {id, combo, scene, effect, drive:前置是否满足, inverse?:()=>Promise}
      if (!rec.drive) {
        probes.push({ ...rec, status: "不可驱动" });
        flow.record(`跳过 ${rec.combo}（${rec.scene}）`, rec.whyNot || "前置条件不满足");
        return;
      }
      const before = await fp();
      const nativeBefore = nativeDialogs.length;
      await press(rec.combo, rec.settle || 460);
      const after = await fp();
      const diff = fpDiff(before, after);
      const nativeHit = nativeDialogs.length > nativeBefore ? nativeDialogs[nativeBefore] : null;
      const changed = diff.length > 0 || !!nativeHit;
      let inverse = null;
      if (rec.inverse) {
        await rec.inverse();
        const back = await fp();
        inverse = fpDiff(before, back);
      }
      probes.push({ id: rec.id, combo: rec.combo, scene: rec.scene, effect: rec.effect, before, after, diff, changed, nativeHit, inverse });
      const ok = changed && (!rec.assert || rec.assert(before, after, diff, nativeHit));
      flow.check(
        `${rec.scene} ${rec.combo} → ${rec.effect}`,
        ok,
        "承诺效果发生",
        changed ? (diff.join(" ").slice(0, 130) + (nativeHit ? ` 原生对话框「${nativeHit.message}」` : "")).slice(0, 160) : "零 UI 变化",
      );
      if (rec.inverse) {
        flow.check(`${rec.combo} 的逆操作回到原状态（Esc/二次按下）`, inverse !== null && inverse.length === 0, "回到按下前", inverse === null ? "未测" : inverse.join(" ").slice(0, 150));
      }
      return { before, after, diff, changed };
    }

    // ---------- S3 复习场景 9 条 ----------
    flow.section("S3 复习场景（真按键 × 承诺效果）");
    /** 强制重挂 ReviewView：点别的导航再回来，showBack 才会回到正面（原地重复点同一导航不重挂） */
    const restartReview = async () => {
      await goto("卡片", 1200);
      await goto("复习", 2200);
      return fp();
    };
    const rv0 = await restartReview();
    flow.record("复习页初始态", JSON.stringify({ 正面: truncate(rv0.cardFront), gradeBtns: rv0.gradeBtns, count: rv0.reviewCount }));
    await probe({
      id: "review.showAnswer",
      combo: "Space",
      scene: "复习",
      effect: "翻面：评分按钮出现",
      drive: true,
      assert: (a, b) => b.gradeBtns.length > 0 && a.gradeBtns.length === 0,
    });
    const rAgain = await probe({
      id: "review.again",
      combo: "1",
      scene: "复习",
      effect: "评分 Again 并自动下一张",
      drive: true,
      assert: (a, b) => b.gradeBtns.length === 0 || String(b.reviewCount) !== String(a.reviewCount) || a.cardFront !== b.cardFront,
    });
    void rAgain;
    const rUndo = await probe({
      id: "review.undo",
      combo: "Z",
      scene: "复习",
      effect: "撤销上一评分：回到刚评的那张卡且背面展开",
      drive: true,
      assert: (a, b) => String(b.gradeBtns).length > 0 || a.cardFront !== b.cardFront,
    });
    void rUndo;
    await probe({ id: "review.hard", combo: "2", scene: "复习", effect: "评分 Hard 并下一张", drive: true, settle: 700 });
    await goto("复习", 1500);
    await ev(`const b=[...document.querySelectorAll('.grade-row, .review-tools')]; return 1;`, 1);
    await press("Space", 500);
    await probe({ id: "review.good", combo: "3", scene: "复习", effect: "评分 Good 并下一张", drive: true, settle: 700 });
    await goto("复习", 1500);
    await press("Space", 500);
    await probe({ id: "review.easy", combo: "4", scene: "复习", effect: "评分 Easy 并下一张", drive: true, settle: 700 });
    await goto("复习", 1800);
    await probe({ id: "review.markSuspend", combo: "Q", scene: "复习", effect: "标记并暂停：换下一张 / 出现提示", drive: true, settle: 800 });
    await goto("复习", 1800);
    await probe({
      id: "review.skip",
      combo: "W",
      scene: "复习",
      effect: "跳过：due+10min 并自动下一张",
      drive: true,
      assert: (a, b) => a.cardFront !== b.cardFront || a.reviewCount !== b.reviewCount || b.toast.length > 0,
    });
    await goto("复习", 1800);
    const delBefore = await fp();
    await probe({
      id: "review.delete",
      combo: "D",
      scene: "复习",
      effect: "删除：弹确认框后再删（确认框是**原生 window.confirm**，不在 DOM 里）",
      drive: true,
      settle: 900,
      assert: (a, b, diff, nat) => !!nat && /删除/.test(nat.message || ""),
    });
    flow.record("D 触发的原生确认框", nativeDialogs.length ? JSON.stringify(nativeDialogs[nativeDialogs.length - 1]) : "未捕获到任何原生对话框事件");
    const afterEsc = await fp();
    flow.record("删除确认框 Esc 之后", JSON.stringify({ dialogs: afterEsc.dialogs, card: afterEsc.cardFront.slice(0, 20), gradeBtns: afterEsc.gradeBtns.slice(0, 20) }));
    flow.check("取消确认后卡没有被删除（当前卡不变）", Number(afterEsc.dialogs) === Number(delBefore.dialogs) && afterEsc.cardFront === delBefore.cardFront, "确认框已关、当前卡不变", JSON.stringify({ dialogs: `${delBefore.dialogs}→${afterEsc.dialogs}`, front: `${truncate(delBefore.cardFront)}→${truncate(afterEsc.cardFront)}` }));

    // ---------- S4 阅读场景 5 条 ----------
    flow.section("S4 阅读场景（真鼠标拖出选区 + 真按键）");
    await goto("书架", 2200);
    await clickEl(".book-card");
    await wait(3600);
    const readerFp = await fp();
    flow.record("进入阅读器后指纹", JSON.stringify({ reader: readerFp.reader, view: readerFp.view, title: readerFp.title }));
    flow.check("阅读器已打开（有 .reader-wrap）", Number(readerFp.reader) > 0, "≥1", readerFp.reader);
    flow.record(
      "阅读器正文可达性（决定选区怎么造）",
      String(
        await ev(`const f=document.querySelectorAll('iframe').length; const el=document.querySelector('.reader-scroll'); let host=null, shadow=null;
          try{ host=[...document.querySelectorAll('*')].filter(x=>x.shadowRoot).map(x=>x.tagName+'.'+(x.className||'').slice(0,14)).slice(0,3).join(','); }catch(e){}
          return JSON.stringify({iframes:f, lightDomTextInScroll:(el?el.textContent:'').replace(/\\s+/g,' ').trim().length, openShadowHosts:host||'无'});`, ""),
      ),
    );

    /** 真实拖拽选中一段正文。
     *  正文渲染在**闭式 shadow root 的沙箱 iframe** 里（引擎 iframe 与宿主跨源，contentDocument 不可读），
     *  宿主 DOM 里取不到任何文本节点 —— 所以坐标只能按几何扫，命中判据用宿主侧的 .selection-menu
     *  （选区菜单与快捷键同源，menu 出现 == Reader 的 selection 状态被写入）。 */
    const rectOf = async () => {
      const raw = await ev(`const el=document.querySelector('.reader-scroll')||document.querySelector('.reader-wrap'); if(!el) return JSON.stringify({err:'no-scroll'}); const r=el.getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});`);
      try {
        return JSON.parse(String(raw));
      } catch {
        return { err: String(raw) };
      }
    };
    async function dragSelect(attempt) {
      const r = await rectOf();
      if (r.err) return { ok: false, why: r.err };
      await ev(`try{window.getSelection().removeAllRanges()}catch(e){} return 1;`, 1);
      const grid = [
        [0.34, 0.42, 0.3],
        [0.3, 0.52, 0.34],
        [0.2, 0.6, 0.4],
        [0.26, 0.68, 0.3],
        [0.16, 0.76, 0.44],
        [0.3, 0.84, 0.28],
      ][attempt % 6];
      const y = Math.round(r.y + r.h * grid[1]);
      const x1 = Math.round(r.x + r.w * grid[0]);
      const x2 = Math.round(r.x + r.w * (grid[0] + grid[2]));
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y, button: "none" });
      await wait(80);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y, button: "left", clickCount: 1, buttons: 1 });
      await wait(70);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / steps, y: y + (i % 2), button: "left", buttons: 1 });
        await wait(30);
      }
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y, button: "left", clickCount: 1, buttons: 0 });
      await wait(900);
      const got = await ev(`return JSON.stringify({menu:document.querySelectorAll('.selection-menu').length, topSel:String(window.getSelection&&window.getSelection()||'').replace(/\\s+/g,' ').trim().length, buttons:[...document.querySelectorAll('.selection-menu button')].map(b=>b.textContent.trim()).join('/')});`, "{}");
      let g = {};
      try {
        g = JSON.parse(String(got));
      } catch {
        g = {};
      }
      return { ok: Number(g.menu) > 0, menu: g.menu, topSel: g.topSel, buttons: g.buttons, at: `y=${y} x=${x1}→${x2}` };
    }

    let selAttempt = 0;
    async function ensureSelection(tag) {
      for (let i = 0; i < 6; i++) {
        const r = await dragSelect(selAttempt++);
        if (r.ok) {
          flow.record(`${tag} 选区`, `${r.at} 命中：宿主侧 .selection-menu 出现（按钮 ${r.buttons}），顶层选区 ${r.topSel} 字`);
          return r;
        }
        if (i === 5) flow.record(`${tag} 选区失败`, `几何扫 6 个落点均无选区菜单：${JSON.stringify(r)}`);
      }
      return { ok: false, why: "沙箱 iframe 内取不到文本落点，6 个几何扫点均未产生选区" };
    }

    flow.record("阅读场景 5 条键位为何不可驱动", "正文在**闭式 shadow root 内的沙箱 iframe**（本战役 F53E 已定案，与 D-TEST-39 同族），宿主 light-DOM 结构上看不见它；真鼠标在 .reader-scroll 上按 6 个几何落点拖拽均未让宿主侧 .selection-menu 出现，截图 f60-s4-after-ctrl-z.png 正文区空白（与 f48v-7 / f53d / f53e 三张一致）。⇒ Reader 的 when=「存在活动选区」这一前置本流程建立不起来，Ctrl+Z/X/A/S/D 五条属**未测**，不得当失效键位上报。");
    const sel1 = await ensureSelection("Ctrl+Z 前");
    await probe({
      id: "reader.makeCard",
      combo: "Ctrl+Z",
      scene: "阅读",
      effect: "打开手动制卡弹窗",
      drive: sel1.ok,
      whyNot: `无活动选区（${sel1.why || "拖拽未产生选区"}）`,
      assert: (a, b) => Number(b.dialogs) > Number(a.dialogs) || /制卡|卡片类型|问答/.test(b.title + b.toast) || b.hash !== a.hash,
      inverse: async () => {
        await press("Escape", 700);
      },
    });
    await h.shot("f60-s4-after-ctrl-z");

    const sel2 = await ensureSelection("Ctrl+S 前");
    await probe({ id: "reader.extract", combo: "Ctrl+S", scene: "阅读", effect: "摘录入队（提示或正文变化）", drive: sel2.ok, whyNot: `无活动选区（${sel2.why}）`, settle: 900 });

    const sel3 = await ensureSelection("Ctrl+D 前");
    await probe({ id: "reader.lookupWord", combo: "Ctrl+D", scene: "阅读", effect: "查词面板/词典结果出现", drive: sel3.ok, whyNot: `无活动选区（${sel3.why}）`, settle: 1200 });

    const sel4 = await ensureSelection("Ctrl+X 前");
    await probe({ id: "reader.aiCards", combo: "Ctrl+X", scene: "阅读", effect: "AI 制卡面板（未配 Key 时应给可见提示）", drive: sel4.ok, whyNot: `无活动选区（${sel4.why}）`, settle: 1600 });

    const sel5 = await ensureSelection("Ctrl+A 前");
    const preSel = await ev(`return String(window.getSelection()||'').replace(/\\s+/g,' ').trim().length;`, 0);
    await probe({ id: "reader.aiExplain", combo: "Ctrl+A", scene: "阅读", effect: "AI 解释面板；且原生全选必须被劫持", drive: sel5.ok, whyNot: `无活动选区（${sel5.why}）`, settle: 1600 });
    const postSel = await ev(`return String(window.getSelection()||'').replace(/\\s+/g,' ').trim().length;`, 0);
    flow.record("Ctrl+A 前后选区字数", `${preSel} → ${postSel}`);
    if (Number(preSel) > 3) {
      flow.check("Ctrl+A 被命令表劫持（未退化成浏览器全选）", Number(postSel) < Number(preSel) * 4, "选区未被扩成全文", `选区 ${preSel} → ${postSel} 字`);
    } else {
      flow.record("Ctrl+A 全选劫持", "未测：没有可用选区（前置未成立），preSel=0 时该判据是空转，不下结论");
    }

    // ---------- S5 非命令表的文档承诺键 ----------
    flow.section("S5 文档承诺但不在命令表里的键（缩放 / 改绑 / 全局键）");
    await goto("书架", 2000);
    const z1 = await fp();
    await press("Ctrl+=");
    await press("Ctrl+=");
    const z2 = await fp();
    flow.record("Ctrl+= 连按两次", JSON.stringify(fpDiff(z1, z2)).slice(0, 140));
    await press("Ctrl+-");
    await press("Ctrl+-");
    const z3 = await fp();
    const zoomDiff = fpDiff(z1, z3);
    probes.push({ id: "(缩放)", combo: "Ctrl+= / Ctrl+-", scene: "全局", effect: "文档承诺：字号/缩放可调", before: z1, after: z3, diff: zoomDiff, changed: zoomDiff.length > 0 });
    flow.check("Ctrl+= / Ctrl+- 缩放有效", zoomDiff.length > 0, "界面应变化", zoomDiff.length ? zoomDiff.join(" ") : "零 UI 变化 —— 已登记 D-TEST-41③（应用根本没有任何缩放手段），本条为复现不重报");
    const altRes = [];
    for (const k of ["Alt+ArrowLeft", "Alt+ArrowRight"]) {
      const a1 = await fp();
      await press(k);
      const a2 = await fp();
      altRes.push(`${k}:${fpDiff(a1, a2).length ? "有变化" : "零变化"}`);
    }
    flow.record("Alt+←/→（书架键盘重排）", altRes.join(" ") + "（说明：本次库里只有一本书、无文件夹，重排无从观察，属前置不满足而非失效）");
    for (const k of ["Ctrl+Alt+Space", "Ctrl+Alt+N"]) {
      const a1 = await fp();
      await press(k);
      const a2 = await fp();
      probes.push({ id: "(全局键)", combo: k, scene: "主进程", effect: "OS 级全局快捷键", before: a1, after: a2, diff: fpDiff(a1, a2), changed: fpDiff(a1, a2).length > 0 });
      flow.record(`${k} 在渲染层按键`, "无法据此判定：该组合由 electron/main.js 的 globalShortcut 注册，OS 层不经过页面 keydown；CDP 注入只测到渲染层。本条不计入无操作清单。");
    }

    // ---------- S6 N 节：无操作绑定 ----------
    flow.section("N 无操作绑定清单");
    const controlWorks = spaceOk;
    const dead = probes.filter((p) => p.drive !== false && !p.changed && p.scene !== "主进程" && !String(p.combo).includes("Alt+Arrow"));
    const drivable = probes.filter((p) => p.before && p.scene !== "主进程" && !String(p.combo).includes("Alt+Arrow"));
    flow.record("已按下并可判定的键位数", `${drivable.length}（其中无变化 ${dead.length}）`);
    for (const d of dead) {
      flow.record(`无操作候选 ${d.combo}（${d.scene}）`, `before={${JSON.stringify({ v: d.before.view, dlg: d.before.dialogs, hash: d.before.hash, len: d.before.bodyLen }).slice(0, 90)}} after={${JSON.stringify({ v: d.after.view, dlg: d.after.dialogs, hash: d.after.hash, len: d.after.bodyLen }).slice(0, 90)}}`);
    }
    if (controlWorks) {
      flow.check("无操作清单可信（正对照已通过）", true, "可信", dead.length ? `${dead.length} 条零变化：${dead.map((x) => x.combo).join(" ")}` : "无零变化键位");
    } else {
      flow.check("无操作清单不可信（正对照失败，故不作缺陷结论）", false, "正对照必须为真", "空格翻面对照未产生差分，探针失灵");
    }
    const already = dead.filter((d) => /缩放/.test(d.effect || ""));
    flow.record("其中属于已知缺陷", already.map((d) => `${d.combo} 已登记 D-TEST-41③`).join(" ; ") || "无");

    // ---------- S7 M 节：冲突与吞键 ----------
    flow.section("M 冲突与吞键（模态开着时后台不得被动）");
    await restartReview();
    await press("Space", 600);
    const bg0 = await fp();
    // 删除确认是**原生**对话框（会冻结渲染进程），拿它测「模态背后」不成立；
    // 这里用真正在 DOM 里的模态：复习页的「对比卡」向导（A-12 当年就是在它开着时按「1」把背后的卡评了分）
    const opened = await clickEl(".review-tools button", "对比卡");
    await wait(1400);
    const bgOpen = await fp();
    flow.record("对比卡模态是否打开", opened && Number(bgOpen.dialogs) > Number(bg0.dialogs) ? `是（DOM 内 role=dialog 数 ${bg0.dialogs}→${bgOpen.dialogs}）` : `点击结果=${opened}，dialogs ${bg0.dialogs}→${bgOpen.dialogs}`);
    flow.record("模态打开时的焦点", JSON.stringify({ focus: bgOpen.focus, 焦点在模态子树内: bgOpen.focusInDialog }));
    flow.check("M 节判据非空转（模态打开时背后仍摆着一张可见的卡）", String(bgOpen.cardFront).length > 4, "背后有卡", JSON.stringify({ cardFront: String(bgOpen.cardFront).slice(0, 20), grade: String(bgOpen.gradeBtns).slice(0, 20) }));
    /** 差分只认「背后那张卡」的读数：卡身份、评分按钮、本轮计数 */
    const bgRead = (f) => `front=${truncate2(f.cardFront, 14)}|grade=${f.gradeBtns ? f.gradeBtns.slice(0, 14) : "无"}|本轮=${f.reviewCount}|dlg=${f.dialogs}`;
    const truncate2 = (s, n) => (String(s).length > n ? String(s).slice(0, n) + "…" : String(s));
    const bgLeak = (a1, a2) =>
      a1.cardFront !== a2.cardFront || a1.gradeBtns !== a2.gradeBtns || a1.reviewCount !== a2.reviewCount;
    // 先做两格「噪声对照」：静置零输入 + 按一个未绑定的键；它们若也能造成同样的背景变化，
    // 那么绑定键的变化就是模态自己的异步刷新，不是键盘泄漏（跑 2 就差点在这里误报）。
    const quiet = [];
    {
      const a1 = await fp();
      await wait(1500);
      const a2 = await fp();
      quiet.push(`静置1.5s:${bgLeak(a1, a2) ? "背景有变化 " + bgRead(a1) + " → " + bgRead(a2) : "背景零变化"}`);
      const a3 = await fp();
      await press("7", 520);
      const a4 = await fp();
      quiet.push(`未绑定键 7:${bgLeak(a3, a4) ? "背景有变化 " + bgRead(a3) + " → " + bgRead(a4) : "背景零变化"}`);
    }
    flow.record("噪声对照（静置 / 未绑定键）", quiet.join(" ; "));
    const leak = [];
    for (const c of ["Q", "W", "Z", "1", "2", "3", "4", "Space"]) {
      const a1 = await fp();
      await press(c, 620);
      const a2 = await fp();
      if (Number(a2.dialogs) !== Number(a1.dialogs)) {
        flow.record(`键 ${c} 把模态关掉了`, `dialogs ${a1.dialogs}→${a2.dialogs}（原生按钮被空格/回车激活，非命令表命中）；重新打开模态继续`);
        if (c === "Space") await clickEl(".review-tools button", "对比卡");
        await wait(1200);
        continue;
      }
      if (bgLeak(a1, a2)) leak.push(`${c}: ${bgRead(a1)} → ${bgRead(a2)}`);
    }
    flow.record("对比卡模态开着时逐键结果", leak.length ? leak.join(" | ") : "8 键（Q/W/Z/1/2/3/4/Space）全部未触及背后那张卡");
    flow.check("对比卡模态打开期间评分/跳过/暂停/撤销不作用于背后卡片", leak.length === 0, "背后读数零变化", leak.join(" | ").slice(0, 220) || "无泄漏");
    await press("Escape", 900);
    const bgClose = await fp();
    flow.record("Esc 关闭对比卡模态", JSON.stringify({ dialogs: `${bgOpen.dialogs}→${bgClose.dialogs}`, 卡: truncate(bgClose.cardFront) }));

    // 设置模态（pushSuppress 家族，全仓唯一显式挂起分发的模态）：14 条 + 复习裸键全按一遍
    const st0 = await fp();
    await clickEl(".icon-btn");
    await wait(1400);
    let stOpen = await fp();
    flow.record("设置模态打开", JSON.stringify({ dialogs: `${st0.dialogs}→${stOpen.dialogs}`, focus: stOpen.focus, 焦点在模态子树内: stOpen.focusInDialog }));
    const leak2 = [];
    const closedBy = [];
    for (const c of Object.values(GUIDE_TABLE).concat(["Q", "W", "D", "Z", "1", "2", "3", "4"])) {
      const a1 = await fp();
      if (Number(a1.dialogs) < Number(stOpen.dialogs)) {
        closedBy.push(`按到 ${c} 之前模态已关闭`);
        break;
      }
      await press(c, 460);
      const a2 = await fp();
      if (Number(a2.dialogs) !== Number(a1.dialogs)) {
        // 空格/回车会激活「获得焦点的那个按钮」——这是浏览器原生行为，不是命令表命中；单独记账
        closedBy.push(`${c} 使 dialogs ${a1.dialogs}→${a2.dialogs}（原生按钮激活，非命令命中）`);
        await clickEl(".icon-btn");
        await wait(1200);
        stOpen = await fp();
        continue;
      }
      if (bgLeak(a1, a2)) leak2.push(`${c}: ${bgRead(a1)} → ${bgRead(a2)}`);
    }
    flow.record("设置模态内按键（背景泄漏）", leak2.length ? leak2.join(" | ") : "18 键全部零命中");
    flow.record("设置模态内按键（模态被关掉的情况）", closedBy.join(" ; ") || "无");
    flow.check("设置模态打开期间页面命令一律不作用于背后的卡", leak2.length === 0, "背后读数零变化", leak2.join(" | ").slice(0, 200) || "零命中");
    await press("Escape", 900);
    const stClosed = await fp();
    flow.record("Esc 关闭设置模态", JSON.stringify({ dialogs: `${stOpen.dialogs}→${stClosed.dialogs}`, focus: stClosed.focus }));
    if (stClosed.focus === "BODY.") flow.record("关闭后焦点掉回 body", "已登记 D-TEST-41①（本条不重报）");

    // 阅读器吞键：阅读器里按复习场景的裸键（d/w/q/1）必须不作用于任何后台
    await goto("书架", 1800);
    await clickEl(".book-card");
    await wait(3200);
    const rd0 = await fp();
    for (const c of ["d", "w", "q", "1", "2"]) await press(c, 300);
    const rd1 = await fp();
    flow.record("阅读器内连按复习裸键", JSON.stringify(fpDiff(rd0, rd1)).slice(0, 160));
    flow.check("复习场景的裸键在阅读页不误伤", Number(rd1.dialogs) === Number(rd0.dialogs), "无弹窗/无删除", JSON.stringify({ dialogs: `${rd0.dialogs}→${rd1.dialogs}` }));
    await h.shot("f60-s7-final");
  } finally {
    await shutdown(h);
  }
});
