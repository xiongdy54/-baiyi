// 提示词测试台渲染层（vanilla JS）。
// 复刻主软件制卡管线（§4.3）：材料类型路由 → 取模板 → 上下文打包 → 流式生成 → JSON 容错 → CardLint → 结果展示。
// 不入库：结果仅展示，供用户评测提示词效果。
// ⚠️ 本页面必须在 Electron 中运行（npx electron prompt-lab）；直接用浏览器打开 index.html 时
// window.labAPI 不存在，下方守卫会显示明确的错误指引而不是「点了没反应」。
const $ = (id) => document.getElementById(id);
const lib = window.cardsLib || {};

let prompts = [];
let curScope = "card-generation";
let image = null; // {name, dataUrl}
let running = false;

// ---------- 运行环境守卫 ----------
if (!window.labAPI) {
  document.body.innerHTML = `
    <div style="max-width:640px;margin:80px auto;padding:24px;border:1px solid #b91c1c;background:#fef2f2;font-family:sans-serif;color:#1c1917;line-height:1.8">
      <h2 style="margin-top:0;color:#b91c1c">⚠️ 测试台未在 Electron 中运行</h2>
      <p>当前页面是被浏览器直接打开的——这种环境下无法访问本机 AI 配置、图片文件与流式接口，所以按钮都不会有反应。</p>
      <p><b>正确启动方式</b>：在项目根目录双击 <code>启动提示词测试台.bat</code>，或在终端执行：</p>
      <pre style="background:#fff;padding:12px;border:1px solid #ccc"><code>npx electron prompt-lab</code></pre>
      <p>启动后窗口标题为「提示词测试台」，AI 配置与提示词会自动加载。</p>
    </div>`;
  throw new Error("labAPI missing: open prompt-lab via `npx electron prompt-lab`, not a browser");
}

function fatal(err) {
  const el = $("errorLine");
  if (el) {
    el.textContent = err && err.message ? err.message : String(err);
    el.classList.remove("hidden");
  } else {
    alert("测试台出错：" + (err && err.message ? err.message : String(err)));
  }
}

// ---------- 初始化 ----------
async function init() {
  try {
    await loadPromptList();
    await selectScope("card-generation");
    await refreshConfigState();
  } catch (err) {
    fatal(err);
  }
}

async function loadPromptList() {
  prompts = (await window.labAPI.listPrompts()) || [];
  renderScopeList();
}

function renderScopeList() {
  const box = $("scopeList");
  box.innerHTML = "";
  for (const p of prompts) {
    const btn = document.createElement("button");
    btn.className = "scope-chip" + (p.scope === curScope ? " active" : "");
    const differs = !p.sameAsBaseline; // v4 候选或用户手改：与主软件 v3 不同
    btn.innerHTML = `${p.name}${differs ? '<span class="dot">●</span>' : ""}`;
    btn.title =
      p.scope +
      (p.isDraft ? "（v4 候选：与主软件 v3 不同，待实测）" : p.edited ? "（已修改，未并回主软件）" : "");
    btn.onclick = () => selectScope(p.scope);
    box.appendChild(btn);
  }
}

async function selectScope(scope) {
  curScope = scope;
  const def = await window.labAPI.getPrompt(scope);
  $("curScopeName").textContent = scope;
  // 三态标签：与主软件 v3 一致 / v4 候选补丁版 / 用户手改
  $("curScopeState").textContent = def
    ? def.edited
      ? "已修改（本地）"
      : def.isDraft
        ? "v4 候选（测试台）"
        : "主软件 v3 基线"
    : "";
  $("promptText").value = def ? def.content : "";
  renderScopeList();
}

// ---------- AI 配置 ----------
async function refreshConfigState() {
  const cfg = await window.labAPI.getConfig();
  $("cfgBaseUrl").value = cfg.baseUrl || "";
  $("cfgModel").value = cfg.model || "";
  $("cfgState").textContent = cfg.hasKey ? "Key 已配置" : "未配置 Key";
  $("cfgState").style.color = cfg.hasKey ? "#15803d" : "#b91c1c";
}

$("configToggle").onclick = () => $("configPanel").classList.toggle("hidden");
$("cfgSave").onclick = async () => {
  try {
    const partial = { baseUrl: $("cfgBaseUrl").value.trim(), model: $("cfgModel").value.trim() };
    const key = $("cfgKey").value.trim();
    if (key) partial.apiKey = key;
    await window.labAPI.setConfig(partial);
    $("cfgKey").value = "";
    await refreshConfigState();
    setStatus("配置已保存");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (err) {
    fatal(err);
  }
};

// ---------- 提示词编辑（调优闭环的「AI 改提示词」入口） ----------
$("promptSave").onclick = async () => {
  try {
    await window.labAPI.savePrompt(curScope, $("promptText").value);
    await loadPromptList();
    await selectScope(curScope);
    setStatus("提示词已保存（仅测试台本地）");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (err) {
    fatal(err);
  }
};
$("promptReset").onclick = async () => {
  try {
    await window.labAPI.resetPrompt(curScope);
    await loadPromptList();
    await selectScope(curScope);
    setStatus("已还原");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (err) {
    fatal(err);
  }
};
$("promptDraft").onclick = async () => {
  try {
    await window.labAPI.applyDraft(curScope);
    await loadPromptList();
    await selectScope(curScope);
    setStatus("已应用 v4 候选补丁");
    window.setTimeout(() => setStatus(""), 2000);
  } catch (err) {
    fatal(err);
  }
};

// ---------- 图片材料 ----------
$("pickImgBtn").onclick = async () => {
  try {
    const picked = await window.labAPI.pickImage();
    if (!picked) return;
    image = picked;
    $("imgName").textContent = picked.name;
    $("modeSelect").value = "card-occlusion";
  } catch (err) {
    fatal(err);
  }
};

// ---------- 运行管线 ----------
$("runBtn").onclick = runPipeline;
$("rawToggle").onclick = () => $("rawOutput").classList.toggle("hidden");

function setStatus(s) {
  $("statusLine").textContent = s;
}

async function runPipeline() {
  if (running) return;
  const text = $("materialText").value.trim();
  const mode = $("modeSelect").value;
  if (!text && !image) {
    showError("请先粘贴材料文本或选择图片。");
    return;
  }
  if (mode === "card-occlusion" && !image) {
    showError("图片挖空模式需要先选择图片材料。");
    return;
  }
  hideError();
  $("results").innerHTML = "";
  $("rawOutput").textContent = "";

  // ① 材料类型路由（本地规则，复用主软件 cards.ts 的实现）
  const route = lib.detectMaterialType ? lib.detectMaterialType(text || "[图片]") : null;
  const scope = mode === "auto" ? (image ? "card-occlusion" : route ? route.scope : "card-generation") : mode;
  const routeLabel =
    mode !== "auto"
      ? `手动指定 → ${scope}`
      : image
        ? "图片材料 → card-occlusion"
        : route
          ? `${route.label} → ${route.scope}（默认形式：${route.defaultForm}）`
          : "";
  $("routeLine").textContent = `路由：${routeLabel} · 模板：${scope}`;

  // ② 取模板（测试台本地版本）
  const tpl = await window.labAPI.getPrompt(scope);
  if (!tpl) {
    showError(`提示词模板缺失：${scope}`);
    return;
  }

  // ③ 上下文打包（材料 + 来源标记；测试台不注入已有卡/画像）
  const source = $("sourceTitle").value.trim();
  const sourceLine = source ? `\n\n【来源】《${source}》` : "";
  const messages = [
    { role: "system", content: tpl.content },
    scope === "card-occlusion" && image
      ? {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: image.dataUrl } },
            { type: "text", text: `【任务】识别图片中适合记忆测试的内容并给出遮挡区域（坐标为相对图片尺寸的百分比）。${sourceLine}` }
          ]
        }
      : { role: "user", content: `【材料】\n${text}${sourceLine}` }
  ];

  // ④ 流式生成
  running = true;
  $("runBtn").disabled = true;
  let acc = "";
  let thinkChars = 0;
  const startedAt = Date.now();
  const tick = window.setInterval(() => {
    setStatus(
      acc
        ? `生成中… ${acc.length} 字 · ${Math.round((Date.now() - startedAt) / 1000)} 秒`
        : thinkChars
          ? `思考中… ${thinkChars} 字 · ${Math.round((Date.now() - startedAt) / 1000)} 秒`
          : `等待模型… ${Math.round((Date.now() - startedAt) / 1000)} 秒`
    );
  }, 500);
  try {
    acc = await chatStreamLocal(messages, 0.2, (n) => (thinkChars = n));
  } catch (err) {
    showError(err.message || String(err));
    return;
  } finally {
    window.clearInterval(tick);
    running = false;
    $("runBtn").disabled = false;
    setStatus(`完成 · 输出 ${acc.length} 字`);
  }
  $("rawOutput").textContent = acc;

  // ⑤⑥ JSON 容错 + Lint
  renderResult(acc, scope);
}

function chatStreamLocal(messages, temperature, onThinking) {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    let acc = "";
    let finished = false;
    const off = window.labAPI.onStream((rid, msg) => {
      if (rid !== requestId) return;
      if (msg.error && !finished) {
        finished = true;
        off();
        reject(new Error(msg.error));
        return;
      }
      if (msg.thinking !== undefined) onThinking(msg.thinking);
      if (msg.delta) acc += msg.delta;
      if (msg.done && !finished) {
        finished = true;
        off();
        resolve(acc);
      }
    });
    window.labAPI.chat(requestId, messages, temperature);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// v16 递进补卡状态：最近一次运行的结果 + 已展示的卡（补充卡追加到末尾，已有的永不丢失）
let lastRun = null; // { parsed, scope, text, source }
let benchCards = []; // 已展示的卡对象（含补充卡）

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function lintIssuesOf(c) {
  return lib.lintCard
    ? lib.lintCard({
        front: c.front,
        back: c.back,
        cardType: c.cardType,
        cloze: c.cloze || null,
        contextPrefix: c.contextPrefix || null,
        sourceRef: c.sourceRef || null,
        dateStamp: c.dateStamp || null,
        knowledgePointId: c.knowledgePointId || null,
        occlusion: c.cardType === "imageOcclusion" ? { assetPath: "image", rects: c.regions || (lastRun && lastRun.parsed.regions) || [] } : null
      })
    : [];
}

function cardEl(c, isSupplement) {
  const lintIssues = lintIssuesOf(c);
  const clozeShown = c.cloze ? String(c.cloze).replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, "〔$1〕") : "";
  const card = el("div", "result-card" + (isSupplement ? " result-card-supplement" : ""));
  card.appendChild(
    el("div", "rc-head", `
      <span class="rc-type">${escapeHtml(c.cardType || "qa")}</span>
      ${isSupplement ? '<span class="mono supplement-chip">补充</span>' : ""}
      ${c.contextPrefix ? `<span>${escapeHtml(c.contextPrefix)}</span>` : ""}
      ${c.domain ? `<span class="mono">domain: ${escapeHtml(JSON.stringify(c.domain))}</span>` : ""}
      ${c.prioritySuggestion ? `<span class="mono">P${escapeHtml(String(c.prioritySuggestion))}</span>` : ""}`)
  );
  const isOcclusion = c.cardType === "imageOcclusion" && lastRun && lastRun.image && c.occlusion && (c.occlusion.rects || []).length > 0;
  if (isOcclusion) {
    // 图片挖空卡（v16 展示规范）：题目=原图+主题色遮挡块（考察区域 accent、其余 ink）；
    // 答案=原始图片（无遮挡覆盖）。切换按钮预演复习端的两面。
    card.appendChild(el("div", "rc-front", escapeHtml(c.front || "图中遮挡区域对应的是什么？")));
    const stage = el("div", "occlusion-stage");
    const img = document.createElement("img");
    img.className = "occlusion-img";
    img.src = lastRun.image.dataUrl;
    stage.appendChild(img);
    const ord = c.ord ?? c.occlusion.ord ?? 0;
    const rects = c.occlusion.rects;
    let showingAnswer = false;
    const render = () => {
      stage.querySelectorAll(".occlusion-rect").forEach((n) => n.remove());
      if (!showingAnswer) {
        rects.forEach((r, i) => {
          const rect = el("div", "occlusion-rect" + (i === ord ? "" : " occlusion-hidden"));
          rect.style.left = r.x + "%";
          rect.style.top = r.y + "%";
          rect.style.width = r.w + "%";
          rect.style.height = r.h + "%";
          stage.appendChild(rect);
        });
      }
      toggleBtn.textContent = showingAnswer ? "显示题目" : "显示答案";
    };
    const toggleBtn = el("button", "btn btn-outline btn-sm", "显示答案");
    toggleBtn.onclick = () => {
      showingAnswer = !showingAnswer;
      render();
    };
    render();
    card.appendChild(stage);
    const actions = el("div", "run-row");
    actions.appendChild(toggleBtn);
    card.appendChild(actions);
    card.appendChild(el("div", "rc-back", escapeHtml(c.back)));
  } else {
    card.appendChild(el("div", "rc-front", escapeHtml(clozeShown || c.front)));
    card.appendChild(el("div", "rc-back", escapeHtml(c.back)));
  }
  if (c.mnemonic) card.appendChild(el("div", "rc-notes", `助记：${escapeHtml(c.mnemonic)}`));
  if (c.ruleNotes) card.appendChild(el("div", "rc-notes mono", escapeHtml([].concat(c.ruleNotes).join(" · "))));
  if (c.warnings) card.appendChild(el("div", "rc-notes", `⚠ ${escapeHtml([].concat(c.warnings).join("；"))}`));
  card.appendChild(
    lintIssues.length
      ? el("div", "lint-list", lintIssues.map((it) => `<span class="lint lint-${it.severity}">${it.ruleId} ${escapeHtml(it.message)}</span>`).join(""))
      : el("div", "lint-list", '<span class="lint lint-info">Lint 通过（0 问题）</span>')
  );
  return card;
}

function appendCards(cards, isSupplement) {
  const box = $("results");
  for (const c of cards) {
    benchCards.push(c);
    box.appendChild(cardEl(c, isSupplement));
  }
}

// 知识点区：解析「后续可补」注记，逐项渲染「询问 AI 相关内容」「直接制卡」
function appendKnowledgePoints(parsed) {
  const box = $("results");
  const kps = parsed.knowledgePoints || [];
  const groups = lib.parseFollowUps ? lib.parseFollowUps(kps) : [];
  if (!groups.length) {
    box.appendChild(el("div", "meta-block", `知识点：${kps.map((k) => escapeHtml(k.summary)).join("；") || "（无）"}`));
    return;
  }
  const wrap = el("div", "block-reasons kp-block");
  wrap.appendChild(el("div", "", "<b>知识点与后续可补</b>（点击按钮针对该方向递进补卡）"));
  for (const g of groups) {
    const row = el("div", "kp-group");
    row.appendChild(el("div", "kp-title", escapeHtml(g.kpTitle)));
    for (const item of g.items) {
      const itemRow = el("div", "kp-item");
      itemRow.appendChild(el("span", "kp-item-text", escapeHtml(item)));
      const askBtn = el("button", "btn btn-outline btn-sm", "询问 AI 相关内容");
      askBtn.onclick = () => benchExploration(item, g.kpTitle, askBtn);
      const makeBtn = el("button", "btn btn-outline btn-sm", "直接制卡");
      makeBtn.onclick = () => benchFollowUp(item, g.kpTitle, null, makeBtn);
      itemRow.appendChild(askBtn);
      itemRow.appendChild(makeBtn);
      row.appendChild(itemRow);
    }
    wrap.appendChild(row);
  }
  box.appendChild(wrap);
}

// 遮挡卡富化（与主软件 generateOcclusionCards 同构）：把 regions 规范化后挂到每张
// imageOcclusion 草稿的 occlusion 字段（坐标钳制 0-100、w/h 下限 1，防模型越界）
function enrichOcclusion(parsed) {
  const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const regions = (parsed.regions || []).map((r, i) => {
    const x = clampPct(r.x);
    const y = clampPct(r.y);
    const w = Math.max(1, Math.min(100 - x, clampPct(r.w)));
    const h = Math.max(1, Math.min(100 - y, clampPct(r.h)));
    return {
      ord: Number.isFinite(Number(r.ord)) ? Math.max(0, Math.round(Number(r.ord))) : i,
      label: String(r.label || ""),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      w: Math.round(w * 10) / 10,
      h: Math.round(h * 10) / 10
    };
  });
  for (const c of parsed.cards || []) {
    if (c.cardType === "imageOcclusion") {
      const ord = c.ord ?? 0;
      c.occlusion = {
        ord,
        rects: regions.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, ord: r.ord })),
        label: (regions.find((r) => r.ord === ord) || {}).label
      };
    }
  }
}

function renderResult(raw, scope) {
  let parsed;
  try {
    parsed = lib.extractJson ? lib.extractJson(raw) : manualExtract(raw);
  } catch (err) {
    showError(`JSON 解析失败：${err.message}`);
    return;
  }
  enrichOcclusion(parsed);
  lastRun = { parsed, scope, text: $("materialText").value.trim(), source: $("sourceTitle").value.trim(), image };
  benchCards = [];
  const box = $("results");
  box.innerHTML = "";
  $("explorations").innerHTML = "";

  if (parsed.blockReasons && parsed.blockReasons.length) {
    box.appendChild(
      el("div", "block-reasons", `触发「不理解不学」，建议先补前置：<ul>${parsed.blockReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`)
    );
  }
  if (parsed.regions && parsed.regions.length) {
    box.appendChild(
      el("div", "meta-block", `遮挡区域 ${parsed.regions.length} 个：${parsed.regions.map((r) => `#${(r.ord ?? 0) + 1}「${escapeHtml(r.label)}」(${r.x},${r.y},${r.w}×${r.h})`).join("；")}`)
    );
  }
  appendKnowledgePoints(parsed);

  const cards = parsed.cards || [];
  if (!cards.length) box.appendChild(el("div", "meta-block", "无卡片输出。"));
  appendCards(cards, false);
}

// 「询问 AI 相关内容」：解释块追加在结果最下方，末尾带「直接制卡」
async function benchExploration(item, kpTitle, askBtn) {
  if (!lastRun) return;
  askBtn.disabled = true;
  const cont = $("explorations");
  const block = el("div", "result-card");
  block.appendChild(el("div", "rc-notes mono", `问（${escapeHtml(item)}）：就知识点「${escapeHtml(kpTitle)}」解释「${escapeHtml(item)}」相关的具体内容`));
  const statusEl = el("div", "rc-notes mono status-line", "等待模型… 0 秒");
  block.appendChild(statusEl);
  cont.appendChild(block);
  cont.scrollIntoView({ behavior: "smooth", block: "end" });
  const startedAt = Date.now();
  const tick = window.setInterval(() => {
    statusEl.textContent = `等待模型… ${Math.round((Date.now() - startedAt) / 1000)} 秒（推理模型约需 0.5-1 分钟）`;
  }, 500);
  try {
    const tpl = await window.labAPI.getPrompt("reader-explain");
    const question = `就这段文字中的知识点「${kpTitle}」，请解释与「${item}」直接相关的具体内容：若是原因/例子/联系类方向，给出可直接用于制卡的实质内容；若是某个出处、概念或典故，请解释它本身并说明与本段文字的联系。`;
    const messages = [
      { role: "system", content: tpl ? tpl.content : "你是阅读助手。" },
      { role: "user", content: `【选中文本】\n${lastRun.text}${lastRun.source ? `\n\n【上下文】${lastRun.source}` : ""}\n\n【用户追问】${question}` }
    ];
    const answer = await chatStreamLocal(messages, 0.7, () => {});
    window.clearInterval(tick);
    statusEl.remove();
    block.appendChild(el("div", "rc-back", escapeHtml(answer)));
    const actions = el("div", "run-row");
    const makeBtn = el("button", "btn btn-primary btn-sm", "直接制卡");
    makeBtn.onclick = () => benchFollowUp(item, kpTitle, answer, makeBtn);
    actions.appendChild(makeBtn);
    block.appendChild(actions);
  } catch (err) {
    window.clearInterval(tick);
    statusEl.textContent = "出错：" + (err.message || String(err));
  } finally {
    askBtn.disabled = false;
  }
}

// 「直接制卡」：原选文 +【本次制卡重点】+ 已有卡（防重复），新卡追加到卡片清单末尾
async function benchFollowUp(item, kpTitle, hint, btn) {
  if (!lastRun) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "补充制卡中…";
  try {
    const tpl = await window.labAPI.getPrompt(lastRun.scope);
    if (!tpl) throw new Error(`提示词模板缺失：${lastRun.scope}`);
    const focus = [
      `这是对同一段材料的补充制卡。知识点「${kpTitle}」的补充方向：「${item}」。`,
      "请只产 1-3 张该方向的补充卡，禁止与已有卡重复或换皮。",
      hint ? `可参考以下解释作为卡面素材（提炼为短答案，禁止照抄长句）：\n${hint.slice(0, 400)}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    const existing = benchCards.map((c) => c.front || c.cloze || "").filter(Boolean).slice(0, 10);
    const userMsg = [
      `【材料】\n${lastRun.text}`,
      lastRun.source ? `【来源】《${lastRun.source}》` : "",
      `【本次制卡重点（补充制卡）】\n${focus}`,
      existing.length ? `【用户已有卡片（注意 R10 联想与干扰提示，禁止重复或换皮）】\n${existing.join("\n")}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    setStatus("补充制卡中…");
    const raw = await chatStreamLocal(
      [{ role: "system", content: tpl.content }, { role: "user", content: userMsg }],
      0.4,
      () => {}
    );
    const parsed = lib.extractJson ? lib.extractJson(raw) : manualExtract(raw);
    const newCards = parsed.cards || [];
    if (!newCards.length) {
      setStatus("补充制卡完成，但未产出新卡");
    } else {
      appendCards(newCards, true);
      setStatus(`补充完成 · 新增 ${newCards.length} 张（已追加到清单末尾）`);
    }
    btn.disabled = false;
    btn.textContent = "再补一轮";
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalText;
    showError(err.message || String(err));
  }
}

function manualExtract(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效 JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed.cards)) throw new Error("AI 返回缺少 cards 数组");
  return parsed;
}

function showError(msg) {
  const el = $("errorLine");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function hideError() {
  $("errorLine").classList.add("hidden");
}

init();
