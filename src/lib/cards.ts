// CardGeneratorProvider（文档§3.17）+ Cloze 解析 + CardLintEngine（§3.18/§8.4）
import { aiGateway } from "./ai";
import { autoQueueKpAiProcessing } from "./kpExtract";
import { clampPct, normalizeShape, occlusionShapes, type OcclusionShape } from "./occlusion";
import { settingsStore } from "./settings";
// v48.51（D91）：简明解读的 CLP pack 注入（回退链 + 格式化）
import { formatProfile, resolveProfile, STE_OUTPUT_LANG } from "./steProfiles";
// v48.60（D101）：标签规范常量（L17 与 tags.ts 同源，禁第二份阈值）
import { TAG_MAX_DEPTH, TAG_MAX_LEN, TAG_MAX_PER_CARD, type TagVocabEntry } from "./tags";

declare global {
  interface Window {
    promptsAPI?: { get: (scope: string) => Promise<{ id: string; content: string; version?: number; situation_required?: number } | null>; list: () => Promise<unknown[]> };
    cardsAPI?: {
      create: (card: unknown) => Promise<{ id: string }>;
      update: (card: unknown) => Promise<boolean>;
      get: (id: string) => Promise<unknown>;
      /** v48.61（D103）：生成信息区只读 join（card + 批次 + 提示词 + card_issues） */
      genInfo?: (id: string) => Promise<unknown>;
      listDue: () => Promise<unknown[]>;
      todayQueue?: (now?: number) => Promise<unknown>;
      listAll: () => Promise<unknown[]>;
      /** v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数（meta/ids 轻量行集 + 行窗口按需取） */
      listMeta?: () => Promise<unknown>;
      queryIds?: (query: string) => Promise<unknown>;
      getWindow?: (ids: string[]) => Promise<unknown[]>;
      siblingGroup?: (key: string) => Promise<unknown[]>;
      deferredToday?: (now?: number) => Promise<unknown>;
      remove: (id: string) => Promise<boolean>;
      review: (cardId: string, fsrsState: unknown, rating: string, durationMs?: number, fsrsBefore?: unknown) => Promise<boolean>;
      lastUndoableReview: () => Promise<unknown>;
      undoReview: () => Promise<unknown>;
      persistNow: () => Promise<boolean>;
      skip: (cardId: string) => Promise<boolean>;
      setSuspended: (id: string, suspended: boolean, reason?: string) => Promise<boolean>;
      /** v48.22（D58 §6.8-6）：卡片批量（单事务；op = suspend|resume|postpone|delete；v48.60/D102 增 archive|restore） */
      batch: (op: string, ids: string[], payload?: unknown) => Promise<unknown>;
      /** v48.60（D101）：标签写入（items=[{id,tags[]}]，渲染层算好每卡终值） */
      setTags?: (items: Array<{ id: string; tags: string[] }>) => Promise<unknown>;
      /** v48.60（D101）：标签词表（cards.tags_json ∪ extracts.tag_json 派生） */
      listTags?: () => Promise<Array<{ display: string; cardCount: number; extractCount: number; lastUsedAt: number }>>;
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
  render(hiddenOrd: number | number[] | null): string;
  /** v30（D27）：渲染并返回被遮 ord 的文本顺序（多空同答卡用于 […]↔ord 对位与答案排序） */
  renderDetail(hiddenOrds: number[] | null): { text: string; maskedOrds: number[] };
}

export function parseCloze(text: string): ClozeParse {
  // B-6（审计）：原正则缺 s 标志，`.` 不跨行 → 答案含换行的挖空**一个都匹配不到**：
  // ords 为空（L9 lint 也数不到空、不报警）、正面原样吐出 {{c1::答案}}（直接泄题）、背面为空串。
  const re = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
  const ords = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ords.add(Number(m[1]));
  const normalize = (hiddenOrd: number | number[] | null): Set<number> | null => {
    if (hiddenOrd === null) return null;
    return new Set(Array.isArray(hiddenOrd) ? hiddenOrd : [hiddenOrd]);
  };
  const renderWith = (hiddenOrd: number | number[] | null) => {
    const mask = normalize(hiddenOrd);
    const maskedOrds: number[] = [];
    const out = text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_s, ordStr, content, hint) => {
      const ord = Number(ordStr);
      // 正面一律完全遮蔽 […...]：hint 不上正面（hint 曾泄漏半个答案，用户反馈 #3）
      if (mask === null || !mask.has(ord)) return content;
      if (!maskedOrds.includes(ord)) maskedOrds.push(ord);
      return "[…]";
    });
    return { text: out, maskedOrds };
  };
  return {
    ords: [...ords].sort((a, b) => a - b),
    render(hiddenOrd) {
      return renderWith(hiddenOrd).text;
    },
    renderDetail(hiddenOrds) {
      return renderWith(hiddenOrds ?? []);
    }
  };
}

export function extractClozeAnswer(text: string, ord: number): string {
  // 注意：ord 内联进正则后没有 (\d+) 组——m[1]=content、m[2]=hint（与 parseCloze 的
  // replace 回调组序不同，后者多一个 (\d+) 组；v15 前错按 replace 组序取 m[2]/m[3]，
  // 导致无 hint 的 v3 卡背面恒为空串，违反「答案区只含挖空内容」契约）
  // B-6（审计）：同上补跨行；B-9（审计）：同卡重复 ord 时用非全局正则只取第一个，
  // 导致「被要求填两个空、却只看得到第一个空的答案」—— 第二个空的答案永久丢失。
  // 改为全局取全并按出现顺序拼接。
  const re = new RegExp(`\\{\\{c${ord}::([\\s\\S]*?)(?:::([\\s\\S]*?))?\\}\\}`, "g");
  // B-9（审计）：同卡重复 ord 时逐次取全，拼接返回，避免后来的空答案丢失。
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) parts.push((m[1] ?? "") + (m[2] ? `（${m[2]}）` : ""));
  return parts.join(" / ");
}

/** v30（D27）多空同答卡：按传入 ord 序逐个取答案（每空一条，含 hint 拼回） */
export function extractClozeAnswers(text: string, ords: number[]): string[] {
  return ords.map((o) => extractClozeAnswer(text, o));
}

/**
 * v30（D27）一卡多空的形态落地：
 * - together（缺省）：单卡同答，clozeOrds 留空（渲染端约定：空=遮全部 ord，且随编辑后的实际文本走）；
 * - per-blank：拆成每空一张独立卡（各自独立 FSRS 调度），每张 clozeOrds=[自己的 ord]——
 *   渲染时遮自己那空、其余空以原文显示，背面只给本空答案（用户钦定两形态）。
 * 非 cloze 草稿或单空卡一律原样返回（包一层保持调用方逻辑统一）。
 */
export function expandClozeDraft(d: CardDraft): CardDraft[] {
  if (d.cardType !== "cloze") return [d];
  const text = d.cloze || d.front || "";
  const ords = parseCloze(text).ords;
  if (d.clozeMode !== "per-blank" || ords.length <= 1) return [d];
  return ords.map((o, i) => ({ ...d, ord: i, clozeOrds: [o] }));
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
  /** v30（D27）：一卡多空的考察形态——together=同答（一起回忆，缺省）；per-blank=分答（拆成每空一张卡） */
  clozeMode?: "together" | "per-blank" | null;
  /** v30（D27）：分答拆卡后本卡要遮蔽的 ord 集（同答卡留空=遮全部；落库进 cards.cloze_ords） */
  clozeOrds?: number[];
  example?: string | null;
  mnemonic?: string | null;
  // M1.1 图片挖空卡：图片遮挡区域（随 draft 带给确认面板，接受时落 occlusionJson）
  ord?: number;
  occlusion?: { assetPath: string; ord: number; rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: OcclusionShape[] | null; label?: string; regionScope?: string } | null;
  sourceRef?: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp?: string | null;
  prioritySuggestion?: number;
  ruleNotes?: string[];
  warnings?: string[];
  // v46（M14-UM2，R20）：AI 引用的记忆行（逐字抄录）+ 本地子串校验结果（undefined=本卡未走记忆链路）
  memoryRef?: string | null;
  memoryRefValid?: boolean;
  // v48.60（D101）：用户标签（四入口写入；AI 草稿 v1 恒空——建议标签属批 F，须走 prompt-lab 闭环）
  tags?: string[];
}

export interface GenResult {
  knowledgePoints: { id: string; summary: string }[];
  blockReasons: string[];
  cards: CardDraft[];
  regions?: OcclusionRegion[];
}

export type CardGenMode = "auto" | "card-generation" | "card-formula" | "card-seq" | "card-enum" | "card-literature" | "card-mnemonic" | "card-contrast" | "card-wording" | "card-basic" | "card-occlusion" | "card-vocab" | /** v48.5（M15，用户制卡语义拍板）：导图节点「就此制卡」专用——对作者组织结构出题，auto 不路由到它 */ "card-structure";

// ---------- 材料类型路由（M1.2，本地规则先行） ----------
// 类型→原则→提示词→默认形式映射（§6.3.10；映射表待用户确认后写入文档）：
//   concept 概念论述  → card-generation → 问答（可在确认区转翻转问答）
//   formula 公式推导  → card-formula   → 问答（LaTeX）
//   sequence 流程背诵 → card-seq       → 问答（seq 续写）
//   enumeration 枚举  → card-enum      → 挖空
//   image   图片材料  → card-occlusion → 图片挖空（独立链路 generateOcclusionCards）
//   vocab   词汇/单词 → card-vocab     → 单词四卡（M7：看中→外/看外→中/听音/原句挖空）
export type MaterialType = "concept" | "formula" | "sequence" | "enumeration" | "image" | "literature" | "vocab";

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
  literature: { materialType: "literature", scope: "card-literature", label: "文学/诗歌背诵", defaultForm: "问答" },
  vocab: { materialType: "vocab", scope: "card-vocab", label: "词汇/单词", defaultForm: "单词四卡" }
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
  // v32（M7）：纯单词形直判词汇（确定性本地函数）——
  // 仅 1–2 token、无中文标点长句、无公式符号，**且含外文字符**（ASCII 字母/假名/韩文）；
  // 纯中文短句仍走既有分支（M1 回归保护：如「列出有哪些因素」不得误判 vocab）
  const t = String(text ?? "").normalize("NFKC").trim();
  if (
    t && t.length <= 34 && t.split(/\s+/).length <= 2 &&
    !/[，。！？；：、]/.test(t) && !/[=\\$]/.test(t) && !/(公式|方程|步骤|流程|列出|有哪些)/.test(t) &&
    /[A-Za-z\u3040-\u30ff\uac00-\ud7af]/.test(t)
  ) {
    return MATERIAL_ROUTES.vocab;
  }
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

/** D98（v48.57）：card-occlusion 请求公共段（模板装配 + 多模态调用 + JSON 解析）——
 *  generateOcclusionCards 与编辑器「AI 挖空建议层」（OcclusionEditor 直读，零批次创建）
 *  共用同一装配，语义不分流（同一份事实不允许两套解释）。 */
export async function requestOcclusionResult(
  image: { dataUrl: string },
  context: { title?: string; section?: string; focus?: string; contextText?: string },
  onProgress?: (chars: number) => void,
  onThinking?: (thinkChars: number) => void,
  /** v48.74（D118 §3④）：注册一次性取消闭包（ai:abort） */
  onCancelRegister?: (cancel: () => void) => void
): Promise<{ result: GenResult; templateId: string }> {
  const tpl = await window.promptsAPI?.get("card-occlusion");
  if (!tpl) throw new Error("提示词模板缺失（card-occlusion）");
  const textParts = [
    "【任务】识别图片中适合记忆测试的内容并给出遮挡区域（坐标为相对图片尺寸的百分比）。",
    // v25：用户已手绘区域的场景——图片是用户选区的裁剪，模型只负责读出该区域内容；
    // 指令经请求装配注入（与 generateCards 的 context.focus 同机制），提示词模板不变
    context.focus ? `【用户已选定的遮挡区域】${context.focus}` : "",
    // v29（D26）：图片周边文字上下文——相关则结合出题，无关则由模型忽略
    context.contextText ? `【图片周边文字上下文（图片上方 1 段 + 下方 2 段）】\n${context.contextText}\n（若与图片内容相关，可结合上下文出题；无关则忽略）` : "",
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
    onThinking,
    onCancelRegister
  );
  return { result: extractJson(raw || acc), templateId: tpl.id };
}

export const cardGenerator: {
  generateCards(
    sourceText: string,
    context: { title?: string; section?: string; sourceRef?: { title?: string } | null; existingCards?: string[]; existingCardsLimit?: number; userProfile?: string; webContext?: string; focus?: string; /** v46（UM-2）：本书已有卡 UDC 域分布的检索键 */ documentId?: string | null },
    mode: CardGenMode,
    onProgress?: (chars: number) => void,
    onThinking?: (thinkChars: number) => void,
    /** v48.74（D118 §3④）：注册一次性取消闭包（ai:abort） */
    onCancelRegister?: (cancel: () => void) => void
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
      /** v29（D26）：图片周边文字上下文（上 1 段下 2 段），AI 相关则用无关则忽略 */
      contextText?: string;
    },
    onProgress?: (chars: number) => void,
    onThinking?: (thinkChars: number) => void,
    /** v48.74（D118 §3④）：注册一次性取消闭包（ai:abort） */
    onCancelRegister?: (cancel: () => void) => void
  ): Promise<{ batchId: string; result: GenResult; templateId: string | null }>;
  explain(
    sourceText: string,
    context: string,
    question: string | null,
    onDelta?: (acc: string) => void,
    onThinking?: (thinkChars: number) => void,
    /** v48.51（D91）：mode=ste 走 reader-explain-ste（简明解读）；缺省 general 走既有 reader-explain（逐字不动） */
    opts?: { mode?: "general" | "ste"; matLang?: string },
    /** v48.74（D118 §3④）：注册一次性取消闭包（ai:abort） */
    onCancelRegister?: (cancel: () => void) => void
  ): Promise<string>;
} = {
  async generateCards(sourceText, context, mode, onProgress, onThinking, onCancelRegister) {
    const resolved = mode === "auto" ? detectMode(sourceText) : mode;
    const tpl = await window.promptsAPI?.get(resolved);
    if (!tpl) throw new Error("提示词模板缺失");
    // v48.61（D103，D94 设计稿 §3.2）：生成时模型名快照进批次 context_json.model——
    // 卡详情生成信息区按批次如实展示；存量批次（无快照）显示「—」，不猜
    const aiCfg = await aiGateway.getConfig().catch(() => null);
    const sys = tpl.content;
    // v46（M14-UM2，R20 v44 原则制）：模板 situationRequired=1 时装配【用户记忆】块
    // （memory:retrieve 内部做开关/无 Key 检查；未命中/未开启 → block=null → 零注入零提示）
    let memoryBlock: string | null = null;
    if (Number((tpl as { situation_required?: number }).situation_required) === 1) {
      const mem = await window.memoryAPI?.retrieve({
        documentId: context.documentId ?? null,
        title: context.title ?? "",
        section: context.section ?? "",
        text: sourceText
      });
      if (mem?.ok && mem.block) memoryBlock = mem.block;
    }
    const user = [
      `【材料】\n${sourceText}`,
      context.title ? `【来源】《${context.title}》${context.section ? " · " + context.section : ""}` : "",
      // v16：补充制卡指令（「后续可补」递进补卡用）——提示词模板不变，仅装配请求时注入
      context.focus ? `【本次制卡重点（补充制卡）】\n${context.focus}` : "",
      context.webContext ? `【联网检索到的事件背景（仅供理解，禁止编造来源）】\n${context.webContext}` : "",
      context.existingCards?.length ? `【用户已有卡片（注意 R10 联想与干扰提示，禁止重复或换皮）】\n${context.existingCards.slice(0, context.existingCardsLimit ?? 10).join("\n")}` : "",
      context.userProfile ? `【用户画像（R9 个性化例子优先用）】\n${context.userProfile}` : "",
      memoryBlock || ""
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
      onThinking,
      onCancelRegister
    );
    const result = extractJson(raw || acc);
    // v30（D27）：per-blank 多空卡在入确认面板前拆成每空一张（独立 FSRS 调度）
    result.cards = result.cards.flatMap((c) => expandClozeDraft(c));
    // v46（M14-UM2，§4.18-10）：memoryRef 本地子串校验（只验存在性，非相关性判定）——
    // 成功=「情境来自记忆」，失败=「情境来源存疑」（确认面板标注、接受时二次确认，不阻断）
    if (memoryBlock) {
      for (const c of result.cards) {
        const ref = typeof c.memoryRef === "string" ? c.memoryRef.trim().slice(0, 500) : "";
        if (ref) c.memoryRefValid = memoryBlock.includes(ref);
      }
    }
    const batch = await window.batchesAPI?.create({
      scope: resolved,
      sourceText,
      context: {
        ...context,
        // v48.61（D103）：生成时模型名快照（生成信息区展示用；诊断留痕同批装配）
        model: aiCfg?.model ?? null,
        // 诊断留痕：确认联网背景是否真的进入了上下文
        webContextChars: context.webContext ? context.webContext.length : 0,
        webContextPreview: context.webContext ? context.webContext.slice(0, 200) : "",
        // v46：记忆注入留痕（审计 §1.9）
        memoryInjected: Boolean(memoryBlock),
        memoryBlockChars: memoryBlock ? memoryBlock.length : 0
      },
      promptTemplateId: tpl.id,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tpl.id };
  },

  // M1.1（v15，D16）：图片挖空生成链路——图片已入库，把 dataURL 交 GLM 多模态识别遮挡区域，
  // 返回 regions（归一化百分比坐标）+ 每区域一张 imageOcclusion 草稿（rects 共享同一 occlusionJson）
  async generateOcclusionCards(image, context, onProgress, onThinking, onCancelRegister) {
    const { result, templateId: tplId } = await requestOcclusionResult(image, context, onProgress, onThinking, onCancelRegister);
    const preset = context.presetRegion;
    if (preset) {
      // v29 D26 选区即画布：模型 cards[] 逐张处理——
      // imageOcclusion：card.regions（选区图百分比）→ 映射全图 + 钳制 → 每卡自带 rects
      //   （单挖空 1 块；多挖空多块同遮同答）；qa：occlusionJson 挂图、rects 空数组、front 存题面。
      // 裁剪坐标 → 全图坐标映射：fullX = px + rx × pw / 100（D26 公式），映射后钳制 [0,100]。
      // 0 张有效卡 → 回退 D25 旧语义（整选区单卡），流程不死路。
      const px = clampPct(preset.rect.x);
      const py = clampPct(preset.rect.y);
      const pw = Math.max(1, Math.min(100 - px, clampPct(preset.rect.w)));
      const ph = Math.max(1, Math.min(100 - py, clampPct(preset.rect.h)));
      const toFullX = (rx: number, rw: number) => {
        const x = px + (clampPct(rx) * pw) / 100;
        const w = (clampPct(rw) * pw) / 100;
        return { x, w };
      };
      const toFullY = (ry: number, rh: number) => {
        const y = py + (clampPct(ry) * ph) / 100;
        const h = (clampPct(rh) * ph) / 100;
        return { y, h };
      };
      const mappedCards: CardDraft[] = [];
      const mappedRegions: OcclusionRegion[] = [];
      let ordSeq = 0;
      // v2 模型输出：每卡自带 regions（选区图百分比坐标）——CardDraft 类型无此字段，经 raw 视图读取
      type RawRegion = { ord?: number; label?: string; x?: number; y?: number; w?: number; h?: number };
      type RawCard = CardDraft & { regions?: RawRegion[] };
      for (const rawCardRaw of result.cards ?? []) {
        const rawCard = rawCardRaw as RawCard;
        if (rawCard.cardType === "qa") {
          // 看图问答卡：挂图无遮挡（rects 空数组），front 存题面文字
          mappedCards.push({
            ...rawCard,
            cardType: "imageOcclusion",
            ord: ordSeq,
            occlusion: { assetPath: image.assetPath, ord: ordSeq, rects: [], shapes: null, label: "" }
          });
          ordSeq += 1;
          continue;
        }
        // 遮挡卡：模型返回的每卡 regions（选区图坐标）映射回全图坐标
        const cardRegions = (rawCard.regions ?? []).map((r, i) => {
          const fx = toFullX(Number(r.x) || 0, Number(r.w) || 0);
          const fy = toFullY(Number(r.y) || 0, Number(r.h) || 0);
          // 过滤映射后 <1% 的退化区域（含越界裁剪），再钳制入界
          if (fx.w < 1 || fy.h < 1) return null;
          const x = clampPct(fx.x);
          const y = clampPct(fy.y);
          return {
            ord: i,
            label: String(r.label ?? ""),
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            w: Math.round(Math.min(100 - x, fx.w) * 10) / 10,
            h: Math.round(Math.min(100 - y, fy.h) * 10) / 10
          };
        }).filter((r): r is NonNullable<typeof r> => r !== null);
        if (cardRegions.length === 0) continue; // 无有效区域的遮挡卡丢弃
        const rects = cardRegions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, ord: r.ord }));
        mappedCards.push({
          ...rawCard,
          cardType: "imageOcclusion",
          ord: ordSeq,
          occlusion: {
            assetPath: image.assetPath,
            ord: ordSeq,
            rects,
            shapes: null,
            label: String(rawCard.back ?? cardRegions.map((r) => r.label).join("；"))
          }
        });
        for (const r of cardRegions) mappedRegions.push({ ...r, ord: mappedRegions.length });
        ordSeq += 1;
      }
      if (mappedCards.length > 0) {
        result.cards = mappedCards;
        result.regions = mappedRegions;
        const batch0 = await window.batchesAPI?.create({
          scope: "card-occlusion",
          sourceText: `[图片选区] ${image.assetPath}`,
          context: { ...context, imageAsset: image.assetPath, userRegion: true, d26Mapped: true },
          promptTemplateId: tplId,
          result
        });
        return { batchId: batch0?.id || "", result, templateId: tplId };
      }
      // 回退 D25 旧语义：模型未产出有效卡 → 整选区单卡（流程不死路）
      const rect = {
        x: clampPct(preset.rect.x),
        y: clampPct(preset.rect.y),
        w: Math.max(1, Math.min(100 - clampPct(preset.rect.x), clampPct(preset.rect.w))),
        h: Math.max(1, Math.min(100 - clampPct(preset.rect.y), clampPct(preset.rect.h)))
      };
      const shape = preset.shape ? normalizeShape({ ...preset.shape, ord: 0 }) : null;
      const rects = [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, ord: 0 }];
      const first = (result.cards ?? [])[0];
      // 模型零卡也产出整选区单卡（流程不死路；back 用模型内容或空）
      const fallbackCard: CardDraft = {
        ...(first ?? {}),
        cardType: "imageOcclusion",
        ord: 0,
        front: first?.front || "图中遮挡区域对应的是什么？",
        back: first?.back || preset.label || "",
        occlusion: {
          assetPath: image.assetPath,
          ord: 0,
          rects,
          shapes: shape ? [shape] : null,
          label: String(first?.back ?? preset.label ?? "")
        }
      };
      const cards = [fallbackCard];
      result.cards = cards;
      result.regions = [
        { ord: 0, label: String(cards[0].back ?? preset.label ?? ""), ...rect, shape: shape ?? undefined }
      ];
      const batch0 = await window.batchesAPI?.create({
        scope: "card-occlusion",
        sourceText: `[图片选区] ${image.assetPath}`,
        context: { ...context, imageAsset: image.assetPath, userRegion: true, d26Fallback: true },
        promptTemplateId: tplId,
        result
      });
      return { batchId: batch0?.id || "", result, templateId: tplId };
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
        // v30：rects 为全图所有区域共享（cardOrd 选中考察区，其余 ink 高亮旧语义）——显式标记 regionScope
        card.occlusion = { assetPath: image.assetPath, ord: card.ord ?? 0, rects, label: region?.label, regionScope: "shared" };
      }
    }
    const batch = await window.batchesAPI?.create({
      scope: "card-occlusion",
      sourceText: `[图片] ${image.assetPath}`,
      context: { ...context, imageAsset: image.assetPath, regionCount: regions.length },
      promptTemplateId: tplId,
      result
    });
    return { batchId: batch?.id || "", result, templateId: tplId };
  },

  async explain(sourceText, context, question, onDelta, onThinking, opts, onCancelRegister) {
    // v48.51（D91 §6.3）：mode=ste → reader-explain-ste 模板 + 双 pack 注入（分析 pack 按材料语言回退链
    // 解析，输出 pack 恒 zh-Hans=界面语言）；general（缺省）→ 既有 reader-explain 路径逐字不动。
    if (opts?.mode === "ste") {
      const tpl = await window.promptsAPI?.get("reader-explain-ste");
      if (!tpl) throw new Error("提示词模板缺失（reader-explain-ste）");
      const matLang = String(opts.matLang ?? "").trim();
      const analysis = resolveProfile(matLang);
      const output = resolveProfile(STE_OUTPUT_LANG);
      const sys = tpl.content
        .replace("{{ANALYSIS_PROFILE}}", formatProfile(analysis))
        .replace("{{OUTPUT_PROFILE}}", formatProfile(output));
      const user = [
        `【选中文本】\n${sourceText}`,
        context ? `【上下文】${context}` : "",
        `【材料语言】${matLang || "未标注——请自检材料语言并在 <!--ste:matLang=…--> 标记中报告"}`,
        `【解读语言】${STE_OUTPUT_LANG}（简体中文）`,
        // v48.74（D118 追加）：追问必须送达——此前 ste 分支丢掉 question，四个追问按钮与
        // 初次解读发出的请求逐字相同 ⇒ 回复几乎一样（模板侧另有「追问直答」条款配合）
        question ? `【用户追问】${question}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");
      return aiGateway.chat(
        [
          { role: "system", content: sys },
          { role: "user", content: user }
        ],
        onDelta,
        0.7,
        onThinking,
        onCancelRegister
      );
    }
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
      onThinking,
      onCancelRegister
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
  tags?: string[] | null;
}): LintIssue[] {
  const issues: LintIssue[] = [];
  const front = draft.front || "";
  const back = draft.back || "";
  const cloze = draft.cloze || "";

  // L11（v15 语义修正）：遮挡卡缺的是「资产/区域」，不再误判 front 文本；
  // v25：区域既可由 rects 表达，也可由 shapes（矩形/椭圆/多边形）表达，二者取其一即算有效；
  // v29（D26）：放宽为「有 asset 即有效」——看图问答卡（rects 空数组挂图）合法
  if (
    draft.cardType === "imageOcclusion" &&
    !(draft.occlusion && draft.occlusion.assetPath)
  ) {
    issues.push({ ruleId: "L11", severity: "error", message: "图像遮挡卡缺少图像资产" });
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
  // L16 宽容度标注（M1 覆盖报告缺口 L-C，对应 R2/R5 的 G7）：集合/开放式问法必须给出
  // 可字面判定的合格线，否则「答对」无法判定。
  const isCollectionAsk = /(列出|列举|有哪些|分别|包括|哪几种|几种)/.test(front);
  const hasTolerance = /(至少|最少|任一|之一|任意|不限于)/.test(front + back);
  if (isCollectionAsk && !hasTolerance) {
    issues.push({
      ruleId: "L16",
      severity: "warn",
      message: "开放式/集合型答案缺合格线标注（R5/R2 G7）——front 注明「至少回忆 N 种」，使答对可判定"
    });
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
  // L17 标签超限（v48.60 / D101）：数量/长度/深度超限提示；阈值与 src/lib/tags.ts 同源（禁第二份）
  const tags = draft.tags ?? [];
  if (tags.length > TAG_MAX_PER_CARD) {
    issues.push({ ruleId: "L17", severity: "info", message: `标签超过 ${TAG_MAX_PER_CARD} 个，建议收敛到高频使用的少数标签` });
  }
  const overLen = tags.filter((t) => [...String(t)].length > TAG_MAX_LEN);
  if (overLen.length > 0) {
    issues.push({ ruleId: "L17", severity: "info", message: `标签超过 ${TAG_MAX_LEN} 字：「${overLen[0]}…」` });
  }
  const overDepth = tags.filter((t) => String(t).split("::").length > TAG_MAX_DEPTH);
  if (overDepth.length > 0) {
    issues.push({ ruleId: "L17", severity: "info", message: `标签层级超过 ${TAG_MAX_DEPTH} 层：「${overDepth[0]}」` });
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
/** v48.67（D111 §6.8-6 数据通道）：主进程轻量行集——无题面/答案/备注大列，排序/预设/页签/锚点闭包/按书 scope 全在渲染层消费 */
export interface BrowserMetaRow {
  id: string;
  bookId: string | null;
  docTitle: string | null;
  extractId: string | null;
  priority: number;
  status: string | null;
  cardType: string;
  fsrsState: string;
  suspended: boolean;
  isLeech: boolean;
  due: number | null;
  lapses: number;
  reps: number;
  mem: 0 | 1;
  createdAt: number;
}
export interface BrowserBooksEntry { id: string; title: string }
export interface BrowserMetaResult { fp: string; total: number; meta: BrowserMetaRow[]; books: BrowserBooksEntry[] }
export interface BrowserQueryResult { fp: string; meta: BrowserMetaRow[] }

/** v34（M12，§4.2-20）：今日队列视图——「今日该复习什么」的唯一口径（队列与统计同源） */
export interface TodayQueue {
  cards: (CardRecord & { docTitle?: string })[];
  deferred: (CardRecord & {
    docTitle?: string;
    /** 延后原因：kind=reviewed（同源卡今日已评分）/ revealed（同组今日放行名额已被占） */
    deferReason?: { siblingKey: string; kind: "reviewed" | "revealed"; siblingCardId: string | null; siblingFront: string };
  })[];
  now: number;
}

/** 延后原因：kind=reviewed（同源卡今日已评分）/ revealed（同组今日放行名额已被占） */
export type DeferredReason = NonNullable<TodayQueue["deferred"][number]["deferReason"]>;

export const cardsApi = {
  create: async (card: unknown) => (await window.cardsAPI?.create(card)) ?? { id: "" },
  update: async (card: unknown) => (await window.cardsAPI?.update(card)) ?? false,
  get: async (id: string) => ((await window.cardsAPI?.get(id)) ?? null) as CardRecord | null,
  /** v48.61（D103）：生成信息区只读 join（AI 卡批次/提示词/当时 CardLint） */
  genInfo: async (id: string) => ((await window.cardsAPI?.genInfo?.(id)) ?? null) as CardGenInfo | null,
  listDue: async () => ((await window.cardsAPI?.listDue()) ?? []) as (CardRecord & { docTitle?: string })[],
  // v34（M12，§4.2-20）：今日队列视图（放行卡 + 同源暂缓清单；ReviewView/CardBrowser 消费）
  todayQueue: async (now?: number) =>
    ((await window.cardsAPI?.todayQueue?.(now)) ?? { cards: [], deferred: [], now: Date.now() }) as TodayQueue,
  listAll: async () => ((await window.cardsAPI?.listAll()) ?? []) as (CardRecord & { docTitle?: string })[],
  // v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数
  listMeta: async () =>
    ((await window.cardsAPI?.listMeta?.()) ?? { fp: "", total: 0, meta: [], books: [] }) as BrowserMetaResult,
  queryIds: async (query: string) =>
    ((await window.cardsAPI?.queryIds?.(query)) ?? { fp: "", meta: [] }) as BrowserQueryResult,
  getWindow: async (ids: string[]) => ((await window.cardsAPI?.getWindow?.(ids)) ?? []) as (CardRecord & { docTitle?: string })[],
  siblingGroup: async (key: string) => ((await window.cardsAPI?.siblingGroup?.(key)) ?? []) as (CardRecord & { docTitle?: string })[],
  deferredToday: async (now?: number) =>
    ((await window.cardsAPI?.deferredToday?.(now)) ?? []) as Array<{ id: string; deferReason: DeferredReason }>,
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
  /** v48.22（D58 §6.8-6）：卡片批量（单事务 + 单次落盘） */
  batch: async (op: string, ids: string[], payload?: unknown): Promise<{ ok: boolean; count?: number; reason?: string }> =>
    ((await window.cardsAPI?.batch(op, ids, payload)) ?? { ok: false, reason: "API 不可用" }) as { ok: boolean; count?: number; reason?: string },
  /** v48.60（D101）：标签写入——items=[{id,tags[]}]（渲染层用 tags.ts 算好每卡终值，主进程只存储） */
  setTags: async (items: Array<{ id: string; tags: string[] }>): Promise<{ ok: boolean; count?: number; reason?: string }> =>
    ((await window.cardsAPI?.setTags?.(items)) ?? { ok: false, reason: "API 不可用" }) as { ok: boolean; count?: number; reason?: string },
  /** v48.60（D101）：标签词表（cards.tags_json ∪ extracts.tag_json 派生，主进程只读现算） */
  listTags: async (): Promise<TagVocabEntry[]> => ((await window.cardsAPI?.listTags?.()) ?? []) as TagVocabEntry[],
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
    /** PDF 系页码定位（0 基，v28；v35 前类型漏声明但运行时已有） */
    pageIndex?: number;
    /** 生成该锚点时的阅读引擎版本（回归归因用） */
    readerEngineVersion?: string;
    /** 图片来源（v35）：engine=正文图片（可跳转）/ library=资源库选图（图不在书中，无定位锚） */
    imageSource?: "engine" | "library";
    /** 正文图片锚（v35）：alt/周边文字，用于阅读器端 locateImage 找回原图 */
    imageAnchor?: { alt?: string; contextText?: string };
    /** v48（M15，D41-⑥）：来源导图节点 id——学习状态只读映射与溯源（重生成沿 remap 解析） */
    mindmapNodeId?: string;
  } | null;
  mnemonic: string | null;
  example: string | null;
  sourceRef: { title?: string; url?: string | null; page?: number | null } | null;
  dateStamp: string | null;
  priority: number;
  tags: string[];
  /** v48.60（D102，§4.1）：卡片生命周期（active/archived；NULL 视同 active） */
  status?: string | null;
  domain: string[];
  knowledgePointId: string | null;
  /** v25：rects 恒为包围盒（兼容旧渲染）；shapes 为精确轮廓（矩形/椭圆/多边形）；
   *  v30：regionScope="shared"=旧 v1 共享区域链路（json 含全图所有区域，按 cardOrd 单区高亮）；缺省=每卡自带（全 accent） */
  occlusionJson: {
    rects: { x: number; y: number; w: number; h: number; ord: number }[];
    assetPath: string;
    shapes?: OcclusionShape[] | null;
    regionScope?: string;
  } | null;
  // §4.1 契约：fsrs_json 全字段持久化（含 S/D/reps/lastReview）
  fsrs: { state?: string; due?: number; lapses?: number; reps?: number; stability?: number; difficulty?: number; lastReview?: number | null };
  leech: { isLeech?: boolean; suspended?: boolean; suspendedAt?: number | null; resolution?: string } | null;
  generatedBy: string;
  /** v34（M12，§4.16）：同源组标识——同一制卡来源单元的多张卡共享；NULL=不参与延后。只服务今日队列视图，不参与 FSRS */
  siblingKey: string | null;
  genBatchId: string | null;
  /** v46（M14-UM2，§4.18-10）：记忆溯源——{line: 逐字引用的记忆行, verified: 本地子串校验结果}；null=未用记忆 */
  memoryRefJson?: { line: string; verified: boolean } | null;
  /** v32（M7）：词典条目快照（providerId/word/normalizedWord/language/audio/kind…）——单词卡发音、溯源与按钮入位用 */
  dictJson: { providerId?: string; word?: string; normalizedWord?: string; language?: string; audio?: string | null; kind?: string; kinds?: string[]; snapshotAt?: number } | null;
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

/** v48.61（D103，D94 设计稿 §3.2）：生成信息区只读 join（cards:genInfo 输出） */
export interface CardGenInfo {
  card: CardRecord;
  /** 生成批次；手动卡 / gen_batch_id 缺失 / 批次行不存在时为 null */
  batch: {
    id: string;
    scope: string;
    status: string;
    createdAt: number;
    /** 生成时模型名快照（v48.61 起写入批次 context_json.model）；存量批次为 null（如实显示「—」） */
    model: string | null;
    promptTemplateId: string | null;
  } | null;
  /** 当时使用的提示词模板（scope/名称/版本）；批次或模板行缺失时为 null */
  template: { id: string; scope: string; name: string; version: number; isDefault: boolean; createdAt: number } | null;
  /** card_issues 按 card_id 全量（含已解决；「当时 CardLint 结果」） */
  issues: CardIssueRecord[];
}

// ---------- 易混对比卡（v30 D29 候选增强）：以当前卡为基准，AI 从已有卡语义检索易混卡后走对比模板产三件套 ----------

/**
 * 对比卡候选清单（纯函数供测试）：只排除基准卡本身——挂起卡保留（用户「标记并暂停」常是
 * 「疑似重复之后处理」，正是对比卡最该找回的候选，v30 复审修正）。排序=与基准卡同主领域的卡
 * 优先（易混是同领域现象），同域内按创建新→旧（listAll 序）；挖空卡展开显示；图片卡 front 无
 * 区分度改用 back；逐条截断 50 字、文本去重、总量 cap 500（个人库多年一般不超此数，接近全覆盖）。
 */
export function buildContrastCandidates(
  cards: {
    id: string;
    cardType: string;
    frontMarkdown: string;
    noteText: string;
    backMarkdown: string;
    domain?: string[] | null;
    leech?: { suspended?: boolean } | null;
  }[],
  baseId: string,
  baseDomain: string[] = [],
  cap = 500
): string[] {
  const primary = baseDomain[0] || "";
  const sameDomain: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    if (c.id === baseId) continue;
    let text: string;
    if (c.cardType === "cloze") text = parseCloze(c.frontMarkdown || c.noteText).render(null);
    else if (c.cardType === "imageOcclusion") text = `[图片卡] ${c.backMarkdown || c.noteText || ""}`;
    else text = c.frontMarkdown || c.noteText;
    text = text.replace(/\s+/g, " ").trim().slice(0, 50);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    (primary && c.domain && c.domain[0] === primary ? sameDomain : rest).push(text);
  }
  return [...sameDomain, ...rest].slice(0, cap);
}

/**
 * 以基准卡生成对比卡三件套（v30 D29）：候选清单经请求装配注入（existingCardsLimit 放开截断），
 * focus 指令要求模型从清单中选出与基准卡最易混的一张作为 B；无真实混淆风险时允许返回空卡。
 * 提示词模板用 card-contrast（front 自带「对照:A vs B」前缀），模板内容不变。
 */
export async function generateContrastDrafts(
  base: { id?: string; front: string; back: string; title?: string | null; domain?: string[] | null },
  onProgress?: (chars: number) => void,
  onThinking?: (thinkChars: number) => void
): Promise<{ batchId: string; drafts: CardDraft[] }> {
  const all = await cardsApi.listAll();
  const candidates = buildContrastCandidates(all, base.id ?? "", base.domain ?? []);
  if (candidates.length === 0) return { batchId: "", drafts: [] };
  const material = [base.front, base.back].filter(Boolean).join("\n");
  const focus = [
    "这是对比卡生成：上面的【材料】是基准卡（A）的内容。",
    "请从【用户已有卡片】清单中选出与 A 最易混的一张作为 B——相似但不相同、复习时容易答混的概念/论证/学说，",
    "排除 A 的同义换皮与表述变体；然后按对比卡规则产三件套（A 与 B 的区别 / A 的关键特征 / B 的关键特征）。",
    "若清单中没有与 A 存在真实混淆风险的卡，cards 返回空数组并在 blockReasons 说明，禁止硬凑。"
  ].join("");
  const { batchId, result } = await cardGenerator.generateCards(
    material,
    { title: base.title ?? undefined, existingCards: candidates, existingCardsLimit: candidates.length, focus },
    "card-contrast",
    onProgress,
    onThinking
  );
  return { batchId, drafts: result.cards };
}

/**
 * M7 单词制卡（v32，D31）：词典条目 + 阅读原句 → card-vocab 走七步管线产四卡；
 * 无 Key/失败时调用方可回退本地 buildVocabDrafts（Reader.acceptVocabCards 即此策略）。
 */
export async function generateVocabDrafts(
  entry: { word: string; reading?: string | null; pronunciation?: string | null; definitions: string[]; partOfSpeech?: string[]; examples?: string[]; source: string },
  sentence: string,
  onProgress?: (chars: number) => void,
  onThinking?: (thinkChars: number) => void
): Promise<{ batchId: string; drafts: CardDraft[] }> {
  const material = [
    `【词典条目】${entry.word}${entry.reading ? `（${entry.reading}）` : ""}${entry.pronunciation ? ` ${entry.pronunciation}` : ""}`,
    `释义：${entry.definitions.slice(0, 3).join("；")}`,
    entry.partOfSpeech?.length ? `词性：${entry.partOfSpeech.join("/")}` : "",
    `【阅读原句】${sentence}`,
    `【来源】${entry.source}`,
  ].filter(Boolean).join("\n");
  const { batchId, result } = await cardGenerator.generateCards(
    material,
    { title: entry.source },
    "card-vocab",
    onProgress,
    onThinking
  );
  return { batchId, drafts: result.cards };
}

/**
 * v34（M12，D33/§4.16）：同源组键建立（确定性，禁 AI 判定）。
 * 优先级：① 显式键（调用点给的结构性单元：翻转对 act:flip-* / 单词查词 / 对比动作 / 同图 img:*）
 * → ② 来源锚点键 src:<documentId>:<extractId|hash(anchorText)>，仅当制卡源文本 ≤ limit（短材料）
 * → ③ 无锚点但一次动作拆出多卡（per-blank 分答）→ act:split-<id>（结构性同源必须错日，与长度无关）
 * → ④ null（不参与延后：长选区各卡锚定不同知识点；无锚点单卡无同源对象）。
 * 纯函数：键规则矩阵由 tests/m12.test.cjs 锁定。
 */
export function siblingKeyFor(opts: {
  explicitKey?: string | null;
  contextRef?: { documentId?: string; extractId?: string; anchorText?: string } | null;
  sourceText?: string | null;
  limit?: number;
  /** 一次动作拆出的卡数（per-blank 分答拆卡 >1 时即使无锚点也必须建组，§4.16 item 5） */
  splitCount?: number;
  genId?: () => string;
}): string | null {
  if (opts.explicitKey) return opts.explicitKey;
  const genId = opts.genId ?? (() => globalThis.crypto?.randomUUID?.() ?? `r${Math.random().toString(36).slice(2)}`);
  const ref = opts.contextRef;
  if (ref?.documentId) {
    const srcLen = (opts.sourceText ?? "").length;
    const limit = Number.isInteger(opts.limit) && (opts.limit as number) > 0 ? (opts.limit as number) : 300;
    if (srcLen > limit) return null; // 长选区不建键（§4.16 item 5：避免「每天只准学一张」的阻塞）
    const anchorPart = ref.extractId || `h${fnv1a(ref.anchorText || "")}`;
    return `src:${ref.documentId}:${anchorPart}`;
  }
  if ((opts.splitCount ?? 1) > 1) return `act:split-${genId()}`;
  return null;
}

// FNV-1a 32 位：锚点文本 → 稳定短哈希（无 Node 依赖，渲染层/测试 bundle 通用）
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** v34（M12）：短材料阈值（settings.app.siblingBury.sourceTextLimit，默认 300）——制卡调用点统一经此读取 */
export async function burySourceTextLimit(): Promise<number> {
  try {
    const sb = await settingsStore.get<{ sourceTextLimit?: number } | null>("app", "siblingBury", null);
    if (sb && Number.isInteger(sb.sourceTextLimit) && (sb.sourceTextLimit as number) > 0) return sb.sourceTextLimit as number;
  } catch { /* 设置缺失用默认 */ }
  return 300;
}

/**
 * AI 草稿接受入库（Reader 确认面板 / 复习对比卡确认框共用）：per-blank 展开、lint、S1 相似检索、落库。
 * 返回新建卡 id 列表（per-blank 拆卡时多张）。sourceTitle/contextRef 供来源与跳转原文锚点；
 * dictJson（M7 词典快照）随插入一次写入——cards:update 是全行 UPDATE，建卡后绝不能用 partial
 * 对象二次 update（曾把 front/back 等 17 列清空，用户实测 4 张空白卡）。
 * v34（M12）：siblingKey=调用点显式同源键（翻转对/单词四卡/对比动作）；sourceText=本次制卡源文本
 * （短材料锚点键的长度门控输入）；缺省时由 contextRef+sourceText 推导，per-blank 拆卡自动继承同键。
 */
export async function createAcceptedCard(
  d: CardDraft,
  ctx: { sourceTitle?: string | null; contextRef?: CardRecord["contextRef"]; dictJson?: unknown; siblingKey?: string | null; sourceText?: string | null; genBatchId?: string | null } = {}
): Promise<string[]> {
  const expanded = expandClozeDraft(d);
  const siblingKey = siblingKeyFor({
    explicitKey: ctx.siblingKey,
    contextRef: ctx.contextRef,
    sourceText: ctx.sourceText,
    limit: await burySourceTextLimit(),
    splitCount: expanded.length
  });
  const ids: string[] = [];
  for (const dd of expanded) {
    const cloze = dd.cardType === "cloze" ? dd.cloze || "" : "";
    const card = {
      noteText: dd.front || cloze,
      cardType: dd.cardType || "qa",
      frontMarkdown: dd.front || "",
      backMarkdown: dd.back || "",
      // 同答卡存 []（渲染端约定空=遮全部 ord）；分答拆卡后每张带 [自己的 ord]
      clozeOrds: dd.clozeOrds ?? [],
      occlusionJson: dd.occlusion
        ? { rects: dd.occlusion.rects, assetPath: dd.occlusion.assetPath, shapes: dd.occlusion.shapes ?? null, regionScope: dd.occlusion.regionScope }
        : null,
      cardOrd: dd.ord ?? null,
      contextPrefix: dd.contextPrefix || null,
      contextRef: ctx.contextRef ?? null,
      mnemonic: dd.mnemonic || null,
      example: dd.example || null,
      sourceRef: dd.sourceRef || (ctx.sourceTitle ? { title: ctx.sourceTitle } : null),
      dateStamp: dd.dateStamp || null,
      priority: dd.prioritySuggestion ?? 50,
      // v48.60（D101）：调用方传入的标签（如批注标签继承初值）原样落库；AI 草稿缺省 = []
      tags: dd.tags ?? [],
      domain: dd.domain ?? [],
      knowledgePointId: dd.knowledgePointId || null,
      // v41（K2-A，D38）：批次归组——AI 抽取归一的簇键（batch:<id>:<kp>）依据，消除跨材料 kp1 碰撞
      genBatchId: ctx.genBatchId || null,
      dictJson: ctx.dictJson ?? null,
      // v46（M14-UM2，§4.18-10）：记忆溯源——校验成功落 {line, verified:true}；
      // 校验失败但用户仍接受 = {line, verified:false}（浏览页标「来源存疑」，不自动改写）
      memoryRefJson: dd.memoryRef ? { line: dd.memoryRef, verified: dd.memoryRefValid === true } : null,
      siblingKey,
      generatedBy: "ai"
    };
    const issues = lintCard({
      front: card.frontMarkdown,
      back: card.backMarkdown,
      cardType: card.cardType,
      cloze,
      occlusion: card.occlusionJson ? { assetPath: card.occlusionJson.assetPath, rects: card.occlusionJson.rects } : null,
      contextPrefix: card.contextPrefix,
      sourceRef: card.sourceRef,
      dateStamp: card.dateStamp,
      knowledgePointId: card.knowledgePointId,
      tags: card.tags
    });
    const created = await cardsApi.create(card);
    ids.push(created.id);
    for (const issue of issues) {
      await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
    }
    const similar = await similaritySearch.findSimilar(card.frontMarkdown || cloze, 2);
    if (similar.length > 0) {
      await cardsApi.addIssue({
        cardId: created.id,
        ruleId: "S1",
        severity: "warn",
        message: `与已有卡相似（${Math.round(similar[0].score * 100)}%）：「${similar[0].front.slice(0, 30)}…」`,
        source: "lint"
      });
    }
  }
  // v41（K2-A，D38 触发方式①）：制卡顺带——本批接受的卡若带知识点簇，后台静默跑一轮 AI 抽取归一
  // （不阻塞、不弹窗、无 Key 静默跳过；结果以提案形式出现在「知识点」页签）
  if (ids.length) {
    const sources = expanded
      .map((dd) => ({
        knowledgePointId: String(dd.knowledgePointId || "").trim(),
        genBatchId: ctx.genBatchId || null,
        documentId: ctx.contextRef?.documentId || null
      }))
      .filter((s) => s.knowledgePointId);
    if (sources.length) void autoQueueKpAiProcessing(sources);
  }
  return ids;
}

/**
 * 是否有可跳转的原文锚点（v35）：任一定位字段存在即 true。
 * 资源库选图（imageSource="library"）恒 false——图不在书中，无定位锚。
 */
export function hasSourceAnchor(ref: CardRecord["contextRef"]): boolean {
  if (!ref || !ref.documentId) return false;
  if (ref.imageSource === "library") return false;
  if (ref.cfi || ref.pageIndex != null || ref.chapterIndex != null) return true;
  if (ref.anchorText && ref.anchorText.trim()) return true;
  if (typeof ref.anchorRatio === "number" && ref.anchorRatio > 0) return true;
  if (ref.imageAnchor && (ref.imageAnchor.alt || ref.imageAnchor.contextText)) return true;
  return false;
}
