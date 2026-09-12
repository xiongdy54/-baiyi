"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/cards.ts
var cards_exports = {};
__export(cards_exports, {
  MATERIAL_ROUTES: () => MATERIAL_ROUTES,
  cardGenerator: () => cardGenerator,
  cardsApi: () => cardsApi,
  detectMaterialType: () => detectMaterialType,
  detectMode: () => detectMode,
  extractClozeAnswer: () => extractClozeAnswer,
  extractJson: () => extractJson,
  lintCard: () => lintCard,
  parseCloze: () => parseCloze,
  parseFollowUps: () => parseFollowUps,
  similaritySearch: () => similaritySearch
});
module.exports = __toCommonJS(cards_exports);

// src/lib/ai.ts
var aiGateway = {
  async getConfig() {
    if (!window.aiAPI) return null;
    return window.aiAPI.getConfig();
  },
  async setConfig(partial) {
    await window.aiAPI?.setConfig(partial);
  },
  async test() {
    if (!window.aiAPI) return { ok: false, message: "API \u4E0D\u53EF\u7528" };
    return window.aiAPI.test();
  },
  async listModels() {
    if (!window.aiAPI) return [];
    return window.aiAPI.listModels();
  },
  async websearch(query) {
    if (!window.aiAPI) return [];
    return window.aiAPI.websearch(query);
  },
  // 流式对话：onDelta 累积增量；onThinking 上报思考模型（reasoning_content）的已思考字数；resolve 返回全文
  chat(messages, onDelta, temperature, onThinking) {
    return new Promise((resolve, reject) => {
      if (!window.aiAPI) {
        reject(new Error("AI API \u4E0D\u53EF\u7528"));
        return;
      }
      const requestId = Math.random().toString(36).slice(2);
      let acc = "";
      let finished = false;
      const off = window.aiAPI.onStream((rid, msg) => {
        if (rid !== requestId) return;
        if (msg.error) {
          if (!finished) {
            finished = true;
            off();
            reject(new Error(msg.error));
          }
          return;
        }
        if (msg.thinking !== void 0) {
          onThinking?.(msg.thinking);
        }
        if (msg.delta) {
          acc += msg.delta;
          onDelta?.(acc, msg.delta);
        }
        if (msg.done && !finished) {
          finished = true;
          off();
          resolve(acc);
        }
      });
      window.aiAPI.chat(requestId, messages, temperature);
    });
  }
};

// src/lib/occlusion.ts
var clampPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};
var round1 = (v) => Math.round(v * 10) / 10;
function shapeBBox(shape) {
  if (shape.kind === "ellipse") {
    const cx = clampPct(shape.cx);
    const cy = clampPct(shape.cy);
    const rx = Math.max(0, Number(shape.rx) || 0);
    const ry = Math.max(0, Number(shape.ry) || 0);
    const x2 = Math.max(0, cx - rx);
    const y2 = Math.max(0, cy - ry);
    return {
      x: round1(x2),
      y: round1(y2),
      w: round1(Math.min(100 - x2, rx * 2)),
      h: round1(Math.min(100 - y2, ry * 2))
    };
  }
  if (shape.kind === "polygon") {
    const pts = shape.points ?? [];
    if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = pts.map((p) => clampPct(p.x));
    const ys = pts.map((p) => clampPct(p.y));
    const x2 = Math.min(...xs);
    const y2 = Math.min(...ys);
    return { x: round1(x2), y: round1(y2), w: round1(Math.max(...xs) - x2), h: round1(Math.max(...ys) - y2) };
  }
  const x = clampPct(shape.x);
  const y = clampPct(shape.y);
  return {
    x: round1(x),
    y: round1(y),
    w: round1(Math.max(0, Math.min(100 - x, Number(shape.w) || 0))),
    h: round1(Math.max(0, Math.min(100 - y, Number(shape.h) || 0)))
  };
}
function normalizeShape(shape) {
  if (shape.kind === "polygon") {
    return {
      ord: shape.ord,
      kind: "polygon",
      points: (shape.points ?? []).map((p) => ({ x: round1(clampPct(p.x)), y: round1(clampPct(p.y)) }))
    };
  }
  if (shape.kind === "ellipse") {
    const cx = clampPct(shape.cx);
    const cy = clampPct(shape.cy);
    return {
      ord: shape.ord,
      kind: "ellipse",
      cx: round1(cx),
      cy: round1(cy),
      rx: round1(Math.max(0, Math.min(Math.max(cx, 100 - cx), Number(shape.rx) || 0))),
      ry: round1(Math.max(0, Math.min(Math.max(cy, 100 - cy), Number(shape.ry) || 0)))
    };
  }
  return { ord: shape.ord, kind: "rect", ...shapeBBox(shape) };
}
function shapesFromRects(rects) {
  return (rects ?? []).map((raw, i) => {
    const r = raw ?? {};
    const ord = Number(r.ord);
    return normalizeShape({
      ord: Number.isFinite(ord) ? ord : i,
      kind: "rect",
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      w: Number(r.w) || 0,
      h: Number(r.h) || 0
    });
  });
}
function occlusionShapes(occlusion) {
  if (!occlusion) return [];
  const shapes = (occlusion.shapes ?? []).filter((s) => Boolean(s && s.kind));
  if (shapes.length > 0) return shapes;
  return shapesFromRects(occlusion.rects ?? []);
}

// src/lib/cards.ts
function parseCloze(text) {
  const re = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;
  const ords = /* @__PURE__ */ new Set();
  let m;
  while (m = re.exec(text)) ords.add(Number(m[1]));
  return {
    ords: [...ords].sort((a, b) => a - b),
    render(hiddenOrd) {
      return text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_s, ordStr, content, hint) => {
        const ord = Number(ordStr);
        if (hiddenOrd !== null && ord === hiddenOrd) return "[\u2026]";
        return content;
      });
    }
  };
}
function extractClozeAnswer(text, ord) {
  const re = new RegExp(`\\{\\{c${ord}::(.*?)(?:::(.*?))?\\}\\}`);
  const m = re.exec(text);
  return m ? (m[1] ?? "") + (m[2] ? `\uFF08${m[2]}\uFF09` : "") : "";
}
var MATERIAL_ROUTES = {
  concept: { materialType: "concept", scope: "card-generation", label: "\u6982\u5FF5\u8BBA\u8FF0", defaultForm: "\u95EE\u7B54" },
  formula: { materialType: "formula", scope: "card-formula", label: "\u516C\u5F0F\u63A8\u5BFC", defaultForm: "\u95EE\u7B54" },
  sequence: { materialType: "sequence", scope: "card-seq", label: "\u6D41\u7A0B\u80CC\u8BF5", defaultForm: "\u95EE\u7B54" },
  enumeration: { materialType: "enumeration", scope: "card-enum", label: "\u679A\u4E3E\u6E05\u5355", defaultForm: "\u6316\u7A7A" },
  image: { materialType: "image", scope: "card-occlusion", label: "\u56FE\u7247\u6750\u6599", defaultForm: "\u56FE\u7247\u6316\u7A7A" },
  literature: { materialType: "literature", scope: "card-literature", label: "\u6587\u5B66/\u8BD7\u6B4C\u80CC\u8BF5", defaultForm: "\u95EE\u7B54" }
};
function detectMode(text) {
  if (/[=\\]|\d\s*[+\-*/^]\s*\d|\$\\?/.test(text) && /(公式|方程|=\s*\S|\\frac|\\sum)/.test(text)) return "card-formula";
  if (/(步骤|流程|时间线|顺序|第一章.*第二章|首先.*然后.*最后)/.test(text)) return "card-seq";
  if (/(列出|有哪些|分别|包括以下|：[^\n]*、[^\n]*、)/.test(text)) return "card-enum";
  return "card-generation";
}
function verseSignals(text) {
  const t = text.trim();
  if (t.length < 20) return false;
  if (/(第[一二三四五六七八九十\d]+\s*步|步骤\s*\d)/.test(t)) return false;
  const strongInHead = /(词牌|宋词|唐诗|五言|七言|律诗|绝句|上阕|下阕|上片|下片|词曰|诗曰)/.test(t.slice(0, 30));
  const strong = strongInHead || /(词牌|宋词|唐诗|五言|七言|律诗|绝句|上阕|下阕|上片|下片|词曰|诗曰)/.test(t.slice(0, 200));
  const ciTitle = /《[^《》\n]{1,8}·[^《》\n]{1,12}》/.test(t.slice(0, 40));
  const titled = /《[^《》\n]{1,12}》/.test(t.slice(0, 30)) || ciTitle;
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const punctEndRate = lines.length ? lines.filter((l) => /[，。！？；：、]$/.test(l)).length / lines.length : 0;
  if (strongInHead || ciTitle) {
    if (lines.length >= 2 && lines.every((l) => l.length <= 34)) return true;
  }
  if (lines.length >= 4) {
    const stripped = lines.map((l) => l.replace(/[\s，。！？、；：…—·""''?!]/g, ""));
    const uniform = stripped.every((s) => s.length === 5) || stripped.every((s) => s.length === 7);
    if (uniform && punctEndRate >= 0.5) return true;
  }
  if (lines.length >= (strong || titled ? 4 : 6)) {
    const short = lines.filter(
      (l) => l.length <= 20 && !/^\d+[.、)）]\s*/.test(l) && !/^[•●■▪○◆]\s*/.test(l)
    ).length;
    if (short / lines.length >= 0.8 && punctEndRate >= 0.4) return true;
  }
  if (strong || titled) {
    const body = t.replace(/《[^《》]*》/g, "");
    const sentences = body.split(/[。！？]/).map((s) => s.trim()).filter(Boolean);
    const avg = sentences.length ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length : 99;
    if (sentences.length >= 8 && avg <= 14) return true;
  }
  return false;
}
function detectMaterialType(text) {
  if (verseSignals(text)) return MATERIAL_ROUTES.literature;
  const mode = detectMode(text);
  const byMode = {
    "card-formula": "formula",
    "card-seq": "sequence",
    "card-enum": "enumeration",
    "card-generation": "concept"
  };
  return MATERIAL_ROUTES[byMode[mode] ?? "concept"];
}
function parseFollowUps(summaries) {
  const out = [];
  for (const raw of Array.isArray(summaries) ? summaries : []) {
    const s = String(raw?.summary ?? raw ?? "");
    const m = s.match(/[（(]后续可补[:：]([^）)]*)[）)]/);
    if (!m || !m[1].trim()) continue;
    const items = m[1].split(/[、，,;；]/).map((x) => x.trim()).filter(Boolean);
    if (items.length === 0) continue;
    out.push({ kpTitle: s.replace(/[（(]后续可补[:：][^）)]*[）)]/g, "").trim(), items });
  }
  return out;
}
function extractJson(raw) {
  const text = String(raw ?? "");
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
  let lastErr = null;
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (!Array.isArray(parsed.cards)) throw new Error("AI \u8FD4\u56DE\u7F3A\u5C11 cards \u6570\u7EC4");
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `AI \u672A\u8FD4\u56DE\u6709\u6548 JSON\uFF1A${lastErr instanceof Error ? lastErr.message : "\u672A\u627E\u5230 JSON \u5BF9\u8C61"}`
  );
}
var cardGenerator = {
  async generateCards(sourceText, context, mode, onProgress, onThinking) {
    const resolved = mode === "auto" ? detectMode(sourceText) : mode;
    const tpl = await window.promptsAPI?.get(resolved);
    if (!tpl) throw new Error("\u63D0\u793A\u8BCD\u6A21\u677F\u7F3A\u5931");
    const sys = tpl.content;
    const user = [
      `\u3010\u6750\u6599\u3011
${sourceText}`,
      context.title ? `\u3010\u6765\u6E90\u3011\u300A${context.title}\u300B${context.section ? " \xB7 " + context.section : ""}` : "",
      // v16：补充制卡指令（「后续可补」递进补卡用）——提示词模板不变，仅装配请求时注入
      context.focus ? `\u3010\u672C\u6B21\u5236\u5361\u91CD\u70B9\uFF08\u8865\u5145\u5236\u5361\uFF09\u3011
${context.focus}` : "",
      context.webContext ? `\u3010\u8054\u7F51\u68C0\u7D22\u5230\u7684\u4E8B\u4EF6\u80CC\u666F\uFF08\u4EC5\u4F9B\u7406\u89E3\uFF0C\u7981\u6B62\u7F16\u9020\u6765\u6E90\uFF09\u3011
${context.webContext}` : "",
      context.existingCards?.length ? `\u3010\u7528\u6237\u5DF2\u6709\u5361\u7247\uFF08\u6CE8\u610F R10 \u8054\u60F3\u4E0E\u5E72\u6270\u63D0\u793A\uFF0C\u7981\u6B62\u91CD\u590D\u6216\u6362\u76AE\uFF09\u3011
${context.existingCards.slice(0, 10).join("\n")}` : "",
      context.userProfile ? `\u3010\u7528\u6237\u753B\u50CF\uFF08R9 \u4E2A\u6027\u5316\u4F8B\u5B50\u4F18\u5148\u7528\uFF09\u3011
${context.userProfile}` : ""
    ].filter(Boolean).join("\n\n");
    let acc = "";
    const raw = await aiGateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      onProgress ? (a) => {
        acc = a;
        onProgress(a.length);
      } : void 0,
      0.4,
      onThinking
    );
    const result = extractJson(raw || acc);
    const batch = await window.batchesAPI?.create({
      scope: resolved,
      sourceText,
      context: {
        ...context,
        // 诊断留痕：确认联网背景是否真的进入了上下文
        webContextChars: context.webContext ? context.webContext.length : 0,
        webContextPreview: context.webContext ? context.webContext.slice(0, 200) : ""
      },
      promptTemplateId: tpl.id,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tpl.id };
  },
  // M1.1（v15，D16）：图片挖空生成链路——图片已入库，把 dataURL 交 GLM 多模态识别遮挡区域，
  // 返回 regions（归一化百分比坐标）+ 每区域一张 imageOcclusion 草稿（rects 共享同一 occlusionJson）
  async generateOcclusionCards(image, context, onProgress, onThinking) {
    const tpl = await window.promptsAPI?.get("card-occlusion");
    if (!tpl) throw new Error("\u63D0\u793A\u8BCD\u6A21\u677F\u7F3A\u5931\uFF08card-occlusion\uFF09");
    const textParts = [
      "\u3010\u4EFB\u52A1\u3011\u8BC6\u522B\u56FE\u7247\u4E2D\u9002\u5408\u8BB0\u5FC6\u6D4B\u8BD5\u7684\u5185\u5BB9\u5E76\u7ED9\u51FA\u906E\u6321\u533A\u57DF\uFF08\u5750\u6807\u4E3A\u76F8\u5BF9\u56FE\u7247\u5C3A\u5BF8\u7684\u767E\u5206\u6BD4\uFF09\u3002",
      // v25：用户已手绘区域的场景——图片是用户选区的裁剪，模型只负责读出该区域内容；
      // 指令经请求装配注入（与 generateCards 的 context.focus 同机制），提示词模板不变
      context.focus ? `\u3010\u7528\u6237\u5DF2\u9009\u5B9A\u7684\u906E\u6321\u533A\u57DF\u3011${context.focus}` : "",
      context.title ? `\u3010\u6765\u6E90\u3011\u300A${context.title}\u300B${context.section ? " \xB7 " + context.section : ""}` : ""
    ].filter(Boolean);
    const userContent = [
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "text", text: textParts.join("\n") }
    ];
    let acc = "";
    const raw = await aiGateway.chat(
      [
        { role: "system", content: tpl.content },
        { role: "user", content: userContent }
      ],
      onProgress ? (a) => {
        acc = a;
        onProgress(a.length);
      } : void 0,
      0.2,
      onThinking
    );
    const result = extractJson(raw || acc);
    const preset = context.presetRegion;
    if (preset) {
      const rect = {
        x: clampPct(preset.rect.x),
        y: clampPct(preset.rect.y),
        w: Math.max(1, Math.min(100 - clampPct(preset.rect.x), clampPct(preset.rect.w))),
        h: Math.max(1, Math.min(100 - clampPct(preset.rect.y), clampPct(preset.rect.h)))
      };
      const shape = preset.shape ? normalizeShape({ ...preset.shape, ord: 0 }) : null;
      const rects2 = [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, ord: 0 }];
      const cards = (result.cards ?? []).slice(0, 1);
      if (cards.length === 0) throw new Error("\u6A21\u578B\u672A\u4EA7\u51FA\u5361\u7247\uFF0C\u8BF7\u91CD\u8BD5\u6216\u6539\u7528\u624B\u52A8\u5236\u5361");
      for (const card of cards) {
        card.cardType = "imageOcclusion";
        card.ord = 0;
        card.occlusion = {
          assetPath: image.assetPath,
          ord: 0,
          rects: rects2,
          shapes: shape ? [shape] : null,
          label: String(card.back ?? preset.label ?? "")
        };
      }
      result.cards = cards;
      result.regions = [
        { ord: 0, label: String(cards[0].back ?? preset.label ?? ""), ...rect, shape: shape ?? void 0 }
      ];
      const batch0 = await window.batchesAPI?.create({
        scope: "card-occlusion",
        sourceText: `[\u56FE\u7247\u9009\u533A] ${image.assetPath}`,
        context: { ...context, imageAsset: image.assetPath, userRegion: true },
        promptTemplateId: tpl.id,
        result
      });
      return { batchId: batch0?.id || "", result, templateId: tpl.id };
    }
    const regions = (result.regions ?? []).map((r, i) => {
      const x = clampPct(r.x);
      const y = clampPct(r.y);
      const w = Math.max(1, Math.min(100 - x, clampPct(r.w)));
      const h = Math.max(1, Math.min(100 - y, clampPct(r.h)));
      return {
        ord: Number.isFinite(Number(r.ord)) ? Math.max(0, Math.round(Number(r.ord))) : i,
        label: String(r.label ?? ""),
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        w: Math.round(w * 10) / 10,
        h: Math.round(h * 10) / 10
      };
    });
    if (result.cards?.length && regions.length === 0) {
      throw new Error("\u6A21\u578B\u672A\u8FD4\u56DE\u906E\u6321\u533A\u57DF\uFF08regions \u4E3A\u7A7A\uFF09\uFF0C\u8BF7\u6362\u4E00\u5F20\u66F4\u6E05\u6670\u7684\u56FE\u7247\u91CD\u8BD5");
    }
    const rects = regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, ord: r.ord }));
    for (const card of result.cards) {
      if (card.cardType === "imageOcclusion") {
        const region = regions.find((r) => r.ord === card.ord);
        card.occlusion = { assetPath: image.assetPath, ord: card.ord ?? 0, rects, label: region?.label };
      }
    }
    const batch = await window.batchesAPI?.create({
      scope: "card-occlusion",
      sourceText: `[\u56FE\u7247] ${image.assetPath}`,
      context: { ...context, imageAsset: image.assetPath, regionCount: regions.length },
      promptTemplateId: tpl.id,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tpl.id };
  },
  async explain(sourceText, context, question, onDelta, onThinking) {
    const tpl = await window.promptsAPI?.get("reader-explain");
    const sys = tpl?.content || "\u4F60\u662F\u9605\u8BFB\u52A9\u624B\u3002";
    const user = `\u3010\u9009\u4E2D\u6587\u672C\u3011
${sourceText}

${context ? `\u3010\u4E0A\u4E0B\u6587\u3011${context}` : ""}

${question ? `\u3010\u7528\u6237\u8FFD\u95EE\u3011${question}` : "\u8BF7\u89E3\u91CA\u8FD9\u6BB5\u6587\u5B57\u3002"}`;
    return aiGateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      onDelta,
      0.7,
      onThinking
    );
  }
};
var CHANGEABLE = /(统计|版本|价格|政策|截至|目前|当前|最新)/;
function lintCard(draft) {
  const issues = [];
  const front = draft.front || "";
  const back = draft.back || "";
  const cloze = draft.cloze || "";
  if (draft.cardType === "imageOcclusion" && !(draft.occlusion && occlusionShapes(draft.occlusion).length > 0 && draft.occlusion.assetPath)) {
    issues.push({ ruleId: "L11", severity: "error", message: "\u56FE\u50CF\u906E\u6321\u5361\u7F3A\u5C11\u56FE\u50CF\u8D44\u4EA7\u6216\u906E\u6321\u533A\u57DF" });
  }
  if (back.replace(/\s/g, "").length > 60) {
    issues.push({ ruleId: "L1", severity: "warn", message: "back \u4FE1\u606F\u8FC7\u8F7D\uFF08>60\u5B57\uFF09\uFF0C\u8003\u8651\u62C6\u5206\uFF08\u89C4\u52194 \u6700\u5C0F\u4FE1\u606F\uFF09" });
  }
  if (/^(是|否|对|错|正确|错误|true|false)\.?$/i.test(back.trim())) {
    issues.push({ ruleId: "L2", severity: "warn", message: "\u662F\u5426\u9898\uFF08\u89C4\u5219\uFF1A\u907F\u514D\u5224\u65AD\u9898\uFF09" });
  }
  if (/(有哪些|列举|分别列出)/.test(front)) {
    issues.push({ ruleId: "L3", severity: "warn", message: "\u96C6\u5408\u578B\u95EE\u6CD5\uFF08\u89C4\u52199 \u907F\u514D\u96C6\u5408\uFF09" });
  }
  if (cloze) {
    const holes = cloze.match(/\{\{c\d+::/g);
    if (holes && holes.length > 2) {
      issues.push({ ruleId: "L9", severity: "warn", message: "\u5355\u5361\u6316\u7A7A >2 \u5904\uFF08\u89C4\u52194/5\uFF09" });
    }
  }
  if (!draft.contextPrefix) {
    issues.push({ ruleId: "L5", severity: "info", message: "\u7F3A contextPrefix \u4E0A\u4E0B\u6587\u524D\u7F00\uFF08\u89C4\u521916\uFF09" });
  }
  if (!draft.sourceRef) {
    issues.push({ ruleId: "L6", severity: "info", message: "\u7F3A\u6765\u6E90 sourceRef\uFF08\u89C4\u521918\uFF09" });
  }
  if (front.length > 80) {
    issues.push({ ruleId: "L10", severity: "warn", message: "front \u8FC7\u957F\uFF08>80\u5B57\uFF09\uFF0C\u6A21\u5F0F\u5339\u914D\u98CE\u9669\uFF08\u89C4\u521912\uFF09" });
  }
  if (draft.knowledgePointId && draft.clusterSize === 1) {
    issues.push({ ruleId: "L8", severity: "info", message: "\u5B64\u513F\u5361\uFF08\u8BE5\u77E5\u8BC6\u70B9\u4E0B\u4EC5\u6B64\u4E00\u5F20\uFF09" });
  }
  if (!draft.dateStamp && CHANGEABLE.test(front + back)) {
    issues.push({ ruleId: "L12", severity: "info", message: "\u6613\u53D8\u5185\u5BB9\u5EFA\u8BAE\u52A0 dateStamp\uFF08\u89C4\u521919\uFF09" });
  }
  const frontClean = front.replace(/\s/g, "");
  const backClean = back.replace(/\s/g, "");
  const prefix = (draft.contextPrefix || "").replace(/[:：\s]/g, "");
  if (prefix && prefix.length >= 2) {
    if (backClean.includes(prefix) || frontClean.replace(prefix, "").includes(prefix)) {
      issues.push({
        ruleId: "L13",
        severity: "warn",
        message: "\u524D\u7F00\u6CC4\u9898\uFF1A\u524D\u7F00\u4E0E\u7B54\u6848/\u95EE\u9898\u5185\u5BB9\u91CD\u590D\uFF0C\u4F1A\u76F4\u63A5\u63D0\u793A\u7B54\u6848\uFF08\u89C4\u521916\uFF09"
      });
    }
  }
  const text = frontClean + backClean;
  if (/[\u4e00-\u9fa5]{1}(?=(说|指出|认为|主张|提出|批评|表示|写道|在《))/.test(text) && !/[•·]|\(|（/.test(text.slice(0, 30))) {
    issues.push({
      ruleId: "L14",
      severity: "warn",
      message: "\u7591\u4F3C\u4EBA\u540D\u7F29\u7565\uFF08R16\uFF09\uFF1A\u8BF7\u786E\u8BA4\u4F7F\u7528\u5B8C\u6574\u5168\u540D\uFF08\u5982\u300C\u8FC8\u514B\u5C14\xB7\u6768\u300D\u800C\u975E\u300C\u6768\u300D\uFF09"
    });
  }
  return issues;
}
var similaritySearch = {
  async findSimilar(cardText, k = 3) {
    return await window.similarityAPI?.find(cardText, k) ?? [];
  }
};
var cardsApi = {
  create: async (card) => await window.cardsAPI?.create(card) ?? { id: "" },
  update: async (card) => await window.cardsAPI?.update(card) ?? false,
  get: async (id) => await window.cardsAPI?.get(id) ?? null,
  listDue: async () => await window.cardsAPI?.listDue() ?? [],
  listAll: async () => await window.cardsAPI?.listAll() ?? [],
  remove: async (id) => await window.cardsAPI?.remove(id) ?? false,
  // v22 撤销评分：review 传 fsrsBefore（评分前 FSRS 快照）方可撤销
  review: async (cardId, fsrsState, rating, durationMs, fsrsBefore) => {
    await window.cardsAPI?.review(cardId, fsrsState, rating, durationMs, fsrsBefore);
  },
  lastUndoableReview: async () => await window.cardsAPI?.lastUndoableReview(),
  undoReview: async () => await window.cardsAPI?.undoReview(),
  // v23（§4.4.9）：persist 失败后的纯持久化重试（只重试持久化，绝不重执行业务 mutation）
  persistNow: async () => await window.cardsAPI?.persistNow() ?? false,
  skip: async (cardId) => {
    await window.cardsAPI?.skip(cardId);
  },
  setSuspended: async (id, suspended, reason) => await window.cardsAPI?.setSuspended(id, suspended, reason) ?? false,
  updateLeech: async (id, patch) => await window.cardsAPI?.updateLeech(id, patch) ?? false,
  resolveLeech: async (id, resolution, updates) => await window.cardsAPI?.resolveLeech(id, resolution, updates) ?? false,
  listLeech: async () => await window.cardsAPI?.listLeech() ?? [],
  addIssue: async (issue) => await window.issuesAPI?.add(issue) ?? { id: "" },
  listIssues: async (cardId) => await window.issuesAPI?.list(cardId) ?? [],
  resolveIssue: async (id) => await window.issuesAPI?.resolve(id) ?? false,
  setBatchStatus: async (id, status) => {
    await window.batchesAPI?.setStatus(id, status);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MATERIAL_ROUTES,
  cardGenerator,
  cardsApi,
  detectMaterialType,
  detectMode,
  extractClozeAnswer,
  extractJson,
  lintCard,
  parseCloze,
  parseFollowUps,
  similaritySearch
});
