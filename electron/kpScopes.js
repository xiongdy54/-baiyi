// v43（K2-B，§6.3.11 / §4.6 出层纪律）：LKM 4 scope 出层契约校验器 + 离散度守门（纯函数，零依赖）。
// 三层确定性架构的「出层」——AI 只居中间层，其输出必须经本模块封闭契约裁决后才可被消费：
//   ① 越界 id（targetKpId/candidateId/fromKpId 不在输入清单）→ 丢弃留痕（禁编造 ID）；
//   ② 缺 evidence → 该条降 "uncertain" 或丢弃（无依据降 uncertain）；
//   ③ 封闭枚举越界（domain/维度/手法/档位）→ 本地置空或降档；
//   ④ 禁编造数字：解释类文本中的数字必须能在输入原文中找到。
// 裁决结果与 AI 跑几次无关；主进程、tests、prompt-lab 三方共用（对齐 kpNorm.js 惯例）。
// 本模块不接触任何数据库/FSRS 字段。

// 封闭枚举（与提示词模板一致；关系 9 枚举与 db.js KP_RELATION_TYPES 同源）
const KP_RELATION_TYPES = [
  "prerequisite", "part_of", "related_to", "contrasts_with", "example_of",
  "application_of", "generalization_of", "specialization_of", "analogous_to"
];
const PROBE_DIMENSIONS = ["recognition", "recall", "conceptualUnderstanding", "application", "transfer"];
const CONNECTION_MODES = ["analogy", "abstraction", "combination"];
const CHALLENGE_GRADES = ["comfortable", "growth", "stretch", "too_hard"];
const DIFFICULTY_DIMENSIONS = [
  "conceptualDifficulty", "languageDifficulty", "prerequisiteDifficulty",
  "density", "applicationDemand", "transferDemand"
];

// UDC 受控清单（electron/udc.js 同源复制——本模块须零依赖可在 prompt-lab 独立打包，故不 require）
const UDC_CODES = [
  "004", "1", "159.9", "2", "316", "32", "33", "37",
  "51", "53", "54", "55", "57", "61", "62", "63",
  "7", "78", "79", "796", "8", "91", "93", "other"
];

// ── 容错 JSON 解析（与 db.js parseJsonSafeLoose 同思路：首尾截取 + 括号平衡扫描）──
function parseJsonLoose(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "");
  if (!text.trim()) return null;
  const candidates = [];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) { candidates.push(text.slice(objStart, i + 1)); objStart = -1; }
    }
  }
  for (const cand of candidates) {
    try { return JSON.parse(cand); } catch { /* 继续尝试下一个候选 */ }
  }
  return null;
}

// issue code 约定：JSON_PARSE_FAILED / EMPTY / ITEM_DROPPED / FABRICATED_ID / FABRICATED_NUMBER /
// ENUM_CLEARED / MISSING_EVIDENCE / DOWNGRADED_UNCERTAIN / MISSING_DISANALOGY / DUPLICATE_ORIGINAL / LOW_GRADE_HINT
function issue(code, message) { return { code, message }; }

// 档位裁决：只收 1-5 整数或 "uncertain"；其余一律降 "uncertain" 留痕。
function coerceGrade(v) {
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  if (v === "uncertain") return "uncertain";
  return { coerced: "uncertain" };
}

// 禁编造数字：提取文本中的数字串，逐一核对是否出现在输入原文里。
function fabricatedNumbers(text, inputText) {
  const src = String(inputText ?? "");
  const out = [];
  const runs = String(text ?? "").match(/\d+(?:\.\d+)?/g) || [];
  for (const run of runs) {
    if (!src.includes(run)) out.push(run);
  }
  return [...new Set(out)];
}

// ── 1. material-difficulty（材料难度画像）──
// input: { materialText }（用于 evidence 校验的原文；缺省只做结构裁决）
function validateMaterialDifficultyOutput(raw, input = {}) {
  const issues = [];
  const obj = parseJsonLoose(raw);
  if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "输出不是可解析的 JSON 对象")] };
  const src = String(input.materialText ?? "");
  const diffIn = obj.difficulty && typeof obj.difficulty === "object" ? obj.difficulty : {};
  const difficulty = {};
  let anyDim = false;
  for (const dim of DIFFICULTY_DIMENSIONS) {
    const entry = diffIn[dim];
    if (!entry || typeof entry !== "object") {
      difficulty[dim] = { grade: "uncertain", anchor: null, evidence: null };
      issues.push(issue("DOWNGRADED_UNCERTAIN", `维度 ${dim} 缺失，降 uncertain`));
      continue;
    }
    anyDim = true;
    let grade = coerceGrade(entry.grade);
    let evidence = typeof entry.evidence === "string" && entry.evidence.trim() ? entry.evidence.trim() : null;
    if (evidence && src && !src.includes(evidence.replace(/…/g, "").slice(0, 12))) {
      // evidence 无法在原文中定位（宽松核对：前 12 字须出现）→ 视为无依据
      evidence = null;
    }
    if (!evidence && grade !== "uncertain") {
      grade = "uncertain";
      issues.push(issue("DOWNGRADED_UNCERTAIN", `维度 ${dim} 缺 evidence，降 uncertain`));
    }
    if (grade && grade.coerced) {
      grade = grade.coerced;
      issues.push(issue("ENUM_CLEARED", `维度 ${dim} 档位越界，降 uncertain`));
    }
    difficulty[dim] = { grade, anchor: typeof entry.anchor === "string" ? entry.anchor : null, evidence };
  }
  if (!anyDim) return { value: null, issues: [issue("EMPTY", "输出不含任何难度维度")] };
  let overall = coerceGrade(obj.overallGrade);
  if (overall && overall.coerced) {
    overall = "uncertain";
    issues.push(issue("ENUM_CLEARED", "overallGrade 档位越界，降 uncertain"));
  }
  const candidates = [];
  for (const c of Array.isArray(obj.kpCandidates) ? obj.kpCandidates : []) {
    const label = typeof c?.label === "string" ? c.label.trim() : "";
    const evidence = typeof c?.evidence === "string" ? c.evidence.trim() : "";
    if (!label) { issues.push(issue("ITEM_DROPPED", "KP 候选缺 label，已丢弃")); continue; }
    if (!evidence) { issues.push(issue("ITEM_DROPPED", `KP 候选「${label}」缺 evidence，已丢弃`)); continue; }
    let domain = Array.isArray(c.domain) ? c.domain.map((d) => String(d ?? "").trim()).filter((d) => UDC_CODES.includes(d)) : [];
    if (!domain.length) domain = ["other"];
    candidates.push({ label, domain, evidence });
    if (candidates.length >= 10) break;
  }
  const hints = (Array.isArray(obj.prerequisiteGapHints) ? obj.prerequisiteGapHints : [])
    .map((h) => String(h ?? "").trim()).filter(Boolean);
  return {
    value: { difficulty, overallGrade: overall, kpCandidates: candidates, prerequisiteGapHints: hints },
    issues
  };
}

// ── 2. knowledge-probe（维度探针）──
// input: { kpIds: [], kpLabels: {}, cardFronts: [] }——kpId 白名单 + 原卡题面（禁原题重问核对）
function validateKnowledgeProbeOutput(raw, input = {}) {
  const issues = [];
  const obj = parseJsonLoose(raw);
  if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "输出不是可解析的 JSON 对象")] };
  const kpIds = new Set((Array.isArray(input.kpIds) ? input.kpIds : []).map((s) => String(s)));
  const fronts = (Array.isArray(input.cardFronts) ? input.cardFronts : []).map((f) => String(f ?? "").replace(/\s+/g, ""));
  const probes = [];
  for (const p of Array.isArray(obj.probes) ? obj.probes : []) {
    if (!PROBE_DIMENSIONS.includes(p?.dimension)) {
      issues.push(issue("ITEM_DROPPED", "探针 dimension 越界（封闭 5 维），已丢弃"));
      continue;
    }
    const kpId = String(p?.kpId ?? "");
    if (!kpIds.has(kpId)) {
      issues.push(issue("FABRICATED_ID", `探针 kpId「${kpId || "空"}」不在输入清单，已丢弃`));
      continue;
    }
    const evidence = typeof p?.evidence === "string" ? p.evidence.trim() : "";
    if (!evidence) {
      issues.push(issue("ITEM_DROPPED", `探针「${p?.kpLabel || kpId}」缺 evidence，已丢弃`));
      continue;
    }
    const question = typeof p?.situationQuestion === "string" ? p.situationQuestion.trim() : "";
    if (!question) { issues.push(issue("ITEM_DROPPED", "探针缺题面，已丢弃")); continue; }
    // 禁原题重问（双向包含 + 最短 6 字守卫，防短词误杀）：题面与任一原卡题面互含即视为复用
    if (fronts.some((f) => {
      if (!f) return false;
      const q = question.replace(/\s+/g, "");
      return (q.includes(f) || f.includes(q)) && Math.min(q.length, f.length) >= 6;
    })) {
      issues.push(issue("DUPLICATE_ORIGINAL", "探针复用了原卡题面（禁原题重问），已丢弃"));
      continue;
    }
    const points = (Array.isArray(p?.idealAnswerPoints) ? p.idealAnswerPoints : [])
      .map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 4);
    if (!points.length) { issues.push(issue("ITEM_DROPPED", "探针缺可判定答案要点，已丢弃")); continue; }
    probes.push({
      dimension: p.dimension,
      kpId,
      kpLabel: String(p?.kpLabel ?? ""),
      situationQuestion: question,
      idealAnswerPoints: points,
      evidence
    });
    if (probes.length >= 3) break;
  }
  if (!probes.length && !issues.length) issues.push(issue("EMPTY", "输出不含任何探针"));
  return { value: { probes }, issues };
}

// ── 3. frontier-explain（推荐解释）──
// input: { candidateIds: [], structureDrivenIds: [], structureKpIds: [], inputText }——
// inputText＝输入载荷原文（禁编造数字核对源）
function validateFrontierExplainOutput(raw, input = {}) {
  const issues = [];
  const obj = parseJsonLoose(raw);
  if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "输出不是可解析的 JSON 对象")] };
  const candidateIds = new Set((Array.isArray(input.candidateIds) ? input.candidateIds : []).map((s) => String(s)));
  const structureDriven = new Set((Array.isArray(input.structureDrivenIds) ? input.structureDrivenIds : []).map((s) => String(s)));
  const structureKpIds = new Set((Array.isArray(input.structureKpIds) ? input.structureKpIds : []).map((s) => String(s)));
  const src = String(input.inputText ?? "");
  const explanations = [];
  for (const e of Array.isArray(obj.explanations) ? obj.explanations : []) {
    const candidateId = String(e?.candidateId ?? "");
    if (!candidateIds.has(candidateId)) {
      issues.push(issue("FABRICATED_ID", `解释 candidateId「${candidateId || "空"}」不在候选清单，已丢弃`));
      continue;
    }
    // 禁编造数字：reason / knowledgeCoverage 是自由文本，其中的数字必须来自输入原文
    let reason = typeof e?.reason === "string" ? e.reason.trim() : "";
    let coverage = typeof e?.knowledgeCoverage === "string" ? e.knowledgeCoverage.trim() : "";
    if (reason) {
      const bad = fabricatedNumbers(reason, src);
      if (bad.length) { reason = ""; issues.push(issue("FABRICATED_NUMBER", `reason 含输入中不存在的数字 ${bad.join("/")}，已置空`)); }
    }
    if (coverage) {
      const bad = fabricatedNumbers(coverage, src);
      if (bad.length) { coverage = ""; issues.push(issue("FABRICATED_NUMBER", `knowledgeCoverage 含输入中不存在的数字 ${bad.join("/")}，已置空`)); }
    }
    let challenge = typeof e?.expectedChallenge === "string" ? e.expectedChallenge : null;
    if (!CHALLENGE_GRADES.includes(challenge)) {
      challenge = null;
      issues.push(issue("ENUM_CLEARED", "expectedChallenge 越界（封闭四档），已置空"));
    }
    const evidence = typeof e?.evidence === "string" ? e.evidence.trim() : "";
    const uncertainties = (Array.isArray(e?.uncertainties) ? e.uncertainties : []).map((u) => String(u ?? "")).filter(Boolean);
    if (!evidence) {
      uncertainties.push("evidence 缺失，本条解释按 uncertain 处理");
      issues.push(issue("DOWNGRADED_UNCERTAIN", "解释缺 evidence，已加注 uncertain"));
    }
    // 结构驱动候选：必须附槽位映射 + ≥1 条主要差异（§4.14 禁只给结论）
    let structureMapping = null;
    if (structureDriven.has(candidateId)) {
      const slots = [];
      for (const s of Array.isArray(e?.structureMapping) ? e.structureMapping : []) {
        const fromKpId = String(s?.fromKpId ?? "");
        if (!structureKpIds.has(fromKpId)) {
          issues.push(issue("FABRICATED_ID", `槽位 fromKpId「${fromKpId || "空"}」不在已持有结构子图，已丢弃`));
          continue;
        }
        const rel = String(s?.relationType ?? "");
        if (!KP_RELATION_TYPES.includes(rel)) {
          issues.push(issue("ENUM_CLEARED", "槽位 relationType 越界（封闭 9 枚举），已丢弃"));
          continue;
        }
        const toLabel = String(s?.toLabel ?? "").trim();
        if (!toLabel) { issues.push(issue("ITEM_DROPPED", "槽位缺 toLabel，已丢弃")); continue; }
        slots.push({ fromKpId, toLabel, relationType: rel });
      }
      if (slots.length) structureMapping = slots;
      else issues.push(issue("MISSING_EVIDENCE", "结构驱动候选无有效槽位对应（无依据不得编造）"));
      const disanalogy = (Array.isArray(e?.disanalogy) ? e.disanalogy : []).map((d) => String(d ?? "").trim()).filter(Boolean);
      if (!disanalogy.length) issues.push(issue("MISSING_DISANALOGY", "结构驱动候选缺主要差异（disanalogy ≥1 条）"));
    }
    const nextConcepts = (Array.isArray(e?.nextConcepts) ? e.nextConcepts : [])
      .map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3);
    explanations.push({
      candidateId,
      reason: reason || null,
      knowledgeCoverage: coverage || null,
      nextConcepts,
      expectedChallenge: challenge,
      structureMapping,
      disanalogy: (Array.isArray(e?.disanalogy) ? e.disanalogy : []).map((d) => String(d ?? "").trim()).filter(Boolean),
      evidence: evidence || null,
      uncertainties
    });
    if (explanations.length >= 50) break;
  }
  if (!explanations.length && !issues.length) issues.push(issue("EMPTY", "输出不含任何解释"));
  return { value: { explanations }, issues };
}

// ── 4. structure-analogy（结构类比）──
// input: { ownedKpIds: [], domainCodes: [] }
// ── v48.22（D58 §6.8-4 / E1）：摘录重排出层契约 ──
// 输入 candidates＝[{id, text, priority, sourceTitle, overdueDays, localScore}]（**本地序**已算好）；
// 输出的 order 只允许引用输入清单里的 id；理由里的数字必须能在**该候选自身**的字段里找到。
// 越界 id 丢弃留痕；理由编造数字则清空该条理由（座位保留，用本地理由兜底）；全空 ⇒ value=null（保持本地序）。
function validateExtractRerankOutput(raw, input = {}) {
  const issues = [];
  const obj = parseJsonLoose(raw);
  if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "输出不是可解析的 JSON 对象")] };
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const byId = new Map(candidates.map((c) => [String(c?.id ?? ""), c]));
  const order = [];
  const seen = new Set();
  for (const item of Array.isArray(obj.order) ? obj.order : []) {
    const id = String(item?.id ?? "");
    if (!byId.has(id)) {
      issues.push(issue("UNKNOWN_ID", `越界 id 已丢弃：${id || "(空)"}`));
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const cand = byId.get(id) || {};
    let reason = String(item?.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    // 禁编造数字：理由中的数字必须能在该候选的文本/优先级/逾期天数/来源书名里找到
    const hay = `${cand.text ?? ""} ${cand.priority ?? ""} ${cand.overdueDays ?? ""} ${cand.sourceTitle ?? ""}`;
    const allowed = new Set(hay.match(/\d+/g) || []);
    const fabricated = (reason.match(/\d+/g) || []).filter((n) => !allowed.has(n));
    if (fabricated.length > 0) {
      issues.push(issue("FABRICATED_NUMBER", `理由含该条素材里没有的数字 ${fabricated.join(",")}，已清空该条理由`));
      reason = "";
    }
    order.push({ id, reason });
  }
  if (order.length === 0) {
    return { value: null, issues: [...issues, issue("EMPTY_ORDER", "没有任何合法条目（保持本地排序）")] };
  }
  return { value: { order }, issues };
}

function validateStructureAnalogyOutput(raw, input = {}) {
  const issues = [];
  const obj = parseJsonLoose(raw);
  if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "输出不是可解析的 JSON 对象")] };
  // 显式「不成立」是合法输出
  if (obj.result === null) {
    return { value: { result: null, uncertainties: (Array.isArray(obj.uncertainties) ? obj.uncertainties : []).map((u) => String(u ?? "")).filter(Boolean) }, issues };
  }
  const mode = typeof obj.connectionMode === "string" ? obj.connectionMode : null;
  if (!CONNECTION_MODES.includes(mode)) {
    return { value: null, issues: [issue("ENUM_CLEARED", "connectionMode 越界（封闭 3 选一），整包拒绝")] };
  }
  const domainCodes = new Set((Array.isArray(input.domainCodes) ? input.domainCodes : []).map((s) => String(s)));
  const candidateDomain = String(obj.candidateDomain ?? "");
  if (!domainCodes.has(candidateDomain)) {
    return { value: null, issues: [issue("FABRICATED_ID", `candidateDomain「${candidateDomain || "空"}」不在候选领域清单，整包拒绝`)] };
  }
  const ownedKpIds = new Set((Array.isArray(input.ownedKpIds) ? input.ownedKpIds : []).map((s) => String(s)));
  const slots = [];
  for (const s of Array.isArray(obj.slotMapping) ? obj.slotMapping : []) {
    const fromKpId = String(s?.fromKpId ?? "");
    if (!ownedKpIds.has(fromKpId)) {
      issues.push(issue("FABRICATED_ID", `槽位 fromKpId「${fromKpId || "空"}」不在已持有结构子图，已丢弃`));
      continue;
    }
    const rel = String(s?.relationType ?? "");
    if (!KP_RELATION_TYPES.includes(rel)) {
      issues.push(issue("ENUM_CLEARED", "槽位 relationType 越界（封闭 9 枚举），已丢弃"));
      continue;
    }
    const toLabel = String(s?.toLabel ?? "").trim();
    if (!toLabel) { issues.push(issue("ITEM_DROPPED", "槽位缺 toLabel，已丢弃")); continue; }
    const conf = Number(s?.confidence);
    slots.push({ fromKpId, toLabel, relationType: rel, confidence: Number.isInteger(conf) && conf >= 1 && conf <= 5 ? conf : "uncertain" });
  }
  if (!slots.length) {
    return { value: null, issues: [...issues, issue("EMPTY", "无有效槽位对应（禁编造，整包拒绝）")] };
  }
  const evidence = typeof obj.evidence === "string" ? obj.evidence.trim() : "";
  let grade = coerceGrade(obj.similarityGrade);
  if (grade && grade.coerced) {
    grade = "uncertain";
    issues.push(issue("ENUM_CLEARED", "similarityGrade 档位越界，降 uncertain"));
  }
  if (!evidence && grade !== "uncertain") {
    grade = "uncertain";
    issues.push(issue("DOWNGRADED_UNCERTAIN", "evidence 缺失，similarityGrade 降 uncertain"));
  }
  if (typeof grade === "number" && grade <= 2) {
    issues.push(issue("LOW_GRADE_HINT", "相似度 ≤2 档，消费方应按「结构不成立」候选处理"));
  }
  const disanalogy = (Array.isArray(obj.disanalogy) ? obj.disanalogy : []).map((d) => String(d ?? "").trim()).filter(Boolean);
  if (!disanalogy.length) issues.push(issue("MISSING_DISANALOGY", "缺主要差异（disanalogy ≥1 条）"));
  return {
    value: {
      connectionMode: mode,
      structureLabel: typeof obj.structureLabel === "string" ? obj.structureLabel.trim() : null,
      candidateDomain,
      slotMapping: slots,
      similarityGrade: grade,
      evidence: evidence || null,
      disanalogy,
      whyThisDomain: typeof obj.whyThisDomain === "string" ? obj.whyThisDomain.trim() : null,
      falsifiableQuestions: (Array.isArray(obj.falsifiableQuestions) ? obj.falsifiableQuestions : []).map((q) => String(q ?? "").trim()).filter(Boolean),
      uncertainties: (Array.isArray(obj.uncertainties) ? obj.uncertainties : []).map((u) => String(u ?? "")).filter(Boolean)
    },
    issues
  };
}

// ── 离散度守门（§4.6 item 6/7：同材料 × N 次，封闭字段不一致率超阈 → 收紧锚语或降档使用）──
// outputs: N 次运行的【已校验】value 数组；fields: 取值路径数组，"a.b" 取嵌套、"arr[].x" 展开数组。
const SCOPE_DISPERSION_FIELDS = {
  "material-difficulty": DIFFICULTY_DIMENSIONS.map((d) => `difficulty.${d}.grade`).concat(["overallGrade"]),
  "knowledge-probe": ["probes[].dimension"],
  "frontier-explain": ["explanations[].expectedChallenge"],
  "structure-analogy": ["connectionMode", "similarityGrade"]
};

function getByPath(obj, path) {
  const segs = String(path).replace(/\[\]/g, ".").split(".").filter(Boolean);
  let cur = [obj];
  for (const seg of segs) {
    const next = [];
    for (const node of cur) {
      if (node == null) continue;
      if (Array.isArray(node)) {
        for (const item of node) {
          if (item != null && typeof item === "object" && seg in item) next.push(item[seg]);
        }
      } else if (typeof node === "object" && seg in node) {
        next.push(node[seg]);
      }
    }
    cur = next;
  }
  return cur;
}

// 返回 { fields: [{field, values, rate}], maxRate, threshold, over }
// rate ＝ 1 − 众数占比（缺失值计 "∅"）；maxRate 取各字段最大；over ＝ maxRate > threshold。
function scopeDispersion(outputs, fields, threshold = 0.3) {
  const list = (Array.isArray(outputs) ? outputs : []).filter((o) => o != null && typeof o === "object");
  const n = list.length;
  if (n < 2) return { fields: [], maxRate: 0, threshold, over: false };
  const perField = (Array.isArray(fields) ? fields : []).map((field) => {
    const vals = getByPath(list, field).map((v) => (v === undefined || v === null ? "∅" : String(v)));
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const majority = Math.max(0, ...Object.values(counts));
    const rate = vals.length ? 1 - majority / vals.length : 0;
    return { field, values: counts, rate: Math.round(rate * 100) / 100 };
  });
  const maxRate = perField.reduce((m, f) => Math.max(m, f.rate), 0);
  return { fields: perField, maxRate, threshold, over: maxRate > threshold };
}

module.exports = {
  KP_RELATION_TYPES,
  PROBE_DIMENSIONS,
  CONNECTION_MODES,
  CHALLENGE_GRADES,
  DIFFICULTY_DIMENSIONS,
  UDC_CODES,
  SCOPE_DISPERSION_FIELDS,
  parseJsonLoose,
  validateMaterialDifficultyOutput,
  validateKnowledgeProbeOutput,
  validateFrontierExplainOutput,
  validateStructureAnalogyOutput,
  validateExtractRerankOutput,
  scopeDispersion
};
