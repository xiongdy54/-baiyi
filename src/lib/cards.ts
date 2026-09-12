// CardGeneratorProvider（文档§3.17）+ Cloze 解析 + CardLintEngine（§3.18/§8.4）
import { aiGateway } from "./ai";
import { clampPct, normalizeShape, occlusionShapes, type OcclusionShape } from "./occlusion";

declare global {
  interface Window {
    promptsAPI?: { get: (scope: string) => Promise<{ id: string; content: string } | null>; list: () => Promise<unknown[]> };
    cardsAPI?: {
      create: (card: unknown) => Promise<{ id: string }>;
      update: (card: unknown) => Promise<boolean>;
      get: (id: string) => Promise<unknown>;
      listDue: () => Promise<unknown[]>;
      listAll: () => Promise<unknown[]>;
      remove: (id: string) => Promise<boolean>;
      review: (cardId: string, fsrsState: unknown, rating: string, durationMs?: number, fsrsBefore?: unknown) => Promise<boolean>;
      lastUndoableReview: () => Promise<unknown>;
      undoReview: () => Promise<unknown>;
      persistNow: () => Promise<boolean>;
      skip: (cardId: string) => Promise<boolean>;
      setSuspended: (id: string, suspended: boolean, reason?: string) => Promise<boolean>;
      updateLeech: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
      resolveLeech: (id: string, resolution: string, updates?: unknown) => Promise<boolean>;
      listLeech: () => Promise<unknown[]>;
    };
    issuesAPI?: {
      add: (issue: unknown) => Promise<{ id: string }>;
      list: (cardId: string) => Promise<unknown[]>;
      resolve: (id: string) => Promise<boolean>;
    };
    batchesAPI?: {
      create: (batch: unknown) => Promise<{ id: string }>;
      setStatus: (id: string, status: string) => Promise<boolean>;
    };
    assetsAPI?: {
      pickOcclusionImage: (ownerKey: string) => Promise<{ itemId: string; filename: string; assetPath: string; dataUrl: string } | null>;
      /** v25：把渲染层已拿到的图片字节（如正文图片/选区裁剪）落盘入 assets 表 */
      saveImage: (
        ownerKey: string,
        ext: string,
        base64: string,
        kind?: string
      ) => Promise<{ itemId: string; filename: string; assetPath: string } | null>;
    };
    similarityAPI?: { find: (text: string, k?: number) => Promise<{ cardId: string; score: number; front: string }[]> };
  }
}

// ---------- Cloze：Anki 语法解析 ----------
export interface ClozeParse {
  ords: number[];
  render: (hiddenOrd: number | null) => string;
}

export function parseCloze(text: string): ClozeParse {
  const re = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g;
  const ords = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ords.add(Number(m[1]));
  return {
    ords: [...ords].sort((a, b) => a - b),
    render(hiddenOrd: number | null) {
      return text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_s, ordStr, content, hint) => {
        const ord = Number(ordStr);
        // 正面一律完全遮蔽 […...]：hint 不上正面（hint 曾泄漏半个答案，用户反馈 #3）
        if (hiddenOrd !== null && ord === hiddenOrd) return "[…]";
        return content;
      });
    }
  };
}

export function extractClozeAnswer(text: string, ord: number): string {
  // 注意：ord 内联进正则后没有 (\d+) 组——m[1]=content、m[2]=hint（与 parseCloze 的
  // replace 回调组序不同，后者多一个 (\d+) 组；v15 前错按 replace 组序取 m[2]/m[3]，
  // 导致无 hint 的 v3 卡背面恒为空串，违反「答案区只含挖空内容」契约）
  const re = new RegExp(`\\{\\{c${ord}::(.*?)(?:::(.*?))?\\}\\}`);
  const m = re.exec(text);
  // 背面 = 完整答案 content；若制卡时误将答案后半写进 hint，拼回完整（避免答案被拆两半）
  return m ? (m[1] ?? "") + (m[2] ? `（${m[2]}）` : "") : "";
}

// ---------- CardGeneratorProvider ----------
export interface OcclusionRegion {
  ord: number;
  label: string;
  x: number; // 相对图片宽度的百分比 0-100
  y: number;
  w: number;
  h: number;
  /** v25：用户手绘形状（矩形/椭圆/多边形）；AI 识别的区域无此字段（等价矩形） */
  shape?: OcclusionShape;
}

export interface CardDraft {
  cardType: string;
  knowledgePointId?: string;
  contextPrefix?: string;
  domain?: string[];
  front: string;
  back: string;
  cloze?: string | null;
  example?: string | null;
  mnemonic?: string | null;
  // M1.1 图片挖空卡：图片遮挡区域（随 draft 带给确认面板，接受时落 occlusionJson）
  ord?: number;
  occlusion?: { assetPath: string; ord: number; rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: OcclusionShape[] | null; label?: string } | null;
  sourceRef?: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp?: string | null;
  prioritySuggestion?: number;
  ruleNotes?: string[];
  warnings?: string[];
}

export interface GenResult {
  knowledgePoints: { id: string; summary: string }[];
  blockReasons: string[];
  cards: CardDraft[];
  regions?: OcclusionRegion[];
}

export type CardGenMode = "auto" | "card-generation" | "card-formula" | "card-seq" | "card-enum" | "card-literature" | "card-mnemonic" | "card-contrast" | "card-wording" | "card-basic" | "card-occlusion";

// ---------- 材料类型路由（M1.2，本地规则先行） ----------
// 类型→原则→提示词→默认形式映射（§6.3.10；映射表待用户确认后写入文档）：
//   concept 概念论述  → card-generation → 问答（可在确认区转翻转问答）
//   formula 公式推导  → card-formula   → 问答（LaTeX）
//   sequence 流程背诵 → card-seq       → 问答（seq 续写）
//   enumeration 枚举  → card-enum      → 挖空
//   image   图片材料  → card-occlusion → 图片挖空（独立链路 generateOcclusionCards）
export type MaterialType = "concept" | "formula" | "sequence" | "enumeration" | "image" | "literature";

export interface MaterialRoute {
  materialType: MaterialType;
  scope: CardGenMode;
  label: string;
  defaultForm: string;
}

export const MATERIAL_ROUTES: Record<MaterialType, MaterialRoute> = {
  concept: { materialType: "concept", scope: "card-generation", label: "概念论述", defaultForm: "问答" },
  formula: { materialType: "formula", scope: "card-formula", label: "公式推导", defaultForm: "问答" },
  sequence: { materialType: "sequence", scope: "card-seq", label: "流程背诵", defaultForm: "问答" },
  enumeration: { materialType: "enumeration", scope: "card-enum", label: "枚举清单", defaultForm: "挖空" },
  image: { materialType: "image", scope: "card-occlusion", label: "图片材料", defaultForm: "图片挖空" },
  literature: { materialType: "literature", scope: "card-literature", label: "文学/诗歌背诵", defaultForm: "问答" }
};

// 模式自动路由（§8.2.3）：在 detectMode 基础上给出材料类型语义（既有正则保持一致）
export function detectMode(text: string): CardGenMode {
  if (/[=\\]|\d\s*[+\-*/^]\s*\d|\$\\?/.test(text) && /(公式|方程|=\s*\S|\\frac|\\sum)/.test(text)) return "card-formula";
  if (/(步骤|流程|时间线|顺序|第一章.*第二章|首先.*然后.*最后)/.test(text)) return "card-seq";
  if (/(列出|有哪些|分别|包括以下|：[^\n]*、[^\n]*、)/.test(text)) return "card-enum";
  return "card-generation";
}

// 诗词版式信号（v16-b/c 扩展）：纯本地启发式，宁缺毋滥——不确定时落到 concept，
// 由 UI 的手动覆盖兜底（识别机制研究与改进结论见 docs/M1-prompt-coverage-report.md §4.4）。
// 识别是确定性函数：同一份文本必然同一结果；对粘贴格式（分行/整段/有无标题）的鲁棒性靠多路径覆盖。
function verseSignals(text: string): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  // 流程类材料排除（步骤编号与诗行形态可能重叠）
  if (/(第[一二三四五六七八九十\d]+\s*步|步骤\s*\d)/.test(t)) return false;
  const strongInHead = /(词牌|宋词|唐诗|五言|七言|律诗|绝句|上阕|下阕|上片|下片|词曰|诗曰)/.test(t.slice(0, 30));
  const strong = strongInHead || /(词牌|宋词|唐诗|五言|七言|律诗|绝句|上阕|下阕|上片|下片|词曰|诗曰)/.test(t.slice(0, 200));
  const ciTitle = /《[^《》\n]{1,8}·[^《》\n]{1,12}》/.test(t.slice(0, 40)); // 如《雨霖铃·寒蝉凄切》
  const titled = /《[^《》\n]{1,12}》/.test(t.slice(0, 30)) || ciTitle;
  const lines = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const punctEndRate = lines.length
    ? lines.filter((l) => /[，。！？；：、]$/.test(l)).length / lines.length
    : 0;
  // ⓪ 标记兜底（v16-c 加固）：标题区有词牌/诗体标识词或《词牌·题》式标题时，
  // 多行形态（各行 ≤34 字，覆盖上下阕长行）即判诗词——词的分行粘贴行长不一，不苛求短行比例
  if (strongInHead || ciTitle) {
    if (lines.length >= 2 && lines.every((l) => l.length <= 34)) return true;
  }
  // ① 近体诗（唐诗/律诗/绝句）：≥4 行，去标点后统一 5 或 7 字，过半行带句读
  if (lines.length >= 4) {
    const stripped = lines.map((l) => l.replace(/[\s，。！？、；：…—·""''?!]/g, ""));
    const uniform = stripped.every((s) => s.length === 5) || stripped.every((s) => s.length === 7);
    if (uniform && punctEndRate >= 0.5) return true;
  }
  // ② 诗行密度（现代自由诗/词分行粘贴）：≥4 行（无标题/诗体标识时 ≥6 行），
  //    八成行为 ≤20 字的非列表行，且过半行带句读（排除无标点清单）
  if (lines.length >= (strong || titled ? 4 : 6)) {
    const short = lines.filter(
      (l) => l.length <= 20 && !/^\d+[.、)）]\s*/.test(l) && !/^[•●■▪○◆]\s*/.test(l)
    ).length;
    if (short / lines.length >= 0.8 && punctEndRate >= 0.4) return true;
  }
  // ③ 单段粘贴的词（词牌/诗体标识 + 短句密度）：剔除书名号标题后句号切分平均句长 ≤14 字
  if (strong || titled) {
    const body = t.replace(/《[^《》]*》/g, "");
    const sentences = body.split(/[。！？]/).map((s) => s.trim()).filter(Boolean);
    const avg = sentences.length ? sentences.reduce((a, s) => a + s.length, 0) / sentences.length : 99;
    if (sentences.length >= 8 && avg <= 14) return true;
  }
  return false;
}

export function detectMaterialType(text: string): MaterialRoute {
  if (verseSignals(text)) return MATERIAL_ROUTES.literature;
  const mode = detectMode(text);
  const byMode: Partial<Record<CardGenMode, MaterialType>> = {
    "card-formula": "formula",
    "card-seq": "sequence",
    "card-enum": "enumeration",
    "card-generation": "concept"
  };
  return MATERIAL_ROUTES[byMode[mode] ?? "concept"];
}

// ---------- 「后续可补」注记解析（v16 递进补卡交互） ----------
// v4 候选（G8 首轮克制多轮递进）要求模型把「该知识点后续还值得补哪些卡」写进
// knowledgePoints[].summary 的括号注记，形如：
//   "逊色的原因：中国哲学家之『不为』，非尽『不能』（后续可补：『不为/不能』的出处卡、原文语境卡）"
export interface FollowUpGroup {
  kpTitle: string; // 去掉注记后的知识点摘要
  items: string[]; // 每一项「后续可补」方向
}

export function parseFollowUps(summaries: unknown): FollowUpGroup[] {
  const out: FollowUpGroup[] = [];
  for (const raw of Array.isArray(summaries) ? summaries : []) {
    const s = String((raw as { summary?: unknown })?.summary ?? raw ?? "");
    const m = s.match(/[（(]后续可补[:：]([^）)]*)[）)]/);
    if (!m || !m[1].trim()) continue;
    const items = m[1]
      .split(/[、，,;；]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (items.length === 0) continue;
    out.push({ kpTitle: s.replace(/[（(]后续可补[:：][^）)]*[）)]/g, "").trim(), items });
  }
  return out;
}

// 导出供提示词测试台（prompt-lab）复用同一 JSON 容错逻辑
export function extractJson(raw: string): GenResult {
  const text = String(raw ?? "");
  const candidates: string[] = [];
  // 旧策略：首 { 到尾 }（模型在 JSON 前无杂质、后无杂质时最直接）
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  // v16 加固：括号平衡扫描——模型常在 JSON 之后追加说明文字（曾致「Unexpected non-whitespace
  // character after JSON」），取第一个顶层平衡的 JSON 对象，不受尾部杂质影响
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
  let lastErr: unknown = null;
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand) as GenResult;
      if (!Array.isArray(parsed.cards)) throw new Error("AI 返回缺少 cards 数组");
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `AI 未返回有效 JSON：${lastErr instanceof Error ? lastErr.message : "未找到 JSON 对象"}`
  );
}

export const cardGenerator: {
  generateCards(
    sourceText: string,
    context: { title?: string; section?: string; sourceRef?: { title?: string } | null; existingCards?: string[]; userProfile?: string; webContext?: string; focus?: string },
    mode: CardGenMode,
    onProgress?: (chars: number) => void,
    onThinking?: (thinkChars: number) => void
  ): Promise<{ batchId: string; result: GenResult; templateId: string | null }>;
  generateOcclusionCards(
    image: { dataUrl: string; assetPath: string },
    context: {
      title?: string;
      section?: string;
      /** v25：请求装配注入的补充指令（如「已由用户选定遮挡区域」），提示词模板不变 */
      focus?: string;
      /** v25：用户在图片上手动选定的区域（百分比，相对原图）——遮挡区域以它为准，模型只负责读出内容 */
      presetRegion?: { rect: { x: number; y: number; w: number; h: number }; shape?: OcclusionShape | null; label?: string };
    },
    onProgress?: (chars: number) => void,
    onThinking?: (thinkChars: number) => void
  ): Promise<{ batchId: string; result: GenResult; templateId: string | null }>;
  explain(
    sourceText: string,
    context: string,
    question: string | null,
    onDelta?: (acc: string) => void,
    onThinking?: (thinkChars: number) => void
  ): Promise<string>;
} = {
  async generateCards(sourceText, context, mode, onProgress, onThinking) {
    const resolved = mode === "auto" ? detectMode(sourceText) : mode;
    const tpl = await window.promptsAPI?.get(resolved);
    if (!tpl) throw new Error("提示词模板缺失");
    const sys = tpl.content;
    const user = [
      `【材料】\n${sourceText}`,
      context.title ? `【来源】《${context.title}》${context.section ? " · " + context.section : ""}` : "",
      // v16：补充制卡指令（「后续可补」递进补卡用）——提示词模板不变，仅装配请求时注入
      context.focus ? `【本次制卡重点（补充制卡）】\n${context.focus}` : "",
      context.webContext ? `【联网检索到的事件背景（仅供理解，禁止编造来源）】\n${context.webContext}` : "",
      context.existingCards?.length ? `【用户已有卡片（注意 R10 联想与干扰提示，禁止重复或换皮）】\n${context.existingCards.slice(0, 10).join("\n")}` : "",
      context.userProfile ? `【用户画像（R9 个性化例子优先用）】\n${context.userProfile}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    let acc = "";
    const raw = await aiGateway.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      onProgress
        ? (a) => {
            acc = a;
            onProgress(a.length);
          }
        : undefined,
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
    if (!tpl) throw new Error("提示词模板缺失（card-occlusion）");
    const textParts = [
      "【任务】识别图片中适合记忆测试的内容并给出遮挡区域（坐标为相对图片尺寸的百分比）。",
      // v25：用户已手绘区域的场景——图片是用户选区的裁剪，模型只负责读出该区域内容；
      // 指令经请求装配注入（与 generateCards 的 context.focus 同机制），提示词模板不变
      context.focus ? `【用户已选定的遮挡区域】${context.focus}` : "",
      context.title ? `【来源】《${context.title}》${context.section ? " · " + context.section : ""}` : ""
    ].filter(Boolean);
    const userContent: ({ type: "image_url"; image_url: { url: string } } | { type: "text"; text: string })[] = [
      { type: "image_url", image_url: { url: image.dataUrl } },
      { type: "text", text: textParts.join("\n") }
    ];
    let acc = "";
    const raw = await aiGateway.chat(
      [
        { role: "system", content: tpl.content },
        { role: "user", content: userContent }
      ],
      onProgress
        ? (a) => {
            acc = a;
            onProgress(a.length);
          }
        : undefined,
      0.2,
      onThinking
    );
    const result = extractJson(raw || acc);
    const preset = context.presetRegion;
    if (preset) {
      // v25 用户选区模式（图片为选区裁剪）：遮挡区域 = 用户选定区域，绝不采用模型返回的 regions——
      // 模型看到的是裁剪图，其坐标为裁剪坐标系，写进 occlusion_json 会在原图上错位
      const rect = {
        x: clampPct(preset.rect.x),
        y: clampPct(preset.rect.y),
        w: Math.max(1, Math.min(100 - clampPct(preset.rect.x), clampPct(preset.rect.w))),
        h: Math.max(1, Math.min(100 - clampPct(preset.rect.y), clampPct(preset.rect.h)))
      };
      const shape = preset.shape ? normalizeShape({ ...preset.shape, ord: 0 }) : null;
      const rects = [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, ord: 0 }];
      const cards = (result.cards ?? []).slice(0, 1); // 一个区域一张卡（与 D16 区域-卡一一对应一致）
      if (cards.length === 0) throw new Error("模型未产出卡片，请重试或改用手动制卡");
      for (const card of cards) {
        card.cardType = "imageOcclusion";
        card.ord = 0;
        card.occlusion = {
          assetPath: image.assetPath,
          ord: 0,
          rects,
          shapes: shape ? [shape] : null,
          label: String(card.back ?? preset.label ?? "")
        };
      }
      result.cards = cards;
      result.regions = [
        { ord: 0, label: String(cards[0].back ?? preset.label ?? ""), ...rect, shape: shape ?? undefined }
      ];
      const batch0 = await window.batchesAPI?.create({
        scope: "card-occlusion",
        sourceText: `[图片选区] ${image.assetPath}`,
        context: { ...context, imageAsset: image.assetPath, userRegion: true },
        promptTemplateId: tpl.id,
        result
      });
      return { batchId: batch0?.id || "", result, templateId: tpl.id };
    }
    // 区域规范化：坐标钳制 0-100、w/h 下限 1，防模型越界导致遮挡框不可见
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
      throw new Error("模型未返回遮挡区域（regions 为空），请换一张更清晰的图片重试");
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
      sourceText: `[图片] ${image.assetPath}`,
      context: { ...context, imageAsset: image.assetPath, regionCount: regions.length },
      promptTemplateId: tpl.id,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tpl.id };
  },

  async explain(sourceText, context, question, onDelta, onThinking) {
    const tpl = await window.promptsAPI?.get("reader-explain");
    const sys = tpl?.content || "你是阅读助手。";
    const user = `【选中文本】\n${sourceText}\n\n${context ? `【上下文】${context}` : ""}\n\n${question ? `【用户追问】${question}` : "请解释这段文字。"}`;
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

// ---------- CardLintEngine（§8.4，纯本地静态规则） ----------
export interface LintIssue {
  ruleId: string;
  severity: "error" | "warn" | "info";
  message: string;
}

const CHANGEABLE = /(统计|版本|价格|政策|截至|目前|当前|最新)/;

export function lintCard(draft: {
  front?: string;
  back?: string;
  cardType?: string;
  cloze?: string | null;
  contextPrefix?: string | null;
  sourceRef?: unknown;
  dateStamp?: string | null;
  knowledgePointId?: string | null;
  clusterSize?: number;
  occlusion?: { assetPath?: string; rects?: unknown[]; shapes?: (OcclusionShape | null | undefined)[] | null } | null;
}): LintIssue[] {
  const issues: LintIssue[] = [];
  const front = draft.front || "";
  const back = draft.back || "";
  const cloze = draft.cloze || "";

  // L11（v15 语义修正）：遮挡卡缺的是「资产/区域」，不再误判 front 文本；
  // v25：区域既可由 rects 表达，也可由 shapes（矩形/椭圆/多边形）表达，二者取其一即算有效
  if (
    draft.cardType === "imageOcclusion" &&
    !(draft.occlusion && occlusionShapes(draft.occlusion).length > 0 && draft.occlusion.assetPath)
  ) {
    issues.push({ ruleId: "L11", severity: "error", message: "图像遮挡卡缺少图像资产或遮挡区域" });
  }
  if (back.replace(/\s/g, "").length > 60) {
    issues.push({ ruleId: "L1", severity: "warn", message: "back 信息过载（>60字），考虑拆分（规则4 最小信息）" });
  }
  if (/^(是|否|对|错|正确|错误|true|false)\.?$/i.test(back.trim())) {
    issues.push({ ruleId: "L2", severity: "warn", message: "是否题（规则：避免判断题）" });
  }
  if (/(有哪些|列举|分别列出)/.test(front)) {
    issues.push({ ruleId: "L3", severity: "warn", message: "集合型问法（规则9 避免集合）" });
  }
  if (cloze) {
    const holes = cloze.match(/\{\{c\d+::/g);
    if (holes && holes.length > 2) {
      issues.push({ ruleId: "L9", severity: "warn", message: "单卡挖空 >2 处（规则4/5）" });
    }
  }
  if (!draft.contextPrefix) {
    issues.push({ ruleId: "L5", severity: "info", message: "缺 contextPrefix 上下文前缀（规则16）" });
  }
  if (!draft.sourceRef) {
    issues.push({ ruleId: "L6", severity: "info", message: "缺来源 sourceRef（规则18）" });
  }
  if (front.length > 80) {
    issues.push({ ruleId: "L10", severity: "warn", message: "front 过长（>80字），模式匹配风险（规则12）" });
  }
  if (draft.knowledgePointId && draft.clusterSize === 1) {
    issues.push({ ruleId: "L8", severity: "info", message: "孤儿卡（该知识点下仅此一张）" });
  }
  if (!draft.dateStamp && CHANGEABLE.test(front + back)) {
    issues.push({ ruleId: "L12", severity: "info", message: "易变内容建议加 dateStamp（规则19）" });
  }
  // L13 前缀泄题：contextPrefix 的内容词与答案重叠（文档 §8.4 v10）
  const frontClean = front.replace(/\s/g, "");
  const backClean = back.replace(/\s/g, "");
  const prefix = (draft.contextPrefix || "").replace(/[:：\s]/g, "");
  if (prefix && prefix.length >= 2) {
    if (backClean.includes(prefix) || frontClean.replace(prefix, "").includes(prefix)) {
      issues.push({
        ruleId: "L13",
        severity: "warn",
        message: "前缀泄题：前缀与答案/问题内容重复，会直接提示答案（规则16）"
      });
    }
  }
  // L14 实体全名疑似缩略（R16 v10.1）：单字「X 说/认为/…」式姓氏引用，或中间点名单侧缺失
  const text = frontClean + backClean;
  if (/[\u4e00-\u9fa5]{1}(?=(说|指出|认为|主张|提出|批评|表示|写道|在《))/.test(text) && !/[•·]|\(|（/.test(text.slice(0, 30))) {
    // 粗筛：出现「单字+言说动词」且上下文无全名结构 — 提示确认
    issues.push({
      ruleId: "L14",
      severity: "warn",
      message: "疑似人名缩略（R16）：请确认使用完整全名（如「迈克尔·杨」而非「杨」）"
    });
  }
  return issues;
}

// ---------- 相似检索（§3.19） ----------
export const similaritySearch = {
  async findSimilar(cardText: string, k = 3) {
    return (await window.similarityAPI?.find(cardText, k)) ?? [];
  }
};

// ---------- 卡片持久化封装 ----------
export const cardsApi = {
  create: async (card: unknown) => (await window.cardsAPI?.create(card)) ?? { id: "" },
  update: async (card: unknown) => (await window.cardsAPI?.update(card)) ?? false,
  get: async (id: string) => ((await window.cardsAPI?.get(id)) ?? null) as CardRecord | null,
  listDue: async () => ((await window.cardsAPI?.listDue()) ?? []) as (CardRecord & { docTitle?: string })[],
  listAll: async () => ((await window.cardsAPI?.listAll()) ?? []) as (CardRecord & { docTitle?: string })[],
  remove: async (id: string) => (await window.cardsAPI?.remove(id)) ?? false,
  // v22 撤销评分：review 传 fsrsBefore（评分前 FSRS 快照）方可撤销
  review: async (cardId: string, fsrsState: unknown, rating: string, durationMs?: number, fsrsBefore?: unknown) => {
    await window.cardsAPI?.review(cardId, fsrsState, rating, durationMs, fsrsBefore);
  },
  lastUndoableReview: async () =>
    (await window.cardsAPI?.lastUndoableReview()) as { logId: string; cardId: string; rating: string; reviewedAt: number } | null,
  undoReview: async () =>
    (await window.cardsAPI?.undoReview()) as
      | { ok: true; card: CardRecord; rating: string }
      | { ok: false; reason: string },
  // v23（§4.4.9）：persist 失败后的纯持久化重试（只重试持久化，绝不重执行业务 mutation）
  persistNow: async () => (await window.cardsAPI?.persistNow()) ?? false,
  skip: async (cardId: string) => {
    await window.cardsAPI?.skip(cardId);
  },
  setSuspended: async (id: string, suspended: boolean, reason?: string) =>
    (await window.cardsAPI?.setSuspended(id, suspended, reason)) ?? false,
  updateLeech: async (id: string, patch: Record<string, unknown>) =>
    (await window.cardsAPI?.updateLeech(id, patch)) ?? false,
  resolveLeech: async (id: string, resolution: string, updates?: unknown) =>
    (await window.cardsAPI?.resolveLeech(id, resolution, updates)) ?? false,
  listLeech: async () => ((await window.cardsAPI?.listLeech()) ?? []) as CardRecord[],
  addIssue: async (issue: unknown) => (await window.issuesAPI?.add(issue)) ?? { id: "" },
  listIssues: async (cardId: string) => ((await window.issuesAPI?.list(cardId)) ?? []) as CardIssueRecord[],
  resolveIssue: async (id: string) => (await window.issuesAPI?.resolve(id)) ?? false,
  setBatchStatus: async (id: string, status: string) => {
    await window.batchesAPI?.setStatus(id, status);
  }
};

export interface CardRecord {
  id: string;
  noteText: string;
  cardType: string;
  clozeOrds: number[];
  cardOrd: number;
  frontMarkdown: string;
  backMarkdown: string;
  contextPrefix: string | null;
  contextRef: {
    documentId?: string;
    extractId?: string;
    anchorText?: string;
    anchorRatio?: number;
    /** 阅读内核定位（v20）：结构级 CFI（绑定特定文档结构，非永久 ID） */
    cfi?: string;
    /** 章节索引兜底 */
    chapterIndex?: number;
    /** 生成该锚点时的阅读引擎版本（回归归因用） */
    readerEngineVersion?: string;
  } | null;
  mnemonic: string | null;
  example: string | null;
  sourceRef: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp: string | null;
  priority: number;
  tags: string[];
  domain: string[];
  knowledgePointId: string | null;
  /** v25：rects 恒为包围盒（兼容旧渲染）；shapes 为精确轮廓（矩形/椭圆/多边形） */
  occlusionJson: {
    rects: { x: number; y: number; w: number; h: number; ord: number }[];
    assetPath: string;
    shapes?: OcclusionShape[] | null;
  } | null;
  // §4.1 契约：fsrs_json 全字段持久化（含 S/D/reps/lastReview）
  fsrs: { state?: string; due?: number; lapses?: number; reps?: number; stability?: number; difficulty?: number; lastReview?: number | null };
  leech: { isLeech?: boolean; suspended?: boolean; suspendedAt?: number | null; resolution?: string } | null;
  generatedBy: string;
  genBatchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CardIssueRecord {
  id: string;
  card_id: string;
  rule_id: string;
  severity: string;
  message: string;
  source: string;
  status: string;
}
