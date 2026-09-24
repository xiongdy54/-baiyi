// F48b 视觉取证播种（真实 electron 运行时 · 真实 db 层写入 · 只写自己的沙箱目录）
// @runtime: electron  @tier: 3  @gui: false  @id: F48b  @timeout: 600
// 运行：npx electron tests/flows/f48b-seed.cjs   （或由 F48 用同一 electron 可执行文件派生）
//
// 为什么要单独一步：F48 要在**真实界面**上截图，而截图要有看头就得有真实形状的数据
// ——8 本书、120 张卡（新卡/学习/今日到期/逾期 30 与 200 天/挂起/leech/同源对）、
// 60 天复习史（热力图与所有图表都要有非零日）、45 天阅读事件、日记与摘录队列。
// 渲染层没有批量造数据的入口，只能走 electron/db.js；而 db.js 必须在 electron 运行时里起
// （§7.1.8 内存库 + 全量回写），所以本文件是一个「起库 → 播种 → persistNow → 退出」的独立步骤。
//
// 数据全部写进 tmpUserDataDir("f48")（系统临时目录下），与真实用户目录无关；
// 卡片与日志用**自建链**保证 review_logs.after == 下一条 before == 卡当前 fsrs（撤销账目不悬空）。
// @runtime: electron
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, makeRng, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F48b",
  title: "视觉取证播种（8 书 / 120 卡 / 60 天史）",
  angle: "给 F48 的逐屏截图铺真实形状的数据",
  cites: ["§6.1", "§6.2", "§4.4.4", "§4.12-4"],
  tier: 3,
  gui: false,
});

const DAY = 86400000;
const rng = makeRng("f48-visual-seed");
const pick = (arr) => arr[Math.floor(rng.next() * arr.length) % arr.length];
const int = (a, b) => a + Math.floor(rng.next() * (b - a + 1));
const uniq = require("crypto").randomUUID;

/** 64×64 纯色 PNG（#C83F4B），作为「正文内联图」进 Markdown —— 小、自足、无网络 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwNfMABY3liH8OITBAtzmrP11wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYB3wchPOrzpm8AAAAASUVORK5CYII=";

const LONG_TAIL = (() => {
  const paras = [
    "渐进阅读的难点从来不是把文本切成段，而是决定哪一段值得进入复习循环：切得太粗，一张卡要同时回答三件事，回忆失败时你不知道是哪一件失败了；切得太细，队列里塞满了彼此无关的碎片，复习变成搬运而不是记忆。",
    "间隔重复的工程史从艾宾浩斯的遗忘曲线出发，经过 SuperMemo 的矩阵法与 SM-2，走到把可观测的记忆状态放回参数估计的 FSRS；每一次转向的共同原因，都是旧的模型无法解释自己算错的那部分。",
    "队列口径必须唯一：界面显示的今日到期、统计里的今日到期、复习页实际出的卡，三者若来自三条 SQL，用户迟早会在某一天发现它们互不相等，于是所有数字都失去意义。",
    "同源兄弟卡的价值在于从不同角度压同一个断言；代价是一组卡同时到期时，第二张的提示来自第一张，测到的不是记忆而是短期残留，所以延后与额度都要按组而不是按张给。",
    "撤销必须留下评分前的完整快照，因为只有前像能精确复原八个字段；用当前状态反推等于用结果去猜原因，一旦中间还夹着别的写库动作，猜出来的就是别人的历史。",
    "摘录与卡片的分工不是格式差异而是资产状态：前者还在候选池里等待判断，后者已经进入排期并开始消耗复习预算；把两者混在一张列表里，用户就无法回答我今天到底欠了多少。",
    "书架的视图与密度是两个正交旋钮：视图决定用封面墙还是目录表，密度决定同一行放几格；把它们合成一个「紧凑模式」开关，就会同时失去两种单独调整的能力。",
    "领域码最多留两个是硬约束，被丢掉的第三个用户在界面上永远看不见，画像于是悄悄偏移：一门被反复归到第三领域的材料，在图上表现得像从未存在过。",
  ];
  let out = "";
  for (let i = 0; i < 80 && out.length < 4900; i++) out += paras[i % paras.length] + "\n\n";
  return out + "日本語のメモ：段階読書では、一文中の未知語を三つ以下に抑えると処理負度が安定する。英語と日本語を混ぜると組版の違いがそのまま視覚検証の材料になる。The quick brown fox 只能检验拉丁字形，检验不了 CJK 与拉丁同排时的换行策略。\n\n";
})();

/** 8 本书：标题形状各异（2 字 / 40 字 / 中英日混排 / 含撇号与引号），正文长度各异 */
function bookDefs() {
  const md3 =
    "# 第一章 渐进阅读的三个约束\n\n把长文切成小块不是目的，**让每个小块能被独立回忆**才是。\n\n" +
    "约束之间会互相拉扯：原子性要求更小，可回忆性要求更大。下面三档取舍是实践中最常见的。\n\n" +
    "| 档位 | 粒度 | 适用 |\n|---|---|---|\n| 窄 | 一句一卡 | 定义、术语 |\n| 中 | 一段一卡 | 论证、因果 |\n| 宽 | 一节一摘要卡 | 结构、地图 |\n\n" +
    "# 第二章 间隔重复的调度账\n\n排期不是算法独占的事：队列口径、同源延后、每日额度都会改写它。\n\n" +
    "> 若只看单张卡的间隔，你会以为系统很宽裕；把当日全部到期卡放在一起看，才发现是它在一天内灌下三百张。\n\n" +
    "```js\nfunction next(card, grade) {\n  const s = fsrs.next(card.state, grade, new Date());\n  return { due: s.due, stability: s.stability };\n}\n```\n\n" +
    "同一份材料里，**先做减法再做加法**：删掉答对的卡，比给它加一张更省复习时间。\n\n" +
    "# 第三章 知识画像与推荐\n\n画像把卡片证据汇聚成掌握度估计，用来决定下一步读什么。\n\n" +
    "它同时是一面镜子：如果画像说你在某领域有 200 张复习中的卡，而你的队列里一天排不上三张，那说明入队速度早就超过了消化速度。\n\n";

  let md12 = "十二讲：材料导图与结构抽取（导言）\n\n每一讲只留一个可回忆的断言。导语不占一级标题，目录面板应恰好给出 12 条。\n\n";
  for (let i = 1; i <= 12; i++) {
    md12 +=
      `# 第 ${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"][i - 1]}讲 主题 ${i}\n\n` +
      `第 ${i} 讲把「结构」拆成三个问题：这一段在回答什么、它上一段是否给了答案、答案能不能脱离上下文被复述。\n\n` +
      `讲点 ${i}a：切块边界优先取标题与小节，其次取段首连接词。\n\n讲点 ${i}b：连接词命中的边界要用图注回看一次再落卡。\n\n`;
  }

  const mdLong =
    "# 长章：表格、代码、图片与公式同页\n\n这一章故意把富文本要素全塞在一页里，用来做视觉取证的落点检查。\n\n" +
    "## 一、要素表\n\n| 要素 | 写法 | 界面应给什么 | 宽度风险 |\n|---|---|---|---|\n| 表格 | `\\| a \\| b \\|` | 等宽数字与斑马纹 | 长单元格撑破容器 |\n| 代码块 | 三反引号围栏 | 横向滚动而非换行 | 无滚动条时像被截断 |\n| 引用 | 大于号 | 左边线 + 缩进 | 嵌套两层后与正文难分 |\n| 内联图 | data:image/png;base64 | 限宽不溢出 | 原图 64px 被放大时糊 |\n| 公式 | 双美元号 | KaTeX 块级居中 | 长公式横向溢出 |\n\n" +
    "## 二、代码\n\n```js\n// 调度器：把一次评分写回卡片，并留下可撤销的账\nexport function applyGrade(card, grade, now) {\n  const before = { ...card.fsrs };\n  const after = fsrs.next(before, grade, now);\n  db.saveReview(card.id, after, grade.label, now - before.lastReview, before);\n  return { before, after };\n}\n```\n\n" +
    "## 三、引用与图\n\n> 一句被反复答对的卡，不代表你理解了它——也可能只是提示语足够自足。\n\n" +
    `![纯色小图：64×64 的 #C83F4B 色块]（占位）\n\n上面这行是文字说明，下面的图走 data URI（不联网也能渲染）：\n\n![色块](data:image/png;base64,${PNG_B64})\n\n` +
    "## 四、公式\n\n稳定度随复习间隔衰减，块级公式如下：\n\n$$S_{n+1}=S_n\\cdot\\exp\\!\\bigl(w_{17}\\,(g-3+u)^{+}\\bigr),\\qquad r(t)=\\exp\\!\\bigl(-(t/S)\\ln 2\\bigr)$$\n\n" +
    "## 五、长正文\n\n" + LONG_TAIL + "\n\n";

  const short1 = "# 短册\n\n只有一节的材料：卡片浏览里它是一行，书架上它是一格。\n\n第二句：没有第二层结构，目录面板应当只有条目本身。\n";
  const short2 = "# Note sur la lecture\n\nUn matériau court, en français et en anglais mélangés, pour voir la césure.\n\nReading short notes keeps the shelf honest.\n";
  const md2ch =
    "# 第一章 术语与命名\n\n术语不统一时，卡片浏览的搜索会给出两种答案。\n\n| 中文 | 英文 | 首次出现 |\n|---|---|---|\n| 稳定度 | stability | 第 3 页 |\n| 难度 | difficulty | 第 3 页 |\n| 相对熟练度 | retrievability | 第 7 页 |\n\n" +
    "# 第二章 命名的代价\n\n一处改名，三处要对齐：题面、标签、领域码。\n\n领域码是 UDC 前缀树，二级类目最多两个，多余的要丢——丢的那一个用户看不见。\n";

  const t40 = "关于渐进阅读与间隔重复在实践中如何相互妥协并落到每天复习队列里的一份四十字长标题笔记";
  return [
    { title: "书谱", markdown: md3, kind: "paste" },
    { title: t40, markdown: md12, kind: "paste" },
    { title: 'Spaced 复习と忘却曲線 Revisited：中英日混排', markdown: mdLong, markdownKind: "long", kind: "paste", longest: true },
    { title: `Ando's "Leather" Notes · 引号与撇号`, markdown: md2ch, kind: "paste" },
    { title: "渐进阅读入门", markdown: short1, kind: "paste" },
    { title: "FSRS 参数与证据", markdown: md3 + "\n\n" + LONG_TAIL.slice(0, 900), kind: "paste" },
    { title: "知识画像 2026", markdown: short2, kind: "imported" },
    { title: "读书笔记：长文与短章", markdown: md2ch + "\n\n" + LONG_TAIL.slice(0, 1400), kind: "paste" },
  ];
}

const DOMAINS = ["004", "1", "159.9", "37", "51", "53", "8", "93", "33", "7"];
const FRONT = [
  "渐进阅读里「原子性」的判据是什么？",
  "FSRS 的 stability 字段表示什么？",
  "队列口径为什么必须唯一？",
  "同源延后的目的是什么？",
  "回顾率 r(t) 怎样随稳定度变化？",
  "leech 阈值触发后系统该做什么？",
  "为什么撤销日志要存评分前快照？",
  "摘录与卡片的关系是什么？",
  "书架的「视图」和「密度」分别管什么？",
  "领域码多余的要丢弃会带来什么风险？",
];
const BACK = [
  "一张卡只问一件事，答错时能定位到唯一失败点。",
  "可回忆半衰期的尺度参数：越大表示记忆越稳。",
  "同一个「今日到期」不能有两套算法，否则界面与统计各说各话。",
  "同一材料衍生的兄弟卡不一次全给，避免相互提示造成假掌握。",
  "r(t)=exp(-(t/S)·ln2)：间隔等于稳定度时回顾率约 0.5。",
  "标记为 leech、自动挂起并退出队列，同时留一条待处理的问题。",
  "撤销要把八个字段逐项复原，不能靠「当前状态」反推。",
  "摘录是待读的候选池，卡片是已进入排期的资产。",
  "视图管封面墙还是目录表，密度管每行放多少格。",
  "被丢的那一级用户看不见，画像就悄悄偏了。",
];

/** 每张卡的排期档位：新卡 / 学习 / 今日到期 / 逾期 30 天 / 逾期 200 天 / 挂起 / leech / 远期复习 */
function bucketPlan() {
  const plan = [];
  const push = (bucket, n) => {
    for (let i = 0; i < n; i++) plan.push(bucket);
  };
  push("new", 24);
  push("learning", 14);
  push("dueToday", 22);
  push("overdue30", 20);
  push("overdue200", 14);
  push("suspended", 6);
  push("leech", 8);
  push("reviewFar", 12);
  return plan; // 120
}

async function seed() {
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  flow.record("沙箱目录", app.getPath("userData"));

  // ---------- 1) 8 本书 ----------
  flow.section("S1 播种 8 本书（标题与正文形状各异）");
  const defs = bookDefs();
  const books = [];
  for (const d of defs) {
    let r;
    if (d.kind === "imported") {
      r = db.createImportedDoc({
        title: d.title,
        markdown: d.markdown,
        sourceType: "markdown",
        sourceName: "f48-imported.md",
        originalName: "f48-imported.md",
        originalBuf: Buffer.from(d.markdown, "utf8"),
      });
    } else {
      r = db.createFromPaste(d.title, d.markdown);
    }
    books.push({ id: r.id, title: r.title, documentId: r.documentId || null, markdown: d.markdown });
  }
  for (const b of books) {
    if (!b.documentId) {
      const doc = db.getDocument(b.id);
      if (doc) b.documentId = doc.documentId;
    }
  }
  flow.eq("书目 8 本全部建号", books.length, 8);
  flow.check("每本书都能取回文档（含 documentId）", books.every((b) => !!b.documentId), "8/8", books.map((b) => b.documentId).join(","));
  flow.record("各本正文字符数", books.map((b) => `${b.title.slice(0, 6)}=${b.markdown.length}`).join(" · "));
  const maxLen = Math.max(...books.map((b) => b.markdown.length));
  const longest = books.reduce((a, b) => (b.markdown.length > a.markdown.length ? b : a));
  flow.record("最长那本", `${longest.title} · ${maxLen} 字符`);
  flow.check("最长那本（单章含表格+代码+引用+内联图+公式）≥ 5600 字符", maxLen >= 5600, "≥5600", maxLen);
  flow.check("最长那本含全部五类富文本要素", /\|.+\|.+\|/.test(longest.markdown) && /```/.test(longest.markdown) && /^> /m.test(longest.markdown) && /data:image\/png;base64/.test(longest.markdown) && /\$\$/.test(longest.markdown),
    "表格/代码/引用/data 图/KaTeX 齐备", longest.markdown.length);
  flow.check("12 章那本确有 12 个一级标题", (books[1].markdown.match(/^# /gm) || []).length === 12, "12", (books[1].markdown.match(/^# /gm) || []).length);
  flow.check("3 章那本确有 3 个一级标题", (books[0].markdown.match(/^# /gm) || []).length === 3, "3", (books[0].markdown.match(/^# /gm) || []).length);
  flow.check("标题形状覆盖 2 字 / 40 字 / 混排 / 撇号引号", books.map((b) => b.title).some((t) => t.length === 2) && books.map((b) => b.title).some((t) => t.length >= 38) && books.map((b) => b.title).some((t) => /'|"|·/.test(t)), "四类齐备", books.map((b) => `${b.title.length}:${b.title.slice(0, 8)}`).join(","));

  // ---------- 2) 120 张卡 + 60 天复习链 ----------
  flow.section("S2 播种 120 张卡（FSRS 分布）与 60 天复习史");
  const now = Date.now();
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  const plan = bucketPlan();
  const targetDue = (bucket) => {
    switch (bucket) {
      case "new": return now;
      case "learning": return now + int(1, 9) * 60000;
      case "dueToday": return now - int(0, 6) * 3600000;
      case "overdue30": return now - 30 * DAY - int(0, 20) * 3600000;
      case "overdue200": return now - 200 * DAY - int(0, 40) * 3600000;
      case "suspended": return now - int(1, 20) * DAY;
      case "leech": return now + int(1, 4) * DAY;
      default: return now + int(6, 40) * DAY;
    }
  };
  /** 历史窗口：逾期 200 天的那批把复习史放在 150–210 天前，其余落在最近 60 天 */
  const historyWindow = (bucket) =>
    bucket === "overdue200" ? [now - 215 * DAY, now - 150 * DAY] : [today0 - 59 * DAY, Math.min(now - 3600000, today0 + 20 * 3600000)];

  const cards = [];
  const logs = [];
  for (let i = 0; i < plan.length; i++) {
    const bucket = plan[i];
    const book = books[i % books.length];
    const state = {
      state: "new", due: now, lapses: 0, stability: 1, difficulty: 7, reps: 0, lastReview: null, learningSteps: []
    };
    const [h0, h1] = historyWindow(bucket);
    const nHist = bucket === "new" ? 0 : int(2, 9);
    const stamps = [];
    for (let k = 0; k < nHist; k++) stamps.push(h0 + Math.floor(((h1 - h0) * (k + rng.next() * 0.8)) / Math.max(1, nHist)));
    stamps.sort((a, b) => a - b);
    const chain = [];
    for (let k = 0; k < stamps.length; k++) {
      const at = stamps[k];
      const before = { ...state };
      const isAgain = rng.next() < (bucket === "leech" ? 0.45 : 0.14);
      const rating = isAgain ? "Again" : pick(["Good", "Good", "Good", "Easy", "Hard"]);
      const lapses = before.lapses + (isAgain ? 1 : 0);
      const stability = isAgain ? Math.max(0.6, before.stability * 0.6) : Math.max(1.2, before.stability * (rating === "Easy" ? 2.4 : rating === "Hard" ? 1.25 : 1.75));
      const intervalDays = isAgain ? 0 : Math.max(1, Math.round(stability * (k === stamps.length - 1 ? 1 : 1.4)));
      const after = {
        state: isAgain ? "learning" : "review",
        due: at + (isAgain ? 10 * 60000 : intervalDays * DAY),
        lapses,
        stability: Math.round(stability * 100) / 100,
        difficulty: Math.min(10, Math.max(1, Math.round((before.difficulty + (isAgain ? 0.6 : -0.2)) * 10) / 10)),
        reps: before.reps + 1,
        lastReview: at,
        learningSteps: isAgain ? [0] : [],
      };
      chain.push({ at, before, after, rating, duration: isAgain ? int(3000, 9000) : int(4000, 26000) });
      Object.assign(state, after);
    }
    // 末态按档位钉死（保证界面各档都有代表），并把最后一次评分的 after 同步改掉 → 账目不悬空
    const due = targetDue(bucket);
    if (bucket === "new") {
      // 新卡一律用生产同款最小形状（createCard 默认 {state,due,lapses}）：
      // stability:0 / difficulty:0 会被 mapCardRow 的值域闸门判成 damaged（S>0、D∈[1,10]），
      // 那样这批卡在队列与统计里全体缺席，界面就变成「新卡凭空消失」——那是播种 bug 不是产品行为。
      Object.assign(state, { state: "new", due, lapses: 0 });
      delete state.stability;
      delete state.difficulty;
      delete state.lastReview;
      delete state.reps;
      delete state.learningSteps;
    } else {
      Object.assign(state, { due });
      if (bucket === "learning") state.state = "learning";
      if (bucket === "leech") state.lapses = int(6, 10);
      if (chain.length) chain[chain.length - 1].after = { ...state };
    }
    const card = {
      noteText: `${FRONT[i % FRONT.length]}｜${BACK[i % BACK.length]}`,
      cardType: i % 11 === 5 ? "cloze" : "qa",
      frontMarkdown: i % 11 === 5 ? `渐进阅读把长文切成可处理的 {{c1::小块}}，并为每个小块制作{{c2::记忆卡片}}。` : FRONT[i % FRONT.length],
      backMarkdown: i % 11 === 5 ? "小块 / 记忆卡片" : BACK[i % BACK.length],
      clozeOrds: i % 11 === 5 ? [1, 2] : [],
      contextPrefix: pick(["约束", "调度", "画像", "记忆", "版式"]),
      priority: 30 + (i % 41),
      tags: i % 5 === 0 ? ["渐进阅读"] : i % 7 === 0 ? ["FSRS", "排期"] : [],
      domain: [DOMAINS[i % DOMAINS.length]],
      contextRef: { documentId: book.documentId, anchorText: FRONT[i % FRONT.length] },
      sourceRef: { title: book.title },
      dateStamp: undefined,
      mnemonic: i % 13 === 0 ? "把它想成书架上的一格。" : undefined,
      fsrsJson: JSON.stringify(state),
      siblingKey: null,
    };
    const created = db.createCard(card);
    if (!created || created.id === false) {
      flow.check(`第 ${i} 张卡入库`, false, "id", JSON.stringify(created));
      continue;
    }
    cards.push({ id: created.id, bucket, book, state, finalJson: JSON.stringify(state) });
    for (const c of chain) logs.push({ cardId: created.id, at: c.at, rating: c.rating, duration: c.duration, before: c.before, after: c.after, domain: DOMAINS[i % DOMAINS.length] });
  }

  // 3 组同源对（同一 siblingKey，两张都到期 → 队列里会出现「同源暂缓」）
  flow.section("S3 同源对 / 挂起 / leech 联动");
  const pairSeeds = [
    ["pair-alpha", 0], ["pair-beta", 2], ["pair-gamma", 4],
  ];
  let pairCount = 0;
  for (const [key, offset] of pairSeeds) {
    const base = cards.filter((c) => c.bucket === "dueToday").slice(offset * 2, offset * 2 + 2);
    if (base.length < 2) continue;
    for (const c of base) db.execRawSql("UPDATE cards SET sibling_key = ? WHERE id = ?", [key, c.id]);
    pairCount++;
  }
  flow.eq("3 组同源对（每组两张）已挂 sibling_key", pairCount, 3);

  let susp = 0;
  for (const c of cards.filter((x) => x.bucket === "suspended")) {
    if (db.setCardSuspended(c.id, true, "F48b 视觉取样：挂起态") === true) susp++;
  }
  flow.eq("6 张挂起卡（setCardSuspended 生效）", susp, 6);

  let leech = 0;
  for (const c of cards.filter((x) => x.bucket === "leech")) {
    if (db.updateCardLeech(c.id, { isLeech: true, lapses: c.state.lapses })) {
      db.addCardIssue({ cardId: c.id, ruleId: "LEECH", severity: "warn", message: `遗忘 ${c.state.lapses} 次，建议改写或暂停`, source: "lint" });
      leech++;
    }
  }
  flow.check("8 张 leech 卡（≥6 次遗忘 + 一条待处理问题）", leech === 8, "8", leech);

  // ---------- 4) 60 天热力图补齐：每一天都要有非零日 ----------
  flow.section("S4 60 天复习史补形（热力图每天非零 + 空档日）");
  const activeCards = cards.filter((c) => c.bucket !== "new");
  const perDayCount = {};
  for (const l of logs) perDayCount[new Date(l.at).setHours(0, 0, 0, 0)] = (perDayCount[new Date(l.at).setHours(0, 0, 0, 0)] || 0) + 1;
  const GAP_DAYS = [today0 - 41 * DAY, today0 - 40 * DAY]; // 故意留两天空档：热力图该出现缺口
  let filled = 0;
  for (let d = 59; d >= 0; d--) {
    const day = today0 - d * DAY;
    if (GAP_DAYS.includes(day)) continue;
    const want = int(6, 26) - (perDayCount[day] || 0);
    for (let k = 0; k < want; k++) {
      const c = activeCards[(d * 7 + k * 3) % activeCards.length];
      const at = day + int(8, 22) * 3600000 + int(0, 59) * 60000;
      const prev = c.state;
      const rating = (d + k) % 9 === 0 ? "Again" : pick(["Good", "Good", "Easy", "Hard"]);
      const isAgain = rating === "Again";
      const after = {
        ...prev,
        state: isAgain ? "learning" : "review",
        reps: (prev.reps || 0) + 1,
        lapses: (prev.lapses || 0) + (isAgain ? 1 : 0),
        lastReview: at,
        due: prev.due, // 末态由档位钉死，补形日志只改历史不改到期
        stability: Math.max(0.5, Math.round((prev.stability || 1) * (isAgain ? 0.7 : 1.02) * 100) / 100),
      };
      logs.push({ cardId: c.id, at, rating, duration: isAgain ? int(3000, 8000) : int(4000, 26000), before: prev, after, domain: null });
      c.state = after;
      filled++;
    }
  }
  // 把补形后的末态写回卡（除 due 被档位钉死外一致）
  for (const c of activeCards) {
    const keep = { ...c.state };
    c.finalJson = JSON.stringify(keep);
    db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [c.finalJson, c.id]);
  }
  logs.sort((a, b) => a.at - b.at);
  let seq = 0;
  for (const l of logs) {
    seq++;
    db.execRawSql(
      "INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, fsrs_before_json, fsrs_after_json, leech_before_json, fsrs_config_id, fsrs_before_config_id, review_seq) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [uniq(), l.cardId, l.rating, l.at, l.duration, JSON.stringify(l.before), JSON.stringify(l.after), null, db.getActiveConfigId(), db.getActiveConfigId(), seq]
    );
  }
  flow.record("补形写入的日志条数", `${filled} · 总计 ${logs.length}`);
  const daysCovered = new Set(logs.map((l) => new Date(l.at).setHours(0, 0, 0, 0))).size;
  flow.check("最近 60 天里绝大多数日子都有复习记录（留 2 天空档）", daysCovered >= 56, "≥56 天", daysCovered);

  // 跳过记录（队列水位的 skipped）
  for (let i = 0; i < 9; i++) {
    const c = activeCards[i * 5];
    db.execRawSql("INSERT INTO review_skips (id, card_id, skipped_at) VALUES (?,?,?)", [uniq(), c.id, now - int(0, 25) * DAY - int(0, 20) * 3600000]);
  }

  // ---------- 5) 阅读事件（45 天窗口要有意正增量） ----------
  flow.section("S5 阅读事件（46 个日桶要有真实字数形状）");
  let ev = 0;
  for (const bi of [0, 1, 2, 5, 7]) {
    const b = books[bi];
    let pos = int(200, 900);
    for (let d = 44; d >= 0; d--) {
      if (rng.next() < 0.28) continue;
      const steps = int(1, 3);
      for (let s = 0; s < steps; s++) {
        pos += int(180, 1400);
        const at = today0 - d * DAY + int(7, 22) * 3600000 + int(0, 59) * 60000;
        db.execRawSql("INSERT INTO reading_events (id, item_id, char_pos, created_at) VALUES (?,?,?,?)", [uniq(), b.id, pos, at]);
        ev++;
      }
    }
  }
  flow.check("阅读事件足够铺满 46 天窗口", ev > 150, ">150", ev);

  // ---------- 6) 摘录队列 + 日记 ----------
  flow.section("S6 摘录队列与日记条目");
  let extracts = 0;
  const parents = [];
  for (let i = 0; i < 13; i++) {
    const b = books[i % books.length];
    const r = db.createExtract({
      parentType: "document",
      parentId: b.documentId,
      documentId: b.documentId,
      contentMarkdown: `${FRONT[i % FRONT.length]}——摘自《${b.title}》第 ${(i % 3) + 1} 节，值得单独回忆一次。`,
      priority: 25 + ((i * 7) % 60),
      contextRef: { documentId: b.documentId, anchorText: FRONT[i % FRONT.length] },
    });
    if (r && r.id) {
      extracts++;
      parents.push(r.id);
    }
  }
  for (const pid of parents.slice(0, 3)) {
    const b = books[0];
    const r = db.createExtract({
      parentType: "extract",
      parentId: pid,
      documentId: b.documentId,
      contentMarkdown: "第二层摘录：把上面那段再压成一句可回忆的断言。",
      priority: 45,
      contextRef: { documentId: b.documentId, anchorText: "第二层摘录" },
    });
    if (r && r.id) extracts++;
  }
  flow.check("摘录队列有 13 条一层 + 3 条二层", extracts, 16);

  let journals = 0;
  const jDays = [0, 1, 2, 4, 6, 9, 12, 15, 19, 23, 28, 33, 38, 44];
  for (const d of jDays) {
    const created = today0 - d * DAY + int(19, 22) * 3600000;
    const e = db.createJournalEntry({
      contentMarkdown:
        `## ${d === 0 ? "今天" : d + " 天前"}的学习记录\n\n` +
        `今日把《${books[d % books.length].title}》的三节切成 ${int(4, 14)} 张卡，` +
        `复习 ${int(12, 40)} 张，遗忘 ${int(0, 4)} 张。\n\n` +
        `- 收获：**原子性**比数量重要，删卡比加卡更能降低队列压力。\n` +
        `- 疑点：领域码只留两个，第三个被丢了，画像是否会因此偏？\n` +
        `- 待办：把 ` + (d % 2 ? "表格那章" : "公式那章") + ` 的图注重读一遍。\n\n"引用一句：记忆是可观测系统，不是算法。"`,
      source: "app",
      createdAt: created,
    });
    if (e && e.id) journals++;
  }
  db.flushJournalPersist();
  flow.eq("14 条日记条目入库", journals, 14);

  // ---------- 7) 落盘 + 磁盘复核 ----------
  flow.section("S7 persistNow 落盘并用只读句柄复核（界面说有 ≠ 盘上有）");
  db.persistNow();
  const a = await audit(path.join(app.getPath("userData"), "library.db"));
  const disk = {
    items: a.count("library_items"),
    docs: a.count("documents"),
    cards: a.count("cards"),
    logs: a.count("review_logs"),
    skips: a.count("review_skips"),
    extracts: a.count("extracts"),
    journals: a.count("journal_entries"),
    reading: a.count("reading_events"),
    issues: a.count("card_issues"),
  };
  a.close();
  flow.record("盘上事实", JSON.stringify(disk));
  flow.eq("磁盘书目 = 8", disk.items, 8);
  flow.check("磁盘卡片数在 110–125 区间（≈120）", disk.cards >= 110 && disk.cards <= 125, "110–125", disk.cards);
  flow.check("磁盘复习日志 ≥ 600 条（60 天有形状）", disk.logs >= 600, "≥600", disk.logs);
  const st = db.getStatsOverview();
  flow.record("统计口径", `今日到期 ${st.kpi.dueToday} · 同源暂缓 ${st.kpi.siblingDeferred} · 连续 ${st.kpi.streak} 天 · 热力 ${st.heatDays.filter((d) => d.count > 0).length}/${st.heatDays.length} 天有值`);
  flow.record("阅读输入非零日", `${st.readingDays.filter((d) => d.chars > 0).length}/${st.readingDays.length}`);
  flow.record("领域图条目 / 时长分箱条目", `${st.domainMain.length} / ${st.durationByField.length}`);
  flow.check("仪表盘每张图都有非零数据（热力/阅读/领域/评分/时长）",
    st.heatDays.some((d) => d.count > 0) && st.readingDays.some((d) => d.chars > 0) && st.domainMain.length > 0 && st.ratings.length > 0 && st.durationByField.length > 0,
    "全部非零", { heat: st.heatDays.filter((d) => d.count > 0).length, read: st.readingDays.filter((d) => d.chars > 0).length, domain: st.domainMain.length, ratings: st.ratings.length, dur: st.durationByField.length });
  const q = db.computeTodayQueue();
  flow.record("队列（computeTodayQueue）", `${q.cards.length} 张待复习 · 暂缓 ${q.deferred.length} · 损坏 ${q.damaged.length}`);
  flow.eq("零张卡被判为损坏（播种的 fsrs 值域必须落在闸门内）", q.damaged.length, 0);
  flow.check("复习页有卡可出（队列非空）", q.cards.length > 20, ">20", q.cards.length);
  flow.check("同源延后确实发生（3 组对里至少一组被延后）", q.deferred.length >= 1, "≥1", q.deferred.length);
  const all = db.listAllCards();
  flow.eq("卡片浏览侧同样零损坏行", all.filter((c) => c.damaged).length, 0);
  flow.record("卡片浏览状态分布", ["new", "learning", "review", "relearning"].map((s) => `${s}:${all.filter((c) => (c.fsrs || {}).state === s).length}`).join(" "));
  flow.record("挂起 / leech 计数", `${all.filter((c) => c.leech && c.leech.suspended).length} 挂起 · ${all.filter((c) => c.leech && c.leech.isLeech).length} leech`);
  db.persistNow();
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f48"));
    app.setPath("userData", dir);
    console.log("F48b 沙箱 = " + dir);
    const s = await runFlow(flow, seed);
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F48b 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    quit(1);
  });
