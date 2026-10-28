// BDI（D248）：事件目录 + 运行时校验。唯一事实来源＝docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §6 / §5.2。
// 本文件不 require("electron")，纯 Node 可测；docs/bdi-catalog.md 与 src/lib/behavior/catalog.generated.ts 由它生成。
"use strict";
const { isUuid } = require("./uuid7");

const CATALOG_VERSION = 1;
/** text 列上限（设计稿 §5.2：仅 allowText 且设置打开；≤200 字） */
const TEXT_MAX = 200;
/** 单个 props 字符串上限 */
const PROP_STR_MAX = 200;
/** props 数组上限 */
const PROP_ARR_MAX = 24;

const SOURCES = ["main", "host", "lens", "workbench", "capture"];
const ACTORS = ["user", "background", "unknown"];
const ORIGINS = [
  "shelf", "search", "browse", "card_source", "link", "mindmap", "kp", "journal", "resume",
  "queue", "recommend", "review_flow", "notification", "capture", "reader_toc", "reader_internal",
  "workbench", "unknown",
];
const ENTITY_TYPES = ["library_item", "card", "extract", "batch", "map_node", "track", "kp", "document", "journal", "other"];

/** 事件公共列（§5.2 除去 host 自赋的 seq / 落库列） */
const EVENT_FIELDS = [
  "uid", "ts", "recv_ts", "source_ts", "day", "tz_name", "tz_offset", "cutoff_hour", "clock_flags",
  "type", "v", "src", "render_id", "window_id", "session_id", "ctx_id", "presentation_id", "op_id",
  "actor", "surface", "origin", "entity_type", "entity_id", "library_item_id", "card_id", "extract_id",
  "kp_id", "doc_pos", "dur_ms", "num", "text", "props",
];
const FIELD_SET = new Set(EVENT_FIELDS);

// ---------- props 类型 ----------
const S = (maxLen = 120) => ({ type: "string", maxLen });
const I = () => ({ type: "int" });
const N = () => ({ type: "num" });
const B = () => ({ type: "bool" });
const E = (...values) => ({ type: "enum", values });
const A = (maxItems = PROP_ARR_MAX) => ({ type: "strarray", maxItems });
/** 标量：string | finite number | boolean（用于 settings.changed.to 这类枚举/数值混合值） */
const SC = () => ({ type: "scalar" });

const p = (props) => props;

const SECTIONS = [
  { id: "6.1", title: "应用 / 会话 / 导航" },
  { id: "6.2", title: "书架 / 导入 / 阅读" },
  { id: "6.3", title: "摘录 / 批注 / 摘录复习" },
  { id: "6.4", title: "制卡" },
  { id: "6.5", title: "复习" },
  { id: "6.6", title: "浏览 / 搜索 / 查词 / AI" },
  { id: "6.7", title: "导图 / 知识点 / 学习者 / 日记 / 其他" },
];

/**
 * 事件目录。字段：owner(M|R|B|W，可组合如 M+R)、doc(目录表「关键字段 / props」原文)、
 * props(运行时校验的显式类型)、allowText、maxPerMin、intentOnly。
 */
const EVENTS = {
  // ---- 6.1 ----
  "app.started": { section: "6.1", owner: "W", doc: "launchKind(cold/relaunch/login_item), appVersion", maxPerMin: 5, props: p({ launchKind: E("cold", "relaunch", "login_item"), appVersion: S(32) }) },
  "app.updated": { section: "6.1", owner: "W", doc: "fromVersion, toVersion", maxPerMin: 5, props: p({ fromVersion: S(32), toVersion: S(32) }) },
  "app.window_state": { section: "6.1", owner: "W", doc: "window(main/lens/workbench/capture), state(focus/blur/minimize/restore/show/hide/tray), prevTs, durMs", maxPerMin: 120, props: p({ window: E("main", "lens", "workbench", "capture"), state: E("focus", "blur", "minimize", "restore", "show", "hide", "tray"), prevTs: I(), durMs: I() }) },
  "app.power": { section: "6.1", owner: "W", doc: "state(suspend/resume/lock/unlock)", maxPerMin: 30, props: p({ state: E("suspend", "resume", "lock", "unlock") }) },
  "nav.view": { section: "6.1", owner: "B", doc: "from, to", maxPerMin: 120, props: p({ from: S(40), to: S(40) }) },
  "nav.overlay": { section: "6.1", owner: "B", doc: "overlayId, action(open/close)；关闭时 durMs", maxPerMin: 120, props: p({ overlayId: S(60), action: E("open", "close"), durMs: I() }) },
  "cmd.invoked": { section: "6.1", owner: "R", doc: "commandId, via(shortcut/palette/menu/button)", maxPerMin: 120, props: p({ commandId: S(60), via: E("shortcut", "palette", "menu", "button") }) },
  "tray.action": { section: "6.1", owner: "M", doc: "action", maxPerMin: 60, props: p({ action: S(40) }) },

  // ---- 6.2 ----
  "library.imported": { section: "6.2", owner: "M", doc: "entity=library_item；sourceType, via(picker/paste/drag/capture/html/url), sizeBytes, ok", maxPerMin: 60, props: p({ sourceType: S(40), via: E("picker", "paste", "drag", "capture", "html", "url"), sizeBytes: I(), ok: B() }) },
  "library.deleted": { section: "6.2", owner: "M", doc: "entity=library_item", maxPerMin: 60, props: p({}) },
  "library.meta_edited": { section: "6.2", owner: "M", doc: "field(title/author/lang/priority)", maxPerMin: 60, props: p({ field: E("title", "author", "lang", "priority") }) },
  "library.opened": { section: "6.2", owner: "R", doc: "entity=library_item；origin；ctx_id=新阅读会话；doc_pos=恢复位置", maxPerMin: 60, props: p({}) },
  "library.closed": { section: "6.2", owner: "R", doc: "ctx_id；progressPct", maxPerMin: 60, props: p({ progressPct: N() }) },
  "shelf.filtered": { section: "6.2", owner: "R", doc: "kind(sort/filter/search), value（枚举）；text=搜索词（allowText）", maxPerMin: 120, allowText: true, props: p({ kind: E("sort", "filter", "search"), value: S(60) }) },
  "reader.jumped": { section: "6.2", owner: "R", doc: "doc_pos=目标；method(toc/search/link/mindmap/annotation/extract/bookmark/progress_bar), fromPos", maxPerMin: 240, props: p({ method: E("toc", "search", "link", "mindmap", "annotation", "extract", "bookmark", "progress_bar"), fromPos: I() }) },
  "reader.searched": { section: "6.2", owner: "R", doc: "text=查询词（allowText）；num=命中数", maxPerMin: 60, allowText: true, props: p({ num: I() }) },
  "reader.selection_action": { section: "6.2", owner: "R", doc: "num=选中字数；action(extract/annotate/highlight/explain/ste/translate/dict/card/copy/mindmap/search/other)", maxPerMin: 240, props: p({ num: I(), action: E("extract", "annotate", "highlight", "explain", "ste", "translate", "dict", "card", "copy", "mindmap", "search", "other") }) },
  "reader.sidebar_tab": { section: "6.2", owner: "R", doc: "tab", maxPerMin: 120, props: p({ tab: S(40) }) },
  "reader.image_focused": { section: "6.2", owner: "R", doc: "—", maxPerMin: 120, props: p({}) },
  "reader.appearance": { section: "6.2", owner: "R", doc: "key（只记改了哪项）", maxPerMin: 60, props: p({ key: S(60) }) },
  "reader.workflow": { section: "6.2", owner: "B", doc: "state", maxPerMin: 60, props: p({ state: S(40) }) },
  "reader.finished": { section: "6.2", owner: "R", doc: "progressPct；每 (dataEpoch,itemId) 一次", maxPerMin: 10, props: p({ progressPct: N() }) },

  // ---- 6.3 ----
  "extract.created": { section: "6.3", owner: "M", doc: "extract_id；num=字数；via(selection/ai_next/capture/manual), priority, kind(extract/highlight)", maxPerMin: 120, props: p({ num: I(), via: E("selection", "ai_next", "capture", "manual"), priority: I(), kind: E("extract", "highlight") }) },
  "extract.op": { section: "6.3", owner: "M", doc: "extract_id；op(postpone/postponeDays/advance/update/setPriority/setStatus/delete/batch/spanSet/switchEngine/rerankNow), delta, batchSize, annotation(bool), fieldNames[], color；**不记正文**", maxPerMin: 240, props: p({ op: E("postpone", "postponeDays", "advance", "update", "setPriority", "setStatus", "delete", "batch", "spanSet", "switchEngine", "rerankNow"), delta: I(), batchSize: I(), annotation: B(), fieldNames: A(), color: S(24) }) },
  "extract.session": { section: "6.3", owner: "R", doc: "ctx_id；phase(start/end), planned, done；dur_ms", maxPerMin: 30, props: p({ phase: E("start", "end"), planned: I(), done: I(), dur_ms: I() }) },
  "extract.shown": { section: "6.3", owner: "R", doc: "extract_id, ctx_id；origin=queue；position", maxPerMin: 240, props: p({ position: I() }) },
  "extract.reviewed": { section: "6.3", owner: "R", doc: "extract_id, ctx_id；props: outcome(resolved/postponed/deferred)、thinkMs", maxPerMin: 120, props: p({ outcome: E("resolved", "postponed", "deferred"), thinkMs: N() }) },

  // ---- 6.4 ----
  "card.created": { section: "6.4", owner: "M", doc: "card_id, extract_id；cardType, generatedBy(manual/ai), genBatchId, via(selection/manual_editor/occlusion/ai_batch/disambiguate/workbench)", maxPerMin: 240, props: p({ cardType: S(40), generatedBy: E("manual", "ai"), genBatchId: S(64), via: E("selection", "manual_editor", "occlusion", "ai_batch", "disambiguate", "workbench") }) },
  "card.edited": { section: "6.4", owner: "M", doc: "card_id；fields(变更字段名数组), cardType（surface 区分复习中编辑）", maxPerMin: 240, props: p({ fields: A(), cardType: S(40) }) },
  "card.deleted": { section: "6.4", owner: "M", doc: "card_id", maxPerMin: 60, props: p({}) },
  "card.suspended": { section: "6.4", owner: "M", doc: "card_id；suspended(bool)", maxPerMin: 60, props: p({ suspended: B() }) },
  "card.tags_changed": { section: "6.4", owner: "M", doc: "card_id；tagsCount", maxPerMin: 120, props: p({ tagsCount: I() }) },
  "card.regenerated": { section: "6.4", owner: "R", doc: "**intentOnly**；card_id；reason", maxPerMin: 60, intentOnly: true, props: p({ reason: S(60) }) },
  "card.disambiguated": { section: "6.4", owner: "R", doc: "**intentOnly**；candidates, chosen", maxPerMin: 60, intentOnly: true, props: p({ candidates: I(), chosen: I() }) },
  "card.issue": { section: "6.4", owner: "M", doc: "card_id；op(add/resolve), ruleId, severity", maxPerMin: 120, props: p({ op: E("add", "resolve"), ruleId: S(24), severity: E("error", "warn") }) },
  "ai_batch.created": { section: "6.4", owner: "M", doc: "entity=batch；scope, draftCount", maxPerMin: 60, props: p({ scope: S(40), draftCount: I() }) },
  "ai_batch.resolved": { section: "6.4", owner: "M", doc: "entity=batch；status, accepted, rejected, editedBeforeAccept", maxPerMin: 60, props: p({ status: S(40), accepted: I(), rejected: I(), editedBeforeAccept: I() }) },
  "card.leech_resolved": { section: "6.4", owner: "M", doc: "card_id；resolution", maxPerMin: 30, props: p({ resolution: S(40) }) },

  // ---- 6.5 ----
  "review.session": { section: "6.5", owner: "R", doc: "ctx_id；phase(start/end), mode(due/mixed/custom), planned, done；dur_ms", maxPerMin: 30, props: p({ phase: E("start", "end"), mode: E("due", "mixed", "custom"), planned: I(), done: I(), dur_ms: I() }) },
  "review.shown": { section: "6.5", owner: "R", doc: "card_id, ctx_id, presentation_id；cardType, queue, position, isNew", maxPerMin: 600, props: p({ cardType: S(40), queue: S(40), position: I(), isNew: B() }) },
  "review.revealed": { section: "6.5", owner: "R", doc: "card_id, ctx_id, presentation_id；dur_ms=think_ms（performance.now）", maxPerMin: 600, props: p({ dur_ms: I() }) },
  "review.extra_revealed": { section: "6.5", owner: "R", doc: "card_id；kind(mnemonic/example/context/source)", maxPerMin: 600, props: p({ kind: E("mnemonic", "example", "context", "source") }) },
  "review.rated": { section: "6.5", owner: "M", doc: "card_id；ts=t1；dur_ms=单调 tap 耗时；props: tapStartTs, tapEndTs, tapSeq, durationMs（渲染层墙钟入参原样）", maxPerMin: 600, props: p({ tapStartTs: N(), tapEndTs: N(), tapSeq: I(), durationMs: N() }) },
  "review.undone": { section: "6.5", owner: "M", doc: "card_id", maxPerMin: 60, props: p({}) },
  "review.skipped": { section: "6.5", owner: "M", doc: "card_id", maxPerMin: 240, props: p({}) },
  "review.source_opened": { section: "6.5", owner: "R", doc: "card_id（主动动作证据，不等于已证明兴趣）", maxPerMin: 120, props: p({}) },
  "review.answer_judged": { section: "6.5", owner: "R", doc: "card_id；mode, verdict", maxPerMin: 120, props: p({ mode: S(40), verdict: S(40) }) },
  "review.leech": { section: "6.5", owner: "B", doc: "card_id", maxPerMin: 60, props: p({}) },
  "growth.feedback_shown": { section: "6.5", owner: "R", doc: "**intentOnly**；tier", maxPerMin: 60, intentOnly: true, props: p({ tier: S(40) }) },

  // ---- 6.6 ----
  "browse.queried": { section: "6.6", owner: "R", doc: "text=查询词（allowText）；num=结果数；filters(过滤器键名数组), sort", maxPerMin: 120, allowText: true, props: p({ num: I(), filters: A(), sort: S(40) }) },
  "browse.card_opened": { section: "6.6", owner: "R", doc: "card_id；origin=browse", maxPerMin: 240, props: p({}) },
  "browse.bulk_op": { section: "6.6", owner: "R", doc: "op, count", maxPerMin: 60, props: p({ op: S(40), count: I() }) },
  "dict.lookup": { section: "6.6", owner: "M", doc: "text=词（allowText，默认关）；lang, source(local/online), hit；**无正文/例句**", maxPerMin: 240, allowText: true, props: p({ lang: S(16), source: E("local", "online"), hit: B() }) },
  "dict.source_op": { section: "6.6", owner: "M", doc: "op(toggle/remove/import/download)", maxPerMin: 60, props: p({ op: E("toggle", "remove", "import", "download") }) },
  "similarity.queried": { section: "6.6", owner: "M", doc: "num=返回数", maxPerMin: 120, props: p({ num: I() }) },
  "ai.invoked": { section: "6.6", owner: "R", doc: "feature(card_gen/explain/ste/translate/chat/next_extract/mindmap/kp_extract/insight/memory/judge/other), outcome(ok/error/aborted)；dur_ms；num=输出字数", maxPerMin: 120, props: p({ feature: E("card_gen", "explain", "ste", "translate", "chat", "next_extract", "mindmap", "kp_extract", "insight", "memory", "judge", "other"), outcome: E("ok", "error", "aborted"), dur_ms: I(), num: I() }) },
  "ai.panel_turn": { section: "6.6", owner: "R", doc: "num=提问字数（不记正文）", maxPerMin: 120, props: p({ num: I() }) },
  "ai.websearch": { section: "6.6", owner: "M", doc: "num=结果数（不记查询词）", maxPerMin: 60, props: p({ num: I() }) },

  // ---- 6.7 ----
  "mindmap.generated": { section: "6.7", owner: "M", doc: "library_item_id；kind, ok", maxPerMin: 60, props: p({ kind: S(40), ok: B() }) },
  "mindmap.node_action": { section: "6.7", owner: "M+R", doc: "entity=map_node；action(expand/expand_all/explain/deepen/jump)", maxPerMin: 240, props: p({ action: E("expand", "expand_all", "explain", "deepen", "jump") }) },
  "mindmap.viewed": { section: "6.7", owner: "R", doc: "library_item_id；origin", maxPerMin: 60, props: p({}) },
  "knowledge.op": { section: "6.7", owner: "M", doc: "kp_id；op(create/update/merge/unmerge/relation/deleteRelation/ref/resolveProposal/extractApply)", maxPerMin: 120, props: p({ op: E("create", "update", "merge", "unmerge", "relation", "deleteRelation", "ref", "resolveProposal", "extractApply") }) },
  "knowledge.viewed": { section: "6.7", owner: "R", doc: "kp_id；origin", maxPerMin: 120, props: p({}) },
  "learner.track_op": { section: "6.7", owner: "M", doc: "entity=track；op(save/delete/setMaterial), mode", maxPerMin: 60, props: p({ op: E("save", "delete", "setMaterial"), mode: S(24) }) },
  "learner.panel_action": { section: "6.7", owner: "B", doc: "action；origin=recommend", maxPerMin: 60, props: p({ action: S(40) }) },
  "learner.exercise": { section: "6.7", owner: "M", doc: "kind(lexeme_mark/placement/unit_reread/reel_done/self_explain), outcome；**不读 payload 正文**", maxPerMin: 120, props: p({ kind: E("lexeme_mark", "placement", "unit_reread", "reel_done", "self_explain"), outcome: S(40) }) },
  "journal.written": { section: "6.7", owner: "M", doc: "num=字数；op(create/update/draftSend/delete), via(page/quick_capture/draft_send)", maxPerMin: 120, props: p({ num: I(), op: E("create", "update", "draftSend", "delete"), via: E("page", "quick_capture", "draft_send") }) },
  "capture.used": { section: "6.7", owner: "M", doc: "kind(screen/text/image/region), trigger(global_shortcut/tray/button)", maxPerMin: 60, props: p({ kind: E("screen", "text", "image", "region"), trigger: E("global_shortcut", "tray", "button") }) },
  "memory.op": { section: "6.7", owner: "M", doc: "op(setEnabled/backfillStart/backfillCancel/tidyNow/reset)", maxPerMin: 30, props: p({ op: E("setEnabled", "backfillStart", "backfillCancel", "tidyNow", "reset") }) },
  "insight.op": { section: "6.7", owner: "M", doc: "op", maxPerMin: 60, props: p({ op: S(40) }) },
  "insight.viewed": { section: "6.7", owner: "R", doc: "viewed 记打开", maxPerMin: 60, props: p({}) },
  "meaning.op": { section: "6.7", owner: "M", doc: "op(create/resolve/delete)", maxPerMin: 60, props: p({ op: E("create", "resolve", "delete") }) },
  "stats.viewed": { section: "6.7", owner: "R", doc: "tab", maxPerMin: 60, props: p({ tab: S(40) }) },
  "settings.changed": { section: "6.7", owner: "M", doc: "key；白名单键另记 to（枚举/数值）；**AI Key/URL/路径永不记**", maxPerMin: 60, props: p({ key: S(80), to: SC() }) },
  "fsrs.optimizer": { section: "6.7", owner: "M", doc: "op(train/apply/reset), ok", maxPerMin: 30, props: p({ op: E("train", "apply", "reset"), ok: B() }) },
  "backup.op": { section: "6.7", owner: "M", doc: "op, ok", maxPerMin: 30, props: p({ op: S(40), ok: B() }) },
  "anki.exported": { section: "6.7", owner: "M", doc: "op, ok", maxPerMin: 30, props: p({ op: S(40), ok: B() }) },
  "op.undo": { section: "6.7", owner: "M", doc: "domain(card/extract/other)", maxPerMin: 120, props: p({ domain: E("card", "extract", "other") }) },
  "app.error": { section: "6.7", owner: "M", doc: "module/代码（**不记消息正文**）", maxPerMin: 30, props: p({ module: S(60), code: S(60) }) },
};

const EVENT_NAMES = Object.keys(EVENTS);

function getEvent(type) {
  return Object.prototype.hasOwnProperty.call(EVENTS, type) ? EVENTS[type] : null;
}

/** 供文档 / TS 目录生成：按 section 与登记顺序返回稳定结构。 */
function catalog() {
  return EVENT_NAMES.map((type) => {
    const e = EVENTS[type];
    return {
      type,
      section: e.section,
      owner: e.owner,
      doc: e.doc,
      intentOnly: !!e.intentOnly,
      allowText: !!e.allowText,
      maxPerMin: e.maxPerMin,
      props: Object.entries(e.props).map(([name, spec]) => ({ name, ...spec })),
    };
  });
}

// ---------- 校验 ----------
function fail(code, detail) {
  return { ok: false, code, detail };
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function checkProp(name, spec, value) {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") return fail("prop_type", name);
      if (value.length > (spec.maxLen || PROP_STR_MAX)) return fail("prop_too_long", name);
      return null;
    case "int":
      if (!Number.isInteger(value)) return fail("prop_type", name);
      return null;
    case "num":
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("prop_type", name);
      return null;
    case "bool":
      if (typeof value !== "boolean") return fail("prop_type", name);
      return null;
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) return fail("prop_enum", name);
      return null;
    case "scalar":
      if (typeof value === "boolean") return null;
      if (typeof value === "number" && Number.isFinite(value)) return null;
      if (typeof value === "string" && value.length <= PROP_STR_MAX) return null;
      return fail("prop_type", name);
    case "strarray":
      if (!Array.isArray(value)) return fail("prop_type", name);
      if (value.length > (spec.maxItems || PROP_ARR_MAX)) return fail("prop_too_many", name);
      for (const item of value) {
        if (typeof item !== "string") return fail("prop_nested", name);
        if (item.length > 64) return fail("prop_too_long", name);
      }
      return null;
    default:
      return fail("prop_spec", name);
  }
}

/**
 * 校验一条待写入事件。纯函数：不查库、不读设置、不生成 uid。
 * opts.recordQueryText（默认 false）控制 text 是否允许落库。
 * 返回 {ok:true} 或 {ok:false, code, detail}。
 */
function validate(event, opts) {
  const o = opts || {};
  if (!isPlainObject(event)) return fail("not_object");
  for (const key of Object.keys(event)) {
    if (!FIELD_SET.has(key)) return fail("field_unknown", key);
  }
  const meta = getEvent(event.type);
  if (!meta) return fail("type_unknown", String(event.type));
  const v = event.v === undefined ? 1 : event.v;
  if (v !== 1) return fail("version_unsupported", String(v));
  if (typeof event.src !== "string" || !SOURCES.includes(event.src)) return fail("src_unknown", String(event.src));
  if (typeof event.session_id !== "string" || event.session_id === "") return fail("session_missing");
  if (event.uid !== undefined && !isUuid(event.uid)) return fail("uid_invalid");
  for (const k of ["ts", "recv_ts"]) {
    const n = event[k];
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fail("ts_invalid", k);
  }
  if (event.source_ts !== undefined && event.source_ts !== null) {
    if (!Number.isInteger(event.source_ts) || event.source_ts <= 0) return fail("ts_invalid", "source_ts");
  }
  if (typeof event.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.day)) return fail("day_invalid");
  if (event.tz_name !== undefined && event.tz_name !== null && (typeof event.tz_name !== "string" || event.tz_name.length > 64)) return fail("tz_name_invalid");
  if (!Number.isInteger(event.tz_offset) || event.tz_offset < -840 || event.tz_offset > 840) return fail("tz_offset_invalid");
  if (!Number.isInteger(event.cutoff_hour) || event.cutoff_hour < 0 || event.cutoff_hour > 23) return fail("cutoff_invalid");
  if (event.clock_flags !== undefined && (!Number.isInteger(event.clock_flags) || event.clock_flags < 0 || event.clock_flags > 15)) return fail("clock_flags_invalid");
  if (event.actor !== undefined && event.actor !== null && !ACTORS.includes(event.actor)) return fail("actor_invalid", String(event.actor));
  if (event.origin !== undefined && event.origin !== null && !ORIGINS.includes(event.origin)) return fail("origin_invalid", String(event.origin));
  if (event.entity_type !== undefined && event.entity_type !== null && !ENTITY_TYPES.includes(event.entity_type)) return fail("entity_type_invalid", String(event.entity_type));
  if (event.window_id !== undefined && event.window_id !== null && (!Number.isInteger(event.window_id) || event.window_id < 0)) return fail("window_id_invalid");
  for (const k of ["render_id", "ctx_id", "presentation_id", "op_id", "entity_id", "library_item_id", "card_id", "extract_id", "kp_id"]) {
    if (event[k] !== undefined && event[k] !== null && (typeof event[k] !== "string" || event[k].length > 128)) return fail("id_invalid", k);
  }
  if (event.doc_pos !== undefined && event.doc_pos !== null && (!Number.isInteger(event.doc_pos) || event.doc_pos < 0)) return fail("doc_pos_invalid");
  if (event.dur_ms !== undefined && event.dur_ms !== null && (!Number.isFinite(event.dur_ms) || event.dur_ms < 0)) return fail("dur_invalid");
  if (event.num !== undefined && event.num !== null && (typeof event.num !== "number" || !Number.isFinite(event.num))) return fail("num_invalid");
  if (event.surface !== undefined && event.surface !== null && (typeof event.surface !== "string" || event.surface.length > 32)) return fail("surface_invalid");
  if (event.text !== undefined && event.text !== null) {
    if (!meta.allowText) return fail("text_not_allowed");
    if (!o.recordQueryText) return fail("text_disabled");
    if (typeof event.text !== "string") return fail("text_invalid");
    if (event.text.length > TEXT_MAX) return fail("text_too_long");
  }
  if (event.props !== undefined && event.props !== null) {
    if (!isPlainObject(event.props)) return fail("props_not_object");
    for (const [name, value] of Object.entries(event.props)) {
      const spec = meta.props[name];
      if (!spec) return fail("prop_unknown", name);
      const err = checkProp(name, spec, value);
      if (err) return err;
    }
  }
  return { ok: true };
}

module.exports = {
  CATALOG_VERSION,
  TEXT_MAX,
  PROP_STR_MAX,
  SOURCES,
  ACTORS,
  ORIGINS,
  ENTITY_TYPES,
  EVENT_FIELDS,
  SECTIONS,
  EVENTS,
  EVENT_NAMES,
  getEvent,
  catalog,
  validate,
};
