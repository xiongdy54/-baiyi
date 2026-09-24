// F38 写 API 的模型化随机长跑（跨模块不变量 · 「多写入口随机交错」这块空地）
// @runtime: electron  @tier: 2  @gui: false  @id: F38  @timeout: 600
// 运行：FLOW_INSTANCE=manual FLOW_SEED=1 npx electron tests/flows/f38-write-fuzz.cjs
//      长跑编排器会自动纳入（run.cjs 每轮重扫目录），每轮换一个 FLOW_SEED。
//      F38_OPS=<n> 改步数；F38_TRACE=1 打印每步摘要（定位用，不进判据）。
//
// 角度：F01–F37 每一条都是**小编排旅程**——铺一层种子，按人写好的顺序走十步，逐步对账。
//       这类流程结构上抓不到「A 模块的写入口把 B 模块的不变量踩了」：顺序是作者挑的，
//       而作者挑不出「撤销 → 改卡 → 合知识点 → 软删书 → 再撤销」这种他自己想不到的组合。
//       本层只做一件事：把 electron/db.js 导出的写入口当对手池，按种子随机抽 ≥250 次，
//       **每一步**都做三方对账：① 影子模型（plain JS，只认「我请求了什么」）
//       ② 落盘 library.db 的原始行（sql.js 只读另开句柄）③ 业务读口。
//       模型不信 db.js 的返回值也不信 db.js 的读口，所以两边不一致就是事实层面的不一致。
//
// 为什么随机交错值得单独成一条：本产品的跨模块不变量恰好都跨在写入口之间——
//   软删除 ↔ 队列（§7.2 / §4.2-20）、撤销 ↔ 审计序（§4.4.9 review_seq）、
//   撤销 ↔ leech ↔ card_issues（§4.4.9 快照集）、参数环境 ↔ 日志归属（§4.4.10）、
//   同源延后 ↔ 当日额度（§4.16）。串行旅程里这些对子各被走一遍且顺序固定；
//   只有随机序能把「撤销落在改卡之后」「软删落在撤销之前」这类反序组合撞出来。
//
// 本层刻意**不**做的三件事（不是放宽，是避免重复登记 / 避免自证）：
//   ① 不裸调 insertFsrsConfig（它不 persist 是已登记 D-TEST-01，落盘补在 optimizer 边界）；
//      改走与 optimizer.applyWeights 逐字同形的路径：插入 → 移指针 → persistNow。
//   ② 不把「软删一本书后卡与摘录留在原地」当缺陷（§7.2 L869 既定设计，D-TEST-20 已撤销）；
//      悬挂判定只认**物理不存在**的父行，父行存在但 is_deleted=1 的单列 Q8 留痕、不判红。
//   ③ 不注入假时间戳（F12/F29/F34 已覆盖时钟语义），本层的 Date.now() 全是真实时刻，
//      因此模型侧凡是产品自己写的时间戳一律记成区间 [lo,hi] 去卡，而不是假装能算准。
//
// 依据：§7.2（落库即落盘 / 软删除 / 引用完整）、§7.1.4（重启不丢数据）、§4.2-20（队列唯一口径）、
//       §4.4.5（fsrs_json 八字段）、§4.4.9（撤销快照集与 review_seq）、§4.4.10（参数环境不可变）、
//       §4.16（同源延后当日额度）、§7.1.3（边界输入不得穿透）、§9.1 M15（引用完整性）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");
const { bootFlowDb, reopenFlowDb, audit, quit, canonical } = require("./lib/dbenv.cjs");

const DAY = 86_400_000;
const N_OPS = Math.max(250, Number(process.env.F38_OPS || 260));
// 「跳过一张已被删掉的卡」在随机池里的占比：这是长跑**自然撞出来**的组合（队列没刷新 → 用户按跳过），
// 不是只有 S6 探针才会去打幽灵 id。调 0 可关掉这条组合。
const F38_DEAD_SKIP = Number(process.env.F38_DEAD_SKIP || 1 / 8);
const TRACE = process.env.F38_TRACE === "1";
const NOPE = "00000000-0000-0000-0000-0000dead"; // 物理不存在的行 id
const cfgMod = require(path.join(ROOT, "electron", "fsrsConfig.js"));

const flow = new Flow({
  id: "F38",
  title: "写 API 模型化随机长跑",
  angle: "全部写入口随机交错 ≥250 次，每步用独立影子模型对账落盘原始行",
  cites: ["§7.2", "§7.1.4", "§4.2-20", "§4.4.5", "§4.4.9", "§4.4.10", "§4.16", "§7.1.3", "§9.1"],
  tier: 2,
  gui: false,
});

const J = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const safeParse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return { __bad: String(s) }; } };
function strip(o, keys) { if (!o || typeof o !== "object") return o; const c = { ...o }; for (const k of keys) delete c[k]; return c; }
// 产品自己写的时间戳只能卡区间（±2s 容差），不能假装算得准
const inSpan = (ts, lo, hi) => { const n = Number(ts); return Number.isFinite(n) && n >= lo && n <= hi; };
// §4.4.5 八字段等值：逐项 ?? null，数组按 JSON 文本比（与 §4.4.9 一致性校验同形）
const FIELDS8 = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
const fsrsKey = (o) => FIELDS8.map((k) => canonical(o ? o[k] ?? null : null)).join("|");
const nz = (v) => (v === undefined || v === null ? null : String(v));

// ============================================================ 影子模型
function newModel() {
  return {
    baseline: {}, // table → 冷启动后的行数（本轮没碰过的表必须一动不动）
    n: {}, // table → 本轮净增行数
    cards: new Map(),
    items: new Map(),
    docs: new Map(),
    extracts: new Map(),
    journal: new Map(),
    kps: new Map(),
    rels: new Map(),
    extRefs: new Map(),
    issues: new Map(),
    logs: [], // {seq, cardId, rating, before, after, leechBefore, cfgId, beforeCfgId, atLo, atHi, dead}
    skips: [],
    readings: [],
    batches: new Map(),
    memRuns: new Map(),
    configs: new Map(), // id → fp（不含 cfg-default）
    activeCfg: "cfg-default",
    seqTop: 0,
  };
}
const gain = (M, t, k = 1) => { M.n[t] = (M.n[t] || 0) + k; };
const liveCards = (M) => [...M.cards.entries()].filter(([, c]) => !c.deleted).map(([id]) => id);
const aliveLogs = (M) => M.logs.filter((l) => !l.dead);
// review_seq 的真实语义：产品取的是「表内 MAX(review_seq)+1」（db.js saveReview 内联算号）。
// 撤销把最大那条**物理删除**之后，下一条评论会把那个号重新用一遍 —— 模型必须跟这个事实一致。
// §4.4.9 承诺的是「表内唯一 + 插入序单调」，不承诺号段永不复用，所以复用本身不算违规。
const nextSeq = (M) => aliveLogs(M).reduce((a, l) => Math.max(a, l.seq), 0) + 1;

// 模型侧的 A-9 优先级归一（有限数→四舍五入钳 [0,100]；非有限→回落 50）
function mNormPriority(v) {
  let num;
  if (typeof v === "number") num = v;
  else if (typeof v === "string" && v.trim() !== "") num = Number(v);
  else return 50;
  if (!Number.isFinite(num)) return 50;
  return Math.min(100, Math.max(0, Math.round(num)));
}

// 模型侧独立实现 §4.2-20 + §4.16 + A-2 值域闸门：输入**磁盘原始行**，输出今日队列 / 延后 / KPI 候选
// damaged 判定照 §4.2-20「损坏行在队列与统计中一致跳过」的口径自己写一遍（不是调 mapCardRow），
// 归一化也照 normalizeFsrs 的语义自己写：fsrs_json 缺失/无 due ⇒ 视作「此刻到期」的新卡。
function mNormalizeFsrs(text, realNow) {
  let p = null;
  try { p = text ? JSON.parse(text) : null; } catch { return { fs: { state: "new", due: realNow, lapses: 0 }, bad: false }; }
  if (!p || typeof p !== "object") return { fs: { state: "new", due: realNow, lapses: 0 }, bad: true };
  if (p.due === undefined) return { fs: { state: "new", due: realNow, lapses: 0 }, bad: false };
  const lr = p.lastReview === null || p.lastReview === undefined ? null : Number(p.lastReview);
  const bad =
    (p.stability !== undefined && !(Number.isFinite(Number(p.stability)) && Number(p.stability) > 0)) ||
    (p.difficulty !== undefined && !(Number(p.difficulty) >= 1 && Number(p.difficulty) <= 10)) ||
    (p.due !== undefined && !Number.isFinite(Number(p.due))) ||
    (lr !== null && !Number.isFinite(lr)) ||
    (p.lapses !== undefined && !(Number(p.lapses) >= 0)) ||
    (p.reps !== undefined && !(Number(p.reps) >= 0)) ||
    (lr !== null && lr > realNow + DAY);
  return { fs: p, bad };
}
function modelQueue(cardRows, logRows, nowMs, cutoffHour) {
  const realNow = Date.now();
  const d0 = new Date(nowMs); d0.setHours(cutoffHour, 0, 0, 0);
  const day0 = d0.getTime(); const day1 = day0 + DAY;
  const live = [];
  for (const r of cardRows) {
    if (Number(r.is_deleted) !== 0) continue;
    let leech = null;
    try { leech = r.leech_json ? JSON.parse(r.leech_json) : null; } catch { continue; } // leech 判不出挂起 ⇒ 跳过
    if (leech && leech.suspended) continue;
    const { fs, bad } = mNormalizeFsrs(r.fsrs_json, realNow);
    if (bad) continue; // 值域非法 ⇒ 与队列/统计一致跳过（§4.2-20）
    live.push({ id: nz(r.id), due: Number(fs.due), state: fs.state, priority: Number(r.priority), createdAt: Number(r.created_at), siblingKey: r.sibling_key ? nz(r.sibling_key) : null });
  }
  const cand = live.filter((c) => c.due <= nowMs);
  const liveById = new Map(live.map((c) => [c.id, c]));
  const reviewedByKey = new Map(); // 组内当日已评分（含 due 已推到未来的兄弟卡，同 §4.16 item 4）
  for (const l of logRows) {
    const at = Number(l.reviewed_at);
    if (!(at >= day0 && at < day1)) continue;
    const c = liveById.get(nz(l.card_id));
    if (!c || !c.siblingKey) continue;
    if (!reviewedByKey.has(c.siblingKey)) reviewedByKey.set(c.siblingKey, new Set());
    reviewedByKey.get(c.siblingKey).add(c.id);
  }
  const order = (a, b) => a.due - b.due || (b.priority ?? 50) - (a.priority ?? 50) || a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id));
  const eligible = (c) => (c.state === "learning" || c.state === "relearning" ? false : c.state === "new" || c.state === "review");
  const groups = new Map();
  for (const c of cand) { if (!c.siblingKey) continue; if (!groups.has(c.siblingKey)) groups.set(c.siblingKey, []); groups.get(c.siblingKey).push(c); }
  const deferred = new Set();
  for (const [key, members] of groups) {
    const reviewed = reviewedByKey.get(key) || new Set();
    const revealable = members.filter((m) => eligible(m) && !reviewed.has(m.id)).sort(order);
    const keep = Math.max(0, Math.min(1 - reviewed.size, revealable.length)); // perDay 默认 1
    for (let i = keep; i < revealable.length; i++) deferred.add(revealable[i].id);
  }
  const sorted = cand.filter((c) => !deferred.has(c.id)).sort(order).map((c) => c.id);
  return {
    order: sorted, members: new Set(sorted), deferred,
    candidates: new Set(cand.map((c) => c.id)),
    today0: day0, today24: day1,
    dueLeToday: new Set(live.filter((c) => c.due <= day1).map((c) => c.id)),
  };
}

// ============================================================ 每步不变量电池
// 返回违规清单（空 = 全过）。tag 用来把违规钉到具体那一步（复现用）。
function battery(M, aud, lo, hi, tag, prevCounts) {
  const V = [];
  const push = (s) => V.push(`${tag} ${s}`);
  const want = {
    cards: M.cards.size, review_logs: aliveLogs(M).length, review_skips: M.skips.length,
    reading_events: M.readings.length, library_items: M.items.size, documents: M.docs.size,
    extracts: M.extracts.size, journal_entries: M.journal.size, knowledge_points: M.kps.size,
    knowledge_relations: M.rels.size, knowledge_external_refs: M.extRefs.size,
    card_issues: M.issues.size, ai_gen_batches: M.batches.size, memory_runs: M.memRuns.size,
    fsrs_configs: M.configs.size + 1,
  };
  // (0) 落盘 ↔ 模型：每张表逐行内容也在这里对（不只行数）
  for (const t of Object.keys(want)) {
    const got = aud.count(t);
    if (got !== want[t]) {
      push(`(0) 落盘行数≠模型 ${t}: 期望 ${want[t]} 实际 ${got}`);
    }
  }
  // (f) 只读步不得让任何表悄悄长行 / 改内容
  if (prevCounts) {
    const now = countsOf(aud);
    for (const t of Object.keys(now)) if (now[t] !== (prevCounts[t] || 0)) push(`(f) 只读步改动了表 ${t} 的行数: ${prevCounts[t] || 0} → ${now[t]}`);
  }
  // ---- 卡：逐行内容 ↔ 模型 ----
  const diskCards = new Map();
  for (const r of aud.rows("SELECT * FROM cards")) diskCards.set(nz(r.id), r);
  for (const [id, c] of M.cards) {
    const r = diskCards.get(nz(id));
    if (!r) { push(`(h) 模型里的卡 ${id} 在磁盘上不存在（写入口没落盘？）`); continue; }
    if (Number(r.is_deleted) !== (c.deleted ? 1 : 0)) push(`(d) 卡 ${id} is_deleted=${r.is_deleted} 模型=${c.deleted ? 1 : 0}`);
    if (Number(r.priority) !== c.priority) push(`(g) 卡 ${id} priority=${r.priority} 模型=${c.priority}（A-9 钳位/回落口径两边不一致）`);
    if (nz(r.note_text) !== nz(c.note_text)) push(`卡 ${id} note_text=${nz(r.note_text)} 模型=${nz(c.note_text)}`);
    if (nz(r.front_markdown) !== nz(c.front)) push(`卡 ${id} front=${nz(r.front_markdown)} 模型=${nz(c.front)}`);
    if (nz(r.knowledge_point_id) !== nz(c.kp)) push(`卡 ${id} knowledge_point_id=${nz(r.knowledge_point_id)} 模型=${nz(c.kp)}`);
    if (nz(r.sibling_key) !== nz(c.sibling)) push(`卡 ${id} sibling_key=${nz(r.sibling_key)} 模型=${nz(c.sibling)}`);
    if (fsrsKey(safeParse(r.fsrs_json)) !== fsrsKey(c.fsrs)) push(`(c) 卡 ${id} fsrs_json=${nz(r.fsrs_json)} 模型=${J(c.fsrs)}`);
    if (nz(r.fsrs_config_id) !== nz(c.fsrsCfgId)) push(`(c) 卡 ${id} fsrs_config_id=${nz(r.fsrs_config_id)} 模型=${nz(c.fsrsCfgId)}（§4.4.10 归属）`);
    if (canonical(strip(safeParse(r.leech_json), ["suspendedAt", "resolvedAt"])) !== canonical(strip(c.leech, ["suspendedAt", "resolvedAt"]))) push(`(d) 卡 ${id} leech_json=${nz(r.leech_json)} 模型=${J(c.leech)}`);
    if (!inSpan(r.created_at, c.createdAtLo, c.createdAtHi)) push(`卡 ${id} created_at=${r.created_at} 越出 [${c.createdAtLo},${c.createdAtHi}]`);
  }
  for (const id of diskCards.keys()) if (!M.cards.has(id)) push(`(f) 磁盘上多出一张模型没有的卡 ${id}`);
  // ---- 日志 ↔ 模型；(b) 全局序性质 ----
  const diskLogs = aud.rows("SELECT * FROM review_logs ORDER BY review_seq");
  const seenSeq = new Set();
  for (const r of diskLogs) {
    const seq = Number(r.review_seq);
    if (seenSeq.has(seq)) push(`(b) review_seq 重复：${seq} 出现两次（§4.4.9 唯一性）`);
    seenSeq.add(seq);
    const m = M.logs.find((l) => !l.dead && l.seq === seq);
    if (!m) { push(`(b) 磁盘有模型没有的日志 seq=${seq}（谁绕开写入口插的？）`); continue; }
    if (nz(r.card_id) !== nz(m.cardId)) push(`(c) 日志 seq=${seq} card_id=${nz(r.card_id)} 模型=${nz(m.cardId)}`);
    if (nz(r.rating) !== nz(m.rating)) push(`(i) 日志 seq=${seq} rating=${nz(r.rating)} 模型=${nz(m.rating)}`);
    if (fsrsKey(safeParse(r.fsrs_after_json)) !== fsrsKey(m.after)) push(`(c) 日志 seq=${seq} fsrs_after_json 漂移`);
    if (fsrsKey(safeParse(r.fsrs_before_json)) !== fsrsKey(m.before)) push(`(c) 日志 seq=${seq} fsrs_before_json 漂移`);
    if (nz(r.fsrs_config_id) !== nz(m.cfgId)) push(`(c) 日志 seq=${seq} fsrs_config_id=${nz(r.fsrs_config_id)} 模型=${nz(m.cfgId)}`);
    if (nz(r.fsrs_before_config_id) !== nz(m.beforeCfgId)) push(`(c) 日志 seq=${seq} before_config_id 漂移`);
    if (!inSpan(r.reviewed_at, m.atLo, m.atHi)) push(`日志 seq=${seq} reviewed_at=${r.reviewed_at} 越界`);
  }
  const wantSeqs = aliveLogs(M).map((l) => l.seq).sort((a, b) => a - b);
  const gotSeqs = diskLogs.map((r) => Number(r.review_seq)).sort((a, b) => a - b);
  if (J(wantSeqs) !== J(gotSeqs)) push(`(b) review_seq 集合不等 期望[${wantSeqs.join(",")}] 实际[${gotSeqs.join(",")}]`);
  for (let i = 1; i < gotSeqs.length; i++) if (!(gotSeqs[i] > gotSeqs[i - 1])) push(`(b) review_seq 非单调`);
  // (c) 撤销不留半态：最后一次写卡是评分、此后没有旁路写的卡，卡面必须 == 该卡最新日志的 after
  for (const [id, c] of M.cards) {
    if (c.deleted || c.editedSinceReview) continue;
    const mine = M.logs.filter((l) => !l.dead && nz(l.cardId) === nz(id)).sort((a, b) => a.seq - b.seq);
    if (!mine.length) continue;
    const last = mine[mine.length - 1];
    if (fsrsKey(c.fsrs) !== fsrsKey(last.after)) push(`(c) 卡 ${id} 卡态与最新日志 after 不同步（撤销/评分账目断裂）`);
    if (nz(c.fsrsCfgId) !== nz(last.cfgId)) push(`(c) 卡 ${id} fsrs_config_id=${nz(c.fsrsCfgId)} ≠ 最新日志 ${nz(last.cfgId)}`);
  }
  // (a) 悬挂：子行指向**物理不存在**的父行
  const idSet = (sql) => new Set(aud.rows(sql).map((r) => nz(Object.values(r)[0])));
  const cardIds = idSet("SELECT id FROM cards");
  const itemIds = idSet("SELECT id FROM library_items");
  const docIds = idSet("SELECT id FROM documents");
  const kpIds = idSet("SELECT id FROM knowledge_points");
  for (const r of aud.rows("SELECT id, card_id FROM review_skips")) if (!cardIds.has(nz(r.card_id))) push(`(a) review_skips(${nz(r.id)}) 指向物理不存在的卡 ${nz(r.card_id)}`);
  for (const r of aud.rows("SELECT id, card_id FROM card_issues")) if (!cardIds.has(nz(r.card_id))) push(`(a) card_issues(${nz(r.id)}) 悬挂在卡 ${nz(r.card_id)}`);
  for (const r of aud.rows("SELECT id, card_id FROM review_logs")) if (!cardIds.has(nz(r.card_id))) push(`(a) review_logs(${nz(r.id)}) 悬挂在卡 ${nz(r.card_id)}`);
  for (const r of aud.rows("SELECT id, item_id FROM reading_events")) if (!itemIds.has(nz(r.item_id))) push(`(a) reading_events(${nz(r.id)}) 悬挂在书目 ${nz(r.item_id)}`);
  for (const r of aud.rows("SELECT id, document_id FROM extracts")) if (!docIds.has(nz(r.document_id))) push(`(a) extracts(${nz(r.id)}) 悬挂在文档 ${nz(r.document_id)}`);
  for (const r of aud.rows("SELECT id, knowledge_point_id FROM knowledge_external_refs")) if (!kpIds.has(nz(r.knowledge_point_id))) push(`(a) external_refs(${nz(r.id)}) 悬挂在知识点 ${nz(r.knowledge_point_id)}`);
  for (const r of aud.rows("SELECT id, from_knowledge_point_id AS a, to_knowledge_point_id AS b FROM knowledge_relations")) {
    if (!kpIds.has(nz(r.a))) push(`(a) 关系边 ${nz(r.id)} 起点悬空 ${nz(r.a)}`);
    if (!kpIds.has(nz(r.b))) push(`(a) 关系边 ${nz(r.id)} 终点悬空 ${nz(r.b)}`);
  }
  for (const r of aud.rows("SELECT id, knowledge_point_id FROM cards WHERE knowledge_point_id IS NOT NULL AND knowledge_point_id <> ''")) {
    if (!kpIds.has(nz(r.knowledge_point_id))) push(`(a) 卡 ${nz(r.id)} 的 knowledge_point_id=${nz(r.knowledge_point_id)} 指向物理不存在的知识点`);
  }
  for (const r of aud.rows("SELECT id, parent_id FROM extracts WHERE parent_type='document'")) {
    if (!docIds.has(nz(r.parent_id))) push(`(a) extracts(${nz(r.id)}) 的 parent_id=${nz(r.parent_id)} 指向物理不存在的文档`);
  }
  return V;
}

function countsOf(aud) { const o = {}; for (const t of aud.tables()) if (!t.startsWith("sqlite_")) o[t] = aud.count(t); return o; }
function snapTables(aud, stripCols) {
  const out = {};
  for (const t of aud.tables()) {
    if (t.startsWith("sqlite_")) continue;
    out[t] = aud.all(t).map((r) => {
      if (!stripCols) return canonical(r);
      const c = {}; for (const k of Object.keys(r)) if (!stripCols.includes(k)) c[k] = r[k];
      return canonical(c);
    }).sort().join("\u0001");
  }
  return out;
}

// ============================================================ 随机写入口池
const OPS = [];
const op = (key, w, run) => OPS.push({ key, w, run });
let SEQN = 0;
const mkFsrs = (state, o = {}) => ({
  state, due: o.due ?? Date.now() + 3600000, lapses: o.lapses ?? 0,
  stability: o.stability ?? 4.5, difficulty: o.difficulty ?? 5.5,
  reps: o.reps ?? 0, lastReview: o.lastReview ?? null, learningSteps: o.learningSteps ?? [],
});

op("createMaterial", 3, (db, M, S) => {
  const i = ++SEQN;
  const r = db.createFromPaste(`F38 书 ${i}`, `# 第${i}章\n\nF38 随机长跑正文 ${i}。`);
  M.items.set(nz(r.id), { deleted: false, docId: nz(r.documentId) });
  M.docs.set(nz(r.documentId), { itemId: nz(r.id), deleted: false });
  gain(M, "library_items"); gain(M, "documents");
});

op("createCardsBatch", 14, (db, M, S, rng) => {
  const n = 1 + rng.int(4);
  const docs = [...M.docs.keys()];
  const kps = [...M.kps.keys()].filter((k) => M.kps.get(k).status === "active");
  const sibling = rng.bool(1 / 3) ? `sib-${SEQN}` : null;
  const base = ++SEQN;
  for (let i = 0; i < n; i++) {
    // S1 只用**合法**引用：这样 (a) 组一旦报悬挂就是产品造出来的，不是我自造的探针。
    // 幽灵父引用的写入口普查放在 S2（那里是「诚实性探针」的地盘）。
    const ctx = docs.length && !rng.bool(0.15) ? { documentId: rng.pick(docs) } : null;
    const kp = kps.length && rng.bool(0.4) ? rng.pick(kps) : null;
    const st = rng.pick(["new", "new", "review", "learning"]);
    const due = st === "learning" ? Date.now() + 600000 : rng.bool(0.7) ? Date.now() - rng.int(72) * 3600000 : Date.now() + (1 + rng.int(30)) * DAY;
    const fsrs = mkFsrs(st, { due, lapses: rng.int(3), reps: rng.int(4) });
    const rawP = rng.pick([0, 20, 50, 77, 100, -5, 999, "63", 49.6]);
    const note = `F38 卡 ${base}-${i}`;
    const front = `问 ${base}-${i}`;
    const t = Date.now();
    const r = db.createCard({
      noteText: note, cardType: "qa", frontMarkdown: front, backMarkdown: `答 ${base}-${i}`,
      priority: rawP, tags: [`f38${i % 2}`], domain: ["51"], contextRef: ctx,
      knowledgePointId: kp, siblingKey: sibling, fsrsJson: JSON.stringify(fsrs),
    });
    if (!r || !r.id) { S.note = "createCard 拒收"; continue; }
    M.cards.set(nz(r.id), {
      deleted: false, priority: mNormPriority(rawP), note_text: note, front, kp: kp || null,
      sibling: sibling || null, fsrs, fsrsCfgId: M.activeCfg, leech: null, editedSinceReview: false,
      createdAtLo: t, createdAtHi: Date.now() + 2000,
    });
    gain(M, "cards");
  }
});

op("rate", 22, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) { S.note = "无活卡"; return; }
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const before = clone(c.fsrs) || mkFsrs("new");
  const rating = rng.pick(["Again", "Hard", "Good", "Easy"]);
  // 1/6 概率把 lapses 顶到 ≥8：这是 §4.4.9「本次评分触发 leech」的唯一入口，撤销要精确回退 leech
  const escalating = rng.bool(1 / 6);
  const after = {
    state: rating === "Again" ? "relearning" : "review",
    due: Date.now() + (1 + rng.int(20)) * DAY,
    lapses: escalating ? 8 + rng.int(3) : rating === "Again" ? (before.lapses || 0) + 1 : (before.lapses || 0),
    stability: Math.max(0.2, (before.stability || 1) * 1.4),
    difficulty: Math.min(10, Math.max(1, (before.difficulty || 5) + 0.2)),
    reps: (before.reps || 0) + 1, lastReview: Date.now(), learningSteps: [],
  };
  const seq = nextSeq(M);
  const t = Date.now();
  const beforeCfg = c.fsrsCfgId;
  let threw = null;
  try { db.saveReview(id, after, rating, 500 + rng.int(4000), before); } catch (e) { threw = String(e.message || e); }
  if (threw) { S.note = `saveReview抛错:${threw.slice(0, 40)}`; M.lastRateErr = threw; return; }
  M.seqTop = seq; // 保留仅为可读性；真正的号源是 nextSeq(M)
  M.logs.push({ seq, cardId: id, rating, before, after, leechBefore: clone(c.leech), cfgId: M.activeCfg, beforeCfgId: beforeCfg, atLo: t, atHi: Date.now() + 2000, dead: false });
  c.fsrs = after; c.fsrsCfgId = M.activeCfg; c.editedSinceReview = false;
  gain(M, "review_logs");
});

op("rateInvalidGrade", 3, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const before = clone(c.fsrs) || mkFsrs("new");
  const rating = rng.pick(["Delete", "", "5", "again", "Good ", null]);
  const after = { ...clone(before), state: "review", due: Date.now() + DAY, reps: (before.reps || 0) + 1, lastReview: Date.now() };
  const seq = nextSeq(M);
  const t = Date.now();
  let threw = null;
  try { db.saveReview(id, after, rating, 1000, before); } catch (e) { threw = String(e.message || e); }
  S.note = `非法评级 ${J(rating)} → ${threw ? "拒" : "入库(!)"}`;
  if (threw) return;
  M.logs.push({ seq, cardId: id, rating: rating === null ? "null" : rating, before, after, leechBefore: clone(c.leech), cfgId: M.activeCfg, beforeCfgId: c.fsrsCfgId, atLo: t, atHi: Date.now() + 2000, dead: false });
  c.fsrs = after; c.fsrsCfgId = M.activeCfg; c.editedSinceReview = false;
  gain(M, "review_logs");
});

op("rateStale", 2, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const stale = { ...clone(c.fsrs), reps: Math.max(0, (c.fsrs.reps || 0) - 1), lastReview: (c.fsrs.lastReview || Date.now()) - DAY };
  const after = { ...clone(c.fsrs), state: "review", due: Date.now() + 3 * DAY, reps: (c.fsrs.reps || 0) + 1, lastReview: Date.now() };
  const t = Date.now();
  let threw = null;
  try { db.saveReview(id, after, "Good", 800, stale); } catch (e) { threw = String(e.message).slice(0, 30); }
  S.note = `陈旧写=${threw ? "拒" : "放行(!)"}`;
  if (!threw) {
    const seq = nextSeq(M);
    M.logs.push({ seq, cardId: id, rating: "Good", before: stale, after, leechBefore: clone(c.leech), cfgId: M.activeCfg, beforeCfgId: c.fsrsCfgId, atLo: t - 2000, atHi: Date.now() + 2000, dead: false });
    c.fsrs = after; c.fsrsCfgId = M.activeCfg; c.editedSinceReview = false; gain(M, "review_logs");
  }
});

op("undo", 14, (db, M, S, rng) => {
  const steps = rng.bool(0.3) ? 2 + rng.int(3) : 1;
  for (let s = 0; s < steps; s++) {
    // 模型独立算「该撤哪条」：最新 seq ∧ 有前后快照 ∧ 卡未删 ∧ 卡态==after（§4.4.9）
    const alive = aliveLogs(M);
    const newestAlive = alive.reduce((a, l) => Math.max(a, l.seq), 0);
    const cand = alive.filter((l) => l.before && l.after).sort((a, b) => b.seq - a.seq)
      .find((l) => { const c = M.cards.get(l.cardId); return c && !c.deleted && fsrsKey(c.fsrs) === fsrsKey(l.after); });
    const r = db.undoLastReview();
    if (!r || !r.ok) { S.note = `undo#${s} 拒:${r && r.reason}`; if (cand) S.bad = (S.bad || "") + `模型认为 seq=${cand.seq} 可撤，读口却拒：${r && r.reason}；`; return; }
    if (!cand) { S.bad = (S.bad || "") + "撤销了模型认定不可撤销的一条；"; return; }
    // 「撤销回退的是最近一次复习」吗？撤的不是表内最大 seq = 用户按下去回退的不是他刚做的那次
    if (cand.seq !== newestAlive) S.undoSkippedNewer = `撤了 seq=${cand.seq}，当时表内最大 seq=${newestAlive}`;
    const c = M.cards.get(cand.cardId);
    c.fsrs = cand.before; c.fsrsCfgId = cand.beforeCfgId || null;
    const triggeredLeech = (cand.after.lapses || 0) >= 8 && !(cand.leechBefore && cand.leechBefore.isLeech === true);
    if (triggeredLeech) {
      c.leech = cand.leechBefore;
      for (const [, i] of M.issues) if (nz(i.cardId) === nz(cand.cardId) && i.status === "open" && i.ruleId === "LEECH") i.status = "dismissed";
    }
    cand.dead = true; c.editedSinceReview = false;
    gain(M, "review_logs", -1);
    S.note = `undo#${s} seq=${cand.seq}${triggeredLeech ? " 触发leech回退" : ""}`;
  }
});

op("skip", 5, (db, M, S, rng) => {
  // 真实用户序：卡在今日队列里 → 另一个视图把它删了 / 另一条路径删了书 → 用户仍按「跳过」。
  // 12 次里给 1 次打在**本轮已被软删**的卡上（这是交错长跑独有的组合，人工旅程不会排到它）。
  const deleted = [...M.cards.entries()].filter(([, c]) => c.deleted).map(([id]) => id);
  const ids = liveCards(M);
  const target = deleted.length && rng.bool(F38_DEAD_SKIP) ? rng.pick(deleted) : ids.length ? rng.pick(ids) : null;
  if (!target) return;
  db.saveSkip(target);
  M.skips.push({ cardId: target, ghost: !ids.includes(target) });
  gain(M, "review_skips");
  S.note = M.skips[M.skips.length - 1].ghost ? "跳过了一张已删的卡" : "";
});

// 幽灵卡跳过（saveSkip 不校验父行）不进 S1 随机池：S1 的 (a) 组必须只报产品自己造出的悬挂，
// 否则我自造的探针会把真信号淹掉。它作为诚实性探针在 S2 单列。

op("editCard", 10, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const front = `问·改${rng.int(999)}`;
  const r = db.updateCard({
    id, noteText: c.note_text, cardType: "qa", frontMarkdown: front, backMarkdown: `答·改${rng.int(99)}`,
    priority: c.priority, tags: ["f38e"], domain: ["51"], knowledgePointId: c.kp,
    fsrs: clone(c.fsrs), leech: c.leech == null ? undefined : clone(c.leech),
  });
  if (r === false) { S.note = "updateCard 返回 false（卡不在？）"; return; }
  c.front = front; c.editedSinceReview = true;
});

op("changePriority", 8, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const raw = rng.pick([0, 1, 50, 99, 100, -3, 101, 1e9, "72", 12.4, NaN, null, undefined, "abc"]);
  db.updateCard({ id, noteText: c.note_text, frontMarkdown: c.front, backMarkdown: "答", priority: raw, tags: ["f38p"], domain: ["51"], knowledgePointId: c.kp, fsrs: clone(c.fsrs), leech: c.leech == null ? undefined : clone(c.leech) });
  const got = db.getCard(id);
  c.priority = mNormPriority(raw); c.editedSinceReview = true;
  S.note = `priority ${J(raw)}→盘上${got ? got.priority : "?"} 模型${c.priority}`;
  if (got && Number(got.priority) !== c.priority) S.bad = `A-9 归一口径分叉：${J(raw)} 盘上${got.priority} 模型${c.priority}`;
});

op("suspend", 6, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const on = rng.bool();
  db.setCardSuspended(id, on, on ? "F38 暂停" : null);
  const l = clone(c.leech) || {};
  l.suspended = on; l.suspendedAt = on ? Date.now() : null; if (on) l.reason = "F38 暂停";
  c.leech = l;
  S.note = `suspend=${on}`;
});

op("leechIssue", 5, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const asLeech = rng.bool(0.4);
  const ruleId = asLeech ? "LEECH" : "F38";
  const r = db.addCardIssue({ cardId: id, ruleId, severity: "warn", message: "F38 提示", source: "lint" });
  if (r && r.id) { M.issues.set(nz(r.id), { cardId: id, status: "open", ruleId }); gain(M, "card_issues"); }
  // 注意：addCardIssue **不碰 cards.leech_json**（模型侧因此也不改），leech 标记走 updateCardLeech。
});

op("markLeech", 4, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  const c = M.cards.get(id);
  const on = rng.bool();
  const patch = on ? { isLeech: true, suspended: true, suspendedAt: Date.now() } : { isLeech: false };
  const r = db.updateCardLeech(id, patch);
  if (r === null) { S.note = "leech 标记返回 null"; return; }
  c.leech = { ...(clone(c.leech) || {}), ...patch };
  S.note = on ? "标记 leech 并挂起" : "解除 leech";
});

op("resolveIssue", 3, (db, M, S, rng) => {
  const open = [...M.issues.entries()].filter(([, i]) => i.status === "open");
  if (!open.length) return;
  const [id] = rng.pick(open);
  db.resolveCardIssue(id);
  M.issues.get(id).status = "fixed";
});

op("deleteCard", 7, (db, M, S, rng) => {
  const ids = liveCards(M);
  if (!ids.length) return;
  const id = rng.pick(ids);
  if (db.deleteCard(id) !== true) { S.note = "deleteCard 返回非真"; return; }
  M.cards.get(id).deleted = true;
  for (const [, i] of M.issues) if (nz(i.cardId) === nz(id) && i.status === "open") i.status = "dismissed";
});

op("deleteItem", 4, (db, M, S, rng) => {
  const live = [...M.items.entries()].filter(([, v]) => !v.deleted);
  if (!live.length) return;
  const [id, v] = rng.pick(live);
  if (db.deleteItem(id) !== true) return;
  v.deleted = true;
  if (M.docs.has(v.docId)) M.docs.get(v.docId).deleted = true;
});

op("createKp", 5, (db, M, S, rng) => {
  const i = ++SEQN;
  const domainId = rng.pick(["51", "316", "bogus"]);
  const r = db.createKnowledgePoint({ canonicalLabel: `F38 概念 ${i}`, description: `说明 ${i}`, domainId });
  M.kps.set(nz(r.id), { label: `F38 概念 ${i}`, status: "active", mergedInto: null, aliases: [], domainId });
  gain(M, "knowledge_points");
});

op("updateKp", 3, (db, M, S, rng) => {
  const live = [...M.kps.entries()].filter(([, v]) => v.status === "active");
  if (!live.length) return;
  const [id, v] = rng.pick(live);
  db.updateKnowledgePoint(id, { description: "F38 改过", confidence: rng.int(100) / 100 });
  S.note = nz(db.getKnowledgePoint(id).status);
});

op("mergeKp", 3, (db, M, S, rng) => {
  const act = [...M.kps.entries()].filter(([, v]) => v.status === "active");
  if (act.length < 2) return;
  const [sid, sv] = rng.pick(act);
  const [tid, tv] = rng.pick(act.filter((x) => x[0] !== sid));
  try { db.mergeKnowledgePoints(sid, tid); } catch (e) { S.note = "合并被拒"; return; }
  sv.status = "merged"; sv.mergedInto = tid;
  tv.aliases = [...tv.aliases, sv.label];
});

op("unmergeKp", 2, (db, M, S, rng) => {
  const merged = [...M.kps.entries()].filter(([, v]) => v.status === "merged");
  if (!merged.length) return;
  const [id, v] = rng.pick(merged);
  try { db.unmergeKnowledgePoint(id); } catch { S.note = "回滚被拒"; return; }
  const tgt = v.mergedInto ? M.kps.get(v.mergedInto) : null;
  v.status = "active"; v.mergedInto = null;
  if (tgt) tgt.aliases = tgt.aliases.filter((a) => a !== v.label);
});

op("createRel", 4, (db, M, S, rng) => {
  const act = [...M.kps.entries()].filter(([, v]) => v.status === "active");
  if (act.length < 2) return;
  const a = rng.pick(act); const b = rng.pick(act);
  const type = rng.pick(["related_to", "part_of", "example_of", "prerequisite", "contrasts_with"]);
  if (a[0] === b[0]) return;
  if ([...M.rels.values()].some((r) => nz(r.from) === nz(a[0]) && nz(r.to) === nz(b[0]) && r.type === type)) return;
  let threw = null;
  try { db.createKnowledgeRelation({ fromKnowledgePointId: a[0], toKnowledgePointId: b[0], relationType: type }); } catch (e) { threw = String(e.message).slice(0, 20); }
  if (threw) { S.note = `建边被拒(${threw})`; return; }
  M.rels.set(`${a[0]}|${b[0]}|${type}`, { from: a[0], to: b[0], type, deleted: false });
  gain(M, "knowledge_relations");
});

op("deleteRel", 2, (db, M, S, rng) => {
  const live = [...M.rels.entries()].filter(([, r]) => !r.deleted);
  if (!live.length) return;
  const [k, v] = rng.pick(live);
  if (db.deleteKnowledgeRelation(k) !== true) { S.note = "删边返回非真"; return; }
  M.rels.get(k).deleted = true;
});

op("createExtract", 4, (db, M, S, rng) => {
  const docs = [...M.docs.entries()].filter(([, v]) => !v.deleted);
  if (!docs.length) return;
  const [docId] = rng.pick(docs);
  const i = ++SEQN;
  const r = db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: `F38 摘录 ${i}`, priority: rng.pick([50, 71, -9, 200]) });
  if (r && r.id) { M.extracts.set(nz(r.id), { docId, intervalDays: 1, deleted: false }); gain(M, "extracts"); }
});

op("deferExtract", 4, (db, M, S, rng) => {
  const live = [...M.extracts.entries()].filter(([, v]) => !v.deleted);
  if (!live.length) return;
  const [id, v] = rng.pick(live);
  const r = db.postponeExtract(id);
  if (r) v.intervalDays = Math.min(v.intervalDays * 1.6, 180);
  S.note = r ? `interval→${r.intervalDays}` : "延后返回 null";
});

op("journalDraftSend", 5, (db, M, S, rng) => {
  const i = ++SEQN;
  db.saveJournalDraft(`F38 草稿 ${i}`);
  const dr = db.getJournalDraft();
  if (!dr) { S.note = "草稿没建起来"; return; }
  M.journal.set(nz(dr.id), { draft: true, deleted: false, content: `F38 草稿 ${i}`, source: "capture" });
  gain(M, "journal_entries");
  db.sendJournalDraft(`F38 草稿 ${i} 定稿`);
  const e = M.journal.get(nz(dr.id));
  if (e) { e.draft = false; e.content = `F38 草稿 ${i} 定稿`; }
  S.note = "draft→send";
});

op("journalCreate", 3, (db, M, S) => {
  const i = ++SEQN;
  const r = db.createJournalEntry({ contentMarkdown: `F38 日记 ${i}`, source: "app" });
  M.journal.set(nz(r.id), { draft: false, deleted: false, content: `F38 日记 ${i}`, source: "app" });
  gain(M, "journal_entries");
});

op("journalDelete", 2, (db, M, S, rng) => {
  const live = [...M.journal.entries()].filter(([, v]) => !v.deleted);
  if (!live.length) return;
  const [id, v] = rng.pick(live);
  if (db.deleteJournalEntry(id) === true) { v.deleted = true; v.draft = false; }
});

// 参数环境：走 optimizer.applyWeights 的同一形状（插入 → 移指针 → 落盘），
// 不裸调 insertFsrsConfig（它不落盘是已登记 D-TEST-01，落盘补在本边界）。
op("applyWeights", 3, (db, M, S, rng) => {
  const w = cfgMod.FSRS6_DEFAULT_WEIGHTS.slice();
  if (rng.bool()) w[rng.int(w.length)] = Math.round((w[0] + rng.int(1000)) / 1000);
  const fp = cfgMod.configFingerprint(w, cfgMod.DEFAULT_SCHEDULER_OPTIONS);
  const id = db.insertFsrsConfig(w, cfgMod.DEFAULT_SCHEDULER_OPTIONS, "optimizer");
  db.setActiveFsrsConfig(id);
  db.persistNow();
  M.activeCfg = nz(id);
  // insertFsrsConfig 按指纹去重：扰不动权重时返回的就是 cfg-default 本身（那一行 initDb 已播，不算净增）
  const knownFp = nz(id) === "cfg-default" || [...M.configs.values()].some((v) => v.fp === fp);
  if (!knownFp) { M.configs.set(nz(id), { fp }); gain(M, "fsrs_configs"); }
  S.note = `weights→${nz(id).slice(0, 8)}${knownFp ? "(去重)" : ""}`;
});

op("memRun", 3, (db, M, S, rng) => {
  const r = db.createMemoryRun({ kind: rng.pick(["ingest", "backfill"]), trigger: "f38", input: { n: rng.int(9) } });
  if (!r || !r.id) return;
  M.memRuns.set(nz(r.id), { status: "running" }); gain(M, "memory_runs");
  if (rng.bool(0.7)) { const st = rng.pick(["success", "failed"]); db.setMemoryRunStatus(r.id, st); M.memRuns.get(nz(r.id)).status = st; }
});

op("aiBatch", 2, (db, M, S) => {
  const r = db.createAIGenBatch({ scope: "card-main", sourceText: "s" + SEQN, context: {}, promptTemplateId: null, result: { cards: [] } });
  if (r && r.id) { M.batches.set(nz(r.id), { status: "draft" }); gain(M, "ai_gen_batches"); }
});

op("reading", 4, (db, M, S, rng) => {
  const live = [...M.items.entries()].filter(([, v]) => !v.deleted);
  if (!live.length) return;
  const [id] = rng.pick(live);
  const pos = rng.int(5000);
  if (db.addReadingEvent(id, pos) === true) { M.readings.push({ itemId: id, pos }); gain(M, "reading_events"); }
  else S.note = "addReadingEvent 返回非真";
  if (rng.bool(0.5)) db.updateProgress(id, { ratio: rng.int(100) / 100, lastText: "F38", updatedAt: Date.now() });
});

op("extRef", 2, (db, M, S, rng) => {
  const act = [...M.kps.entries()].filter(([, v]) => v.status === "active");
  if (!act.length) return;
  const [id] = rng.pick(act);
  const i = ++SEQN;
  try {
    const r = db.createKnowledgeExternalRef({ knowledgePointId: id, refKind: "doi", refValue: `10.1000/f38.${i}` });
    if (r && r.id) { M.extRefs.set(nz(r.id), { kpId: id }); gain(M, "knowledge_external_refs"); }
  } catch (e) { S.note = "外链被拒:" + String(e.message).slice(0, 20); }
});

// 只读步：电池 (f) 的载体 —— 跑完前后全库行数一字不动
op("readOnly", 8, (db, M, S, rng) => {
  S.readOnly = true;
  const ids = liveCards(M);
  const picks = [
    () => { S.appQueue = db.computeTodayQueue(Date.now()); },
    () => { S.appStats = db.getStatsOverview(); },
    () => db.listAllCards(), () => db.listItems(), () => db.listDueExtracts(),
    () => db.listKnowledgePoints({ limit: 500 }), () => db.listCardIssues(ids.length ? rng.pick(ids) : NOPE),
    () => db.findSimilarCards("F38 卡", 3), () => db.runKnowledgeLint(), () => db.getBackupCounts(),
    () => db.getLastUndoableReview(), () => db.getActiveFsrsConfig(), () => db.listLeechCards(),
  ];
  for (let i = 0; i < 2 + rng.int(4); i++) rng.pick(picks)();
});

// ============================================================ 诚实性探针
// 判据形状：每条探针自带 judge(ret, changed) → 返回 null(诚实) 或 一句话(不诚实)。
// 「返回一个被调用方读作成功的值 + 磁盘零变化」= 假成功，是这一节唯一要抓的东西；
// 「返回成功 + 磁盘确实改了」对幽灵 id 而言同样是不诚实（它本该拒绝或至少可判失败）。
function buildProbes(db, M) {
  const P = [];
  const push = (name, kind, run, judge) => P.push({ name, kind, run, judge });
  const FAILISH = (ret) => ret === false || ret === null || ret === undefined || ret === "THROW" || ret === "throw";
  const ok = (name, kind, run, judge) => push(name, kind, run, judge);

  const ghostCards = [...M.cards.entries()].filter(([, c]) => c.deleted).map(([id]) => id);
  const ghostItems = [...M.items.entries()].filter(([, v]) => v.deleted).map(([id]) => id);
  const liveCard = liveCards(M)[0] || null;
  const liveKp = [...M.kps.keys()].find((k) => M.kps.get(k).status === "active") || null;
  const anyKp = [...M.kps.keys()][0] || null;
  const liveJp = [...M.journal.entries()].filter(([, v]) => !v.deleted).map(([id]) => id);
  const liveEx = [...M.extracts.keys()][0] || null;
  const liveRel = [...M.rels.keys()][0] || null;
  const openIssue = [...M.issues.entries()].filter(([, i]) => i.status === "open").map(([id]) => id)[0] || null;
  const deadIssue = [...M.issues.entries()].filter(([, i]) => i.status !== "open").map(([id]) => id)[0] || null;
  const cfgIds = [...M.configs.keys()];

  // ---- A. 打在物理不存在的行上 ----
  const ghostChecks = [
    ["deleteCard(不存在的卡)", () => db.deleteCard(NOPE)],
    ["deleteItem(不存在的书)", () => db.deleteItem(NOPE)],
    ["updateCard(不存在的卡)", () => db.updateCard({ id: NOPE, noteText: "x", frontMarkdown: "f", backMarkdown: "b", priority: 50 })],
    ["setCardSuspended(不存在的卡)", () => db.setCardSuspended(NOPE, true, "f38")],
    ["updateCardLeech(不存在的卡)", () => db.updateCardLeech(NOPE, { suspended: true })],
    ["resolveLeech(不存在的卡)", () => db.resolveLeech(NOPE, "resumed", {})],
    ["postponeExtract(不存在的摘录)", () => db.postponeExtract(NOPE)],
    ["updateProgress(不存在的书)", () => db.updateProgress(NOPE, { ratio: 0.5 })],
    ["addReadingEvent(不存在的书)", () => db.addReadingEvent(NOPE, 500)],
    ["deleteJournalEntry(不存在的日记)", () => db.deleteJournalEntry(NOPE)],
    ["updateJournalEntry(不存在的日记)", () => db.updateJournalEntry(NOPE, "改了")],
    ["setMemoryRunStatus(不存在的 run)", () => db.setMemoryRunStatus(NOPE, "success")],
    ["setAIGenBatchStatus(不存在的 batch)", () => db.setAIGenBatchStatus(NOPE, "done")],
    ["deleteKnowledgeRelation(不存在的边)", () => db.deleteKnowledgeRelation(NOPE)],
    ["deleteKnowledgeExternalRef(不存在的外链)", () => db.deleteKnowledgeExternalRef(NOPE)],
    ["updateKnowledgePoint(不存在的 KP)", () => db.updateKnowledgePoint(NOPE, { description: "x" })],
    ["deleteInsightRun(不存在的洞察)", () => db.deleteInsightRun(NOPE)],
    ["removeDictSource(不存在的词典源)", () => db.removeDictSource(NOPE)],
    ["setDictSourceEnabled(不存在的词典源)", () => db.setDictSourceEnabled(NOPE, false)],
    ["setLibraryItemTitle(不存在的书)", () => db.setLibraryItemTitle(NOPE, "F38 幽灵名")],
    ["setLibraryItemLang(不存在的书)", () => db.setLibraryItemLang(NOPE, "ja")],
    ["setActiveMaterialMap(不存在的导图)", () => db.setActiveMaterialMap(NOPE)],
    ["deleteMaterialMap(不存在的导图)", () => db.deleteMaterialMap(NOPE)],
    ["resolveCardIssue(不存在的 issue id)", () => db.resolveCardIssue(NOPE)],
    ["saveSkip(物理不存在的卡)", () => db.saveSkip(NOPE)],
    ["saveSkip(空串 cardId)", () => db.saveSkip("")],
    ["getCard(不存在的卡)", () => db.getCard(NOPE)],
    ["getKnowledgePoint(不存在的 KP)", () => db.getKnowledgePoint(NOPE)],
    ["getExtract(不存在的摘录)", () => db.getExtract(NOPE)],
    ["getItemIdByDocumentId(不存在的文档)", () => db.getItemIdByDocumentId(NOPE)],
  ];
  for (const [name, run] of ghostChecks) ok(name, "ghost", run, (ret, changed) => changed ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 被调用方读作成功，磁盘零变化`));

  // 插入类：父行不存在就不该长出子行
  const insertChecks = [
    ["createExtract(幽灵父文档)", () => db.createExtract({ parentType: "document", parentId: NOPE, documentId: NOPE, contentMarkdown: "x", priority: 50 })],
    ["addCardIssue(幽灵卡)", () => db.addCardIssue({ cardId: NOPE, ruleId: "F38", severity: "warn", message: "m", source: "test" })],
    ["createKnowledgeRelation(幽灵端点)", () => { try { db.createKnowledgeRelation({ fromKnowledgePointId: NOPE, toKnowledgePointId: anyKp || NOPE, relationType: "related_to" }); return "no-throw"; } catch { return "THROW"; } }],
    ["createKnowledgeExternalRef(幽灵 KP)", () => { try { db.createKnowledgeExternalRef({ knowledgePointId: NOPE, refKind: "doi", refValue: "10.1/x" }); return "no-throw"; } catch { return "THROW"; } }],
    ["createCard(空白卡)", () => db.createCard({})],
    ["createCard(knowledgePointId 指向不存在的 KP)", () => db.createCard({ noteText: "F38 幽灵引用卡", cardType: "qa", frontMarkdown: "f", backMarkdown: "b", priority: 50, tags: [], knowledgePointId: NOPE, fsrsJson: JSON.stringify(mkFsrs("new", { due: Date.now() + 9 * DAY })) })],
    ["createCard(contextRef.documentId 指向不存在的文档)", () => db.createCard({ noteText: "F38 幽灵来源卡", cardType: "qa", frontMarkdown: "f", backMarkdown: "b", priority: 50, tags: [], contextRef: { documentId: NOPE }, fsrsJson: JSON.stringify(mkFsrs("new", { due: Date.now() + 9 * DAY })) })],
    ["saveReview(幽灵卡)", () => { try { db.saveReview(NOPE, mkFsrs("review"), "Good", 500, mkFsrs("new")); return "no-throw"; } catch { return "THROW"; } }],
    ["mergeKnowledgePoints(幽灵源)", () => { try { db.mergeKnowledgePoints(NOPE, anyKp || NOPE); return "no-throw"; } catch { return "THROW"; } }],
    ["unmergeKnowledgePoint(幽灵)", () => { try { db.unmergeKnowledgePoint(NOPE); return "no-throw"; } catch { return "THROW"; } }],
    ["setActiveFsrsConfig(幽灵配置)", () => { try { db.setActiveFsrsConfig(NOPE); return "no-throw"; } catch { return "THROW"; } }],
  ];
  for (const [name, run] of insertChecks) ok(name, "ghost", run, (ret, changed) => FAILISH(ret) && !changed ? null : (changed ? `返回 ${J(ret)} 却长出了子行（悬空父引用）` : `返回 ${J(ret)} 读作成功而磁盘零变化`));

  // ---- B. 打在已软删的行上 ----
  for (const id of ghostCards.slice(0, 3)) {
    const sfx = `(${id.slice(0, 4)})`;
    ok("deleteCard(已软删卡·第二次)" + sfx, "deleted", () => db.deleteCard(id), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("updateCard(已软删卡)" + sfx, "deleted", () => db.updateCard({ id, noteText: "x", frontMarkdown: "f", backMarkdown: "b", priority: 50 }), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("setCardSuspended(已软删卡)" + sfx, "deleted", () => db.setCardSuspended(id, true, "f38"), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("addCardIssue(已软删卡)" + sfx, "deleted", () => db.addCardIssue({ cardId: id, ruleId: "F38", severity: "warn", message: "m", source: "test" }), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘（给已删卡插了待办）` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("saveSkip(已软删卡)" + sfx, "deleted", () => db.saveSkip(id), (ret, ch) => ch ? `返回 true 且写进 review_skips —— 一张已删的卡被计入「跳过」` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("saveReview(已软删卡)" + sfx, "deleted", () => { try { db.saveReview(id, mkFsrs("review"), "Good", 500, mkFsrs("new")); return "no-throw"; } catch { return "THROW"; } }, (ret, ch) => ch ? `返回 ${J(ret)} 且给已删卡记了一次复习` : (ret === "THROW" ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
  }
  if (!ghostCards.length) flow.record("F38-2A 软删卡为零（B 组探针空跑，本层覆盖缺口）", "长跑没抽到 deleteCard");
  for (const id of ghostItems.slice(0, 2)) {
    const sfx = `(${id.slice(0, 4)})`;
    ok("deleteItem(已软删书·第二次)" + sfx, "deleted", () => db.deleteItem(id), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("updateProgress(已软删书)" + sfx, "deleted", () => db.updateProgress(id, { ratio: 0.2 }), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("addReadingEvent(已软删书)" + sfx, "deleted", () => db.addReadingEvent(id, 900), (ret, ch) => ch ? `返回 ${J(ret)} 且给已删书记了字数` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
    ok("setLibraryItemTitle(已软删书)" + sfx, "deleted", () => db.setLibraryItemTitle(id, "F38 改已删"), (ret, ch) => ch ? `返回 ${J(ret)} 且改了盘` : (FAILISH(ret) ? null : `返回 ${J(ret)} 读作成功，磁盘零变化`));
  }
  if (!ghostItems.length) flow.record("F38-2B 软删书为零（B 组探针空跑，本层覆盖缺口）", "长跑没抽到 deleteItem");
  if (deadIssue) ok("resolveCardIssue(已收口 issue 再收一次)", "twice", () => ({ ret: db.resolveCardIssue(deadIssue) }),
    (ret, ch) => !ch && ret && ret.ret === true
      ? "重复收口返回 true 但磁盘零变化（第二次的「已处理」是假的）"
      : (ch ? "重复收口又改了一次盘：已收口的 issue 被再次改写，resolved_at 被推到当下（「什么时候修的」这条留痕被覆盖），且 dismissed 会被改写成 fixed" : null));
  for (const id of liveJp.slice(0, 2)) ok("deleteJournalEntry(同一条删两遍)", "twice", () => { const a = db.deleteJournalEntry(id); const b = db.deleteJournalEntry(id); return { first: a, second: b }; }, (ret) => (ret && ret.first === true && ret.second !== false) ? `第二遍返回 ${J(ret.second)}（删两遍长出第二份事实或假成功）` : null);

  // ---- C. 双做 / 幂等 ----
  ok("insertFsrsConfig(同一权重插两遍)", "twice", () => {
    const a = db.insertFsrsConfig(cfgMod.FSRS6_DEFAULT_WEIGHTS.slice(), cfgMod.DEFAULT_SCHEDULER_OPTIONS, "optimizer");
    const b = db.insertFsrsConfig(cfgMod.FSRS6_DEFAULT_WEIGHTS.slice(), cfgMod.DEFAULT_SCHEDULER_OPTIONS, "optimizer");
    db.persistNow();
    return { same: nz(a) === nz(b) };
  }, (ret, ch) => (ret && ret.same === false) ? `同一指纹插入返回了两个 config_id（§4.4.10 唯一）` : (ch ? `同一指纹插两遍改了盘（长出第二行）` : null));
  ok("mergeKnowledgePoints(同一对合两遍)", "twice", () => { try { const act = [...M.kps.entries()].filter(([, v]) => v.status === "active"); if (act.length < 2) return "n/a"; db.mergeKnowledgePoints(act[0][0], act[1][0]); const b = db.mergeKnowledgePoints(act[0][0], act[1][0]); return b && b.source ? "second-ok" : "second-null"; } catch { return "THROW"; } },
    (ret) => (ret === "n/a" || ret === "THROW" ? null : ret === "second-ok" ? "对已合并的 KP 再合一次返回真值（双合被读作成功）" : null));
  if (liveEx) ok("postponeExtract(同一摘录推两次各自生效)", "twice", () => { const a = db.postponeExtract(liveEx); const b = db.postponeExtract(liveEx); return { a: a && a.intervalDays, b: b && b.intervalDays }; },
    (ret) => (ret.a && ret.b && !(ret.b > ret.a)) ? `第二次延后没推进（${ret.a}→${ret.b}）` : null);
  if (liveCard) ok("saveReview(同一次呈现重复提交)", "twice", () => {
    const cur = db.getCard(liveCard).fsrs;
    const next = { ...cur, due: Date.now() + 5 * DAY, reps: (cur.reps || 0) + 1, lastReview: Date.now() };
    try { db.saveReview(liveCard, next, "Good", 900, cur); } catch { return "first-throw"; }
    try { db.saveReview(liveCard, next, "Good", 900, cur); return "放行(双计!)"; } catch { return "second-throw"; }
  }, (ret) => (ret === "放行(双计!)" ? "同一次呈现被计入两条 review_logs（A-7 陈旧写守卫失效）" : null));
  ok("undoLastReview(连按两下)", "twice", () => {
    const a = db.undoLastReview();
    const logsBefore = a && a.ok;
    const b = db.undoLastReview();
    return { first: !!(a && a.ok), second: !!(b && b.ok), reason: b && b.reason };
  }, (ret, ch) => (ret.first && !ch) ? "撤销返回 ok 但磁盘没动" : (ret.first && ret.second && !ch ? "两次撤销只落了一次" : null));
  if (openIssue) ok("resolveCardIssue(活 issue 收口 → 真的改了盘)", "ok", () => db.resolveCardIssue(openIssue), (ret, ch) => ch ? null : `返回 ${J(ret)} 但 issue 没收口`);
  if (anyKp) ok("updateKnowledgePoint(活 KP 改描述 → 真的改了盘)", "ok", () => db.updateKnowledgePoint(anyKp, { description: "F38 终局改" }), (ret, ch) => ch ? null : `返回真值却没写盘`);
  if (cfgIds.length) ok("setActiveFsrsConfig(切回已有配置 → 指针真动了)", "ok", () => db.setActiveFsrsConfig(cfgIds[0]), (ret, ch) => (nz(ret) === nz(cfgIds[0]) ? null : `返回 ${J(ret)} 与 settings.json 的指针不符`));
  ok("createFromPaste(新书 → 两张都落)", "ok", () => db.createFromPaste("F38 终局书", "# 章\n\n终局正文。"), (ret, ch) => (ret && ret.id && ch ? null : `返回 ${J(ret)} 而盘上${ch ? "有" : "没"}变化`));

  // ---- D. 载荷校验（写入口对非法值诚不诚实）----
  ok("createJournalEntry(空白正文)", "ghost", () => { try { db.createJournalEntry({ contentMarkdown: "   " }); return "no-throw"; } catch { return "THROW"; } }, (ret, ch) => (ret === "THROW" && !ch ? null : `空白日记${ret === "THROW" ? "抛错但改了盘" : "被收下"}`));
  ok("createJournalEntry(非法日期 2026-02-30)", "ghost", () => { try { db.createJournalEntry({ contentMarkdown: "F38 坏日期", entryDate: "2026-02-30" }); return "no-throw"; } catch { return "THROW"; } }, (ret, ch) => (ret === "THROW" && !ch ? null : `不存在的日子${ch ? "照样入了库" : "被放行"}`));
  ok("updateProgress(载荷是字符串)", "ghost", () => { const id = [...M.items.keys()][0]; return { ret: id ? db.updateProgress(id, "不是对象") : "n/a", id }; }, (ret) => (ret.id && ret.ret === true ? "非对象载荷被写进 progress_json" : null));
  // 评级枚举：review_logs 是 FSRS 参数优化的训练数据（§4.4.8），4 档之外的值一入库就成噪声
  ok("saveReview(评级 Delete＝5)", "ghost", () => { if (!liveCard) return "n/a"; const cur = db.getCard(liveCard).fsrs; try { db.saveReview(liveCard, { ...cur, due: Date.now() + 4 * DAY, reps: (cur.reps || 0) + 1, lastReview: Date.now() }, "Delete", 500, cur); return "no-throw"; } catch { return "THROW"; } },
    (ret, ch) => (ret !== "no-throw" || !ch ? null : "评级「Delete」被写进 review_logs.rating：返回 true 且落库，但 optimizer.RATING_MAP 只认 Again/Hard/Good/Easy —— 这条训练数据无人消费，却进了统计图的「评分构成」"));
  ok("saveReview(评级为小写 again)", "ghost", () => { if (!liveCard) return "n/a"; const cur = db.getCard(liveCard).fsrs; try { db.saveReview(liveCard, { ...cur, due: Date.now() + 6 * DAY, reps: (cur.reps || 0) + 1, lastReview: Date.now() }, "again", 500, cur); return "no-throw"; } catch { return "THROW"; } },
    (ret, ch) => (ret !== "no-throw" || !ch ? null : "大小写敏感的评级枚举没校验：again ≠ Again 照样入库并被优化器丢弃"));
  ok("updateCard(把 fsrs 换成缺 due 的形状)", "ghost", () => { if (!liveCard) return "n/a"; const cur = db.getCard(liveCard); const r = db.updateCard({ ...cur, fsrs: { state: "review" } }); return { r, back: db.getCard(liveCard).fsrs }; },
    (ret) => (!ret || !ret.r ? null : `updateCard 接受并落库了一份没有 due 的 fsrs_json，返回 ${J(ret.r)}；读口 normalizeFsrs 事后把它伪装成 ${J(ret.back)}（§4.4.5 八字段契约在写侧不设防，坏值只在读侧被兜住）`));
  ok("saveReview(after 缺 due 但 before 齐备)", "ghost", () => { if (!liveCard) return "n/a"; const cur = db.getCard(liveCard).fsrs; try { db.saveReview(liveCard, { state: "review", lapses: 0 }, "Good", 500, cur); return "no-throw"; } catch { return "THROW"; } },
    (ret, ch) => (ret !== "no-throw" || !ch ? null : "评分写入口不校验 fsrsState 形状：cards.fsrs_json 被写成缺 due 的半成品"));
  return P;
}

// ============================================================ 主流程
app
  .whenReady()
  .then(async () => {
    const boot = await bootFlowDb("f38");
    let db = boot.db;
    const dir = boot.dir;
    const dbFile = boot.dbFile;
    flow.record("F38-seed", `FLOW_SEED=${process.env.FLOW_SEED || "0"} rngSeed=${flow.rng.seed} cycle=${flow.cycle} ops=${N_OPS}`);
    flow.record("F38-cmd", `FLOW_INSTANCE=manual FLOW_SEED=${process.env.FLOW_SEED || 0} npx electron tests/flows/f38-write-fuzz.cjs`);

    const s = await runFlow(flow, async () => {
      const M = newModel();
      { const a0 = await audit(dbFile); for (const t of a0.tables()) M.baseline[t] = a0.count(t); a0.close(); }
      flow.record("F38-baseline", Object.entries(M.baseline).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(" "));

      // ---------------- S1 随机长跑 ----------------
      flow.section(`S1 随机交错 ${N_OPS} 次写入口（每步：影子模型 ↔ 落盘原始行 ↔ 不变量电池）`);
      const totalW = OPS.reduce((a, o) => a + o.w, 0);
      const pickOp = () => { let x = flow.rng.next() * totalW; for (const o of OPS) { x -= o.w; if (x < 0) return o; } return OPS[OPS.length - 1]; };
      const seen = {};
      const sigs = new Map(); // 违规签名 → 次数（只保 unique 形态，避免一个系统性偏差把样本池刷爆）
      const samples = [];
      const undoSkipStat = [];
      let violTotal = 0;
      let ran = 0;
      const t0 = Date.now();
      for (; ran < N_OPS; ran++) {
        const o = pickOp();
        seen[o.key] = (seen[o.key] || 0) + 1;
        const S = { note: "" };
        let err = null;
        const lo = Date.now() - 2000;
        let beforeCounts = null;
        if (o.key === "readOnly") { const a = await audit(dbFile); beforeCounts = countsOf(a); a.close(); }
        try { o.run(db, M, S, flow.rng); } catch (e) { err = String((e && e.stack) || e).split("\n").slice(0, 2).join(" | "); }
        try { db.persistNow(); } catch (e) { err = err || "persistNow " + e.message; }
        const hi = Date.now() + 2000;
        const aud = await audit(dbFile);
        let V = battery(M, aud, lo, hi, `#${ran}/${o.key}`, beforeCounts);
        aud.close();
        if (err) V = [`#${ran}/${o.key} 抛错 ${err}`].concat(V);
        if (S.bad) V.push(`#${ran}/${o.key} ${S.bad}`);
        if (V.length) {
          violTotal += V.length;
          for (const v of V) {
            const sig = v.replace(/#[0-9]+\/[A-Za-z]+ /, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "UUID").replace(/\d{10,}/g, "N");
            const c = sigs.get(sig) || { n: 0, first: v };
            c.n++; sigs.set(sig, c);
            if (c.n === 1 && samples.length < 40) samples.push(v);
          }
        }
        if (TRACE && (ran % 10 === 0 || err)) console.log(`  · #${ran} ${o.key} ${S.note}${err ? " ERR" : ""}`);
        if (S.undoSkippedNewer) undoSkipStat.push(S.undoSkippedNewer);
      }
      // —— 「撤销回退的是不是用户最近那一次」：撤了非最大 seq = 撤销面板与用户动作不对齐（§4.4.9）
      flow.record("F38-1g 撤销跳过更新日志的次数（撤了 seq≠表内最大 seq）", undoSkipStat.length);
      if (undoSkipStat.length) flow.record("F38-1h 样本", undoSkipStat.slice(0, 4).join(" ；"));
      // —— §4.4.9 快照集里 leech_before_json 那一支是否真被走到（否则 (c) 组的 leech 部分是空跑）
      const leechUndos = M.logs.filter((l) => l.dead && (l.after.lapses || 0) >= 8 && !(l.leechBefore && l.leechBefore.isLeech === true)).length;
      flow.record("F38-1i 走到「评分触发 leech → 撤销精确回退 leech」支路的次数", leechUndos);
      flow.check("F38-1j leech 回退支路确实被走到（否则该部分断言是空跑）", leechUndos >= 1, "≥1 次", leechUndos);
      flow.record("F38-步数", `${ran} / ${N_OPS} · ${Date.now() - t0}ms`);
      flow.record("F38-覆盖", Object.entries(seen).map(([k, n]) => `${k}×${n}`).join(" "));
      flow.check("F38-0 长跑确实抽到了 ≥16 个不同写入口族（覆盖不到就别谈「交错」）", Object.keys(seen).length >= 16, "≥16 族", `${Object.keys(seen).length} 族`);
      flow.check("F38-0b 步数达到最低要求（<250 不算长跑）", ran >= 250, "≥250 步", ran);
      flow.record("F38-1 违规形态数 / 总次数", `${sigs.size} 种 / ${violTotal} 次`);
      flow.check("F38-1 每步不变量电池全绿（影子模型 ↔ 落盘原始行）", sigs.size === 0, "零违规形态", sigs.size ? `${sigs.size} 种形态，样例:\n      ${samples.slice(0, 8).join("\n      ")}` : "零违规");
      flow.record("F38-1y 违规形态 Top", [...sigs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, v]) => `[${v.n}次] ${k.slice(0, 150)}`).join("\n      ") || "（无）");
      {
        const a = await audit(dbFile);
        const c = a.count("cards");
        const l = a.count("review_logs");
        const j = a.count("journal_entries");
        const k = a.count("knowledge_points");
        const sk = a.count("review_skips");
        const rl = a.count("knowledge_relations");
        const del = a.one("SELECT COUNT(*) AS n FROM cards WHERE is_deleted=1")?.n ?? 0;
        a.close();
        flow.check("F38-1b 长跑确实造出可对账的行（否则「全绿」是空跑）", c >= 30 && M.logs.length >= 15 && j >= 3 && k >= 3 && sk >= 3 && rl >= 1, "卡≥30 累计评分≥15 日记≥3 KP≥3 跳过≥3 边≥1", `卡${c} 累计评分${M.logs.length} 现存日志${l} 日记${j} KP${k} 跳过${sk} 边${rl}`);
        flow.check("F38-1c 长跑确实软删过卡（(d) 组非空性自证）", del >= 1, "≥1 张软删卡", del);
        flow.check("F38-1d 长跑确实产生过撤销（(c) 组非空性自证）", M.logs.some((x) => x.dead), "≥1 次撤销", M.logs.filter((x) => x.dead).length);
        flow.check("F38-1e 长跑确实产生过非法优先级输入并落盘（A-9 归一非空性）", seen.changePriority >= 3, "≥3 次", seen.changePriority || 0);
      }
      // 长跑终局账目（在诚实性探针污染状态之前先做一次全量对账）
      {
        const a = await audit(dbFile);
        const V = battery(M, a, Date.now() - 60000, Date.now() + 60000, "终局", null);
        const q = modelQueue(a.rows("SELECT id,is_deleted,priority,created_at,fsrs_json,leech_json,sibling_key FROM cards"), a.rows("SELECT card_id,reviewed_at FROM review_logs"), Date.now(), 0);
        const aq = db.computeTodayQueue(Date.now());
        flow.check("F38-1z 长跑终局：今日队列成员 = 模型对磁盘原始行的独立重算", J(aq.cards.map((c) => nz(c.id))) === J(q.order), `模型 ${q.order.length}:${q.order.slice(0, 8).join(",")}`, `读口 ${aq.cards.length}:${aq.cards.map((c) => nz(c.id)).slice(0, 8).join(",")}`);
        flow.check("F38-1zz 长跑终局：同源延后集合 = 模型独立重算", J(aq.deferred.map((c) => nz(c.id)).sort()) === J([...q.deferred].sort()), J([...q.deferred].sort()), J(aq.deferred.map((c) => nz(c.id)).sort()));
        a.close();
        flow.check("F38-1f 长跑终局再跑一次电池仍全绿（不是中途抖动）", V.length === 0, "零违规", V.slice(0, 4).join("\n      ") || "零违规");
      }

      // ---------------- S2 软删不外泄 + 读数同源 ----------------
      flow.section("S2 软删行不得进业务读口；队列 / KPI / 磁盘原始扫描 三方同一个数");
      const aud = await audit(dbFile);
      const deadCards = new Set(aud.rows("SELECT id FROM cards WHERE is_deleted = 1").map((r) => nz(r.id)));
      const deadItems = new Set(aud.rows("SELECT id FROM library_items WHERE is_deleted = 1").map((r) => nz(r.id)));
      const deadKps = new Set(aud.rows("SELECT id FROM knowledge_points WHERE is_deleted = 1").map((r) => nz(r.id)));
      const deadJp = new Set(aud.rows("SELECT id FROM journal_entries WHERE is_deleted = 1").map((r) => nz(r.id)));
      const deadExtractRows = new Set(aud.rows(
        "SELECT e.id AS id FROM extracts e LEFT JOIN documents d ON d.id = e.document_id LEFT JOIN library_items li ON li.id = d.library_item_id WHERE d.is_deleted = 1 OR li.is_deleted = 1 OR d.id IS NULL OR li.id IS NULL"
      ).map((r) => nz(r.id)));
      const nowMs = Date.now();
      const appQ = db.computeTodayQueue(nowMs);
      const appCards = db.listAllCards().map((c) => nz(c.id));
      const itemRows = db.listItems().map((i) => nz(i.id));
      const dueEx = db.listDueExtracts().map((e) => nz(e.id));
      const kpList = db.listKnowledgePoints({ limit: 1000 }).points.map((p) => nz(p.id));
      const jpList = db.listJournalEntries({ limit: 1000 }).entries.map((e) => nz(e.id));
      const leechList = db.listLeechCards().map((c) => nz(c.id));
      const hits = [];
      const hit = (label, list, dead) => { const b = list.filter((x) => dead.has(x)); if (b.length) hits.push(`${label}: ${b.slice(0, 4).join(",")} (${b.length} 条)`); };
      hit("(d) listAllCards 出现软删卡", appCards, deadCards);
      hit("(d) 今日队列出现软删卡", appQ.cards.map((c) => nz(c.id)), deadCards);
      hit("(d) 同源延后出现软删卡", appQ.deferred.map((c) => nz(c.id)), deadCards);
      hit("(d) listLeechCards 出现软删卡", leechList, deadCards);
      hit("(d) listItems 出现软删书", itemRows, deadItems);
      hit("(d) listDueExtracts 出现来源已删的摘录", dueEx, deadExtractRows);
      hit("(d) listKnowledgePoints 出现软删 KP", kpList, deadKps);
      hit("(d) listJournalEntries 出现软删条目", jpList, deadJp);
      flow.check("F38-3 (d) 软删行在 8 个业务读口里一条都不许出现", hits.length === 0, "零外泄", hits.join(" ；") || "零外泄");
      flow.record("F38-3c 死行数（上面判据的非空性自证）", `卡${deadCards.size} 书${deadItems.size} 知识点${deadKps.size} 日记${deadJp.size} 来源已删摘录${deadExtractRows.size}`);
      flow.check("F38-3d 确实存在死行（否则 F38-3 是空跑）", deadCards.size + deadItems.size + deadJp.size > 0, "≥1 行", deadCards.size + deadItems.size + deadJp.size);
      flow.check("F38-3e getCard 对每张软删卡都给 null", [...deadCards].every((id) => !db.getCard(id)), "全部 null", [...deadCards].filter((id) => db.getCard(id)).join(","));

      const q = modelQueue(aud.rows("SELECT id,is_deleted,priority,created_at,fsrs_json,leech_json,sibling_key FROM cards"), aud.rows("SELECT card_id,reviewed_at FROM review_logs"), nowMs, 0);
      const appIds = appQ.cards.map((c) => nz(c.id));
      flow.check("F38-4 (e) 今日队列成员 = 模型对磁盘原始行的独立重算（§4.2-20）", J(appIds) === J(q.order), `模型 ${q.order.length} 张 [${q.order.slice(0, 6).join(",")}]`, `读口 ${appIds.length} 张 [${appIds.slice(0, 6).join(",")}]`);
      flow.check("F38-4b 同源延后集合 = 模型独立重算（§4.16 每组当日放行 1 张）", J(appQ.deferred.map((c) => nz(c.id)).sort()) === J([...q.deferred].sort()), J([...q.deferred].sort()), J(appQ.deferred.map((c) => nz(c.id)).sort()));
      flow.check("F38-4c 队列 + 延后 = 全部到期候选（不静默少卡）", appQ.cards.length + appQ.deferred.length === q.candidates.size, q.candidates.size, appQ.cards.length + appQ.deferred.length);
      {
        const g = {};
        for (const c of appQ.cards) { const m = M.cards.get(nz(c.id)); if (!m || !m.sibling) continue; if (m.fsrs && (m.fsrs.state === "learning" || m.fsrs.state === "relearning")) continue; g[m.sibling] = (g[m.sibling] || 0) + 1; }
        const bad = Object.entries(g).filter(([, n]) => n > 1);
        flow.record("F38-4d 当日放行的同源组（组→张数）", Object.entries(g).map(([k, v]) => `${k}=${v}`).join(" ") || "（本轮没有多成员组同时到期，这条是空跑）");
        flow.check("F38-4e 每个同源组当日放行 ≤1 张（额度泄漏的直接形式）", bad.length === 0, "每组 ≤1", bad.map(([k, n]) => `${k}=${n}`).join(",") || "无");
      }
      const st = db.getStatsOverview();
      flow.check("F38-5 (e) kpi.dueToday + siblingDeferred = 磁盘原始扫描「活卡且 due ≤ 今日24点」", st.kpi.dueToday + st.kpi.siblingDeferred === q.dueLeToday.size, q.dueLeToday.size, `${st.kpi.dueToday}+${st.kpi.siblingDeferred}`);
      flow.check("F38-5b kpi.reviewedToday = 原始扫描今日评过的 distinct 卡数", st.kpi.reviewedToday === aud.rows("SELECT DISTINCT card_id AS c FROM review_logs WHERE reviewed_at >= ?", [q.today0]).length, aud.rows("SELECT DISTINCT card_id AS c FROM review_logs WHERE reviewed_at >= ?", [q.today0]).length, st.kpi.reviewedToday);
      flow.check("F38-5c kpi.completedToday ≤ kpi.dueToday", st.kpi.completedToday <= st.kpi.dueToday, `≤${st.kpi.dueToday}`, st.kpi.completedToday);
      flow.check("F38-5g 学习日计数与日志口径同源：streak ≤ 有日志的自然日数", st.kpi.streak <= new Set(aud.rows("SELECT DISTINCT reviewed_at AS t FROM review_logs").map((r) => { const d = new Date(Number(r.t)); d.setHours(0, 0, 0, 0); return d.getTime(); })).size + 1, `≤日志覆盖日数`, st.kpi.streak);
      flow.record("F38-5e KPI 快照", J(st.kpi));
      flow.record("F38-5f 挂在软删书下的活卡数（既定设计，留痕不判红：见 DEFECTS D-TEST-20 撤销行）", aud.one(
        "SELECT COUNT(*) AS n FROM cards c WHERE c.is_deleted=0 AND EXISTS(SELECT 1 FROM documents d JOIN library_items li ON li.id=d.library_item_id WHERE d.id=CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json,'$.documentId') END AND li.is_deleted=1)"
      )?.n ?? 0);

      // ---------------- S3 只读普查 ----------------
      flow.section("S3 只读普查：21 个读入口逐个跑，全库行与内容必须一动不动");
      const READS = {
        listItems: () => db.listItems(), listAllCards: () => db.listAllCards(), computeTodayQueue: () => db.computeTodayQueue(Date.now()),
        getStatsOverview: () => db.getStatsOverview(), listDueExtracts: () => db.listDueExtracts(), listCardIssues: () => db.listCardIssues(liveCards(M)[0] || NOPE),
        listKnowledgePoints: () => db.listKnowledgePoints({ limit: 500 }), listKnowledgeRelations: () => db.listKnowledgeRelations({ limit: 500 }),
        listJournalEntries: () => db.listJournalEntries({ limit: 500 }), listJournalDates: () => db.listJournalDates({ limit: 100 }),
        findSimilarCards: () => db.findSimilarCards("F38 卡", 3), runKnowledgeLint: () => db.runKnowledgeLint(),
        getBackupCounts: () => db.getBackupCounts(), getLastUndoableReview: () => db.getLastUndoableReview(),
        getActiveFsrsConfig: () => db.getActiveFsrsConfig(), buildEvidencePackage: () => db.buildEvidencePackage({ rangeKind: "all", tokenBudget: 4000 }),
        listLeechCards: () => db.listLeechCards(), listMemoryRuns: () => db.listMemoryRuns({ limit: 20 }), listDictSources: () => db.listDictSources(),
        getDocument: () => (M.items.size ? db.getDocument([...M.items.keys()][0]) : null), listAIGenBatches: () => db.listAIGenBatches({ limit: 20 }),
        listKnowledgeExternalRefs: () => db.listKnowledgeExternalRefs([...M.kps.keys()][0] || NOPE), listJournalEntriesSince: () => db.listJournalEntriesSince({}),
      };
      const bad = [];
      for (const [name, fn] of Object.entries(READS)) {
        const a1 = await audit(dbFile); const s1 = snapTables(a1); a1.close();
        let err = null; try { fn(); } catch (e) { err = String(e.message).slice(0, 40); }
        const a2 = await audit(dbFile); const s2 = snapTables(a2); a2.close();
        for (const t of Object.keys(s1)) if (s1[t] !== s2[t]) bad.push(`${name} 改动了 ${t}`);
        if (err) bad.push(`${name} 抛错 ${err}`);
      }
      flow.check("F38-6 (f) 23 个只读入口跑完全库逐行一字不动（§7.1.3 边界不得穿透）", bad.length === 0, "零改动", bad.slice(0, 8).join(" ；") || "零改动");

      // ---------------- S4 重启等价 ----------------
      flow.section("S4 撞完长跑之后重启：业务状态必须逐行原样回来（§7.1.4）");
      const preAud = await audit(dbFile);
      const BIZ = preAud.tables().filter((t) => !t.startsWith("sqlite_"));
      const TS = ["updated_at", "created_at", "reviewed_at", "sent_at", "finished_at", "started_at", "resolved_at", "skipped_at"];
      const pre = snapTables(preAud, TS);
      const preCounts = countsOf(preAud);
      const preBytes = fs.statSync(dbFile).size;
      const Vpre = battery(M, preAud, Date.now() - 90000, Date.now() + 5000, "重启前", null);
      preAud.close();
      const db2 = await reopenFlowDb(dir_of(dbFile));
      const postAud = await audit(dbFile);
      const post = snapTables(postAud, TS);
      const postBytes = fs.statSync(dbFile).size;
      const drift = BIZ.filter((t) => (pre[t] || "") !== (post[t] || ""));
      flow.check("F38-7 (g) 重启后每张业务表逐行一致（剥掉时间戳列后）", drift.length === 0, "零漂移", drift.join(" ") || "零漂移");
      flow.record("F38-7b 重启前后库文件字节数", `${preBytes} / ${postBytes}`);
      flow.check("F38-7c 重启清掉了 .tmp 残留", !fs.existsSync(dbFile + ".tmp"), "无 .tmp", fs.existsSync(dbFile + ".tmp") ? "有 .tmp" : "无");
      flow.eq("F38-7d 重启前后各表行数一字不变", BIZ.map((t) => postAud.count(t)), BIZ.map((t) => preCounts[t]));
      const q2 = db2.computeTodayQueue(nowMs);
      flow.eq("F38-7e 重启前后今日队列同一集合（§4.2-20 口径活得过重启）", q2.cards.map((c) => nz(c.id)).sort(), appQ.cards.map((c) => nz(c.id)).sort());
      flow.eq("F38-7f 重启前后 review_logs 同一集合", postAud.rows("SELECT id FROM review_logs ORDER BY id").map((r) => r.id), aud.rows("SELECT id FROM review_logs ORDER BY id").map((r) => r.id));
      flow.eq("F38-7g 重启前后软删标记同一集合", postAud.rows("SELECT id FROM cards WHERE is_deleted=1 ORDER BY id").map((r) => r.id), [...deadCards].sort());
      postAud.close();
      aud.close();
      db = db2;
      flow.check("F38-7h 重启前影子模型↔磁盘已是全绿（否则上面的「一致」只证明了两份同样的错）", Vpre.length === 0, "零违规", Vpre.slice(0, 5).join("\n      ") || "零违规");

      // ---------------- S5 终局账目 ----------------
      flow.section("S5 终局账目：日志 / 撤销 / 跳过 / 参数环境 四处口径必须互相自洽");
      {
        const a = await audit(dbFile);
        flow.eq("F38-8 磁盘日志条数 = 模型存活日志条数", a.count("review_logs"), aliveLogs(M).length);
        flow.eq("F38-8b 磁盘跳过条数 = 模型跳过条数", a.count("review_skips"), M.skips.length);
        flow.eq("F38-8c 磁盘卡行数 = 模型卡行数（含软删）", a.count("cards"), M.cards.size);
        const ghostSkips = a.rows("SELECT id, card_id FROM review_skips WHERE card_id NOT IN (SELECT id FROM cards)");
        flow.check("F38-8d 不存在「指向物理不存在之卡」的跳过行", ghostSkips.length === 0, "零幽灵跳过", `${ghostSkips.length} 条 例:${ghostSkips.slice(0, 3).map((r) => nz(r.card_id)).join(",")}`);
        // —— 长跑自然撞出来的组合（不是 S6 探针打的）：跳过一张已被软删的卡，会不会污染仪表盘读数 ——
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        const deadSkips = a.rows("SELECT rs.id AS id, rs.card_id AS c FROM review_skips rs JOIN cards cc ON cc.id = rs.card_id WHERE cc.is_deleted = 1 AND rs.skipped_at >= ?", [monthStart]);
        const stFuzz = db.getStatsOverview();
        const liveOnly = a.rows("SELECT COUNT(DISTINCT rs.card_id) AS n FROM review_skips rs JOIN cards cc ON cc.id = rs.card_id WHERE cc.is_deleted = 0 AND rs.skipped_at >= ?", [monthStart])[0]?.n ?? 0;
        flow.record("F38-8l 长跑自然产生的「已删卡跳过」条数 / 仪表盘本月跳过读数 / 只数活卡应得数", `${deadSkips.length} / ${stFuzz.queueFlow.skipped} / ${liveOnly}`);
        flow.check("F38-8m (d) 随机长跑自然撞出的软删卡跳过不得计入仪表盘「本月跳过」（§7.2 L869 查询一律带 is_deleted=0）",
          deadSkips.length > 0 ? stFuzz.queueFlow.skipped === liveOnly : true,
          deadSkips.length ? `应为 ${liveOnly}（本层已自然造出 ${deadSkips.length} 条已删卡跳过）` : "（长跑未撞出此组合，判据本轮未被触发）",
          stFuzz.queueFlow.skipped);
        // 同一个瀑布图里的「本月完成」是同一个形状：COUNT(DISTINCT card_id) FROM review_logs 不 JOIN 活卡
        const deadReviews = a.rows("SELECT COUNT(DISTINCT rl.card_id) AS n FROM review_logs rl JOIN cards cc ON cc.id = rl.card_id WHERE cc.is_deleted = 1 AND rl.reviewed_at >= ?", [monthStart])[0]?.n ?? 0;
        const liveReviews = a.rows("SELECT COUNT(DISTINCT rl.card_id) AS n FROM review_logs rl JOIN cards cc ON cc.id = rl.card_id WHERE cc.is_deleted = 0 AND rl.reviewed_at >= ?", [monthStart])[0]?.n ?? 0;
        flow.record("F38-8n 已删卡的本月评过卡数 / queueFlow.completed / 只数活卡应得数", `${deadReviews} / ${stFuzz.queueFlow.completed} / ${liveReviews}`);
        flow.check("F38-8o (d) 仪表盘「本月完成」同样不得计入已删卡（与 D-TEST-23 同族，那条只修了 reading_events）",
          deadReviews > 0 ? stFuzz.queueFlow.completed === liveReviews : true,
          deadReviews ? `应为 ${liveReviews}（有 ${deadReviews} 张已删卡本月评过）` : "（长跑未撞出此组合，判据本轮未被触发）",
          stFuzz.queueFlow.completed);
        flow.eq("F38-8e 磁盘配置行数 = 模型（含 cfg-default）", a.count("fsrs_configs"), M.configs.size + 1);
        const dupFp = a.rows("SELECT config_fingerprint AS f, COUNT(*) AS n FROM fsrs_configs GROUP BY f HAVING n > 1");
        flow.check("F38-8f 参数指纹唯一（§4.4.10 同一配置只有一个 config_id）", dupFp.length === 0, "无重复指纹", J(dupFp).slice(0, 90));
        const ptr = (safeParse(fs.readFileSync(path.join(dir_of(dbFile), "settings.json"), "utf8")) || {}).app?.fsrsConfigId;
        flow.check("F38-8g settings.json 的活跃指针必须指向库里真实存在的配置行（§4.4.10 同生共死）", !ptr || !!a.one("SELECT id FROM fsrs_configs WHERE id = ?", [ptr]), nz(ptr) || "（无指针）", a.one("SELECT COUNT(*) AS n FROM fsrs_configs")?.n);
        const openOnDead = a.rows("SELECT ci.id FROM card_issues ci JOIN cards c ON c.id = ci.card_id WHERE c.is_deleted = 1 AND ci.status = 'open'");
        flow.check("F38-8h 删卡后不得留 open issue（deleteCard 的收口承诺）", openOnDead.length === 0, "零条", openOnDead.length);
        // 撤销的物理删除不留洞：现存 seq 必须能由「插入序单调 + 撤销只删最大 seq」解释
        const seqs = a.rows("SELECT review_seq AS s FROM review_logs ORDER BY s").map((r) => Number(r.s));
        const holes = [];
        for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) holes.push(`${seqs[i - 1]}→${seqs[i]}`);
        flow.record("F38-8i review_seq 空洞（撤销只删最大 seq 时恒为空；有洞=撤了非最大的一条）", holes.join(" ") || "无洞");
        flow.check("F38-8j review_seq 稠密连续（撤销不得留下无人认领的洞）", holes.length === 0, "无洞", holes.join(" ") || "无洞");
        flow.record("F38-8k 模型侧撤销次数", M.logs.filter((l) => l.dead).length);
        a.close();
      }
      // ---------------- S6 定向反序组合 ----------------
      flow.section("S6 长跑未必撞得到的反序组合，这里逐条钉死（每条都自己造卡，不依赖随机状态）");
      {
        const mkT = (tag) => db.createCard({
          noteText: `F38 T ${tag}`, cardType: "qa", frontMarkdown: `T问 ${tag}`, backMarkdown: `T答 ${tag}`,
          priority: 50, tags: [], fsrsJson: JSON.stringify(mkFsrs("new", { due: Date.now() - 60000 })),
        }).id;
        const rateT = (id, rating, dueshift) => { const cur = db.getCard(id).fsrs; return db.saveReview(id, { ...cur, state: "review", due: Date.now() + (dueshift || 3) * DAY, reps: (cur.reps || 0) + 1, lapses: cur.lapses || 0, lastReview: Date.now(), learningSteps: [] }, rating, 700, cur); };
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        const a = await audit(dbFile);
        const skippedLive = a.rows("SELECT COUNT(DISTINCT rs.card_id) AS n FROM review_skips rs JOIN cards cc ON cc.id = rs.card_id WHERE cc.is_deleted = 0 AND rs.skipped_at >= ?", [monthStart])[0]?.n ?? 0;
        const doneLive = a.rows("SELECT COUNT(DISTINCT rl.card_id) AS n FROM review_logs rl JOIN cards cc ON cc.id = rl.card_id WHERE cc.is_deleted = 0 AND rl.reviewed_at >= ?", [monthStart])[0]?.n ?? 0;
        a.close();

        // T1 评分 A → 评分 B → 软删 B → 撤销：撤销动的必须是「用户最近那一次」
        const ta = mkT("T1甲"), tb = mkT("T1乙");
        rateT(ta, "Good", 3); rateT(tb, "Easy", 7);
        const beforeT1 = (await audit(dbFile)).rows("SELECT id, fsrs_json FROM cards WHERE id IN (?,?)", [ta, tb]);
        db.deleteCard(tb);
        const u1 = db.undoLastReview();
        const a2 = await audit(dbFile);
        const afterT1 = a2.rows("SELECT id, fsrs_json FROM cards WHERE id IN (?,?) ORDER BY id", [ta, tb]);
        a2.close();
        const touchedA = J(beforeT1.find((r) => nz(r.id) === nz(ta))) !== J(afterT1.find((r) => nz(r.id) === nz(ta)));
        flow.record("T1 撤销返回", u1 && u1.ok ? `ok，撤的是卡 ${nz(u1.card && u1.card.id) === nz(ta) ? "甲(A)" : "乙(B)"} rating=${u1.rating}` : `拒：${u1 && u1.reason}`);
        flow.check("T1 用户最近一次评分（乙）被软删后，撤销不得回退到更早的甲（那撤销的不是用户看到的最后一次）",
          !(u1 && u1.ok) || !touchedA, "撤销甲=否（要么拒，要么撤乙）", touchedA ? "撤销改动了甲的 fsrs_json" : "未改动甲");

        // T2 跳过一张卡 → 删掉这张卡 → 仪表盘「本月跳过」必须把这条一并撤下
        const tc = mkT("T2甲");
        db.saveSkip(tc);
        const stMid1 = db.getStatsOverview();
        db.deleteCard(tc);
        const stMid2 = db.getStatsOverview();
        flow.record("T2 跳过后再删卡：queueFlow.skipped", `${stMid1.queueFlow.skipped} → ${stMid2.queueFlow.skipped}（只数活卡应得 ${skippedLive}）`);
        flow.check("T2 (d) 删掉的卡不得再计入仪表盘「本月跳过」（§7.2 L869 查询一律带 is_deleted=0）",
          stMid2.queueFlow.skipped === skippedLive, skippedLive, stMid2.queueFlow.skipped);

        // T3 评分一张卡 → 删掉这张卡 → 仪表盘「本月完成」同理
        const td = mkT("T3甲");
        rateT(td, "Good", 5);
        const stMid3 = db.getStatsOverview();
        db.deleteCard(td);
        const stMid4 = db.getStatsOverview();
        flow.record("T3 评分后再删卡：queueFlow.completed", `${stMid3.queueFlow.completed} → ${stMid4.queueFlow.completed}（只数活卡应得 ${doneLive}）`);
        flow.check("T3 (d) 删掉的卡不得再计入仪表盘「本月完成」（与 D-TEST-23 同族，那条只修了 reading_events）",
          stMid4.queueFlow.completed === doneLive, doneLive, stMid4.queueFlow.completed);

        // T4 旁路改卡 → 撤销必须整条拒绝且一字不动
        const te = mkT("T4甲");
        rateT(te, "Good", 4);
        const snapBefore = snapTables(await audit(dbFile), ["updated_at"]);
        const cur4 = db.getCard(te);
        db.updateCard({ ...cur4, fsrs: { ...cur4.fsrs, due: Date.now() + 60 * DAY } });
        const a5 = await audit(dbFile); const mid = snapTables(a5, ["updated_at"]); a5.close();
        const u2 = db.undoLastReview();
        const a6 = await audit(dbFile); const after4 = snapTables(a6, ["updated_at"]); a6.close();
        flow.record("T4 旁路改 due 后撤销", u2 && u2.ok ? `竟仍返回 ok（撤回了 ${u2.rating}）` : `拒：${u2 && u2.reason}`);
        flow.check("T4 (c) 卡被旁路改过后撤销必须拒绝，且拒绝时全库一字不动", (!(u2 && u2.ok) && J(mid) === J(after4)), "拒绝 + 零改动", { 返回: u2 && (u2.ok ? "ok" : u2.reason), 磁盘是否被动过: J(mid) !== J(after4) ? "是" : "否" });

        // T5 延后一条摘录 → 删掉它所属的书 → listDueExtracts 不得再返回它
        const bk = db.createFromPaste("F38 T5 书", "# 章\n\nT5 正文。");
        const ex = db.createExtract({ parentType: "document", parentId: bk.documentId, documentId: bk.documentId, contentMarkdown: "F38 T5 摘录", priority: 50 });
        db.postponeExtract(ex.id);
        db.deleteItem(bk.id);
        const dueAfter = db.listDueExtracts().map((e) => nz(e.id));
        flow.check("T5 (d) 来源书被软删后，它的摘录不得再出现在待复习清单", !dueAfter.includes(nz(ex.id)), "不出现", dueAfter.includes(nz(ex.id)) ? "仍出现" : "不出现");

        // T6 合并知识点 → 挂在被合并 KP 上的卡，队列读数不得受影响（合并只动知识地基）
        const kp1 = db.createKnowledgePoint({ canonicalLabel: "F38 T6 甲", description: "d" });
        const kp2 = db.createKnowledgePoint({ canonicalLabel: "F38 T6 乙", description: "d" });
        const tf = db.createCard({ noteText: "F38 T6 卡", cardType: "qa", frontMarkdown: "f", backMarkdown: "b", priority: 50, tags: [], knowledgePointId: kp1.id, fsrsJson: JSON.stringify(mkFsrs("review", { due: Date.now() - 60000 })) }).id;
        const qBefore = db.computeTodayQueue(Date.now()).cards.map((c) => nz(c.id));
        db.mergeKnowledgePoints(kp1.id, kp2.id);
        const qAfter = db.computeTodayQueue(Date.now()).cards.map((c) => nz(c.id));
        flow.check("T6 (b) 合并知识点不得改写任何卡的调度事实（§4.19「A 功能绝不写 B 表」的存储版）", J(qBefore) === J(qAfter) && qAfter.includes(nz(tf)), "队列不变且卡仍在", { before: qBefore.length, after: qAfter.length, 卡在内: qAfter.includes(nz(tf)) });
        const a7 = await audit(dbFile);
        const kpRows = a7.rows("SELECT id, status, merged_into FROM knowledge_points WHERE id IN (?,?)", [kp1.id, kp2.id]);
        a7.close();
        flow.record("T6 合并后两行 KP", J(kpRows));
        db.unmergeKnowledgePoint(kp1.id);
      }

      // ---------------- S7 诚实性（最后跑：探针本身会改盘） ----------------
      flow.section("S7 op-level 诚实性：把写入口打在「不存在 / 已软删 / 做两遍」上，返回值必须与磁盘事实一致");
      const probes = buildProbes(db, M);
      const dishonest = [];
      for (const p of probes) {
        const a1 = await audit(dbFile);
        const c1 = countsOf(a1);
        const t1 = snapTables(a1, ["updated_at", "created_at", "created", "resolved_at", "sent_at", "finished_at", "started_at", "reviewed_at", "skipped_at", "attempts"]);
        a1.close();
        let ret = null;
        try { ret = p.run(); } catch (e) { ret = "THROW"; }
        try { db.persistNow(); } catch { /* 注入型探针可能抛 */ }
        const a2 = await audit(dbFile);
        const c2 = countsOf(a2);
        const t2 = snapTables(a2, ["updated_at", "created_at", "created", "resolved_at", "sent_at", "finished_at", "started_at", "reviewed_at", "skipped_at", "attempts"]);
        a2.close();
        const changed = J(c1) !== J(c2) || J(t1) !== J(t2);
        const msg = p.judge(ret, changed);
        // 一条探针 = 一条断言：失败时 expected/actual 就是「返回值 vs 磁盘上到底发生了什么」的原话
        if (msg) dishonest.push(`【${p.kind}】${p.name} → ${msg}`);
        flow.check(`F38-2/${p.name}`, !msg, "返回值与磁盘事实一致", msg || "一致");
      }
      flow.check(`F38-2z ${probes.length} 条诚实性探针合计`, dishonest.length === 0, "全部一致", dishonest.length ? `${dishonest.length}/${probes.length} 不一致:\n      ${dishonest.slice(0, 14).join("\n      ")}` : "全部一致");
      flow.record("F38-2c 探针条数（≥40 才算清点）", probes.length);
      flow.check("F38-2d 探针条数达到要求（<40 不足以叫普查）", probes.length >= 40, "≥40 条", probes.length);
      // 幽灵跳过的真实后果：仪表盘「本月跳过」按 card_id 去重计数，且不 JOIN 活卡
      {
        const a = await audit(dbFile);
        const ghost = a.rows("SELECT id, card_id FROM review_skips WHERE card_id NOT IN (SELECT id FROM cards)");
        const dead = a.rows("SELECT rs.id AS id, rs.card_id AS card_id FROM review_skips rs JOIN cards c ON c.id = rs.card_id WHERE c.is_deleted = 1");
        const st = db.getStatsOverview();
        // 我方能确证的「合法跳过」：卡在盘上存在且未软删，且跳过时刻落在本月
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
        const legit = a.rows(
          "SELECT COUNT(DISTINCT rs.card_id) AS n FROM review_skips rs JOIN cards c ON c.id = rs.card_id WHERE c.is_deleted = 0 AND rs.skipped_at >= ?",
          [monthStart]
        )[0]?.n ?? 0;
        a.close();
        const ghostIds = new Set([...ghost, ...dead].map((r) => nz(r.card_id)));
        flow.record("F38-2e 悬空跳过行数 / 已删卡跳过行数", `${ghost.length} / ${dead.length}`);
        flow.record("F38-2f queueFlow.skipped（仪表盘读数）/ 只数活卡应得的读数", `${st.queueFlow.skipped} / ${legit}`);
        flow.check("F38-2g 不存在「指向物理不存在之卡」的跳过行（saveSkip 无父行校验就会留下）", ghost.length === 0, "零悬空跳过", `${ghost.length} 条 例:${ghost.slice(0, 3).map((r) => nz(r.card_id)).join(",")}`);
        flow.check("F38-2h 仪表盘「本月跳过」只数活卡（软删卡的跳过不得计入）", st.queueFlow.skipped === legit, legit, st.queueFlow.skipped);
        flow.record("F38-2i 被计入「本月跳过」的已删/悬空卡数", ghostIds.size);
      }

    });

    console.log(J(s).slice(0, 400));
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F38 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });

function dir_of(file) { return path.dirname(file); }
