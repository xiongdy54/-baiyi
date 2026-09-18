"use strict";
var kpScopesLib = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // ../electron/kpScopes.js
  var require_kpScopes = __commonJS({
    "../electron/kpScopes.js"(exports, module) {
      var KP_RELATION_TYPES = [
        "prerequisite",
        "part_of",
        "related_to",
        "contrasts_with",
        "example_of",
        "application_of",
        "generalization_of",
        "specialization_of",
        "analogous_to"
      ];
      var PROBE_DIMENSIONS = ["recognition", "recall", "conceptualUnderstanding", "application", "transfer"];
      var CONNECTION_MODES = ["analogy", "abstraction", "combination"];
      var CHALLENGE_GRADES = ["comfortable", "growth", "stretch", "too_hard"];
      var DIFFICULTY_DIMENSIONS = [
        "conceptualDifficulty",
        "languageDifficulty",
        "prerequisiteDifficulty",
        "density",
        "applicationDemand",
        "transferDemand"
      ];
      var UDC_CODES = [
        "004",
        "1",
        "159.9",
        "2",
        "316",
        "32",
        "33",
        "37",
        "51",
        "53",
        "54",
        "55",
        "57",
        "61",
        "62",
        "63",
        "7",
        "78",
        "79",
        "796",
        "8",
        "91",
        "93",
        "other"
      ];
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
          if (ch === '"') {
            inStr = true;
            continue;
          }
          if (ch === "{") {
            if (depth === 0) objStart = i;
            depth++;
          } else if (ch === "}") {
            depth--;
            if (depth === 0 && objStart >= 0) {
              candidates.push(text.slice(objStart, i + 1));
              objStart = -1;
            }
          }
        }
        for (const cand of candidates) {
          try {
            return JSON.parse(cand);
          } catch {
          }
        }
        return null;
      }
      function issue(code, message) {
        return { code, message };
      }
      function coerceGrade(v) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
        if (v === "uncertain") return "uncertain";
        return { coerced: "uncertain" };
      }
      function fabricatedNumbers(text, inputText) {
        const src = String(inputText ?? "");
        const out = [];
        const runs = String(text ?? "").match(/\d+(?:\.\d+)?/g) || [];
        for (const run of runs) {
          if (!src.includes(run)) out.push(run);
        }
        return [...new Set(out)];
      }
      function validateMaterialDifficultyOutput(raw, input = {}) {
        const issues = [];
        const obj = parseJsonLoose(raw);
        if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "\u8F93\u51FA\u4E0D\u662F\u53EF\u89E3\u6790\u7684 JSON \u5BF9\u8C61")] };
        const src = String(input.materialText ?? "");
        const diffIn = obj.difficulty && typeof obj.difficulty === "object" ? obj.difficulty : {};
        const difficulty = {};
        let anyDim = false;
        for (const dim of DIFFICULTY_DIMENSIONS) {
          const entry = diffIn[dim];
          if (!entry || typeof entry !== "object") {
            difficulty[dim] = { grade: "uncertain", anchor: null, evidence: null };
            issues.push(issue("DOWNGRADED_UNCERTAIN", `\u7EF4\u5EA6 ${dim} \u7F3A\u5931\uFF0C\u964D uncertain`));
            continue;
          }
          anyDim = true;
          let grade = coerceGrade(entry.grade);
          let evidence = typeof entry.evidence === "string" && entry.evidence.trim() ? entry.evidence.trim() : null;
          if (evidence && src && !src.includes(evidence.replace(/…/g, "").slice(0, 12))) {
            evidence = null;
          }
          if (!evidence && grade !== "uncertain") {
            grade = "uncertain";
            issues.push(issue("DOWNGRADED_UNCERTAIN", `\u7EF4\u5EA6 ${dim} \u7F3A evidence\uFF0C\u964D uncertain`));
          }
          if (grade && grade.coerced) {
            grade = grade.coerced;
            issues.push(issue("ENUM_CLEARED", `\u7EF4\u5EA6 ${dim} \u6863\u4F4D\u8D8A\u754C\uFF0C\u964D uncertain`));
          }
          difficulty[dim] = { grade, anchor: typeof entry.anchor === "string" ? entry.anchor : null, evidence };
        }
        if (!anyDim) return { value: null, issues: [issue("EMPTY", "\u8F93\u51FA\u4E0D\u542B\u4EFB\u4F55\u96BE\u5EA6\u7EF4\u5EA6")] };
        let overall = coerceGrade(obj.overallGrade);
        if (overall && overall.coerced) {
          overall = "uncertain";
          issues.push(issue("ENUM_CLEARED", "overallGrade \u6863\u4F4D\u8D8A\u754C\uFF0C\u964D uncertain"));
        }
        const candidates = [];
        for (const c of Array.isArray(obj.kpCandidates) ? obj.kpCandidates : []) {
          const label = typeof c?.label === "string" ? c.label.trim() : "";
          const evidence = typeof c?.evidence === "string" ? c.evidence.trim() : "";
          if (!label) {
            issues.push(issue("ITEM_DROPPED", "KP \u5019\u9009\u7F3A label\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          if (!evidence) {
            issues.push(issue("ITEM_DROPPED", `KP \u5019\u9009\u300C${label}\u300D\u7F3A evidence\uFF0C\u5DF2\u4E22\u5F03`));
            continue;
          }
          let domain = Array.isArray(c.domain) ? c.domain.map((d) => String(d ?? "").trim()).filter((d) => UDC_CODES.includes(d)) : [];
          if (!domain.length) domain = ["other"];
          candidates.push({ label, domain, evidence });
          if (candidates.length >= 10) break;
        }
        const hints = (Array.isArray(obj.prerequisiteGapHints) ? obj.prerequisiteGapHints : []).map((h) => String(h ?? "").trim()).filter(Boolean);
        return {
          value: { difficulty, overallGrade: overall, kpCandidates: candidates, prerequisiteGapHints: hints },
          issues
        };
      }
      function validateKnowledgeProbeOutput(raw, input = {}) {
        const issues = [];
        const obj = parseJsonLoose(raw);
        if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "\u8F93\u51FA\u4E0D\u662F\u53EF\u89E3\u6790\u7684 JSON \u5BF9\u8C61")] };
        const kpIds = new Set((Array.isArray(input.kpIds) ? input.kpIds : []).map((s) => String(s)));
        const fronts = (Array.isArray(input.cardFronts) ? input.cardFronts : []).map((f) => String(f ?? "").replace(/\s+/g, ""));
        const probes = [];
        for (const p of Array.isArray(obj.probes) ? obj.probes : []) {
          if (!PROBE_DIMENSIONS.includes(p?.dimension)) {
            issues.push(issue("ITEM_DROPPED", "\u63A2\u9488 dimension \u8D8A\u754C\uFF08\u5C01\u95ED 5 \u7EF4\uFF09\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          const kpId = String(p?.kpId ?? "");
          if (!kpIds.has(kpId)) {
            issues.push(issue("FABRICATED_ID", `\u63A2\u9488 kpId\u300C${kpId || "\u7A7A"}\u300D\u4E0D\u5728\u8F93\u5165\u6E05\u5355\uFF0C\u5DF2\u4E22\u5F03`));
            continue;
          }
          const evidence = typeof p?.evidence === "string" ? p.evidence.trim() : "";
          if (!evidence) {
            issues.push(issue("ITEM_DROPPED", `\u63A2\u9488\u300C${p?.kpLabel || kpId}\u300D\u7F3A evidence\uFF0C\u5DF2\u4E22\u5F03`));
            continue;
          }
          const question = typeof p?.situationQuestion === "string" ? p.situationQuestion.trim() : "";
          if (!question) {
            issues.push(issue("ITEM_DROPPED", "\u63A2\u9488\u7F3A\u9898\u9762\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          if (fronts.some((f) => f && question.replace(/\s+/g, "").includes(f))) {
            issues.push(issue("DUPLICATE_ORIGINAL", "\u63A2\u9488\u590D\u7528\u4E86\u539F\u5361\u9898\u9762\uFF08\u7981\u539F\u9898\u91CD\u95EE\uFF09\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          const points = (Array.isArray(p?.idealAnswerPoints) ? p.idealAnswerPoints : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 4);
          if (!points.length) {
            issues.push(issue("ITEM_DROPPED", "\u63A2\u9488\u7F3A\u53EF\u5224\u5B9A\u7B54\u6848\u8981\u70B9\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
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
        if (!probes.length && !issues.length) issues.push(issue("EMPTY", "\u8F93\u51FA\u4E0D\u542B\u4EFB\u4F55\u63A2\u9488"));
        return { value: { probes }, issues };
      }
      function validateFrontierExplainOutput(raw, input = {}) {
        const issues = [];
        const obj = parseJsonLoose(raw);
        if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "\u8F93\u51FA\u4E0D\u662F\u53EF\u89E3\u6790\u7684 JSON \u5BF9\u8C61")] };
        const candidateIds = new Set((Array.isArray(input.candidateIds) ? input.candidateIds : []).map((s) => String(s)));
        const structureDriven = new Set((Array.isArray(input.structureDrivenIds) ? input.structureDrivenIds : []).map((s) => String(s)));
        const structureKpIds = new Set((Array.isArray(input.structureKpIds) ? input.structureKpIds : []).map((s) => String(s)));
        const src = String(input.inputText ?? "");
        const explanations = [];
        for (const e of Array.isArray(obj.explanations) ? obj.explanations : []) {
          const candidateId = String(e?.candidateId ?? "");
          if (!candidateIds.has(candidateId)) {
            issues.push(issue("FABRICATED_ID", `\u89E3\u91CA candidateId\u300C${candidateId || "\u7A7A"}\u300D\u4E0D\u5728\u5019\u9009\u6E05\u5355\uFF0C\u5DF2\u4E22\u5F03`));
            continue;
          }
          let reason = typeof e?.reason === "string" ? e.reason.trim() : "";
          let coverage = typeof e?.knowledgeCoverage === "string" ? e.knowledgeCoverage.trim() : "";
          if (reason) {
            const bad = fabricatedNumbers(reason, src);
            if (bad.length) {
              reason = "";
              issues.push(issue("FABRICATED_NUMBER", `reason \u542B\u8F93\u5165\u4E2D\u4E0D\u5B58\u5728\u7684\u6570\u5B57 ${bad.join("/")}\uFF0C\u5DF2\u7F6E\u7A7A`));
            }
          }
          if (coverage) {
            const bad = fabricatedNumbers(coverage, src);
            if (bad.length) {
              coverage = "";
              issues.push(issue("FABRICATED_NUMBER", `knowledgeCoverage \u542B\u8F93\u5165\u4E2D\u4E0D\u5B58\u5728\u7684\u6570\u5B57 ${bad.join("/")}\uFF0C\u5DF2\u7F6E\u7A7A`));
            }
          }
          let challenge = typeof e?.expectedChallenge === "string" ? e.expectedChallenge : null;
          if (!CHALLENGE_GRADES.includes(challenge)) {
            challenge = null;
            issues.push(issue("ENUM_CLEARED", "expectedChallenge \u8D8A\u754C\uFF08\u5C01\u95ED\u56DB\u6863\uFF09\uFF0C\u5DF2\u7F6E\u7A7A"));
          }
          const evidence = typeof e?.evidence === "string" ? e.evidence.trim() : "";
          const uncertainties = (Array.isArray(e?.uncertainties) ? e.uncertainties : []).map((u) => String(u ?? "")).filter(Boolean);
          if (!evidence) {
            uncertainties.push("evidence \u7F3A\u5931\uFF0C\u672C\u6761\u89E3\u91CA\u6309 uncertain \u5904\u7406");
            issues.push(issue("DOWNGRADED_UNCERTAIN", "\u89E3\u91CA\u7F3A evidence\uFF0C\u5DF2\u52A0\u6CE8 uncertain"));
          }
          let structureMapping = null;
          if (structureDriven.has(candidateId)) {
            const slots = [];
            for (const s of Array.isArray(e?.structureMapping) ? e.structureMapping : []) {
              const fromKpId = String(s?.fromKpId ?? "");
              if (!structureKpIds.has(fromKpId)) {
                issues.push(issue("FABRICATED_ID", `\u69FD\u4F4D fromKpId\u300C${fromKpId || "\u7A7A"}\u300D\u4E0D\u5728\u5DF2\u6301\u6709\u7ED3\u6784\u5B50\u56FE\uFF0C\u5DF2\u4E22\u5F03`));
                continue;
              }
              const rel = String(s?.relationType ?? "");
              if (!KP_RELATION_TYPES.includes(rel)) {
                issues.push(issue("ENUM_CLEARED", "\u69FD\u4F4D relationType \u8D8A\u754C\uFF08\u5C01\u95ED 9 \u679A\u4E3E\uFF09\uFF0C\u5DF2\u4E22\u5F03"));
                continue;
              }
              const toLabel = String(s?.toLabel ?? "").trim();
              if (!toLabel) {
                issues.push(issue("ITEM_DROPPED", "\u69FD\u4F4D\u7F3A toLabel\uFF0C\u5DF2\u4E22\u5F03"));
                continue;
              }
              slots.push({ fromKpId, toLabel, relationType: rel });
            }
            if (slots.length) structureMapping = slots;
            else issues.push(issue("MISSING_EVIDENCE", "\u7ED3\u6784\u9A71\u52A8\u5019\u9009\u65E0\u6709\u6548\u69FD\u4F4D\u5BF9\u5E94\uFF08\u65E0\u4F9D\u636E\u4E0D\u5F97\u7F16\u9020\uFF09"));
            const disanalogy = (Array.isArray(e?.disanalogy) ? e.disanalogy : []).map((d) => String(d ?? "").trim()).filter(Boolean);
            if (!disanalogy.length) issues.push(issue("MISSING_DISANALOGY", "\u7ED3\u6784\u9A71\u52A8\u5019\u9009\u7F3A\u4E3B\u8981\u5DEE\u5F02\uFF08disanalogy \u22651 \u6761\uFF09"));
          }
          const nextConcepts = (Array.isArray(e?.nextConcepts) ? e.nextConcepts : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3);
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
        if (!explanations.length && !issues.length) issues.push(issue("EMPTY", "\u8F93\u51FA\u4E0D\u542B\u4EFB\u4F55\u89E3\u91CA"));
        return { value: { explanations }, issues };
      }
      function validateStructureAnalogyOutput(raw, input = {}) {
        const issues = [];
        const obj = parseJsonLoose(raw);
        if (!obj) return { value: null, issues: [issue("JSON_PARSE_FAILED", "\u8F93\u51FA\u4E0D\u662F\u53EF\u89E3\u6790\u7684 JSON \u5BF9\u8C61")] };
        if (obj.result === null) {
          return { value: { result: null, uncertainties: (Array.isArray(obj.uncertainties) ? obj.uncertainties : []).map((u) => String(u ?? "")).filter(Boolean) }, issues };
        }
        const mode = typeof obj.connectionMode === "string" ? obj.connectionMode : null;
        if (!CONNECTION_MODES.includes(mode)) {
          return { value: null, issues: [issue("ENUM_CLEARED", "connectionMode \u8D8A\u754C\uFF08\u5C01\u95ED 3 \u9009\u4E00\uFF09\uFF0C\u6574\u5305\u62D2\u7EDD")] };
        }
        const domainCodes = new Set((Array.isArray(input.domainCodes) ? input.domainCodes : []).map((s) => String(s)));
        const candidateDomain = String(obj.candidateDomain ?? "");
        if (!domainCodes.has(candidateDomain)) {
          return { value: null, issues: [issue("FABRICATED_ID", `candidateDomain\u300C${candidateDomain || "\u7A7A"}\u300D\u4E0D\u5728\u5019\u9009\u9886\u57DF\u6E05\u5355\uFF0C\u6574\u5305\u62D2\u7EDD`)] };
        }
        const ownedKpIds = new Set((Array.isArray(input.ownedKpIds) ? input.ownedKpIds : []).map((s) => String(s)));
        const slots = [];
        for (const s of Array.isArray(obj.slotMapping) ? obj.slotMapping : []) {
          const fromKpId = String(s?.fromKpId ?? "");
          if (!ownedKpIds.has(fromKpId)) {
            issues.push(issue("FABRICATED_ID", `\u69FD\u4F4D fromKpId\u300C${fromKpId || "\u7A7A"}\u300D\u4E0D\u5728\u5DF2\u6301\u6709\u7ED3\u6784\u5B50\u56FE\uFF0C\u5DF2\u4E22\u5F03`));
            continue;
          }
          const rel = String(s?.relationType ?? "");
          if (!KP_RELATION_TYPES.includes(rel)) {
            issues.push(issue("ENUM_CLEARED", "\u69FD\u4F4D relationType \u8D8A\u754C\uFF08\u5C01\u95ED 9 \u679A\u4E3E\uFF09\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          const toLabel = String(s?.toLabel ?? "").trim();
          if (!toLabel) {
            issues.push(issue("ITEM_DROPPED", "\u69FD\u4F4D\u7F3A toLabel\uFF0C\u5DF2\u4E22\u5F03"));
            continue;
          }
          const conf = Number(s?.confidence);
          slots.push({ fromKpId, toLabel, relationType: rel, confidence: Number.isInteger(conf) && conf >= 1 && conf <= 5 ? conf : "uncertain" });
        }
        if (!slots.length) {
          return { value: null, issues: [...issues, issue("EMPTY", "\u65E0\u6709\u6548\u69FD\u4F4D\u5BF9\u5E94\uFF08\u7981\u7F16\u9020\uFF0C\u6574\u5305\u62D2\u7EDD\uFF09")] };
        }
        const evidence = typeof obj.evidence === "string" ? obj.evidence.trim() : "";
        let grade = coerceGrade(obj.similarityGrade);
        if (grade && grade.coerced) {
          grade = "uncertain";
          issues.push(issue("ENUM_CLEARED", "similarityGrade \u6863\u4F4D\u8D8A\u754C\uFF0C\u964D uncertain"));
        }
        if (!evidence && grade !== "uncertain") {
          grade = "uncertain";
          issues.push(issue("DOWNGRADED_UNCERTAIN", "evidence \u7F3A\u5931\uFF0CsimilarityGrade \u964D uncertain"));
        }
        if (typeof grade === "number" && grade <= 2) {
          issues.push(issue("LOW_GRADE_HINT", "\u76F8\u4F3C\u5EA6 \u22642 \u6863\uFF0C\u6D88\u8D39\u65B9\u5E94\u6309\u300C\u7ED3\u6784\u4E0D\u6210\u7ACB\u300D\u5019\u9009\u5904\u7406"));
        }
        const disanalogy = (Array.isArray(obj.disanalogy) ? obj.disanalogy : []).map((d) => String(d ?? "").trim()).filter(Boolean);
        if (!disanalogy.length) issues.push(issue("MISSING_DISANALOGY", "\u7F3A\u4E3B\u8981\u5DEE\u5F02\uFF08disanalogy \u22651 \u6761\uFF09"));
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
      var SCOPE_DISPERSION_FIELDS = {
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
      function scopeDispersion(outputs, fields, threshold = 0.3) {
        const list = (Array.isArray(outputs) ? outputs : []).filter((o) => o != null && typeof o === "object");
        const n = list.length;
        if (n < 2) return { fields: [], maxRate: 0, threshold, over: false };
        const perField = (Array.isArray(fields) ? fields : []).map((field) => {
          const vals = getByPath(list, field).map((v) => v === void 0 || v === null ? "\u2205" : String(v));
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
        scopeDispersion
      };
    }
  });
  return require_kpScopes();
})();
