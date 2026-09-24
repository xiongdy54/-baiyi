// F69b 极端值取样播种 —— 把"真实用户用四年之后会有的形状"一次性写进 f69 沙箱
// @runtime: electron  @tier: 2  @gui: false  @id: F69b  @timeout: 600
// 运行：npx electron tests/flows/f69b-seed.cjs   （F69 会在缺manifest时自动派生本文件）
//
// 为什么要单独一步：F69 要在**真实界面**上量渲染结果，而渲染结果只暴露"值极端"这一类缺陷：
// 12000 张卡 / 400 天连续 / 50 年后与 1970 年的日志 / 0.4·0.5·99.6·100 四档进度 /
// 200 字与纯空白与 U+202E 与 1000 个组合符的标题 / stability 1e12 / difficulty 999 /
// lapses 9999 / 负 priority / reps=0 而 state=review / 背面为空串与纯空白的卡。
//
// 纪律：① 只写 tmpUserDataDir("f69")，绝不碰真实 userData；
//       ② 批量行一律走 execRawSql（createCard/updateProgress 每次 persist 整库导出，
//          一万二千次就是几万秒），最后统一 persistNow 一次；
//       ③ 播种结束把"库侧真值"与取样清单写进沙箱里的 f69-seed-manifest.json，
//          供 F69 逐屏比对（界面说的数 ≠ 盘上事实 时才算缺陷）。
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const { Flow, runFlow, makeRng, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F69b",
  title: "极端值取样播种（1.2 万卡 / 400 天连续 / 8 类极端标题）",
  angle: "给 F69 的逐屏渲染量测铺极端但可信的值",
  cites: ["§5.1", "§6.1", "§6.2", "§4.4.4"],
  tier: 2,
  gui: false,
});

const DAY = 86400000;
const rng = makeRng("f69-extreme-seed");
const uniq = () => crypto.randomUUID();
const int = (a, b) => a + Math.floor(rng.next() * (b - a + 1));

/** 精确补/截到 n 个 UTF-16 单元 */
function pad(s, n) {
  let out = s;
  while (out.length < n) out += "渐进阅读极端值取样";
  return out.slice(0, n);
}

// ---------------- 极端标题（每一种卡一条不同的排版/格式化路径） ----------------
const T200 = pad("关于渐进阅读与间隔重复的一份取样：这条四百字符长的书名要在书架图注、阅读内核页眉、卡片浏览来源列、仪表盘悬停提示四个地方各自被截一次，", 200);
const T_COMB = "e" + "\u0301".repeat(1000);
const T_RTL = "覆盖\u202Eabc DEF\u202C 反向";
const T_EMOJI = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} 全家福 \u{1F469}\u200D\u{1F4BB} 写码";
const T_SURR = "半代理对残片\uFFFD\uFFFD收尾";
const T_MIX = "读书 · قراءة · קריאה · 読書 · lectio";
const T_BLANK = "   ";
const T_ONE = "一";

/** 进度档位：0.4% / 0.5% / 99.6% / 100% 是"两种取整法必然分家"的三把钥匙 */
const RATIO_SPEC = [
  { key: "r04", label: "0.4%", ratio: 0.004 },
  { key: "r05", label: "0.5%", ratio: 0.005 },
  { key: "r996", label: "99.6%", ratio: 0.996 },
  { key: "r100", label: "100%", ratio: 1 },
  { key: "rTiny", label: "0.004%", ratio: 0.00004 },
  { key: "rOver", label: "1.5(越界)", ratio: 1.5 },
  { key: "rNeg", label: "负进度", ratio: -0.35 },
  { key: "rBig", label: "1e18", ratio: 1e18 },
];

const BODY =
  "# 第一章 极端值取样的动机\n\n一个用了四年的库不会给出干净的两位数：卡片上万、连续记录几百天、书名里混着阿拉伯文与组合附加符。\n\n" +
  "| 档位 | 取值 | 会踩到哪条格式化路径 |\n|---|---|---|\n| 百分比 | 0.5 / 99.6 | Math.round 与 Math.trunc 在此分家 |\n| 计数 | 12000 | 万/千缩写与 toLocaleString 在此分家 |\n| 时间 | 2820000ms | 分钟/小时/天三档进位 |\n\n" +
  "> 若界面在两个地方给出同一个量的两种写法，用户就会花十分钟去证明其中之一是错的。\n\n" +
  "```js\nconst pct = (x) => `${Math.round(x * 100)}%`;\n```\n\n" +
  "## 未读章节\n\n这一节故意留长，用来看卡片浏览来源列与阅读内核页眉在同一条 200 字书名下的截断点是否一致。" +
  pad("渐进阅读的工程判据是：同一个量在两个地方必须长成同一个样子。", 900) + "\n\n";

function titleSpecs() {
  return [
    { key: "t200", title: T200 },
    { key: "tOne", title: T_ONE },
    { key: "tBlank", title: T_BLANK },
    { key: "tRtl", title: T_RTL },
    { key: "tEmoji", title: T_EMOJI },
    { key: "tComb", title: T_COMB },
    { key: "tSurr", title: T_SURR },
    { key: "tMix", title: T_MIX },
  ];
}

async function seed() {
  const db = require(path.join(ROOT, "electron", "db.js"));
  await db.initDb();
  const udir = app.getPath("userData");
  flow.record("沙箱目录", udir);
  const t0 = Date.now();
  /** 由对象生成参数化 INSERT：杜绝"列数与占位符对不齐"这类自伤播种 bug */
  const ins = (table, obj) => {
    const cols = Object.keys(obj);
    db.execRawSql(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => obj[c]));
  };

  // ---------------- S1 60 本书：8 个极端标题 + 8 档进度 + 44 本常规 ----------------
  flow.section("S1 播种 60 本书（极端标题与极端进度档位）");
  const books = [];
  const specs = titleSpecs();
  for (let i = 0; i < 60; i++) {
    const s = specs[i % specs.length];
    const title = i < specs.length ? s.title : `${s.title.length > 30 ? "常规取样" : s.title}·常规本${i}`;
    let r = null;
    try {
      r = db.createFromPaste(title, BODY + `\n\n第 ${i} 本的差异段：${"内容".repeat(30)}\n`);
    } catch (e) {
      r = null;
    }
    if (r && r.id) {
      const b = { id: String(r.id), title: r.title, askedTitle: title, documentId: r.documentId || null, via: "createFromPaste" };
      if (b.title !== title) {
        // 生产入口把首尾空白吃掉了（纯空白标题会整条变空）→ 裸 SQL 钉回原值，界面上才有这一格
        db.execRawSql("UPDATE library_items SET title = ? WHERE id = ?", [title, b.id]);
        b.storedAsIs = false;
        b.wasNormalizedTo = b.title;
        b.title = title;
        b.via = "createFromPaste 改写标题→裸 SQL 钉回";
      }
      books.push(b);
    } else {
      // 生产入口拒收（例如纯空白标题）→ 直接落库，保证界面一定有这一格可看
      const id = uniq();
      const docId = uniq();
      const now = Date.now();
      ins("library_items", { id, user_id: "local-user", title, source_type: "paste", created_at: now, updated_at: now, is_deleted: 0 });
      ins("documents", { id: docId, library_item_id: id, markdown: BODY, created_at: now, updated_at: now, is_deleted: 0 });
      books.push({ id, title, askedTitle: title, documentId: docId, via: "rawInsert(生产入口拒收)", storedAsIs: false });
    }
  }
  let docMissing = 0;
  for (const b of books) {
    if (!b.documentId) {
      const doc = db.getDocument(b.id);
      if (doc) b.documentId = doc.documentId || doc.id || null;
    }
    if (!b.documentId) docMissing++;
  }
  flow.check("60 本书都能取回文档", docMissing === 0, "0 本缺文档", docMissing);
  const rejected = books.filter((b) => b.via.startsWith("raw"));
  flow.record("生产入口拒收的标题（已改走直插）", `${rejected.length} 本：${rejected.map((b) => JSON.stringify(b.askedTitle.slice(0, 6))).join(" ")}`);
  const normalized = books.filter((b) => b.storedAsIs === false && !b.via.startsWith("raw"));
  flow.record("生产入口静默去空白改写的标题", `${normalized.length} 本：${normalized.map((b) => `索${JSON.stringify(b.askedTitle)}→存${JSON.stringify(b.wasNormalizedTo)}`).join(" ")}`);

  // 极端标题必须逐字入库（渲染侧才有对照）
  for (const s of specs) {
    const hit = books.find((b) => b.title === s.title);
    flow.check(`标题 ${s.key}（${[...s.title].length} 码点 / ${s.title.length} 单元）逐字入库`, !!hit, "命中", hit ? hit.id : "未命中");
  }

  // 进度档位挂到前 8 本
  const ratioBookMap = {};
  RATIO_SPEC.forEach((sp, i) => {
    const b = books[i * 4];
    db.execRawSql("UPDATE library_items SET progress_json = ? WHERE id = ?", [JSON.stringify({ ratio: sp.ratio }), b.id]);
    b.ratio = sp.ratio;
    b.ratioKey = sp.key;
    ratioBookMap[sp.key] = { itemId: b.id, title: b.title, ratio: sp.ratio, renderedLabel: sp.label };
  });
  // 第 9 本：progress_json 里放非数字，看渲染侧给什么
  db.execRawSql("UPDATE library_items SET progress_json = ? WHERE id = ?", [JSON.stringify({ ratio: null, fraction: "0.62" }), books[9].id]);
  ratioBookMap.rStr = { itemId: books[9].id, title: books[9].title, ratio: '"0.62"字符串', renderedLabel: "字符串进度" };

  // ---------------- S2 批量卡片（createCard 每张 persist 一次，万张必须走 execRawSql） ----------------
  flow.section("S2 批量卡片");
  const TARGET = 12000;
  const now = Date.now();
  const CARD_SQL =
    "INSERT INTO cards (id,user_id,note_text,card_type,cloze_ords,card_ord,front_markdown,back_markdown,context_prefix,context_ref_json,mnemonic,example,source_ref_json,date_stamp,priority,tags_json,knowledge_point_id,occlusion_json,fsrs_json,leech_json,generated_by,gen_batch_id,created_at,updated_at,sync_version,is_deleted) " +
    "VALUES (?,?,'渐进阅读极端值取样卡片',?,?,0,?,?,?,NULL,NULL,NULL,?,NULL,?, '[]',NULL,NULL,?,NULL,'manual',NULL,?,?,0,0)";
  const bulkIds = [];
  let i = 0;
  for (; i < TARGET; i++) {
    if (i > 200 && i % 500 === 0 && Date.now() - t0 > 55000) break; // 整体预算 55s
    const b = books[i % books.length];
    // 到期分布：220 张今日到期、150 张逾期、其余散布未来 400 天
    let fsrs;
    if (i < 120) fsrs = { state: "review", due: now - int(0, 20) * 3600000, lapses: 1, stability: 3 + (i % 40), difficulty: 5, reps: i % 9, lastReview: now - 10 * DAY };
    else if (i < 220) fsrs = { state: "review", due: now - int(1, 90) * DAY - int(0, 20) * 3600000, lapses: 3, stability: 12 + (i % 60), difficulty: 6, reps: 5, lastReview: now - 100 * DAY };
    else fsrs = { state: "review", due: now + (i % 400) * DAY + int(0, 20) * 3600000, lapses: i % 7, stability: 2 + (i % 200), difficulty: 1 + (i % 10), reps: 1 + (i % 12), lastReview: now - int(1, 60) * DAY };
    const id = uniq();
    ins("cards", {
      id,
      user_id: "local-user",
      note_text: `渐进阅读极端值取样卡片 ${i}`,
      card_type: "qa",
      cloze_ords: "[]",
      card_ord: 0,
      front_markdown: `极端值取样题面 ${i}（用于压一万二千行的排版与计数）`,
      back_markdown: `背面 ${i}：同一个量在两处必须长成同一个样子。`,
      context_prefix: "取样",
      context_ref_json: JSON.stringify({ documentId: b.documentId, anchorText: "极端值取样" }),
      source_ref_json: JSON.stringify({ title: b.title }),
      priority: 50,
      tags_json: "[]",
      fsrs_json: JSON.stringify(fsrs),
      created_at: now - int(1, 900) * DAY,
      updated_at: now,
      is_deleted: 0,
    });
    bulkIds.push({ id, book: b, fsrs });
  }
  flow.record("批量卡片实际条数", `${bulkIds.length} / 目标 ${TARGET} · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  flow.check("批量卡片 ≥ 1000 张（够压计数缩写路径）", bulkIds.length >= 1000, "≥1000", bulkIds.length);

  // ---------------- S3 极端单卡 ----------------
  flow.section("S3 极端单卡（值 / 形状 / 空背面 / 正对照）");
  const created = {};
  const mk = (name, card) => {
    const r = db.createCard(card);
    created[name] = r && r.id ? String(r.id) : false;
    return !!(r && r.id);
  };
  const front5000 = pad("渐进阅读极端值取样卡片题面", 5000);
  flow.check("5000 字符题面的卡入库", mk("front5000", {
    noteText: front5000.slice(0, 40), frontMarkdown: front5000, backMarkdown: "五千字无空白：看它撑破哪一层容器。",
    sourceRef: { title: T200 }, priority: 60,
    fsrsJson: JSON.stringify({ state: "review", due: now + 2 * DAY, lapses: 0, stability: 4, difficulty: 5, reps: 1, lastReview: now - DAY }),
  }), "true", String(created.front5000));
  flow.check("背面为空串（front 非空）的卡入库", mk("emptyBack", {
    noteText: "这张卡的背面是空字符串", frontMarkdown: "背面为空串的卡：题面正常，back_markdown === \"\"。", backMarkdown: "",
    sourceRef: { title: "空背面取样" }, priority: 55,
  }) === true);
  flow.check("背面为纯空白的卡入库", mk("blankBack", {
    noteText: "这张卡的背面只有空白", frontMarkdown: "背面纯空白的卡：back_markdown === \"   \\t \"。", backMarkdown: "   \t ",
    sourceRef: { title: "纯空白背面取样" }, priority: 55,
  }) === true);
  const bothBlank = mk("bothBlank", { noteText: "  ", frontMarkdown: "   ", backMarkdown: "  \t" });
  flow.record("题面与背面皆空白的卡被生产入口拒收", `${bothBlank === false ? "是（批次 E 空白卡闸门生效）" : "否：竟然入库了 " + created.bothBlank}`);
  flow.check("批次E 空白卡闸门仍然生效（全空白卡不得入库）", bothBlank === false, "false", String(bothBlank));

  flow.check("stability=1e12 / difficulty=999 / lapses=9999 的卡入库", mk("bigNum", {
    noteText: "极端 FSRS 数值卡", frontMarkdown: "稳定度 1e12、难度 999、遗忘 9999 三值同体：toFixed(2) 会打出 13 位整数。", backMarkdown: "背面：看卡片详情侧栏怎么打印这三个数。",
    sourceRef: { title: "极端数值取样" }, priority: 80,
    fsrsJson: JSON.stringify({ state: "review", due: now + 3 * DAY, stability: 1e12, difficulty: 999, lapses: 9999, reps: 12, lastReview: now - 200 * DAY }),
  }) === true);
  flow.check("reps=0 而 state=review 的自相矛盾卡入库", mk("repsReview", {
    noteText: "reps=0 却是复习态", frontMarkdown: " reps 为 0 但 state 为 review：一次没复习过的复习卡。", backMarkdown: "背面：看状态徽章与次数是否互相打脸。",
    sourceRef: { title: "矛盾形状取样" }, priority: 40,
    fsrsJson: JSON.stringify({ state: "review", due: now + DAY, stability: 9, difficulty: 5, lapses: 0, reps: 0, lastReview: null }),
  }) === true);
  // 负 priority：insertCard 侧可能归一，落库后用裸 SQL 钉死
  mk("negPriority", {
    noteText: "priority 为负", frontMarkdown: "优先级负数：排序与颜色分档都会吃到它。", backMarkdown: "背面：优先级 -5。",
    sourceRef: { title: "负优先级取样" }, priority: 30,
    fsrsJson: JSON.stringify({ state: "review", due: now - 2 * DAY, stability: 6, difficulty: 5, lapses: 2, reps: 4, lastReview: now - 30 * DAY }),
  });
  db.execRawSql("UPDATE cards SET priority = ? WHERE id = ?", [-5, created.negPriority]);
  flow.record("负优先级已钉死为 -5", String(created.negPriority));

  // 无空白超长 URL 卡（专测 overflow 不折行）
  flow.check("3000 字符无空白 URL 卡入库", mk("url", {
    noteText: "无空白长串", frontMarkdown: "https://example.com/" + "a".repeat(3000), backMarkdown: "背面：拉丁无空白长串是最狠的溢出探针。",
    sourceRef: { title: "长 URL 取样" }, priority: 20,
  }) === true);

  // 每张极端标题的书都挂 3 张卡，让"来源列"和"图注"吃到同一条书名
  for (const s of specs) {
    const b = books.find((x) => x.title === s.title);
    if (!b) continue;
    for (let k = 0; k < 3; k++) {
      const r = db.createCard({
        noteText: `${s.key} 取样卡 ${k}`, frontMarkdown: `极端标题取样 ${s.key} 第 ${k} 张：题面要短，好让书名成为最宽的那个元素。`,
        backMarkdown: `背面 ${k}。`, sourceRef: { title: b.title },
        contextRef: { documentId: b.documentId, anchorText: "极端值取样" }, priority: 50,
        fsrsJson: JSON.stringify({ state: "review", due: now - k * DAY, stability: 5, difficulty: 5, lapses: k, reps: 3, lastReview: now - 20 * DAY }),
      });
      if (r && r.id) bulkIds.push({ id: String(r.id), book: b, fsrs: { state: "review", due: now - k * DAY } });
    }
  }

  // ---------------- S4 复习日志：400 天连续 + 50 年后 + 1970 年 + 47 分钟 + 0ms ----------------
  flow.section("S4 复习日志（400 天连续 / 1970 / +50 年 / 2820000ms / 0ms）");
  const LOG_SQL =
    "INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, fsrs_before_json, fsrs_after_json, leech_before_json, fsrs_config_id, fsrs_before_config_id, review_seq) VALUES (?,?,?,?,?,?,?,?,?,?,?)";
  const cfg = db.getActiveConfigId();
  let seq = 0;
  const today0 = new Date(now).setHours(0, 0, 0, 0);
  let logs = 0;
  const coveredDays = new Set();
  const insert = (cardId, at, rating, dur) => {
    seq++;
    db.execRawSql(LOG_SQL, [
      uniq(), cardId, rating, at, dur,
      JSON.stringify({ state: "review", due: at - DAY, stability: 5, difficulty: 5, lapses: 0, reps: 1 }),
      JSON.stringify({ state: "review", due: at + 4 * DAY, stability: 8, difficulty: 5, lapses: 0, reps: 2 }),
      null, cfg, cfg, seq,
    ]);
    logs++;
  };
  for (let d = 1; d <= 400; d++) {
    for (let k = 0; k < 3; k++) {
      const at = today0 - d * DAY + int(8, 21) * 3600000;
      coveredDays.add(new Date(at).setHours(0, 0, 0, 0));
      insert(bulkIds[(d * 7 + k * 13) % bulkIds.length].id, at, k === 2 ? "Again" : "Good", int(4000, 30000));
    }
  }
  const cA = bulkIds[0], cB = bulkIds[1], cC = bulkIds[2], cD = bulkIds[3];
  insert(cA.id, now + Math.round(50 * 365.25 * DAY), "Good", 9000); // 50 年后
  insert(cB.id, 0, "Good", 8000);                                    // 1970-01-01T00:00:00Z
  insert(cC.id, 1, "Again", 47 * 60 * 1000);                         // 47 分钟（D-TEST-51 口径）
  insert(cD.id, today0 - 401 * DAY, "Good", 0);                      // duration_ms = 0
  insert(cA.id, now - 3600000, "Good", 47 * 60 * 1000 + 29000);      // 47 分 29 秒
  flow.record("日志条数", `${logs} · review_seq 末值 ${seq} · 覆盖 ${coveredDays.size} 个不同日`);
  flow.check("复习日志 ≥ 1000 条（400 天连续需要它）", logs >= 1000, "≥1000", logs);
  flow.check("连续 400 天：400 个不同日每一天都有日志", coveredDays.size >= 400, "≥400 天", coveredDays.size);

  // ---------------- S5 500 知识点 / 300 日记 / 摘录 / 阅读事件 ----------------
  flow.section("S5 500 知识点 + 300 日记 + 摘录与阅读事件");
  const kpRows = [];
  for (let k = 0; k < 500; k++) {
    const label =
      k === 0 ? pad("这是一个两百字以上的知识点标签用来压知识库管理面板的标签列", 210)
        : k === 1 ? T_RTL
        : k === 2 ? T_COMB
        : k === 3 ? T_EMOJI
        : k === 4 ? "   "
        : k === 5 ? "一"
        : `知识点 ${k} · ${["记忆", "调度", "画像", "版式", "约束"][k % 5]}`;
    const id = uniq();
    ins("knowledge_points", {
      id,
      user_id: "local-user",
      canonical_label: label,
      description: `第 ${k} 条知识点描述：用来压列表与搜索框。`,
      status: "active",
      alias_json: "[]",
      language_variants_json: "[]",
      confidence: k % 7 === 0 ? 0.5 : 0.9,
      created_at: now - k * 3600000,
      updated_at: now,
      is_deleted: 0,
    });
    kpRows.push(id);
  }
  flow.eq("500 知识点已插入", kpRows.length, 500);

  const ISO = (ms) => new Date(ms).toISOString().slice(0, 10);
  for (let k = 0; k < 300; k++) {
    const at = today0 - k * DAY;
    const body =
      k === 0
        ? `# 极端日记\n\n一条无空白的超长串：${pad("渐进阅读极端值取样日记正文", 4200)}\n\n进度写成 0.5% 与 99.6% 两档：${T200}`
        : `# ${ISO(at)} 的记录\n\n今日复习 ${1200 + k} 张，连续 ${400 - k} 天，读到 ${T200.slice(0, 30)}… 的 ${k % 100} 处。`;
    ins("journal_entries", {
      id: uniq(), user_id: "local-user", entry_date: ISO(at), content_markdown: body,
      source: "app", is_draft: 0, created_at: at, updated_at: at, sent_at: at, is_deleted: 0,
    });
  }

  for (let k = 0; k < 20; k++) {
    const b = books[k % books.length];
    const r = db.createExtract({
      parentType: "document", parentId: b.documentId, documentId: b.documentId,
      contentMarkdown: k === 0 ? `摘录：${T200}` : `摘录 ${k}：把这一小段留进候选池，等一次判断。`,
      priority: 20 + k * 3, contextRef: { documentId: b.documentId, anchorText: "极端值" },
    });
    if (!r || !r.id) flow.check(`第 ${k} 条摘录入库`, false, "id", JSON.stringify(r));
  }
  // v48.22（D58 §6.8-2）：新建摘录次日进队——种子要的是「当日到期队列」，显式置为已到期
  db.execRawSql("UPDATE extracts SET topic_next_at = ? WHERE is_deleted = 0", [Date.now() - 3600000]);
  let ev = 0;
  for (const bi of [0, 1, 2, 3, 9]) {
    let pos = 200;
    for (let d = 50; d >= 0; d--) {
      pos += int(200, 2000);
      db.execRawSql("INSERT INTO reading_events (id, item_id, char_pos, created_at) VALUES (?,?,?,?)", [uniq(), books[bi].id, pos, today0 - d * DAY + int(8, 22) * 3600000]);
      ev++;
    }
  }
  flow.record("阅读事件条数", ev);

  // ---------------- S6 正对照：一条 fsrs_json.due = null 的卡（界面若渲染出 NaN 才算抓到） ----------------
  flow.section("S6 正对照素材：due=null 的卡");
  const ctlId = uniq();
  ins("cards", {
    id: ctlId,
    user_id: "local-user",
    note_text: "正对照：due 为 null",
    card_type: "qa",
    cloze_ords: "[]",
    card_ord: 0,
    front_markdown: "正对照卡：due=null 且 stability/difficulty 皆 null。",
    back_markdown: "正对照：due 为 null 的取样卡",
    source_ref_json: JSON.stringify({ title: "正对照取样" }),
    priority: 50,
    tags_json: "[]",
    fsrs_json: JSON.stringify({ state: "review", due: null, stability: null, difficulty: null, lapses: null, reps: null }),
    created_at: now,
    updated_at: now,
    is_deleted: 0,
  });
  flow.record("正对照卡 id", ctlId);

  // ---------------- S7 落盘 + 盘上真值 + 清单 ----------------
  flow.section("S7 persistNow → 只读复核 → 写取样清单");
  db.flushJournalPersist();
  db.persistNow();
  const a = await audit(path.join(udir, "library.db"));
  const truth = {
    items: a.count("library_items"),
    documents: a.count("documents"),
    cards: a.count("cards"),
    logs: a.count("review_logs"),
    kps: a.count("knowledge_points"),
    journals: a.count("journal_entries"),
    extracts: a.count("extracts"),
    reading: a.count("reading_events"),
  };
  a.close();
  flow.record("盘上事实", JSON.stringify(truth));
  flow.check("书目 = 60", truth.items, "60", truth.items);
  flow.check("知识点 = 500", truth.kps, "500", truth.kps);
  flow.check("日记 = 300", truth.journals, "300", truth.journals);
  flow.check("卡片 ≥ 12000（含极端单卡）", truth.cards >= 12000, "≥12000", truth.cards);
  flow.check("日志 ≥ 1200", truth.logs >= 1200, "≥1200", truth.logs);

  const st = db.getStatsOverview();
  const q = db.computeTodayQueue();
  const all = db.listAllCards();
  const dbTruth = {
    kpi: st.kpi,
    queueCards: q.cards.length,
    queueDeferred: q.deferred.length,
    queueDamaged: q.damaged.length,
    listAll: all.length,
    damagedInList: all.filter((c) => c.damaged).length,
    heatNonZero: st.heatDays.filter((d) => d.count > 0).length,
    heatLen: st.heatDays.length,
    domainMain: (st.domainMain || []).length,
  };
  flow.record("库侧真值（供 F69 逐屏比对）", JSON.stringify(dbTruth));

  const manifest = {
    seededAt: now,
    DAY,
    udir,
    truth,
    dbTruth,
    cardsActuallySeeded: bulkIds.length,
    books: books.map((b) => ({ id: b.id, documentId: b.documentId, title: b.title, ratio: b.ratio ?? null, ratioKey: b.ratioKey ?? null })),
    extremeTitles: titleSpecs(),
    ratios: ratioBookMap,
    extremeCards: created,
    controlCardId: ctlId,
    logTruth: { logs, streakDays: 400, year50: now + Math.round(50 * 365.25 * DAY), epoch: 0, ms47: 47 * 60 * 1000 },
  };
  fs.writeFileSync(path.join(udir, "f69-seed-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  flow.record("清单已写盘", path.join(udir, "f69-seed-manifest.json"));
  flow.record("播种总用时", `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f69"));
    app.setPath("userData", dir);
    console.log("F69b 沙箱 = " + dir);
    const s = await runFlow(flow, seed);
    quit(s.fail > 0 || s.aborted || s.crash ? 1 : 0);
  })
  .catch((e) => {
    console.log("F69b 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    quit(1);
  });
