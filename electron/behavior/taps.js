// BDI（D248 / T4）：channel → 事件映射 + 只计数登记（§7.1 / §6.9 / §6.10）。
// 纪律：每个写通道二选一——登记事件映射，或带理由只计数；未登记通道由 behavior-ipc-tap 测试判失败。
// 本文件只做静态投影：不查库、不解析大 JSON、不 await、不序列化正文（§7.1 规则 6）。
"use strict";

const idOf = (r) => (r && typeof r === "object" ? r.id ?? r.itemId ?? r.cardId ?? r.extractId ?? r.runId ?? r.trackId ?? null : null);
const charsOf = (v) => (typeof v === "string" ? Array.from(v).length : 0);
const numOf = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const arrLen = (v) => (Array.isArray(v) ? v.length : 0);
const okNotFalse = (r) => !(r === false || (r && typeof r === "object" && r.ok === false));

/** settings.changed 的白名单键（值另记；其余键只记键名） */
const SETTINGS_VALUE_WHITELIST = new Set([
  "app.language", "app.dayCutoffHour", "app.skinId", "app.motionLevel", "app.accentColor",
  "app.behavior.enabled", "app.behavior.retentionDays", "app.behavior.recordQueryText",
  "app.autoBackupEnabled", "app.autoBackupKeep", "app.tagsEnabled", "app.growthFeedback.enabled",
  "app.learner.enabled", "app.dictMode",
]);
function settingsTo(scope, key, value) {
  const id = `${scope}.${key}`;
  if (!SETTINGS_VALUE_WHITELIST.has(id)) return null;
  if (typeof value === "string" && value.length <= 80) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

/**
 * 事件映射。project(args, result) 返回事件局部字段；ok(result) 判定业务成功（异常已经由 tap 拒绝）。
 * tapTimes=true：review.rated 专用，ipcTap 注入 tapStartTs/tapEndTs/tapSeq（禁止查 latest review_logs）。
 */
const TAPS = {
  // ---- 书架 / 导入 ----
  "library:createFromPaste": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "paste", via: "paste", ok: true } }) },
  "library:createFromEpub": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "epub", via: "picker", ok: true } }) },
  "library:createFromWord": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "word", via: "picker", ok: true } }) },
  "library:createFromTxt": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "txt", via: "picker", ok: true } }) },
  "library:createFromMarkdown": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "markdown", via: "picker", ok: true } }) },
  "library:createFromHtml": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "html", via: "html", ok: true } }) },
  "library:createFromBookFile": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "book", via: "picker", ok: true } }) },
  "library:createFromPdf": { type: "library.imported", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "library_item", entity_id: idOf(r), library_item_id: idOf(r), props: { sourceType: "pdf", via: "picker", ok: true } }) },
  "library:delete": { type: "library.deleted", ok: okNotFalse, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null }) },
  "library:setItemLang": { type: "library.meta_edited", ok: okNotFalse, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, props: { field: "lang" } }) },
  "library:setItemTitle": { type: "library.meta_edited", ok: okNotFalse, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, props: { field: "title" } }) },
  "library:setItemAuthor": { type: "library.meta_edited", ok: okNotFalse, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, props: { field: "author" } }) },
  "library:setPriority": { type: "library.meta_edited", ok: okNotFalse, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, props: { field: "priority" } }) },

  // ---- 摘录 / 批注 ----
  "extracts:create": {
    type: "extract.created", ok: (r) => !!idOf(r),
    project: (a, r) => {
      const p = a[0] && typeof a[0] === "object" ? a[0] : {};
      return {
        entity_type: "extract", entity_id: idOf(r), extract_id: idOf(r), library_item_id: p.libraryItemId ? String(p.libraryItemId) : null,
        props: { num: charsOf(p.sourceText ?? p.text ?? ""), via: ["selection", "ai_next", "capture", "manual"].includes(p.via) ? p.via : "selection", priority: numOf(p.priority), kind: r && r.kind === "highlight" ? "highlight" : "extract" },
      };
    },
  },
  "extracts:postpone": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "postpone" } }) },
  "extracts:postponeDays": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "postponeDays", delta: numOf(a[1]) } }) },
  "extracts:advance": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "advance" } }) },
  "extracts:update": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "update", fieldNames: Object.keys(a[1] && typeof a[1] === "object" ? a[1] : {}) } }) },
  "extracts:setPriority": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "setPriority" } }) },
  "extracts:setStatus": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "setStatus" } }) },
  "extracts:delete": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", entity_id: a[0] ? String(a[0]) : null, extract_id: a[0] ? String(a[0]) : null, props: { op: "delete" } }) },
  "extracts:batch": { type: "extract.op", ok: okNotFalse, project: (a) => ({ entity_type: "extract", props: { op: "batch", batchSize: arrLen(a[1]) } }) },
  "extracts:spanSet": { type: "extract.op", ok: (r) => !!r && Array.isArray(r.spans), project: () => ({ props: { op: "spanSet" } }) },
  "extracts:switchEngine": { type: "extract.op", ok: okNotFalse, project: () => ({ props: { op: "switchEngine" } }) },
  "extracts:rerankNow": { type: "extract.op", ok: (r) => !!r && r.ok === true, project: () => ({ props: { op: "rerankNow" } }) },

  // ---- 制卡 ----
  "cards:create": {
    type: "card.created", ok: (r) => !!idOf(r),
    project: (a, r) => {
      const c = a[0] && typeof a[0] === "object" ? a[0] : {};
      return {
        entity_type: "card", entity_id: idOf(r), card_id: idOf(r), extract_id: c.extractId ? String(c.extractId) : null,
        props: {
          cardType: c.cardType ? String(c.cardType).slice(0, 40) : null,
          generatedBy: c.generatedBy === "ai" ? "ai" : "manual",
          genBatchId: c.genBatchId ? String(c.genBatchId).slice(0, 64) : null,
          via: ["selection", "manual_editor", "occlusion", "ai_batch", "disambiguate", "workbench"].includes(c.via) ? c.via : "manual_editor",
        },
      };
    },
  },
  "cards:update": { type: "card.edited", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0]?.id ? String(a[0].id) : null, card_id: a[0]?.id ? String(a[0].id) : null, props: { fields: Object.keys(a[0] || {}).filter((k) => k !== "id").slice(0, 12), cardType: a[0]?.cardType ? String(a[0].cardType).slice(0, 40) : null } }) },
  "cards:delete": { type: "card.deleted", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null }) },
  "cards:setSuspended": { type: "card.suspended", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null, props: { suspended: a[1] === true } }) },
  "cards:setTags": { type: "card.tags_changed", ok: okNotFalse, project: (a) => ({ entity_type: "card", props: { tagsCount: arrLen(a[0]) } }) },
  "cards:review": {
    type: "review.rated", ok: (r) => r === true, tapTimes: true,
    project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null, props: { durationMs: numOf(a[3]) } }),
  },
  "cards:undoReview": { type: "review.undone", ok: okNotFalse, project: (a, r) => ({ entity_type: "card", card_id: r && r.cardId ? String(r.cardId) : null }) },
  "cards:skip": { type: "review.skipped", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null }) },
  "cards:resolveLeech": { type: "card.leech_resolved", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null, props: { resolution: a[1] ? String(a[1]).slice(0, 40) : null } }) },
  "cards:updateLeech": { type: "card.edited", ok: okNotFalse, project: (a) => ({ entity_type: "card", entity_id: a[0] ? String(a[0]) : null, card_id: a[0] ? String(a[0]) : null, props: { fields: ["leech"] } }) },
  "issues:add": { type: "card.issue", ok: okNotFalse, project: (a) => ({ entity_type: "card", card_id: a[0]?.cardId ? String(a[0].cardId) : null, props: { op: "add", ruleId: a[0]?.ruleId ? String(a[0].ruleId).slice(0, 24) : null, severity: a[0]?.severity === "error" ? "error" : "warn" } }) },
  "issues:resolve": { type: "card.issue", ok: okNotFalse, project: () => ({ props: { op: "resolve" } }) },
  "batches:create": { type: "ai_batch.created", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "batch", entity_id: idOf(r), props: { scope: a[0]?.scope ? String(a[0].scope).slice(0, 40) : null, draftCount: numOf(a[0]?.draftCount) } }) },
  "batches:setStatus": { type: "ai_batch.resolved", ok: okNotFalse, project: (a, r) => ({ entity_type: "batch", entity_id: a[0] ? String(a[0]) : null, props: { status: a[1] ? String(a[1]).slice(0, 40) : null, accepted: numOf(r?.accepted), rejected: numOf(r?.rejected), editedBeforeAccept: numOf(r?.editedBeforeAccept) } }) },

  // ---- 复习之外的用户动作 ----
  "dict:lookupLocal": { type: "dict.lookup", ok: () => true, project: (a, r) => ({ text: typeof a[0] === "string" ? a[0] : null, props: { lang: Array.isArray(r) && r[0]?.sourceLanguage ? String(r[0].sourceLanguage).slice(0, 16) : "", source: "local", hit: Array.isArray(r) && r.length > 0 } }) },
  "dict:lookupOnline": { type: "dict.lookup", ok: () => true, project: (a, r) => ({ text: typeof a[1] === "string" ? a[1] : null, props: { lang: Array.isArray(r) && r[0]?.sourceLanguage ? String(r[0].sourceLanguage).slice(0, 16) : "", source: "online", hit: Array.isArray(r) && r.length > 0 } }) },
  "dict:toggleSource": { type: "dict.source_op", ok: okNotFalse, project: () => ({ props: { op: "toggle" } }) },
  "dict:removeSource": { type: "dict.source_op", ok: okNotFalse, project: () => ({ props: { op: "remove" } }) },
  "dict:importFile": { type: "dict.source_op", ok: okNotFalse, project: () => ({ props: { op: "import" } }) },
  "dict:download": { type: "dict.source_op", ok: okNotFalse, project: () => ({ props: { op: "download" } }) },
  "similarity:find": { type: "similarity.queried", ok: () => true, project: (a, r) => ({ props: { num: arrLen(r) } }) },
  "ai:websearch": { type: "ai.websearch", ok: () => true, project: (a, r) => ({ props: { num: Array.isArray(r) ? r.length : arrLen(r?.results) } }) },

  // ---- 知识点 / 学习者 ----
  "knowledge:createPoint": { type: "knowledge.op", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_type: "kp", entity_id: idOf(r), kp_id: idOf(r), props: { op: "create" } }) },
  "knowledge:updatePoint": { type: "knowledge.op", ok: okNotFalse, project: (a) => ({ entity_type: "kp", entity_id: a[0] ? String(a[0]) : null, kp_id: a[0] ? String(a[0]) : null, props: { op: "update" } }) },
  "knowledge:mergePoints": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "merge" } }) },
  "knowledge:unmergePoint": { type: "knowledge.op", ok: okNotFalse, project: (a) => ({ entity_type: "kp", entity_id: a[0] ? String(a[0]) : null, kp_id: a[0] ? String(a[0]) : null, props: { op: "unmerge" } }) },
  "knowledge:createRelation": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "relation" } }) },
  "knowledge:deleteRelation": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "deleteRelation" } }) },
  "knowledge:createRef": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "ref" } }) },
  "knowledge:resolveProposal": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "resolveProposal" } }) },
  "knowledge:kpExtractApply": { type: "knowledge.op", ok: okNotFalse, project: () => ({ props: { op: "extractApply" } }) },
  "learner:saveTrack": { type: "learner.track_op", ok: okNotFalse, project: (a, r) => ({ entity_type: "track", entity_id: idOf(r), props: { op: "save", mode: a[0]?.mode ? String(a[0].mode).slice(0, 24) : null } }) },
  "learner:deleteTrack": { type: "learner.track_op", ok: okNotFalse, project: (a) => ({ entity_type: "track", entity_id: a[0] ? String(a[0]) : null, props: { op: "delete" } }) },
  "learner:setTrackMaterial": { type: "learner.track_op", ok: okNotFalse, project: (a) => ({ entity_type: "track", entity_id: a[0]?.trackId ? String(a[0].trackId) : null, props: { op: "setMaterial", mode: null } }) },
  "learner:logEvent": { type: "learner.exercise", ok: okNotFalse, project: (a) => ({ props: { kind: a[0]?.kind ? String(a[0].kind).slice(0, 40) : null, outcome: a[0]?.payload && typeof a[0].payload === "object" && a[0].payload.outcome ? String(a[0].payload.outcome).slice(0, 40) : null } }) },

  // ---- 导图 / 日记 / 记忆 / 洞察 / 意义 ----
  "mindmap:generate": { type: "mindmap.generated", ok: (r) => okNotFalse(r) && !!r, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, library_item_id: a[0] ? String(a[0]) : null, props: { kind: "section", ok: true } }) },
  "mindmap:graphGenerate": { type: "mindmap.generated", ok: (r) => okNotFalse(r) && !!r, project: (a) => ({ entity_type: "library_item", entity_id: a[0] ? String(a[0]) : null, library_item_id: a[0] ? String(a[0]) : null, props: { kind: "graph", ok: true } }) },
  "mindmap:deepen": { type: "mindmap.node_action", ok: okNotFalse, project: () => ({ entity_type: "map_node", props: { action: "deepen" } }) },
  "mindmap:graphExpand": { type: "mindmap.node_action", ok: okNotFalse, project: () => ({ entity_type: "map_node", props: { action: "expand" } }) },
  "mindmap:graphExpandAll": { type: "mindmap.node_action", ok: okNotFalse, project: () => ({ entity_type: "map_node", props: { action: "expand_all" } }) },
  "mindmap:graphExplain": { type: "mindmap.node_action", ok: okNotFalse, project: () => ({ entity_type: "map_node", props: { action: "explain" } }) },
  "mindmap:graphLocate": { type: "mindmap.node_action", ok: okNotFalse, project: () => ({ entity_type: "map_node", props: { action: "jump" } }) },
  "journal:create": { type: "journal.written", ok: okNotFalse, project: (a) => ({ props: { num: charsOf(a[0]?.contentMarkdown ?? a[0]?.content ?? ""), op: "create", via: "page" } }) },
  "journal:update": { type: "journal.written", ok: okNotFalse, project: (a) => ({ props: { num: charsOf(a[1]?.contentMarkdown ?? a[1]?.content ?? ""), op: "update", via: "page" } }) },
  "journal:delete": { type: "journal.written", ok: okNotFalse, project: () => ({ props: { num: 0, op: "delete", via: "page" } }) },
  "journal:draftSend": { type: "journal.written", ok: okNotFalse, project: () => ({ props: { num: 0, op: "draftSend", via: "draft_send" } }) },
  "memory:setEnabled": { type: "memory.op", ok: okNotFalse, project: () => ({ props: { op: "setEnabled" } }) },
  "memory:backfillStart": { type: "memory.op", ok: okNotFalse, project: () => ({ props: { op: "backfillStart" } }) },
  "memory:backfillCancel": { type: "memory.op", ok: okNotFalse, project: () => ({ props: { op: "backfillCancel" } }) },
  "memory:tidyNow": { type: "memory.op", ok: okNotFalse, project: () => ({ props: { op: "tidyNow" } }) },
  "memory:reset": { type: "memory.op", ok: okNotFalse, project: () => ({ props: { op: "reset" } }) },
  "insights:create": { type: "insight.op", ok: (r) => !!idOf(r), project: (a, r) => ({ entity_id: idOf(r), props: { op: "create" } }) },
  "insights:complete": { type: "insight.op", ok: okNotFalse, project: () => ({ props: { op: "complete" } }) },
  "insights:fail": { type: "insight.op", ok: okNotFalse, project: () => ({ props: { op: "fail" } }) },
  "insights:feedback": { type: "insight.op", ok: okNotFalse, project: () => ({ props: { op: "feedback" } }) },
  "insights:delete": { type: "insight.op", ok: okNotFalse, project: () => ({ props: { op: "delete" } }) },
  "meaning:create": { type: "meaning.op", ok: okNotFalse, project: () => ({ props: { op: "create" } }) },
  "meaning:resolve": { type: "meaning.op", ok: okNotFalse, project: () => ({ props: { op: "resolve" } }) },
  "meaning:delete": { type: "meaning.op", ok: okNotFalse, project: () => ({ props: { op: "delete" } }) },

  // ---- 设置 / 备份 / 优化 / 撤销 / 捕获 ----
  "settings:set": { type: "settings.changed", ok: okNotFalse, project: (a) => ({ props: { key: `${String(a[0] || "")}.${String(a[1] || "")}`.slice(0, 80), to: settingsTo(String(a[0] || ""), String(a[1] || ""), a[2]) } }) },
  "backup:create": { type: "backup.op", ok: okNotFalse, project: () => ({ props: { op: "create", ok: true } }) },
  "backup:restore": { type: "backup.op", ok: okNotFalse, project: () => ({ props: { op: "restore", ok: true } }) },
  "anki:export": { type: "anki.exported", ok: okNotFalse, project: () => ({ props: { op: "export", ok: true } }) },
  "optimizer:train": { type: "fsrs.optimizer", ok: (r) => !!r && r.ok !== false, project: (a, r) => ({ props: { op: "train", ok: !!r && r.ok !== false } }) },
  "optimizer:apply": { type: "fsrs.optimizer", ok: okNotFalse, project: () => ({ props: { op: "apply", ok: true } }) },
  "optimizer:reset": { type: "fsrs.optimizer", ok: okNotFalse, project: () => ({ props: { op: "reset", ok: true } }) },
  "undo:last": { type: "op.undo", ok: okNotFalse, project: (a, r) => ({ props: { domain: r && ["card", "extract"].includes(r.kind) ? r.kind : "other" } }) },
  "capture:toggle": { type: "capture.used", ok: okNotFalse, project: () => ({ props: { kind: "text", trigger: "button" } }) },
};

/** 只计数（带理由）：不产生行为事件，仍进 ipc_daily 诊断计数 */
const COUNT_ONLY = {
  "只读查询（真源各自唯一，不重复记行为）": [
    "library:list", "library:doc", "library:itemByDoc", "library:readBookFile", "library:readPdfFile",
    "library:readFileBytes", "library:readContentImages", "library:readEbookFile",
    "extracts:listDue", "extracts:listAll", "extracts:get", "extracts:chain",
    "limits:usage", "limits:state", "limits:validate", "session:queue", "session:counts", "undo:info",
    "cards:listTags", "cards:get", "cards:genInfo", "cards:listDue", "cards:todayQueue", "cards:listAll",
    "cards:countByExtract", "cards:listWithKnowledgePoint", "cards:listMeta", "cards:queryIds",
    "cards:getWindow", "cards:siblingGroup", "cards:deferredToday", "cards:lastUndoableReview", "cards:listLeech",
    "fsrs:activeConfig", "stats:overview", "stats:timeline",
    "growth:afterReview", "growth:sessionSummary", "growth:overview",
    "optimizer:stats", "optimizer:current", "issues:list",
    "batches:get", "batches:list", "prompts:list", "prompts:get",
    "dict:sources", "dict:cacheGet",
    "journal:list", "journal:dates", "journal:day", "journal:draft",
    "knowledge:listPoints", "knowledge:resolveFamilies", "knowledge:getPoint", "knowledge:listRelations",
    "knowledge:listRefs", "knowledge:listProposals", "knowledge:migrationSuggestions", "knowledge:kpClusters",
    "knowledge:kpExtractPrepare", "knowledge:lint",
    "learner:status", "learner:refresh", "learner:recommend", "learner:feedback", "learner:listTracks",
    "learner:kpLevels", "learner:unitText", "learner:contextReel", "learner:sentenceMine",
    "learner:placementSample", "learner:lexStats", "learner:rebuild",
    "insights:buildPackage", "insights:get", "insights:list", "meaning:list",
    "memory:status", "memory:backfillPreview", "memory:openFolder", "memory:openFile", "memory:retrieve",
    "mindmap:preview", "mindmap:pendingRuns", "mindmap:list", "mindmap:get", "mindmap:getActive",
    "mindmap:mapTree", "mindmap:runs", "mindmap:learningStatus", "mindmap:graphLoad", "mindmap:graphFeed",
    "mindmap:graphEstimate", "mindmap:graphMetrics", "mindmap:graphNodeText", "mindmap:graphEnsureMap",
    "mindmap:graphNodeAnchors", "shortcuts:status", "backup:info", "backup:list", "backup:meta",
    "settings:get", "plugins:list", "plugins:getActive", "update:status",
  ],
  "文件/目录对话框（纯选择，不构成学习动作）": [
    "library:pickEpub", "library:pickWord", "library:pickTxt", "library:pickMarkdown",
    "library:pickImportFiles", "library:pickPdf", "dict:pickFile", "assets:pickOcclusionImage",
    "backup:pickDir", "backup:pickFile", "backup:openDir", "anki:openDir", "memory:openFile",
  ],
  "真源在主库其它表（BDI 不复制事实）": [
    "library:updateProgress", "reading:event", "dict:cacheSet",
  ],
  "流式 AI 通道（owner=渲染层 ai.invoked）": ["ai:chat", "ai:abort"],
  "配置 / 凭证 / 模型探测（只记设置变更走 settings:changed）": [
    "ai:getConfig", "ai:setConfig", "ai:test", "ai:listModels", "ai:detectLocal",
    "plugins:setActive", "plugins:openFolder", "plugins:rescan",
  ],
  "窗口 / 壳层 / 日志（非学习行为）": [
    "win:minimize", "win:maximize", "win:close", "win:dockExtend", "win:dockRestore",
    "win:workbench", "win:cardsChanged", "win:lens", "shell:openExternal", "app:relaunch",
    "logs:rendererError", "logs:openFolder", "lens:fit", "lens:ask", "lens:reply", "lens:push",
    "capture:hide", "capture:ready", "library:requestAdd", "shortcuts:apply",
  ],
  "纯持久化重试（不重执行业务）": ["cards:persistNow"],
  "批量操作语义由参数 op 决定（T7 埋点细分）": ["cards:batch"],
  "卡片辨析链接（并入 card.edited 预留）": ["card-links:add", "card-links:update", "card-links:listForCard"],
  "图片资产写入（非学习行为）": ["assets:saveImage"],
  "草稿节流自动保存（不计行为）": ["journal:draftSave", "journal:flush"],
  "应用更新（联网面在 D180 登记，不是学习行为）": ["update:check", "update:download", "update:install"],
  "导图视图/运行控制（无独立行为语义）": [
    "mindmap:cancel", "mindmap:repairConfirm", "mindmap:delete", "mindmap:setActive",
    "mindmap:graphCancel", "mindmap:graphResume", "mindmap:graphSetView",
  ],
  "知识点批量采纳 / 引用删除（并入 knowledge.op 预留）": ["knowledge:acceptAllPending", "knowledge:deleteRef"],
};

const COUNT_ONLY_SET = new Set(Object.values(COUNT_ONLY).flat());
const CHANNELS = new Set([...Object.keys(TAPS), ...COUNT_ONLY_SET]);

/** 覆盖率：返回扫描到但完全未登记的通道（应为空）。 */
function unregistered(channels) {
  return [...new Set(channels)].filter((c) => !CHANNELS.has(c)).sort();
}

/** behavior:* 一律不包装（避免自反馈）。 */
function shouldWrap(channel) {
  return typeof channel === "string" && !channel.startsWith("behavior:") && CHANNELS.has(channel);
}

module.exports = { TAPS, COUNT_ONLY, COUNT_ONLY_SET, CHANNELS, unregistered, shouldWrap };
