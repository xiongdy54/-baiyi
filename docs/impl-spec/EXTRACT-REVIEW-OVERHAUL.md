# 摘录复习改版规格（草案 v1，待裁定）

> **交付对象**：`摘录复习改版` 分支（从 `main` 667ca55 拉出；执行期间 `main` 保持不动）。
> **本文件性质**：**计划与契约草案，零代码改动**。执行前需按 §O 拿到裁定并 bump `AI_DEVELOPMENT_GUIDE.md`。
> **用户原始口径**（2026-09-24，逐字保留关键约束）：
> ① 设置界面加开关「切换为传统 supermemo 复习方式」，允许摘录卡片合并进复习队列随闪卡一同复习；复习时有时会推送一张摘录卡片让用户继续处理、阅读或制卡；**摘录卡片的文字内容与闪卡一样可编辑修改**；摘录卡片展示页改为「类似闪卡复习页面的沉浸式连续处理摘录内容」的页面；用户仍可从该界面进入处理/阅读/制卡；**摘录展示页原来的管理功能移入卡片浏览器**；卡片浏览器同时管理闪卡与摘录，并升级为 Anki 式（多选、全选、筛选、批量处理）。
> ② 关闭该设置时闪卡与摘录分开复习，摘录仍在沉浸式连续处理页中处理；其列表管理同样移到卡片浏览器。
> ③ 摘录默认推送＝SuperMemo 机制（用户裁定「按 supermemo 的算法来」，即**解冻** §9.4 的「×1.6 占位」项）；允许切换为用户自研机制并**标注为实验/早期开发阶段**；切换必须**无损**。
> ④ 追加裁定：所有书有默认优先级 + 书架提供手动设置优先级的按钮；复习时提供**毕业按钮**（毕业后不再推送、但仍保留在卡片浏览器中）；卡片浏览器支持**按所属书**分类闪卡与摘录；**Ctrl+Z 撤销要配置好**。
> ⑤ 混编规则提供「上限 1:4」与「按到期时间自然混排」两种，且**支持无损切换**；合并开关**默认关**。
> ⑥ 自研机制＝§6.4.1「下一条摘录推荐 Next Extract」。
> ⑦（第二轮）阅读器新增「复习此书摘录 / 复习此书闪卡」两个集中复习按钮（相当于筛选出来源于该书的卡片集中复习，**复习记录照常计入 FSRS**，类 Anki 筛选牌组）；**卡片浏览器也要能创建筛选牌组**。
> ⑧（第二轮）摘录处理除「推进到下一张」外，还需：「推迟」按钮（**用户输入天数**）与「优先级」按钮（显示当前值、点击快速变更）。
> ⑨（第二轮）摘录卡片要有跳转回原文位置的功能，且**与闪卡一致：跳转产生的位置不得写入阅读进度**（阅读进度是对文章当前所在位置的记忆，必须排除跳转造成的位移）。
> ⑩（第二轮）设置新增四类每日上限（新卡 / 新摘录 / 卡片复习 / 摘录复习），并**对调整幅度设限**（参考 Anki）。
> ⑪（第二轮裁定）§O 全部按建议执行，**两处覆盖**：O-4 改为「按 SuperMemo 的次日进队」，O-11 硬边界倍数取 **5×**。用户已授权「提交并开始做」。

---

## A. 目标与非目标速览

| 编号 | 目标 | 批次 |
|---|---|---|
| G1 | 书级默认优先级 + 书架设置入口 | 1 |
| G2 | 摘录真 SuperMemo 调度语义（A-Factor 间隔增长、读后推进、推迟、毕业） | 1 |
| G3 | 摘录写 API 面补齐（编辑文本/改优先级/改状态/删除/推进） | 1 |
| G4 | Ctrl+Z 撤销覆盖全部新增操作（含批量、跨卡片与摘录） | 1 + 4 |
| G5 | 会话队列口径：卡片 ∪ 摘录，两种混编模式，零写库 | 2 |
| G6 | 合并开关 + 混编模式 + 推送引擎三键，默认关/SM/1:4 | 2 |
| G7 | 推送引擎双向无损切换（SM ↔ 实验 §6.4.1） | 2 + 5 |
| G8 | 沉浸式摘录连续处理页（可编辑正文 + 阅读/制卡/推迟/毕业入口） | 3 |
| G9 | 复习页在混合会话中渲染摘录卡面（与 G8 共享组件） | 3 |
| G10 | 卡片浏览器 2.0：统一数据源 + 搜索语法 + 多选/全选 + 批量 + 按书分组 | 4 |
| G11 | 实验推送引擎（§6.4.1）接入与实验标识 | 5 |
| G12 | 新摘录**次日进队**（按 SM 口径，用户裁定 ⑪） | 1 |
| G13 | 阅读器两个集中复习按钮（本书摘录 / 本书闪卡） | 3 |
| G14 | 筛选牌组（保存的复习范围）＋ 浏览器创建入口 | 4 |
| G15 | 摘录「推迟 N 天」与「优先级」按钮 | 1 + 3 |
| G16 | 跳转原文对阅读进度**零写入**（卡片与摘录一致） | 3 |
| G17 | 四类每日上限 + 限幅（硬边界 / 建议档 / 结构闸） | 2 |
| G18 | 每日用量派生计数（零新状态、可重算） | 1 |

**显式非目标**（写明边界，防止执行时扩口径）见 §N。

---

## B. 现状实测（file:line，均为本次核对）

### B.1 摘录数据与调度

| 事实 | 位置 |
|---|---|
| `extracts` 表定义（15 列；`workflow_state_json` 是**死列**：INSERT 恒 NULL、无人读） | `electron/db.js:98-114`、`:2221-2222` |
| `createExtract`：`topic_next_at = now`（**一建即到期**）、`interval_days = 1`、无 return-value 之外的副作用 | `electron/db.js:2214-2238` |
| `listDueExtracts`：`WHERE topic_next_at <= now ORDER BY priority ASC, topic_next_at ASC` | `electron/db.js:2255-2272` |
| `postponeExtract`：`interval = min(prev × 1.6, 180)`、`next_at = now + interval` | `electron/db.js:2290-2303` |
| `parentChain`（层级，深度上限 5） | `electron/db.js:2240-2253` |
| **不存在的 API**：`updateExtract` / `deleteExtract` / 状态写入 / 优先级写入 / 读后推进。`m4.cleanup.cjs:2` 明文「无删除 API」 | — |
| 摘录无任何索引 | `electron/db.js:371-659` 无 extracts 项 |
| IPC 面：`extracts:create / listDue / get / postpone` 四通道 | `electron/main.js:431-437`、`electron/preload.js:52-57` |
| 前端 Provider：`sm19Provider`（`setPriority` 是**空实现**） | `src/lib/readingWorkflow.ts:53-73` |

**推论（本次改动的根因）**：现有摘录一旦到期就**永远到期**——没有任何动作会推进 `topic_next_at`（只有推迟会），也没有状态位可以让它退出队列。在「合并进复习会话」场景下这会让同一条摘录被无限重复推送。

### B.2 队列与复习

| 事实 | 位置 |
|---|---|
| `computeTodayQueue(now)`＝今日队列与「今日到期」统计的**唯一口径** | `electron/db.js:1436-1457`、`TODAY_QUEUE_SQL :1426-1430` |
| `listDueCards = computeTodayQueue().cards` | `electron/db.js:1459-1463` |
| 同源卡延后＝**队列视图、零写库**（可借用的先例） | `electron/db.js:1370-1424`、指南 §4.16（`AI_DEVELOPMENT_GUIDE.md:316`） |
| 复习会话循环：`todayQueue()` → 取 `cards[0]` | `src/components/ReviewView.tsx:70-74` |
| 复习页动作集（撤销/跳转原文/查看原图/助记/对比卡/标记暂停/跳过/删除） | `src/components/ReviewView.tsx:477-524` |
| **既有闸门**：`队列与 listDueCards 口径唯一` 断言 | `tests/flows/f03-scheduling-conservation.cjs:200` |
| 评分写入与撤销：`saveReview` / `getLastUndoableReview` / `undoLastReview`；`review_seq = MAX(review_seq)+1`（**表内**单调） | `electron/db.js:1489-1546`、`:1510`、`:1572-1591`、`:1597+` |
| FSRS 撤销不变量（review_seq 最新 ∧ before+after 快照齐 ∧ 8 字段全等） | 指南 §4.4.9（`:163`） |

### B.3 摘录展示页与卡片浏览器

| 事实 | 位置 |
|---|---|
| `QueueView`（86 行）＝计数 + 空态 + 列表；行内仅三个动作：推迟 / 跳转原文 / 打开阅读 | `src/components/QueueView.tsx:31-84`、`:57-79` |
| 摘录打开＝合成单章 EPUB 进阅读内核（`extractReader` 视图） | `src/App.tsx:400-416` |
| 顶栏导航 6 项：书架 / 队列 / 复习 / 卡片 / 日记 / 数据 | `src/App.tsx:443-458` |
| `CardBrowser` 现状：预设 `all/due/leech/deferred/knowledge`、搜索（题面/答案/前缀/来源/领域/标签，NFKC 折叠）、类型/状态筛选、四种排序、行详情（复用复习 `CardFace`/`EditableText`）、Leech 六步 | `src/components/CardBrowser.tsx:20`、`:136-184`、`:194-214`、`:334-564` |
| `CardBrowser` **缺失**：多选 / 批量 / 分页（全量渲染 `:312-328`）/ 摘录条目 / 按书分组 / 列头排序 / 复习日志历史 | — |
| 卡片与摘录的关联只有**上下文引用**：`cards.context_ref_json.extractId`（无 FK 列） | `src/lib/cards.ts:841-860` |

### B.4 契约与闸门（改动必须同步的地方）

| 契约 | 锚点 |
|---|---|
| §4.1 数据表（27 张） | `AI_DEVELOPMENT_GUIDE.md:87` |
| §4.2 必须保留的接口/**25 项**；其中 **9 `ReadingWorkflowProvider` 已预留 `nextTopic/postpone/setPriority/serializeState`**、**20 `SiblingQueueView`＝今日队列唯一口径** | `:116`、`:126`、`:137` |
| §4.4 FSRS 调度契约（硬性，含撤销不变量） | `:151-165` |
| §4.12 LKM 与 FSRS 隔离边界（禁写 `fsrs_json/leech_json/fsrs_config_id/review_logs/priority/due`——**主体是 LKM**） | `:258-265` |
| §6.2 已实现功能规格（学习队列 / 连续复习 / 卡片浏览三条要重写） | `:506-527` |
| §6.4 Topic 队列与 Next Extract（§6.4.2 状态机**已定契约、未实现**） | `:661-683` |
| §7.4 设置键登记表 | `:879-887` |
| §8.1 决策日志（D1–D57） | `:914-975` |
| §8.3 版本变更记录 / §9.1 主线批次 / §9.4 可选池 / §9.5 下一步 | `:994` / `:1016` / `:1525` / `:1557` |
| 闸门测试：`f11`（文档↔代码漂移）、`f18`（设置键：`DOC_KEYS :34-42`、round-trip `:203-237`、`DOCUMENTED_SCOPES :195`） | `tests/flows/` |

### B.5 SuperMemo 机制核对的结论（含**已文档化 / 未文档化**分界）

官方 help（`help.supermemo.org` 对机器人 403，经 Wayback 快照核对）与 `supermemo.guru` 可确认的规则：

| 规则 | 状态 |
|---|---|
| 主题（topic）间隔按恒定倍率增长：`下次间隔 = 当前间隔 × A-Factor`；主题 A-Factor 下限 `1.01` | 已文档化 |
| 优先级 0% 为最高；学习日开始时按优先级自动排序，**优先级高的先处理** | 已文档化 |
| 主题流入限制：**「limit the inflow of topics to 1:4 or less」** | 已文档化 |
| 推迟按延迟因子表达（`1.1` = 延长 10%）；**推迟后间隔至少比今天多 1 天**；批量推迟有跳过条件（间隔 > 2500 天 / A-Factor < 1.01 / 已推迟 > 250 次 / 优先级越阈） | 已文档化 |
| 自动推迟（auto-postpone）在开始学习前把积压推迟，并**保留前 N 条高优先级**（示例值 50） | 已文档化 |
| 处理主题的动作：`Next repetition`（间隔 × A-Factor）/ `Extract`（子元素入学习流程）/ `Done`（若有子元素则提议 dismiss，否则提议删除）/ `Dismiss` / 分支推迟 | 已文档化 |
| 新建主题的**首次间隔由用户指定**（无官方默认值）；SM 只展示「过去导入的」文章 | 已文档化 |
| 优先级↔间隔联动（缩短间隔→优先级上升；推迟→优先级下降）「是自动的」 | 已文档化（**但未公布公式**） |
| 主题 A-Factor 的具体默认值 / 由摘录数量推导 A-Factor | **NOT FOUND（不存在于 SM15–19 help）** |
| 默认推迟倍率 ×1.6 | **NOT FOUND** |

> **本项目取值口径（明确标注为「本项目选择」而非「SM 事实」）**：`a_factor` 默认 **1.6**——它恰好等于现行 `postponeExtract` 的 ×1.6 与 `QueueView` 文案里的 `intervalDays * 1.6`，因此**存量行为零变更**可作为回归基线；优先级↔间隔自动联动与自动推迟**不实现**（理由见 §N）。

---

### B.6 第二轮补充核实的既有事实

| 事实 | 位置 |
|---|---|
| **跳转不写进度**的既有机制：`jumpAnchor` 存在时不传 `onProgress`（滚动/卸载保存全部失效），阅读进度与**阅读字数**保持上次真实阅读值；`onBack` 也改为返回 `returnTo` 而非书架 | `src/App.tsx:374-378`（注释即此语义） |
| `HandleJumpToDoc` 统一入口（卡片/摘录共用），`returnTo ∈ "review" \| "queue" \| "browse"` —— 新增来源需扩取值 | `src/App.tsx:298-316`、`:42` |
| 阅读器工具条按钮组（「目录」「导图」）＝新增两个复习按钮的落点 | `src/components/Reader.tsx:1575-1585` |
| **每日上限完全不存在**：无 new-per-day / reviews-per-day / daily-limit 任何实现（仅 §4.16 同源延后有 `perDay` 配额，默认 1） | `electron/db.js:1329-1339` |
| 学习日唯一口径函数 `learningDayStartMs(ts, dayCutoffHour)`（§4.4.8-③；现只有两个使用点：统计、§4.16 队列配额） | 指南 `:162`、`:296` |
| 摘录跳转已存在（`QueueView` 的「跳转原文」）并已走同一 `handleJumpToDoc` | `src/components/QueueView.tsx:60-76` |

> **Anki 参照（本轮新查证，官方文档口径）**
> - 牌组上限两项默认：新卡/day 与 复习/day；**「New Cards Ignore Review Limit」默认关**——复习上限用尽时**新卡被阻断**。
> - 官方对数量关系的表述：「20 new cards/day … expect daily reviews to be roughly about 200 cards/day」⇒ **10× 量级**。
> - 超限行为：**提示建议提高上限**（"Hidden reviews trigger a message suggesting increase"）——Anki 是**软提示不是硬拦**；用户要求「设限」⇒ 本规格加严（见 §F.5）。
> - 计数重置：未用满或漏一天，次日回到原设定（无结转）。
> - 筛选牌组：按搜索串 + 上限临时移出原牌组；**默认作答会重排卡片**（另有 reschedule 开关可关）；清空/删除即归还原牌组。
> - 许可证边界不变：只参考手册与行为，零代码搬运（见 §H）。

---

## C. 数据模型改动

所有列一律走既有 `ALTER TABLE ... try/catch` 迁移惯例（先例：`cards.domain` `db.js:226`、`fsrs_config_id :274`、`dict_json :343`、`sibling_key :350`、`memory_ref_json :474`）。

### C.1 `library_items` 新增 1 列

```sql
ALTER TABLE library_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 50;
```
书级默认优先级（G1）。存量书迁移后一律为 50 ＝ 现行摘录默认优先级，**不改变任何现有排序**。

### C.2 `extracts` 新增 8 列

| 列 | 类型/默认 | 用途 |
|---|---|---|
| `status` | `TEXT NOT NULL DEFAULT 'open'` | §6.4.2 v1 状态机（本次实现，见 C.4） |
| `status_version` | `INTEGER NOT NULL DEFAULT 1` | 状态词汇表版本（§6.4.2 已定契约） |
| `status_detail_json` | `TEXT` | 开放对象（搁置原因/恢复条件/推迟计数等） |
| `a_factor` | `REAL NOT NULL DEFAULT 1.6` | SM 间隔倍率（**存量=1.6 与现行 ×1.6 等值**） |
| `postpone_count` | `INTEGER NOT NULL DEFAULT 0` | 推迟计数（供批量推迟跳过条件与实验引擎特征） |
| `process_count` | `INTEGER NOT NULL DEFAULT 0` | 「读后推进」次数（＝SM 的主题重复次数） |
| `priority_source` | `TEXT NOT NULL DEFAULT 'book'` | `book`（继承书优先级）/ `user`（用户单条覆盖） |
| `engine_state_json` | `TEXT` | 每引擎私有子空间（无损切换载体，见 §E） |

`workflow_state_json`（死列）**保留不删**：按 §8.2 已接受偏差惯例登记为「历史预留、零消费者」，不得复用其语义。

### C.3 新增两张表

**`extract_ops`（摘录操作日志，append-only，撤销＝物理删除尾条，镜像 `review_logs` 的撤销语义）**

```sql
CREATE TABLE IF NOT EXISTS extract_ops (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,              -- 全局操作序（见 C.3 末），唯一索引
  extract_id TEXT NOT NULL,
  op_type TEXT NOT NULL,             -- edit|advance|postpone|graduate|ungraduate|set_priority|set_status|delete
  batch_id TEXT,                     -- 批量操作归组；同一批量共享一个 batch_id
  before_json TEXT NOT NULL,         -- 逆操作所需的完整前置状态
  after_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

**`op_journal`（跨类撤销排序，纯索引：载荷仍在 `review_logs` / `extract_ops`）**

```sql
CREATE TABLE IF NOT EXISTS op_journal (
  seq INTEGER PRIMARY KEY,           -- 与 extract_ops.seq 同源（同一计数器）
  kind TEXT NOT NULL,                -- card_grade | extract_op
  ref TEXT NOT NULL,                 -- review_logs.id / extract_ops.id
  undoable INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
```

**全局操作序**：

```sql
CREATE TABLE IF NOT EXISTS op_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next INTEGER NOT NULL
);
-- 播种：INSERT OR IGNORE INTO op_counter(id, next) VALUES (1, 1)
-- 分配：事务内 UPDATE op_counter SET next = next + 1 后取回
```

`op_journal.seq` 与 `extract_ops.seq` **同取此计数器**——它是跨类撤销排序的来源。
- **与 `review_logs.review_seq` 相互独立**（2026-09-25 修正）：`review_seq` 的分配语义**一字未改**（仍 `MAX(review_seq)+1`、表内唯一单调、撤销删除后**允许复用**，§4.4.9 排序不变量完整保留）。曾试过让两者共享计数器，实测会破坏「撤销只删最大 seq ⇒ 序号稠密」这一既有可测性质（`f38-write-fuzz.cjs` 的 F38-8j 即其代理断言，差分实测新增 4 条失败），故回退为独立计数器——跨类排序由 `op_journal` 承担，`review_seq` 无需参与。
- **不再需要「行为差异核对」**（2026-09-25 修正）：因两者独立，`review_logs` 的分配与撤销语义、`f03`（队列口径）、`f38-8j`（序号稠密）等既有断言**全部不受影响**——差分实测已确认。

### C.4 状态机（落地 §6.4.2 v1，一次到位）

- v1 词汇：`open / reading / carded / consolidating / resolved / postponed / dismissed / archived`（`status_version = 1`）。
- **前向兼容硬约束**（§6.4.2 原文）：读取到**未知**状态一律按 `open` 对待 ⇒ 队列过滤必须写成**排除式白名单**：
  ```sql
  AND COALESCE(status,'open') NOT IN ('resolved','dismissed','archived')
  ```
  不得写成 `status IN ('open',...)`（那样未知值会被误排除）。
- **毕业**（用户口径 ④）＝ `status='resolved'`，写 `status_detail_json = {graduatedAt, source:'user'}`，**不删行、不归档**，浏览器可见可筛可召回（召回＝`status='open'`，走同一条撤销/操作通道）。

**动作 → 状态 / 调度 映射（消除歧义，执行时不得另立语义）**

| 动作 | 调度写入 | 状态写入 | 撤销 |
|---|---|---|---|
| **新建摘录**（阅读器摘录） | `topic_next_at = 下一个学习日切点`（要求 ⑪，**次日进队**；存量行不动） | `open` | 可撤销（＝软删该摘录） |
| 打开原文（进阅读器） | 无 | `open → reading`（若当前为 `open`） | 可撤销（状态回退） |
| 编辑正文 | 无 | 不变 | 可撤销（恢复旧正文） |
| **下一条**（沉浸式页主按钮） | **`advance`**：`interval_days ×= a_factor`；`topic_next_at = now + interval_days`；`process_count++` | `reading → carded`（本次已制卡时）/ 保持 `reading`；`postponed → open` | 可撤销（恢复三个字段） |
| 就此制卡（进入制卡面板并落卡） | 无（**制卡不改摘录调度**，与现状一致） | → `carded` | 卡片的撤销走卡片通道（既有） |
| 推迟 | **两条路径，UI 必须区分**：① 沉浸式页「推迟」＝`postponeDays`（**用户输入 N 天**，覆盖式：`interval_days = N`、`topic_next_at = now + N 天`）；② 批量推迟与快选预设「按算法推迟」＝`interval_days = min(interval_days × a_factor, 180)`。两者都 `postpone_count++` | → `postponed` | 可撤销 |
| 毕业 | 无（由状态排除出队列，`topic_next_at` 保留原值以便召回后位置可解释） | → `resolved` | 可撤销 |
| 召回（反毕业） | 无 | `resolved → open` | 可撤销 |
| 软删（仅浏览器批量） | 无 | 不变 | 可撤销（取消软删） |

- **制卡入口**：沉浸式页「制卡」复用既有制卡面板（`Reader.tsx:1749-1760` 的选区菜单链路），材料＝该摘录正文、锚点＝该摘录的 `contextRef`；**不新造制卡路径**。

### C.5 索引（新表与热列）

```sql
CREATE INDEX IF NOT EXISTS idx_extracts_due ON extracts(topic_next_at) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_extracts_status ON extracts(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_extract_ops_seq ON extract_ops(seq);
```

---

## D. 接口面（新增/改造）

### D.1 主进程 IPC（新增）

| 通道 | 语义 |
|---|---|
| `extracts:update` | 改 `content_markdown`（**用户口径①要求正文可编辑**）；写 `extract_ops` |
| `extracts:setPriority` | 单条改优先级（`priority_source='user'`） |
| `extracts:setStatus` | 毕业/召回/搁置/归档（`resolved`/`open`/`postponed`/…） |
| `extracts:advance` | **读后推进**：`interval_days = interval_days × a_factor`；`topic_next_at = now + interval`；`process_count++` |
| `extracts:delete` | 软删（`is_deleted=1`），仅浏览器批量入口 |
| `extracts:batch` | 批量：`{op, ids[], payload}`，**单事务**、单 `batch_id`、单次 persist、单条撤销条目 |
| `extracts:queue` | 会话队列（见 §F），返回混合条目 |
| `library:setPriority` | 书级优先级（G1） |
| `extracts:postponeDays` | 用户指定天数推迟（要求 ⑧）：`topic_next_at = now + N 天`、`interval_days = N`、`postpone_count++`（**覆盖式**，区别于 `advance` 的乘性推进） |
| `limits:usage` | 只读派生用量与余额（§F.5） |
| `undo:last` | 跨类撤销分发（见 §G） |

写路径纪律沿用既有：**BEGIN/COMMIT → COMMIT 后 persist → IPC 成功**才算成功（§4.4.9）；失败走既有 `persistNow` 重试横幅，不得静默降级。

### D.2 `ReadingWorkflowProvider` 落地为「可切换引擎」（§4.2-9 的现成落点）

指南 §4.2-9 原文即 `nextTopic/postpone/setPriority/serializeState`，且 `readingWorkflow.ts:2-3` 注释写明「用户重设计流程时：新写一个 Provider 替换下方赋值，UI 不动」。据此：

| Provider | 内容 |
|---|---|
| `sm19-default`（默认，本次补齐） | SM 语义：`advance = interval × a_factor`、`postpone = min(interval × a_factor, 180d)`、按 `priority ASC, topic_next_at ASC` 排序 |
| `ai-next-extract`（实验） | §6.4.1：`extractScore` 六因子 + 两阶段（本地 Top20 → AI 重排与解释），离线回退「到期 + priority」基线 |
| 名称 | 落 `settings.app.extracts.engine`，**Provider 名称即持久化值**（禁自造第三套命名） |

`serializeState()/restoreState()` 从签名空位升级为**引擎状态序列化**（§E 的无损载体）。

---

## E. 无损切换（G7，本规格的核心难点）

### E.1 两类「切换」的语义分离

| 切换对象 | 是否写调度状态 | 无损保证 |
|---|---|---|
| **混编模式**（1:4 ↔ 按到期） | **零写库**（纯排序函数） | 构造性无损：切换后当日剩余集合恒等（见 §E.3） |
| **推送引擎**（SM ↔ 实验） | 各自私有子空间 | 逐字段可复现无损（见 §E.4） |

### E.2 引擎私有子空间与公共投影

- **公共投影列**（既有的列，继续承担队列查询与浏览器展示）：`topic_next_at`、`priority`、`interval_days`、`status`——**永远等于「当前生效引擎」的值**。
- **私有子空间**：`engine_state_json = { "sm19-default": {nextAt, intervalDays, aFactor, postponeCount, processCount, priority}, "ai-next-extract": {nextAt, score, rankedAt, explain, fingerprints} }`。
- 写入路径：任何引擎的写入先更新**自己的**子空间，再由**投影函数**把生效引擎的值写进公共列。**禁止**任何引擎直接写另一引擎的子空间。
- 读取路径：`listDueExtracts` 等既有查询**除 §C.4 的状态过滤外零改动**（调度列一律照读公共投影列，不感知引擎）；浏览器另显示「非生效引擎的计划日期」为只读信息（可选项，见 §O-7）。

### E.3 混编模式的无损（构造性）

- 两种模式都是 `f(卡片到期集, 摘录到期集, mode)` 的**纯函数**，不写任何表。
- `quota-1-4`：每 4 张卡之后最多放行 1 条摘录；**超出配额的摘录当日不展示、但 `topic_next_at` 不动**（先例：§4.16 同源延后＝队列视图零写库）。切到 `by-due` 后它们立即可见。
- **可测不变量**：`mode` 切换前后，`当日剩余卡片集合` **恒等**；`当日剩余摘录集合` 在 `quota` 模式下是 `by-due` 模式的**子集**（且未被配额放行的那些在库中仍为 due）。

### E.4 引擎切换的无损（逐字段）

切换动作 = ① 改 `settings.app.extracts.engine`；② 写一条 `engine_switch` 记录（时间戳 + 切换瞬间的公共投影快照 + 两侧子空间快照）；③ 投影新引擎的值到公共列。

**验收判据（必须实测）**：`A → B → A` 往返后，`sm19-default` 子空间的 `{nextAt, intervalDays, aFactor, postponeCount, processCount, priority}` **逐字段等于切换前**；且 B 期间的写入只出现在 `ai-next-extract` 子空间。
**冷启动**：目标引擎子空间为空时，用切换瞬间的公共投影播种（并在 `engine_switch` 记录里标注 `coldStart:true`，使「实验引擎首次切换」可审计、可解释）。
**存量迁移**：`engine_state_json` 为空的行 → 播种 `sm19-default` 子空间＝现行公共列值（等价现状）。
**归一冲突**：切换后若两引擎给出的 `nextAt` 相差超过阈（建议 30 天），在设置页给出一次性提示（非阻断），避免用户误以为数据丢失。

---

## F. 会话队列（G5/G6）

### F.1 口径二分（不破既有闸门）

- `computeTodayQueue` **保持原样**（卡片口径，f03:200 继续绿）。
- 新增 `computeSessionQueue(now, {mergeIntoReview, interleave})`：
  - `mergeIntoReview=false` ⇒ **恒等于** `computeTodayQueue().cards`（可差分证明的退化路径）；
  - `mergeIntoReview=true` ⇒ 卡片部分＝`computeTodayQueue` 原样 + 摘录部分＝`listDueExtracts`（加 §C.4 状态过滤），按 `interleave` 归并。
- 会话条目统一形状 `{kind:'card'|'extract', id, ...}`；`ReviewView` 只多一个 `kind` 分支渲染。

### F.2 `quota-1-4` 归并规则（确定性、可测）

1. 卡片队列顺序 = `computeTodayQueue` 原序（due 升序 → priority 降序 → created_at → id）。
2. 摘录队列顺序 = `priority ASC, topic_next_at ASC`。
3. 在卡片序列的第 4、8、12… 个位置**插入**至多 1 条摘录（不足则顺延，不占位、不补偿）。
4. 末尾若仍有未放行摘录且卡片已耗尽 → **按序追加**（避免「卡片不够就永远看不到摘录」的死角）。
5. 零随机源（同一输入必得同一输出，供逐字节断言）。

### F.3 设置键（本组 3 个，落 `app` 层；上限与范围的键见 §F.5）

| 键 | 类型/取值 | 默认 |
|---|---|---|
| `app.extracts.mergeIntoReview` | bool | **`false`**（用户裁定 ⑤） |
| `app.extracts.interleave` | `"quota-1-4"` \| `"by-due"` | `"quota-1-4"` |
| `app.extracts.engine` | `"sm19-default"` \| `"ai-next-extract"` | `"sm19-default"` |

登记义务：§7.4 键表 + `f18` 的 `DOC_KEYS` 与 round-trip 用例 + `DOCUMENTED_SCOPES`（沿用 `app` 层，不新增 scope）。

### F.4 复习范围（筛选牌组）

**术语澄清（硬边界）**：本项目**没有** Anki 的静态牌组层级（卡片不属于任何牌组）。本规格中「牌组」的唯一含义＝**保存下来的复习范围**＝筛选牌组。

一个筛选牌组 = `{id, name, query, limits?}`：
- `query`：复用 §H 浏览器查询语法的子集（例：`book:"书名"`、`kind:extract`、`status:open`、`priority<=30`）；
- `limits?`：可选的四个上限覆写（§F.5），缺省＝继承全局。

**存储**：`settings.app.reviewScopes`（数组）——**零 schema 变更**；先例＝`app.shelfOrder` / `app.shelfFolders`（D51：「视图/组织数据入设置不入 DB」）；`settings.json` 已在备份包内，M2 自动覆盖。
- 备选（已评估后弃用）：新建 `review_scopes` 表。弃用理由：无 FK 需求、无审计需求（撤销不引用范围 id），多一张表要多一套 f43 兼容测试，收益为负。

**语义（与 Anki 的差异，必须写进指南，避免日后被当成缺陷）**：
1. **不移动卡片**、不改任何归属；进入筛选牌组＝按 query 过滤集合后走既有会话机制。
2. 正因不移动，**「复习记录照常计入 FSRS」天然成立**（用户要求 ①）。
3. 故**不实现** Anki 的「reschedule 开关」与「清空后归还原牌组」（无牌组可归还）——列为非目标（§N）。
4. 顺序沿用规范序：卡片 `computeTodayQueue` 原序、摘录 `priority ASC, topic_next_at ASC`。

**三处入口**：① 浏览器「筛选牌组」页签（列表 / 「用当前查询创建」/ 重命名 / 删除）；② 阅读器工具条两个本书按钮（§H.2）；③ 书架书卡菜单（同义快捷入口，随样张定）。

**范围与预算的关系（关键取舍）**：范围**只能收紧**上限、**不能另开预算**——见 §F.5。

### F.5 每日上限（四类计数）

**四类上限**（设置页「复习上限」区块，`app.limits.*`）：

| 键 | 含义 | 默认 | 依据 |
|---|---|---|---|
| `app.limits.newCardsPerDay` | 每个学习日**答过**的新卡张数上限 | 20 | Anki 文档默认值 |
| `app.limits.cardReviewsPerDay` | 每个学习日的卡片复习次数上限 | 200 | Anki 文档默认值 |
| `app.limits.newExtractsPerDay` | 每个学习日**引入**的新摘录条数上限 | 10 | **本项目产品选择**（Anki/SM 均无对应项，见 §O-12） |
| `app.limits.extractReviewsPerDay` | 每个学习日**处理**的到期摘录条数上限 | 50 | **本项目产品选择**，锚在 1:4 混编比例（200 ÷ 4 = 50） |
| `app.limits.ignoreReviewLimitForNew` | 复习上限用尽后是否仍发新卡/新摘录 | `false`（关） | Anki 同名选项，官方默认关 |

- **`0` = 不限制**（沿用 Anki 语义）。
- **计数口径＝「处理/作答」而非「展示」**：
  - 卡片复习＝当日写入 `review_logs` 的条数（`review_skips` 不计——跳过不产生复习事实）；
  - 新卡＝当日出现其**首条** `review_logs`（`reps` 0→1）；
  - 新摘录＝`process_count = 0` 且当日被处理；
  - 摘录处理＝当日 `extract_ops` 中 `advance|postpone|graduate` 的条数。
  - **理由**：四类计数**全部可派生**，零新状态、零迁移、可重算、重启不漂移（对齐 §4.2-22「纯函数、可重算、零写路径」精神）。**代价如实记录**：某条摘录/某张卡被展示但用户未做任何动作时不计入，下次仍会出现。
- **学习日口径**：一律 `learningDayStartMs(ts, dayCutoffHour)`（§4.4.8-③）。这是学习日的**第三个使用点**（前两个：统计、§4.16 同源延后队列配额），**仍不进 FSRS 调度与训练**——须在指南登记。
- **限幅（三层，用户要求「参考 Anki 设限」）**：
  1. **硬边界**（拒绝保存 + 就地解释文案）：
     - `cardReviewsPerDay ≥ newCardsPerDay × 5` 且 `extractReviewsPerDay ≥ newExtractsPerDay × 5`（防倒挂）；
     - 各键取值：`0`（不限）或 `1–9999`。
     - 依据：Anki 官方**只用提示不用硬拦**；5× 是**我们按用户要求加严**的地板（用户 2026-09-24 裁定取 5）。
  2. **建议档**（非阻断提示）：`cardReviewsPerDay ≥ newCardsPerDay × 10`。依据＝Anki 文档原文口径「20 new cards/day … expect daily reviews to be roughly about 200 cards/day」。
  3. **结构闸**：复习上限用尽且 `ignoreReviewLimitForNew = false` ⇒ 会话队列**停发**新卡与新摘录（只发到期复习）。这从机制上阻断用户描述的失败态「挤压大量旧卡片没复习而仍然在学新卡片」。
- **预算共享（本项目的关键取舍）**：上限是**全局唯一、按学习日计**，所有复习范围（默认 / 本书 / 任何筛选牌组）**共享同一份消耗**。
  - **理由**：Anki 每个牌组各有独立配额的前提是「一张卡只属于一个牌组」；本项目范围**互相重叠**（一张卡同时属于「全部」「某本书」「某查询」），若各开配额，用户多进一个入口即可翻倍加载，限幅形同虚设。
  - 筛选牌组可覆写**更小**的上限（收紧）；若覆写值比全局更宽，取两者**最小值**。
- **执行位置**：`computeSessionQueue`（§F.1）在归并前先按范围过滤、再按当日余额截断；**只影响展示、不写调度状态**（未放行的条目仍 due，性质同 1:4 配额）。
- **只读 IPC**：`limits:usage` → `{learningDayStart, newCards, cardReviews, newExtracts, extractReviews, limits, remaining}`（纯派生，零写路径）。

---

## G. 撤销（G4）

### G.1 语义（沿用 §4.4.9 精神）

**撤销＝回退，不是追加动作**：恢复 `before_json` 的确切前置状态 + **物理删除**该条日志（`extract_ops` 行 / 该次评分的 `review_logs` 行）。只能撤销**最近一次**操作；更早的需连续撤销。

### G.2 跨类分发（`undo:last`）

1. 读 `op_journal` 尾条（`ORDER BY seq DESC`）。
2. 尾条 `kind='extract_op'` → 回退该 op（批量则整批 `batch_id` 一起回退，按 seq 降序逐个恢复，最后删日志）。
3. 尾条 `kind='card_grade'` → 走**既有** `undoLastReview()` 逐字不变；其前置校验（8 字段全等）失败时→ 跳过该条，继续向前找，并把跳过的条目在该次撤销中标记 `undoable=0`（线性撤销栈的标准行为）。
4. `op_journal` **为空**（迁移前的历史数据）→ **回退既有路径**（等价今天的行为），保证向后兼容零回归。

### G.3 必须覆盖的操作清单

| 来源 | 操作 |
|---|---|
| 摘录卡面 / 摘录页 | 编辑正文、推进（下一条）、**推迟 N 天**、毕业、**改优先级** |
| 阅读器 | 新建摘录（撤销＝软删） |
| 卡片浏览器 | 上述全部 + 批量 × N（一个 `batch_id`）+ 软删 + 召回 + 正文查找替换 |
| 复习页 | 卡片评分（既有） |

### G.4 边界

- 撤销与持久化失败的交互沿用现状：`persist` 失败 → 横幅 + 重试，**不得**自动回滚已 COMMIT 的事务。
- 撤销自身也写一条反向的 `op_journal` 条目（`undoable=0`），使「撤销后 Ctrl+Z」不会重复撤销同一动作。

---

## H. UI 契约（待设计样张定型）

> 本仓库惯例：视觉与版式先出 `design-samples/*.html` 独立样张（令牌整份抄 `src/theme.css`，可交互、可量测），评审通过后才落码。**批次 3 与批次 4 各自以一张样张为前置闸门。**

| 界面 | 内容 | 样张 |
|---|---|---|
| 设置页新「摘录」区块 | 合并开关（默认关，含说明文案）/ 混编模式二选一 / 推送引擎（**实验项必须带「实验功能·早期开发阶段」标识与一段说明**） | 复用现有设置控件（`SettingsPanel.tsx` 的 checkbox 与共享 `Dropdown`） |
| 设置页新「复习上限」区块 | 四类上限 + `ignoreReviewLimitForNew`（§F.5）；硬边界就地解释、建议档非阻断提示；显示今日用量与余额（`limits:usage`） | 同上 |
| 书架 | 书卡动作条新增「优先级」（共享直角 `Dropdown`，档位 10/30/50/70/90，默认 50） | 并入批次 3 样张 |
| **阅读器工具条** | 新增 **「复习摘录」/「复习闪卡」** 两个集中复习按钮（带当日余额计数），位在「目录 / 导图」旁（§H.2） | 并入批次 3 样张 |
| **沉浸式摘录页**（新） | 一屏一条：来源书名 + 层级 + 优先级 + 状态；**正文可直接编辑**；已就此摘录制卡数（可点开）；动作：打开原文 / 制卡 / **推迟（输入天数）** / **优先级** / **毕业** / 下一条；空态 | `design-samples/extract-review.html`（多轴并排：正文与动作区方位、是否常驻制卡信息、键盘提示位置） |
| 复习页混合会话 | 卡片与摘录共用一屏节奏；摘录卡面用同一组件 | 同上 |
| 卡片浏览器 2.0 | 统一表（闪卡/摘录两类行）+ 查询框 + 筛选（状态/类型/来源书/优先级/筛选牌组）+ 多选（点击/Ctrl/Shift/全选/反选）+ 批量动作条 + 排序 + 虚拟滚动 + **筛选牌组页签（创建/列表/改名/删除 + 上限覆写）** | `design-samples/browser-2.html`（多轴：侧栏有无、批量动作条方位、列集） |
| 导航 | 「队列」项去向按 O-6 裁定＝保留并改名「摘录」 | — |

### H.1 跳转原文与阅读进度不变量（要求 ⑨，硬不变量）

现状已核实：跳转入口置 `jumpAnchor` 时**不传 `onProgress`**，Reader 的滚动/卸载保存全部失效 ⇒ 阅读进度与**阅读字数**保持上次真实阅读值（`src/App.tsx:374-378`）。本规格把它从「实现细节」升级为**可测契约**，卡片与摘录一律适用：

1. **跳转不写**：`jumpAnchor` 存在的会话中，`documents.progress_json` 与阅读统计**零写入**。
2. **返回不写**：从跳转现场返回（`returnTo`）时同样零写入。
3. **只有真实阅读才写**：非跳转入口的滚动/卸载/暂停保存照旧。
4. **可测判据**：跳转往返前后 `progress_json` **逐字节相等**（含 `{cfi, fraction, ratio, lastText, readerEngineVersion}` 全字段），且当日阅读字数统计不变。
5. **摘录的阅读入口**（合成单章 EPUB）沿用既有契约「摘录不落进度/统计」（§6.2），不得因本次改版而开始写。
6. `returnTo` 取值需扩展以承载新来源（阅读器 / 摘录连续处理），并沿用 `sessionStorage["reviewSession"]` 的现场恢复机制。

### H.2 阅读器两个集中复习按钮（要求 ⑦）

- **位置**：阅读器工具条「目录 / 导图」按钮组旁（`src/components/Reader.tsx:1575-1585`），沿用既有按钮样式与瑞士风规范（直角 / 单 accent / ≥11px / 8px 基线）。
- **文案（用户指定由我起名；推荐 A，最终以样张定稿）**：
  - **A（推荐）：「复习摘录」/「复习闪卡」** —— 短、与「目录/导图」同节奏，书名由当前书上下文给出。
  - B：「集中复习摘录」/「集中复习闪卡」—— 更明确但更长，工具条会挤。
  - C：单个「复习本书」下拉 —— 省位置但与用户「要按钮」的表述不符（多一次点击）。
- **计数**：按钮带当日余额（例 `复习摘录 · 12`），数据来自 `limits:usage`（§F.5）。
- **行为**：以 `book:<当前书>` 为 query 进入该范围会话——摘录按钮进摘录连续处理、闪卡按钮进闪卡复习；两者都遵循**共享预算**（§F.5）；中途退出/结束**返回阅读器原位置**。
- **同义入口**：书架书卡菜单（可选，随样张定）。

**Anki 参照的许可证边界（硬约束）**：Anki 为 **AGPL-3.0-or-later**（手册文本 CC BY-SA 4.0）；本仓库**无 LICENSE 文件**、`package.json` 为 `private: true`（默认保留一切权利）。因此：**只参考官方手册与可观察行为，按功能规格自研**；**禁止**任何形式的源码/注释/CSS/图标/字符串搬运或逐行翻译。每个新屏在代码注释里留一行出处（如「功能参照 Anki 手册 browsing/searching 章，实现自研」）。

---

## I. 执行批次（每批一个 commit、每批独立验收；停在批次边界如实报告）

| 批次 | 内容 | 前置 |
|---|---|---|
| **0 文档先行** | bump 指南 + 新增 §6.8「摘录复习与合并复习」+ 改写 §6.2 三条目 / §6.4.1（**两段式修订**）/ §4.1 / §4.2-9·20 + 新增 §4.2-26 + §7.4 键表（9 键）+ §8.1 决策号 + §8.3 + §9.1 + §9.4 解冻记录 + 学习日第三使用点登记 | ✅ `5b94460` |
| **1 数据与调度内核** | C 全部列与表、D.1 全部写 API（含 `postponeDays` / `setPriority`）、D.2 SM Provider 补齐（含读后推进）、**新摘录次日进队**（要求 ⑪）、书优先级、**每日用量派生计数**（§F.5 口径）、撤销（`extract_ops` + `op_journal` + `undo:last`）、`f18`/`f11` 同步 | ✅ `a729785`（另 `f2642f0` 修 m12/persist） |
| **2 会话队列、范围与上限** | §F 全部（F.1–F.5）、9 个设置键、`ReviewView` 接受混合条目（先只渲染最小卡面）、**结构闸与硬边界/建议档**、两种混编模式无损切换断言、范围过滤与余额截断 | ✅ 后端 `45a7998` + 设置区块 `df76b55` + 合并卡面 `455a5a5` |
| **3 沉浸式摘录页** | 样张 → 组件、正文编辑接线、动作集（下一条 / **推迟 N 天** / **优先级** / 毕业 / 打开原文 / 制卡）、复习页复用同组件、**阅读器两个集中复习按钮**（§H.2）、**跳转原文进度不变量**（§H.1）、旧 `QueueView` 列表退役（导航去向按 §O-6 裁定＝改名「摘录」） | ✅ `aa8b7fb` + 按钮取证 `e9fd8b3` + 进度不变量 `455a5a5`（**样张未单独出**，以真机断言代偿，见 §O-13 备注） |
| **4 卡片浏览器 2.0** | 样张 → 统一数据源、搜索语法、多选/全选/反选、批量（单事务 + 单撤销条目）、按书分组、**筛选牌组页签（创建/列表/改名/删除 + 上限覆写）**、虚拟滚动 | **核心 ✅** `945a36b`（统一数据源 + 多选 + 单事务批量 + 按书分组）+ `18cc6cb`（筛选牌组）+ `e4c4382`（正文查找替换 + 行数窗口）+ **D108 `3950e71`（查询语法 v3）+ D110（真虚拟滚动，v48.66）**。**残余归档**：自由文本查询语法已在 D108 兑现（or/括号/通配符/字段取反）；真虚拟滚动已在 D110 落地（30 万卡 + 5 万摘录量测驱动，200 行窗口与「显示更多」退役）；筛选牌组上限覆写 UI 已在 D105 落地。**量测登记（30 万规模）**：首屏瓶颈在全量取数通道（主进程 mapCardRow 逐行 JSON 解析 + contextBridge 传输 ≈ 30s 级，渲染层虚拟滚动不解决取数）——**主进程过滤 + 分页取数**（查询 AST→SQL 翻译、tag 层级边界语义对齐）为后续架构批 |
| **5 实验推送引擎** | §6.4.1 **两段式 E1**（本地因子 + AI 对到期批重排与解释；`KP_frontier` 位显示「待接入」）、引擎切换器与实验标识、往返无损实测；E2 待 K4–K5 落地后另批 | **E1 本地层 ✅** `b4b6ced`（确定性排序 + 可验证理由 + 切回无损）；**E2 未做**（`KP_frontier` 与 LLM 重排依赖 K4–K5，而 K4/K5 至今未实现——这是文档化的外部依赖，非本批遗漏） |

**验收现状（2026-09-25）**：extracts.test **131/131**、ainextextract.test 19/19、extract.gui **62/62**（CDP 真机）、m12.test 42/42、m12.gui 24/24、k1.gui 16/16、persist 14/0、undo 29/29、fsrs L2 23/23、F03 58/58、F10 20/20、F15 40/40、F37 8/8、F38 121/137（**与基线逐条对齐，新增失败 0**）、F11 17/17、F18 46/46、F31 24/25（1 条已登记 known）、F72 7/8（剩余为词典语言码，基线即失败）、F32 13/13；`tsc --noEmit` 零错误；`npm run build` 成功。

---

## J. 测试义务

### J.1 必须保持绿的既有闸门（改完必须实测，不接受推理）

| 套件 | 为什么会被碰到 |
|---|---|
| `tests/flows/f03`（含 `:200` 队列口径唯一） | 摘录入队后若误改 `computeTodayQueue` 即红 |
| `tests/flows/f10`（postpone ×1.6 / 180 天上限） | `a_factor` 默认 1.6 时必须仍绿（零行为变更的证明） |
| `tests/flows/f15`（推迟单调） | 同上 |
| `tests/fsrs/` 六件套 + `undo` + `persist` | §C.3 计数器改动触及 `review_seq` 分配 |
| `tests/flows/f11` / `f18` | 文档与设置键闸门 |
| `tests/flows/f31` / `f32` / `f72`（写存在性矩阵 / IPC 盲区） | 新增写 API 必须进矩阵 |
| `tests/flows/f37` / `f38`（故障注入 / 写模糊） | 新增写路径必须被注入覆盖 |
| `tests/m12.test.cjs` / `m12.gui.mjs` | 今日队列与延后 |
| `tests/flows/f26` / `f79` | 到期文案与搜索折叠口径 |

### J.2 必须新增的断言（缺一条即视为未完成）

1. **零行为变更**：`a_factor=1.6` 时 `postpone` 与旧实现**逐字段等值**（对同一输入做差分）。
2. **读后推进**：`advance` 后 `interval = prev × a_factor` 且 `topic_next_at = now + interval`；连续 3 次严格单调。
3. **毕业**：毕业后 `listDueExtracts` 不含该条；`is_deleted=0`；浏览器数据面仍含该条；未知状态值**不**被排除（前向兼容正向对照）。
4. **书优先级继承**：改书优先级后，`priority_source='book'` 的摘录实时跟随；`='user'` 的不受影响。
5. **混编无损**：切换 `interleave` 前后，当日剩余卡片集合恒等；`quota` 模式未放行的摘录在库内仍 due。
6. **合并开关退化**：关闭时 `computeSessionQueue ≡ computeTodayQueue().cards`（逐 id 相等）。
7. **引擎往返无损**：`A→B→A` 后 A 子空间逐字段等值；B 期间 A 子空间零写入（差分快照断言）。
8. **撤销**：编辑/推迟/推进/毕业/批量逐项可撤销且恢复**确切**前置值；撤销后重复 Ctrl+Z 不重复撤销；`op_journal` 为空时回退既有路径。
9. **跨类撤销顺序**：评分 → 摘录操作 → Ctrl+Z 回退摘录操作；再 Ctrl+Z 回退评分。
10. **批量原子性**：批量中任一条失败 → 整批不落库（单事务），无部分写入。
11. **混合会话**：会话队列条目 `kind` 分布符合 1:4 上限；会话结束条件正确（无条目 → 结束页）。
12. **UI 层**：新页面与浏览器的真实 CDP 断言（见 §J.3）。
13. **次日进队**（要求 ⑪）：新建摘录的 `topic_next_at` 落在**下一个学习日切点**（`learningDayStartMs`），当日 `listDueExtracts` 不含它；跨切点后含它（两侧对照）。
14. **每日用量派生**：四类计数各自与学习日边界对齐（切点前/后两侧对照）；跳过（`review_skips`）不计入复习数；被展示但未处理的摘录不计入且下次仍出现。
15. **上限截断零写库**：达到上限后 `computeSessionQueue` 不再放行该类条目，但**未放行条目在库内仍 due**（差分快照断言）。
16. **限幅**：违反硬边界的保存被拒绝且给出解释；建议档只提示不阻断；`0` 表示不限制。
17. **结构闸**：`cardReviewsPerDay` 用尽且 `ignoreReviewLimitForNew=false` ⇒ 新卡与**新摘录**都停发；置 `true` 时只停新卡之外的行为按文档定义（不得反推）。
18. **预算共享**：在本书范围消耗后，默认范围的余额同步下降（同一份账）。
19. **跳转进度不变量**（§H.1）：跳转往返前后 `progress_json` **逐字节相等** + 当日阅读字数不变；卡片与摘录各测一遍。
20. **显式推迟 N 天**：`next_at = now + N 天`、`interval_days = N`、`postpone_count++`（与 `advance` 的乘性推进区分开）；优先级按钮改动后 `priority_source='user'` 且队列顺序按新值重排。

### J.3 分层要求（沿用 §7.3 与仓库既有分层）

- 纯 node 流程层：新增 `tests/flows/f93+`（摘录调度/毕业/引擎切换/混编/撤销各一条）。
- electron 层：`extracts.test.cjs`（新 API 矩阵 + 计数器 + 事务）。
- GUI 层（真实鼠标/键盘，须先 `npm run build`）：新页面与浏览器各一套 `*.gui.mjs`。
- **视觉判读 + 几何量**：新界面必须附截图**并**给带正向对照的定点几何量（对齐/溢出/裁切结论不许只靠眼睛）。
- **异机模拟**：新功能的关键路径需在非本机路径/权限环境下跑通一次（既有约定）。

---

## K. 需要同步修改的既有断言（**必须先出清单再动**）

| 位置 | 可能冲突点 | 处置 |
|---|---|---|
| `tests/flows/f03:200` | 若有任何改动让 `listDueCards ≠ 队列` | 本设计**不触碰**该口径，预期零改动；若红即为实现错误 |
| `TODAY_QUEUE_SQL` 相关断言 | 新增列不影响 SELECT * | 预期零改动 |
| `review_seq` 复用语义（如有断言） | §C.3 计数器不再复用序号 | **执行时差分确认后，按本次契约变更更新断言并在 `DEFECTS.md`/`PLAN §5` 留痕** |
| `tests/flows/f18` 的 `DOC_KEYS` / round-trip | 新增 3 键 | 按登记义务补齐 |
| `tests/flows/f11` | 文档↔代码漂移 | 批次 0 改完文档后必须绿 |

---

## L. 验收标准

1. §J.1 全部套件按报告口径全绿（给出计数，不接受「应该没问题」）。
2. §J.2 十二条断言全部落地且**首次运行**即通过（红灯→绿灯的过程要留输出）。
3. `tsc --noEmit` 零错误；`npm run build` 成功。
4. `git diff --stat` 只涉及本规格 §C–§H 列出的文件。
5. 用户实测：合并开关开/关各跑一轮真实复习；摘录页编辑正文、制卡、毕业各一次；浏览器多选批量一次；每次操作后 Ctrl+Z 一次。
6. 引擎往返实测：SM → 实验 → SM，子空间逐字段等值（给出前后数值表）。

---

## M. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 统一撤销排序触及 §4.4.9 最高不变量区 | `op_journal` 只是排序索引；卡片逆操作**逐字复用** `undoLastReview`；无 journal 时回退既有路径；`f03/undo/persist/fsrs` 全绿为门槛 |
| R2 | `review_seq` 分配机制变更 | 迁移期 `next = MAX+1`；断言表内单调性与唯一索引不变；差分确认「复用」语义变化 |
| R3 | 队列口径分叉（第二套「今日队列」） | 新函数**组合**既有两个口径而非重写；`mergeIntoReview=false` 的退化路径写成断言 |
| R4 | Anki 许可污染 | 零代码搬运；每屏留出处；禁止 AGPL 文件进入仓库 |
| R5 | 浏览器全量渲染放大（统一后行数上升） | 虚拟滚动做成独立可测单元，先量测再换 |
| R6 | 实验引擎依赖 K4–K5（未实现） | 见 §O-1 裁定：两段式则先落本地因子档；一步到位则本批只交付切换器与标识 |
| R7 | 书优先级语义歧义（存量摘录是否跟随） | `priority_source` 显式区分；默认 `book` 实时跟随（见 §O-3） |
| R8 | 「次日进队」改变现有摘录体验（用户裁定 O-4） | 只改**新建**摘录的 `topic_next_at`（落下一个学习日切点）；存量行一律不动；用差分断言钉住「当日创建的新摘录不出现在当日队列」 |

---

## N. 明确非目标（写了也不做）

1. **不做** SuperMemo 的「优先级 ↔ 间隔」自动联动——官方未公布公式，本项目禁自造数值；如需，须先有实测标定并改文档。
2. **不做**自动推迟（auto-postpone）写库——`quota-1-4` 已在零写库前提下达成同一目的。
3. **不做** Anki 的**静态牌组层级**（卡片归属牌组、牌组树、牌组改名）、笔记类型/模板体系、导出、`Find & Replace` 全量。筛选牌组按 §F.4 定义为**复习范围**（不移动卡片、不做 reschedule 开关、无「归还原牌组」）。
4. **不做**摘录的整图遮挡编辑器类扩展（沿用 §9.4 既有边界）。
5. **不做**「实验引擎」的自动入队/自动制卡（延续 D29 克制精神，AI 只给排序与解释）。
6. **不改** `cards` 表结构与 FSRS 任何字段；摘录处理**不写** `review_logs`（§4.12 边界）。
7. **不做**每日上限的**历史回溯**（改上限只影响当日之后的余额判定，不改写任何既有日志或计数）。
8. **不做**上限的**结转**（未用满或漏一天不累积到次日，对齐 Anki 文档口径）。

---

## O. 裁定记录与仍需点头的数值

### O.A 已裁定（2026-09-24 第二轮，用户「其余按你的建议做」）

| # | 裁定结果 |
|---|---|
| O-1 | **改两段式**：§6.4.1 的「不做 E0 先行版、一步到位」修订为 E1（本地因子 + AI 对到期批重排与解释，`KP_frontier` 位显示「待接入」）/ E2（K4–K5 到位后补六因子）。须在指南登记该修订。 |
| O-2 | 版本 `v48.22`；决策号 `D58` 起（D58＝摘录复习改版总契约、D59＝双引擎与无损切换、D60＝卡片浏览器 2.0 与筛选牌组）。 |
| O-3 | 书优先级对存量摘录**实时跟随** + 单条覆盖（`priority_source` 区分）。 |
| O-4 | **改为「按 SuperMemo 次日进队」**（用户明确裁定，覆盖我的原建议）：新建摘录不再即时到期，`topic_next_at` 落**下一个学习日切点**；存量行不动。 |
| O-5 | 毕业**允许召回**；入口在浏览器（行内 + 详情页各一处）。 |
| O-6 | 顶栏「队列」项**保留并改名「摘录」**，两种模式都指向沉浸式页；列表只在浏览器。 |
| O-7 | 浏览器显示「非生效引擎的计划日期」为只读列（默认隐藏，列设置可开）。 |
| O-8 | 批量**给**「摘录正文查找替换」（仅选中项、仅正文、纯文本，先不做正则）。 |
| O-9 | 批量推迟**落地** SM 的跳过条件（间隔 > 2500 天 / A-Factor < 1.01 / 已推迟 > 250 次）；单条不受限。 |

### O.B 仍需点头的数值与口径（我按建议先行，落地前请确认）

| # | 事项 | 我的取值 | 依据与影响 |
|---|---|---|---|
| O-10 | 四类上限的**作用域** | **全局唯一预算、按学习日计，所有范围共享消耗**；筛选牌组只能覆写更小的上限（取最小值） | 依据：本项目范围**互相重叠**（同一张卡同属「全部/某书/某查询」），各开配额会被多入口翻倍加载 ⇒ 限幅失效。这是对 Anki「每牌组独立配额」的**有意偏离**，需在文档写明。若你要求严格按 Anki（每范围独立），请指出——代价是限幅可被绕过。 |
| O-11 | 硬边界倍数 `k` | **`× 5`**（用户 2026-09-24 裁定）；`× 10` 为**非阻断**建议档 | Anki 官方**只提示不硬拦**（原文："Hidden reviews trigger a message suggesting increase"），10× 亦出自官方原文（20 新卡 → 约 200 复习/日）。5× 是**按用户「要设限」加严**的地板，属本项目的产品选择。 |
| O-12 | 摘录侧两个默认值 | 新摘录 **10**/日、摘录复习 **50**/日 | Anki 与 SuperMemo 都**没有**摘录计数上限可依；50 锚在既有 1:4 混编比例（200 ÷ 4），10 为保守起点。两个数都是**本项目产品选择**，已在表中如实标注。 |
| O-13 | 阅读器按钮文案 | **「复习摘录」/「复习闪卡」**（带当日余额计数） | 用户指定由我起名；备选 B「集中复习摘录/闪卡」、C 单下拉见 §H.2。最终以样张定稿。 |
| O-14 | 「次日进队」的切点定义 | 下一个 `learningDayStartMs(ts, dayCutoffHour)` 切点（非「次日 0 点」） | 与统计/§4.16 同口径；若 `dayCutoffHour = 0`（默认）则等价于次日 0 点。 |
