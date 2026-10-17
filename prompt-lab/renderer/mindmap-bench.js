// 导图 v2 基准页渲染层（vanilla JS）。所有重逻辑在主进程（mindmapBenchRunner.js），这里只负责展示。
// 安全：模型输出与材料原文一律经 textContent / createElement 写入，不使用 innerHTML。
const $ = (id) => document.getElementById(id);

if (!window.labAPI || !window.labAPI.bench) {
  document.body.textContent = "本页必须在提示词测试台（Electron）里打开：双击根目录「启动提示词测试台.bat」，再点页头的「导图 v2 基准」。";
  throw new Error("labAPI.bench missing");
}
const api = window.labAPI.bench;

const PATTERN_ZH = { tree: "树", chain: "链", timeline: "时间线", layered: "分层", argument: "论证", compare: "对照", grid: "网格" };

let material = null; // { title, chapters:[{title,text}] }；多章（epub）时文本框只读预览
let multi = false;
let runId = null;
let running = false;
let blocks = [];
let rows = new Map(); // path → { data, row, kids:[] }
let selected = null;
let acceptedCount = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtMs = (v) => (v == null ? "—" : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v) => (v == null ? "—" : String(v));
const fmtTime = (ts) => {
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function showError(msg) {
  const e = $("errorLine");
  e.textContent = msg;
  e.classList.toggle("hidden", !msg);
}
function setStatus(msg) { $("statusLine").textContent = msg || ""; }

// ───────── 模型 ─────────
async function refreshModel() {
  try {
    const c = await api.config();
    $("modelLine").textContent = `${c.presetName || c.preset || "?"} · ${c.model || "?"}${c.hasKey ? "" : "（未配置 Key！请先到主窗口「AI 配置」）"}`;
    $("modelLine").style.color = c.hasKey ? "" : "#b91c1c";
  } catch (err) {
    $("modelLine").textContent = "读取失败：" + err.message;
  }
}
$("modelRefresh").onclick = refreshModel;

// ───────── 材料 ─────────
function totalChars(chapters) { return chapters.reduce((n, c) => n + c.text.length, 0); }
function updateMaterialInfo() {
  if (!material) { $("materialInfo").textContent = ""; return; }
  $("materialInfo").textContent = multi
    ? `多章材料：${material.chapters.length} 章，共约 ${totalChars(material.chapters)} 字（下方为预览，只读；点「清空」可改为粘贴）`
    : `单章材料：约 ${totalChars(material.chapters)} 字`;
}
function setMaterial(m) {
  material = m;
  multi = m.chapters.length > 1;
  $("titleInput").value = m.title || "";
  const ta = $("materialText");
  ta.readOnly = multi;
  ta.value = multi
    ? m.chapters.map((c, i) => `【${i + 1}】${c.title}\n${c.text.slice(0, 400)}${c.text.length > 400 ? "…" : ""}`).join("\n\n")
    : m.chapters[0].text;
  updateMaterialInfo();
}
$("materialText").addEventListener("input", () => {
  if (multi) return;
  material = { title: $("titleInput").value, chapters: [{ title: $("titleInput").value || "材料", text: $("materialText").value }] };
  updateMaterialInfo();
});
$("clearBtn").onclick = () => {
  material = null; multi = false;
  $("materialText").value = ""; $("materialText").readOnly = false; $("titleInput").value = "";
  updateMaterialInfo();
};
$("sampleBtn").onclick = async () => {
  try { showError(""); setMaterial(await api.sample()); } catch (err) { showError(err.message); }
};
$("pickBtn").onclick = async () => {
  try {
    showError("");
    const m = await api.pickMaterial();
    if (m) setMaterial(m);
  } catch (err) { showError("载入失败：" + err.message); }
};

// ───────── 运行 ─────────
function setRunning(v) {
  running = v;
  $("runBtn").disabled = v;
  $("cancelBtn").disabled = !v;
}
$("runBtn").onclick = async () => {
  showError("");
  const title = $("titleInput").value.trim();
  let chapters;
  if (multi && material) chapters = material.chapters;
  else {
    const text = $("materialText").value;
    if (!text.trim()) { showError("请先粘贴材料、载入文件或点「载入示例」。"); return; }
    chapters = [{ title: title || "材料", text }];
  }
  setRunning(true);
  setStatus("启动中…");
  try {
    const r = await api.start({ title: title || (material && material.title) || "未命名材料", chapters, concurrency: Number($("concInput").value) });
    runId = r.runId;
  } catch (err) {
    setRunning(false);
    setStatus("");
    showError("启动失败：" + err.message);
  }
};
$("cancelBtn").onclick = () => { if (runId) api.cancel(runId); setStatus("正在取消…"); };

// ───────── 树 ─────────
function lastRow(rec) { return rec.kids.length ? lastRow(rec.kids[rec.kids.length - 1]) : rec.row; }

function renderRow(rec) {
  const d = rec.data, row = rec.row;
  row.textContent = "";
  row.style.paddingLeft = `${4 + (d.depth - 1) * 18}px`;
  row.classList.toggle("chapter", d.source === "local");
  row.append(el("span", "p mono", d.path));
  row.append(el("span", "ty", `[${d.type}]`));
  row.append(el("span", "ti", d.title));
  if (d.time) row.append(el("span", "tm", `〈${d.time}〉`));
  row.append(el("span", "rg mono", `@${d.blockFrom}${d.blockTo !== d.blockFrom ? "-" + d.blockTo : ""}`));
  if (d.source === "local") {
    if (d.badge) row.append(el("span", `badge ${d.badgeCls || ""}`, d.badge));
  } else {
    switch (d.state) {
      case "open": {
        const b = el("button", "plus", "+");
        b.title = "深挖这个节点";
        b.onclick = (ev) => { ev.stopPropagation(); doExpand(d.path); };
        row.append(b);
        break;
      }
      case "expanding": row.append(el("span", "badge run", "深挖中…")); break;
      case "expanded": row.append(el("span", "mk", "已展开")); break;
      case "recheck": row.append(el("span", "mk", "•回判")); break;
      case "floor": row.append(el("span", "mk", "•本地")); break;
      default: row.append(el("span", "mk", "•"));
    }
    if (d.pattern) row.append(el("span", "pt", `{${PATTERN_ZH[d.pattern] || d.pattern}}`));
    (d.rels || []).forEach((r) => {
      const s = el("span", r.late ? "rel late" : "rel", `${r.code}→${r.target}`);
      if (r.late) s.title = "前向引用，目标出现后补上";
      row.append(s);
    });
    if (d.warnings && d.warnings.length) {
      const w = el("span", "warn", "⚠");
      w.title = d.warnings.join("，");
      row.append(w);
    }
  }
  row.classList.toggle("selected", selected === d.path);
}

function addRow(d) {
  const row = el("div", "node");
  const rec = { data: Object.assign({}, d, { rels: (d.rels || []).map((r) => Object.assign({}, r)) }), row, kids: [] };
  rows.set(d.path, rec);
  row.onclick = () => selectNode(d.path);
  const parent = d.parentPath ? rows.get(d.parentPath) : null;
  if (parent) { lastRow(parent).after(row); parent.kids.push(rec); }
  else { $("tree").append(row); }
  renderRow(rec);
  return rec;
}

async function doExpand(path) {
  showError("");
  try {
    const r = await api.expand(runId, path);
    if (r && r.error) showError(`深挖出错（${path}）：${r.error}`);
  } catch (err) { showError("深挖失败：" + err.message); }
}

// ───────── 详情 / explain ─────────
function selectNode(path) {
  const prev = selected && rows.get(selected);
  selected = path;
  if (prev) renderRow(prev);
  const rec = rows.get(path);
  if (!rec) return;
  renderRow(rec);
  const d = rec.data;
  $("detailHead").textContent = `${d.path} [${d.type}] ${d.title}　@${d.blockFrom}-${d.blockTo}`;
  const box = $("detailBlocks");
  box.textContent = "";
  const cap = 60;
  for (let no = d.blockFrom; no <= Math.min(d.blockTo, d.blockFrom + cap - 1); no++) {
    box.append(el("div", "blk", `[${no}] ${blocks[no - 1] || ""}`));
  }
  if (d.blockTo - d.blockFrom + 1 > cap) box.append(el("div", "info-line", `……共 ${d.blockTo - d.blockFrom + 1} 块，仅显示前 ${cap} 块`));
  $("explainOut").textContent = rec.explain || "";
  $("explainBtn").disabled = false;
}
$("explainBtn").onclick = async () => {
  if (!selected || !runId) return;
  const path = selected;
  const rec = rows.get(path);
  rec.explain = "";
  $("explainOut").textContent = "生成中…";
  $("explainBtn").disabled = true;
  try {
    const r = await api.explain(runId, path);
    if (r && r.error) { rec.explain = "（出错）" + r.error; if (selected === path) $("explainOut").textContent = rec.explain; }
  } catch (err) { showError("explain 失败：" + err.message); }
  $("explainBtn").disabled = false;
};

// ───────── 汇总 / 调用表 ─────────
function renderSummary(s, kpi) {
  const box = $("summary");
  box.textContent = "";
  const kv = [
    ["总墙钟（框架）", fmtMs(s.wallMs)], ["全局 TTFN", fmtMs(s.ttfnMs)],
    ["调用数", `${s.calls}（框架 ${s.outlineCalls} / 深挖 ${s.expandCalls} / explain ${s.explainCalls}）`], ["总 token", `${s.totalTokens}（入 ${s.promptTokens} / 出 ${s.completionTokens}）`],
    ["节点数", fmtNum(s.nodes)], ["丢弃行率", `${fmtPct(s.dropRate)}（${s.dropped}/${s.lines} 行）`],
    ["+ 节点占比", fmtPct(s.plusRatio)], ["关系丢弃 / 钳制", `${s.relsDropped} / ${s.clamped}`],
    ["深挖 P50 / P90", `${fmtMs(s.expandP50Ms)} / ${fmtMs(s.expandP90Ms)}`], ["错误调用", fmtNum(s.errors)],
  ];
  for (const [k, v] of kv) { box.append(el("span", "k", k)); box.append(el("span", "v mono", v)); }
  const kb = $("kpi");
  kb.textContent = "";
  for (const k of kpi || []) {
    const mark = k.status === "pass" ? "✓ " : k.status === "fail" ? "✗ " : "– ";
    kb.append(el("div", `kpi-chip ${k.status}`, `${mark}${k.label}：${k.valueText}（目标 ${k.target}${k.status === "na" ? "；暂无数据或口径不适用" : ""}）`));
  }
}

const CALL_HEAD = ["类型", "scope/节点", "字数", "块", "firstByte", "TTFT", "TTFN", "总耗时", "prompt tok", "completion tok", "finish", "行/收/丢", "byReason", "关系丢/钳制", "错误"];
function ensureCallsHead() {
  const t = $("callsTable");
  if (t.firstChild) return;
  const tr = el("tr");
  CALL_HEAD.forEach((h) => tr.append(el("th", null, h)));
  t.append(tr);
}
function addCallRow(r) {
  ensureCallsHead();
  const br = r.byReason ? Object.entries(r.byReason).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ") : "";
  const cells = [
    r.kind, r.key, fmtNum(r.sentChars), fmtNum(r.blocks), fmtMs(r.firstByteMs), fmtMs(r.ttftMs), fmtMs(r.ttfnMs), fmtMs(r.totalMs),
    fmtNum(r.promptTokens), fmtNum(r.completionTokens), r.finishReason || "—",
    r.lines == null ? "—" : `${r.lines}/${r.accepted}/${r.dropped}`, br || "—", r.relsDropped == null ? "—" : `${r.relsDropped}/${r.clamped}`,
  ];
  const tr = el("tr");
  cells.forEach((c) => tr.append(el("td", null, c)));
  tr.append(el("td", r.error ? "err" : null, r.error || ""));
  $("callsTable").append(tr);
}

// ───────── 事件 ─────────
function resetRunView(ev) {
  rows = new Map(); selected = null; blocks = ev.blocks; acceptedCount = 0;
  $("tree").textContent = ""; $("callsTable").textContent = ""; $("summary").textContent = ""; $("kpi").textContent = "";
  $("detailHead").textContent = "未选中节点"; $("detailBlocks").textContent = ""; $("explainOut").textContent = "";
  $("explainBtn").disabled = false;
  ev.scopes.forEach((s) => addRow({ path: s.id, parentPath: null, type: "章", title: s.title, time: null, blockFrom: s.blockFrom, blockTo: s.blockTo, rels: [], source: "local", state: "local", depth: 1, badge: "排队中" }));
}
function setBadge(path, text, cls) {
  const rec = rows.get(path);
  if (!rec) return;
  rec.data.badge = text; rec.data.badgeCls = cls || "";
  renderRow(rec);
}

api.onEvent((ev) => {
  if (ev.t === "warn") { showError(ev.message); return; }
  if (ev.runId && runId && ev.runId !== runId && ev.t !== "run-start") return;
  switch (ev.t) {
    case "run-start":
      runId = ev.runId;
      $("modelLine").textContent = `${ev.model.presetName || ev.model.preset} · ${ev.model.model}`;
      resetRunView(ev);
      setStatus(`运行中：${ev.scopes.length} 个 scope，${ev.blocks.length} 块，并发 ${ev.concurrency}`);
      break;
    case "scope":
      if (ev.status === "running") setBadge(ev.id, "生成中", "run");
      else if (ev.status === "done") setBadge(ev.id, "完成", "");
      else if (ev.status === "cancelled") setBadge(ev.id, "已取消", "err");
      else setBadge(ev.id, `出错：${ev.error || ""}`, "err");
      break;
    case "node":
      acceptedCount++;
      addRow(ev.node);
      if (running) setStatus(`运行中：已接受 ${acceptedCount} 个节点`);
      break;
    case "rel": {
      const rec = rows.get(ev.from);
      if (rec) { rec.data.rels.push({ code: ev.code, target: ev.target, late: true }); renderRow(rec); }
      break;
    }
    case "state": {
      const rec = rows.get(ev.path);
      if (rec) { rec.data.state = ev.state; renderRow(rec); }
      break;
    }
    case "call": addCallRow(ev.record); break;
    case "summary": renderSummary(ev.summary, ev.kpi); break;
    case "run-done":
      setRunning(false);
      setStatus(ev.cancelled ? `已取消（已接受 ${acceptedCount} 个节点）` : `完成，共 ${acceptedCount} 个节点。点 + 可深挖，点节点看原文。`);
      loadHistory();
      break;
    case "explain-start": break;
    case "explain-delta": {
      const rec = rows.get(ev.path);
      if (rec) {
        rec.explain = (rec.explain || "") + ev.delta;
        if (selected === ev.path) $("explainOut").textContent = rec.explain;
      }
      break;
    }
    case "explain-done": loadHistory(); break;
    case "fatal": setRunning(false); showError("运行出错：" + ev.message); break;
    default: break;
  }
});

// ───────── 历史 ─────────
let historyRuns = [];
const HIST_HEAD = ["", "时间", "材料", "模型", "墙钟", "TTFN", "token", "节点", "丢弃率"];
async function loadHistory() {
  try { historyRuns = (await api.history()) || []; } catch (err) { showError("读取历史失败：" + err.message); return; }
  const t = $("historyTable");
  t.textContent = "";
  const hr = el("tr");
  HIST_HEAD.forEach((h) => hr.append(el("th", null, h)));
  t.append(hr);
  for (const r of historyRuns) {
    const s = r.summary || {};
    const tr = el("tr");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.dataset.runId = r.runId;
    const c0 = el("td"); c0.append(cb); tr.append(c0);
    [fmtTime(r.ts), r.material, `${r.preset || ""} ${r.model || ""}`.trim(), fmtMs(s.wallMs), fmtMs(s.ttfnMs), fmtNum(s.totalTokens), fmtNum(s.nodes), fmtPct(s.dropRate)]
      .forEach((v) => tr.append(el("td", null, v)));
    t.append(tr);
  }
  if (!historyRuns.length) {
    const tr = el("tr");
    tr.append(el("td", null, ""));
    tr.append(el("td", null, "还没有历史记录。运行一次后会出现在这里。"));
    t.append(tr);
  }
}
function checkedIds() { return [...document.querySelectorAll("#historyTable input[type=checkbox]:checked")].map((c) => c.dataset.runId); }
$("historyRefresh").onclick = loadHistory;
$("exportBtn").onclick = async () => {
  try {
    const r = await api.exportCsv(checkedIds());
    $("exportInfo").textContent = r ? `已导出 ${r.runs} 次 run / ${r.calls} 条调用：${r.runsPath} 与 ${r.callsPath}` : "";
  } catch (err) { showError("导出失败：" + err.message); }
};
$("compareBtn").onclick = () => {
  const ids = checkedIds();
  const box = $("compareBox");
  box.textContent = "";
  if (ids.length !== 2) { box.append(el("div", "info-line", "请恰好勾选 2 条历史记录再对比。")); return; }
  const [a, b] = ids.map((id) => historyRuns.find((r) => r.runId === id));
  const metrics = [
    ["时间", (r) => fmtTime(r.ts)], ["材料", (r) => r.material], ["字数 / 块 / scope", (r) => `${r.chars} / ${r.blocks} / ${r.scopes}`],
    ["模型", (r) => `${r.preset || ""} ${r.model || ""}`], ["并发", (r) => fmtNum(r.concurrency)],
    ["总墙钟（框架）", (r) => fmtMs(r.summary.wallMs)], ["全局 TTFN", (r) => fmtMs(r.summary.ttfnMs)], ["调用数", (r) => fmtNum(r.summary.calls)],
    ["总 token", (r) => fmtNum(r.summary.totalTokens)], ["completion token", (r) => fmtNum(r.summary.completionTokens)],
    ["节点数", (r) => fmtNum(r.summary.nodes)], ["丢弃行率", (r) => fmtPct(r.summary.dropRate)], ["+ 节点占比", (r) => fmtPct(r.summary.plusRatio)],
    ["深挖 P50 / P90", (r) => `${fmtMs(r.summary.expandP50Ms)} / ${fmtMs(r.summary.expandP90Ms)}`], ["关系丢弃", (r) => fmtNum(r.summary.relsDropped)],
  ];
  const t = el("table", "tbl");
  const h = el("tr");
  ["指标", "A", "B"].forEach((x) => h.append(el("th", null, x)));
  t.append(h);
  for (const [name, fn] of metrics) {
    const tr = el("tr");
    tr.append(el("td", null, name));
    tr.append(el("td", null, a.summary ? fn(a) : "—"));
    tr.append(el("td", null, b.summary ? fn(b) : "—"));
    t.append(tr);
  }
  box.append(t);
};

refreshModel();
loadHistory();
