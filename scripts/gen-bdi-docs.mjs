#!/usr/bin/env node
// BDI（D248）：从 electron/behavior/registry.js / metrics.js / signals.js 生成两份合同文档。
// 用法：node scripts/gen-bdi-docs.mjs   （生成后提交；tests/behavior-catalog-docs.test.cjs 校验逐字一致）
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const OUT_CATALOG = path.join(ROOT, "docs", "bdi-catalog.md");
const OUT_METRICS = path.join(ROOT, "docs", "bdi-metrics.md");

const cell = (v) => String(v).replace(/\|/g, "\\|");

export function buildCatalogDoc() {
  const reg = require(path.join(ROOT, "electron", "behavior", "registry.js"));
  const rows = reg.catalog();
  const lines = [];
  lines.push("# BDI 事件目录（D248）");
  lines.push("");
  lines.push(`> 由 \`electron/behavior/registry.js\` 生成（\`node scripts/gen-bdi-docs.mjs\`），**禁止手改**。CATALOG_VERSION = ${reg.CATALOG_VERSION}。`);
  lines.push("> 唯一实现依据：`docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md` §6 / §5.2。与注册表不一致时 `behavior-catalog-docs` 测试失败。");
  lines.push(">");
  lines.push("> 命名 `组.动作`。采集：**M**=主进程 tap；**R**=渲染层 `track()`；**B**=eventBus 桥；**W**=host 内部。每个事件在 `registry.js` 登记 `owner` / `props` / `allowText` / `maxPerMin` / `intentOnly`。`intentOnly` 事件只记意图，不计产出。");
  lines.push(">");
  lines.push("> 每个事件都带公共列：`ts / recv_ts / source_ts / day / tz_name / tz_offset / cutoff_hour / clock_flags / type / v / src / render_id / window_id / session_id / ctx_id / presentation_id / op_id / actor / surface / origin / entity_type / entity_id / library_item_id / card_id / extract_id / kp_id / doc_pos / dur_ms / num / text / props`（见设计稿 §5.2）；下表只列事件特有的关键字段 / props。");
  lines.push("");
  for (const section of reg.SECTIONS) {
    lines.push(`## ${section.id} ${section.title}`);
    lines.push("");
    lines.push("| 事件 | 采集 | 关键字段 / props |");
    lines.push("| --- | --- | --- |");
    for (const r of rows.filter((x) => x.section === section.id)) {
      lines.push(`| \`${r.type}\` | ${cell(r.owner)} | ${cell(r.doc)} |`);
    }
    lines.push("");
  }
  lines.push("## 6.8 明确不采集");
  lines.push("");
  lines.push("鼠标坐标与轨迹、按键值（只计次数）、剪贴板、任何正文（材料/摘录/卡片/批注/日记/AI 对话）、材料与卡片标题、文件路径、窗口标题、其他应用信息、网络请求内容、API Key/URL。");
  lines.push("");
  lines.push("## 6.9 采集责任（防重复）");
  lines.push("");
  lines.push("- **持久化成功由 M 记**；R/B 只记「点击/发起/显示」。同一动作不得两个 owner 都算成功。");
  lines.push("- `ai.invoked` 只表示一次 AI 调用完成；`ai_batch.resolved` 表示批次状态改变；`card.created` 表示落库。三者可组合，但不把 100 张自动生成卡算成 100 次主动创作。");
  lines.push("- `dict.lookup` 与 `learning_events.dict_lookup`：前者是 BDI 行为记录（无正文），后者是学习者模型真源（有正文）；查询层按用途分开，不做计数合并。");
  lines.push("- `learner.exercise` 只从 `learner:logEvent` 投影 `kind/outcome`，不读 payload；`learning_events` 仍是真源。");
  lines.push("- `review.rated` 不存 rating；rating 从 `review_logs` 读。");
  lines.push("- `reader.finished` 是「到达末尾代理指标」，不是「已读完/已理解」。");
  lines.push("- `ipc_daily` 是诊断计数，不是用户学习次数；不得当行为指标。");
  lines.push("");
  lines.push("## 6.10 通道覆盖");
  lines.push("");
  lines.push("- `tests/behavior-coverage.test.cjs` 扫描 `electron/**/*.js` 的 `ipcMain.handle/on` 通道，与 `taps.js` + `ipcStats` 的显式登记表比对。");
  lines.push("- 每个写通道必须二选一：登记事件映射，或带理由只计数（如 `reading:event` 真源是 `reading_events`、`library:updateProgress` 真源是 `progress_json`、`cards:persistNow` 纯重试）。");
  lines.push("- 未登记写通道 → 测试失败；新增通道先改 `taps.js` 与本文，再实现。");
  lines.push("");
  return lines.join("\n");
}

export function buildMetricsDoc() {
  const met = require(path.join(ROOT, "electron", "behavior", "metrics.js"));
  const sig = require(path.join(ROOT, "electron", "behavior", "signals.js"));
  const lines = [];
  lines.push("# BDI 指标与信号注册表（D248）");
  lines.push("");
  lines.push(`> 由 \`electron/behavior/metrics.js\` / \`signals.js\` 生成（\`node scripts/gen-bdi-docs.mjs\`），**禁止手改**。METRICS_VERSION = ${met.METRICS_VERSION} / SIGNALS_VERSION = ${sig.SIGNALS_VERSION}。`);
  lines.push("> 唯一实现依据：`docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md` §9 / §10。与注册表不一致时 `behavior-catalog-docs` 测试失败。");
  lines.push("");
  lines.push("## 指标注册（`metrics.js`）");
  lines.push("");
  lines.push("每个指标必填：`id / unit / grain / source / coverageKey / definition / nullPolicy / estimatePolicy / additivity / version`。所有 `daily_metrics.metric`、`domain_day` 列、`signal_daily.signal_id` 都有唯一条目；维度/主键不是指标。常量与阈值是产品假设，版本化，调用方不得偷偷改。");
  lines.push("");
  lines.push("| 指标 | 单位 | 粒度 | 真源 | 覆盖键 | 定义 | 空值策略 | 估计策略 | 可加性 | 版本 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of met.METRICS) {
    lines.push(`| \`${cell(m.id)}\` | ${cell(m.unit)} | ${cell(m.grain)} | ${cell(m.source)} | ${cell(m.coverageKey)} | ${cell(m.definition)} | ${cell(m.nullPolicy)} | ${cell(m.estimatePolicy)} | ${cell(m.additivity)} | ${m.version} |`);
  }
  lines.push("");
  lines.push("### `domain_day` 列（同一层日事实的唯一名称）");
  lines.push("");
  lines.push("| 列 | 单位 |");
  lines.push("| --- | --- |");
  for (const c of met.DOMAIN_COLUMNS) lines.push(`| \`${c.column}\` | ${cell(c.unit)} |`);
  lines.push("");
  lines.push("## 日事实口径（`rollup.js`）");
  lines.push("");
  lines.push("- 时间唯一来自规范化 attention；按 surface 分 read/review/xreview/author/browse/other，各桶和 = active。");
  lines.push("- `self/pushed/neutral` 分开，三者之和 = active（浮点容差）。");
  lines.push("- 评分和 `answer_ms` 来自 `review_logs`，按领域权重 `w` 分配 `answer_ms`；计数只计主领域（整数），不把加权小数塞进 `n_reviews`。");
  lines.push("- `review.think_ms` 来自 `review.revealed`；`n_reviews/n_again/...` 来自 `review_logs` 主领域。");
  lines.push("- live 创建/批注动作来自成功事件，按实体/生命周期/opId 去重；同一个 highlight/extract 的保存不能经两个 owner 算两次。");
  lines.push("- AI 保留卡数是实体产出量，不等于投入；必须明确用户接纳且 120s 误操作窗口已过才称 `ai_kept`，否则 pending/unknown。批量自动生成没有用户确认不能触发 `engaged`。");
  lines.push("- `n_items` 是 distinct 材料数，不可跨领域相加；父级 distinct 重新求集合。");
  lines.push("- 空值传播：无支持/未覆盖=NULL；完整覆盖下确实无动作=0；除数 0→NULL，不返回 Infinity/NaN。");
  lines.push("- 增量结果必须与「清空后全量重建」逐键一致（浮点容差 1e-9），归档日除外。");
  lines.push("");
  lines.push("## 覆盖语义（`coverage.js`）");
  lines.push("");
  lines.push("`capture_intervals.state` ∈ `enabled/disabled/fault/suspend`；能力起点来自首次启用成功时刻，不是第一次事件 `first_seen`。");
  lines.push("");
  lines.push("`coverage_day.state` ∈ `complete/partial/unknown/unsupported/archived`：");
  lines.push("");
  lines.push("- 对某学习日，若该指标采集能力在该日所有应用运行时段已启用、版本支持、无未恢复队列损失/重载/时钟缺口 → `complete`。");
  lines.push("- 应用没有运行不等于没在别处学习；本产品的 0 只表示「本应用内无已知动作」，查询返回必须带这句话。");
  lines.push("- 首次部署前、禁用期、未洁退出尾部、worker/DB 不可用、丢包 → `partial`/`unknown`。");
  lines.push("- 已验证充分证据可把 `engaged` 置 1，即使同日其他时段缺失；没有足量证据时，只有 `complete` 才能判 0，其余 NULL。");
  lines.push("- 查询窗口不悄悄裁掉缺失日后仍称完整 28 天：返回 `requestedWindow/observedWindow/knownDays/unknownDays/estimateDays` 及原因。");
  lines.push("");
  lines.push("## 信号注册（`signals.js`）");
  lines.push("");
  lines.push("信号 = 某类可观测行为 × 过滤条件 × 数值函数 × 极性 × 单位。只负责「把行为翻译成按领域、按日的强度原料」，权重由将来功能决定。");
  lines.push("");
  lines.push("| id | 真源与过滤 | 单位/注意 | 极性 |");
  lines.push("| --- | --- | --- | --- |");
  for (const s of sig.SIGNALS) lines.push(`| \`${cell(s.id)}\` | ${cell(s.doc)} | ${cell(`${s.unit}；${s.note}`)} | ${s.polarity > 0 ? "+1" : "-1"} |`);
  lines.push("");
  lines.push("## 衰减与组合（本期只交原料）");
  lines.push("");
  lines.push("按学习日衰减：`decayed = Σ value_day × 0.5^(calendarAge/halfLifeDays)`，`halfLifeDays ∈ [1,365]`；未来日/负 age 异常不入默认统计。raw/decayed 保留单位，分钟和次数不能直接相加。");
  lines.push("");
  lines.push("未来消费者如要组合，必须显式提交版本化权重、单位归一、日/op 封顶策略：`score_signed = Σ polarity_s × weight_s × normalized_decayed_s`。**有负值的 signed score 不得直接代入 share 分母**；share 只用于 `p≥0` 的已归一证据，`α=5` 仅是该尺度的平滑强度，prior 在固定域集合上和为 1。本期只交原料，不输出综合兴趣分。");
  lines.push("");
  return lines.join("\n");
}

export function writeDocs() {
  const catalog = buildCatalogDoc();
  const metrics = buildMetricsDoc();
  fs.writeFileSync(OUT_CATALOG, catalog, "utf8");
  fs.writeFileSync(OUT_METRICS, metrics, "utf8");
  return { catalog: Buffer.byteLength(catalog), metrics: Buffer.byteLength(metrics) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = writeDocs();
  console.log(`bdi-docs: catalog ${r.catalog} B → ${path.relative(ROOT, OUT_CATALOG)}`);
  console.log(`bdi-docs: metrics ${r.metrics} B → ${path.relative(ROOT, OUT_METRICS)}`);
}
