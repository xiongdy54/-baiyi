// 用户记忆整理编排层（v45，M14-UM1，D39 / §4.18-11/-16）。定位＝**基础设施**（§4.18-11：自动触发，
// 不受「洞察按需触发」纪律约束；对照 §9.1 M8-B 边界注记）。分工：
// - 本模块只做编排（防抖、分批、水位线、运行留痕、进度广播）与输入装配；
// - 提示词文本只来自播种模板 user-memory（db.getPromptTemplate，§4.18-13），本模块不写提示词正文；
// - AI 调用经 ctx.chat 注入（主进程 chatStream 包装；测试注入 fake——m14 库测无 Key 跑全管线）。
//   编排放在主进程而非渲染层（偏离制卡/洞察先例）：后台基础设施须与窗口生命周期解耦，
//   且库测直跑主进程；已记入指南 §8.2 偏差表。
const memoryStore = require("./memoryStore");

const TIDY_DEFAULTS = {
  enabled: false,
  introAcked: false,
  lastCoveredAt: null, // 水位线（journal_entries.updated_at 口径）；null ⇒ 窗口=全部历史
  tidyDebounceMinutes: 30, // §4.18-11①：日记变更防抖（最小间隔）
  tidyMaxWaitMinutes: 360, // 连续写入不无限推迟：首次变更后最长等待
  backfillBatchEntries: 30, // §4.18-16④：每批 ≤ N 条
  inputTokenBudget: 12000, // 单轮输入 token 预算（照 Evidence Package 默认口径）
  consolidateEveryRounds: 10, // §4.18-11③：每 N 轮摄入做一次周期整理
  consolidateIndexChars: 1200, // 目录超限也触发
  injectBudget: 4400, // §4.18-8：制卡注入预算（字）——core/index/主题按 800/1200/2400 配比缩放
  roundsSinceConsolidate: 0,
  consolidateCursor: 0
};

const STARTUP_BACKFILL_MIN_HOURS = 12; // §4.18-11①：距上次成功 ≥12h 且存在未整理条目
const CONSOLIDATE_TOPICS_PER_ROUND = 2;

function readMemoryConfig(ctx) {
  const all = ctx.readSettings();
  const raw = (all && all.app && all.app.memory) || {};
  const cfg = { ...TIDY_DEFAULTS, ...raw };
  // 非法值回落默认（照 getCutoffHour / siblingBuryConfig 惯例）
  cfg.tidyDebounceMinutes = clampNum(cfg.tidyDebounceMinutes, 1, 1440, TIDY_DEFAULTS.tidyDebounceMinutes);
  cfg.tidyMaxWaitMinutes = clampNum(cfg.tidyMaxWaitMinutes, cfg.tidyDebounceMinutes, 10080, TIDY_DEFAULTS.tidyMaxWaitMinutes);
  cfg.backfillBatchEntries = clampNum(cfg.backfillBatchEntries, 1, 200, TIDY_DEFAULTS.backfillBatchEntries);
  cfg.inputTokenBudget = clampNum(cfg.inputTokenBudget, 2000, 60000, TIDY_DEFAULTS.inputTokenBudget);
  cfg.consolidateEveryRounds = clampNum(cfg.consolidateEveryRounds, 1, 200, TIDY_DEFAULTS.consolidateEveryRounds);
  cfg.injectBudget = clampNum(cfg.injectBudget, 200, 20000, TIDY_DEFAULTS.injectBudget);
  return cfg;
}

// v46（M14-UM2，§4.18-8）：注入预算 → 三段字数配比（800/1200/2400 的缺省配比等比缩放）
function injectBudgetsFor(cfg) {
  const total = cfg.injectBudget;
  return {
    core: Math.max(100, Math.round((total * 800) / 4400)),
    index: Math.max(100, Math.round((total * 1200) / 4400)),
    topics: Math.max(200, Math.round((total * 2400) / 4400))
  };
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function writeMemoryConfig(ctx, patch) {
  const all = ctx.readSettings();
  if (!all.app || typeof all.app !== "object") all.app = {};
  all.app.memory = { ...TIDY_DEFAULTS, ...(all.app.memory || {}), ...patch };
  ctx.writeSettings(all);
  return all.app.memory;
}

function memoryDirOf(ctx) {
  return ctx.memoryDir || memoryStore.resolveMemoryDir(ctx.userData);
}

// ---------- 模块状态 ----------

let state = null;

function s() {
  if (!state) {
    state = {
      trailingTimer: null,
      maxTimer: null,
      queue: Promise.resolve(), // 轮次串行（防抖/补处理/手动并发时排队）
      backfillAbort: false,
      backfill: { running: false, done: 0, total: 0 },
      lastError: null
    };
  }
  return state;
}

function broadcast(ctx, payload) {
  try {
    ctx.broadcast({ ...payload, backfill: { ...s().backfill }, lastError: s().lastError });
  } catch { /* 广播失败不影响整理 */ }
}

// ---------- 输入装配 ----------

function entryBlock(entries) {
  const parts = [`【新增/改动的日记条目】共 ${entries.length} 条（时间正序；内容为日记原文）`];
  entries.forEach((e, i) => {
    parts.push(`[${i + 1}] 条目 id=${e.id}  日期=${e.entryDate}`);
    parts.push(String(e.contentMarkdown || "").trim());
  });
  return parts.join("\n");
}

function ingestUserText(ctx, dir, entries) {
  return [
    "【运行类型】ingest",
    "【当前 core.md】",
    memoryStore.readText(dir, memoryStore.CORE_FILE) ?? "（空）",
    "【当前 index.md】",
    memoryStore.readText(dir, memoryStore.INDEX_FILE) ?? "（空）",
    entryBlock(entries)
  ].join("\n");
}

function consolidateUserText(ctx, dir, topicRels) {
  const parts = [
    "【运行类型】consolidate",
    "【当前 core.md】",
    memoryStore.readText(dir, memoryStore.CORE_FILE) ?? "（空）",
    "【当前 index.md】",
    memoryStore.readText(dir, memoryStore.INDEX_FILE) ?? "（空）",
    `【本次整理的主题文件】共 ${topicRels.length} 个`
  ];
  for (const rel of topicRels) {
    parts.push(`----- ${rel} -----`);
    parts.push(memoryStore.readText(dir, rel) ?? "（空）");
  }
  return parts.join("\n");
}

// 容错解析：剥 ``` 围栏后取首个括号平衡的顶层 JSON 对象（照 insight.ts 括号平衡思路）
function parseJsonLoose(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("输出中没有 JSON 对象");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error("JSON 括号不平衡");
}

// ---------- 轮次执行 ----------

function templateInfo(ctx) {
  const tpl = ctx.db.getPromptTemplate("user-memory");
  return { content: tpl ? String(tpl.content) : null, version: tpl ? tpl.version : null };
}

function topicRelsForConsolidate(ctx, dir, cfg) {
  const usage = memoryStore.usageStats(dir);
  const rels = usage.topics.map((t) => t.rel).sort((a, b) => a.localeCompare(b, "zh"));
  if (!rels.length) return { rels: [], cursor: cfg.consolidateCursor };
  const start = ((cfg.consolidateCursor % rels.length) + rels.length) % rels.length;
  const picked = [];
  for (let i = 0; i < Math.min(CONSOLIDATE_TOPICS_PER_ROUND, rels.length); i++) {
    picked.push(rels[(start + i) % rels.length]);
  }
  return { rels: picked, cursor: (start + picked.length) % rels.length };
}

// 单轮执行（摄入或整理共用）：调 AI → applyOps → 留痕 → 水位线推进。调用方保证 entries 非空（摄入）。
async function runRound(ctx, { kind, trigger, entries = null, topicRels = null }) {
  const st = s();
  const dir = memoryDirOf(ctx);
  const cfg = readMemoryConfig(ctx);
  const tpl = templateInfo(ctx);
  if (!tpl.content) {
    st.lastError = "user-memory 模板缺失";
    broadcast(ctx, { phase: kind, running: false });
    return { ok: false, error: st.lastError };
  }
  memoryStore.ensureTree(dir);
  const run = ctx.db.createMemoryRun({
    kind,
    trigger,
    input:
      kind === "ingest"
        ? { entryIds: entries.map((e) => e.id), entryCount: entries.length, sinceUpdatedAt: cfg.lastCoveredAt }
        : { topicRels }
  });
  const userText =
    kind === "ingest" ? ingestUserText(ctx, dir, entries) : consolidateUserText(ctx, dir, topicRels);
  broadcast(ctx, { phase: kind, running: true });
  try {
    const full = await ctx.chat(
      [
        { role: "system", content: tpl.content },
        { role: "user", content: userText }
      ],
      { temperature: 0.3 }
    );
    const parsed = parseJsonLoose(full);
    const ops = Array.isArray(parsed.ops) ? parsed.ops : [];
    const { results, touchedTopics } = memoryStore.applyOps(dir, ops);
    if (touchedTopics) memoryStore.rebuildIndex(dir);
    // 水位线 = 本批条目最大 updated_at（无论 op 落地与否——这批已处理过，不得重整）
    let maxUpdatedAt = null;
    if (entries && entries.length) {
      maxUpdatedAt = entries.reduce((a, e) => Math.max(a, Number(e.updatedAt) || 0), 0);
    }
    if (kind === "ingest" && maxUpdatedAt) {
      writeMemoryConfig(ctx, { lastCoveredAt: maxUpdatedAt });
    }
    if (kind === "ingest") {
      const cur = readMemoryConfig(ctx);
      const nextRounds = cur.roundsSinceConsolidate + 1;
      const patch = { roundsSinceConsolidate: nextRounds };
      const indexText = memoryStore.readText(dir, memoryStore.INDEX_FILE);
      const indexOver = indexText != null && indexText.length > cur.consolidateIndexChars;
      if (nextRounds >= cur.consolidateEveryRounds || indexOver) {
        const pick = topicRelsForConsolidate(ctx, dir, cur);
        if (pick.rels.length) {
          patch.roundsSinceConsolidate = 0;
          patch.consolidateCursor = pick.cursor;
          // 整理轮在本轮成功后排队执行（不阻塞本轮返回）
          setTimeout(() => {
            runRound(ctx, { kind: "consolidate", trigger, topicRels: pick.rels }).catch((err) => {
              st.lastError = String(err && err.message);
              broadcast(ctx, { phase: "consolidate", running: false });
            });
          }, 0);
        }
      }
      writeMemoryConfig(ctx, patch);
    }
    ctx.db.setMemoryRunStatus(run.id, "success", {
      output: parsed,
      applied: results,
      promptScope: "user-memory",
      promptVersion: tpl.version,
      tokenUsed: memoryStore.estimateTokens(userText)
    });
    st.lastError = null;
    broadcast(ctx, { phase: kind, running: false, processed: entries ? entries.length : topicRels.length });
    return { ok: true, runId: run.id, applied: results, ops: ops.length };
  } catch (err) {
    const msg = String(err && err.message);
    st.lastError = msg;
    ctx.db.setMemoryRunStatus(run.id, "failed", {
      promptScope: "user-memory",
      promptVersion: tpl.version,
      errorText: msg
    });
    broadcast(ctx, { phase: kind, running: false });
    return { ok: false, error: msg, runId: run.id };
  }
}

// 摄入一轮：取一批未整理条目（时间正序 + token 预算截断）→ runRound。无条目 / 未开启 / 无 Key → 跳过并说明。
async function runIngestRound(ctx, trigger) {
  const cfg = readMemoryConfig(ctx);
  if (!cfg.enabled) return { ok: false, skipped: "用户记忆未开启" };
  if (typeof ctx.hasKey === "function" && !ctx.hasKey()) return { ok: false, skipped: "未配置 AI Key" };
  const st = s();
  const exec = async () => {
    const entries = ctx.db.listJournalEntriesSince({
      sinceUpdatedAt: cfg.lastCoveredAt,
      limit: cfg.backfillBatchEntries * 4
    });
    if (!entries.length) return { ok: false, skipped: "没有未整理的日记条目" };
    // token 预算截断（时间正序，先到先得——剩余留给下一轮/启动补跑）
    const budgetEntries = [];
    let used = 0;
    for (const e of entries) {
      const cost = memoryStore.estimateTokens(String(e.contentMarkdown || ""));
      if (budgetEntries.length >= cfg.backfillBatchEntries) break;
      if (budgetEntries.length && used + cost > cfg.inputTokenBudget) break;
      budgetEntries.push(e);
      used += cost;
    }
    return runRound(ctx, { kind: "ingest", trigger, entries: budgetEntries });
  };
  const task = st.queue.then(exec, exec);
  st.queue = task.catch(() => {}); // 队列吞错，后续轮次照常
  return task;
}

// ---------- 防抖（照 quickCapture 双计时器先例：trailing + max） ----------

function cancelTimers() {
  const st = s();
  if (st.trailingTimer) {
    clearTimeout(st.trailingTimer);
    st.trailingTimer = null;
  }
  if (st.maxTimer) {
    clearTimeout(st.maxTimer);
    st.maxTimer = null;
  }
}

function notifyJournalChanged(ctx) {
  const cfg = readMemoryConfig(ctx);
  if (!cfg.enabled) return; // 关闭 = 零调用（§4.18-16①）
  const st = s();
  if (st.trailingTimer) clearTimeout(st.trailingTimer);
  st.trailingTimer = setTimeout(() => {
    st.trailingTimer = null;
    if (st.maxTimer) {
      clearTimeout(st.maxTimer);
      st.maxTimer = null;
    }
    runIngestRound(ctx, "debounce").catch((err) => {
      st.lastError = String(err && err.message);
    });
  }, cfg.tidyDebounceMinutes * 60000);
  if (!st.maxTimer) {
    st.maxTimer = setTimeout(() => {
      st.maxTimer = null;
      if (st.trailingTimer) {
        clearTimeout(st.trailingTimer);
        st.trailingTimer = null;
      }
      runIngestRound(ctx, "debounce").catch((err) => {
        st.lastError = String(err && err.message);
      });
    }, cfg.tidyMaxWaitMinutes * 60000);
  }
}

// ---------- 补处理（§4.18-16：分批时间正序、可中止可续跑、逐批推进水位线） ----------

function backfillStats(ctx) {
  const cfg = readMemoryConfig(ctx);
  const entries = ctx.db.listJournalEntriesSince({ sinceUpdatedAt: cfg.lastCoveredAt, limit: 1000 });
  const chars = entries.reduce((a, e) => a + String(e.contentMarkdown || "").length, 0);
  const batchCount = Math.max(1, Math.ceil(entries.length / cfg.backfillBatchEntries));
  return {
    entryCount: entries.length,
    truncated: entries.length >= 1000,
    oldestUpdatedAt: entries.length ? entries[0].updatedAt : null,
    batchCount,
    estCalls: entries.length ? batchCount : 0,
    estTokens: Math.ceil(chars * 0.7) + batchCount * 2000 // 条目正文 + 每轮注入的 core/index 常量开销
  };
}

async function runBackfill(ctx) {
  const cfg = readMemoryConfig(ctx);
  if (!cfg.enabled) return { ok: false, skipped: "用户记忆未开启" };
  if (typeof ctx.hasKey === "function" && !ctx.hasKey()) return { ok: false, skipped: "未配置 AI Key" };
  const st = s();
  if (st.backfill.running) return { ok: false, skipped: "补处理已在进行中" };
  st.backfillAbort = false;
  const stats = backfillStats(ctx);
  st.backfill = { running: true, done: 0, total: stats.entryCount };
  broadcast(ctx, { phase: "backfill", running: true });
  const exec = async () => {
    let aborted = false;
    try {
      for (;;) {
        if (st.backfillAbort) break;
        const cur = readMemoryConfig(ctx);
        const entries = ctx.db.listJournalEntriesSince({
          sinceUpdatedAt: cur.lastCoveredAt,
          limit: cur.backfillBatchEntries
        });
        if (!entries.length) break;
        const r = await runRound(ctx, { kind: "ingest", trigger: "backfill", entries });
        if (!r.ok) break; // 失败即停：水位线未推进，下次继续（§4.18-16④）
        st.backfill.done += entries.length;
        broadcast(ctx, { phase: "backfill", running: true, done: st.backfill.done, total: st.backfill.total });
      }
    } finally {
      aborted = st.backfillAbort;
      st.backfillAbort = false;
      st.backfill = { running: false, done: st.backfill.done, total: st.backfill.total };
      broadcast(ctx, { phase: "backfill", running: false, aborted });
    }
    return { ok: true, done: st.backfill.done, aborted };
  };
  const task = st.queue.then(exec, exec);
  st.queue = task.catch(() => {});
  return task;
}

function cancelBackfill() {
  s().backfillAbort = true;
  return true;
}

// 启动补跑（§4.18-11①）：开启 + 有未整理条目 + 距上次成功 ≥12h。fire-and-forget，失败不阻塞启动。
function startupBackfillIfDue(ctx) {
  try {
    const cfg = readMemoryConfig(ctx);
    if (!cfg.enabled) return false;
    const stats = backfillStats(ctx);
    if (!stats.entryCount) return false;
    const last = ctx.db.getLastMemoryRunSuccess();
    if (last && Date.now() - Number(last.startedAt || 0) < STARTUP_BACKFILL_MIN_HOURS * 3600000) return false;
    runBackfill(ctx).catch((err) => {
      s().lastError = String(err && err.message);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------- 状态（设置页 sec-memory 数据源） ----------

function getStatus(ctx) {
  const cfg = readMemoryConfig(ctx);
  const dir = memoryDirOf(ctx);
  const usage = memoryStore.usageStats(dir);
  const pending = backfillStats(ctx);
  return {
    enabled: cfg.enabled,
    introAcked: cfg.introAcked,
    memoryDir: dir,
    lastCoveredAt: cfg.lastCoveredAt,
    tidyDebounceMinutes: cfg.tidyDebounceMinutes,
    backfillBatchEntries: cfg.backfillBatchEntries,
    inputTokenBudget: cfg.inputTokenBudget,
    consolidateEveryRounds: cfg.consolidateEveryRounds,
    injectBudget: cfg.injectBudget,
    usage,
    pending,
    backfill: { ...s().backfill },
    lastError: s().lastError,
    treeReady: usage.index.chars > 0
  };
}

module.exports = {
  TIDY_DEFAULTS,
  readMemoryConfig,
  writeMemoryConfig,
  memoryDirOf,
  injectBudgetsFor,
  notifyJournalChanged,
  runIngestRound,
  runBackfill,
  cancelBackfill,
  startupBackfillIfDue,
  backfillStats,
  getStatus,
  parseJsonLoose,
  // 测试钩子：清计时器与状态（进程内多库切换用）
  _resetForTest() {
    if (state) cancelTimers();
    state = null;
  }
};
