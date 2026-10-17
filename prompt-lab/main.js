// 提示词测试台（M1.3，v15）—— 独立最小 Electron 应用。
// 复用主软件的 ai.js（AI 网关）与 prompts.js（当前基线）；提示词编辑只落在测试台自己的
// prompts.local.json，绝不写回主软件的 prompt_templates 表——并回须由用户在主软件中播种新版本。
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// 独立 userData（%APPDATA%/prompt-lab）：配置与主软件隔离，Key 须在测试台内单独配置一次
app.setName("prompt-lab");

const { getAIConfig, setAIConfig, chatStream } = require("../electron/ai");
const P = require("../electron/prompts");
// v31 起：原 v4 候选已并回主软件，测试台改为「基线直引」（见 prompts-draft.js）；
// 调优时由 AI 把改动写成 prompts-draft.js 的显式覆盖并 bump DRAFT_TAG。
const { DRAFT_TAG, DRAFT_SCOPES } = require("./prompts-draft");

const BASELINE_SCOPES = {
  "card-generation": { name: "主制卡", content: P.CARD_GEN_PROMPT },
  "card-formula": { name: "公式分解", content: P.CARD_FORMULA_PROMPT },
  "card-seq": { name: "序列/背诵", content: P.CARD_SEQ_PROMPT },
  "card-enum": { name: "枚举拆解", content: P.CARD_ENUM_PROMPT },
  "card-literature": { name: "文学/诗歌背诵", content: P.CARD_LITERATURE_PROMPT },
  "card-mnemonic": { name: "助记双卡", content: P.CARD_MNEMONIC_PROMPT },
  "card-contrast": { name: "对比卡", content: P.CARD_CONTRAST_PROMPT },
  "card-wording": { name: "措辞优化", content: P.CARD_WORDING_PROMPT },
  "card-basic": { name: "前置知识卡", content: P.CARD_BASIC_PROMPT },
  "card-vocab": { name: "单词制卡", content: P.CARD_VOCAB_PROMPT },
  "card-occlusion": { name: "图片挖空", content: P.CARD_OCCLUSION_PROMPT },
  "reader-explain": { name: "阅读解释", content: P.READER_EXPLAIN_PROMPT },
  // v48.103（D148 后续）：简明解读基线＝主软件 v3 现行文本；候选在 prompts-draft.js（ASD-STE100 直答）
  "reader-explain-ste": { name: "简明解读", content: P.READER_EXPLAIN_STE_PROMPT },
  "leech-rescue": { name: "难点诊断", content: P.LEECH_RESCUE_PROMPT },
  // v40/v41/v43（M8-B / K2-A / K2-B）：洞察与 LKM 知识模型 scope 基线直引。
  // 补记：此前的 journal-insight / knowledge-extraction / knowledge-relation 只进了 DRAFT_SCOPES，
  // 而本地表自动补齐只遍历 BASELINE_SCOPES——它们在测试台里一直不可见，v43 一并补上。
  "journal-insight": { name: "日记洞察", content: P.JOURNAL_INSIGHT_PROMPT },
  "knowledge-extraction": { name: "知识点抽取归一", content: P.KNOWLEDGE_EXTRACTION_PROMPT },
  "knowledge-relation": { name: "知识关系抽取", content: P.KNOWLEDGE_RELATION_PROMPT },
  "material-difficulty": { name: "材料难度画像", content: P.MATERIAL_DIFFICULTY_PROMPT },
  "knowledge-probe": { name: "维度探针", content: P.KNOWLEDGE_PROBE_PROMPT },
  "frontier-explain": { name: "推荐解释", content: P.FRONTIER_EXPLAIN_PROMPT },
  "structure-analogy": { name: "结构类比", content: P.STRUCTURE_ANALOGY_PROMPT },
  // v48.22（M16 / D58，E1）：摘录重排（AI 只重排处理顺序；出层经 kpScopes.validateExtractRerankOutput 裁决）
  "extract-rerank": { name: "摘录重排", content: P.EXTRACT_RERANK_PROMPT },
  // v45（M14-UM1，D39）：用户记忆整理（摄入轮 + 周期整理轮共用一套契约）
  "user-memory": { name: "用户记忆整理", content: P.USER_MEMORY_PROMPT }
};

function promptsFile() {
  return path.join(app.getPath("userData"), "prompts.local.json");
}

function writeLocalPrompts(data) {
  fs.mkdirSync(path.dirname(promptsFile()), { recursive: true });
  fs.writeFileSync(promptsFile(), JSON.stringify(data, null, 2), "utf-8");
}

// 加载测试台本地提示词库。初始/迁移逻辑：
// - 缺失的 scope（含新增的 card-literature）自动补齐；
// - 用户未手改（edited=false）且 draftTag 落后的 scope 自动升级到当前 v4 候选；
// - 用户手改过的内容永远不动，直到ta自己点「应用 v4 候选补丁」或「还原为主软件 v3 基线」。
function loadLocalPrompts() {
  let data = null;
  let fresh = false;
  try {
    data = JSON.parse(fs.readFileSync(promptsFile(), "utf-8"));
    if (!data.scopes || typeof data.scopes !== "object") throw new Error("bad file");
  } catch {
    data = { baseline: "main-v3", savedAt: Date.now(), scopes: {} };
    fresh = true;
  }
  let migrated = fresh;
  for (const [scope, def] of Object.entries(BASELINE_SCOPES)) {
    if (!data.scopes[scope]) {
      const draft = DRAFT_SCOPES[scope];
      data.scopes[scope] = {
        name: def.name,
        content: draft ? draft.content : def.content,
        edited: false,
        draftTag: draft ? DRAFT_TAG : "main-v3"
      };
      migrated = true;
    } else {
      const s = data.scopes[scope];
      if (!s.draftTag) s.draftTag = s.edited ? "unknown" : "main-v3";
      const draft = DRAFT_SCOPES[scope];
      if (!s.edited && draft && s.draftTag !== DRAFT_TAG) {
        s.content = draft.content;
        s.draftTag = DRAFT_TAG;
        migrated = true;
      }
    }
  }
  if (migrated) {
    data.savedAt = Date.now();
    writeLocalPrompts(data);
  }
  return data;
}

ipcMain.handle("lab:prompts:list", () => {
  const local = loadLocalPrompts();
  return Object.entries(local.scopes).map(([scope, def]) => {
    const base = (BASELINE_SCOPES[scope] || {}).content;
    const draft = (DRAFT_SCOPES[scope] || {}).content;
    return {
      scope,
      name: def.name,
      edited: Boolean(def.edited),
      sameAsBaseline: def.content === base,
      isDraft: Boolean(draft) && def.content === draft
    };
  });
});

ipcMain.handle("lab:prompts:get", (_e, scope) => {
  const local = loadLocalPrompts();
  const def = local.scopes[String(scope)];
  if (!def) return null;
  const draft = (DRAFT_SCOPES[String(scope)] || {}).content;
  return {
    scope: String(scope),
    name: def.name,
    content: def.content,
    edited: Boolean(def.edited),
    isDraft: Boolean(draft) && def.content === draft
  };
});

ipcMain.handle("lab:prompts:save", (_e, scope, content) => {
  const local = loadLocalPrompts();
  const key = String(scope);
  if (!local.scopes[key]) return false;
  local.scopes[key].content = String(content ?? "");
  local.scopes[key].edited = true;
  local.savedAt = Date.now();
  writeLocalPrompts(local);
  return true;
});

ipcMain.handle("lab:prompts:reset", (_e, scope) => {
  const local = loadLocalPrompts();
  const key = String(scope);
  const base = BASELINE_SCOPES[key];
  if (!local.scopes[key] || !base) return false;
  local.scopes[key].content = base.content;
  local.scopes[key].edited = false;
  local.scopes[key].draftTag = "main-v3";
  local.savedAt = Date.now();
  writeLocalPrompts(local);
  return true;
});

// 把单个 scope 覆写为当前 v4 候选（用户手改过也允许强制应用，以按钮点击为准）
ipcMain.handle("lab:prompts:applyDraft", (_e, scope) => {
  const local = loadLocalPrompts();
  const key = String(scope);
  const draft = DRAFT_SCOPES[key];
  const base = BASELINE_SCOPES[key];
  if (!local.scopes[key] || !draft || !base) return false;
  local.scopes[key].content = draft.content;
  local.scopes[key].edited = false;
  local.scopes[key].draftTag = DRAFT_TAG;
  local.savedAt = Date.now();
  writeLocalPrompts(local);
  return true;
});

// ---------- AI 配置（复用主软件 ai.js；存测试台自己的 ai-config.json） ----------
ipcMain.handle("lab:config:get", () => getAIConfig());
ipcMain.handle("lab:config:set", (_e, partial) => setAIConfig(partial || {}));

// ---------- 流式对话（与主软件 ai:chat 同构，绝不把 Key 发到渲染层） ----------
ipcMain.on("lab:chat", (e, requestId, messages, temperature) => {
  const send = (m) => {
    if (!e.sender.isDestroyed()) e.sender.send("lab:stream", requestId, m);
  };
  try {
    chatStream({ messages, temperature }, send).catch((err) => {
      send({ error: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    send({ error: err instanceof Error ? err.message : String(err), code: err?.code });
  }
});

// ---------- 图片材料（测试台不落库，直接回 dataURL 给渲染层） ----------
ipcMain.handle("lab:pickImage", async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const p = result.filePaths[0];
  const buf = fs.readFileSync(p);
  if (buf.length > 10 * 1024 * 1024) throw new Error("图片超过 10MB，请压缩后再测");
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
  return { name: path.basename(p), dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
});

// ---------- 导图 v2 基准页（独立窗口；逻辑在 mindmapBench*.js） ----------
require("./mindmapBenchMain").register({ app, ipcMain, dialog, BrowserWindow, getAIConfig, chatStream });

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "提示词测试台",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  loadLocalPrompts(); // 首次启动即播种基线
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
