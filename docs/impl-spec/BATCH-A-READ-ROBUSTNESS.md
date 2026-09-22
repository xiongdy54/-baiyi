# Implementation Specification — 批次 A：读侧边界防御（脏数据不得让功能整块不可用）

> 交付对象：另一个 Coding Agent。
> **本文件是「批次 A」的详细篇**（含 7 个 Step 的可照抄代码、实测证据表、5 条必补断言）。
> 全量工作范围（批次 A–F，覆盖已确认的全部 23 条产品缺陷 + 9 条文档漂移）见同目录
> [`IMPLEMENTATION-SPEC.md`](IMPLEMENTATION-SPEC.md)——**先读那份的总表与执行纪律，再回到本文件做批次 A**。
> 两份文件冲突时以 `IMPLEMENTATION-SPEC.md` 为准（它是后写的，含复核更正）。
> 全部"现状"结论都在 2026-09-22 通过读代码 + 跑探针实测确认，未确认的项集中在文末「需要进一步确认」。
> 目标分支：`test/flow-coverage`（`tests/flows/` 与 `docs/test-flows/` 只在该分支；产品代码 `electron/`、`src/` 两分支一致）。
> **本批不碰产品以外的任何东西**：不改 schema、不改渲染层、不改 IPC 契约、不新增功能。

---

## A. Goal

让「一条坏数据」不再等于「一个页面用不了」。只做三件事：

1. **A1**：`settings.json` 内容不是对象（如 `null`）时，所有读设置的入口必须返回空配置而不是抛错。
2. **A2**：卡片任一 JSON 文本列损坏时，队列/统计/卡片浏览三个读口都不得抛错；调度状态无法判定的行在队列与统计中**一致缺席**，但仍在卡片浏览里可见可删。
3. **A3**：9 个清单函数的 `limit` / `offset` 入参归一：分数、负数、字符串、NaN、Infinity、超界、整参 `null`、标量一律不抛，且进 SQL 的 LIMIT/OFFSET 恒为整数。

对应已登记缺陷：**D-TEST-09**（A1）、**D-TEST-06**（A2）、**D-TEST-11**（A3，含本轮新发现：分数 `offset` 同样打穿）。

---

## B. Current Architecture（只列与本批相关的、已实测确认的部分）

- **进程与仓储**：Electron 主进程持有 sql.js 内存库；渲染层只经 `electron/preload.js` 的 IPC 读写；`electron/db.js`（4651 行）是唯一仓储层；`electron/settingsStore.js` 是 settings.json 门面。
- **settings 有两份读取实现**（都要改）：
  - `electron/settingsStore.js:8-14` `readSettings()`：`JSON.parse` 成功即原样返回 → `null` 直接漏出去；`db.js:44` require 它，消费者在 `db.js:306 / 727 / 752 / 1189 / 2035`。
  - `electron/main.js:100-105` 自带一份（仅 `settings:get` / `settings:set` 两个 IPC handler 用），catch 分支回 `{ app: {}, theme: {} }`，但同样漏 `null`。
- **卡行映射**：`mapCardRow(r)`（`db.js:1052-1080`）把 9 个 JSON 文本列 parse 成对象，**全部裸 `JSON.parse`**：`cloze_ords:1058`、`context_ref_json:1063`、`source_ref_json:1066`、`tags_json:1069`、`domain:1070`、`occlusion_json:1072`、`leech_json:1075`、`dict_json:1078`、`memory_ref_json:1080`；`fsrs_json:1073` 走 `normalizeFsrs`（`:1044-1050`，自带 try，解析失败回落"新卡"，不抛）。
  - 调用点仅 3 处：`getCard :1180`、`computeTodayQueue :1298`、`listAllCards :1326`；另有 `getStatsOverview` 的 KPI 循环 `:2053-2058`（自带 try/catch 跳过坏行）。
- **SQL 层还有一处 JSON 解析**（坏 JSON 时 sql.js 抛 `malformed JSON`）：`json_extract(c.context_ref_json, '$.documentId')` 出现在 3 条查询：
  - `TODAY_QUEUE_SQL`（`:1285-1289`，**模块级常量**，消费点只有 `computeTodayQueue :1297` 与 KPI 循环 `:2053`）
  - `listAllCards` 自己那份（`:1320-1325`）
  - `getStatsOverview` 的「新建卡来源」查询（`:2185-2192`）
- **清单族的入参归一**（9 个函数共用同一段，签名都是 `function f({...} = {})`）：
  `:2360 listJournalEntries`、`:2371 listJournalDates`、`:2460 listJournalEntriesSince`、`:2591 listKnowledgePoints`、`:2761 listKnowledgeRelations`、`:2862 listKnowledgeProposals`、`:3617 listInsightRuns`、`:3720 listMemoryRuns`、`:3883 listPersonalMeaningCandidates`；
  归一语句形如 `const lim = Math.max(1, Math.min(CAP, Number(limit) || DEF)); const off = Math.max(0, Number(offset) || 0);`（CAP/DEF 每族不同，offset 只有 8 族有）。

### 本轮实测证据（基线，执行者应能复现）

| 场景 | 实测结果 |
|---|---|
| `settings.json` = `null` | `initDb()` **通过**；`getActiveFsrsConfig()`（`db.js:728`）、`getStatsOverview()`→`getCutoffHour`（`:2035`）、`computeTodayQueue()`→`siblingBuryConfig`（`:1189`）三处抛 `Cannot read properties of null (reading 'app')` |
| 卡四列（fsrs/leech/tags/context_ref）同时损坏 | `computeTodayQueue` / `getStatsOverview` / `listAllCards` 三处全抛 `malformed JSON` |
| 单列损坏矩阵 | `fsrs_json` = ok、`tags_json` = ok、`leech_json` = 崩、`context_ref_json` = 崩 |
| `listJournalEntries({limit:1.5})` | 抛 `datatype mismatch`（9 族全中） |
| `listJournalEntries({limit:5, offset:1.5})` | 抛 `datatype mismatch`（**本轮新发现**，分数 offset 同样打穿） |
| `listJournalEntries({limit:null})` | 不抛，被 `Number(null)\|\|DEF` 吞成默认值（静默偏差，非崩溃） |
| `listJournalEntries(null)` | 抛 `TypeError: Cannot destructure property 'from' ... as it is null` |
| `json_valid` 在 sql.js 可用性 | 可用；`CASE WHEN json_valid(x) THEN json_extract(x, '$.a') END` 对坏 JSON 返回 NULL **不抛**（好 JSON 正常取值） |

---

## C. Required Changes

### C1 settings 读取的对象形状兜底
`settingsStore.readSettings()` 与 `main.js` 自带的那份，都要保证**返回值永远是普通对象**。不回写、不自愈、不改文件。

### C2 卡行 JSON 防御（两层，缺一不可）
- **C2-a SQL 层**：3 处 `json_extract` 用 `CASE WHEN json_valid(...)` 包住（实测可用且惰性）。
- **C2-b JS 层**：`mapCardRow` 的 9 个裸 parse 走同一个安全解析助手；损坏列记录到行对象的 `damaged` / `damagedColumns`。
- **C2-c 一致跳过**：`fsrs_json` / `leech_json` 损坏（"调度与挂起状态无法判定"）的行，**从队列与统计中排除**（两处口径一致，依据 `db.js:2051` 注释原文：「损坏行（fsrs/leech JSON 解析失败）在队列与统计中一致跳过，不再两处口径不同」）；其余 7 列损坏只回落空值，卡照常参与复习（不要因为词典快照坏了就让用户少一张卡可复习）。

### C3 清单族入参归一
新增一个内部助手，替换 9 族的 `lim`/`off` 两行；9 个函数签名从 `({…} = {})` 改为 `(opts)` + `const {…} = opts ?? {}`（`undefined`/对象行为不变，新增容忍 `null`）。

---

## D. Files / Modules to Modify

| 文件 | 改动 |
|---|---|
| `electron/settingsStore.js` | `readSettings()` 一行判断（§G Step 1） |
| `electron/main.js` | 自带 `readSettings()`（:100-105）同样判断（§G Step 2） |
| `electron/db.js` | 新增 2 个内部助手；`mapCardRow` 9 列改写 + `damaged` 标记；3 处 SQL 加 `json_valid` 守卫；KPI 循环加 damaged 过滤；9 个清单函数的签名与 `lim`/`off` |
| `tests/flows/f13-adversarial-input.cjs` | 逐列矩阵 4 列 → 9 列；新增 SQL 路径断言；3 条 `known(` 降级为 `check(`（§K） |
| `tests/flows/f19-read-api-boundary.cjs` | 新增分数 `offset` 与 `{limit:null}` 语义断言；2 条 `known(` 降级（§K） |
| `tests/flows/f18-settings-matrix.cjs` | 新增 settings=`null` 时三个入口不抛的断言；`Y3`/`Y7` 的 `known(` 按 §O-Q1 确认后降级 |

**不许动**：`src/**`、`electron/preload.js`、IPC 通道名与形状、任何 `CREATE TABLE` / migration、`persist()` 相关逻辑。

---

## E. Data Model Changes

**无。** 不新增列、不改类型、不加索引、不写 migration。
`damaged` / `damagedColumns` 只存在于 `mapCardRow` 返回的内存对象上，不落库、不参与任何 INSERT/UPDATE。
（提示：`reading_events` 没有 `is_deleted` 列，本批也不加——那是 D-TEST-23 的事，非本批目标。）

---

## F. State / Control Flow（改完之后的读路径语义）

```
cards 行
  └─ SQL（json_valid 守卫，坏 JSON 只让 docTitle 为 NULL，不抛）
       └─ mapCardRow(r)
            ├─ 9 列 safe parse；任一列 parse 抛错 → 记录列名
            ├─ fsrs_json / leech_json 坏 → damaged = true   ← 唯一会改变"可见性"的条件
            └─ 其它列坏 → 回落 null/[]，damaged 不变
                 ├─ getCard(id)            → 照常返回（可见、可删）
                 ├─ listAllCards()         → 照常返回（卡片浏览页有出口）
                 ├─ computeTodayQueue(now) → 排除 damaged；返回 { cards, deferred, damaged: [...] }
                 └─ getStatsOverview()     → KPI 与来源统计排除 damaged
```

---

## G. Detailed Implementation Steps

### Step 1 — `electron/settingsStore.js`

把 `readSettings()` 换成：

```js
function readSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    // 合法 JSON 但不是对象（null / 数字 / 字符串 / 数组）时同样兜底：调用方一律按 s.app 取用，
    // 漏出去一个 null 会让「读配置」这条路整体抛错（实测：db.js:728/:2035/:1189 三处）。
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
```

**不要**在这里做「自愈写回」（不要 writeSettings）——写回会把用户手改的文件整份覆盖，属另一个批次的决策。

### Step 2 — `electron/main.js:100-105`

```js
function readSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : { app: {}, theme: {} };
  } catch {
    return { app: {}, theme: {} };
  }
}
```

保留原有 `{ app: {}, theme: {} }` 的形状（`settings:set` 的 `all[scope][key] = value` 依赖它，改了形状等于改语义）。

### Step 3 — `electron/db.js`：新增入参归一助手

放在 `mapCardRow` 之前（`normalizeFsrs` 附近即可）：

```js
// 清单族统一入参归一（批次 A）：不得让分数/负数/字符串/NaN/±Infinity 直达 SQL 的 LIMIT/OFFSET。
// 语义沿用既有 `Number(x) || DEF`（0 / 空 / 非数 → 默认值，**不改这个语义**），
// 只补 Math.floor 保证整数——实测：limit 1.5 与 offset 1.5 都会让 sql.js 抛 datatype mismatch。
function clampLimit(limit, def, cap) {
  const n = Math.floor(Number(limit) || def);
  return Math.max(1, Math.min(cap, n));   // 有 cap 兜住 ±Infinity
}
function clampOffset(offset) {
  // ⚠️ 不能写成 Math.max(0, Math.floor(Number(offset) || 0))：Number(Infinity) 是 truthy，
  // Math.floor 后仍是 Infinity，Math.max(0, Infinity) 还是 Infinity → OFFSET Infinity 照样 datatype mismatch。
  // offset 没有 cap，必须显式判有限性并给上限。
  const n = Number(offset);
  return Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.floor(n))) : 0;
}
```

### Step 4 — `electron/db.js`：`mapCardRow` 改写

`fsrs_json` 继续走 `normalizeFsrs`（它的兜底是 §4.4.x 明文允许的"历史缺字段基线回填"，**不要改它的语义**），但**另外**判定它是否 parse 失败。

下面是可以直接照抄的完整实现（28 个字段一个都没少；`mapCardRow` **不产出** `docTitle`，它由调用方的 SQL JOIN 提供、在调用处用 `{...r, docTitle}` 合并，不要加进 mapper）：

```js
function mapCardRow(r) {
  if (!r) return null;
  // 批次 A：9 个 JSON 列文本损坏时回落空值并记录列名，绝不抛（"空"比"错"安全）。
  // 只有致命列（fsrs_json / leech_json = 调度与挂起状态无法判定）才把行标为 damaged。
  const bad = [];
  const j = (text, fallback, col) => {
    if (text === null || text === undefined || text === "") return fallback;
    try {
      const v = JSON.parse(text);
      return v === null || v === undefined ? fallback : v;
    } catch {
      bad.push(col);
      return fallback;
    }
  };
  let fsrsBad = false;
  if (r.fsrs_json) {
    try {
      JSON.parse(r.fsrs_json);
    } catch {
      fsrsBad = true;
    }
  }
  const damagedColumns = fsrsBad ? ["fsrs_json", ...bad] : bad;
  return {
    id: r.id,
    noteText: r.note_text,
    cardType: r.card_type,
    clozeOrds: j(r.cloze_ords, [], "cloze_ords"),
    cardOrd: r.card_ord,
    frontMarkdown: r.front_markdown,
    backMarkdown: r.back_markdown,
    contextPrefix: r.context_prefix,
    contextRef: j(r.context_ref_json, null, "context_ref_json"),
    mnemonic: r.mnemonic,
    example: r.example,
    sourceRef: j(r.source_ref_json, null, "source_ref_json"),
    dateStamp: r.date_stamp,
    priority: r.priority,
    tags: j(r.tags_json, [], "tags_json"),
    domain: j(r.domain, [], "domain"),
    knowledgePointId: r.knowledge_point_id,
    occlusionJson: j(r.occlusion_json, null, "occlusion_json"),
    fsrs: normalizeFsrs(r.fsrs_json),
    fsrsConfigId: r.fsrs_config_id || null,
    leech: j(r.leech_json, null, "leech_json"),
    generatedBy: r.generated_by,
    genBatchId: r.gen_batch_id,
    dictJson: j(r.dict_json, null, "dict_json"),
    memoryRefJson: j(r.memory_ref_json, null, "memory_ref_json"),
    siblingKey: r.sibling_key || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    damaged: fsrsBad || damagedColumns.includes("leech_json"),
    damagedColumns
  };
}
```

要点：
- `leech` 的语义不能变：`null` = 无挂起/无 leech 状态，`siblingBuryConfig` 与队列都按 `c.leech?.suspended` 读它。
- `fsrs_json` parse 成功但**没有 `due` 字段**（例如 `{}`）**不算 damaged**，沿用既有 `normalizeFsrs` 兜底——那是另一个议题，不在本批。
- `damagedColumns` 里出现非致命列（如 `dict_json`）时**不要**改变可见性，只作为诊断信息。

### Step 5 — `electron/db.js`：3 处 SQL 加 `json_valid` 守卫

- `TODAY_QUEUE_SQL`（`:1286`）与 `listAllCards`（`:1322`）、来源统计（`:2188`）统一改成：

```sql
LEFT JOIN documents d ON d.id = CASE WHEN json_valid(c.context_ref_json) THEN json_extract(c.context_ref_json, '$.documentId') END
```

`context_ref_json` 为 NULL 时 `json_valid(NULL)` → NULL（假），走 ELSE，不抛（已实测）。

**探针实测（2026-09-22，用本仓 `node_modules/sql.js/dist`）**：裸 `json_extract('[1,2,', '$.a')` **抛** `malformed JSON`
——F13 P1 抓到的那条错误串就是它（SQLite 的报错文本，不是 JS `JSON.parse` 的报错）；
`CASE WHEN json_valid('[1,2,') THEN json_extract('[1,2,', '$.a') ELSE NULL END` **不抛**、返回 NULL；
好 JSON 仍正常取值（`'{"a":7}'` → `7`）。→ **SQL 层守卫是必需的，不是冗余**。

### Step 6 — `electron/db.js`：两处消费点过滤 damaged 行

- `computeTodayQueue`（`:1295-1310`）：
  ```js
  const mapped = rows.map(mapCardRow);
  const damaged = mapped.filter((c) => c && c.damaged);
  const ok = mapped.filter((c) => c && !c.damaged).map((r) => ({ ...r, docTitle: r.docTitle || (r.sourceRef && r.sourceRef.title) || null }));
  // 之后 candidates / deferred 全部基于 ok 计算
  return { cards, deferred, damaged, now: nowMs };   // damaged 为新增字段（附加，不破坏既有调用方）
  ```
- `getStatsOverview` 的 KPI 循环（`:2053-2058`）：把 `try { … } catch { 忽略 }` 换成
  ```js
  for (const row of queryAll(TODAY_QUEUE_SQL)) {
    const mapped = mapCardRow(row);
    if (!mapped || mapped.damaged) continue;   // 与队列同一口径
    kpiCards.push({ ...mapped, docTitle: mapped.docTitle || (mapped.sourceRef && mapped.sourceRef.title) || null });
  }
  ```
  （`mapCardRow` 不再抛了，原来的 try/catch 变成永不触发的死代码，必须换成显式过滤，否则坏行会被算进 KPI。）
  > 顺带一个**不要动**的既有事实：`mapCardRow` 不产出 `docTitle`，所以 `mapped.docTitle` 恒为 `undefined`，
  > 上面那两处 `docTitle:` 赋值实际总是回落到 `sourceRef.title` / `null`——SQL 里的 `li.title AS docTitle` 因此没被用上。
  > 这是既有行为（显示层问题），**不是本批目标**，照抄即可，别顺手改。

### Step 7 — `electron/db.js`：9 个清单函数

每个函数做两处改动（示例为 `listJournalEntries`）：

```js
// 改前
function listJournalEntries({ from, to, query, limit = 200, offset = 0 } = {}) {
// 改后
function listJournalEntries(opts) {
  const { from, to, query, limit = 200, offset = 0 } = opts ?? {};
```

```js
// 改前
const lim = Math.max(1, Math.min(1000, Number(limit) || 200));
const off = Math.max(0, Number(offset) || 0);
// 改后
const lim = clampLimit(limit, 200, 1000);
const off = clampOffset(offset);
```

每族的 `DEF`/`CAP` 照抄原值（见 §B 行号表；`:2371` 是 400/4000、`:2460` 是 30/1000、`:2761` 是 500/2000、`:3617`/`:3720` 是 50/500，其余 200/1000）。`listJournalDates` 没有 `offset`，只改 `lim`。

**改完必须 grep 每个函数的调用点**，确认没有位置参数调用（预期只有 `db.xxx({...})` 与流程/测试调用；F19 的矩阵会用标量调，属预期）。

---

## H. Invariants（改完必须成立，逐条可验）

1. `settingsStore.readSettings()` / `main.js readSettings()` 的返回值**恒为普通对象**。
2. 脏 JSON 列不得让 `computeTodayQueue` / `getStatsOverview` / `listAllCards` / `getCard` 抛异常（任意组合、任意列）。
3. `fsrs_json` / `leech_json` 无法判定的行：在 `computeTodayQueue` 与 `getStatsOverview` 中**同时缺席**（口径一致），且能在 `computeTodayQueue().damaged` 里看到。
4. 非致命列损坏的行**不得**从队列里消失（只回落空值）。
5. 清单族对 `{limit|offset} ∈ {分数, 负数, 0, 字符串, NaN, Infinity, 1e9, null, undefined}` 与整参 `null`/标量**一律不抛**，且 LIMIT/OFFSET 恒为整数。
6. 只读路径**不得写盘**（文件大小 + mtime 双证不变量，沿用 F19 Z5）。
7. **没有损坏行时，本批改动不改变任何用户可见结果**（队列成员、KPI、卡片浏览、清单分页逐值一致）。
8. `persist()` / 落盘时机 / 事务语义完全不变。

---

## I. Error Handling

- 读侧兜底**必须静默**（不 console.error 每行刷屏），但**不得不可观测**：damaged 行进 `computeTodayQueue().damaged`。
- 写路径的抛错语义**不变**（如 `saveReview` 对不存在的卡继续抛；`setActiveFsrsConfig` 对不存在的 config 继续抛）。
- 不要在 `readSettings` 里做任何"修复文件"的动作：坏形状只兜底，不覆盖用户文件。
- 不要把 SQL 守卫写成 `WHERE json_valid(...)=1`（那会把 `context_ref_json` 为 NULL 的正常行也过滤掉，改变 docTitle 之外的行为语义）——必须是 `LEFT JOIN ... ON ... CASE ...`。

---

## J. Backward Compatibility

- `library.db` / `settings.json` 格式零变化；旧库、旧备份、跨版本恢复照常。
- `mapCardRow` 返回值**新增** `damaged` / `damagedColumns` 两个字段；IPC 返回体因此多字段，渲染层忽略未知字段，无需改动（执行者需用 F28/F22 回归确认没有 `JSON.stringify` 全量比较的断言被打到）。
- 清单函数签名 `({…} = {})` → `(opts)` + `opts ?? {}`：对象与 `undefined` 行为**逐值不变**；新增容忍 `null` 与标量。
- 回滚方式：本批全在读路径，无数据副作用 → `git revert` 即回滚，不需要数据修复脚本。

---

## K. Testing Requirements

### K1 必跑回归
```bash
node tests/flows/run.cjs --hours 0.05 --gap 0      # 3 分钟 ≈ 8 轮 × 32 条自动流程（实测 255 次运行，单轮约 25 秒）
```
**不要用 `--cycles 1`**：`run.cjs` 的内层 break 会让它在第一条流程后就收工（实测只跑 1 条）。

期望：**0 新增判红、0 崩溃**；并且下面 5 条 `known` 会变成「意外转绿」（这是**好事**，说明缺陷被修掉），必须同时把它们从 `known(...)` 降级为普通 `check(...)`，并从 `docs/test-flows/DEFECTS.md` 标注为已修复：
- `f13-adversarial-input.cjs`：`损坏行不导致队列抛异常`、`损坏行不导致统计抛异常`、`损坏行不导致卡片浏览抛异常`（三条同属 D-TEST-06）
- `f19-read-api-boundary.cjs`：`分数 limit 必须归一为整数`、`显式传 null 必须等同于未传`（两条同属 D-TEST-11）
- `f18-settings-matrix.cjs`：`Y3`/`Y7` 里与 settings=`null` 相关的 `known`（**见 §O-Q1**）

### K2 必须新增的断言（缺一条即视为未完成）
1. `f13` P1 逐列矩阵：4 列 → **9 列**（补 `cloze_ords` / `source_ref_json` / `domain` / `occlusion_json` / `dict_json` / `memory_ref_json`），逐列断言「不抛」。
2. `f13` 新增：`context_ref_json` 损坏时 `listAllCards` / `computeTodayQueue` / `getStatsOverview` 的 SQL 路径不抛（这条专测 `json_valid` 守卫，防止只修 JS 层）。
3. `f13` 新增：`fsrs_json` 损坏的卡**不在**队列、也不在 KPI 计数里，但 `getCard` 仍取得到（口径一致 + 有出口）。
4. `f19` Z2 新增：`offset: 1.5` 不抛且结果与 `offset: 1` 一致；`{limit: null}` 与不传 `limit` 结果一致。
5. `f18` 新增：`settings.json = "null"` 时 `getActiveFsrsConfig()` / `getStatsOverview()` / `computeTodayQueue()` 三个入口都不抛（把本文件的探针固化成流程）。
6. `f13` 新增：**仅 `tags_json` 损坏**（非致命列）的卡**仍必须出现在** `computeTodayQueue().cards` 里——守 §H 不变量 4「非致命列损坏不改变可见性」。缺这条会把 A2 修成"任何一列坏就少一张卡"的过度跳过。

### K3 夹具要求
- 损坏行的构造必须走**磁盘审计句柄**（`tests/flows/lib/dbenv.cjs` 的 `audit()`），不要用产品 API（产品 API 写不出坏 JSON）。
- 新增断言一律**不挂 `known`**（它们应当从第一天起就是绿的）。

---

## L. Acceptance Criteria

1. §K1 的 5 条 `known` 全部转绿且已降级为 `check`。
2. `node tests/flows/run.cjs --hours 0.05 --gap 0` 输出：无 `FAIL`、无新增「意外转绿」（除上面 5 条已处理者）。
3. §K2 的 5 组新增断言全绿。
4. 无损坏行夹具下 F28 X2（KPI 与自算 oracle 对账）与 F31 J1/J2 仍逐值一致 → 证明「正常数据行为不变」。
5. F10 的性能棘轮不转红（队列热路径新增了 `json_valid` 调用，需实测确认无退化）。
6. `git diff --stat` 只涉及 §D 表中列出的文件（外加本次新增的测试断言）。

---

## M. Potential Risks

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 性能 | `json_valid` + `CASE` 加在队列热路径（每次队列计算都跑，见 `:1285`） | 跑 F10 对比；若退化明显，先加 `c.context_ref_json IS NULL OR json_valid(...)` 短路 |
| R2 可见行为变化 | `fsrs_json` 损坏的卡从「以新卡身份出现」变成「从队列与统计消失」 | 这是 `db.js:2051` 注释的既定意图；必须写进提交信息，并在 §K2-3 断言里固定下来 |
| R3 静默丢卡 | damaged 行在卡片浏览可见、在复习队列不可见，用户可能以为卡丢了 | 已通过 `computeTodayQueue().damaged` 暴露；UI 提示是**后续批次**（非本批目标） |
| R4 两份 readSettings 长期分叉 | 本批只各自兜底，不合并（合并要动 `settings:set` 写路径） | 记录为后续批次；本批在注释里点明存在两份 |
| R5 damaged 字段进 IPC | 若某处对卡片对象做全量 `JSON.stringify` 比较 | 用 F28/F22 回归确认 |
| R6 漏改调用点 | 9 个函数签名变更 | F19 的 1376 次调用矩阵兜底；改完逐个 grep 调用点 |

---

## N. Explicit Non-Goals（明确不做）

- **其它已登记缺陷**：D-TEST-01（FSRS 配置落盘）、08（明文 Key）、12/23（日桶与已删书过滤，且这两条必须同批）、13/14（键位）、15（写入口全量校验）、17/18（文件名净化 / assets 软删）、21/22（排序不变量 / 导入清洗）、以及卫生包 02/03/07/10/16/19。
- **文档↔代码漂移 9 条**（D-DOC-01…09）：改文档、不改代码，另批次。
- **同类裸 parse 的其它模块**：`db.js` 另有 14 处 `JSON.parse(r.…)`（extracts `:815/:1992`、material_maps `:3955/:3962/:4092`、mindmap `:4186`、ai_gen_batches `:4318/:4319` 等）——本批**只修 cards**，其它面记录在案、待单独批次。
- 不新增 UI、不新增 IPC 通道、不改 schema、不写 migration、不做自愈写回、不引入遥测/日志框架。
- 不重构 `db.js` 的其它部分（包括不合并两份 `readSettings`）。

---

## O. 需要进一步确认（执行前必须逐条落实，不要自行假设）

- **Q1**：`f18-settings-matrix.cjs` 里 `Y3`/`Y7` 的 `known(...)` **确切断言名**。已知位置：`Y3` 段 `:256` 起、`:276` 是「合法 JSON 但非对象（null/0/true/字符串）也必须回退为默认对象」；`Y7` 段 `:335` 起、`:369` 是「非对象设置下应用必须仍能启动」。执行前先 `grep -n "known(" tests/flows/f18-settings-matrix.cjs` 逐条核对，**核对不上就先别动这两条**。
- **Q2**：**规范级依据缺失**。全指南检索「损坏行 / 一致跳过 / 不得穿透」**零命中**：这条口径只写在 `electron/db.js:2051` 的代码注释里。本批次以该注释 + §4.2-20「口径唯一」为设计依据；若需要指南级条款，属文档收口（D-DOC 系列），**不是实现前提**，但请勿在提交信息里把它写成"指南 §x 要求"。
- **Q3**：9 个清单函数的**全部调用点**（`electron/main.js`、`src/**`、`tests/**`）需逐个 grep，确认没有位置参数或第二参数用法（预期没有）。
- **Q4**：`computeTodayQueue` 返回体新增 `damaged` 字段后，渲染层是否有解构/白名单式消费会被影响（`src/lib/*.ts` 里搜 `todayQueue`）。预期只读 `cards`/`deferred`。
- **Q5**：`clampLimit` 对 `limit:0` 的既有语义是"回落默认值"（`Number(0) || DEF`）。本批**保持**该语义（不改）；若产品希望 `0` 表示"不要结果"，那是另一个决策，需用户拍板。
