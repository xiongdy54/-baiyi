# D248 用户行为数据基础设施（BDI）——对抗式审查与最终方案 v3

> 状态：**设计定稿，未实施**。本文取代两份被审查稿：
> - v1：`BEHAVIOR-DATA-INFRA-D248.md`（Opus 5.5 起草）
> - v2：`Nutation-BDI-D248-v2.md`（自动路由模型修订）
>
> 审查基线：本仓 HEAD `d1368ceab09da47edd75a79b945e7849f62534ac`（2026-10-28，GUIDE v49.76 / D247）。
> 本文的每个结论都对应一条代码事实；代码事实变了，结论必须重新核对。实施前若 HEAD 漂移、D248 被占用或 schema 版本变化，按 AGENTS.md 的 BLOCKED 协议停下，不机械占用编号。
>
> 定位：为将来的「兴趣领域发现」「连续投入」「学习洞察」准备**可组合、可解释、可重建**的本地行为证据。本期只做采集、存储、派生、只读查询与设置管理；不做兴趣排名、潜能判断、任何界面展示（设置页数据管理区除外）。

---

## 0. 结论摘要（先读这一节）

1. **v1 的架构方向正确，v2 的若干正确性修正是必要的；但 v2 把「正确性」升级成了「重架构」——worker 线程、`mx_*` 镜像、32 张表、8 个 derive 模块、ACK/SAB 协议——这些在本仓没有代码基础，也没有需求依据。**
2. **最终方案 = v1 的轻架构（主进程单连接、独立 `behavior.db`、不复制主库事实）+ v2 的关键修正（FULL、审查日志不取 latest、学习日存 cutoff、origin 多槽 token、注意力单调时钟、coverage/unknown、归档、禁用/清除屏障、备份隔离）。**
3. **不引入 worker，不建 `mx_*` 镜像，不落 `f_*` 特征表。** 主库只新增**只读** `bdiPull` 投影；派生层只保留 `entity_domains`、`daily_metrics`、`domain_day`、`item_day`、`signal_daily`、`coverage_day`、`archived_days`。`runs` / `features` / `episodes` 在查询时从这些日事实计算，不落表。
4. **硬不变量不破**：调度真源仍是 `review_logs + fsrs_configs`；BDI 只存行为上下文和 id 引用，不存评分/FSRS 事实；`learning_events` 仍是学习者模型真源；`reading_events` 仍是阅读进度真源。BDI 不得成为任何业务事实的第二解释。
5. **v1 的 5 个必须修的硬缺陷**：`saveReview` 只返回 `true` 却用「最新一条 review_logs」冒充关联；`synchronous=NORMAL` +「最多丢 2 秒」的虚假保证；事件不存 `cutoff_hour/tz_name` 导致学习日不可复算；`origin` 全局单槽会串来源；注意力没有单调时钟/心跳/跨日切分，失焦与 iframe 输入处理不完整。
6. **v2 的 3 个必须拒绝的重架构**：长驻 worker 独占数据库；`mx_*` 镜像复制 `review_logs/cards/...`；`f_review/f_episode/f_domain_features` 等把可即时计算的派生事实落成第二套表。它们会引入新的持久化、迁移、恢复、对账与性能风险，收益不抵成本。
7. **v2 发现并修对了的 8 个点**：`saveReview` 返回形状、`extracts.kind`、`track_materials` 复合键、StrictMode 双挂载、EPUB iframe 输入、恢复 staging、当前领域≠历史领域、无眼动/在场检测的边界。最终方案全部采纳。
8. **v2 的一个具体算法 bug**：附录 A 的 `buildRuns` 在「按整数日历序号表达日期」的文字下，实际用 `d - cur.end - 1` 和 `byDay.get(k)` 对 `'YYYY-MM-DD'` 字符串做算术/查表；若 `rows[].day` 是字符串，桥接恒为 false、`isOpen` 循环也会字符串拼接。最终方案规定：`runs` 内部一律用整数 day index，输出时再转日期字符串（见附录 A）。

---

## 1. 代码事实核验（审查的依据）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | 主库 `persist()` = `wal_checkpoint(TRUNCATE)`；主连接 `busy_timeout=3000`；`synchronous=FULL` | `electron/db.js:1015-1032`；`electron/sqliteCompat.js:37-42` |
| F2 | `saveReview()` 成功后**只返回 `true`**，`logId` 是函数内部变量，不返回 | `electron/db.js:2338-2409`（`return true` 在 2409） |
| F3 | `cards:review` handler 签名为 `(e, cardId, fsrsState, rating, durationMs, fsrsBefore)`，渲染层 `cardsApi.review` **忽略返回值** | `electron/main.js:839-841`；`electron/preload.js:202-203`；`src/lib/cards.ts:1102-1104` |
| F4 | `review_logs` 有 `duration_ms`、`reviewed_at`、`fsrs_before_json/after_json`、`fsrs_config_id/fsrs_before_config_id`；`reviewed_at` 有索引；撤销评分是**物理 DELETE** | `electron/db.js:235-241`、`:511-530`、`:2511` |
| F5 | `reading_events` 有 `created_at` 索引；阅读进度真源是它，不是 BDI 的 span | `electron/db.js:242-247`、`:531`、`:2567` |
| F6 | `cards.domain`（JSON 数组字符串，≤2，首个为主）与 `extracts.kind`（extract/highlight）都是启动期 `addColumnIfMissing` 加的列 | `electron/db.js:450-451`、`:489-495` |
| F7 | `track_materials` 有独立 `id` 与 `(track_id, library_item_id)` 唯一索引；`learner_tracks` 有 `mode` / `lang` / `udc_codes_json` | `electron/db.js:278-305` |
| F8 | `listCardDomainsForDocument(documentId)` 返回**扁平 UDC 码数组**（不是权重），用 `LIKE` 匹配 `context_ref_json`，上限 2000 行 | `electron/db.js:1211-1228` |
| F9 | `countCardsByExtract()` 只返回「extractId → 卡数」，不含领域 | `electron/db.js:2023-2035` |
| F10 | 学习日函数是 `learningDayIndex(ms, cutoffHour)` / `learningDayStartMs`，DST 安全；日切点设置键是 `settings.app.dayCutoffHour` | `electron/fsrsTime.js:21-54`；`electron/db.js:4762-4772` |
| F11 | `schemaVersion.js` 当前 `SCHEMA_VERSION=5`，MIGRATIONS 只能末尾追加 | `electron/schemaVersion.js:8-114` |
| F12 | `syncTables.js` 只登记 `library.db` 的表；`tests/sync-tables.test.cjs` 只内省 `library.db` + 扫 `electron/*.js` 顶层的 `DELETE FROM` | `electron/syncTables.js`；`tests/sync-tables.test.cjs:35-72` |
| F13 | `dictionary.db` 与 `learner.db` 是独立库；`dictionary.db` 随备份，`learner.db` 派生可重建、不备份；`learner.db` 因逐行写入 fsync 风暴降为 `NORMAL`，主库/词典库仍 `FULL` | `electron/dictDb.js:1-8`、`:60-64`；`electron/learnerDb.js:1-7`、`:127-147` |
| F14 | 备份对 `library.db` / `dictionary.db` 走注入的 `db.backup()` 快照；恢复是 staging + `restore-pending.json`，下一次启动、`initDb` 之前换入；`learner.db` 恢复时直接让位重建 | `electron/backup.js:260-312`、`:752-980`；`electron/main.js:2265-2282` |
| F15 | 启动顺序：`app.whenReady` → `createWindow()` → 协议注册 → `applyPendingRestore()` → `initDb()`；`will-quit` 关闭三库 | `electron/main.js:2188-2282`、`:2470-2478` |
| F16 | main / lens / workbench 三个 React 入口都用 `StrictMode`；lens/workbench 共用 `preload.js`，quick capture 用 `preload-capture.js` | `src/main.tsx:48`、`src/lens.tsx:85`、`src/workbench.tsx:69`；`electron/lensWindow.js:80-85`；`electron/workbenchWindow.js:65-70`；`electron/quickCapture.js:287` |
| F17 | 事件总线已有 `ui/view-change`、`ui/overlay-open/close`、`ui/review-flip`、`ui/session-complete`、`leech/detected`、`learner/navigate` 等事件 | `src/lib/eventbus.ts:15-42` |
| F18 | `ReviewView` 的评分耗时是 `Date.now() - startedAt`（墙钟，含思考+评分），不是单调时钟 | `src/components/ReviewView.tsx:200`、`:465` |
| F19 | `dict_lookup` 已由学习者模型写入 `learning_events`（`learnerApi.logEvent`），且带 query/sentence 内容；只有 learner 开关打开时才写 | `src/lib/useSelectionActions.ts:1523-1525`；`electron/main.js:1637-1649`；`electron/db.js:8140-8151` |
| F20 | `aiGateway.chat` 是 5 参位置签名；调用点 12 处；AI 流是 `ai:chat`（`ipcMain.on`） | `src/lib/ai.ts:103-140`；`electron/main.js:1209-1226` |
| F21 | `deviceId.js` 是随机 UUID + host 校验，不是硬件标识 | `electron/deviceId.js:1-21` |
| F22 | `ipcMain.on` 的监听器没有业务侧 `removeListener` 调用；`lensWindow` 也注册了 `ipcMain.on` | `electron/*.js` 静态扫描；`electron/lensWindow.js:459-463` |
| F23 | `docs/ipc-contract.json` 由 `scripts/gen-ipc-contract.mjs` 从 `electron/preload.js` 生成；`i18n-check.mjs` 校验 en/ja 与代码键 | `scripts/gen-ipc-contract.mjs:1-61`；`scripts/i18n-check.mjs:54-77` |
| F24 | `D248` 未被占用；GUIDE 最新是 D247 / v49.76；§4.21 未被占用 | `AI_DEVELOPMENT_GUIDE.md` §8.1 尾部；grep 结果 |
| F25 | `docs/SPEC-usage-telemetry.md` 存在但未实施（架构文档已标注）；BDI 不依赖它 | `docs/architecture-model/architecture-understanding.md:133` |

---

## 2. 对 v1 的裁决

### 2.1 保留（方向正确）

| v1 决策 | 裁决 | 理由 |
| --- | --- | --- |
| K1 独立 `behavior.db`，不进 `library.db` | **保留** | 与 `dictionary.db` / `learner.db` 同构；避免拖慢主库每次评分的 `persist()` checkpoint（F1） |
| K2 原始事实、进备份、不同步 | **保留** | 行为原始数据不可由主库重建；`syncTables.js` 只管主库（F12） |
| K3 不复制 `review_logs` 事实 | **保留并强化** | 调度真源唯一（F2/F4）；BDI 只存行为上下文和 id 引用 |
| K4 L0 原始事件 → L1 注意力/会话 → L2 派生 | **保留并补全** | 分层正确；L1 需要 coverage/archive，L2 需要领域日表 |
| K5 主进程 tap + 渲染层 track | **保留并修正** | tap 覆盖落库动作；track 覆盖纯 UI；但 tap 包装、来源、权限要补 |
| K6 领域晚绑定 | **保留并补全** | 当前领域可回溯归因；但缓存不能删除、不能无残差归一 |
| K7 白名单 + 不记正文 | **保留并收紧** | 查询原文默认关闭 |
| K9 默认开启 + 设置控制 | **保留** | 本地数据；但需 `behavior-policy.json` 防清除后回填 |
| K10 零网络 | **保留** | 硬不变量 1 |

### 2.2 必须修正（硬缺陷）

| # | v1 的问题 | 代码事实 | 最终处置 |
| --- | --- | --- | --- |
| V1-1 | `review.rated` 的 `reviewLogId` 取「最新一条 review_logs」 | `saveReview` 只返回 `true`（F2），tap 的 `result?.reviewLogId` 永远 undefined，fallback 会拿错行 | **禁止 latest 查询**；tap 只记 `tapStartTs/tapEndTs/tapSeq`，由查询层按 `(card_id, reviewed_at ∈ [t0,t1])` 一对一匹配；多候选/无候选标 `ambiguous/missing`，不猜 |
| V1-2 | `synchronous=NORMAL` + 「最多丢 ~2s」 | 主库/词典库 `FULL`（F1/F13）；`learner.db` 因逐行写入才降 NORMAL；BDI 是每秒批量事务，不是逐行风暴 | **改 `FULL`**；不新增 §7.2 持久化降级例外；明确「批次提交前的窗口、renderer 缓冲、队列丢弃都可能丢失」，不承诺固定秒数 |
| V1-3 | 事件只存 `day/tz_offset`，不存 `cutoff_hour/tz_name` | 学习日由 `settings.app.dayCutoffHour` 决定（F10）；改切点后旧事件无法复算 | **存 `cutoff_hour` + `tz_name` + `tz_offset`**；`day` 是捕获时的审计标签；派生默认用 `day`，需要重算时用存下的参数并标 `timezone_assumed` |
| V1-4 | `origin` 全局单槽，3 秒过期 | 快速打开 A/B 会串来源 | **多槽 token**：`(window, entityType, entityId, nonce)` → origin；一次消费；过期/取消清除；无法匹配用 `unknown` |
| V1-5 | 注意力 tick 有逻辑缺口：`if (!fg && hidden)` 才结束，blur 时间不落桶；无单调时钟；无跨日切分；无心跳/revision；EPUB iframe 输入不计数 | `StrictMode`（F16）；`blur` 与 `hidden` 是不同状态；`performance.now()` 未用 | **采用 v2 的精确积分规则**（见 §7.3）：在 `lastInput + idleLimit` 切开；blur 立即停 active；`performance.now()` 计时；跨学习日切段；30s 心跳 + revision/closed；iframe 经既有 adapter 接 poke |
| V1-6 | `events.seq` 被当作「本机单调递增」水位 | `INTEGER PRIMARY KEY` 无 AUTOINCREMENT 时，删到最大行后 rowid 会复用 | **`seq INTEGER PRIMARY KEY AUTOINCREMENT`**；水位仍以 `seq` + `dirty_days` 双保险 |
| V1-7 | 备份恢复「存在则还原、缺失则跳过」 | 旧备份没有 behavior.db 时，会把**旧 library.db + 新 behavior.db** 混用（F14） | **缺失则隔离**：把现有 `behavior.db` 改名为 `behavior.pre-restore-<ts>.db`，新 `dataEpoch`；备份早于 `analysisFloorTs` 时也不还原行为库 |
| V1-8 | `preload.js` 共用给 lens/workbench 时自动获得 `status/query/export/purge` | lens/workbench 共用 preload（F16） | **按窗口角色裁剪**：main 全量；lens/workbench 只 `batch/onConfig/status`；capture 只 `batch/onConfig`；主进程再按 `sender` 校验 |
| V1-9 | `ipcTap` 直接替换 `ipcMain.on`，不处理 `removeListener/once` | 当前没有业务侧 `ipcMain.removeListener`（F22），但 lens 也注册 `on`，未来会踩 | **保留原监听器映射**，覆盖 `removeListener/off/removeAllListeners`；`once` 未出现则测试失败要求补适配；排除 `behavior:*` 自反馈 |
| V1-10 | `entity_domains` 只用当前卡领域；删除实体后丢失归因；裁剪后重新归一 | `listCardDomainsForDocument` 是扁平码不是权重（F8）；`countCardsByExtract` 只有计数（F9） | **不删 `entity_domains` 行**；源实体消失标 `stale`；多领域裁剪产生 `_none` 残差，不假装 100% 归因；不复用 F8/F9 的错误口径，直接读卡投影 |
| V1-11 | `signals` 的 `share` 公式直接把 signed score 放分母 | 负极性信号会让 share 为负/无意义 | **share 只用于非负、已归一证据**；signed score 只做排序原料；本期不输出综合兴趣分 |
| V1-12 | `daily_metrics` 按日 DELETE + 重算，保留期删原始后派生无法重建 | 派生层可重建的前提是原始还在 | **`archived_days`**：保留期删原始前先归档；归档日不重算；查询标 `archived/incompatible` |
| V1-13 | 事件目录约 55 个，声称覆盖所有可观测行为 | 实际 IPC 通道 189 个（F22/F23），v1 漏了 `cards:resolveLeech`、`card-links:*`、`assets:*`、`reader-capture:*`、`learner:logEvent` 等 | **以生成式通道清单为准**：所有写通道必须登记 owner 或带理由只计数；事件目录扩到 v2 的量级 |
| V1-14 | 损坏库自动改名并新建 | 原始行为数据不可重建 | **停用并保留现场**；用户确认后才新建；不静默覆盖 |
| V1-15 | `events` 不存 `recv_ts/source_ts/clock_flags/actor/op_id/presentation_id/render_id/window_id` | 时钟回拨、StrictMode、批量 AI/后台动作需要这些字段 | **全部补齐**（见 §5） |

### 2.3 可保留但不强制的点

- `uuid7.js` 的无依赖实现可用。
- `attn_spans` 的 `keys/clicks/scroll_px` 计数可用，但不把鼠标微动当「深度阅读」证据。
- `daily_metrics` 的通用立方体思路可用，但维度要收敛（去掉不稳定的 `card_type` 维度，改由查询层从 `cards` 读）。
- `signals.js` 的信号清单可用，但单位、极性、coverage 必须进注册表。

---

## 3. 对 v2 的裁决

### 3.1 采纳（v2 修对了）

| v2 点 | 代码事实 | 最终处置 |
| --- | --- | --- |
| `saveReview` 只返回 true，不能用 latest log | F2/F3 | 采纳；改为派生期窗口匹配（§7.1、§10） |
| `synchronous=FULL` | F1/F13 | 采纳；不新增 NORMAL 例外 |
| 事件存 `cutoff_hour/tz_name/recv_ts/clock_flags` | F10 | 采纳 |
| `seq` 不能当不可复用水位 | SQLite rowid 语义 | 采纳；`AUTOINCREMENT` + `dirty_days` |
| origin 多槽 token | 快速 A/B 打开 | 采纳 |
| StrictMode 去重（presentationId） | F16 | 采纳 |
| EPUB iframe 输入要接 poke | foliate iframe | 采纳 |
| 模糊/未知日不能当 0 | 覆盖语义 | 采纳；`coverage_day` + `engaged` 的 0/1/NULL |
| 恢复 staging、旧备份不含 BDI 要隔离 | F14 | 采纳 |
| 当前领域不等于历史领域 | 晚绑定 | 采纳；`attribution_version` + `stale` |
| `extracts.kind`、`track_materials` 复合键 | F6/F7 | 采纳；领域归因按 `kind` 区分高亮/摘录，按复合键映射轨道成员 |
| 查询只允许具名 API、不允许任意 SQL | 安全 | 采纳 |
| 指标注册表 + 文档生成 | 防同名两义 | 采纳（精简版） |
| 默认不存查询原文 | 隐私 | 采纳 |
| 导出用快照而非活动库 | WAL 一致性 | 采纳 |
| 保存/恢复/清除互斥、generation 屏障 | 竞态 | 采纳（进程内 generation，不做 worker epoch） |
| 备份不含 BDI 时不能宣称完整 | F14 | 采纳 |

### 3.2 拒绝（重架构、无代码基础、收益不抵成本）

| v2 点 | 拒绝理由 | 代码事实 |
| --- | --- | --- |
| 长驻 worker 独占 `behavior.db`，host/worker 协议、credit、ACK、SAB、workerEpoch | 本仓没有长驻 DB worker；只有一次性的备份构建 worker（只读快照文件，不写库）。引入 worker 需要打包/原生 ABI/asar 路径/退出协议/迁移全部重做，且 `better-sqlite3` 连接不能跨线程共享 | `electron/backup-build-worker.js:1-64`；`electron/main.js:2467-2478` |
| `mx_*` 镜像复制 `cards/review_logs/extracts/...` | 复制调度真源，违反「同一份事实不允许两套解释」的精神；镜像会滞后、需要游标/对账/墓碑/seen_round，最终仍要回答「以谁为准」 | `review_logs` 是 FSRS 唯一训练真源（F4）；`syncTables` 只登记主库（F12） |
| `f_review` / `f_episode` / `f_domain_features` / `f_domain_runs` 落表 | 这些都能从 `review_logs + attn_spans + domain_day` 即时计算；落表会引入版本、脏日、归档、重建等价性等一整套维护成本 | 主库已有 `review_logs` 时间索引（F4）；BDI 有 span/事件原始层 |
| `entity_observations` 不可重建证据表 | 保留 `entity_domains` 最后已知值 + `stale` 已能覆盖删除后归因；单独观测表是 v2 镜像架构的配套，不是必需 | `entity_domains` 可保留旧值；不需要原始 metadata |
| `accepted_batches`、batch ACK、`MessagePort` credit | 渲染层用 `ipcRenderer.send`，没有重试队列；主进程批量写入是同步事务；ACK 协议只服务 worker 架构 | `electron/preload.js` 的 `send` 语义 |
| `quality_json` 落到每张 `f_*` 行 | 日级 `coverage_day` + `domain_day.quality` 足够；逐行 JSON 会膨胀并让查询变慢 | — |
| `derive/{review,episode,...}.js` 八个模块 | 过度拆分；一个 `rollup.js` + `metrics.js` + `signals.js` + `coverage.js` 足够 | — |
| `f_domain_features` 只保留 90 个 asof 日 | 特征查询即时计算，不存在「保留 90 个快照」的问题 | — |
| worker 快照归属、SAB 800ms 退出 | 主进程 `db.backup()` + `flushSync` 已够；退出超时不应变成协议工程 | `electron/db.js:1063-1068` |

### 3.3 v2 的具体错误

1. **`buildRuns` 的日期算术类型错误**：文字说「以整数日历序号表达日期」，代码却用 `d - cur.end - 1`、`byDay.get(k)`、`k < today`；如果 `rows[].day` 是 `'YYYY-MM-DD'` 字符串，`d - cur.end` 是 `NaN`，桥接永远失败，`isOpen` 循环会做字符串拼接。最终方案强制 `runs` 内部用 `dayIndex:number`，见附录 A。
2. **v2 §6.9 的覆盖矩阵不完整**：漏了 `cards:resolveLeech`、`card-links:add/update`、`library:setPriority`、`library:updateProgress`、`assets:saveImage`、`reader-capture:region`、`screen-capture:start`、`learner:logEvent` 等写通道。最终方案用「生成式通道清单 + 未登记写通道测试失败」替代手写矩阵。
3. **v2 的 `dict.lookup` 与 `learning_events` 关系没有说清**：代码里 `dict_lookup` 已写入 `learning_events`，但只在 learner 开关打开时写（F19）。最终方案：BDI 的 `dict.lookup` 无条件记录（无正文，默认不记词），`learning_events` 仍是学习者模型真源；两者不做计数合并，查询层按用途分开。
4. **v2 的 worker 方案与「主进程单一 better-sqlite3 连接」的既有纪律冲突**：主库的并发写纪律是主进程单连接（GUIDE §7.2）；虽然 behavior.db 是另一个库，但引入 worker 等于给这个纪律开新口子，且没有性能证据。
5. **v2 的 32 张表/18 个任务会让「先积累数据」的目标被基础设施本身拖延**：本期只需要能把行为记下来、能按领域/日查出来；镜像、特征快照、属性测试可以后置。

---

## 4. 最终架构

### 4.1 关键决策（K1–K14）

| # | 决策 | 说明 |
| --- | --- | --- |
| K1 | `behavior.db` 独立库，主进程**单连接**，`synchronous=FULL`，1s/500 条批量事务 | 与 `dictionary.db` 同构；不引入 worker；不做 NORMAL 例外 |
| K2 | BDI 是**行为事实**的唯一记录者；不复制 `review_logs`/`learning_events`/`reading_events` 的业务事实 | 调度真源、学习者真源、进度真源各自不变 |
| K3 | 主库只新增**只读** `bdiPull` 投影；禁止 ATTACH、禁止另开写连接、禁止在 tap 里查询主库 | 写路径零影响；查询/派生在空闲时读 |
| K4 | 三层：L0 `events`/`attn_spans`/`app_sessions` → L1 `entity_domains`/`coverage_day`/`capture_intervals` → L2 `daily_metrics`/`domain_day`/`item_day`/`signal_daily` | 原始层 append-only；L1/L2 可重建（归档日除外） |
| K5 | 采集：host IPC tap（落库动作）+ renderer `track()`（UI 上下文）+ eventBus bridge（既有事件）+ `ipc_daily`（诊断计数） | 每个语义动作只有一个 owner |
| K6 | 时间：存 `ts/recv_ts/source_ts/day/tz_name/tz_offset/cutoff_hour/clock_flags`；`day` 是捕获审计标签 | 回放/改切点不静默重写历史 |
| K7 | 注意力：单调时钟、精确 idle 切分、30s 心跳、5min 切段、`closed/revision` 终态、跨学习日切段 | 是代理指标，不是「真实学习时长」 |
| K8 | 来源：`origin` 多槽 token + `actor(user/background/unknown)` | 区分主动/推送/后台，不把 IPC 成功当用户主动 |
| K9 | 领域：显式种子优先、禁止递归、leaf/lang/none 三基础层、`_none` 残差、`stale` 缓存、`attribution_version` | 不假装历史当时的领域 |
| K10 | 指标：`metrics.js` 唯一定义；`coverage_day` 区分 complete/partial/unknown/unsupported/archived；本期不输出综合兴趣分 | 缺数据不得补 0 |
| K11 | 隐私：默认开启、查询原文默认关、正文/标题/路径/凭证永不记；禁用/清除有 generation 屏障；保留期先归档再删原始 | 本地优先不等于无边界 |
| K12 | 备份：`behavior.db` 进备份；恢复缺失/早于 floor 时隔离；`dataEpoch` 防混用 | 原始证据不可重建 |
| K13 | 版本：`BDI_SCHEMA_VERSION` / `CATALOG_VERSION` / `METRICS_VERSION` / `DERIVE_VERSION` / `ATTRIBUTION_VERSION` 五个常量 | 查询返回版本，归档不冒充新口径 |
| K14 | 文档：D248 / §4.21 / §7.2 例外先写；`docs/bdi-catalog.md`、`docs/bdi-metrics.md` 由脚本生成 | 文档即合同 |

### 4.2 数据流

```text
renderer(main/lens/workbench/capture)
  track() / attention() / bridges
        │  behavior:batch（send，带 generation/renderId）
        ▼
host（校验 sender/role/frame/条数/字节/registry）
        │  writer 队列（1s/500 条，FULL 事务）
        ▼
behavior.db ── events / attn_spans / app_sessions / ipc_daily
        │
        ├─ domains：bdiPull（主库只读投影）→ entity_domains
        ├─ rollup：raw + entity_domains + bdiPull(review_logs/reading_events) → daily_metrics / domain_day / item_day / signal_daily
        ├─ coverage：capture_intervals + 丢弃计数 → coverage_day
        └─ query：具名只读 API → 将来功能
```

### 4.3 文件清单

```text
electron/behavior/
  index.js        // 门面：init({dataDir, pull, settings, app, powerMonitor, windows}) / emit / flushSync / close / status / setEnabled / purge / snapshotTo
  behaviorDb.js   // 打开、pragma、BDI_SCHEMA_VERSION + BDI_MIGRATIONS、snapshotTo
  registry.js     // EVENTS / CATALOG_VERSION / validate
  writer.js       // 队列、批量事务、限流、丢弃计数、flushSync
  sessions.js     // app_sessions、窗口 focus/blur、powerMonitor
  ipcTap.js       // ipcMain.handle/on 包装
  taps.js         // channel → 事件映射 + 成功谓词 + actor
  ipcStats.js     // channel → n/err/sum_ms/max_ms，60s 落 ipc_daily
  domains.js      // entity_domains 刷新
  rollup.js       // daily_metrics / domain_day / item_day / signal_daily
  metrics.js      // 指标注册表
  signals.js      // 信号注册表
  coverage.js     // capture_intervals → coverage_day
  query.js        // 具名只读查询
  privacy.js      // retention / purge / export
  policy.js       // behavior-policy.json（dataEpoch / analysisFloorTs）
  uuid7.js
src/lib/behavior/
  track.ts        // 渲染层 SDK
  attention.ts    // 注意力状态机
  origin.ts       // 多槽 origin token
  bridges.ts      // eventBus 单例桥
  day.ts          // 学习日纯函数（与 fsrsTime 逐时点对照）
  catalog.generated.ts // 由 registry 生成
scripts/
  gen-bdi-catalog.mjs
  gen-bdi-docs.mjs
tests/behavior-*.test.cjs
```

**依赖方向**：`electron/behavior/*` 不 `require("electron")`；需要的能力由 `init()` 注入（`dataDir`、`pull`、`settings`、`app`、`powerMonitor`、窗口列表）。纯 Node 测试可只加载 `behaviorDb/writer/registry/query`；Electron 测试再注入真实 DB。

---

## 5. 存储：`behavior.db`

### 5.1 打开与 pragma

- 路径：`path.join(dataDir, "behavior.db")`；`configure({dataDir})` 仿 `learnerDb.js`。
- pragma：`journal_mode=WAL`、`synchronous=FULL`、`busy_timeout=2000`、`auto_vacuum=INCREMENTAL`（建表前）、`wal_autocheckpoint=1000`、`journal_size_limit=16MiB`、`foreign_keys=OFF`、`temp_store=FILE`、`cache_size=-8000`。
- 打开失败（磁盘满/权限）：`disabled_error`，所有采集入口 no-op，`status()` 报原因；不抛出。
- 损坏（`SQLITE_CORRUPT`/`NOTADB`）：**停用并保留现场**，不自动改名/新建；用户确认后才处理。
- 库版本高于代码：只读探测 `user_version`，停用、不迁移、不碰文件。
- 关闭：`will-quit` 中 `writer.flushSync()` → `sessions.end("quit")` → `wal_checkpoint(TRUNCATE)` → `close()`；顺序在主库关闭之前（`main.js:2470` 附近）。

### 5.2 DDL（v1）

```sql
CREATE TABLE IF NOT EXISTS bdi_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  ts              INTEGER NOT NULL,          -- 生效发生时刻（可能被时钟纠偏）
  recv_ts         INTEGER NOT NULL,          -- host 收到时刻
  source_ts       INTEGER,                   -- 生产者原始时刻
  day             TEXT NOT NULL,             -- 捕获时学习日 'YYYY-MM-DD'
  tz_name         TEXT,                      -- IANA，如 Asia/Shanghai
  tz_offset       INTEGER NOT NULL,          -- 分钟（-getTimezoneOffset）
  cutoff_hour     INTEGER NOT NULL,          -- 捕获时的学习日切点
  clock_flags     INTEGER NOT NULL DEFAULT 0,-- 1=纠偏 2=回拨 4=时区变化 8=单调缺口
  type            TEXT NOT NULL,
  v               INTEGER NOT NULL DEFAULT 1,
  src             TEXT NOT NULL,             -- main|host|lens|workbench|capture
  render_id       TEXT,
  window_id       INTEGER,
  session_id      TEXT NOT NULL,
  ctx_id          TEXT,                      -- 阅读/复习/摘录复习会话
  presentation_id TEXT,                      -- 一次卡片呈现
  op_id           TEXT,                      -- 同一根用户操作
  actor           TEXT NOT NULL DEFAULT 'unknown', -- user|background|unknown
  surface         TEXT,
  origin          TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  library_item_id TEXT,
  card_id         TEXT,
  extract_id      TEXT,
  kp_id           TEXT,
  doc_pos         INTEGER,
  dur_ms          INTEGER,                   -- 事件自带时长（单调优先）
  num             REAL,
  text            TEXT,                      -- 仅 allowText 且设置打开；≤200 字
  props           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ev_day_type ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_ev_entity   ON events(entity_type, entity_id, ts);
CREATE INDEX IF NOT EXISTS idx_ev_card     ON events(card_id, ts) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_item     ON events(library_item_id, ts) WHERE library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_ctx      ON events(ctx_id) WHERE ctx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_session  ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_ev_op       ON events(op_id) WHERE op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ev_pres     ON events(presentation_id) WHERE presentation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attn_spans (
  id              INTEGER PRIMARY KEY,
  uid             TEXT NOT NULL UNIQUE,
  session_id      TEXT NOT NULL,
  render_id       TEXT,
  window_id       INTEGER,
  src             TEXT NOT NULL,
  day             TEXT NOT NULL,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER NOT NULL,
  surface         TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  library_item_id TEXT,
  card_id         TEXT,
  extract_id      TEXT,
  ctx_id          TEXT,
  origin          TEXT,
  active_ms       INTEGER NOT NULL,
  idle_ms         INTEGER NOT NULL,
  mono_ms         REAL NOT NULL,
  pos_ranges      TEXT,                      -- [[from,to],…]，≤20 段
  keys            INTEGER NOT NULL DEFAULT 0,
  clicks          INTEGER NOT NULL DEFAULT 0,
  scroll_px       INTEGER NOT NULL DEFAULT 0,
  revision        INTEGER NOT NULL DEFAULT 1,
  closed          INTEGER NOT NULL DEFAULT 0,
  end_reason      TEXT,                      -- switch|idle|blur|hidden|unload|split|day_cut|clock|recovered|suspend|lock
  tz_name         TEXT,
  cutoff_hour     INTEGER NOT NULL,
  clock_flags     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attn_day    ON attn_spans(day);
CREATE INDEX IF NOT EXISTS idx_attn_entity ON attn_spans(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attn_item   ON attn_spans(library_item_id) WHERE library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attn_open   ON attn_spans(closed) WHERE closed = 0;
CREATE INDEX IF NOT EXISTS idx_attn_session ON attn_spans(session_id);

CREATE TABLE IF NOT EXISTS app_sessions (
  id              TEXT PRIMARY KEY,
  data_epoch      TEXT NOT NULL,
  device_id       TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  end_reason      TEXT,                      -- quit|crash_recovered|relaunch|suspend
  clean_exit      INTEGER NOT NULL DEFAULT 0,
  last_seen_ts    INTEGER NOT NULL,
  app_version     TEXT NOT NULL,
  catalog_version INTEGER NOT NULL,
  os              TEXT NOT NULL,
  locale          TEXT,
  foreground_ms   INTEGER NOT NULL DEFAULT 0,
  active_ms       INTEGER NOT NULL DEFAULT 0,
  event_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ipc_daily (
  day      TEXT NOT NULL,
  channel  TEXT NOT NULL,
  n        INTEGER NOT NULL,
  err      INTEGER NOT NULL,
  sum_ms   REAL NOT NULL,
  max_ms   REAL NOT NULL,
  PRIMARY KEY (day, channel)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS entity_domains (
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  udc_json            TEXT NOT NULL DEFAULT '[]', -- [{code,level,w}]，含 _none，权重和为 1
  udc_main            TEXT,                        -- 最高权重码；NULL=未归因
  lang                TEXT,
  method              TEXT NOT NULL,               -- card_domain|extract_cards|doc_cards|track|kp|none
  quality             TEXT NOT NULL DEFAULT 'unknown', -- ok|low_support|partial|unknown|stale
  attribution_version INTEGER NOT NULL DEFAULT 1,
  resolved_at         INTEGER NOT NULL,
  stale               INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS daily_metrics (
  day       TEXT NOT NULL,
  metric    TEXT NOT NULL,
  dim_type  TEXT NOT NULL,                  -- all|udc|item|surface|origin|initiative
  dim_value TEXT NOT NULL,                  -- dim_type=all 时为 '*'
  n         INTEGER NOT NULL,
  sum       REAL NOT NULL,
  quality   TEXT NOT NULL DEFAULT 'unknown',
  rv        INTEGER NOT NULL,
  PRIMARY KEY (day, metric, dim_type, dim_value)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS domain_day (
  day                 TEXT NOT NULL,
  udc                 TEXT NOT NULL,        -- 叶子码 | lang:<iso> | _none
  level               TEXT NOT NULL,        -- leaf|lang|none
  active_ms           REAL NOT NULL DEFAULT 0,
  idle_ms             REAL NOT NULL DEFAULT 0,
  self_ms             REAL NOT NULL DEFAULT 0,
  pushed_ms           REAL NOT NULL DEFAULT 0,
  neutral_ms          REAL NOT NULL DEFAULT 0,
  read_ms             REAL NOT NULL DEFAULT 0,
  review_ms           REAL NOT NULL DEFAULT 0,
  xreview_ms          REAL NOT NULL DEFAULT 0,
  author_ms           REAL NOT NULL DEFAULT 0,
  browse_ms           REAL NOT NULL DEFAULT 0,
  other_ms            REAL NOT NULL DEFAULT 0,
  answer_ms           REAL NOT NULL DEFAULT 0,
  n_reviews           INTEGER NOT NULL DEFAULT 0,
  n_again             INTEGER NOT NULL DEFAULT 0,
  n_hard              INTEGER NOT NULL DEFAULT 0,
  n_good              INTEGER NOT NULL DEFAULT 0,
  n_easy              INTEGER NOT NULL DEFAULT 0,
  n_new_reviewed      INTEGER NOT NULL DEFAULT 0,
  n_extracts          INTEGER NOT NULL DEFAULT 0,
  n_annotations       INTEGER NOT NULL DEFAULT 0,
  n_cards_manual      INTEGER NOT NULL DEFAULT 0,
  n_cards_ai_kept     INTEGER NOT NULL DEFAULT 0,
  n_opens_self        INTEGER NOT NULL DEFAULT 0,
  n_source_jumps      INTEGER NOT NULL DEFAULT 0,
  n_explains          INTEGER NOT NULL DEFAULT 0,
  n_queries           INTEGER NOT NULL DEFAULT 0,
  n_skips             INTEGER NOT NULL DEFAULT 0,
  n_defers            INTEGER NOT NULL DEFAULT 0,
  n_deletes           INTEGER NOT NULL DEFAULT 0,
  deliberate_production REAL NOT NULL DEFAULT 0,
  n_items             INTEGER NOT NULL DEFAULT 0,
  quality             TEXT NOT NULL DEFAULT 'unknown',
  rv                  INTEGER NOT NULL,
  PRIMARY KEY (day, udc, level)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_dd_udc ON domain_day(udc, level, day);

CREATE TABLE IF NOT EXISTS item_day (
  day             TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  active_ms       REAL NOT NULL DEFAULT 0,
  self_ms         REAL NOT NULL DEFAULT 0,
  pushed_ms       REAL NOT NULL DEFAULT 0,
  n_opens         INTEGER NOT NULL DEFAULT 0,
  n_extracts      INTEGER NOT NULL DEFAULT 0,
  n_annotations   INTEGER NOT NULL DEFAULT 0,
  n_cards         INTEGER NOT NULL DEFAULT 0,
  n_reviews       INTEGER NOT NULL DEFAULT 0,
  progress_chars  REAL,
  covered_chars   REAL,
  first_origin    TEXT,
  quality         TEXT NOT NULL DEFAULT 'unknown',
  rv              INTEGER NOT NULL,
  PRIMARY KEY (day, library_item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS signal_daily (
  day       TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  udc       TEXT NOT NULL,
  level     TEXT NOT NULL,
  n         INTEGER NOT NULL,
  value     REAL NOT NULL,
  quality   TEXT NOT NULL DEFAULT 'unknown',
  rv        INTEGER NOT NULL,
  PRIMARY KEY (day, signal_id, udc, level)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS capture_intervals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_session_id  TEXT NOT NULL,
  start_ts        INTEGER NOT NULL,
  end_ts          INTEGER,
  state           TEXT NOT NULL,             -- enabled|disabled|fault|suspend
  reason          TEXT,
  catalog_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_start ON capture_intervals(start_ts);

CREATE TABLE IF NOT EXISTS coverage_day (
  day        TEXT NOT NULL,
  metric_key TEXT NOT NULL,                  -- events|attention|review|reading|domains|sessions|ipc
  state      TEXT NOT NULL,                  -- complete|partial|unknown|unsupported|archived
  lost_n     INTEGER NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, metric_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS archived_days (
  day                 TEXT PRIMARY KEY,
  archived_at         INTEGER NOT NULL,
  rv                  INTEGER NOT NULL,
  attribution_version INTEGER NOT NULL,
  valid               INTEGER NOT NULL DEFAULT 1,
  reason              TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS dirty_days (
  day    TEXT PRIMARY KEY,
  reason TEXT NOT NULL
) WITHOUT ROWID;
```

**`bdi_meta` 键**：`schema_created_at`、`data_epoch`、`catalog_version`、`metrics_version`、`derive_version`、`attribution_version`、`rollup_seq_watermark`、`rollup_attn_watermark`、`domains_refreshed_at`、`dropped_total`、`dropped_by_reason_json`、`last_retention_run`、`last_session_id`、`last_app_version`、`first_enabled_at`、`analysis_floor_ts`、`last_rollup_at`。

### 5.3 迁移

- `behaviorDb.js` 内置 `BDI_SCHEMA_VERSION` + `BDI_MIGRATIONS`，形状仿 `schemaVersion.js`；每项一个事务，同事务写 `PRAGMA user_version`。
- 版本 1 = 本节全部 DDL。禁止修改已发布的项；新结构只追加。
- 派生表结构变化也走迁移，并 bump `DERIVE_VERSION`。
- 禁用状态下仍允许迁移（迁移是数据保全，不是采集）；但不得建会话、修复区间、写事件。

---

## 6. 事件目录（v1）

> 命名 `组.动作`。采集：**M**=主进程 tap；**R**=渲染层 `track()`；**B**=eventBus 桥；**W**=host 内部。每个事件在 `registry.js` 登记 `owner` / `props` / `allowText` / `maxPerMin` / `intentOnly`。`intentOnly` 事件只记意图，不计产出。

### 6.1 应用 / 会话 / 导航

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `app.started` | W | launchKind(cold/relaunch/login_item), appVersion |
| `app.updated` | W | fromVersion, toVersion |
| `app.window_state` | W | window(main/lens/workbench/capture), state(focus/blur/minimize/restore/show/hide/tray), prevTs, durMs |
| `app.power` | W | state(suspend/resume/lock/unlock) |
| `nav.view` | B | from, to |
| `nav.overlay` | B | overlayId, action(open/close)；关闭时 durMs |
| `cmd.invoked` | R | commandId, via(shortcut/palette/menu/button) |
| `tray.action` | M | action |

### 6.2 书架 / 导入 / 阅读

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `library.imported` | M | entity=library_item；sourceType, via(picker/paste/drag/capture/html/url), sizeBytes, ok |
| `library.deleted` | M | entity=library_item |
| `library.meta_edited` | M | field(title/author/lang/priority) |
| `library.opened` | R | entity=library_item；origin；ctx_id=新阅读会话；doc_pos=恢复位置 |
| `library.closed` | R | ctx_id；progressPct |
| `shelf.filtered` | R | kind(sort/filter/search), value（枚举）；text=搜索词（allowText） |
| `reader.jumped` | R | doc_pos=目标；method(toc/search/link/mindmap/annotation/extract/bookmark/progress_bar), fromPos |
| `reader.searched` | R | text=查询词（allowText）；num=命中数 |
| `reader.selection_action` | R | num=选中字数；action(extract/annotate/highlight/explain/ste/translate/dict/card/copy/mindmap/search/other) |
| `reader.sidebar_tab` | R | tab |
| `reader.image_focused` | R | — |
| `reader.appearance` | R | key（只记改了哪项） |
| `reader.workflow` | B | state |
| `reader.finished` | R | progressPct；每 (dataEpoch,itemId) 一次 |

### 6.3 摘录 / 批注 / 摘录复习

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `extract.created` | M | extract_id；num=字数；via(selection/ai_next/capture/manual), priority, kind(extract/highlight) |
| `extract.op` | M | extract_id；op(postpone/postponeDays/advance/update/setPriority/setStatus/delete/batch/spanSet/switchEngine/rerankNow), delta, batchSize, annotation(bool), fieldNames[], color；**不记正文** |
| `extract.session` | R | ctx_id；phase(start/end), planned, done；dur_ms |
| `extract.shown` | R | extract_id, ctx_id；origin=queue；position |
| `extract.reviewed` | R | extract_id, ctx_id；props: outcome(resolved/postponed/deferred)、thinkMs |

### 6.4 制卡

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `card.created` | M | card_id, extract_id；cardType, generatedBy(manual/ai), genBatchId, via(selection/manual_editor/occlusion/ai_batch/disambiguate/workbench) |
| `card.edited` | M | card_id；fields(变更字段名数组), cardType（surface 区分复习中编辑） |
| `card.deleted` / `card.suspended` / `card.tags_changed` | M | card_id；suspended(bool)/tagsCount |
| `card.regenerated` | R | **intentOnly**；card_id；reason |
| `card.disambiguated` | R | **intentOnly**；candidates, chosen |
| `card.issue` | M | card_id；op(add/resolve), ruleId, severity |
| `ai_batch.created` | M | entity=batch；scope, draftCount |
| `ai_batch.resolved` | M | entity=batch；status, accepted, rejected, editedBeforeAccept |
| `card.leech_resolved` | M | card_id；resolution |

### 6.5 复习

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `review.session` | R | ctx_id；phase(start/end), mode(due/mixed/custom), planned, done；dur_ms |
| `review.shown` | R | card_id, ctx_id, presentation_id；cardType, queue, position, isNew |
| `review.revealed` | R | card_id, ctx_id, presentation_id；dur_ms=think_ms（performance.now） |
| `review.extra_revealed` | R | card_id；kind(mnemonic/example/context/source) |
| `review.rated` | M | card_id；ts=t1；dur_ms=单调 tap 耗时；props: tapStartTs, tapEndTs, tapSeq, durationMs（渲染层墙钟入参原样） |
| `review.undone` / `review.skipped` | M | card_id |
| `review.source_opened` | R | card_id（主动动作证据，不等于已证明兴趣） |
| `review.answer_judged` | R | card_id；mode, verdict |
| `review.leech` | B | card_id |
| `growth.feedback_shown` | R | **intentOnly**；tier |

**评分结果（Again/Hard/Good/Easy）、FSRS 稳定度等一律从 `review_logs` 读，事件不存。**

### 6.6 浏览 / 搜索 / 查词 / AI

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `browse.queried` | R | text=查询词（allowText）；num=结果数；filters(过滤器键名数组), sort |
| `browse.card_opened` | R | card_id；origin=browse |
| `browse.bulk_op` | R | op, count |
| `dict.lookup` | M | text=词（allowText，默认关）；lang, source(local/online), hit；**无正文/例句** |
| `dict.source_op` | M | op(toggle/remove/import/download) |
| `similarity.queried` | M | num=返回数 |
| `ai.invoked` | R | feature(card_gen/explain/ste/translate/chat/next_extract/mindmap/kp_extract/insight/memory/judge/other), outcome(ok/error/aborted)；dur_ms；num=输出字数 |
| `ai.panel_turn` | R | num=提问字数（不记正文） |
| `ai.websearch` | M | num=结果数（不记查询词） |

### 6.7 导图 / 知识点 / 学习者 / 日记 / 其他

| 事件 | 采集 | 关键字段 / props |
| --- | --- | --- |
| `mindmap.generated` | M | library_item_id；kind, ok |
| `mindmap.node_action` | M+R | entity=map_node；action(expand/expand_all/explain/deepen/jump) |
| `mindmap.viewed` | R | library_item_id；origin |
| `knowledge.op` | M | kp_id；op(create/update/merge/unmerge/relation/deleteRelation/ref/resolveProposal/extractApply) |
| `knowledge.viewed` | R | kp_id；origin |
| `learner.track_op` | M | entity=track；op(save/delete/setMaterial), mode |
| `learner.panel_action` | B | action；origin=recommend |
| `learner.exercise` | M | kind(lexeme_mark/placement/unit_reread/reel_done/self_explain), outcome；**不读 payload 正文** |
| `journal.written` | M | num=字数；op(create/update/draftSend/delete), via(page/quick_capture/draft_send) |
| `capture.used` | M | kind(screen/text/image/region), trigger(global_shortcut/tray/button) |
| `memory.op` | M | op(setEnabled/backfillStart/backfillCancel/tidyNow/reset) |
| `insight.op` / `insight.viewed` | M/R | op；viewed 记打开 |
| `meaning.op` | M | op(create/resolve/delete) |
| `stats.viewed` | R | tab |
| `settings.changed` | M | key；白名单键另记 to（枚举/数值）；**AI Key/URL/路径永不记** |
| `fsrs.optimizer` | M | op(train/apply/reset), ok |
| `backup.op` / `anki.exported` | M | op, ok |
| `op.undo` | M | domain(card/extract/other) |
| `app.error` | M | module/代码（**不记消息正文**） |

### 6.8 明确不采集

鼠标坐标与轨迹、按键值（只计次数）、剪贴板、任何正文（材料/摘录/卡片/批注/日记/AI 对话）、材料与卡片标题、文件路径、窗口标题、其他应用信息、网络请求内容、API Key/URL。

### 6.9 采集责任（防重复）

- **持久化成功由 M 记**；R/B 只记「点击/发起/显示」。同一动作不得两个 owner 都算成功。
- `ai.invoked` 只表示一次 AI 调用完成；`ai_batch.resolved` 表示批次状态改变；`card.created` 表示落库。三者可组合，但不把 100 张自动生成卡算成 100 次主动创作。
- `dict.lookup` 与 `learning_events.dict_lookup`：前者是 BDI 行为记录（无正文），后者是学习者模型真源（有正文）；查询层按用途分开，不做计数合并。
- `learner.exercise` 只从 `learner:logEvent` 投影 `kind/outcome`，不读 payload；`learning_events` 仍是真源。
- `review.rated` 不存 rating；rating 从 `review_logs` 读。
- `reader.finished` 是「到达末尾代理指标」，不是「已读完/已理解」。
- `ipc_daily` 是诊断计数，不是用户学习次数；不得当行为指标。

### 6.10 通道覆盖

- `tests/behavior-coverage.test.cjs` 扫描 `electron/**/*.js` 的 `ipcMain.handle/on` 通道，与 `taps.js` + `ipcStats` 的显式登记表比对。
- 每个写通道必须二选一：登记事件映射，或带理由只计数（如 `reading:event` 真源是 `reading_events`、`library:updateProgress` 真源是 `progress_json`、`cards:persistNow` 纯重试）。
- 未登记写通道 → 测试失败；新增通道先改 `taps.js` 与本文，再实现。

---

## 7. 采集管线

### 7.1 主进程 IPC tap（`ipcTap.js` + `taps.js` + `ipcStats.js`）

在 `main.js` 顶部、**任何业务 `ipcMain.handle/on` 注册之前**安装：

```js
require("./behavior/ipcTap").install(ipcMain, behavior.emit);
```

规则：

1. 只包装 `taps.js` 静态登记的通道；未登记通道原样透传。
2. `handle`：保留原 `this`/参数/返回值/异常；tap 在 `setImmediate` 里执行，不延长业务响应。
3. `on`：保留 `this`、监听顺序、同步抛错、返回值；保存 `(channel, original) → wrapped` 映射；覆盖 `removeListener/off/removeAllListeners`；`once` 若出现则测试失败并要求补适配。
4. 排除所有 `behavior:*` 通道，避免自反馈。
5. 每个 channel 有**显式成功谓词**；不能用通用 `result != false` 推断所有接口（`cards:create` 返回 `{id}`、`cards:batch` 返回 `{ok}`、`cards:review` 返回 `true`、`dict:lookupLocal` 即使 miss 也要记）。
6. tap 不查询主库、不解析大 JSON、不序列化大批次、不 `await` BDI 结果；只投影静态 id、数值、枚举、短文本长度。
7. `cards:review` 只记 `tapStartTs/tapEndTs/tapSeq/durationMs`，**不查 latest log**；关联在查询/派生层做（§10）。
8. `cards:undoReview` 成功后把「当前学习日 + 前一日」标 dirty（撤销只删最近一条评分，重算两日足够）。
9. `ipcStats` 只维护有界 Map：channel → n/err/sum_ms/max_ms；每 60s 用唯一 batchId 落 `ipc_daily`；跨学习日先切批；排除 `behavior:*`。`on` 的耗时只代表同步 listener 返回，不代表 AI 流任务完成。

### 7.2 渲染层 SDK（`track.ts`）

- 环形队列（不要高频 `shift()`）：最多 500 条 / 1MiB；2s 或 100 条冲刷；`ipcRenderer.send("behavior:batch")`。
- 每条事件生成一次 `uid`；重试不换；span 心跳复用 uid。
- `track()` 只能在事件处理/受控 effect 中调用；不得放 render；不得新增 React state、重渲染或同步 IO。
- `setTrackContext` 在路由/实体离开时 **clear**；ReviewView 结束、切书、切卡后不得沿用上个 ctx/origin。
- 去重依据**呈现/操作身份**，不是「同卡 800ms 都算重复」：`review.shown` 按 `presentationId`，开关按操作序号；StrictMode effect 的 setup/cleanup 对称、应用级订阅单例；用户两次真实快速操作不能丢。
- `visibilitychange=hidden`、`pagehide`、`beforeunload` 冲刷。
- 禁用/清除时 host 发 `behavior:config`，renderer 清空 buffer、重置注意力、停止计时；旧 `generation` 的批次被 host 拒收。

### 7.3 注意力（`attention.ts`）

**定义**：Nutation 窗口在前台且获焦、未锁屏/挂起，并处于最近输入后的活动阈值内。是行为代理，不证明理解/在场。

状态：`inactive → active → idle → ended`。1s tick 只做算术和可见/焦点判断；30s heartbeat；单 span 最长 5min。

**精确积分**：对上个单调时刻 `p` 到 `now` 的区间，在 `lastInput + idleLimit` 切开：阈值前计 active、后计 idle；不能用 tick 结束时状态给整秒归类。状态变化、焦点变化、ctx/实体变化、学习日变化、5min 上限时切段。标准 span 只含一种注意力状态；`active_ms + idle_ms ≤ mono_ms`。

- 默认阈值：reader 180s、review 90s、其他 60s。
- `document.visibilityState === "visible" && document.hasFocus()` 才计 active；blur 当刻停止 active（不是再给 60s）。
- page hidden/blur 立即封段并 flush；hidden 停 interval，visible/focus 后重设 `lastTick`，只有真实输入或已确认的当前前台上下文才重开。
- `performance.now()` 计算时长；墙钟仅用于定位。每次 tick 检查 `wallDelta` 与 `monoDelta` 差值，差 >5s 结束旧段并置 `clock` 标记；大调度间隔 >5s 的未观测部分标缺口，不把 clamp 后的剩余时间假装完整。
- 在 `learningDayIndex` 当前学习日边界切段；跨边界按交点分配。
- 心跳：同 uid `revision` 严格递增，累计值不下降；`closed=1` 后拒绝一切更新（包括迟到 heartbeat）。
- 崩溃修复只关闭到最后已持久化心跳，**不延伸至下一次启动**。
- 输入接入：根文档 keydown/pointerdown/wheel（passive/capture）+ 节流 pointermove；EPUB foliate 已有 iframe load/事件挂点接 poke，分节卸载清理；不得重复挂多个监听。
- 位置段：显式 toc/search/link/progress jump 必须断开，即使距离小于 5000 字符；其余相邻位置差 >5000 视为不连续。合并区间求并集，最多 20 段；超限保留已知部分并置 `ranges_truncated`，结果是**观测经过位置下界**，不声称已读字数。PDF/无稳定 char_pos → NULL/unsupported，不补 0。
- 模态弹窗不切换区间（时间计入底层实体）；`workbench/lens` 若加载 SDK，按各自 surface 独立计，窗口 `hasFocus()` 保证不双计。

### 7.4 来源与 actor（`origin.ts`）

- `origin` 枚举：`shelf|search|browse|card_source|link|mindmap|kp|journal|resume|queue|recommend|review_flow|notification|capture|reader_toc|reader_internal|workbench|unknown`。
- `markOrigin({window, entityType, entityId, nonce}, origin)`；3s 过期；一次消费；按 `(window,target)` 匹配，不用全局单槽。
- 调用点：Bookshelf（shelf）、全局/书内搜索（search）、CardBrowser（browse）、卡片「查看原文」（card_source）、导图节点跳转（mindmap）、知识点（kp）、日记链接（journal）、启动恢复（resume）、摘录/复习队列（queue）、NextStepsPanel（recommend）、工作台（workbench）、阅读器目录（reader_toc）。
- `actor=user/background/unknown` 独立于 origin。UI 确认动作提供根 `opId`；后续自动派生工作沿用 `cause`，但事件本身标 background。批量 AI 生成、导入、同步写入不自动算用户手动制卡。
- `initiative` 不存库，聚合时由固定映射派生（可迭代，改映射后 bump `DERIVE_VERSION` 重建）：active=shelf/search/browse/card_source/link/mindmap/kp/journal/capture/reader_toc/workbench；pushed=queue/recommend/review_flow/notification；neutral=resume/unknown。

### 7.5 会话（`sessions.js`）

- `init()`：修复上次未结束会话 → `ended_at = MAX(最后事件 ts, 最后区间 end_ts, last_seen_ts, started_at)`、`end_reason='crash_recovered'`；把遗留 `closed=0` 的 span 置 `closed=1,end_reason='recovered'`；新建会话并 emit `app.started` / `app.updated`。
- 监听所有 `BrowserWindow` 的 `focus/blur/minimize/restore/show/hide`，累计 `foreground_ms`，emit `app.window_state`（同状态 1s 去抖；带 `prevTs/durMs`，供 rollup 按日切分）。
- `powerMonitor` 的 `suspend/resume/lock-screen/unlock-screen` → `app.power`；挂起前冲刷 writer；通知 renderer 封段。
- `end(reason)`：回填 `active_ms = SUM(attn_spans.active_ms)`、`event_count`、`clean_exit`（仅最终事务提交后置 1）。
- 会话每 30s 写 `last_seen_ts`；无事件会话也有 `started_at/last_seen_ts`，恢复的 `ended_at` 不得早于 `started_at`。

### 7.6 写入器（`writer.js`）

- 每 1s 或 500 条触发；每事务最多 500 条/512KiB；事务结束即让出事件循环。
- 预编译 `insEvent` / `upsertSpan`；`attn.span` 不进 `events`，走 `attn_spans` upsert：
  `INSERT … ON CONFLICT(uid) DO UPDATE SET … WHERE attn_spans.closed=0 AND excluded.revision > attn_spans.revision`。
- 校验先行；坏行/未知事件记录拒绝原因，不让一条毒数据使整批永久重试；约束错误时受限拆分定位坏行；IO/磁盘满不逐行狂重试。
- 队列上限 5000；溢出丢最旧，按日/来源/原因计质量；`dropped` 每 60s写回 `bdi_meta.dropped_total`。
- 禁用/`disabled_error` 时队列清空、不建会话、tap/track 直接 return。
- 应用就绪前 `emit` 的事件先留在队列，`init` 完成后再写；DB 打开失败则清空并停用。

---

## 8. 领域归因（`domains.js`）

### 8.1 只读读取面

在 `electron/db.js` 新增**一个只读导出** `bdiPull({ table, mode, cursor, limit, ids })`。`table` / `mode` 是显式枚举；SQL 模板固定、参数绑定；只读、不 `persist`、不启动长事务。

| table | 白名单投影（其余列不得离开主库） |
| --- | --- |
| cards | `_rowid,id,card_type,domain`；`context_ref_json` 只经 `CASE WHEN json_valid(...) THEN json_extract(...,'$.extractId'/'$.documentId') END` 取 id；`knowledge_point_id,generated_by,gen_batch_id,created_at,updated_at,is_deleted,fsrs_config_id` |
| extracts | `_rowid,id,document_id,parent_type,parent_id,kind,status,priority,created_at,updated_at,is_deleted` |
| documents | `_rowid,id,library_item_id,is_deleted`；**不读 markdown/blocks/toc，连 `LENGTH(markdown)` 也不读** |
| library_items | `_rowid,id,source_type,lang,priority,created_at,updated_at,is_deleted`；不读 title/author/url/path/cover |
| knowledge_points | `_rowid,id,domain_id,merged_into,status,created_at,updated_at,is_deleted` |
| learner_tracks | `_rowid,id,mode,lang,udc_codes_json,status,created_at,updated_at,is_deleted` |
| track_materials | `_rowid,id,track_id,library_item_id,member,created_at,updated_at,is_deleted` |
| review_logs | `_rowid,id,card_id,rating,reviewed_at,duration_ms,fsrs_before_json,fsrs_after_json,fsrs_config_id,fsrs_before_config_id,review_seq` |
| reading_events | `_rowid,id,item_id,char_pos,created_at` |
| fsrs_configs | `_rowid,id,algorithm,algorithm_version,weights_json,scheduler_options_json,config_fingerprint` |

- `scan`：`rowid > :cursor ORDER BY rowid LIMIT :limit`；`id` 是实体身份，`rowid` 只是分页位置。
- `updated`：按 `(updated_at,rowid)` 复合游标；带重叠窗口重复拉取，按 id upsert。
- `time`：`review_logs` 按 `(reviewed_at,rowid)`、`reading_events` 按 `(created_at,rowid)`。
- `ids`：按 id 批量取，≤200。
- limit 50–500；`EXPLAIN QUERY PLAN` 与大库耗时实测；不达标则退回 `scan`，不修改主库索引凑答案。

### 8.2 归因规则（按顺序，命中即停）

**种子**：

- card：`cards.domain` 第 1 个权重 0.7、第 2 个 0.3（只有 1 个则 1.0）。这是建模假设，不是客观阅读占比。
- kp：`knowledge_points.domain_id`（1.0）；`merged_into` 链最多 10 跳，检测环/目标缺失 → unknown。
- track：`track_materials.member=1` 且未被 `member=0` 排除的轨道；`udc_codes_json` 平分；`mode=language` 且有 `lang` → `lang:<iso>`。

**规则**：

1. **item** 分布仅用关联到它的卡片**显式领域**直方图；`document_id` 与 `extract→document` 同时存在先去重；矛盾标 `partial`，不重复计一张卡。item 卡片数 <3 标 `low_support`。item 最多展示前 3 个且占比 ≥0.1 的领域，被裁掉的权重进入 `_none` residual，不重新归一。
2. **extract** 分布仅用该摘录下有**显式领域**的卡片；无种子才继承 item。高亮（`kind='highlight'`）与摘录分开，不把高亮算成摘录两次。
3. **card** 显式缺失时依次用规范 KP 种子、extract 已有种子、item 分布；禁止 card↔extract↔item 相互递归（card 回落到 extract 仅当 extract 是 `extract_cards` 显式种子，不是继承 item 的结果）。
4. **语言域**必须有明确 `mode=language` 的轨道学习意图；**不能仅因书是英语就认定它属于“英语学习”**。
5. 删除实体：`entity_domains` 行**不删除**；源实体缺失时保留最后已知 `udc_json`，`stale=1`、`quality='stale'`。从未观测过的删除实体只能 `unknown`。
6. `entity_domains` 返回 `method/quality/attribution_version` 和完整权重（含 `_none`，和为 1）；`udc_main` 最高权重，平票按确定性顺序。
7. 任意一次刷新使某实体的 `udc_main` 或权重改变 → 把该实体出现过的 `day` 标 dirty；**不只看主领域**（次领域权重、KP 合并、材料迁移、轨道成员变化都要回溯）。

### 8.3 刷新时机

- 启动后 90s 首次全量 scan；之后每 30 分钟按 `updated_at` 增量；`cards/changed`、`extracts` 写、`library` 写后 5 分钟合并一次。
- 初始全量按表分页，单页 ≤4ms（主线程预算），页间 `setImmediate`；大库不达标则暂停并报诊断，不硬塞索引。
- `attribution_version` 变化：清空 `entity_domains` 重建，并把保留期内的所有 `day` 标 dirty（分块重算）。

---

## 9. 派生层与指标

### 9.1 `metrics.js` 注册表

每个指标必填：`id / unit / grain / source / coverageKey / definition / nullPolicy / estimatePolicy / additivity / version`。所有 `daily_metrics.metric`、`domain_day` 列、`signal_daily.signal_id` 都有唯一条目；维度/主键不是指标。常量与阈值是产品假设，版本化，调用方不得偷偷改。

核心指标：

| 指标 | 定义 |
| --- | --- |
| `ev:<type>` | 事件计数（n）与 `num` 之和（sum） |
| `attn.active_ms` / `attn.idle_ms` | 规范化 span 的 active/idle |
| `attn.self_ms` / `attn.pushed_ms` / `attn.neutral_ms` | 按 origin/initiative 分桶 |
| `review.answer_ms` | 有效 `review_logs.duration_ms`，负数/非有限/单次 >30min 不计有效时长，另报 invalid_count |
| `review.think_ms` | `review.revealed.dur_ms` |
| `session.foreground_ms` / `session.count` | 窗口焦点累计 / 会话数 |
| `deliberate_production` | 用户明确发起的摘录/批注/手动卡，按 op 去重；AI 确认每根 op 最多记 1，自动生成/导入/sync/unknown 不计 |
| `effort_min` | attention 完整日 = active_min；无 attention 的历史期可提供 answer_min + 手动产出估算（extract 2min/annotation 1min/manualCard 3min），标 estimate；部分覆盖日默认 NULL，另报已观测下界 |
| `engaged` | active_min≥10 或可信 answer_min≥5 或 deliberate_production≥2；任一足量证据可为 1；未达阈值但有缺口→NULL；足够覆盖且未达→0；历史仅 answer 证据标 estimated |
| `progress_chars` | 相对「以前最高已记录位置」的正向推进；首条记录无 baseline→NULL；可能由跳转产生 |
| `covered_chars` | 观测位置并集下界；不是已读字数 |
| `consistency_8w` | 最近 8 个完整 ISO 周，engaged≥2 天的周数/完整可判定周数；当前未完周不计 |
| `pass_rate_28` / `pass_rate_lb_28` | `review_logs` 中当次 `fsrs_before_json.state` 明确为 Review 的有效评分，非 Again 占比与 Wilson 95% 下界；按**主领域独占整数样本**计算，不把加权小数塞入二项公式 |
| `s_growth_med_28` | 有效非 Again 且 `s_before>0`、配置/快照可解析的 `s_after/s_before` 中位数；不等于认知能力 |
| `share_28` / `self_ratio_28` / `depth_28` | 同一来源/版本/基础层；分母 0 → NULL；不跨 level 相加 |

### 9.2 `rollup.js`

1. 读 `rollup_seq_watermark` / `rollup_attn_watermark`，取出新增行涉及的 `day` 集合，并入 `dirty_days`。
2. 对每个脏日：`DELETE FROM daily_metrics/domain_day/item_day/signal_daily WHERE day=?`，然后用该日全部原始数据 + `entity_domains` + `bdiPull(review_logs/reading_events)` 重算并插入——**每天一个事务**，日与日之间 `await setImmediate`，保证主线程单次阻塞 <50ms。
3. 更新水位线；删除 `dirty_days`。
4. `DERIVE_VERSION` 与 `bdi_meta.derive_version` 不同 → 清空**非归档**两张表全量重建（signals/INITIATIVE/维度变化时 +1）；归档日保持旧版并标 `archived`。
5. 触发：启动 120s 后一次；之后每 30 分钟；`behavior:query` 调用前若水位落后 >5 分钟先同步跑一次增量（或返回 `stale`，不阻塞）。
6. **正确性约束**：增量结果必须与「清空后全量重建」逐键一致（浮点容差 1e-9），归档日除外。

**日事实口径**：

- 时间唯一来自规范化 attention；按 surface 分 read/review/xreview/author/browse/other，各桶和 = active。
- `self/pushed/neutral` 分开，三者之和 = active（浮点容差）。
- 评分和 `answer_ms` 来自 `review_logs`，按领域权重 `w` 分配 `answer_ms`；计数只计主领域（整数），不把加权小数塞进 `n_reviews`。
- `review.think_ms` 来自 `review.revealed`；`n_reviews/n_again/...` 来自 `review_logs` 主领域。
- live 创建/批注动作来自成功事件，按实体/生命周期/opId 去重；同一个 highlight/extract 的保存不能经两个 owner 算两次。
- AI 保留卡数是实体产出量，不等于投入；必须明确用户接纳且 120s 误操作窗口已过才称 `ai_kept`，否则 pending/unknown。批量自动生成没有用户确认不能触发 `engaged`。
- `n_items` 是 distinct 材料数，不可跨领域相加；父级 distinct 重新求集合。
- 空值传播：无支持/未覆盖=NULL；完整覆盖下确实无动作=0；除数 0→NULL，不返回 Infinity/NaN。

### 9.3 `coverage.js`

`capture_intervals.state` ∈ `enabled/disabled/fault/suspend`；能力起点来自首次启用成功时刻，不是第一次事件 `first_seen`。

`coverage_day.state` ∈ `complete/partial/unknown/unsupported/archived`：

- 对某学习日，若该指标采集能力在该日所有应用运行时段已启用、版本支持、无未恢复队列损失/重载/时钟缺口 → `complete`。
- 应用没有运行不等于没在别处学习；本产品的 0 只表示「本应用内无已知动作」，查询返回必须带这句话。
- 首次部署前、禁用期、未洁退出尾部、worker/DB 不可用、丢包 → `partial`/`unknown`。
- 已验证充分证据可把 `engaged` 置 1，即使同日其他时段缺失；没有足量证据时，只有 `complete` 才能判 0，其余 NULL。
- 查询窗口不悄悄裁掉缺失日后仍称完整 28 天：返回 `requestedWindow/observedWindow/knownDays/unknownDays/estimateDays` 及原因。

### 9.4 `signals.js`

信号 = 某类可观测行为 × 过滤条件 × 数值函数 × 极性 × 单位。只负责「把行为翻译成按领域、按日的强度原料」，权重由将来功能决定。

| id | 真源与过滤 | 单位/注意 |
| --- | --- | --- |
| open_active | `library.opened`，self_initiated | 去重打开次数 |
| open_pushed | `library.opened`，pushed | 推送打开次数 |
| dwell_active / dwell_pushed | 规范化 attention，分别按来源 | 分钟，不加 answer 分钟 |
| jump_purpose | `reader.jumped`，toc/search/link 等明确方法 | op 次数；不证明理解 |
| extract_made | 成功用户创建事件，实体/op 去重 | 次数，高亮与摘录不重复 |
| annotate | `extract.op` 且 `annotation=true` | 次数 |
| card_manual | 成功用户手动创建，非导入/后台 | 人工动作证据 |
| ai_accept | 明确用户接纳操作 | 确认 op 次数；acceptedCardCount 另字段，不默认累成投入 |
| source_jump | `review.source_opened` | 主动回源次数 |
| explain_ask | `ai.invoked`，explain/ste/translate，用户发起且成功 | 请求次数，失败/取消另计不混 |
| query | 已提交的书架/阅读/浏览查询，过滤空串、同 op 去重 | 次数，关闭原文仍可计 |
| dict_lookup | `dict.lookup` | 次数；不记词（默认） |
| finish_book | `reader.finished` | 到达末尾代理，一书一次 |
| journal_write | `journal.written`，排除 draft 自动保存 | 次数/字数 |
| mindmap_explore | `mindmap.node_action` | 次数 |
| kp_view | `knowledge.viewed` | 次数 |
| skip / extract_defer / card_delete / item_delete | 有效成功动作 | 可能是休息、整理、重复材料；**不自动解释为负面兴趣** |

按学习日衰减：`decayed = Σ value_day × 0.5^(calendarAge/halfLifeDays)`，`halfLifeDays ∈ [1,365]`；未来日/负 age 异常不入默认统计。raw/decayed 保留单位，分钟和次数不能直接相加。

未来消费者如要组合，必须显式提交版本化权重、单位归一、日/op 封顶策略：`score_signed = Σ polarity_s × weight_s × normalized_decayed_s`。**有负值的 signed score 不得直接代入 share 分母**；share 只用于 `p≥0` 的已归一证据，`α=5` 仅是该尺度的平滑强度，prior 在固定域集合上和为 1。本期只交原料，不输出综合兴趣分。

---

## 10. 只读查询 API（`query.js`）

主进程内部直接 `require` 使用；渲染层经 `behavior:query(name, params)` 只能调用具名查询（禁止任意 SQL / 表名 / 列名 / 文件路径）。

```ts
type BdiResult<T> = {
  ok: boolean;
  status: "ready" | "partial" | "warming_up" | "disabled" | "stale" | "not_enough_data" | "error";
  data: T | null;
  meta: {
    dataEpoch: string; schemaVersion: number; catalogVersion: number;
    metricsVersion: number; deriveVersion: number; attributionVersion: number;
    generatedAt: number; sourceThrough: number | null; lagMs: number | null;
    coverage: unknown; warnings: string[]; truncated: boolean;
  };
  error?: { code: string; message: string };
};
```

| 名称 | 参数 | 返回 |
| --- | --- | --- |
| `status` | — | 状态、队列/在途/丢弃、库与 WAL 字节、版本、维护进度、失败原因 |
| `coverage` | `{from,to,metricKeys?}` | 每日/区间能力、缺口、禁用、历史估算、未完成对账 |
| `metrics` | `{from,to,metric,dimType,dimValue?}` | `[{day,dimValue,n,sum,quality}]` |
| `domainDay` | `{from,to,level,domains?,metricIds?}` | 域×日；含 NULL 和质量，不只返回有活动的日 |
| `itemDay` | `{from,to,itemIds?}` | 材料×日；未知材料不补造名称 |
| `signals` | `{from,to,level,signalIds?,halfLifeDays?}` | 未加产品权重的 raw/decayed/observations，正负证据分开 |
| `attentionByDomain` | `{from,to,level,initiative?}` | 规范化时长、占比、unknown 残差，不混层级 |
| `entityTimeline` | `{entityType,id,from,to,cursor?}` | 原始事件/区间分别标类型合并排序；默认不含查询原文 |
| `reviewContext` | `{from,to,cardIds?,cursor?}` | 权威评分 id、匹配状态、可缺失上下文 |
| `runs` | `{from,to,level,domain?,mode(strict/grace),asof?}` | 连续投入区间与左右截断标记；内部整数 day index |
| `features` | `{asof,level,domains?}` | 7/28/90 日及 8 周口径、样本和缺口；即时计算 |
| `dataSufficiency` | `{from,to,domain?,metricIds}` | 已知/未知/估算日、独立实体数、归因覆盖、leftCensored；不给武断“可靠分数” |

**`reviewContext` 的评分关联**（不在 tap 里查）：

1. 取范围内 `review.rated` 事件（含 `props.tapStartTs/tapEndTs`）与 `review_logs`。
2. 同 card、`reviewed_at ∈ [tapStartTs-5ms, tapEndTs+5ms]` 的候选做全局一对一匹配；一个候选/一次 tap 只能消费一次。
3. 唯一匹配 → `match_status='matched'`，返回 `reviewLogId/rating`；多候选/调钟/边界重叠 → `ambiguous`；没有 → `missing`。
4. `think_ms` 来自 `review.revealed`（同 presentation/ctx）；`grade_ms` 优先 tap 单调差；无足够一致性证据则 NULL。
5. 基础评分数/评分分布不因上下文缺失而少计；`review_logs` 是评分事实，BDI 事件只提供上下文。

**`runs`**：输入为 `domain_day` + `coverage_day`，按日去重升序，`engaged:1|0|null`；缺行先按 coverage 判 0/unknown；内部用整数 day index，输出转 `YYYY-MM-DD`；strict 用 grace=0，默认 grace=1；`isOpen` 只表示「截止现在尚未超过允许间隔」，不是预测未来。

**`features`**：`effort_ewma7/28` 用 `(1−2/(N+1))^age`、以有效权重和归一；无缺口下无活动日 0，unknown 使结果 partial/NULL；`momentum=ewma7/(ewma28+0.1)`；`trend_28` 对日历序号 OLS；`share_28` 不跨 level、不把估算分钟混入实测分母；`recency/tenure` 左截断标 `lower_bound`。

**`level`**：接受 `base/main/leaf/lang/none`。`base` = leaf + lang + none 这一互斥基础层；`main` 是 leaf 的另一投影；**禁止把多个 level 直接相加**；排序默认排除 `none`。

**限制**：日期有效、`from≤to`；单次窗口 ≤730 日、行数 ≤5000、响应 ≤2MiB；更长历史分页或后台导出；稳定排序 `(day,id/uid)`；cursor 含 epoch/版本/过滤器指纹，变更拒旧 cursor；单 renderer 最多 2 并发、10 次/秒；worker 不存在时主进程 pending ≤16；常规超时 3s；超时不等于底层 SQL 已取消，查询 SQL 本身必须有索引/有界扫描。

**权限**：主窗口可 `status/query/manage`；lens/workbench 仅 `batch/onConfig/status`；capture 仅 `batch/onConfig`。主进程对每个 handler 校验 `senderFrame === sender.mainFrame`、窗口角色、来源；渲染层传的 `src/文件路径/目标 DB 路径` 全部不信任。导出路径只能来自主窗口系统选择器产生的受控句柄。

---

## 11. 隐私、禁用、清除与保留

### 11.1 设置

`settings.app.behavior = { enabled: true, retentionDays: 730, recordQueryText: false }`；`retentionDays ∈ {90,365,730,0(永久)}`。

`behavior-policy.json`（`userData` 根，原子写，**不进备份**）：`{ dataEpoch, analysisFloorTs, purgeAt, firstEnabledAt }`。用途：清除后即使旧 `settings.json` 被恢复，也不自动回填清除前的数据。

设置区块「学习行为数据（仅保存在本机）」：

- 开关「记录学习行为」；说明：「用于将来按你的学习习惯提供个性化功能。数据只保存在本机，从不上传。只分析本应用内可观测行为，不检测其他应用或真实注意力。」
- 统计行：记录数 / 占用空间 / DB+WAL 字节 / 最早记录日期 / 采集状态 / 最近聚合时间 / 缺口数。
- 下拉「保留原始记录」（3 个月 / 1 年 / 2 年 / 永久；派生数据始终保留，归档日标明）。
- 开关「记录搜索词与查词」（默认关）。
- 按钮「导出（JSONL）」→ 系统目录选择 → `nutation-behavior-<date>.zip`。
- 按钮「清除查询原文」→ 二次确认 → `events.text=NULL`、清 renderer 队列/临时导出、`recordQueryText=false`。
- 按钮「清除全部行为数据」→ 二次确认 → 采集暂停、generation 屏障、清库、`analysisFloorTs=purgeTs`、新 `dataEpoch`。
- 所有新文案四语同步（简/繁/英/日），`i18n-check` 退出 0；样式只用主题 Token；输入回车提交遵守 IME 判断。

### 11.2 禁用

- 禁用先阻止新采集：`generation++`，通知所有 renderer 清空 buffer/context、停止 attention/flush；host flush 已接收批次、结束当前 span、关闭 capture interval（state=disabled）；之后 renderer 不启动 tick/flush，host 不留队列/IPC 计数，并停止 `domains` 刷新与 `rollup` 调度（管理操作仍可用）。
- 重启仍禁用：不建会话、不修复区间、不 emit `app.started`；只允许 `status/export/purge` 管理操作。
- 再启用会新建 capture interval/任务 ctx，**不自动补采禁用区间内的历史事实**；当前实体元数据可在启用后重新读取作关联，但不能据此生成禁用期间用户动作。
- 设置失败必须明确告知，不能显示“已关闭”却让下次启动继续采集。

### 11.3 清除屏障（防止清完又出现）

1. 二次确认，告知：会关闭采集；主库评分/卡片等业务数据不删；既有备份/导出不会被连带删除。
2. host 立即提升 `generation`，拒收旧消息；通知所有 renderer 清空 buffer/context、停止 pull/query/维护、取消尚未提交的 call。
3. host 屏障等待此前短事务完成，关闭数据库；在 `privacy.js` 清理活动 `.db/-wal/-shm` 后建空库或保持关闭。重启监督器不得误判为崩溃并自动重建旧队列。
4. 同时清 `events/attn_spans/app_sessions/ipc_daily/entity_domains/daily_metrics/domain_day/item_day/signal_daily/capture_intervals/coverage_day/archived_days/dirty_days`；确认活动库为空且旧 generation 消息无法重入，之后才返回成功。
5. `behavior-policy.json` 原子写 `analysisFloorTs=purgeTs`、新 `dataEpoch`；未来明确开启后仅采集此边界之后的事实，禁止自动重放旧 `review_logs` 重现清除前分析。
6. 任一步失败 → `purge_failed` 并保持采集暂停；不能显示清除成功。临时导出/维护残留同时登记删除。SQLite 逻辑删除或文件删除**不保证 SSD 安全擦除**；旧备份、隔离副本需单独列出供用户删除。显式恢复旧备份可能恢复旧行为数据，恢复确认必须提示。

### 11.4 保留与归档

- 每日最多一次、最早启动 10min 后、空闲执行。
- 整日过期且派生追平才归档：先写 `archived_days`（rv/attribution_version），再按 `day` 批量删除 raw（每批 ≤5000 行、事务间让出），末尾受控 `incremental_vacuum`。
- 跨度当前日的 span 必须早已切分；不能删半日后把剩余数据当完整。
- 派生表替换/滚动允许物理删除；原始删除仅 `privacy.js`。静态测试按表分层，不错误禁止所有 `DELETE`。
- `entity_domains` 对仍被保留事实引用的实体保留必要最新证据；`f_*` 不存在，故不存在 90 天快照裁剪问题。
- `ipc_daily` 随原始保留期清理；`app_sessions` 同理。
- 归档日不可重建；查询默认排除，`includeArchived` 才可读，返回旧 rv/归因版本和 `incompatible_archived` 标记。

### 11.5 导出

- 系统选择器确认路径后，不经 worker：主进程 `flushSync()` + `db.backup(临时快照)`；随后只读**不同文件**逐表流式 JSONL（不是再连活动 `behavior.db`，更不是连 `library.db`）。
- 默认包含 `events.jsonl`、`attn_spans.jsonl`、`app_sessions.jsonl`、`ipc_daily.jsonl`、`capture_intervals.jsonl`、`coverage_day.jsonl`、`daily_metrics.jsonl`、`domain_day.jsonl`、`item_day.jsonl`、`signal_daily.jsonl`、`entity_domains.jsonl`、`archived_days.jsonl`、`schema.json`、`manifest.json`、`README.txt` 字段/缺失解释；M 镜像不存在，故不导出。
- `manifest` 包含 `formatVersion/dataEpoch/各层版本/timeBasis/表行数/是否脱敏/每成员 SHA-256`。
- 每行合法 JSON、UTF-8，逐页最多 500 行，不把整个库/ZIP 读入主进程内存；写 `.part`，所有成员完成后原子 rename；取消/失败删除临时快照和 part，维护登记防残留；校验回读 ZIP、哈希/行数/字段类型。
- 原文曾启用则导出前明确提示敏感短查询词，可选脱敏版把 `text` 置 NULL；不修改原库。
- 本期不实现行为导入/跨设备合并，不能把导出格式说成已支持可逆恢复。

### 11.6 零网络

`tests/behavior-no-network.test.cjs` 扫描 `electron/behavior/**` 与 `src/lib/behavior/**`：出现 `require("http"|"https"|"net"|"dgram")`、`electron` 的 `net`、`fetch(`、`XMLHttpRequest`、`WebSocket`、`sendBeacon` 即失败。BDI 不进入 AI 提示词，不向插件暴露 BDI IPC。

---

## 12. 备份与恢复

### 12.1 备份

- `main.js` 的 `backupOpts()` 增加 `snapshotBehavior: (dest) => behaviorDb.snapshotTo(dest)` 与 `behaviorDbFile`；`backup.js` 在 `dictionary.db` 之后加入 `behavior.db`（存在才加）。
- `snapshotBehavior` 先 `writer.flushSync()`，再 `db.backup(dest)`；生产环境缺快照函数不得退回裸拷贝运行库；`backup-meta.json` 增加 `behavior: { included, schemaVersion, dataEpoch, counts, snapshotAt }`。
- 主库/BDI 顺序快照**不承诺同一时点**；meta 记录 `snapshotAtLibrary` / `snapshotAtBehavior` 与 `crossDbSkewMs`；恢复后边界日标 `partial`（skew >5s 时）。
- `snapshotBehavior` 不可用不得静默称“完整备份”；meta/UI 标 BDI 未包含及原因。

### 12.2 恢复

- 接入现有 staging + `restore-pending.json` → 下一次启动、开任何数据库之前整组换入/清 sidecars（`backup.js:871-980`）。
- 含 `behavior.db`：换入；启动后 `dataEpoch` 从库内 `bdi_meta` 读；**主库事实已被替换**，因此启动后强制刷新 `entity_domains`，并把保留期内所有非归档 `day` 标 dirty 重算（不能沿用恢复前主库算出的领域归属）。
- 不含 `behavior.db`：把当前 `behavior.db` 隔离为 `behavior.pre-restore-<ts>.db`，新 `dataEpoch`；**不得**把旧行为数据与恢复后的旧主库直接混用。隔离副本只供手动导出/诊断，不自动再接回活动分析。
- 备份的 `behavior.snapshotAt < analysisFloorTs`：不还原行为库（隔离 staged 副本），提示用户这份备份早于清除。
- 恢复失败回滚所有已换文件；`behavior.db/-wal/-shm` 同组处理。
- 恢复确认对话框提示：备份来自另一设备（`deviceId` 不符）、BDI 是否包含、跨库快照可能错位。

### 12.3 同步

- 不登记 `syncTables.js`；`behaviorDb.js` 文件头注明「LOCAL-ONLY：不走应用同步、不发起网络上传（本地备份/导出由用户管理）」。
- 已确认 `sync-tables` 测试只扫 `library.db` 与顶层 `electron/*.js`；`electron/behavior/*` 不参与，但 BDI 自己的静态测试要按表分层检查物理删除。

---

## 13. 性能预算与容量

以下为**待实测的验收目标**，不是已测结果：

| 项 | 目标/闸门 |
| --- | --- |
| `track()` 热路径 | 无 IO/布局/React 更新；固定输入预热后 p95 ≤0.05ms |
| `tap` 热路径 | 静态计数 + 小字段投影 p95 ≤0.05ms；不能靠微秒级噪声宣称零开销 |
| 主线程转发 | ≤100 条/256KiB 标准批 p95 ≤0.5ms（含 structured clone） |
| writer | 每事务 ≤500 条/512KiB，常见批 <5ms；慢盘 >20ms 记日志并降批 |
| domains | 单页 ≤4ms，10s 窗占用 ≤4%；最小页仍慢即暂停并报诊断 |
| rollup | 每日一事务，单次阻塞 <50ms；日间 `setImmediate`；冷启动 120s 内不跑 |
| 启动 | ready-to-show 前无 BDI SQL；BDI init 在 `initDb` 之后异步；相同数据冷启动 A/B 首窗 p95 增量 <10ms |
| 复习 | 100 张同脚本多轮 A/B，评分→下一张 p95 增量 <1ms 目标；p99 与主线程长任务另报 |
| 内存 | 渲染层缓冲 ≤1MiB；主进程队列 ≤5000 条且序列化 ≤8MiB；整 app 增量 PSS 初始目标 ≤80MiB |
| 退出 | BDI 同步等待 ≤800ms；超时标不洁退出，不续等 |
| 容量 | 实测 `page_count×page_size` + WAL/导出尺寸外推；不用「固定 90MB/年」保证 |
| 压测 | 5 万卡/20 万评分；20 万卡/200 万评分；同毫秒大量评分；大单书/无 char_pos PDF；一年间断采集；快速多窗口切换；磁盘满/慢盘 |

若主库只读分页不达标，报告 BLOCKED 并重新设计，不暗改主库索引或降持久化。

---

## 14. 测试体系

所有新测试第一行 `// @runtime: system-node | electron-node | electron`（按实际选一）；仅临时目录，经 `node scripts/run-tests.mjs [过滤词]` 运行。

| 套件 | 必须覆盖 |
| --- | --- |
| `behavior-db` | 新建 DDL/重复打开/版本过新不修改/迁移失败回滚/损坏不静默覆盖/sidecar 组完整隔离 |
| `behavior-registry` | 所有事件和 props 显式类型；非法数值/嵌套/超长/未知来源；catalog 生成一致；短文本开关 |
| `behavior-writer` | 批量阈值/定时冲刷/flushSync 行数/disabled 零写入/限流/时钟纠偏/队列溢出 dropped/span upsert revision+closed 终态 |
| `behavior-sessions` | 未结束会话 `crash_recovered` 且 `ended_at≥started_at`；正常结束回填 active_ms；无事件会话 last_seen |
| `behavior-ipc-tap` | 返回值/异常/this 不变；tap 自身抛错不影响返回；未登记 channel 不包装；removeListener/once；`behavior:*` 不自反馈；写通道全覆盖 |
| `behavior-attention` | 假时钟：精确 idle 切分、reader 180s、5min 切段、<1s 丢弃、hidden/blur/lock/suspend、跨学习日/DST、调钟、双窗口总时长守恒、iframe 清理 |
| `behavior-origin` | 多槽 token 不串 A/B；过期/取消；无法匹配 unknown |
| `behavior-domains` | 显式/继承无环、多文档去重、次领域变化、裁剪残差、轨道排除、英语书不默认语言学习、KP 环/合并/撤销、删除后 stale |
| `behavior-rollup` | 运行两次结果相同；增量 == 全量重建（非归档）；DERIVE_VERSION 变化触发重建；多领域权重拆分 sum 正确；问号日不补 0 |
| `behavior-review-match` | 单候选 matched；多候选 ambiguous；调钟 missing；撤销后不计数；基础评分数不因上下文缺失而少计 |
| `behavior-query` | 具名白名单；衰减公式数值；runs 整数 day index/strict+grace；Wilson 整数样本；0 分母 NULL；负 score 不入 share；大窗口/并发/超时/过期 cursor |
| `behavior-privacy` | disabled 零采集写/零定时器；重启仍关闭；purge 后旧队列不能回写；清词含在途/临时文件；档案全清；磁盘满 purge 不假成功 |
| `behavior-backup` | 快照含 WAL 提交、不裸拷贝；旧包无 BDI 隔离；早于 floor 不还原；sidecars 整组；失败回滚；跨库错位标 partial |
| `behavior-no-network` | §11.6 静态扫描 + 运行时断网入口 |
| `behavior-catalog-docs` | `docs/bdi-catalog.md`/`docs/bdi-metrics.md` 与 registry/metrics 逐字一致 |
| 既有 | `ipc-contract`（重生成后通过）、`i18n-check`、`sync-tables`、flows、全量 `node scripts/run-tests.mjs` 无回归 |

GUI 验收：`npm run build` 后连续复习 100 张卡，评分到下一张的耗时增量 <1ms（p95）；StrictMode 下同一呈现只一条 `review.shown`；真实快速两次操作仍两条。

---

## 15. 文档、版本与任务拆解

### 15.1 文档先行（T0）

1. `AI_DEVELOPMENT_GUIDE.md` v49.76 → **v49.77**；§8.1 新增 **D248**（摘要 K1–K14）。
2. 新增 **§4.21「用户行为数据基础设施 BDI（D248）」**：一句定位 + 「唯一实现依据＝`docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md`」+ 不变量清单（零网络、不复制事实、异常不外溢、只追加、清除不可回填）。
3. **§7.2 例外登记**：(a) `behavior.db` 保留期/清除的物理删除；(b) `behavior.db` 走独立连接与 `FULL`（不是 NORMAL 例外）；(c) 备份快照不承诺跨库同一时点。**不写「最多丢 2 秒」**。
4. §7.5 隐私白名单追加 BDI 不采集项（正文/标题/路径/凭证/查询原文默认关）。
5. 本文放入 `docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md`；生成 `docs/bdi-catalog.md`、`docs/bdi-metrics.md`；重生成 `docs/ipc-contract.json`。
6. 只新增 §/D 编号，不改已有编号；跑 `node scripts/run-tests.mjs f11` 及 flows 全部。

### 15.2 任务表（一次一项）

| # | 任务 | 涉及文件 | 可机械验收 | 依赖 | 执行/复核 |
| --- | --- | --- | --- | --- | --- |
| T0 | 文档与合同：§15.1 全部 | `AI_DEVELOPMENT_GUIDE.md`, `docs/design/`, `docs/` | flows 通过；D248/§4.21 可 grep 到 | — | 实施模型；核心合同审查 |
| T1 | `uuid7.js` + `registry.js`（全部事件）+ `catalog.generated.ts` + `metrics.js` 定义 + 生成脚本 | `electron/behavior/`, `src/lib/behavior/`, `scripts/` | `behavior-registry`、`behavior-catalog-docs` 通过；typecheck | T0 | 实施模型 |
| T2 | `behaviorDb.js` + 迁移 + `writer.js` + `policy.js` + `index.js` 门面 | `electron/behavior/` | `behavior-db`、`behavior-writer` 通过 | T1 | 实施模型→审查 |
| T3 | `sessions.js` + main 生命周期接入（ready 后 init、will-quit 冲刷关闭） | `electron/behavior/sessions.js`, `electron/main.js` | `behavior-sessions` 通过；手动启动→退出 `clean_exit=1` | T2 | 实施模型→审查 |
| T4 | `ipcTap.js` + `taps.js` + `ipcStats.js` + 通道清单测试 | `electron/behavior/`, `electron/main.js` 顶部一行 | `behavior-ipc-tap` 通过；全量无回归；复习 3 张卡有 3 条 `review.rated` 且 tap 时间非空 | T2 | 实施模型→审查 |
| T5 | `behavior:*` IPC + preload 角色裁剪 + `ipc-contract` | `electron/main.js`, `electron/preload.js`, `electron/preload-capture.js`, 窗口工厂 | `ipc-contract` 通过；角色越权测试通过 | T2 | 实施模型 |
| T6 | 渲染层 SDK：`track.ts`、`origin.ts`、`attention.ts`、`bridges.ts`、`day.ts` | `src/lib/behavior/` | `behavior-attention`、`behavior-origin` 通过；typecheck | T5 | 实施模型 |
| T7 | 埋点 A：导航/书架/阅读器/搜索/注意力调用点/markOrigin | `App.tsx`, `Bookshelf.tsx`, `Reader.tsx`, `reader/*`, `useSelectionActions.ts`, `stats.ts`, `commands.ts` | 手动脚本后 `SELECT type,count(*)` 覆盖；attn_spans 有 reader 区间；iframe 输入有活动 | T6 | 实施模型 |
| T8 | 埋点 B：复习/摘录复习/制卡 UI | `ReviewView.tsx`, `ExtractReviewView.tsx`, `ManualCardEditor.tsx`, `RegenCardsModal.tsx`, `DisambiguateModal.tsx`, `AnswerJudgeModal.tsx` | 复习 5 张：5 shown、5 revealed、5 rated；StrictMode 不重复；评分流程无变化 | T6 | 实施模型；复习路径审查 |
| T9 | 埋点 C：浏览/AI/导图/知识点/日记/学习者/洞察/统计/设置 | `CardBrowser.tsx`, `src/lib/ai.ts` 及调用方, `MindmapTab.tsx`, `KnowledgeManager.tsx`, `JournalView.tsx`, `InsightPanel.tsx`, `NextStepsPanel.tsx`, `SettingsPanel.tsx` | 同 T7 统计法覆盖；`rg "aiGateway.chat"` 每处都传 feature | T6 | 实施模型 |
| T10 | `bdiPull` + `domains.js` + dirty days | `electron/db.js`, `electron/behavior/domains.js` | `behavior-domains` 通过；`EXPLAIN QUERY PLAN` 记录 | T2、T4 | 实施模型→审查 |
| T11 | `rollup.js` + `coverage.js` + `signals.js` + `query.js` | `electron/behavior/` | `behavior-rollup`、`behavior-review-match`、`behavior-query` 通过 | T10 | 实施模型→审查 |
| T12 | `privacy.js`（导出/清除/保留）+ 设置页区块 + 四语文案 | `electron/behavior/privacy.js`, `SettingsPanel.tsx`, `src/i18n/locales/*` | `behavior-privacy` 通过；`i18n-check` 退出 0；一致性闸门通过 | T5、T11 | 实施模型 |
| T13 | 备份纳入 `behavior.db` + 恢复隔离 | `electron/backup.js`, `electron/main.js` | `behavior-backup` 通过；旧备份无 BDI 可恢复且旧行为库被隔离 | T2、T12 | 实施模型→审查 |
| T14 | `behavior-no-network` + 全量回归 + 性能手测 + 文档收口 | `tests/`, `docs/` | 全量 `node scripts/run-tests.mjs` 通过；§13 GUI 验收数据写入 PR | T1–T13 | 实施模型；独立审查 |
| T15 | 合成场景/属性测试/`bdi-inspect.mjs`（只读快照） | `tests/`, `scripts/` | 附录 A 场景逐项；增量=全量属性；inspect 只读合法快照 | T11 | 实施模型 |

每个任务只提交自己的文件和测试；commit `feat(bdi): T<n> <说明>`。出现「字段不存在/返回形状不符/最小页仍阻塞/性能与耐久性冲突」时 BLOCKED，不自行削弱核心合同。

---

## 16. 风险登记与非目标

### 16.1 风险

| 风险 | 本版处理 | 上线前仍需证据 |
| --- | --- | --- |
| 主进程 FULL fsync 尾延迟 | 批量、后台优先级、降批、慢盘日志 | 慢盘/低空间/多库写入 A/B |
| 拦截 IPC 改变微任务/监听清理 | 异常隔离、原 this、移除映射、固定 API 范围 | 真实 Electron 合同/回归 |
| 主库只读分页卡顿 | token bucket、小页、繁忙暂停 | 大库 EXPLAIN 与 A/B，不达标重设计 |
| 上下文无法唯一关联 | missing/ambiguous，不 wrong-match | 同毫秒/快速撤销重评 fixture |
| 当前归因不代表历史当时 | `attribution_version` + `stale` + 披露 | UI 措辞与生成口径核对 |
| 历史实体幸存偏差 | 只对仍存在实体回填，标 `low_support/unknown` | 回填质量标记测试 |
| 不可观测时段 | NULL + coverage，不自动补零 | 开关/崩溃/首次部署边界测试 |
| 原始过期不可再解释 | 归档版本锁定、失效标记、永久选项 | 版本/日切点/删后档案测试 |
| 跨库快照不同时点 | source manifest、边界日 partial | 带并发评分的恢复演练 |
| 人眼不在场/静置阅读 | 注意力代理 + 边界说明 | 不宣称真实学习时长 |
| 设计仍有未知缺陷 | 不宣称“万无一失”，用不变量和独立审查兜底 | T14–T15 真实验证，不可由文档替代 |

### 16.2 非目标（本期不做）

- 兴趣评分算法调参、洞察界面、潜能判断、排行。
- 任何上报/遥测/跨设备同步/行为导入/合并。
- 把行为数据送给 AI 或写入提示词。
- 复制 `review_logs/cards/extracts/learning_events/reading_events` 的事实。
- worker 线程、`mx_*` 镜像、`f_*` 特征表、ACK/SAB 协议。
- `data-bdi` 通用点击埋点（列为后续扩展；本期用 IPC tap + 显式事件 + eventBus bridge 覆盖语义动作）。

---

## 附录 A：v2 `buildRuns` 的日期算术 bug 与正确写法

v2 的 `buildRuns` 用 `r.day` 直接做 `d - cur.end - 1`、`byDay.get(k)`、`k < today`。如果 `r.day` 是 `'YYYY-MM-DD'` 字符串：

- `d - cur.end` → `NaN`，`bridge` 恒 `false`，连续区间永远不桥接；
- `byDay.get(k)` 中 `k` 是数字、Map 的键是字符串 → 永远 `undefined`；
- `r.end + 1` → 字符串拼接（`'2026-01-01' + 1`）。

正确写法（内部整数 day index，输出转字符串）：

```js
// dayIndex('YYYY-MM-DD') -> 自 epoch 起的日历日序号（UTC 日历，不涉 DST）
// dayString(index) -> 'YYYY-MM-DD'
function buildRuns(rows, todayIndex, grace = 1) {
  const byDay = new Map(rows.map((r) => [r.dayIndex, r.engaged]));
  const engaged = rows.filter((r) => r.engaged === 1).map((r) => r.dayIndex).sort((a, b) => a - b);
  const runs = []; let cur = null;
  for (const d of engaged) {
    let bridge = !!cur && d - cur.end - 1 <= grace;
    if (bridge) for (let k = cur.end + 1; k < d; k++) {
      if (byDay.get(k) !== 0) { bridge = false; break; } // unknown 不能当休息日
    }
    if (bridge) { cur.end = d; cur.engagedDays++; }
    else { if (cur) runs.push(cur); cur = { start: d, end: d, engagedDays: 1 }; }
  }
  if (cur) runs.push(cur);
  for (const r of runs) {
    r.spanDays = r.end - r.start + 1;
    r.gapDays = r.spanDays - r.engagedDays;
    const completedGaps = Math.max(0, todayIndex - r.end - 1);
    r.isOpen = completedGaps <= grace;
    for (let k = r.end + 1; r.isOpen && k < todayIndex; k++) {
      if (byDay.get(k) !== 0) r.isOpen = false;
    }
  }
  return runs;
}
```

生产计算按域/level 分开；窗口左边界可能截断 run，返回 `left_censored`；历史估算与实测默认分两套证据查询，不能跨 unknown 桥接；`run.effort_min` 若包含未知日/未知时长默认 NULL，另报已观测下界；`isOpen` 不是预测。

---

## 附录 B：关键代码事实索引（实施时先读）

| 文件 | 必读点 |
| --- | --- |
| `electron/db.js` | `persist()` 1005-1032；`review_logs` 235-241；`saveReview` 2338-2409；`undoLastReview` 2465-2523；`cards.domain` 450；`extracts.kind` 489-495；`listCardDomainsForDocument` 1211；`countCardsByExtract` 2023；`bdiPull` 新增面 |
| `electron/schemaVersion.js` | 8-114（版本/迁移纪律） |
| `electron/sqliteCompat.js` | 37-50（三库 pragma） |
| `electron/learnerDb.js` | 1-7、127-147（派生库 NORMAL 的理由） |
| `electron/dictDb.js` | 1-8、60-64（独立库/快照） |
| `electron/backup.js` | 260-312（快照/zip）、752-980（恢复 staging） |
| `electron/main.js` | 839-841（cards:review）、993-1010（backupOpts）、1209-1226（ai:chat）、1637-1649（learner:logEvent）、2188-2282（启动/恢复/initDb）、2470-2478（退出三库） |
| `electron/fsrsTime.js` | 21-54（学习日/DST） |
| `electron/syncTables.js` | 全文件（主库分类） |
| `electron/preload.js` | 182-219（cardsAPI）、221-223（readingAPI）、`behaviorAPI` 新增面 |
| `electron/preload-capture.js` | 1-44（最小桥） |
| `src/lib/eventbus.ts` | 15-42（既有事件） |
| `src/lib/ai.ts` | 76-140（aiGateway.chat） |
| `src/components/ReviewView.tsx` | 194-207（review-flip/session-complete）、400-471（shown/rating/startedAt） |
| `src/lib/useSelectionActions.ts` | 1523-1525（dict_lookup 写 learning_events） |
| `src/main.tsx` / `lens.tsx` / `workbench.tsx` | StrictMode |
| `scripts/gen-ipc-contract.mjs` | preload → ipc-contract 生成 |
| `scripts/i18n-check.mjs` | 四语键校验 |

---

## 附录 C：本期实施的最小闭环

1. 能记录：`app.started`、`library.opened`、`reader.*`、`extract.*`、`card.*`、`review.*`、`dict.lookup`、`ai.invoked`、`settings.changed`、`app.window_state`。
2. 能查：`status`、`metrics`、`domainDay`、`signals`、`attentionByDomain`、`reviewContext`、`dataSufficiency`。
3. 能控：禁用、保留期、清除、导出、备份/恢复。
4. 能证明：零网络、零业务回归、复习路径 p95 增量 <1ms、增量=全量、清除后不复活。

超过这个闭环的镜像、特征表、worker、行为导入，都属于后续版本，不应阻塞本期「先积累数据」的目标。
