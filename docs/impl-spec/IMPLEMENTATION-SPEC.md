# Implementation Specification — 全量批次 A–F（一次性交付版）

> **交付对象**：另一个 Coding Agent。本文件 + `docs/impl-spec/BATCH-A-READ-ROBUSTNESS.md`（批次 A 的完整细节与探针）合起来是一份可以直接执行的规格。
> **基线（2026-09-22，用户已批准并执行）**：`main` 已**快进**合并到 `test/flow-coverage`，两分支同处 `c48f0b0`
> （70 个文件 / +16189 行：D51 书架重设计实现、33 条流程与 harness、`docs/test-flows/`、本规格书、UI优化 的文档与样张）。
> 因此**本规格里的文件与行号引用现在在 `main` 上同样成立**（此前 `src/lib/shelf.ts`、`.cap`/`cap-rail` 结构、`tests/flows/` 在 main 上并不存在）。
> **执行方式**：从 `main` 拉一个工作分支（推荐 `fix/read-robustness`）执行本规格；**执行期间 `main` 保持不动**，做完并通过 §统一验收 后再合回。
> **产出方式**：批次化执行、每批一个 commit、每批独立验收；**要么按批全部完成，要么停在批次边界如实报告**——不允许"半批"（改了代码没改断言、或改了断言没跑回归）。
> 所有"现状"结论都由 Principal Architect 在 2026-09-22 通过读实现（带行号）+ 跑探针实测确认；未确认项集中在 §Q。

---

## 0. 执行纪律（先读这一节，违反即视为未完成）

1. **测试义务是硬性的**：本仓库的规矩是「行为变更必须有机检断言守着」。每个批次都给了"必须新增的断言"；缺一条 = 该批次未完成。
2. **`known` 反向报警机制**：本层流程把每个未修缺陷挂成 `flow.known(...)`。缺陷修好后它会变成「意外转绿」，**这是好事**，但必须：把该条 `known(...)` 降级为普通 `check(...)` → 在 `docs/test-flows/DEFECTS.md` 对应行标注「已修复（批次 X）」→ 在 `docs/test-flows/PLAN.md` §5 摘要表同步。**不要留着绿的 known**（下一个人会以为缺陷还在）。
3. **回归命令**：`node tests/flows/run.cjs --hours 0.05 --gap 0`。
   **实测口径（2026-09-22 亲测，非估算）**：这是 3 分钟墙钟预算；一轮 32 条自动流程约 **25 秒**，
   3 分钟能跑满 **8 轮 / 255 次运行**、覆盖全部 **32 条自动流程**——足够当全量回归用，**不需要小时级**。
   流程总数口径：**32 条自动 + `F01`（`@gui:true`，需人工在场）= 33 条**。
   ⚠️ **不要用 `--cycles 1`**——`run.cjs` 的内层 break 会让它只跑第一条流程就收工（实测只跑了 F03）。
4. **`git status` 里 `tests/*.bundle.cjs`、`tests/fsrs/golden.json` 变脏是既有套件的副产物**，不要提交；提交一律用显式路径（别 `git add -A`，也别 `git add .`）。
5. **`main` 在执行期间不许动**（2026-09-22 已批准执行的 `main` 快进是唯一例外，见顶部基线说明）；批次改动全部落在工作分支上。
6. **Windows/Git Bash 写文件**：多行替换用 Edit 工具或 `python -X utf8`，**不要用 shell heredoc 传含反斜杠的代码**（会吞字符，已踩）。`node -e` 里的反引号会被 shell 吃掉，改用文件或 python。
7. **批次 F 是文档批次**：按本项目约定「文档↔代码矛盾时改文档不动代码」，且要**全量收口（bump 版本 + 决策号）**——执行前必须让用户拍板。
8. **不许顺手重构**：只动本规格点名的文件与函数；看到别的可疑代码，写进报告，不要改。

---

## 1. 缺陷总表（本规格的完整工作范围）

| 批次 | 编号 | 一句话 | 严重度 | 现状核实 |
|---|---|---|---|---|
| A | D-TEST-09 | `settings.json` 非对象（`null`）→ 首个读设置的口子就抛，界面全空 | 中 | 探针实测三处崩点 |
| A | D-TEST-06 | 卡片 JSON 列损坏 → 队列/统计/卡片浏览三处全抛（SQL 层 + JS 层两层） | 中高 | F13 P1 实测 |
| A | D-TEST-11 | 分数 `limit`/`offset` 直穿 SQL 抛 `datatype mismatch`；整参 `null` 解构抛错 | 中 | 探针实测 |
| B | D-TEST-21 | 自证不变量被读口破坏：注释写"禁按 reviewed_at 排序"，`listAllReviewLogs` 就按它排 | 低（**影响面已更正**，见 §附录） | 代码逐字核对 |
| B | D-TEST-12 | 阅读历史图恒为 0（桶键 `dayStartMs` vs 桶轴 `now-n·day`） | 中 | 代码 + F19 Z7 |
| B | D-TEST-23 | 阅读字数取数不过滤已删书（与 D-TEST-12 **必须同批**） | 低（潜在） | F31 J5 实测 |
| C | D-TEST-08 | 解密后的明文 apiKey 经 `ai:getConfig` 直达渲染层（违反 §7.5） | 中高（安全红线） | F16 U4 实测 |
| C | D-TEST-01 | 「应用权重」后新配置行只在内存，重启静默回退默认 | 中 | F03 S3/S10 实测 |
| C | D-TEST-17 | 导入原书文件名不净化，`../../settings.json` 可越界写 | 低–中（潜在） | F25 V1/V2/V7 实测 |
| C | D-TEST-18 | 软删书不动 `assets` 行/字节，备份按目录整包带走 → 幽灵资源 | 低 | F25 V6 实测 |
| D | D-TEST-13 | 「输入焦点内绝不劫持」写进注释与指南，`dispatchKey` 里没有实现 | 中（潜在 T1） | F20 W3 双证 |
| D | D-TEST-14 | `eventToCombo({key:""})` 产出残缺串 `"Ctrl+"`，能存进设置且占位 | 低 | F20 W2 实测 |
| D | D-TEST-16 | 书卡图注（书名）在可点节点之外 → 点书名不开书 | 低（可达性） | F01 K4 实测 |
| D | D-TEST-22 | 导入清洗无围栏感知：代码块里的 `<style>` 被整段吃掉 | 中 | F30 S3 实测 |
| D | D-TEST-07 | `createJournalEntry` 不校验 `entry_date`，`"2026-13-45"` 原样入库 | 低–中 | F13 P5 实测 |
| D | D-TEST-19 | 展示函数产出 junk（`dayLabel(Infinity)`→`NaN-NaN`、`pct(NaN)`→`NaN%`、`journalDateLabel("2026-02-30")`→`02-30 周一`） | 低 | F26 P2 实测 |
| D | D-TEST-10 | 搜索不做 NFKC：搜全角 `ＡＢＣ` 命中 0，存量半角命中 5 | 低 | F19 Z4 实测 |
| E | D-TEST-02 | `prompt_templates.is_default` 恒为 1，同 scope 多行同时"默认" | 低 | 播种 INSERT 全部写死 1 |
| E | D-TEST-03 | `memory.enabled` 未布尔归一：手写 `"yes"` 被当开启（consent 纪律） | 低 | F07 D1 实测 |
| E | D-TEST-15 | 写入口零校验一类：15 个函数对幽灵 id 返回真值、三族收幽灵父 id、`createCard({})` 收空白卡 | 中低 | F32 全量清点 |
| F | D-DOC-01…09 + 2 条 | 文档↔代码漂移（重复行、7.6 整节重复、表数量、通道名、悬空章节引用、已废除字段、未登记旋钮、M4 键位表） | — | F11/F18/F20 闸门 |
| — | D-TEST-04 / 05 / 20 | 观察项 / 已撤销 ×2：**明确不修**，见 §非目标 | — | 复核已确认撤销成立 |

---

## 2. 通用约定（每批都适用）

- **不能改的东西**：`CREATE TABLE` / 任何 migration（批次 E 的 D-TEST-02 除外，它是幂等数据订正，需用户确认）；IPC 通道名与形状（除批次 C 的 D-TEST-08 明确收窄返回体）；`persist()` 的原子写实现；渲染层的非本批组件。
- **测试夹具要往磁盘上打**：构造坏数据用 `tests/flows/lib/dbenv.cjs` 的 `audit()`（只读句柄的 `exec` 写库），不要用产品 API（产品 API 写不出坏 JSON）。
- **新增断言一律不挂 `known`**（它们应当从第一天起就是绿的）。
- **只读路径不得写盘**：任何"读"的改动都要保住 F19 Z5 的「文件大小 + mtime 双证」不变量。
- **报告义务**：每批结束时按 §统一验收 输出：改了哪些文件、跑了什么命令、结果数字、哪些 `known` 转绿并已降级、有无新增判红。

---

## 批次 A — 读侧边界防御（D-TEST-09 / D-TEST-06 / D-TEST-11）

**完整细节见 [`BATCH-A-READ-ROBUSTNESS.md`](BATCH-A-READ-ROBUSTNESS.md)**（含 7 个 Step 的可照抄代码、实测证据表、5 条必补断言、验收与风险）。要点复述：

- A1（D-TEST-09）：`settingsStore.js:8-14` 与 `main.js:100-105` **两份** `readSettings` 都要保证返回值恒为普通对象（非对象/数组回落空对象；各自保留原有 fallback 形状）。**不做自愈写回**。
- A2（D-TEST-06）：**两层都要修**——SQL 层的 3 处 `json_extract`（`db.js:1286`/`:1322`/`:2188`）用 `CASE WHEN json_valid(...) THEN json_extract(...) END` 包住（实测 sql.js 支持且 CASE 惰性）；JS 层 `mapCardRow`（`db.js:1052-1085`）9 个裸 `JSON.parse` 走统一 `j(text, fallback, col)` 助手并产出 `damaged` / `damagedColumns`。口径：**只有 `fsrs_json` / `leech_json` 损坏才算 damaged**（依据 `db.js:2051` 注释原文），damaged 行从 `computeTodayQueue` 与 `getStatsOverview` 一致缺席、在 `getCard`/`listAllCards` 保留（用户有出口），并在 `computeTodayQueue().damaged` 里可见。
- A3（D-TEST-11）：新增 `clampLimit(limit, def, cap)` / `clampOffset(offset)`（补 `Math.floor`，其余语义照旧 `Number(x) || DEF`），替换 9 族（`db.js:2360/2371/2460/2591/2761/2862/3617/3720/3883`）；9 个函数签名 `({…} = {})` → `(opts)` + `opts ?? {}`。

**批次 A 的 known 降级清单**：`f13` 三条（队列/统计/卡片浏览 不抛）、`f19` 两条（分数 limit 归一 / 显式 null 等同未传）、`f18` 的 `Y3`/`Y7`（切回分支后 grep `known(` 逐条确认）。

---

## 批次 B — 数据真相与读数口径（D-TEST-21 / D-TEST-12 + D-TEST-23）

> D-TEST-12 与 D-TEST-23 **必须同批改**：只修日桶不改过滤，已删书的字节会立刻开始计入成长面板；只加过滤不修日桶，那张图仍然恒为 0（互相掩盖）。

### B1 — 排序不变量（D-TEST-21）

**现状**（逐字核对过）：

```js
// db.js:1487-1491
// v12：优化器读取全部复习日志（按时间升序）；v23 附带参数归属与插入序（audit/测试用）
function listAllReviewLogs() {
  const rows = queryAll("SELECT card_id AS cardId, rating, reviewed_at AS reviewedAt, fsrs_config_id AS fsrsConfigId, review_seq AS reviewSeq FROM review_logs ORDER BY reviewed_at ASC");
  return rows;
}
// db.js:1403-1405（不变量声明就在同一个文件里）
// v23 起排序不变量 = review_seq（表内唯一、插入序单调；禁按 id/reviewed_at 排序）；
```

**改什么**：`ORDER BY review_seq ASC`（该列已 SELECT 出来，调用方零改动）。

**不变量**：清单顺序 = 插入序；时钟被改（NTP 校时/改时区/恢复旧备份）不得改变清单顺序。
**陷阱**：`optimizer.js:22-33` 读这个清单后**自己按 `reviewedAt` 重排**（`:33`），改这里不影响它，但**不要顺手改它**（那是另一个议题）。
**必须新增断言**：`f29` 的"时钟倒退"夹具下，清单顺序与插入序一致（该夹具已存在，把断言从 known 提为硬断言）。
**known 降级**：`f29` 的 T2（静态禁令扫描）/T3/T4。

### B2 — 阅读历史日桶 + 已删书过滤（D-TEST-12 + D-TEST-23）

**现状**（`db.js:2240-2253`，逐字）：

```js
  // ---- 阅读字数（近 45 天，相邻正增量之和）----
  const readFrom = now - 45 * 86400_000;
  const readRows = queryAll("SELECT item_id, char_pos, created_at FROM reading_events WHERE created_at >= ? ORDER BY created_at ASC", [readFrom]);
  const readByDay = {};
  const lastPos = {};
  for (const r of readRows) {
    const k = dayStartMs(r.created_at);          // 桶键：日切点对齐
    const prev = lastPos[r.item_id] ?? r.char_pos;
    const delta = r.char_pos - prev;
    if (delta > 0) readByDay[k] = (readByDay[k] || 0) + delta;
    lastPos[r.item_id] = r.char_pos;
  }
  const readingDays = [];
  for (let d = readFrom; d <= today0; d += 86400_000) readingDays.push({ date: d, chars: readByDay[d] || 0 });   // 桶轴：now-n·day（带毫秒）→ 恒取不到
```

**改什么**（一个改动同时收两条缺陷）：

```js
  // ---- 阅读字数（近 45 天，相邻正增量之和；只统计未删书）----
  const readFrom = today0 - 45 * 86400_000;   // 日切点对齐：与 dayStartMs() 同一坐标系
  const readRows = queryAll(
    `SELECT re.item_id, re.char_pos, re.created_at FROM reading_events re
     JOIN library_items li ON li.id = re.item_id AND li.is_deleted = 0
     WHERE re.created_at >= ? ORDER BY re.created_at ASC`,
    [readFrom]
  );
```

**不变量**：
1. `readingDays[i].date` 都是日切点（与 `dayStartMs` 同坐标系），两次调用逐值相同（消除"两次读数 `date` 差 1ms"）。
2. 桶数**固定**（不再随调用时刻在 45/46 间跳）。`today0 - 45*86400_000` 到 `today0` 共 **46** 个桶（含今日）；若要恰好 45 个桶用 `today0 - 44*86400_000`——**这是产品口径选择，默认取 46**（改动最小、语义"近 45 天含今日"），并在提交信息里写明。
3. `reading_events` 表**没有 `is_deleted` 列**（建表 `db.js:181-186`），所以必须 JOIN 父表 `library_items`；**绝不能写 `re.is_deleted = 0`**（会 `no such column` 当场崩）。
4. 删书后：该书的历史字节不再进入 `readingDays`。

**必须新增断言**：`f19` Z7 从 known 提为硬断言（推进 N 字后 `readingDays` 合计 > 0 且落在**今日桶**）；`f31` J5 增加"删书后该书字节从 readingDays 消失"。
**known 降级**（**三条**，缺一条就会触发「意外转绿」不洁报警）：`f19` Z7（`:309`「当日阅读的 500 字必须出现在阅读历史里」，D-TEST-12）、
`f31` 的 `:286-292`（「阅读字数的取数集合里不得有已删书的事件」，D-TEST-23）、**`f23` 的 `:174`**（「书读过（进度>0）时仪表盘今日字数必须跟着非零」，D-TEST-12）。
⚠️ 第三条容易漏：它在 `f23` 里，**属于本批次**（日桶修复的连带），不要错记到批次 E。
**回归风险**：`src/components/dashboard/widgets.tsx:275-276` 消费 `readingDays`（`charts/swiss.tsx:873` 有 `tail.every(d => d.chars === 0)` 的空态判定）——图从恒空变为有数据是**预期变化**，但要确认 F28 X2（KPI 与自算 oracle）仍逐值一致。

---

## 批次 C — 安全与写入边界（D-TEST-08 / D-TEST-01 / D-TEST-17 / D-TEST-18）

### C1 — 明文 API Key 不下渲染层（D-TEST-08）

**现状**：
- `electron/ai.js:79-95` `getAIConfig()` 返回体里带明文 `apiKey`（解密在 82-88）；**同一文件 `:152-153` 已有"剥 Key"的先例**：`const { apiKey, ...safe } = getAIConfig(); return safe;`（那是 `setAIConfig` 的返回）。
- `electron/main.js:559` `ipcMain.handle("ai:getConfig", () => getAIConfig());` ← 唯一的泄露口。
- `electron/preload.js:173` `getConfig: () => ipcRenderer.invoke("ai:getConfig")`。
- 渲染层只有 `SettingsPanel.tsx` 用 `apiKey`：本地态 `:140`，输入框 `:400-405`，写路径 `:184-188` —— 已经是「**留空则不改、填入才覆盖**」（`if (apiKey.trim()) await save({ apiKey: … })`），所以**渲染层不需要拿回明文 Key**。

**改什么**（一行）：`main.js:559` 改成剥 Key 后再返回：

```js
ipcMain.handle("ai:getConfig", () => {
  const { apiKey, ...safe } = getAIConfig();   // §7.5：渲染层不持有明文 Key（流式转发在主进程）
  return safe;
});
```

**必须做的扫描**：`grep -n "apiKey" electron/*.js`，确认**没有任何其它 IPC 返回体**带明文 Key（`ai:test` / `ai:listModels` / `ai:chat` 逐个看；`ai:chat` 只转发 messages，已核对无 Key）。`ai.js` 内部（`chatStreamOnce` 等）继续用完整 `getAIConfig()`，**不要动**。
**不变量**：渲染层拿不到明文 Key；`hasKey` / `preset` / `baseUrl` / `model` 照旧；设置页「留空不改」语义不变；`ai:setConfig` 返回体继续剥 Key。
**必须新增断言**：`f16` U4 从 known 提为硬断言（`ai:getConfig` 的返回体里 `apiKey === undefined` 且 `hasKey` 为布尔）。
**known 降级**：`f16` U4。

### C2 — FSRS 参数环境落盘（D-TEST-01）

**现状**：`db.js:737-747 insertFsrsConfig` 只 `db.run(INSERT)`，**无 persist**；`db.js:750-757 setActiveFsrsConfig` 只写 settings.json；`optimizer.js:114-119 applyWeights = insertFsrsConfig + setActiveFsrsConfig`，**两处都不落盘**。

**改什么**（选 B 方案，理由见下）：**在 `optimizer.js` 的两个函数里补落盘**：

```js
// optimizer.js applyWeights（:114-119）
function applyWeights(db, weights) {
  const w = validateWeights(weights);
  const configId = db.insertFsrsConfig(w, DEFAULT_SCHEDULER_OPTIONS, "optimizer");
  db.setActiveFsrsConfig(configId);
  db.persistNow();          // 指针与内容必须同生共死（§7.2 L874 每次落库即落盘 / §4.4.10）
  return { ok: true, configId };
}
// resetWeights（:122-125）同理：移动指针后 persistNow()
```

**为什么不选"在 `insertFsrsConfig` 里补 `persist()`"**：`db.js:308` 的 initDb 迁移块也调用它，而 initDb 的落盘时机在末尾（`db.js:676`）——在迁移途中提前 persist 会动到还没就绪的落盘路径。改 optimizer 层风险最小、且 `persistNow()` 是显式落盘（比 `persist()` 更符合"立刻落盘"的语义）。

**必须验证**：`persistNow` 在 `db` 导出里存在（`db.js` 导出表里已有，flows 大量使用）；`resetWeights` 的调用点（`main.js:456-460`）也会跟着落盘。
**不变量**：应用权重成功后立刻重启，`getActiveFsrsConfig()` 仍返回新行；指纹去重早退路径（已有同配置）不产生多余落盘（`insertFsrsConfig` 未改）。
**必须新增断言**：`f15` 增一条幂等断言（连续两次 `applyWeights` 同一权重集合不产生第二行、且第二次不报错）。
**known 降级**：`f03` 的 S10 两条（`:326`「新配置行当场落盘」/ `:336`「重启后仍在用刚应用的优化参数」）降级为 `check`。

⚠️ **S3 那一格不能降级**：`f03:155` 的 S3 矩阵是**直接调 `insertFsrsConfig`** 验证"全部写库函数即时落盘"的，
而 B 方案**故意不改 `insertFsrsConfig`**（落盘责任放在 optimizer 边界）——所以这条 known 修完**仍然是红的**，
降级它 = 制造新增判红。正确做法：照 `f03` 里「日记草稿的防抖例外必须**确实**是例外」的既有格式，
把 `insertFsrsConfig` 从 `notFlushed` 判据里移出、**登记为显式例外**：

```js
// 判据从 notFlushed.length === 0 改为：除已登记的落盘例外外，其余必须全部即时落盘
const EXEMPT = /^insertFsrsConfig/;   // 例外：唯一生产调用方 optimizer / initDb 迁移各自在边界落盘（见 optimizer.js applyWeights/resetWeights）
flow.known("全部写库函数即时落盘（日记防抖 + insertFsrsConfig 两条例外不在本表）", notFlushed.filter((l) => !EXEMPT.test(l)).length === 0, "D-TEST-01", "除例外外全部落盘", notFlushed);
```

### C3 — 原书文件名净化（D-TEST-17）

**现状**：`db.js:950` `fs.writeFileSync(path.join(dir, originalName), originalBuf);` —— 不净化；同函数 5 行后的内嵌图（`:956`）却有 `if (!/^[\w.-]+$/.test(String(im.filename))) continue;`。六个调用点（`main.js:208/226/243/293/311/362`）当前全传硬编码名，所以**没有活路径**，属 API 层缺口。

**改什么**：在 sink 侧收（不要指望调用方）：

```js
// db.js：加一个内部助手
function safeAssetFileName(name, fallback) {
  const base = String(name || "").split(/[\\/]/).pop().replace(/[^\w.()-]/g, "_");
  return base && !/^\.+$/.test(base) ? base : fallback;
}
// createImportedDoc 里：
if (originalBuf && originalBuf.length) {
  const safeName = safeAssetFileName(originalName, "original.bin");
  fs.writeFileSync(path.join(dir, safeName), originalBuf);
  addAssetRow(itemId, `${sourceType}-original`, safeName, sha256(originalBuf), now);
}
```

**要点**：用 `split(/[\\/]/)` 而不是 `path.basename`（跨平台一致，实测 Windows 反斜杠会穿透）；**必须拒掉纯点名字**（`..` 经 basename 后仍是 `..`，`path.join(dir,"..")` 会出目录）。写盘名与 `addAssetRow` 的 `path` 必须同一个变量（读侧 `db.js:978/998/1014/1030` 按 `assets.path` 取文件）。
**不变量**：现有 6 个调用点的行为**逐字节不变**（`original.docx` 等经净化后原样）；越界名不再能写出 `assets/<itemId>/`。
**必须新增断言**：`f25` V1/V2/V7 从 known 提为硬断言；新增一条"净化后文件名合法且落在 item 目录内"（`path.resolve` 前缀校验）。
**known 降级**：`f25` V1/V2/V7。

### C4 — 软删书连带 assets（D-TEST-18）

**现状**：`db.js:844-850 deleteItem` 只软删 `library_items` + `documents`；`assets` 表**从无 UPDATE/DELETE**（全仓只有 INSERT 与 SELECT，且读侧过滤 `is_deleted=0`，所以那个 0 永远不变）。**备份不看表**：`backup.js:119-126` 用 `walkFiles(p.assetsDir)` **递归整目录打包**。

**改什么（两步，缺一不可）**：

```js
// ① db.js deleteItem：连带软删该书资产
function deleteItem(id) {
  const now = Date.now();
  db.run("UPDATE library_items SET is_deleted = 1, updated_at = ? WHERE id = ?", [now, id]);
  db.run("UPDATE documents SET is_deleted = 1, updated_at = ? WHERE library_item_id = ?", [now, id]);
  db.run("UPDATE assets SET is_deleted = 1, updated_at = ? WHERE library_item_id = ?", [now, id]);  // 字节保留，回收留给显式清理
  persist();
  return true;
}
```

② `backup.js` 的 assets 打包：**跳过已删书的 item 目录**（只跳过"一级目录名 = 已删 item id"的文件；`assets/` 根下的散落文件照旧打包，别误删）。

⚠️ **不能照抄 `queryAll(...)`**：`electron/backup.js` **不 import db 模块**（require 只有 `fs` / `path` / `jszip`，`electron` 也是惰性取），
它的既有依赖注入模式是 `opts.dataDir` / `opts.backupDir` / `opts.flush()`。所以按同一模式注入，**二选一并在注释里写明选了哪种**：

- **首选（零新耦合）**：`db.js` 新增只读导出 `listDeletedItemIds()`（`SELECT id FROM library_items WHERE is_deleted = 1`），
  `main.js` 的备份入口（`backupOpts()` 附近）把它塞进 `opts.deletedItemIds`；`backup.js` 只读 `opts.deletedItemIds`，**缺省空集合 → 行为与今天完全一致**。
- 备选：`backup.js` 内 `require("./db")` —— **必须先确认无循环依赖**（db.js 不 require backup.js）才可用。

打包循环本身：

```js
const deleted = opts.deletedItemIds instanceof Set ? opts.deletedItemIds : new Set();
for (const f of walkFiles(p.assetsDir)) {
  const top = String(f.rel).split(/[\\/]/)[0];
  if (deleted.has(top)) continue;                 // 已删书的字节不进备份
  zip.file(`assets/${f.rel}`, fs.readFileSync(f.full), { compression: isAlreadyCompressed(f.rel) ? "STORE" : "DEFLATE" });
  meta.assetFiles++;
}
```

**不变量**：未删书的资产打包逐字节不变；恢复流程（`backup.js:308-312` 整目录替换）不受影响；`getBackupCounts`（`db.js:766`，已按 `is_deleted = 0` 计数）与打包结果**口径一致**。
**必须新增断言**：`f25` 增一条"删书后备份不含该书 assets、且该书的 assets 行 `is_deleted=1`"（备份可用现有 `tests/backup.test.cjs` 的辅助或直接在流程里调 `backup.js` 的打包函数）。
**回归**：必须重跑 `node tests/backup.test.cjs`（M2，33 断言）确认全绿。
**known 降级**（**两条**，漏一条就会触发「意外转绿」不洁报警）：`f25` V6 + **`f31` 的 J5「删书要把它的 assets 一并标记」（`:239-245`）**——两条都是 D-TEST-18。

---

## 批次 D — 交互与文本契约（D-TEST-13/14/16/22/07/19/10）

### D1 — 键位：输入焦点守卫（D-TEST-13）

**现状**：`src/lib/commands.ts:8` 注释写死「输入焦点（input/textarea/contentEditable）内绝不劫持」，但 `dispatchKey`（`:140-157`）只有 `suppressions` 与 `e.repeat` 两个判断，`install`（`:160-173`）的 capture 监听也没有 target 判断。全仓 `isContentEditable` 只出现在 `Reader.tsx:566` 与 `src/lib/reader/foliate/adapter.ts:180`（各自的翻页监听）。

**改什么**：`dispatchKey` 开头（`suppressions` 判断之后、`e.repeat` 之前或之后均可，建议紧随其后）补：

```ts
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return false;
```

**不变量**：编辑态 `Ctrl+Z/Ctrl+A` 保持原语义；`when()` 收窄逻辑不变；`e.repeat` 仍忽略；抑制集合语义不变。
**必须人工确认（GUI）**：阅读器里"选中文字后按 `Ctrl+Z` 制卡"在焦点落进 foliate 的 contentEditable 时**是否仍能触发**——如果被新守卫挡住，需要把守卫的粒度改成"仅在命令的 `when()` 不含选区语义时生效"，或把阅读器命令改走它自己的监听。**这一步必须在 GUI 里实测**（`FLOW_INSTANCE=manual node tests/flows/f01-golden-journey.cjs`，需要人在场），不许只靠静态推断。
**必须新增断言**：`f20` 增一条"焦点在 INPUT 内时 `dispatchKey` 返回 false 且动作未执行"（现有 W3 已有行为证据，把 known 提为硬断言即可）。
**known 降级**：`f20` W3。

### D2 — 键位：残缺串守卫（D-TEST-14）

**现状**：`commands.ts:51-63` `eventToCombo` 只挡 `PURE_MODIFIER`，`{key:"",ctrlKey:true}` 会产出 `"Ctrl+"`；`setOverride`（`:93-100`）原样写进 `settings.app.keybindings`；`conflictWith`（`:108-114`）按串相等当占用。

**改什么**：`let key = e.key || "";` 之后立刻 `if (!key) return null;`（放在 `key === " "` 归一之前或之后皆可，建议紧随 `let key` 之后）。
**不变量**：`key` 非空的既有规范化（`" " → "Space"`、单字符大写）不变；设置页 `SettingsPanel.tsx:1429` 的 `if (!combo) return;` 语义（继续等待输入）不变。
**必须新增断言**：`f20` W2 从 known 提为硬断言；新增一条"`"Ctrl+"` 不在 `settings.app.keybindings` 里"。
**known 降级**：`f20` W2。

### D3 — 书卡图注可点（D-TEST-16）

**现状**：`src/components/Bookshelf.tsx:485-499` 是 `.shelf-item` 包 `.book-card`（`:491-499` 带 `onClick={() => isFolder ? openInto(entry.id) : onOpenBook(entry.id)}`、`tabIndex={0}`、`role="button"`）；`:554` 关闭 `.book-card`，`:555-561` 的 `.cap-rail`/`.cap`（书名 + 进度）是**兄弟节点**，在可点节点之外；`itemProps`（`:264-275`）只有拖拽属性。

**改什么（最小、不碰拖拽）**：给 `.cap` 容器加与书卡同源的点击行为，例如在 `:555-561` 的 `.cap-rail`（或 `.cap`）上加 `onClick={() => (isFolder ? openInto(entry.id) : onOpenBook(entry.id))}` + `role="button"` + `tabIndex={0}` + `onKeyDown`（Enter/Space 与书卡一致），并补 `:focus-visible` 样式；**不要**把 onClick 挪到 `.shelf-item` 上（会和拖拽语义打架）。
**不变量**：书卡本体行为不变；表视图「打开」按钮（`:578-582`）不变；拖拽三区落点不变；视觉（§5.4 D51 的"封面 + 排印图注"）不变。
**已核实的前置条件**：改名态下 `.cap` 里渲染的是 `cap-input`（`Bookshelf.tsx:325-331`），它**已经带** `onClick={(e) => e.stopPropagation()}`——
所以给 `.cap-rail` 加 onClick **不会**造成"点改名输入框时误开书"。执行前再复核这条仍在（若被删掉，就要在输入框上补回）。
**验证**：必须跑 GUI 流程 `f01`（人在场），期望 `✗(已知) [D-TEST-16]` 变绿 → 降级为 `check`。
**known 降级**：`f01` K4 里的 D-TEST-16 那条（**注意**：F01 是 `@gui:true` 手工流程，长跑不覆盖）。

### D4 — 导入清洗围栏感知（D-TEST-22）

**现状**：`electron/importers.js:139-148 markdownFromText` 三个全局正则无上下文；`:137` 注释自述"清洗只针对这两类明确噪音，正文不做任何改写"；唯一生产调用点 `main.js:241`（Markdown 导入路径）；该文件**没有任何围栏处理**（`codeBlockStyle: "fenced"` 是 turndown 的构造项，只管 Word→MD，与 markdown 导入无关）。

**改什么**：改成"围栏外清洗"——

```js
function markdownFromText(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const cleanSegment = (s) =>
    s
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
      .replace(/!\[[^\]]*\]\(\s*data:image\/[^)]*\)/g, "")
      .replace(/\n{3,}/g, "\n\n");
  const lines = src.split("\n");
  const out = [];
  let buf = [];
  let fence = null; // 当前围栏字符（` 或 ~）
  const flush = () => { if (buf.length) { out.push(cleanSegment(buf.join("\n"))); buf = []; } };
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m) { flush(); fence = m[1][0]; out.push(line); } else buf.push(line);
      continue;
    }
    out.push(line);                                    // 围栏内：原样保留
    if (m && m[1][0] === fence) fence = null;          // 闭合（允许更长围栏）
  }
  flush();
  return out.join("\n").trim();
}
```

**不变量**：围栏**外**的 `<style>/<script>/data:image` 清洗照旧（不得因为加了围栏感知就放过正文噪音）；未闭合围栏 → 其后全文按代码保护（合理降级）；**幂等**（跑两遍结果相同，`f30` S3 的幂等断言要保住）；换行归一（`\r\n → \n`、连续空行压缩）在围栏外生效。
**必须新增断言**：`f30` S3 从 known 提为硬断言（围栏内 `<style>` 必须原样保留）；新增一条"围栏外噪音仍被清掉"（防修过头）。
**known 降级**：`f30` S3。

### D5 — 日记日期校验（D-TEST-07）

**现状**：`db.js:2381-2392 createJournalEntry` 用 `String(entryDate || journalDateOf(created))` **原样入库**；同仓 `journalTime.js:22-32 isJournalDate` 已存在且会校验真实日历（`2026-02-30` 非法），`db.js:41` 也已 `require("./journalTime")`（用了 `journalDateOf`）——**校验函数与导入都现成，只是没调**。

**改什么**：

```js
function createJournalEntry({ contentMarkdown, source = "app", entryDate, isDraft = false, createdAt }, opts) {
  const content = String(contentMarkdown ?? "");
  if (!content.trim()) throw new Error("日记内容为空");
  const created = Number(createdAt) || now…
  const day = entryDate === undefined || entryDate === null || entryDate === ""
    ? journalDateOf(created)
    : String(entryDate);
  if (!isJournalDate(day)) throw new Error(`日记日期非法: ${day}`);   // §6.5 自然日归类 + §7.2 数据完整性
  …INSERT…  [day, …]
```

**调用点核对（已做）**：`main.js:904-908`（IPC `journal:create`，渲染层 `JournalView` **不传 entryDate** → 走默认）；`saveJournalDraft`（`db.js:2430`）/`sendJournalDraft`（`:2438`）靠默认 → 不受影响。`updateJournalEntry`（`:2408`）不动 `entry_date`（注释明示）→ 不需要校验。
**不变量**：不传 `entryDate` 的行为**逐字节不变**（默认仍 `journalDateOf(created)`）；草案/发送路径不受影响。
**陷阱**：这会**拒掉**历史宽松输入（`"2026-3-5"`）——按 §6.5 这是正确的，但要在提交信息里写明"收紧点"；如果渲染层有地方传非零填充日期，必须先修调用方（**执行前 grep 一遍 `entryDate`**）。
**必须新增断言**：`f13` P5 增"What you get: 非法 `entryDate` 抛错、不落库"（`"2026-13-45"`/`"2026-02-30"`/`"abc"`/`"2026-3-5"` 四档）；`f12` 增一条合法日期仍可入库。
**known 降级**：`f13` P5。

### D6 — 展示函数兜底（D-TEST-19）

**现状**（`src/lib/shelf.ts:348-358`、`src/lib/journal.ts:173-180`）：
- `pct(n) { return `${Math.round(n*100)}%` }` → `pct(NaN)`="NaN%"、`pct(Infinity)`="Infinity%"；
- `dayLabel(ms) { if (!ms) return ""; … }` → `dayLabel(NaN)` 其实**安全**（`!NaN` 为真，返回 ""）；junk 来自 `dayLabel(Infinity)` / `dayLabel(1e18)` / `dayLabel("abc")`（`Invalid Date` → `"NaN-NaN"`）；
- `journalDateLabel(dateStr)`：正则只校验形状，`"2026-02-30"` 通过后 `new Date(2026,1,30)` 静默进位到 3/2 → 标签写 `02-30` 而星期是 3/2 的。

**改什么**：

```ts
// shelf.ts
export function pct(n: number): string {
  const x = Number(n);
  return Number.isFinite(x) ? `${Math.round(x * 100)}%` : "0%";   // 非有限数当 0：既不出 junk，也不污染 style 宽度
}
export function dayLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// journal.ts
export function journalDateLabel(dateStr: string, opts: { withYear?: boolean } = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return String(dateStr || "");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return "";  // 不存在的日子直接拒
  const label = `${pad2(mo)}-${pad2(d)} 周${"日一二三四五六"[date.getDay()]}`;
  return opts.withYear ? `${y}-${label}` : label;
}
```

**陷阱（必须遵守）**：`pct` 的返回值**同时用于 CSS 宽度**（`Bookshelf.tsx:520/555/558/559/603/609/611`，形如 `width: pct(progress)`）——所以**不能返回 `"—"` 之类的非长度值**，这就是选 `"0%"` 的原因。
**不变量**：合法入参的输出逐字不变；`dayLabel(0)`/`dayLabel(NaN)` 仍返回 `""`（不回归）。
**必须新增断言**：`f26` P2 已有的两条 known 提为硬断言（junk 判据已修正为"只盯 NaN/Infinity/undefined/[object"，空串不算 junk）；新增"`pct` 返回值必须匹配 `/^\d+%$/`"（守 CSS 宽度这条陷阱）。
**known 降级**：`f26` P2 两条。

### D7 — 搜索 NFKC 口径（D-TEST-10）

**现状**：`db.js:2353-2357`（日记）与 `db.js:2583-2588`（知识点）把查询词直接塞进 `LIKE`，不做全半角归一；对照 `src/lib/dict.ts:86` 的 `normalizeWord` 与 `src/lib/cards.ts:254` 都做 `.normalize("NFKC")`。渲染层 `JournalView.tsx:185` / `KnowledgeManager.tsx:143` 只 `trim()`。

**改什么（查询侧归一，最小且能修掉报告的现象）**：在 `db.js` 这两个 LIKE 构造处对查询词做 NFKC：

```js
const q = String(query ?? "").trim().normalize("NFKC");
```

**明确不做（写进 §非目标）**：不动入库侧、不加归一化列。**如实说明残余**：存量**全角**文本用半角词搜仍会漏（只有入库侧也归一才能双向），这需要 schema 或写路径改动，属后续批次。
**顺序钉死**：先 `.normalize("NFKC")`，**再**做 `%` / `_` / `\` 的转义（NFKC 不会产出这三个字符，但顺序写反留下的是将来会被别的归一规则踩到的坑）。

**不变量**：`%`/`_`/`\` 的转义行为不变（注入防护不许退化）；大小写语义不变；`ESCAPE '\'` 位置不变。
**必须新增断言**：`f19` Z4 从 known 提为硬断言（入库 `ABC` → 搜 `ＡＢＣ` 命中；且转义矩阵仍全绿）。
**known 降级**：`f19` Z4。

---

## 批次 E — 卫生与低危（D-TEST-02 / D-TEST-03 / D-TEST-15）

### E1 — `memory.enabled` 布尔归一（D-TEST-03）

**现状**：`electron/memoryTidy.js:28-40 readMemoryConfig` 用 `const cfg = { ...TIDY_DEFAULTS, ...raw }` 直接展开，数值字段逐个 `clampNum`，**布尔（`enabled` / `introAcked`）没有归一**；`"yes"` 会经 `:310 if (!cfg.enabled) return;` 被当成开启。UI 写入侧 `main.js:1055` 是 `{ enabled: !!p.enabled }`（**只有 UI 路径归一**）。

**改什么**（照同文件 clampNum 的惯例，紧随其后）：

```js
  // 布尔字段只认 true（§4.18：默认关闭是 consent 纪律；手写 "yes" 不得视为同意）
  cfg.enabled = cfg.enabled === true;
  cfg.introAcked = cfg.introAcked === true;
```

**不变量**：默认仍 `false`（`memoryTidy.js:10-23`）；UI 写入路径语义不变；`getStatus`（`:424`）回显类型变为布尔（**这是预期变化**，若 `f18` 有断言回显原值需同步）。
**必须新增断言**：`f07` D1 从 known 提为硬断言（`"yes"` → `enabled === false`；`true` → `true`）；新增"数字 `1` 也不得视为开启"。
**known 降级**：`f07` D1。

### E2 — `prompt_templates.is_default` 语义收口（D-TEST-02）

**现状**：schema `db.js:165-173`（`is_default INTEGER NOT NULL DEFAULT 1`）；**所有播种 INSERT 都写死 1**（`db.js:1640/1659/1668/1679/1688/1692/1702/1722/1746/1758/1769`），于是同 scope 多行同时"默认"（如 `card-occlusion` v1 与 v3）；读取 `getPromptTemplate`（`:1776-1782`）**不按 is_default 过滤**，靠 `ORDER BY version DESC` 取最新；全仓**没有任何**置 0 的写入者。

**⚠️ 需要用户先拍板（Q-E2）**：`is_default` 的语义是哪种？
- 语义 ①「该 scope 的**默认/启用**版本」→ 修法：播种只给应默认的版本 1、其余 0；`getPromptTemplate` 改 `ORDER BY is_default DESC, version DESC`；对存量库做一次**幂等数据订正**（每个 scope 只保留最高 version 的 `is_default=1`）。
- 语义 ②「**系统播种**标记（vs 用户自建）」→ 那"多行同时默认"不是缺陷，只需把列名/注释与文档对齐，**不动代码**。
**默认建议**：按 §6.3.4 的"默认版本应唯一"取语义 ①；但**执行前必须拿到用户确认**，否则本项跳过（它是低危项，跳过不阻塞其它批次）。

### E3 — 写入口零校验（D-TEST-15）

**现状**（F32 全量清点，28 条探针）：**15 个「针对既有行」的函数对幽灵 id 返回真值**（假"已保存"）：
`updateProgress`（`db.js:1921-1928`，返回 true）、`addReadingEvent`（`:1511-1519`，任意 itemId 可插）、`deleteCard`（`:1329-1333`）、`deleteItem`（`:844-850`）、`deleteJournalEntry`、`updateCard`（`:1142-1175`）、`setLibraryItemTitle`（`:794-800`，只校验内容不校验存在）、`setLibraryItemLang`、`deleteKnowledgeRelation`、`deleteKnowledgeExternalRef`、`deletePersonalMeaningCandidate`、`deleteInsightRun`、`removeDictSource`（`:1871-1874`）、`setDictSourceEnabled`、`setAIGenBatchStatus`。
另有 **5 个可判失败**（`setCardSuspended`/`updateCardLeech`/`setActiveMaterialMap`/`deleteMaterialMap`/`setMemoryRunStatus`，返回 `null`/`false`）与 **5 个诚实抛错**（`saveReview`/`setActiveFsrsConfig`/`setInsightRunStatus`/`createKnowledgeExternalRef`/`createJournalEntry`）——**这三组不要动**。
插入侧三族收幽灵父 id：`card_issues` / `extracts` / `reading_events`；`createCard({})` 收空白卡。

**改什么（分层，执行前必须先做调用点普查）**：

```js
// db.js 新增内部助手（放在 listItems 附近）
// ⚠️ is_deleted 不是每张表都有（实测：全库 27 张表里只有 17 张带软删位）。
// 目标表带软删位时要连带过滤，否则会把「已软删的行」当成存在，等于白校验。
function rowExists(table, id, hasSoftDelete = true) {
  const sql = hasSoftDelete
    ? `SELECT 1 AS ok FROM "${table}" WHERE id = ? AND is_deleted = 0 LIMIT 1`
    : `SELECT 1 AS ok FROM "${table}" WHERE id = ? LIMIT 1`;
  return Boolean(queryAll(sql, [String(id)])[0]);
}
```

**每张目标表的带列情况（已逐表核对 `CREATE TABLE` 块，直接照用）**：

| 函数（T1/T2 档） | 目标表 | `hasSoftDelete` |
|---|---|---|
| `updateProgress` / `deleteItem` / `setLibraryItemTitle` / `setLibraryItemLang` | `library_items` | `true`（`:74`） |
| `updateCard` / `deleteCard` | `cards` | `true`（`:141`） |
| `deleteJournalEntry` | `journal_entries` | `true`（`:369`） |
| `deleteKnowledgeRelation` | `knowledge_relations` | `true`（`:416`） |
| `deleteKnowledgeExternalRef` | `knowledge_external_refs` | `true`（`:432`） |
| `deletePersonalMeaningCandidate` | `personal_meaning_candidates` | `true`（`:516`） |
| `deleteInsightRun` | `insight_runs` | `true`（`:498`） |
| `removeDictSource` / `setDictSourceEnabled` | `dict_sources` | `true`（`:323`） |
| **`setAIGenBatchStatus`** | `ai_gen_batches` | **`false`**（该表**没有** `is_deleted`） |
| `addReadingEvent` | `library_items`（校验父书存在） | `true` |
| T3 插入侧 `createExtract` | `documents` | `true`（`:85`） |
| T3 插入侧 `addCardIssue` | `cards` | `true` |

（无 `is_deleted` 的表还有 `card_issues` / `reading_events` / `review_logs` / `fsrs_configs` / `dictionary_cache` / `prompt_templates` / `users` / `review_skips` / `material_map_calls`——如果选做这些表的校验，必须传 `false`。）

- **T1 档（用户可达 + 会误判，必改）**：`updateProgress` / `addReadingEvent` / `deleteCard` / `deleteItem` / `updateCard` —— 目标行不存在时 **返回 `false`**（不抛，保持调用方零改动），并在 `updateProgress` 里同时补值形状校验（`if (!progress || typeof progress !== "object" || Array.isArray(progress)) return false;`）。
- **T2 档（同类，建议同批）**：其余 10 个"返回真值"的函数按同一模式补 `rowExists` 判定 → 返回 `false`。
- **T3 档（插入侧）**：`createExtract` 校验 `documentId` 存在；`addCardIssue` 校验 `cardId` 存在；`createCard` 拒绝 `frontMarkdown`/`backMarkdown`/`noteText` **三者全空**（抛错）。**`createAssetForItem` / `createFromPaste` 等不改**（它们本来就允许造新行）。

**必须先做的普查（缺此步不许动手）**：
1. `grep -rn "updateProgress\|addReadingEvent\|deleteCard(\|deleteItem(\|updateCard(" electron/ src/ tests/` —— 对每个调用点记录**它是否依赖"返回 true 即成功"**。已知需要特别确认的两处：① 恢复流程（`backup.js` / `F05`）是否会把"删一个已删的 id"当失败回滚；② 渲染层是否用返回值判断 toast 文案。
2. 若发现调用点依赖宽松语义 → **先改调用方或降级该函数**，不要硬改。
3. **两处实传载荷必须先记录在案，再定校验 predicate**（否则会静默丢数据）：
   ① `src/App.tsx:274` 的 `handleDocProgress` 实传 `{ ratio, lastText, updatedAt: Date.now(), ...extra }`（**已核实**：普通对象，字段都是 number/string）——
   `updateProgress` 的形状校验只拒"非对象 / 数组 / `null`"，**不要拒合法字段组合**（这个调用是 fire-and-forget，拒错了等于把用户的全部阅读进度静默丢掉）；
   ② **AI 批量制卡路径（普查已完成，2026-09-22）**：`createCard` 的生产入口只有一条——`main.js:402` `ipcMain.handle("cards:create", (_e, card) => createCard(card || {}))`；
   渲染层统一走 `createAcceptedCard`（`src/lib/cards.ts:1050`），而**多草稿是循环 `await` 且没有逐卡 `try/catch`**
   （实例：`Reader.tsx:1525-1546` 的 `acceptVocabCards`，`for (const v of drafts) { … await createAcceptedCard(…) }`）。
   → **结论：T3 的"拒绝空白卡"不要用抛错实现**——一张坏草稿会中断整批（后面的卡全不落库、toast 也不出现）；
   改成**返回 `null`/`false` 且不落库**（与 T1/T2 档"可判失败"一致），调用方零改动即可继续。
   若确实要抛错，必须先把上面那类循环逐个改成逐卡 `try/catch`——那是另一个改动，不要顺手做。
   ③ **空白卡的判据必须把 occlusion 与 cloze 算作"有内容"**（否则会误拒合法卡）：
   `createAcceptedCard` 对图片挖空卡会传 `occlusionJson`（`src/lib/cards.ts:1072`），且 `:491` 注明"qa：occlusionJson 挂图、rects 空数组、front 存题面"；
   挖空卡的 `noteText` 取 `dd.front || cloze`（`:1066`）。
   → 判据必须是：`frontMarkdown` / `backMarkdown` / `noteText` **全空** 且 `occlusionJson` 为空 且 `clozeOrds` 为空 且未提供 `cloze`，才算空白卡。
**不变量**：正常路径（id 存在）返回 `true` 的行为逐值不变；`saveReview` 等三族抛错语义不变；`deleteCard` 连带置 `card_issues` 为 dismissed 的既有行为不变。
**必须新增断言**：`f32` W2/W3/W6 三条 known 提为硬断言（幽灵 id 一律 `false`/抛错；三族不再收幽灵父 id；`createCard({})` 抛错）；`f23` Q3/Q4 同步。
**known 降级**（**落成行号**）：`f32` 的三条（W2「点名清单外不得新增假成功」/ W3「诚实性棘轮」/ W6「幽灵父行与空白卡」）
+ **`f23` 的 `:133` / `:140` / `:165`**（三条均 D-TEST-15）。
⚠️ 注意 `f23:174`（仪表盘今日字数）**不属于本批次**——它是 D-TEST-12，归批次 B2；错记会导致两处都漏降级。
**⛔ 这一档是全局风险最高的改动**（15 个函数面广）。若调用点普查发现 3 处以上依赖宽松语义，**停下来报告**，只做 T1 档。

---

## 批次 F — 文档收口（改文档，不动代码；需用户拍板）

按本项目约定「文档↔代码矛盾时改文档不动代码」，且**全量收口 = bump 版本号 + 决策号**。
范围：`D-DOC-01…09` + 两条未编号漂移（§9.2 M8 状态行与 §9.1 矛盾；§7.2 缺 `reading_events`/`material_maps` 的例外登记）+ 本规格 §附录 的 4 条缺陷簿自我更正。
**执行要求**：① 先给用户一份"改哪几行、改成什么"的清单，拿到确认（含 bump 到哪一版、决策号取几）；② 改完跑 `node tests/flows/f11-doc-code-drift.cjs` 与 `f18`/`f20`/`f24`，确认相关 `known` 转绿并降级；③ 不要改任何行为描述去迁就代码 bug——**文档写对了就改成文档**，代码错了留给对应批次。

---

## 统一验收（所有批次做完后必须满足）

```bash
node tests/flows/run.cjs --hours 0.05 --gap 0     # 3 分钟 ≈ 8 轮 × 32 条自动流程（实测 255 次运行）
node tests/backup.test.cjs                        # M2 备份套件（批次 C4 改了备份）
node tests/m6-1.test.cjs                          # 导入套件（批次 D4 改了清洗）
node tests/undo.test.cjs tests/m12.test.cjs        # 撤销/延后（批次 B1 改了清单序）
npx tsc --noEmit                                  # 批次 D 改了 TS 文件
npm run build                                     # 批次 D3 改了渲染层
```

必须同时满足：
1. **0 新增判红、0 崩溃**，且 **`knownHealed`（意外转绿）计数必须为 0**——它必须与下面第 2 条的降级清单**一一对应**；对不上就说明降级漏了、或断言语义被顺手动过。
2. §批次 A–E 里点名的 `known` **全部降级为 `check`** 并在 `DEFECTS.md` 标注「已修复（批次 X）」；
   **唯一例外是 `f03` S3 的 `insertFsrsConfig` 那一格**（见批次 C2：按"显式例外"登记，不是降级）。
3. 每个批次点名的新增断言全绿。
4. **正常数据行为不变**：`f28` X2（KPI vs 自算 oracle）、`f31` J1/J2、`f33` R4（12 组读数逐路径一致）仍全绿——这是"修复没改坏正常路径"的硬证据。
5. 棘轮收紧：`f32` 的 `FAKE_BUDGET` 按实测值下调（假成功数会下降）、`f24` 基线不变。
6. `git diff --stat` 只涉及点名的文件；`main` 分支零改动。

---

## 边界矩阵（每条修复都要考虑这 11 种情形；缺一即视为边界分析不完整）

| 情形 | 批次 A | 批次 B | 批次 C | 批次 D | 批次 E |
|---|---|---|---|---|---|
| 正常流程 | 有数据时读数逐值不变（f28/f33 守） | 图有数、口径唯一 | 落盘成功、备份含未删资产 | 快捷键/导入/展示照旧 | 写入口正常路径返回 true |
| 空数据（新装库） | 空库 J7 全绿（f31 J7） | `readingDays` 全 0 但桶轴日对齐 | 无配置行时不额外落盘 | 无日记/无围栏时行为不变 | 无卡/无日记时不抛 |
| 异常数据 | 非对象 settings、坏 JSON、分数入参 | 时钟倒退、`reviewed_at` 乱序 | 越界文件名、幽灵 assets | 残缺按键串、`02-30`、全角 | `"yes"`、同 scope 多默认 |
| 重复执行 | 幂等（解析/归一都是纯函数） | 两次读数逐值一致 | `applyWeights` 重复不产生第二行 | `markdownFromText` 幂等 | `rowExists` 幂等 |
| 中断（写一半崩） | 不涉及（只读路径） | 不涉及 | `persistNow` 原子写（既有实现） | 不涉及 | 不涉及 |
| 重启应用 | settings 坏形状重启可用（f18 Y7） | 图重启后仍对 | 优化参数重启仍在（f03 S10） | 键位覆盖重启后仍生效 | 归一后重启一致 |
| 并发 | sql.js 单进程串行（无需额外锁） | 同左 | `persistNow` 与既有 persist 同队列 | GUI 事件与键盘监听（D1 需人工确认） | 同左 |
| 部分失败 | 单列坏不牵连其它列（A2 的核心） | 单条坏行不影响整图 | 备份跳过一个目录不影响其余 | 一段清洗失败不影响整篇 | 单个写入口失败不回滚别的 |
| 历史数据兼容 | 旧库无 `damaged` 字段（新增字段不落库） | 旧库无 `reading_events` 也能算 | 旧库 assets 行为不变 | 旧日记非法日期**仍在**（只挡新写入） | 旧库全 1 的 `is_default` 需订正（E2）或不动 |
| 回滚 | `git revert` 即可（无数据副作用） | 同左 | 同左（`assets.is_deleted` 是软标记，可再置 0） | 同左 | E2 的订正需给出反向语句 |
| 重复调用/多次触发 | 读数幂等 | 同左 | `applyWeights` 第二次同配置 → 指纹去重早退 | 连续两次导入同一文件 → 两本书（既有行为，不改） | 写入口第二次返回 false（符合预期） |

---

## 全局风险（跨批次）

| 风险 | 说明 | 缓解 |
|---|---|---|
| R-1 一次改太多 | 22 条缺陷 + 9 条漂移跨 3 个进程层 | **按批次 commit**，每批跑完回归再进下一批；不许跨批混改 |
| R-2 断言与实现同时改 | 降级 `known` 时可能"顺手"放宽断言 | 降级只做「known → check」的**同名同参数**替换，禁止改断言语义 |
| R-3 渲染层行为变化未人工验证 | D1（焦点守卫）、D3（图注可点）、B2（图表从空变有数）、D6（展示空串）都改用户可见行为 | D1/D3 必须 GUI 实测（`f01`）；B2/D6 用 `f28`/`f26` 回归 + 抽查截图 |
| R-4 TS 改动漏编译 | D1/D2/D6 改 `src/lib/*.ts` | 必须 `npx tsc --noEmit` + `npm run build`（GUI 流程前） |
| R-5 备份语义 | C4 改备份内容范围 | 重跑 `tests/backup.test.cjs` + 手工做一次备份/恢复（含一本已删书） |
| R-6 E3 调用点依赖 | 15 个函数面广 | 先普查再动手；发现 ≥3 处依赖即停手上报 |

---

## 明确非目标（写了也不做）

- **D-TEST-05 / D-TEST-20**：已撤销，**不修**（撤销依据见 `DEFECTS.md`；其中 D-TEST-16 的图注问题在 D3 修，但不要"恢复" D-TEST-05 的鼠标打点旧写法）。
- **D-TEST-04**：观察项（非缺陷），不修。
- **D-TEST-15 的 T3 档之外的插入侧**（`createAssetForItem` 等允许造新行的函数）、**其余 14 处同类裸 `JSON.parse`**（`extracts :815/:1992`、`material_maps :3955/:3962/:4092`、`mindmap :4186`、`ai_gen_batches :4318/:4319` 等）——记录在案，单独批次。
- **D-TEST-10 的写侧归一**（存量全角文本双向匹配）、**D-TEST-02 的 schema 默认值改动**（若确认走语义 ① 也只做数据订正，不改 schema）。
- **`mapCardRow` 不产出 `docTitle`（SQL 的 `li.title AS docTitle` 未被用上）**：本轮新发现，属显示层行为变更，**需用户单独拍板**后再做（见 §附录）。
- 不新增 UI 组件/设置项、不新增 IPC 通道、不改 schema、不做迁移框架、不引入遥测/日志框架、不重构 `db.js` 其它部分（含不合并两份 `readSettings`）。

---

## Q. 需要进一步确认（执行前必须落实，不要自行假设）

- ~~Q1~~ **已确认（2026-09-22，快进后逐行核对）**：`f18-settings-matrix.cjs:276`「合法 JSON 但非对象（null/0/true/字符串）也必须回退为默认对象」（Y3 段 `:256` 起）与 `:369`「非对象设置（null/0/true/字符串）下应用必须仍能启动」（Y7 段 `:335` 起）——**这两条就是批次 A 要降级的 known，别动该文件里的其它 known**（`:166`/`:177` 属 D-DOC-07、`:182`/`:189` 属 D-DOC-08，都归批次 F）。
- **Q2**：**规范级依据缺失**——全指南检索「损坏行 / 一致跳过 / 不得穿透」**零命中**，批次 A 的口径只写在 `db.js:2051` 的代码注释里。提交信息里**不得**写成"指南 §x 要求"。
- **Q3**：批次 E3 要求的**调用点普查**结果（见 E3 步骤 1）；发现依赖即停手上报。
- **Q4**：批次 E2 的 `is_default` **语义**（① 默认版本 / ② 系统播种标记）——需用户拍板。
- **Q5**：批次 B2 的**桶数**（46 含今日 vs 恰好 45）——默认 46，若要 45 请明示。
- **Q6**：批次 C4 备份**跳过策略**是否要一并清理磁盘字节（本规格只做"不进备份"，不做删除）。
- **Q7**：`pct` 非有限数回落 `"0%"`（为兼容 CSS 宽度）是否可接受——若产品要求"未知"语义，需与 UI 一起改。
- **Q8**：`markdownFromText` 的围栏算法对**缩进围栏**（≤3 空格）与**未闭合围栏**的处理已按 CommonMark 简化实现；若要完全对齐 CommonMark，需引入解析器（本规格不引入依赖）。

---

## 复核记录（2026-09-22，对另一模型复核意见的逐条处置）

第三方复核（通读两份规格 + 4 个并行核查代理逐行对码）**证实**了本规格绝大多数现状断言：15/5/5 写入口名单、
17/27 软删位清单、known 断言位置、`--cycles 1` 警告、`pct` 双用途陷阱、C1 是唯一 Key 泄露口、
D1「加守卫不会挡掉任何合法命令」（命令表 14 条全量核对）、1.5 分数 limit 打穿 SQL 等。
下表是逐条处置（**采纳 10 条 / 驳回 1 条 / 反证 1 条**），已全部落进上文：

| 复核意见 | 处置 | 依据 |
|---|---|---|
| P0-1「`--hours 0.05` 只够跑 1–2 条流程，全量需小时级」 | **驳回** | 亲测：该命令在 3 分钟内跑了 **8 轮 × 32 条 = 255 次运行**、覆盖全部 32 条自动流程（单轮约 25 秒）。命令保持不变，已在 §0.3 写入实测口径 |
| P0-1 附带「条数口径改成 32 自动 + F01 手工」 | 采纳 | 已统一措辞 |
| P1-1「`backup.js` 拿不到 `queryAll`，C4 片片段跑不通」 | 采纳 | 核对 backup.js：require 只有 `fs`/`path`/`jszip`，依赖注入靠 `opts.*`（`opts.dataDir`/`opts.flush()`）；已改为 `opts.deletedItemIds`（首选）+ `require("./db")`（备选，须确认无循环依赖） |
| P1-2「S3 的 `insertFsrsConfig` 修完仍红，不能降级」 | 采纳 | 核对 `f03:132-162`：S3 直接调 `insertFsrsConfig`，聚合判据 `notFlushed.length === 0`；B 方案刻意不改该函数 → 已改为「登记为显式例外」（同日记防抖例外格式） |
| P1-3「`clampOffset(Infinity)` 仍会崩」 | 采纳 | 推理成立（`Math.max(0, Infinity) = Infinity` → `OFFSET Infinity` → datatype mismatch）；已换有限性 + 上限版本，并把 `offset: Infinity` / `1e21` 两档加进 `f19` 新增断言 |
| P1-4「known 降级归属错位三处」 | 采纳 | 逐条核对：D-TEST-18 在 `f31:239-245`、D-TEST-23 在 `f31:286-292`、D-TEST-12 另有 `f23:174`；已补进对应批次，并写明 `f23:174` **不属于**批次 E |
| P2「批次 A 不变量 4 没有断言守着」 | 采纳 | 已加批次 A §K2 第 6 条（仅 `tags_json` 损坏 → 卡仍留在队列） |
| P2「E3 先记录 `App.tsx` 实传载荷、核实 AI 批量制卡逐卡 catch」 | 采纳 | 已核实 `App.tsx:274` 传 `{ratio,lastText,updatedAt,...extra}`（普通对象）；已写入 E3 普查第 3 步 |
| P2「D3 加 onClick 前核实改名输入框」 | 采纳 | 已核实 `Bookshelf.tsx:325` 已有 `onClick={(e) => e.stopPropagation()}`；已写进规格作为前置条件 |
| P2「D7 钉死归一与转义的顺序」/「B1 补消费者 grep」/「批次 A §O-Q1 措辞过时」 | 采纳 | 已分别写入：先 NFKC 再转义；B1 陷阱段列明逐个确认；Q1 改为给出已核实的行号 |
| 复核报告称「`context_ref_json` 损坏时 `json_extract` 在 SQL 层返回 NULL、不抛，真正抛的是 JS 层 parse」 | **反证** | 探针实测：裸 `json_extract('[1,2,','$.a')` **抛 `malformed JSON`**（F13 抓到的错误串正是 SQLite 报错文本）；`CASE WHEN json_valid(...)` 包住后才不抛。→ "两层都要修"的结论不变，SQL 守卫**不是**冗余 |

---

## 附录：缺陷登记簿的自我更正（本轮复核确定，批次 F 一并改文档）

1. **D-TEST-09 的机制写错了**：原文写「`initDb()` 直接崩，应用打不开」。探针实测：`initDb()` **通过**，崩点是首个读设置的口子（`db.js:728` / `:2035` / `:1189`）。修法不变，**措辞要改**。
2. **D-TEST-06 的出处写错了**：原文把「损坏行在队列与统计中一致跳过」记成 §4.2-20 的承诺，实际**只写在 `db.js:2051` 的代码注释里**（§4.2-20 L330 讲的是"口径唯一"）。
3. **D-TEST-21 的影响面写重了**：原文说「用户点撤销撤走的不是他刚看到的那张卡」。复核：撤销面板用的是 `getLastUndoableReview()`（`db.js:1406-1412`，已按 `review_seq DESC`），**面板本身是对的**；错的是 `listAllReviewLogs` 这个清单口（消费者是 `optimizer.js` 与测试）。严重度应从"中"降到**低–中**（自证不变量被破 + 未来读口的陷阱）。
4. **D-TEST-19 的第一个例子不成立**：`dayLabel(NaN)` 返回 `""`（安全）；junk 来自 `dayLabel(Infinity)` / `dayLabel(1e18)` / `dayLabel("abc")` 与 `pct(NaN)`。F26 的证据标签已修（原来 `JSON.stringify(NaN)` 印成 `null`，造成误读）。
5. 新增观察（不修、登记）：`mapCardRow` 不产出 `docTitle`，SQL 里的 `li.title AS docTitle` 未被用上 —— 卡片/队列的 `docTitle` 实际总是回落 `sourceRef.title` / `null`。属显示层，建议后续单独批次。
