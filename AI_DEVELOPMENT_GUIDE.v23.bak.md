# 一站式渐进阅读学习软件 — AI 开发指导文档（v23，FSRS 数据完整性加固与学习日语义批次）

> 本文档是后续所有开发的唯一依据。AI 在任何一次迭代中，必须严格按本文锁定的技术方案和接口实现，不得擅自更换技术栈、引入云端依赖、一次性做多个功能。
> 核心原则：**纯本地软件 / 最大灵活性 / 每次只实现一个最小单元 / 需求可变**。
>
> **文档结构导读（v13）：** 全文按六个关注域组织——
> **第一部分 Architecture（架构）**：技术栈、进程与模块、数据模型、接口抽象、AI 管线、FSRS 调度契约、插件体系。
> **第二部分 Design System（设计系统）**：瑞士风基线、Token、顶栏导航、页面排版、组件规范、皮肤体系。
> **第三部分 Product Spec（产品规格）**：核心用户流程、已实现功能规格、AI 制卡与助读体系（含提示词锁定基线与质检规则）、Topic 队列。
> **第四部分 Coding Rules（编码规则）**：硬性约束、数据完整性、测试义务、提示词/配置管理、安全。
> **第五部分 Decisions（决策记录）**：关键决策日志与已接受偏差。
> **第六部分 Roadmap（路线图）**：主线批次 M1–M11（v14 重排；v17 按用户构想增补 M8 日记与 AI 洞察，接下来开发的主线）、主线状态表、历史阶段存档、可选更新池与技术债。
> 历史变更记录（v6 起）压缩至第五部分 8.3。
---

# 第一部分 Architecture（架构）

## 1. 全局原则（最高优先级）

1. **纯本地优先（Local-first）：** 核心功能（书架、阅读、摘录、制卡、FSRS 复习）在无网络、无账号下 100% 可用。所有网络功能（AI 服务、MinerU 云解析、Z-library/Anna、视频、AI 总结）都是可选 Provider，可开关、可缺失，不阻塞启动。
2. **为未来账户功能留位，现在不做：** 所有数据表带 `userId / updatedAt / syncVersion / isDeleted` 字段（软删除）；将来加登录、云同步只新增实现类，不改业务代码。
3. **最大灵活性：** 一切可变的东西走接口 + 配置 + 插件槽，不写死（见 §4 接口清单）。
4. **最小单元迭代：** 每个 Phase / Phase X.Y 是独立可运行版本；AI 只做当前指定最小单元的 Goals，Non-Goals 碰都不碰。
5. **不引入重型后端：** 不起自建服务器、不要求 Docker、不要求 GPU。
6. **需求可变：** 阅读/摘录/推送流程必须走 `ReadingWorkflowProvider` 接口。需求变更时**先更新本文档（bump 版本号）再写代码**。
7. **AI 输出必须人工确认、可降级：** 所有 AI 输出一律先进草稿/预览区，经用户确认后才写入正式表；AI Provider 缺失时对应功能降级为手动操作。提示词一律走 `PromptTemplate` 版本表；AI 生成卡片不许绕过 `CardLintEngine` 直接入 FSRS 队列。

## 2. 技术栈（v13 修订为实际落地状态）

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 31 + Vite 6 | 无框窗口，`-webkit-app-region` 管理拖拽分区（顶栏 drag，按钮区 no-drag） |
| 语言 | TypeScript（严格模式） | 渲染层 TS；主进程为 CommonJS JS（db.js / ai.js / optimizer.js / prompts.js） |
| 前端 | React 18 + Vite | 状态管理为**纯 React state + 自研 EventBus**（12 个锁定事件名）。Zustand/TanStack Query 为原计划选型，实际未引入（决策 D2，见 5.2） |
| 本地数据库 | **sql.js（WASM SQLite）**，内存库 + 全量回写持久化 | 文件在 `%APPDATA%/incremental-reading-dev/library.db`。接口与 better-sqlite3 对齐，性能瓶颈出现时迁移（决策 D1，Roadmap 技术债） |
| 间隔重复调度 | `ts-fsrs` 5.4.2（FSRS-6.0） | 权重参数可由优化器替换（§7.7）；`enable_fuzz` 锁定 false |
| FSRS 优化器 | `fsrs-rs-nodejs`（NAPI 原生绑定） | Electron 主进程直载，从 review_logs 训练 21 维权重 |
| AI 网关 | OpenAI 兼容流式（主进程原生 https，SSE 解析） | 预设：Command Code GOAT / 智谱官方 / 本地 Ollama/LM Studio / 通用自定义；Key 经 safeStorage 按服务商加密存 `ai-config.json` |
| EPUB 导入 | `@likecoin/epub-ts` + turndown + DOMPurify | 封面提取、TOC 解析 |
| Markdown/公式渲染 | react-markdown + remark-math + rehype-katex | 复习卡与 AI 面板（阅读正文已由内核接管，见 D20） |
| 阅读内核 | **foliate-js**（vendor 固定快照，MIT） | `vendor/foliate-js/`+防腐层 `src/lib/reader/`；EPUB/MOBI/AZW3/FB2/CBZ；分页/滚动/对开；CFI 锚点；经 ReaderKernel 接口隔离，业务代码禁止直接依赖 |
| 合成书 | markdown-it + katex SSR + jszip | 粘贴书/摘录确定性合成 EPUB 进统一内核（§6.2） |
| 打包 | 未配置（`npx electron .` 直跑；生产模式加载 `dist/`） | **dist 存在则优先加载**（v12.2 决策 D6），electron-builder 待配置 |

## 3. 进程与模块结构（实际）

```
electron/            主进程（CommonJS）
  main.js            入口：窗口、IPC 注册（37+ 通道）、bookasset 协议、联网搜索
  db.js              sql.js 仓储层：9 张表、迁移、黄金查询
  ai.js              AI 网关：配置/加密/流式/模型列表/reasoning_effort
  optimizer.js       FSRS 参数优化器（fsrs-rs-nodejs 封装）
  prompts.js         10 个提示词模板（版本化播种，当前 v3）
  preload.js         contextBridge：settings/window/library/workflow/cards/
                     reading/stats/issues/batches/prompts/similarity/ai/optimizer API
src/                 渲染层（React + TS）
  App.tsx            视图路由（shelf/queue/review/browse/stats/reader/extractReader）+ 顶栏文字导航
  theme.css          全部 Design Token 与组件样式（瑞士风）
  components/        Bookshelf / QueueView / ReviewView（连续刷题）/ CardBrowser /
                     Reader / SettingsPanel / dashboard（统计）/ reader（ReaderEngine+TocSidebar）
  lib/reader/        阅读内核防腐层（v20 D20）：kernel.ts（业务唯一依赖）/ service.ts（组合根）/
                     foliate/**（全仓库唯一 foliate-js 豁免目录：adapter/selection/appearance）/ testing/fakeKernel
  vendor/foliate-js/ foliate-js 冻结快照（MANIFEST.json 记 upstream commit/本地补丁/升级规程）
  lib/               fsrs（调度封装）/ cards（CardLint+cloze+AI 制卡）/ ai（网关客户端）/
                     readingWorkflow（SM19 Provider）/ library / settings / eventbus /
                     epub / stats / udc
  skins/             皮肤注册表（默认 + xiadown）
tests/fsrs/          FSRS 黄金参考回归套件（六件套，见 §4.4.6 / §7.3）
```

启动加载顺序（决策 D6）：`dist/index.html` 存在则 `loadFile` 直用；不存在（纯开发）才尝试 vite dev server。

## 4. 数据模型与接口抽象

### 4.1 数据表（10 张）

核心业务表带 `userId/updatedAt/syncVersion/isDeleted` 四件套，删除一律软删除：

- **users / library_items / documents / assets / extracts / cards / card_issues / ai_gen_batches / review_logs / fsrs_configs**（另有 review_skips）
- `cards.fsrs_json`：**全字段持久化** `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}`（§4.4.1 契约）
- `cards.fsrs_config_id`（v23）：当前 FSRS 状态**最近一次因调度写入**所用参数配置（滚动语义，非出生标签；写入规则见 §4.4.9）
- `cards.occlusion_json`：图片挖空 `{rects:[{x,y,w,h,ord}], assetPath}`（区域为相对图片百分比坐标；图片资产入 assets 表 kind=image-occlusion，v15 补齐生成链路）
- `cards.context_ref_json`：`{documentId, extractId?, anchorText?, anchorRatio?}`——跳转原文锚点
- （v16 移除 `cards.reverse_json`：翻转问答卡改为创建两张独立问答卡，见 D18；已建过该列的旧库残留列无碍，新库不再建列）
- `extracts.context_ref_json`：同上（v12.3 新增，含旧库迁移）
- `cards.leech_json`：`{isLeech, suspended, suspendedAt, resolution}`
- `review_logs.fsrs_before_json`（v22）：该次评分**前**的 FSRS 全字段快照（可空——旧日志与未传快照的调用为 NULL，不可撤销）。撤销评分的数据基础。
- `review_logs`（v23 增列）：`fsrs_after_json`（评分后全字段快照，Undo 一致性校验与审计用）、`leech_before_json`（评分前 leech_json 快照——撤销时**精确恢复**而非推断，F10）、`fsrs_config_id`（本次评分所用参数配置）、`fsrs_before_config_id`（评分前状态归属配置，撤销恢复用）、`review_seq`（全局插入序，唯一索引；排序不变量见 §4.4.9）
- `fsrs_configs`（v23，D22）：**不可变调度配置快照**——`{id, algorithm('FSRS'), algorithm_version(6，算法代际非 npm 包版本), weights_json(21 维), scheduler_options_json(完整调度参数), config_fingerprint(UNIQUE), source(default|optimizer|manual), created_at}`；只增不改，活跃项由 `settings.app.fsrsConfigId` 指针指定（§4.4.10）
- `prompt_templates`：版本化提示词（当前 v3，旧版留痕）

### 4.2 必须保留的接口/抽象（19 项，任何 Phase 不得绕过）

1. `EventBus`：唯一事实通道。锁定事件：`stats/updated, library/changed, todo/changed, pomodoro/tick, pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed, cards/changed, ai/batchDone, leech/detected`
2. `CommandRegistry`：动作注册 `{id,title,when,keybinding}`（✅ M4 落地：`src/lib/commands.ts` + `src/lib/useCommands.ts`，§9.1 M4）
3. `SettingsStore`：三层 `app / theme / plugin.<id>`，settings.json 持久化
4. `PluginHost`：`load/unload/enable/disable + contributes`（规范见 §2.5，未实现）
5. `ParserProvider`：`submit → poll → {markdown, blocks[]}`（MinerU，未实现）
6. `EpubProvider`：`parseEpub → {metadata, toc, chaptersHtml}`（✅ epub.ts）
7. `AuthSessionProvider`：`startLogin/finishLogin/importBrowserCookies/getCookies`（未实现）
8. `LibrarySourceProvider`：Zlib/Anna/WebClipper/LocalFile/Epub 统一返回（Epub ✅，其余未实现）
9. `ReadingWorkflowProvider`：`nextTopic/postpone/setPriority/serializeState`（✅ sm19-default）
10. `VideoProvider`：Bilibili/YouTube（未实现）
11. `AIGateway`：`AIProvider{baseUrl,model,apiKey} + PromptTemplate registry + stream/cancel`（✅ ai.js + ai.ts）
12. `AudioProvider`：Moodist 内置 + 外链（未实现）
13. `StatusBarWidgetHost`：left/center/right 槽位（未实现；v12.1 顶栏改为文字导航）
14. `AccountSyncProvider`：现阶段 `LocalNoopAccount`
15. `UiAdapter`：外部 UI 代码 tokens 化适配
16. UI Slots：commandPalette / sidebarView / statusBarWidget / editorSlash / blockMenu / themeCSS
17. `CardGeneratorProvider`：`generateCards(sourceText, context, mode) → CardDraft[]`（✅ cards.ts）
18. `CardLintEngine`：`lint(cardDraft) → CardIssue[]`，纯本地，AI 卡与手动卡一视同仁（✅ L1-L14）
19. `SimilaritySearchProvider`：`findSimilar(cardText, k)`，本地 n-gram + 编辑距离（✅ 制卡查重警告）

### 4.3 AI 制卡执行架构

管线编排（明确**不采用内置 Agent**）：① 模式路由（detectMode 纯本地）→ ② 取提示词（PromptTemplate v3）→ ③ 上下文打包（材料+来源+已有卡+用户画像+联网背景）→ ④ LLM 流式生成（主进程，Key 不进渲染层，reasoning_content 经 thinking 信号转发）→ ⑤ JSON 解析容错 → ⑥ CardLint + 相似查重 → ⑦ 用户确认入库（AIGenBatch 留痕）。①②③⑤⑥ 渲染层毫秒级；④ 主进程；瓶颈在服务端（GLM 推理模型首字前思考 0.5-1 分钟，UI 以思考字数+秒数如实呈现）。

联网背景检索：blockReasons 非空时手动触发，Bing→DuckDuckGo→百度 回退，结果仅作理解上下文（禁止编造来源）。

### 4.4 FSRS 调度契约（硬性，v11 定；v20/v23 加固）

> **最高不变量（v23）**：同一份用户复习事实，不允许存在两套不同解释。调度事实=`cards.fsrs_json`；评分事实=`review_logs`（含 before/after 快照、config 归属、review_seq）；参数事实=`fsrs_configs` 不可变快照；时间事实=`reviewed_at`+`review_seq`；撤销事实=快照恢复。统计、优化器、审计、Undo 一律从这些事实推导，禁止各自再造解释。

1. **全量持久化**：`fsrs_json` 含 `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}` 全字段（v20 补 `learningSteps`＝ts-fsrs 学习步进索引，F7 修复——缺失会使 learning 档第 2 步的 Good 永不毕业、在 10 分钟档死循环）且下轮全量回填；禁止部分字段序列化 + createEmptyCard 兜底（兜底仅限首次创建与历史缺字段基线回填）。`elapsed_days/scheduled_days` 无需持久化（v20 源码核对结论）：前者由 last_review 与复习时刻现场重算（ts-fsrs `AbstractScheduler.init`），后者调度器只写不读，均不影响调度。
2. **fuzz 锁定 false**：预览值即算法真实值。开 fuzz 须先改本文档。注记（v23）：**false 是产品策略（预览=落库+确定性测试+审计重放），不是 FSRS 算法正确性要求**。
3. **预览与调度同源**：preview() 一次算四档完整结果（含落库状态），评分复用；「所见=所存」是验收硬条件。preview/next 均支持可选 `now` 参数（v20，默认取真实时间，渲染层行为不变）——这是 M3 时间轴模拟的时间注入机制。**过期 preview 判废（v23）**：previews 携带源卡 fsrs 引用，评分提交时源不符则现场重算，禁止复用过期预览。
4. **复习后附加动作不得改 fsrs_json**：leech 标记走字段级 `leech_json` 更新（cards:updateLeech），禁止整卡快照回写。改卡内容先取库内最新状态合并。**撤销评分（v22）是「复习回退」而非附加动作**：将 fsrs_json 恢复为该次评分的 `fsrs_before_json` 快照（全字段含 learningSteps）并移除该条复习日志——不触碰预览=落库、fuzz=false 等调度语义，属于 Anki 式标准撤销。v23 起撤销不变量升级为 §4.4.9。
5. **到期队列**：due 升序、同 due priority 降序；复习视图 30s 轮询。
6. **回归测试义务**：调度相关改动合入前 `tests/fsrs/` 六件套全绿（L0 golden / L1 adapter / L1 补强 / L2 db / L4 audit / L5 simulate 时间轴模拟（v23 增 S6 时间语义/S7 参数环境），§7.3）+ undo 套件 + persist 边界套件（v23）。
7. **参数优化器**：`fsrs-rs-nodejs` 从 review_logs 训练 21 维权重；无效样本过滤（单次复习卡/全同日卡/无跨天间隔前缀，防 Rust panic；v20/F8 补：`evaluate` 评估子集须 ≥2 条复习且末条 delta_t>0——学习/重学步同日恢复收尾的样本 evaluate 拒绝，训练不受影响，评估取可评估子集、无可用子集时指标为 null）；训练/应用/重置经 `fsrs_configs` 不可变快照 + `settings.app.fsrsConfigId` 指针（§4.4.10），delta_t 由 canonical 函数构建（§4.4.8）；手动触发；失败返回 `{ok:false}` 不阻塞调度。
8. **时间语义（v23，三概念严格分离）**：① **调度 elapsed_days**＝ts-fsrs 内部 UTC 日历日差（库内部实现，不可注入日切点）；② **优化器 delta_t**＝`calculateFsrsDeltaT(prev, cur)`（electron/fsrsTime.js 唯一出口，独立实现 UTC 日历日差，**不 import ts-fsrs**），是「锁定版本 ts-fsrs 5.4.2 时间语义的复刻，非 FSRS 永久规范」——依赖升级致 L6-A 红灯＝时间语义变更触发重新审计（预期行为非缺陷）；③ **产品学习日**＝`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0；用户钦定凌晨切点习惯，D23），**仅统计口径**（今日/热力/日聚合/月内分组），禁止进入 FSRS 调度与训练。①②同语义是本项目工程不变量（非 FSRS 规范要求），oracle=ts-fsrs `repeat()` 返回的 ReviewLog.elapsed_days 行为级对照（L6-A）。学习日（本地切点）与 FSRS 语义在本地凌晨时段的统计口径差＝产品语义选择（§8.2）。
9. **原子提交、持久化边界与 Undo 不变量（v23）**：saveReview/undoLastReview 必须 BEGIN/COMMIT 事务，COMMIT 后才 persist；**review 成功边界 = SQLite COMMIT + persist 成功 + IPC 成功**（三者齐才算成功）；措辞精度：这是**崩溃一致性**而非跨内存库与文件系统的 ACID——「review 在 SQLite 内原子提交；持久化采用原子文件替换；二者之间若进程崩溃，回退到上一次完整持久化版本，不允许产生部分/不一致的持久化数据库」。persist＝同目录 tmp + fsyncSync + renameSync 原子替换（Windows REPLACE_EXISTING），失败 throw→IPC reject→UI 错误横幅＋停留当前卡＋评分/跳过/删除封锁＋「重试保存」（`persistNow`＝**纯持久化重试，绝不重新执行任何业务 mutation**）；禁止静默降级、禁止自动 rollback 已 COMMIT 事务；全库快照自愈：任一后续成功 persist 补齐失败窗口期全部内存变更（窗口内崩溃＝丢窗口变更但一致）；启动时残留 `library.db.tmp` 一律删除（tmp 永远不是事实源）。**UndoableReview 不变量**＝review_seq 最新插入序 ∧ 有 before+after 快照 ∧ 卡当前 fsrs 与 `fsrs_after_json` **8 字段全等**（state/due/lapses/stability/difficulty/reps/lastReview/learningSteps，引用 §4.4.1）∧ 无 after 的旧日志（v22 及以前）不可撤销；leech 回退＝恢复 `leech_before_json` 确切前置状态＋关闭本次 LEECH issue，禁止以「当前 suspended」推断；config 恢复查 `fsrs_before_config_id`；**排序不变量＝review_seq**（表内唯一、按插入序单调递增、撤销删除后序号允许复用——seq 是排序非身份，身份=id；禁止按 id/reviewed_at 排序）。**config_id 写入规则**：createCard✅ / 评分✅ / 重置 FSRS 状态✅ / 编辑内容·挂起·恢复·改优先级❌ / resolveLeech 仅 reset 路径✅。
10. **参数环境（v23，D22）**：`fsrs_configs`＝不可变调度配置快照（结构见 §4.1）——**所有影响 FSRS 调度结果的 option 必须入 scheduler_options_json**（新增 option 漏快照＝契约违规）；禁止 UPDATE（db.js 不提供更新 API）；同一配置（config_fingerprint 唯一）永远只有一个 config_id；切换＝移动 `settings.app.fsrsConfigId` 指针（指针非配置本体，事实源=fsrs_configs）；reset＝指针回 cfg-default（普通不可变行，业务逻辑禁止特判，seed/migration 除外）；apply 相同配置按指纹去重重指；`cards.fsrs_config_id`＝当前状态最近一次因调度写入所用配置（滚动语义）；**应用新参数只影响未来调度，不回算任何存量卡片的 S/D/due/fsrs_config_id**；audit 按每条日志的 fsrs_config_id 分段构引擎重放（NULL→cfg-default）；`settings.app.fsrsWeights` 字段废除（存量迁移播种为 config 行后删除）；requestRetention 单一命名（对齐 ts-fsrs）；maximumInterval=36500 为产品选择非算法要求。
11. **模块边界（v23）**：运行时唯一直接 import ts-fsrs 的文件＝`src/lib/fsrs.ts`；优化器 delta_t 唯一出口＝`electron/fsrsTime.js`（独立实现，无库依赖）；业务组件禁止 import ts-fsrs、禁止自算调度或日期差。

### 4.5 插件/主题体系（规范，未实现）

- 插件 = 文件夹 `plugins/<id>/`（plugin.json + main.js + styles.css + data.json）；`versions.json` 版本回落。
- 主题是特殊插件（type:theme）；`/* @settings */` YAML 声明可调项。
- 皮肤体系：内置 `src/skins/<id>/`；每套皮肤只改表现层；亮暗对比 ≥4.5:1；先规范后代码。

---

# 第二部分 Design System（设计系统）

## 5.1 瑞士风基线

唯一视觉规范：`docs/swiss-international-style.md`（Token、字号阶梯、灰阶、单一焦点色、直角无阴影、Lucide 图标、禁止清单、五项必查）。全局主 accent 锁定 IKB 蓝 `#002FA7`（深色提亮 `#5B7FE8`），用户可在设置中自定义（写 `--accent` 变量）。所有色值/字号/间距走 `src/theme.css` Token，业务组件禁止硬编码。

设计哲学七条：单一焦点色 / 极致字号对比（越大越细）/ 无衬线 / 直角纯色 / 8px 网格 / hairline 分割 / 克制。

## 5.2 顶栏与导航（v12.2 定，方案 A）

- 顶栏左侧**文字导航**：`书架 / 队列 / 复习 / 卡片 / 数据`，当前项 accent 色 + 2px 底线；常驻可见，点击切换视图。
- **无品牌字块**（「渐进阅读 INCREMENTAL READING」已删）；切换页面后顶栏以浅色小字显示当前位置（`topbar-title`，hairline 左分隔），不与导航高亮重复表达。
- 右侧仅设置齿轮 + 窗控三键。导航按钮 `no-drag` 可点；顶栏空白与标题区保持 `drag` 可拖窗口。
- **页内禁止重复导航文字**（如复习页不再出现「REVIEW 复习」大标题）；页内只保留右上角/左上角计数（`review-count`）。

## 5.3 页面排版规则（网格系统 + 极简）

- 内容版心 720px（长文单列测量宽），8px 基线，spacing Token `{4,8,12,16,24,32,48,64}`。
- 复习页：kicker/标题行已删；卡面正面/背面统一 **26px / 1.5 行高**（markdown 子元素 `font-size:inherit` 防回落），hairline 分隔问题与答案；左对齐非对称留白。
- 评分模块：4 等分 grid，min-height 56px；**四按钮样式统一**（灰底 + 左缘 4px 语义色条：Again 红 / Hard 黄 / Good 蓝 / Easy 绿），无填充差异；hover 统一 grey-2；键盘焦点环 2px accent。
- 设置页：左侧锚点导航 + 内容列；说明性文字只保留「操作必需」（Key 获取链接、数据门槛、当前状态），删除教程式长文。
- 文字规则（better-typography）：正文 1.5-1.7 行高、`text-wrap` 按角色、数字 tabular-nums、Meta ≥12px、正文 ≥14px。

## 5.4 组件规范

- **评分按钮**：语义只以色条表达（见上），数字用 mono + tabular-nums。
- **EditableText（内联编辑）**：React 不描述子节点的「裸壳」div（命令式写入 innerText），杜绝 contentEditable 与 React 共管 DOM 导致的 removeChild 崩溃与内容叠加；点击出光标、失焦落库、无任何框线；**正面点击=翻面，翻面后问题与答案区才可编辑**。
- **cloze 编辑回写**：问题区编辑的是显示文本（当前挖空为 `[…]`），落库时 `[…]` 自动还原为原挖空语法并同步 noteText；其他挖空若被改动则降级为普通文字（可接受）。
- 跳转链接：`跳转原文 →`（accent 色 Meta 档文字按钮，hover 下划线），出现于复习卡 meta 行、队列摘录条目与卡片浏览详情（仅带锚点数据时）。**跳转是「现场查看」语义（v19）**：跳转会话中阅读器不写阅读进度与阅读字数统计（App 对 jumpAnchor 会话不传 onProgress），切出后记录的位置仍是上次真实阅读位置，不会被跳转位置覆盖。

## 5.5 皮肤体系

默认皮肤 = 瑞士风（`skinId:"none"` 即基线本体）；已注册 xiadown 玻璃拟态为第二皮肤（表现层覆盖，不影响业务逻辑）。新皮肤按 §4.5 规范另立，先规范后代码。

---

# 第三部分 Product Spec（产品规格）

## 6.1 核心用户流程

书架（粘贴/EPUB 成书）→ 阅读器（选中文字 → 手动制卡 / AI 制卡 / AI 解释 / 摘录；制卡与摘录**记录选区锚点**）→ 学习队列（摘录 Topic，推迟/打开/跳原文）→ **连续刷题复习**（自动出下一张、评分四按钮、跳过/标记暂停/删除、跳转原文并可返回恢复现场、双面内联编辑）→ 卡片浏览（Anki 式全量表格 + 行维护 + Leech 六步处理）。设置：主题/皮肤/强调色/AI 服务（4 预设+思考强度）/FSRS 优化/统计仪表盘/备份与恢复/快捷键。

## 6.2 已实现功能规格（v12.4 状态）

- **书架**：粘贴成书、EPUB 导入（封面/TOC）、上次阅读位置、删除（软删）。
- **阅读器（v20 阅读内核，D20「一切皆书」）**：文件书（EPUB/MOBI/AZW3/FB2/CBZ）由 vendor foliate-js 渲染；粘贴书导入时**确定性合成 EPUB**（markdown-it→HTML、一级标题章节化、KaTeX 服务端渲染自包含内嵌；存量粘贴书首开惰性合成）；摘录打开时合成为单章 EPUB 进同一内核（无 markdown 阅读边界；摘录不落进度/统计）。react-markdown 退出阅读路径（仅 AI 面板回答）。能力：**目录侧栏**（book.toc 层级树+当前章高亮+点击跳转）、**阅读模式**（滚动/分页/双页对开）与**翻页交互**（‹›按钮、←→/PageUp/PageDown/空格键、分页模式左右点击热区；分页滚轮=翻页，滚动模式章尾续滚自动进下一章/章首回上一章——vendor 补丁 paginator wheelTurn，跨章节由 #turnPage 处理）、**外观**（纸白/羊皮/暗夜/自定义背景文字色、字号、字体；快捷控件与设置页「阅读」区块同读写 `settings.app.readerSettings`）、**链接**（内链内核 CFI 精确跳转；外链 adapter 拦截→`shell:openExternal` 仅 http/https）、**选区服务**（引擎 iframe 选区→既有制卡/AI 解释/摘录/图片挖空菜单全链路不变）、**进度**（progressJson 扩展 `{cfi,fraction,ratio,lastText,readerEngineVersion}`，恢复优先 CFI）。
  - **锚点体系（可降级恢复）**：制卡/摘录 contextRef.locator = cfi（结构级，绑定特定 EPUB 结构非永久 ID）+ chapterIndex（章节兜底）+ anchorText（文本终极兜底）+ readerEngineVersion（回归归因）。恢复链：CFI→章节+文本→全文搜索→人工提示。存量纯文本锚卡经 search 定位。
  - **主进程导航防护**：`will-navigate` 仅放行同页刷新（复习页「刷新」），其余页面级导航一律拦截；`setWindowOpenHandler` 拒绝开窗、http(s) 交系统浏览器；外链 IPC `shell:openExternal` 仅允许 http/https。
  - 选中操作菜单、AI 解释侧栏、AI 制卡面板、图片挖空、递进补卡、材料类型路由（§6.3）在内核视图下行为不变。
  - **递进补卡（v16）**：AI 制卡结果的知识点摘要含「（后续可补：…）」注记时（v4 候选 G8 产出，`parseFollowUps` 解析），逐项渲染「询问 AI 相关内容」「直接制卡」；询问 AI 的解释追加在面板最下方且解释末尾也带「直接制卡」；直接制卡以原选文为材料 +「本次制卡重点」指令 + 已有卡清单（防重复）生成 1-3 张补充卡，**追加到卡片清单末尾**（带「补充」徽标），已有卡始终在上；所有卡沿用同一次选区锚点（跳转原文同一位置）。补充制卡指令经请求装配注入（context.focus），提示词模板不变。
- **四种核心卡形式（v16 修订，M1.1）**：挖空（cloze 契约不变）/ 问答（qa）/ **翻转问答（制卡手段，非卡类型：创建时拆为两张互为翻转的独立 qa 卡）**/ **图片挖空（imageOcclusion，GLM 多模态识别遮挡区域生成）**；既有 application/mnemonic/seq/formula 类型保留。
  - 翻转问答（D18）：**不存在复习期形态变化的卡片类型**——手动制卡「翻转问答」页签与 AI 面板「转翻转卡」按钮都产出/拆分出两张互为翻转的独立问答卡，各自拥有独立 FSRS 调度状态；B 面留空时自动正反互换。
  - 图片挖空：阅读器选区菜单「图片挖空」→ 选本地图片 → 落盘 assets/ + 入 assets 表 → dataURL 交 GLM 多模态（card-occlusion 模板）→ 返回 regions（百分比坐标，渲染端钳制 0-100）→ 确认面板图上叠加预览、逐区域接受（每区域一张卡，共享同一 occlusionJson，cardOrd=区域序号）；不做手动遮挡编辑器（D16）。**复习端展示规范（v16-c，用户钦定）**：正面 = 原始图片 + 主题色遮挡块（考察区域 accent 色、其余区域 ink 色）；答案面 = 原始图片（无任何遮挡覆盖）+ 答案文本。测试台结果面板同规范渲染（图片+遮挡块+显示答案切换）。
- **学习队列**：due 摘录列表（priority 升序）、推迟（×1.6 占位）、打开摘录阅读（嵌套摘录）、跳转原文（带锚点条目）。
- **连续复习**：进入即开始；每张卡实时取 due 队首（FSRS due 升序）；评分四按钮（预览=落库，§7.3）；自动下一张；本轮计数；跳过（due+10min，不写 log）；标记并暂停；**删除**（确认后软删，自动下一张）；**跳转原文**（保存现场→阅读器锚点定位+高亮→返回恢复该卡与翻面状态）；内联编辑（翻面后问题+答案皆可，cloze 语法自动回填）；leech 自动检测（lapses≥8 暂停+通知）；**撤销评分（v22）**：撤销最近一次可撤销的评分（快捷键 Z / 「撤销评分（X）」按钮，收尾页同样可用）——恢复该卡评分前 FSRS 快照、物理移除该条复习日志（训练输入与统计自动回到评分前）、若本次评分触发 leech 挂起则一并回退（解除挂起+关闭本次产生的 LEECH issue）；撤销后该卡回到当前位并展开背面，可立即重新评分；撤销不改变调度语义（§4.4.4）。
- **卡片浏览（v19 Anki 式改造）**：全量卡片表格（题面/类型/状态/到期/复习次数/遗忘次数/优先级/来源书名，listAllCards 补 docTitle JOIN）+ 搜索（题面/答案/前缀/来源/领域/标签）+ 类型/状态筛选（共享直角 Dropdown，类型项按库内实有动态生成）+ 排序（到期/创建/优先级/遗忘）+ 页签（全部卡片/到期卡片/记忆难点，到期与难点口径与 db.js listDueCards/listLeechCards 一致）。**行详情** = 卡面预览与内联编辑（复用复习 CardFace/EditableText，cloze 自动回填挖空语法）+ 元数据（含 FSRS 稳定度/难度）+ 质检问题（CardIssue）查看 + 操作：暂停/恢复调度、推迟 1/7 天、重置为新卡、删除（确认后软删）、跳转原文（returnTo=browse）、Leech 卡「六步处理」入口。评分调度仍在复习页，此处不写复习日志。
- **记忆难点**：Leech 六步向导（AI 诊断/补卡指引/换问法/删除降优先/推迟/助记 + 重置为新卡/恢复）。
- **统计数据**：仪表盘（学习热力/今日完成度/领域分布/评分构成等），UDC 领域分类，组件拖拽排列。（用户主导开发）
- **FSRS 优化器**：设置 → FSRS 优化；手动训练/应用/恢复默认（§7.7）。
- **启动**：单窗口防重入；dist 优先加载。

## 6.3 AI 辅助制卡与助读体系（v6 锁定，主体实现）

### 6.3.1 制卡原则知识库（单一事实来源）

制卡原则只存在于两处：`PromptTemplate` 的 card-* 族提示词（给 LLM）与 `CardLintEngine` 规则表（本地质检）。代码、组件、文档中不许散落第二份原则文本。scope 锁定：`card-generation / card-formula / card-seq / card-enum / card-mnemonic / card-contrast / card-wording / card-basic / card-occlusion（v15 新增，图片挖空）/ reader-explain / leech-rescue`。

### 6.3.2 AI 制卡主流程

入口：阅读器选中文本 → `AI 制卡`（也支持 AI 解释侧栏「就此制卡」）。七步管线见 §4.3。确认入库：逐张「接受/编辑/拒绝」或整批拒绝；落库带 contextRef（含锚点）/sourceRef/dateStamp/priority/knowledgePointId；超量制卡默认每知识点 2-4 张、单批上限 10；迭代制卡（补充制卡不重复已有 knowledgePoint）；手动制卡保留为降级路径，同样过 lint。

### 6.3.3 制卡提示词锁定基线（PromptTemplate 当前版本 v3）

基线组织为「理解检查 → 硬性规则 R1-R17 → 输出格式 → 禁止事项」，全文以 `electron/prompts.js` 的 v3 播种内容为唯一准绳（历史版本留痕于 prompt_templates 表）。核心规则摘要（完整文本见 prompts.js）：

- R1 不理解不学（blockReasons + 前置卡）；R2 最小信息（答案 ≤15 字）；R3 单义性；R4 禁是否题；R5 避免集合/枚举；R6 上下文前缀（前缀铁律：禁止泄漏答案）；R7 措辞最短；R8 双向多角度；R9 例子个性化；R10 联想已有卡；R11 来源与时间戳；R12 助记克制；**R13 挖空规范（v3 加 hint 禁令：`{{c1::答案}}` 禁用第三段 hint，禁止答案拆两半——正面曾泄漏半个答案）**；R14 优先级建议（基础 ≥70 / 一般 40-60 / 边缘 ≤30）；R15 应用/启明卡；R16 实体全名；R17 领域标注（UDC 受控清单，domain 字段 ≤2 个）。
- 输出严格 JSON：`{knowledgePoints, blockReasons, cards[{cardType, knowledgePointId, contextPrefix, front, back, cloze, example, mnemonic, sourceRef, dateStamp, prioritySuggestion, ruleNotes, warnings, domain}]}`。
- 修改提示词 = 播种新版本记录，不覆盖旧版（当前 v3：R13 hint 禁令 + R17 领域标注）。

### 6.3.4 CardLint 静态质检规则（对 AI 与手动卡一视同仁）

| ruleId | 检查内容 | severity |
|---|---|---|
| L1 | back 信息过载（>60 字 / >3 单元） | warn |
| L2 | 是否题 | warn |
| L3 | 集合型问法 | warn |
| L4 | 有序枚举 >5 项未拆解 | warn |
| L5 | 缺 contextPrefix | info |
| L6 | 缺 sourceRef | info |
| L7 | AI 标记的单义性问题 | warn |
| L8 | 孤儿卡（知识点下仅 1 张） | info |
| L9 | 单卡挖空 >2 处 | warn |
| L10 | front 过长（>80 字） | warn |
| L11 | imageOcclusion 卡缺 Asset | error |
| L12 | 易变内容缺 dateStamp | info |
| L13 | 前缀泄题 | warn |
| L14 | 实体全名疑似缩略 | warn |

severity 语义：error 阻止入库；warn 可选择接受；info 仅提示。所有 lint 结果写 CardIssue，卡片详情可查「违反了哪些原则」。另有 S1（相似卡警告）。

### 6.3.5 AI 阅读助手

选中文本 → `AI 解释` 侧栏流式回答（先直答再机制再联系上下文；追问：通俗解释/严格定义/举个例子/为什么）。回答下方动作：就此制卡（进 AI 制卡流程）。回答运行期显示思考/等待状态（思考字数 + 已等待秒数）。

（v12.2 起新增：解释侧栏与跳转原文、删除按钮等复习链路增强，见 6.2。原 §8.5「插入原文回写为 ai-supplement 块」仍为规划项，见 Roadmap。）

### 6.3.6 Leech 处理

lapses≥8 自动标记+暂停+CardIssue+通知；复习中「标记并暂停」一键；六步向导（诊断 AI / 补前置卡 / 重设问法 / 删除或降优先 / 推迟 / 助记）+「重置为新卡 / 仅恢复」；Leech 面板（卡片浏览页）。处理决议写 `leech.resolution`。

### 6.3.7 干扰检测

制卡时相似检索（n-gram），高分命中写 S1 警告提示可能干扰；对比卡生成走 card-contrast 模板（向导内指引）。

### 6.3.8 复习体验元规则

补进度不展示惩罚性大数字；每日上限可配（未实现，规划）；全局混编选项（规划）；Again 按钮措辞不带惩罚；卡片可标「不再关心」（规划）。

### 6.3.9 设计验收清单（问题-功能映射，节选核心）

20 条原则与补充文献的每个问题须有对应功能。关键项：不理解不学→blockReasons；最小信息→L1/R2；完形填空→cloze 语法；避免集合→card-enum；对抗干扰→相似检索+前缀；优化措辞→card-wording；提供来源→sourceRef；时间标记→dateStamp；优先级→priority；Leech→六步向导；锚点溯源→跳转原文（v12.2 起）。全表见历史版本 v12。

### 6.3.10 四卡形式 × 材料类型路由（v15 已实现）与提示词测试台

- **四种核心制卡/复习形式**：挖空 / 问答 / 翻转问答（reverse 双向卡，v15 新增）/ 图片挖空（v15 生成链路补齐）；既有 application/mnemonic/seq/formula 类型保留。遮挡卡 `occlusion_json`（rects+assetPath）结构与渲染沿用 Phase 16 预留，生成链路走 GLM 多模态（D16），不做手动遮挡编辑器。
- **材料类型路由（v15 已实现，本地规则先行）**：制卡入口先经 `detectMaterialType`（cards.ts，本地正则）识别材料类型，按下方映射表路由到 PromptTemplate 分支与默认卡形式组合；AI 面板展示识别结果并允许手动覆盖（下拉切换后可重跑）。
- **类型→原则→提示词→形式映射表（v15 默认版，待用户确认后锁定）**：

  | 材料类型 | 本地识别 | 路由 PromptTemplate | 默认卡形式 |
  |---|---|---|---|
  | concept 概念论述（默认兜底） | 其余全部 | card-generation | 问答（确认区可「转翻转卡」= 拆两张独立卡） |
  | formula 公式推导 | LaTeX/等式/运算符 | card-formula | 问答 |
  | sequence 流程背诵 | 步骤/流程/时间线/首先-然后-最后 | card-seq | 问答（seq 续写） |
  | enumeration 枚举清单 | 列出/有哪些/顿号列举 | card-enum | 挖空 |
  | image 图片材料 | 制卡入口选图 | card-occlusion | 图片挖空 |
  | literature 文学/诗歌背诵（v16） | 本地识别：词牌/诗体标识、《篇名》标题、行密度/短句密度（verseSignals；v16-c 扩展近体诗定长行与现代自由诗、标记兜底放宽长行） | card-literature（v1 暂由 card-seq 模板承接；v4 专用模板经实测后播种 v2） | 问答（seq 续写逐句全覆盖 + 措辞/观察卡；contextPrefix=「文体·篇名:」类别标识） |

  材料类型识别是**确定性本地函数**（同一文本必然同一结果，与提示词无关）；识别不确定时由 AI 面板的类型选单手动覆盖，**选单选择按书记忆**（v16：`settings.app.materialTypes` 以 itemId/documentId 为键，同书再次制卡自动沿用用户上次选择，首次制卡即生效）。

  （词汇/单词类材料 → 建议 M7 词典批次；代码/编程类 → 候选新类型待用户表态；详见 `docs/M1-prompt-coverage-report.md` §三-C、§四）
- **提示词测试台（独立最小软件，v15 已建成；v16 候选补丁就绪）与调优闭环（用户钦定）**：`prompt-lab/`（独立 Electron 应用，复用主软件 `ai.js` 网关与 `prompts.js` 基线、esbuild 打包 `cards.ts` 的路由/JSON 容错/Lint 纯函数为 vendor bundle；**必须经 `npx electron prompt-lab` 或根目录 `启动提示词测试台.bat` 启动，浏览器直开 index.html 无本机接口**）。闭环：**AI 按用户要求修改测试台内的提示词/流程 → 用户在测试台手动实测（文字/图片材料）→ 用户反馈测试结果 → 决定是否并回主软件**；并回时提示词播种新版本（旧版留痕）。测试台配置与提示词编辑存独立 userData（`%APPDATA%/prompt-lab/`），不写回主软件；主软件内不做提示词调优试验。
- **v4 候选补丁（v16，待用户实测）**：`prompt-lab/prompts-draft.js` 按覆盖核对报告实现 G1-G9（R3 精准性/一致性双维、输出前自检段、R8 五视角、公式地标双卡强制+边界三问、R18 数字克制、R19 观点归属、等价答案宽容与部分枚举合格线、首轮克制多轮递进、退出红线）+ **card-literature 文学/诗歌背诵候选**（续写骨架**逐句全覆盖**/开头优先/措辞选择卡/原文改进卡/高层次观察卡/放过标点/名言署名，研究依据见报告 §四、§4.4）；G10 挖空 ≤2 处维持（用户拍板）、G11 词汇归 M7（用户拍板）、G12 进可选池。实测确认改善后才并回主软件播种 v4。**v16-b（雨霖铃实测反馈修复）**：detectMaterialType 加诗词启发式 verseSignals（原仅三类正则致诗词落概念兜底）；extractJson 括号平衡扫描（模型 JSON 后附说明文字曾致「Unexpected non-whitespace character」解析失败）；文学候选 L1 整篇背诵逐句全覆盖（一句一卡成链，优先于首轮克制）——真实验证：自动路由 card-literature、9 张续写卡覆盖全篇+6 张理解卡。
- **提示词覆盖核对（v15 已完成，只报告不改）**：逐条核对结论与 14 项缺口（G1-G14）、CardLint 缺口（L-A/L-B/L-C）、处置建议见 `docs/M1-prompt-coverage-report.md`；**任何一项的增改须经用户确认后走测试台验证 → 播种新版本**。

## 6.4 Topic 队列优先级与推迟

摘录默认 priority 50；推迟固定 ×1.6 封顶 180 天（占位）；负载感知推迟（priority 三档基础间隔 + dueLoad 分散 + postponeCount 抖动 + 上限 180 天）为设计承诺，已降级可选更新池（§9.4），替换时点未排期。

---

# 第四部分 Coding Rules（编码规则）

## 7.1 硬性约束（AI 每次迭代必须遵守）

1. 开工只做用户指定的最小单元，其他代码一行不写；开工前复述 Goals/Non-Goals。
2. 不新增 Account 真实现、不接付费/盗版代理、不把 Cookie/key 打日志或上传。
3. 站点域名、API baseUrl、镜像列表、提示词内容必须放配置或 PromptTemplate 表，不许写死。
4. 每次完工保证 `启动 → 该单元主流程 → 重启不丢数据` 可演示。
5. 遇到文档未覆盖的选择先停下问用户；需求变更先改本文档 bump 版本再编码。
6. 视觉以瑞士风默认皮肤为基线；色值/字号/间距一律走 Token，禁止硬编码魔法值；外部粘贴 UI 逐字还原优先。
7. **核心算法回归测试义务（v11）**：涉及 FSRS 调度、CardLint、cloze 解析、Markdown 管线的改动必须附可重复运行的自动化测试；FSRS 调度改动跑 `tests/fsrs/` 全绿；**文档数据模型声明的字段不允许实现时静默裁剪**。
8. **sql.js 并发纪律（v12 实践）**：sql.js 是内存库 + 全量回写，应用运行期间外部脚本改 library.db 会被应用的 persist() 覆盖——外部数据操作必须先关闭应用。
9. **阅读内核防腐层纪律（v20 D20）**：业务代码禁止直接 import foliate-js；全仓库唯一豁免目录 `src/lib/reader/foliate/**`（目录级豁免，禁止单文件巨石化）；业务组件只依赖 `src/lib/reader/{kernel,service}.ts`。adapter 文件头维护「使用的 foliate API 白名单」。
10. **阅读内核升级规程**：vendor 快照更新 → 白名单逐项核对 → L0（fakeKernel 语义）→ L1（`tests/reader.kernel.cjs`，含 CJK ruby/竖排夹具）→ L2（`tests/reader.engine.mjs`）→ L3 真实语料冒烟 → 签发新 ReaderEngineVersion（`src/lib/reader/foliate/version.ts` 单一来源 + 本节版本日志）。失败则 git 还原 `vendor/foliate-js/` 秒级回滚。
11. **表述红线（防过度自信的实现）**：① vendor = 可复现、可审计、可本地修补，**不等于**供应链零风险（其自带依赖 zip.js/fflate 与升级合并成本仍需管理，MANIFEST.json 记录 upstream commit 与 localPatches）；② L1 契约绿 = adapter 契约未破，**不等于**业务无回归（业务安全由 L2 证明，引擎渲染回归由 L3 真实语料捕获）；③ CFI + anchorText = **可降级恢复**的定位体系，CFI 绑定特定文档结构、并非永久全局 ID（粘贴书合成由 sourceHash 式确定性 + generatorVersion 守卫，结构变更走恢复链）。

## 7.2 数据完整性规则

- 所有业务表软删除（is_deleted）；查询一律带 `is_deleted=0`。
- schema 变更用启动时 `ALTER TABLE ... ADD COLUMN` + try/catch（列已存在即跳过）；破坏性数据修复写一次性迁移脚本。
- `updateCard` 未传 fsrs/leech 时保留原值，禁止置 NULL（v12 修复 F6）。
- contentEditable 一律走 EditableText 裸壳模式，禁止把 React 管理的子树直接设为 contentEditable（removeChild 崩溃教训）。
- 用户编辑 cloze 卡问题区时，`[…]` 自动还原为挖空语法；提示词禁止 hint 拆答案（渲染层兼容旧数据）。

## 7.3 测试义务

- FSRS：`tests/fsrs/` 六件套（§4.4.6）——L0 golden（13）/ L1 adapter（15）/ L1 补强（6）/ L2 db（23）/ L4 audit（配置感知分段重放）/ L5 simulate（451，含 S6 时间语义/S7 参数环境/S8 F9 热生效），全绿。另有 undo 套件（`tests/undo.test.cjs`，29）与 persist 边界套件（`tests/persist.test.cjs`，14）——FSRS 调度链路改动须三者全跑。
- M1 制卡体系：`tests/m1.test.cjs`（材料路由/L11/cloze 契约/翻转卡约束，22 断言，依赖 `tests/m1.cards.bundle.cjs`，改 cards.ts 后须用 esbuild 重打包）+ `tests/m1.e2e.cjs`（`npx electron tests/m1.e2e.cjs`，须先关应用）+ `tests/m1.gui.mjs`（CDP 驱动真实 UI 冒烟，须先以 `--remote-debugging-port=9224` 启动应用）。
- M2 备份与恢复：`tests/backup.test.cjs`（node 直跑，33 断言：zip 回环/恢复 staging 换入/路径穿越防护/自动备份按天去重与轮换）+ `tests/m2.gui.mjs`（CDP 驱动真实应用端到端：备份→恢复→重启数据不丢→设置页 UI，须先以 `--remote-debugging-port=9224` 启动应用；恢复目标是刚创建的备份，不丢数据）。
- 卡片/摘录跳转、内联编辑：E2E 手动验证（启动→操作→DB 断言→清理测试数据，测试数据用 FSRSTEST 等前缀）。
- 阅读内核（v20）四层测试（§7.1.10 升级规程）：L0 `src/lib/reader/testing/fakeKernel.ts`（业务单测替身+语义定义）；L1 `npx electron tests/reader.kernel.cjs`（adapter 契约 + CJK 专项 ruby/竖排夹具，jszip 现场构造夹具书，esbuild JS API 打包 driver——**禁用 execSync+npx**，Windows 下会挂起）；L2 `node tests/reader.engine.mjs`（CDP 端到端，自启自关应用，FSRSTEST 前缀）；L3 真实语料人工冒烟（含日文竖排/ruby 真书）。
- 测试脚本临时文件用完即删；测试数据写入前先备份 library.db。

## 7.4 提示词与配置管理

- 提示词版本化播种：目标版本号在 `ensurePromptTemplates`，低于目标版本插入新版，旧版留痕；改提示词先改本文档。
- AI Key：safeStorage 加密、按服务商独立存储（`keys[preset]`），切换预设只恢复该服务自己的 Key。
- FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用。

## 7.5 安全

- Key/Cookie 不进日志、不上传；渲染层不持有明文 Key（流式转发在主进程）。
- 联网检索结果只作理解上下文；AI 禁止编造来源。

---

# 第五部分 Decisions（决策记录）

## 8.1 关键决策日志

| # | 决策 | 理由 | 版本 |
|---|---|---|---|
| D1 | SQLite 用 sql.js（WASM），接口对齐 better-sqlite3 | OpenCode 时期选型：零原生编译依赖；性能债已记录，量大后迁移 | 继承 |
| D2 | 状态管理用纯 React state + 自研 EventBus，不引 Zustand/TanStack | OpenCode 时期实现已成型，迁移收益不抵风险；EventBus 12 事件锁定 | 继承 |
| D3 | AI 制卡为管线编排，不内置 Agent | 流程确定、可审计、1 次调用成本 | v9 |
| D4 | `enable_fuzz=false` | 预览=落库（所见即所存），fuzz 种子含毫秒时间会破坏一致性 | v11 |
| D5 | FSRS 状态全字段持久化 | 丢 S/D/reps 致长间隔失真 23 倍（F1 实测） | v11 |
| D6 | dist 优先加载 | devURL 连接超时导致偶发白屏 | v12.2 |
| D7 | 优化器选 fsrs-rs-nodejs | 官方 Rust 优化器的 NAPI 预编译绑定，Electron 实测 ABI 兼容；WASM 版备用 | v12 |
| D8 | 连续刷题复习模式 | 用户需求：大量连续复习不回列表 | v12.2 |
| D9 | 顶栏 A 方案文字导航 | 用户从 5 版概念稿中选定；页内不重复标题 | v12.2 |
| D10 | EditableText 裸壳模式 | contentEditable 直改 React 子树导致 removeChild 崩溃与内容叠加 | v12.2 |
| D11 | 提示词 v3：R13 禁 hint | AI 把答案拆两半写进 content+hint，正面泄漏半个答案 | v12.2 |
| D12 | 思考强度默认 low | GLM 推理模型思考近 3 万字致制卡 5 分钟；low 档大幅提速且质量可接受 | v12.2 |
| D13 | 跳转原文锚点 = 选中文本前 60 字 + 阅读比例 | 简单可靠；TreeWalker 定位 + 短暂高亮 | v12.2 |
| D14 | 路线图主线重排为 M1–M10，其余未实现 Phase 降级可选更新池 | 用户 2026-09-08 指定主线；数据备份与恢复按用户要求入主线（M2）；浏览器插件/网页剪藏明确降级可选 | v14 |
| D15 | 制卡升级顺序：先补软件功能（图片挖空/翻转问答）→ 提示词测试台调优闭环（AI 改测试台 → 用户手测 → 反馈 → 决定是否并回） | 提示词试验与主软件隔离；并回与否由用户依测试结果决定 | v14 |
| D16 | 图片挖空生成走 GLM 多模态识别遮挡区域（位置/形状→遮罩），不做手动遮挡编辑器 | GLM 5.3 Flash 多模态可用；occlusion_json 结构与浏览页渲染已预留 | v14 |
| D17 | 商业化在线功能（遥测/反馈/更新/多提供商/充值分发）入主线，遥测按 Hermes 规格红线实施 | 商业化前提是数据能力；红线保用户可控（首启同意/设置可关即零上报/不采内容） | v14 |
| D18 | **翻转问答卡 = 制卡手段而非卡类型**：选择创建翻转问答时创建两张互为翻转的独立问答卡（各自独立 FSRS 调度）；**今后禁止设计任何「复习时形态会变化」的卡片，一切卡片设计以 FSRS 算法为核心** | 一张卡在复习期变形（换面出题）会让同一张卡承载两种回忆任务，干扰 FSRS 对稳定度/难度的估计（调度假设每次复习针对同一题面） | v16 |
| D19 | 日记与 AI 洞察入主线（新增 M8，原 M8–M10 顺延为 M9–M11）：学习材料二分——他人创造的与自我感受到的；日记 = 主动记录的学习内容输入、已学知识的边界拓展；洞察按需触发（用户点击），日记不进 FSRS 队列、不强制制卡 | 记录感受的倾向与选择学习材料的倾向很可能相似，日记与知识库存在双向潜在关联（当下已学或将来习得的材料）；流式随想随记、无需整理 | v17 |
| D22 | **FSRS 参数环境版本化**：`fsrs_configs` 不可变配置快照（完整 weights+scheduler_options，指纹去重）+ `settings.app.fsrsConfigId` 活跃指针；应用新参数只影响未来调度，不回算任何存量卡片状态；review_logs 记录每条评分的参数归属，audit 按配置分段重放；settings.app.fsrsWeights 双事实源废除 | 同一套 ts-fsrs 可存在多套参数环境，历史数据模型必须在第一条优化记录产生之前定型；「audit 读当前权重」无法重现历史（多配置时代日志会被统一错放）；双事实源（config+镜像）会导致 audit/UI/engine 各读不同来源 | v23 |
| D23 | **产品学习日与 FSRS 时间语义分离**：`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0）仅定义统计口径的「学习日」（今日完成度/热力/日聚合/月内分组），不进入 FSRS 调度 elapsed_days 与优化器 delta_t；优化器 delta_t 与调度器同语义（工程不变量，行为级 oracle 锁定） | 用户钦定凌晨切点习惯（学习到凌晨不算新一天）；但调度器（ts-fsrs）内部时间语义不可注入切点——把切点塞进优化器会重建「调度≠训练」语义分叉，违背 M3 统一时间语义目标；凌晨学习的痛点本质是统计口径问题，与训练数据无关 | v23 |
| D20 | **阅读器 = foliate-js 单内核「一切皆书」+ ReaderKernel 防腐层**：文件书走 vendor foliate-js；粘贴书/摘录确定性合成 EPUB 进同一内核（摘录无 markdown 阅读边界）；锚点统一 CFI + 四层可降级恢复；PDF 走 PDF.js 基座（R4，PdfAdapter 独立于 Kernel 抽象，不预设「一切皆 foliate」）；多语言排版（CJK 竖排/ruby）为内核承诺并纳入 L1 夹具。业务代码禁止直接依赖 foliate-js（§7.1.9） | 用户需求：完整阅读器（多格式界面统一/目录/模式切换/外观自定义/标注/内外链接）。foliate-js 为调研后唯一可嵌入的宽松许可引擎（MIT；Readest/Anx/Foliate 三个生产应用同型验证）；文本锚点精度不足（同章重复错位）而 CFI 字符级精确；防腐层隔离其 API 不稳定风险 | v20 |

## 8.2 已接受偏差（实现与原锁定方案的差异）

| 偏差 | 原锁定 | 现状 | 处置 |
|---|---|---|---|
| 状态管理无 Zustand/TanStack Query | §2 表 | React state + EventBus | 接受为既成（D2），不再计划迁移 |
| 数据库 sql.js 而非 better-sqlite3 | §2 表 | sql.js 全量回写 | 接受；数据量显著增长后迁移（Roadmap） |
| 联网检索三引擎回退 | 文档锁 DDG 单方案 | Bing→DDG→百度 | 接受（更稳） |
| UI 微调类任务未逐次 bump 文档 | §1.6 | v12.2-v12.4 界面微调直接实施 | v13 重构时补记；此后功能级变更仍须先改文档，纯样式微调豁免 |
| 产品学习日（本地日切点）与 FSRS 时间语义（UTC 日历日）统计口径差 | §4.4.8 | 本地凌晨时段（00:00–切点）的复习：学习日统计算「昨天」，FSRS elapsed/delta_t 按 UTC 日历日计 | 接受（D23 产品语义选择）：准点复习下两者恒等；仅影响统计口径，不影响调度/训练一致性 |

## 8.3 版本变更记录（摘要）

- **v6** AI 制卡与助读体系（第 6.3 节）；**v7** Topic 调度承诺；**v8** occlusionJson + Key 加密；**v9** 管线架构 + 联网检索；**v10** 本地模型预设；**v10.4** thinking 信号；**v10.5** reasoning_effort；**v11** FSRS 调度契约（§7）+ F1-F6 修复；**v12** FSRS 优化器（§7.7）；**v12.2** 界面重设计（A 导航/去重标题/连续复习/跳转原文/删除/双面编辑/EditableText/dist 优先）；**v12.3** 摘录锚点；**v12.4** 顶栏 no-drag 修复 + 问题区内联编辑；**v13** 本文档六部分重构（无业务逻辑变更）；**v14** 主线重排（主线批次 M1–M10，数据备份与恢复按用户要求入主线；原未实现 Phase 全部降级 §9.4 可选更新池；新增 6.3.10 规划与 D14–D17）；**v15** M1 落地（四卡形式：reverse 双向卡 + 图片挖空生成链路；材料类型路由 detectMaterialType + AI 面板手动覆盖；独立提示词测试台 prompt-lab；提示词覆盖核对报告；card-occlusion 新分支播种；修复 extractClozeAnswer 组序 bug——v3 无 hint 挖空卡背面曾恒为空串；修复 prompt_templates 首装播种条件——全新库上 reader-explain/leech-rescue 曾缺播种）；**v16** 翻转问答重设计（**D18**：废除 reverse 卡类型与 reverse_json——翻转问答=制卡手段，创建/转翻转卡时拆为两张互为翻转的独立 qa 卡；禁止复习期形态变化的卡片，一切卡设计以 FSRS 为核心）；测试台修复（labAPI 守卫 + 启动 bat + applyDraft）；测试台 v4 候选补丁（G1-G9 + card-literature 文学/诗歌背诵候选，待用户实测）；覆盖报告更新处置状态并新增文学性材料研究（§五→§四）；**v17** 日记与 AI 洞察入主线（**D19**：新增主线批次 M8——Logseq 式流式日记补上第二输入通道（自我感受到的学习材料）+「洞察」按钮按需触发 AI，发现日记与已学知识的双向关联；日记不进 FSRS 队列；原 M8–M10 顺延为 M9–M11）；**v18** M2 数据备份与恢复（设置页手动备份/恢复：单 zip 含清单、ai-config 默认不含勾选才含、备份位置可配；每日首启自动滚动备份按天去重+保留份数轮换；恢复=校验→安全备份→staging+标记→重启换入生效，运行期不动库文件；新增 `electron/backup.js`、`backupAPI`、设置「备份与恢复」区块；测试 `tests/backup.test.cjs` 33 断言 + `tests/m2.gui.mjs` 端到端）；**v19** 卡片浏览升级批次（① **跳转原文现场查看语义**：跳转会话阅读器不写阅读进度与阅读字数统计，切出后记录位置保持上次真实阅读位置——此前跳转后滚动/切出会把跳转位置写进 progressJson，丢失真实阅读进度；统一 `handleJumpToDoc(docId, anchor, returnTo)` 三处入口（复习/队列/卡片浏览），修复队列跳转返回落点曾错回复习页的死代码问题；② **卡片浏览 Anki 式改造**：全量卡片表格+搜索+类型/状态筛选+排序+行详情（卡面内联编辑/暂停恢复/推迟/重置新卡/删除/跳转原文/质检问题/Leech 入口），`listAllCards` 补 docTitle JOIN；③ **共享 Dropdown 组件**：dashboard/Dropdown.tsx 提升为 components/Dropdown.tsx（+align 左对齐变体），AI 制卡侧栏「材料类型」下拉由原生 select 换为直角下拉，与统计数据页风格一致（纯样式组件复用）；**v20** M3 FSRS 集成验证（**L5 时间轴模拟层** `tests/fsrs/simulate.test.cjs`：全生命周期单卡剧本/整体时间平移不变性/预览=落库同源逐轮验证/遗忘链 leech 触发/优化器训练输入链；**官方做法审计**实锤并修复 **F7**——`fsrs_json` 缺 `learningSteps`（ts-fsrs 学习步进索引）致 learning 档第 2 步 Good 永不毕业、10 分钟档死循环，契约 §4.4.1 补该字段；`fsrsEngine.preview/next` 增可选 `now` 时间注入参数（渲染层行为不变）；golden.cjs 过时的 fuzz=true 断言纠正为 false；回归义务升级六件套（§4.4.6/§7.3））；**v21** M4 快捷键（**CommandRegistry 落地**（§4.2-2）：`src/lib/commands.ts` 命令表 12 条=用户锁定键位、组合键规范化（存储=展示同串）、全局 keydown capture 分发（输入焦点绝不劫持、e.repeat 忽略、抑制集合）、键位覆盖项只存非默认于 `settings.app.keybindings` + `src/lib/useCommands.ts` ref 注册；阅读四键（制卡 Ctrl+Z/AI 制卡 Ctrl+X/AI 解释 Ctrl+A/摘录 Ctrl+S，动作与选区菜单按钮同源，when=有选区且无弹层）；复习键（空格翻面仅正面、1-4 评分仅背面、q/w/d 有卡即可，删除仍 confirm，busy 守卫防连发；跳过不计「本轮」为既有语义未动）；设置页「快捷键」区块（捕获新键 Esc 取消、冲突拒绝保存、单条/全部恢复默认）；测试 `tests/m4.test.cjs` 39 断言 + `tests/m4.gui.mjs` CDP 23 断言 + `tests/m4.cleanup.cjs` 摘录清库配套）；**v22** 复习撤销评分（用户需求：误评无撤回。review_logs 增 `fsrs_before_json` 评分前快照列（ALTER TABLE 迁移，旧日志 NULL 不可撤销）；db 增 `getLastUndoableReview`/`undoLastReview`（恢复快照→物理删除该条日志→本次触发 leech 则解除挂起并关闭本次 LEECH issue→返回恢复后的卡）；IPC `cards:lastUndoableReview`/`cards:undoReview`；`review` 调用链补第 5 参 fsrsBefore；命令表增 `review.undo`（Z，13 条）；复习页 meta 行「撤销评分（X）」按钮 + 收尾页撤销按钮；撤销后回到该卡背面可立即重评、本轮计数 -1；**决策：撤销=物理删除日志**——review_logs 本无软删机制（无 is_deleted 列），训练/统计 10 处查询直读该表，物理删除使优化器输入与统计自动干净，避免 10+ 处查询改动风险；测试 `tests/undo.test.cjs`（electron + 临时 userData 隔离库）+ m4 两套同步更新（13 命令 / GUI 撤销段））；**v23** M3 增补批次：FSRS 数据完整性加固与学习日语义（**最高不变量**「同一份复习事实不允许两套解释」入 §4.4；**D22** fsrs_configs 不可变配置快照（完整 weights+scheduler_options+指纹 UNIQUE，无 update API，切换=settings.app.fsrsConfigId 指针，reset=指针回 cfg-default，apply 指纹去重）+ **废除 settings.app.fsrsWeights 双事实源**（存量迁移播种后删除）；**D23** 学习日=统计口径（settings.app.dayCutoffHour 本地钟面 0-23 默认 0，`learningDayIndex/learningDayStartMs` 仅统计），禁止进入 FSRS 调度/训练；**fsrsTime.js 独立实现 canonical delta_t**（UTC 日历日差复刻 ts-fsrs 5.4.2 语义，无库依赖，oracle=ReviewLog.elapsed_days 行为级对照）；review_logs 增 fsrs_after_json/leech_before_json/fsrs_config_id/fsrs_before_config_id/review_seq（唯一索引，存量回填=rowid）；**review 成功边界=COMMIT+persist 成功+IPC 成功**（崩溃一致性措辞，非跨层 ACID）；persist() 原子写（tmp+fsyncSync+renameSync，失败 throw 无静默降级，启动清残留 tmp）；**persistNow 纯持久化重试**；**undo 重写**：8 字段 after 全等校验（v22 旧日志不可撤销）+leech_before 精确恢复（F10）+fsrs_before_config_id 恢复+review_seq 序+事务；saveReview/undo 事务化；fsrs.ts 由完整配置快照构引擎+主进程 fsrs:configChanged 推送热重建（**F9**）；SettingsPanel「新一天开始时刻」设置；ReviewView 过期 preview 判废+保存失败横幅；audit.cjs 按日志 config 分段重放；测试 S6 时间语义/S7 参数环境/undo U6-U9/persist 边界套件；缺陷修复 **F9**（权重应用不热生效，UI 曾宣称即刻生效）、**F10**（undo leech 以「当前挂起」推断误回退手动挂起）、**F11**（persist 非原子整库覆盖写））。

---

# 第六部分 Roadmap（路线图，v14 主线重排；v17 增补日记批次）

> **v14 重排**：按用户 2026-09-08 指定，**M1–M10 为接下来开发的主线**（软件要实现的基本功能，排列顺序即开发优先级；一次只推进一批，§1.4）。原路线图中其余未实现 Phase 一律降级为 §9.4 可选更新池，**AI 不得自行领取**。
>
> **v17 增补**：按用户 2026-09-09 构想，新增主线批次 **M8 日记与 AI 洞察**（学习材料的第二输入通道，D19），原 M8–M10 顺延为 M9–M11，相对顺序不变。

## 9.1 主线批次

### M1 — AI 制卡体系升级（四卡形式 × 材料类型路由 × 提示词测试台）✅（v15 实现，v16 按用户反馈修订）

> **v16 修订**：翻转问答卡重设计（D18——拆为两张独立问答卡，废除复习期变形设计）。
> **v15 完成情况**：① 卡形式扩展 ✅（翻转问答=两张独立卡；图片挖空：assets 入库→GLM 多模态→occlusionJson→确认面板→复习渲染→L11 语义修正）；② 材料类型路由 ✅（detectMaterialType 本地识别 + AI 面板类型展示/手动覆盖，映射表见 §6.3.10 **待用户确认后锁定**）；③ 提示词测试台 ✅（`prompt-lab/` 独立 Electron 应用，v4 候选补丁就绪，调优闭环等用户实测）；④ 提示词覆盖核对 ✅（缺口报告 `docs/M1-prompt-coverage-report.md`；G1-G9 已实现为测试台候选，G10/G11 用户已拍板）。
> 遗留动作：映射表确认；用户实测 v4 候选后决定是否并回主软件（播种 v4）；提示词修改一律走「测试台验证 → 播种新版本」。

提示词优化的准绳是两份桌面文档：`C:\Users\xiongdy\Desktop\制卡20条原则.md` 与 `C:\Users\xiongdy\Desktop\制卡原则与知识表述_知乎收藏夹全文22篇.md`（文内图片为 Markdown 引用形式，图片存于 `C:\Users\xiongdy\Desktop\制卡原则与知识表述_图片\`）。

目标：软件支持对不同类型的阅读材料采用不同的制卡方式——先识别用户所选材料的类型，再分别匹配不同的制卡原则、提示词与制卡形式（若有更优流程，实现前先向用户提出）。

子任务顺序（用户指定：**先补软件功能，后调提示词**）：

1. **卡形式扩展（代码先行）**——四种核心制卡/复习形式：

| 形式 | 现状 | 待做 |
|---|---|---|
| 挖空题 | ✅ | 基线，保持 cloze 契约（§5.4/§7.2） |
| 问答题 | ✅ | 基线 |
| 翻转问答卡 | ❌ | 新增卡类型：正反两面皆可为题面（双向卡）。需扩展 cards 数据结构与生成输出格式，复习端支持双向出题与翻面 |
| 图片挖空卡 | 🟡 | occlusion_json（rects+assetPath）结构与 CardBrowser 渲染已有。生成链路补齐：图片入库（assets 表）→ 提交 GLM（多模态）识别需遮挡内容 → 返回位置/形状（区域信息）→ 生成 occlusionJson → 制卡确认；连续复习视图补渲染；对接 L11。不做手动遮挡编辑器（可选池，D16） |

2. **材料类型路由**：制卡入口先识别材料类型（本地规则先行），按类型路由到 PromptTemplate 分支与默认卡形式组合；既有 application/mnemonic/seq/formula 类型保留。
3. **提示词测试台（独立最小软件）与调优闭环**：把主软件提示词与运作流程（模式路由 → 取模板 → 上下文打包 → 流式生成 → JSON 容错 → Lint → 确认，§4.3）提取为独立、最轻量的测试工具（复用 prompts.js 与 lint 代码）。调优闭环（用户钦定）：**AI 按用户要求修改测试台内的提示词/流程 → 用户在测试台手动实测（文字/图片材料）→ 用户反馈测试结果 → 决定是否并回主软件**；并回时提示词播种新版本（旧版留痕）。主软件内不做提示词调优试验。
4. **提示词覆盖核对**：逐条核对 v3 提示词与两份文档的全部制卡原则、各类型学习材料的制卡策略/原则/处理方法；**发现缺口先向用户报告，经确认后再增改**。

Non-Goals：不改 FSRS；不动挖空契约；不直接改既有提示词文本（改提示词一律经测试台验证后播种新版本）。

### M2 — 数据备份与恢复 ✅（v18 实现）

> **v18 完成情况**：① 手动备份/恢复 ✅（设置 → 备份与恢复）。备份 = 单个 zip（`backup-manual-时间戳.zip`）：library.db 全库 + assets/** + settings.json + 清单 `backup-meta.json`（app/format/时间/数据规模留痕）；**ai-config.json 默认不入备份、勾选「包含 AI Key」才含**。备份位置 `settings.app.backupDir` 用户可选，默认 `%APPDATA%/incremental-reading-dev/backups/`。② 自动备份 ✅：每日首次启动（按天去重 `backup-auto-日期.zip`，当日已备则跳过），保留份数 `settings.app.autoBackupKeep`（默认 7，超出轮换删最旧；设置页可关）。③ 恢复 ✅：校验清单（拒绝非本软件 zip，防 zip 路径穿越）→ **先对当前数据做一次安全备份**（`backup-safety-*.zip`，含 Key、仅落本机备份目录）→ 解包到 `restore-staging/` + 写 `restore-pending.json` 标记 → **重启应用时换入生效**（启动序：applyPendingRestore → initDb；sql.js 运行期绝不直接改写库文件，§7.1.8）。④ 设置页展示当前数据量（书/卡/摘录/字节）与备份列表（手动/自动/安全标签 + 数据规模 + 逐条恢复 + 从备份文件恢复）；恢复完成后提供「重启应用」按钮。测试：`tests/backup.test.cjs` + `tests/m2.gui.mjs`（§7.3）。
> 衔接既有纪律：§7.3 测试前备份、§7.1.8 外部改库前备份可直接使用「立即备份」。

目标：确保用户学习数据不丢失。

1. **手动备份/恢复**：设置页入口。备份内容 = `library.db` 全库 + assets 资产文件 + settings.json（`ai-config.json` 含加密 Key，默认不入备份、用户勾选才含）；备份位置用户可选，默认 `%APPDATA%/incremental-reading-dev/backups/`。
2. **自动备份**：每日首次启动自动滚动备份，保留份数可配置（超出轮换删除最旧）。
3. **恢复**：从备份文件恢复；执行恢复前先对当前数据做一次安全备份（防误恢复本身丢数据）；受 sql.js 内存库约束（§7.1.8），恢复后重启应用生效。
4. **衔接既有纪律**：§7.3 测试前备份、§7.1.8 外部改库前备份可直接使用本功能。

Non-Goals：云同步/多设备不做（§1.2 留位原则不变）；备份不联网上传。

### R1–R4 — 阅读内核系列（v20 新增主线，先于 M3；R1 已实现）

> **R1 ✅（v20 实现）**：一切皆书 + ReaderKernel 防腐层 + foliate-js vendor 快照 + 目录侧栏 + 滚动/分页/对开 + 外观（主题/字号/字体）+ 内外链接（CFI 精确跳转/openExternal）+ 选区制卡管线适配（contextRef 四层）+ 进度/统计适配 + 导航防护 + L0/L1/L2 测试（L1 含 CJK ruby/竖排夹具）。
> **R2 待做**：高亮标注（overlayer 经 Kernel 自有方法暴露 + annotations 表 + 标注→摘录/制卡联动）。
> **R3 待做**：个性化完善（自定义主题保存、页边距/行距、翻页交互细节）。
> **R4 待做（合流 M6）**：PDF（PdfAdapter→PDF.js 直连；Range 协议流式 + 按页虚拟渲染，200-300MB 不整载；扫描版=页级 tesseract.js 本地 OCR 默认 + MinerU 整本伴生文本层可选）、Word（mammoth→EPUB）、TXT、MOBI 直读。

### M3 — FSRS 集成验证（时间轴模拟）✅（v20 实现）

> **v20 完成情况**：① 验证设计（下方）已先写入文档再实现 ✅；② **L5 时间轴模拟层** ✅（`tests/fsrs/simulate.test.cjs`，`npx electron tests/fsrs/simulate.test.cjs` 运行，**417 断言全绿**；六件套合计 = L0 13 + L1 15 + L1 补强 6 + L2 23 + L5 417 + L4 总账）；③ 集成审计 ✅（结论见本节末尾「官方做法一致性审计」）。审计实锤并修复两个新缺陷：**F7**（`learning_steps` 未持久化，学习档 Good 死循环——详见 §4.4.1 与 `tests/fsrs/REPORT.md`）与 **F8**（优化器 `evaluate` 对同日收尾样本抛 InvalidInput，真实日志必触发——详见 §4.4.7）；纠正 golden.cjs 过时的 fuzz=true 断言；`fsrsEngine.preview/next` 增加可选 `now` 参数（时间注入，渲染层行为不变）；契约字段补 `learningSteps`。
> Non-Goals 达成：未改 DB 层行为、未动 fuzz/评分语义、request_retention 保持 0.9（用户可调为后续可选池项）。
>
> **v23 加固增补**（经外部评审五轮收敛，§4.4.8-4.4.11 + D20/D21 + §8.3 v23 记录为完整依据）：① 时间语义统一——optimizer delta_t 弃 floor(24h)，canonical 函数（fsrsTime.js 独立实现）与调度器 UTC 日历日语义精确恒等，行为级 oracle（ReviewLog.elapsed_days）+ L6 负测试锁死，学习日切点仅统计（D23）；② 参数环境——fsrs_configs 不可变快照 + 指针（D22），废除 fsrsWeights 双事实源，review_logs 记录参数归属，audit 分段重放；③ 数据完整性——review_logs 增 after/leech_before/config 快照与 review_seq，saveReview/undo 事务化，persist 原子替换（F11），review 成功边界=COMMIT+persist+IPC；④ 缺陷修复 F9（权重应用不热生效）/F10（undo leech 误回退）/F11；⑤ 审计版本戳：**Audited against ts-fsrs 5.4.2 / fsrs-rs-nodejs 0.9.1 / package-lock resolved versions / 审计日期 2026-09-09**；FSRS 依赖升级为独立批次。

**验证方法与流程设计（先于实现写入本文档）**：

- **定位**：与六件套中既有五层互补的**仿真回归层**——L0-L4 验证「单轮/单点正确性」，L5 验证「整条时间轴上生命周期的连续正确性」。
- **黄金参考**：ts-fsrs 5.4.2 原库（`enable_fuzz:false`）在本进程内独立驱动一条**全字段内存链**（refChain），与应用侧「持久化往返链」（appChain）在同一时间轴上逐轮对照。关键测试设计：refChain 绝不从 appChain 重建（否则丢字段会两侧同错、无法检出 F7 类缺陷）。
- **时间控制**：`fsrsEngine.preview/next` 注入显式 `now`（可选参数）；测试用固定基准时刻 T0=2025-01-01T00:00:00Z，全部时间戳显式给出，结果确定可复现。
- **持久化往返**：应用侧每轮的落库状态经 `JSON.stringify → parse` 往返后驱动下一轮（模拟 db 存取），专抓字段丢失与精度损失。
- **剧本矩阵**（五组）：
  1. **全生命周期单卡剧本**（跨约 70 天）：新卡（稀疏 3 字段，模拟 db.createCard）→ 首评四分支 → learning steps 步进（1m→10m→毕业）→ Review 多轮 Good（间隔随 S 增长）→ 遗忘（Again → relearning 10m → 恢复）→ 逾期复习（到期后 +3 天/+30 天再评，验证 elapsed> scheduled 场景）→ Hard/Easy 混合 → 月级长间隔。逐轮断言 state/due/lapses/stability/difficulty/reps/lastReview/learningSteps 与参考引擎**逐字段精确相等**（同库同参同 now，容差为 0）。
  2. **整体时间平移**：同一评分剧本分别在 T0、T0+10 天、T0+100 天三个基准各跑一遍，断言各轮相对结果（due 偏移/S/D/reps/lapses）完全相同——FSRS 平移不变性（整日平移下 dateDiffInDays 取整不变）。
  3. **预览=落库同源**：每一轮 `preview(card,now)[rating].fsrsState` 与 `next(card,rating,now).fsrsState` 深度相等（§4.4.3 逐轮验证）。
  4. **遗忘链与 leech**：毕业后 [Again,Good]×8，断言 lapses 逐次 +1、每次 Again 后 due=+10m（relearning 档）、第 8 次 lapse 时 `isLeech(lapses,8)` 恰好触发。
  5. **优化器训练输入链**：用剧本产生的评分日志（含正常卡/单次复习卡/全同日卡/36 小时间隔卡）经 `optimizer.buildTrainSet` 构建 FSRSItem：断言 delta_t 向下取整天数、前缀展开（每条复习一个样本且携带全部历史）、无效样本过滤（单次复习/全同日/无跨天前缀 → 排除，防 fsrs-rs panic）；断言训练集含「同日收尾」样本（F8 触发路径在场）后喂给 fsrs-rs-nodejs 真实 `computeParameters` + `evaluate`，输出 21 维有限权重与 logLoss/rmseBins；`applyWeights` 拒绝非 21 维、接受 21 维并写入 settings、`resetWeights` 清除。
- **通过标准**：五组全绿后 L5 并入回归义务（§4.4.6 六件套）。

**官方做法一致性审计结论（v20，对照 open-spaced-repetition 官方实现与推荐实践）**：

| 审计项 | 结论 |
|---|---|
| 引擎与参数 | ✅ ts-fsrs 5.4.2（FSRS-6，21 权重）；request_retention 0.9 / maximum_interval 36500 / enable_short_term true / learning_steps [1m,10m] / relearning_steps [10m] 全部官方默认；enable_fuzz=false（官方默认即 false，D4 锁定） |
| 评分/状态映射 | ✅ Again=1/Hard=2/Good=3/Easy=4；State New=0/Learning=1/Review=2/Relearning=3，与官方枚举一致 |
| 调度调用方式 | ✅ repeat(card, now) 四档一次计算、评分复用 preview 结果（ReviewView 落实）；createEmptyCard 语义正确；due≤now 到期判定、due 升序+priority 降序（Anki 惯例） |
| 复习日志 | ✅ 自建 review_logs（card_id/rating/reviewed_at/duration_ms）满足官方「持久化评分历史」要求与优化器最小输入；ts-fsrs 返回的 ReviewLog 被弃用（其信息可由日志+引擎重放复原，audit.cjs 即此原理）——接受并记录 |
| 优化器 | ✅ fsrs-rs-nodejs 0.9.1 官方 NAPI 绑定；FSRSReview(rating, delta_t=floor 天)/FSRSItem/前缀展开与官方 dataset.rs 一致；无效样本过滤符合官方防 panic 要求；computeParameters/evaluate 官方 API；权重 21 维校验→settings 注入→启动重建引擎 |
| Leech/挂起 | ✅ lapses≥8（Anki 默认）；挂起卡排除出到期队列 |
| **发现缺陷** | **F7**：`learning_steps` 未持久化 → learning 档第 2 步（10m）卡再评 Good 不毕业、永回 +10m（仅 Easy 能逃逸）——已修复（v20）；**F8**：优化器 `evaluate` 对「最后一条复习 delta_t=0（同日收尾）」的样本抛 InvalidInput（最小复现实锤：`[3:0,1:0]` FAIL / `[3:0,3:1,1:1]` OK），真实日志中学习/重学步同日恢复是常态、训练必报错——已修复（评估取可评估子集）；golden.cjs 曾断言 fuzz=true「应用侧」（v11 修复前残留）与契约矛盾——已纠正为 false |
| 记录在案的接受项 | `elapsed_days/scheduled_days` 不持久化（重算/只写不读，§4.4.1）；request_retention 固定 0.9 不可调（官方建议允许 0.8-0.95 个人化→可选池）；优化器权重注入为启动异步（理论上注入前首评用默认权重，影响一轮且自愈） |

先设计验证方法与流程（写入文档）再实现：构造长周期模拟数据，时间状态可整体平移（如平移 +10 天验证卡片 10 天后的状态），覆盖卡片生命周期每个环节（创建 → 首评 → 多轮评分 → 遗忘 → lapses/leech → 优化器训练输入）在各时间点的状态与调度正确性。与 `tests/fsrs/` 五件套（§4.4.6）互补，作为仿真回归层。（✅ 已按上方设计于 v20 完成）

### M4 — 快捷键（阅读 + 复习）+ 自定义 ✅（v21 实现；v22 增补撤销评分键）

> **v22 增补**：复习场景新增「撤销上一评分」（默认 Z，命令 id `review.undo`，命令表 12→13 条）——用户在复习中发现误评无撤回，要求补按钮+快捷键。撤销为一步（最近一次可撤销评分）：review_logs 增 `fsrs_before_json` 快照列，undo = 恢复快照 + 物理移除该条日志 + 回退本次触发的 leech 挂起；详见 §6.2 连续复习与 §4.4.4。Z 为本批选定默认键（避开阅读场景 Ctrl+Z；Anki 撤销惯用键），可在设置 → 快捷键改绑。

> **v21 完成情况**：① **CommandRegistry 落地**（§4.2-2）：`src/lib/commands.ts`（命令表 `COMMANDS` 12 条=下方锁定表；组合键规范化 `eventToCombo`——修饰符 Ctrl/Alt/Shift/Meta 固定序 + 空格记 `Space` + 字母大写，存储串=展示串；纯修饰键/`e.repeat`/输入焦点（input/textarea/contentEditable）绝不触发；抑制集合供设置弹窗与键位捕获期间挂起全局分发；命中即 `preventDefault+stopPropagation` 拦截 Ctrl+A/Ctrl+S 等原生命中）+ `src/lib/useCommands.ts`（组件动作表经 ref 注册，keydown 时刻读最新闭包，卸载注销）。**键位数据流**：默认键 → `settings.app.keybindings` 只存用户覆盖项（缺省=默认；重启重读 + settings/changed 同步缓存）→ 生效键。② **阅读四键** ✅：Reader 的制卡/AI 制卡/AI 解释/摘录动作提取为 act* 函数，选区菜单按钮与快捷键完全同源；`when`=存在活动选区且无手动制卡弹窗、无 AI 面板。③ **复习键** ✅：空格=显示答案（仅正面）；1/2/3/4=评分（仅背面，评分按钮在场时）；q=标记并暂停、w=跳过、d=删除（有卡即可触发、与翻面无关，删除仍走 confirm）；评分/暂停/跳过/删除带 busy 守卫防长按连发；**跳过不计入「本轮」计数为复习页既有语义，未改动**。④ **设置页「快捷键」区块** ✅：按阅读/复习分组展示 12 条；点键位框捕获新组合键（Esc 取消、纯修饰键继续等待、捕获期间抑制全局分发）；冲突检测（与其他命令生效键相同则拒绝保存并提示「与「X」冲突」）；单条「恢复」+「全部恢复默认」。测试：`tests/m4.test.cjs`（39 断言，node 直跑，依赖 esbuild 打包的 `tests/m4.commands.bundle.cjs`）+ `tests/m4.gui.mjs`（CDP 端到端 23 断言：阅读 Ctrl+Z/Ctrl+S、复习空格/3/q/w/1/d、设置区块捕获/冲突/恢复/持久化；**Ctrl+X/Ctrl+A 在用户已配置 Key 且 contextBridge aiAPI 不可覆写时跳过真实按键**以防真实 AI 调用——组合键解析由单测覆盖、动作函数与菜单按钮同源，安全与覆盖的最优平衡）。

默认键位（用户锁定）：

| 场景 | 动作 | 默认键 |
|---|---|---|
| 阅读 | 制卡 | Ctrl+Z |
| 阅读 | AI 制卡 | Ctrl+X |
| 阅读 | AI 解释 | Ctrl+A |
| 阅读 | 摘录 | Ctrl+S |
| 复习 | 显示答案 | 空格 |
| 复习 | Again / Hard / Good / Easy | 1 / 2 / 3 / 4 |
| 复习 | 撤销上一评分 | Z（v22 增补，用户需求） |
| 复习 | 标记并暂停 | q |
| 复习 | 跳过 | w |
| 复习 | 删除 | d |

实现走 CommandRegistry（§4.2-2，✅ 已随本批落地）；设置页支持自定义（冲突检测 + 恢复默认），落 settings.json。

### M5 — 手动制卡优化

与 AI 制卡同构：① 卡类型选择框（问答 / 翻转问答 / 挖空 / 图片挖空，随 M1 扩展同步）；② 手动选择 UDC 领域标签（对齐 R17，§6.3.3）；③ 对照 AI 制卡流程与数据表字段核查补全（contextRef 锚点、sourceRef、dateStamp、priority、knowledgePointId 分组等）；④ 继续强制过 CardLintEngine（§4.2-18）。

### M6 — 导入格式扩展

支持 Word（.docx）/ TXT / Markdown / PDF（基础文本导入）作为阅读材料；调研其他常见学习材料格式（HTML、MOBI、Anki 牌组等）一并支持。PDF 的 MinerU 云解析双栏不在主线（可选池）。

### M7 — 词典

参考 GoldenDict-ng（https://github.com/xiaoyifang/goldendict-ng）与原版 GoldenDict（https://github.com/goldendict/goldendict），研究部分集成或自行实现：

- 选中单词自动弹出发音 + 释义；一键制卡且记录单词所在原句上下文。
- 单词卡四种形式：看中文回忆外文单词和发音；看外文回忆发音和中文意思；听发音回忆外文和中文；展示原句上下文并对选中词挖空回忆挖空内容。
- 调研可集成的在线词典（须含单词释义和发音、且有成熟集成方法）；支持用户手动导入词典。

### M8 — 日记与 AI 洞察（学习材料的第二输入通道）

> **构想来源（用户 2026-09-09）**：学习材料分两类——① **他人创造的**（书、文章、视频文案等，软件现有全部输入通道均属此类）；② **自己感受到的**（日常事件引发的感悟与思考，此前没有输入通道）。人在记录感受时的倾向与选择学习材料时的倾向很可能相似，因此日记作为**主动记录的学习内容输入**，是已学知识的一种**边界拓展**：今天的思考可能源于此前在软件中学过的某个方向的知识；也可能当下并无关联，但将来学习的他人创造的材料会与从前的日记产生联系——日记与知识库之间存在双向的潜在关联，由 AI 洞察来发现。

目标：提供随想随记、无需整理的流式日记（Logseq 式按日期流水记录），并提供「洞察」入口，由 AI 发现日记与已学知识之间的联系，或洞察有趣、有用的关联。

内容：

1. **数据层**：新增日记条目表（日期 + 文本/轻 Markdown，含 §1.2 留位字段）与洞察记录表；条目可补记、可编辑，但不做整理性结构要求（无强制标签/分类/双链）。
2. **日记界面**：主导航新增「日记」页，Logseq 式按日期倒序的流式时间线；随想随记、记入即可，无需反复整理。
3. **「洞察」按钮**：日记页的主操作，位置依设计系统规范（§5）在实现时确定；点击触发 AI 洞察——**按需触发，不做后台自动分析**。
4. **AI 洞察**：将日记（默认近期，洞察范围实现前与用户确认）与已学知识（UDC 领域、卡片、摘录、在读书籍）打包为上下文，输出：日记与已学内容的关联（某条感悟 ↔ 某本书/某张卡/某个领域）、跨条目的主题汇聚、开放性的追问；洞察结果可保存、可跳转到被关联的原文/卡片；随知识库增长重复洞察，会发现旧日记与新学材料之间的关联（第二方向）。
5. **洞察去向**：发现值得沉淀的感悟时提供「就此制卡」入口（复用既有制卡管线 + CardLint，§4.2-18）；洞察提示词遵循 M1 纪律——先测试台验证，再播种新版本。

Non-Goals：日记不进 FSRS 队列、不强制制卡（D18 精神——日记是输入面，不是复习面）；不做日记的强制整理与云端同步；洞察不自动定时触发。

### M9 — 在线功能（商业化前置）

执行顺序（每步先报告再动手）：

1. **数据收集**：先检查 Hermes 方案（`docs/SPEC-usage-telemetry.md`）是否可行、是否与项目冲突；通过后**先向用户描述用户真实使用时接触数据收集相关功能的先后顺序及展示方式**（哪些界面/信息，如首启隐私政策、设置开关），确认后实施。目标：用户数/活跃度/AI 调用量，作商业化决策依据；须守规格红线（同意后才发首个字节、不采集内容、关闭即零上报）与 §1.1 纯本地边界（可开关、不阻塞启动）。
2. **反馈入口 + 社群链接**：设置页顶部增加反馈入口（发送至专用邮箱）；社群链接（QQ 群、X、哔哩哔哩、小红书及其他主流社群）。
3. **检查更新**：设置中添加检查更新功能及按钮；添加可开关的「启动时自动检查更新」选项。
4. **AI 服务多提供商预设**：用户未配置 Key 时，设置页 AI 服务直接以模型提供商名称为选项（选中只填 API Key，baseURL 默认配置好；同一提供商有不同 baseURL 时支持切换）；粘贴 Key 窗口旁提供「获取APIkey」一键跳转链接；**先核实各主流提供商有无邀请返利活动**，有则把邀请码编入链接。
5. **API key 分发方案研究**：基于收集的数据与模型供应商谈判低价 token，或自购低成本订阅包 → 用户向开发者充值、以低于官方价但高于成本价取用 token；研究充值与 token 分发在软件内的实现方式。

### M10 — 官网

为软件设计并搭建官网。

### M11 — 界面自定义与主题社区

调研 Obsidian / Logseq 的界面自定义实现（主题格式、CSS 注入、可调项声明），借鉴到本软件：允许用户自定义界面主题，并留出将自定义主题上传到社区主题库的渠道。压轴原因：依赖插件/主题宿主（§4.5，未实现）落地，且主题社区需服务端，与「纯本地优先」的边界届时单独决策。

## 9.2 主线状态表

| 批次 | 内容 | 状态 |
|---|---|---|
| R1 | 阅读内核（一切皆书 + 防腐层 + CFI + 目录/模式/外观） | ✅ v20 实现（L1 38 项 + L2 11 项断言全绿；CJK ruby/竖排夹具通过） |
| R2 | 高亮标注 | ❌ |
| R3 | 阅读个性化完善 | ❌ |
| R4 | PDF + Word/TXT/MOBI（合流 M6） | ❌ |
| M1 | AI 制卡体系升级（四卡形式/材料路由/提示词测试台/覆盖核对） | ✅ v15 实现，v16 修订（D18 两张独立卡）；映射表确认与 v4 候选实测待用户 |
| M2 | 数据备份与恢复（手动 + 自动滚动 + 恢复保护） | ✅ v18 实现（手动/自动/恢复全链路 + CDP 端到端验证） |
| M3 | FSRS 时间轴模拟验证 | ✅ v20 实现（L5 仿真层 + 官方做法审计 + F7/F8 修复）；✅ v23 加固增补（时间语义统一/参数环境/原子提交/Undo 不变量，F9-F11 修复） |
| M4 | 快捷键 + 自定义 | ✅ v21 实现（CommandRegistry 落地 + 阅读四键/复习键 + 设置页冲突检测与恢复默认）；v22 增补撤销评分（Z） |
| M5 | 手动制卡优化（类型选择/领域标签/流程对齐） | ❌ |
| M6 | 导入格式扩展（Word/TXT/MD/PDF + 调研） | ❌ |
| M7 | 词典（取词/发音/上下文制卡/词典源/本地导入） | ❌ |
| M8 | 日记与 AI 洞察（流式日记 + 洞察按钮 + AI 关联分析，第二输入通道） | ❌ |
| M9 | 在线功能（数据收集/反馈/更新/多提供商/API 分发） | ❌ |
| M10 | 官网 | ❌ |
| M11 | 界面自定义 + 主题社区 | ❌ |

## 9.3 历史阶段存档（已实现）

| Phase | 内容 |
|---|---|
| 0 / 1 | 空壳启动/主题/设置；粘贴成书 |
| 2 | 阅读器 + 摘录 + 队列（基本完成） |
| 3 | 手动制卡 + FSRS（调度连续性验收见 tests/fsrs） |
| 4b | EPUB 导入 |
| 11 部分 | AIGateway（插件市场未做 → 可选池） |
| 12 部分 | AI 阅读助手（解释侧栏/就此制卡/跳转原文；「插入原文回写」→ 可选池） |
| 13 / 14 | AI 制卡主路径；Leech 六步 |
| 15 部分 | 干扰检测查重警告（对比卡向导/编辑会话/补进度 → 可选池） |
| 16 部分 | 遮挡卡数据结构与浏览页渲染（生成链路 → M1） |
| — | 统计仪表盘（用户主导）/ FSRS 优化器（v12）/ 界面 v12.2 重设计 + 跳转原文 + 编辑 |

## 9.4 可选更新池与技术债（未排期，不得自行领取）

| 项 | 原编号 | 说明 |
|---|---|---|
| 浏览器插件（网页剪藏） | 5 | 用户指定降级可选。路径：安装逆向 Skill（https://github.com/zhaoxuya520/reverse-skill）研究 Obsidian Web Clipper（https://github.com/obsidianmd/obsidian-clipper）的实现，据此做简化版浏览器插件——网页阅读内容一键保存到软件作为阅读材料 |
| PDF MinerU 双栏 | 4 | 云解析双栏阅读；M6 只做 PDF 基础文本导入 |
| 摘录优先级选择 + 负载感知推迟 | 2.1/2.2 | 现为 ×1.6 占位（§6.4） |
| Z-lib/Anna 连接器 | 6 | 站点见附录A |
| 视频 + AI 总结 | 7 | Bilibili/YouTube Provider |
| 背景音 | 8 | Moodist 内置 + 外链 |
| 灵动岛状态栏 | 9 | 顶栏已改文字导航，需重定义 |
| TODO/番茄 | 10 | |
| 插件市场全量 | 11 | M11 只做主题上传渠道，非全量市场 |
| 插入原文回写 ai-supplement | 12.2 | |
| 对比卡向导/编辑会话/补进度 | 15 | |
| 手动遮挡编辑器 | 16 | M1 图片挖空走 AI 识别区域（D16），不依赖此编辑器 |
| 每日上限 / 全局混编 / 「不再关心」 | — | §6.3.8 规划项；每日上限的「学习日」口径已具备（v23 settings.app.dayCutoffHour） |
| epub.js 兜底 adapter | — | foliate-js 不可用时的 Kernel 第二实现预案（epub.js 维护停滞，仅应急）； foliate pdf 模块（R4 验证，Anx Reader 已生产验证但上游标 experimental） |
| better-sqlite3 迁移 | 技术债 | sql.js 全量回写，数据量显著增长后迁移（接口已对齐） |
| electron-builder 打包 | 技术债 | 未配置，无安装包 |
| 历史数据兼容 | 技术债 | v11 前卡片 fsrs_json 无 S/D（基线回填）；存量 cloze 卡 hint 拆答案（渲染层已兼容）；存量摘录/部分卡片无锚点（降级上次阅读位置） |

## 9.5 下一步

M4 已于 v21 实现完毕（CommandRegistry §4.2-2 落地 + 阅读四键/复习键 + 设置页自定义，见 §9.1 M4）。接下来从 **M5 手动制卡优化** 开始：① 卡类型选择框（随 M1 扩展同步）；② 手动选择 UDC 领域标签（R17）；③ 对照 AI 制卡流程核查补全字段；④ 继续强制过 CardLintEngine。开工前复述 Goals/Non-Goals（§7.1）。提示词调优闭环随时可由用户启动（打开 `prompt-lab/` 测试台 → AI 改提示词 → 手动实测 → 反馈 → 决定是否并回）。

---

## 附录A — 参考项目网址（锁定）

- xiadown：https://github.com/arnoldhao/xiadown ；Bili.Copilot：https://github.com/Richasy/Bili.Copilot
- Bilibili-Obsidian-Clipper：https://github.com/haixiong1997/Bilibili-Obsidian-Clipper
- MinerU：https://mineru.net/apiManage/docs ；https://github.com/opendatalab/MinerU
- FSRS：https://github.com/open-spaced-repetition （ts-fsrs / fsrs-rs / fsrs-rs-nodejs / fsrs-browser）
- Obsidian Clipper：https://github.com/obsidianmd/obsidian-clipper ；Omnivore：https://github.com/omnivore-app/omnivore
- Hypothesis：https://github.com/hypothesis/browser-extension ；Memex：https://github.com/WorldBrain/Memex
- Moodist：https://github.com/remvze/moodist ；Endel：https://app.endel.io/
- Z-library：https://zh.articles.sk/ ；Anna's Archive：https://zh.annas-archive.gl/ ；singlelogin：https://singlelogin.co

## 附录B — EPUB 与阅读内核实现备忘（v20）

- 导入（不变）：`@likecoin/epub-ts`：JSZip 解包 → container.xml/OPF/spine → 章节 XHTML → Markdown 入库 → TOC 存 tocJson；原包存 Asset{kind:epub-original}（assets/<itemId>/original.epub，阅读内核经 `library:readBookFile` 读取）。DRM 书跳过并提示。
- **阅读（v20 内核化）**：EPUB 原书由 vendor foliate-js 渲染（blob iframe + CSS 多列分页）；**锚点 = EPUB CFI**（foliate epubcfi 生成/解析），导入期 DOMPurify 剥离 id 不再影响定位（CFI 基于渲染后结构）。
- **合成 EPUB（粘贴书/摘录）**：`src/lib/epub.ts buildSyntheticEpub`——markdown-it→HTML（html:false 防注入）、`^# `一级标题章节化、KaTeX renderToString 自包含（?raw 内嵌 katex.min.css 首章）、`SYNTH_GENERATOR_VERSION` + 确定性哈希 id 守卫（**同版本+同输入必然同构**，已存 CFI 不因重新生成错位；禁止在生成管线引入时间戳等不确定因素）。
- foliate 快照治理：`vendor/foliate-js/MANIFEST.json`（upstream/commit/importedAt/localPatches——当前补丁：pdf.js 分支剔除，R4 另行 vendor）；升级走 §7.1.10 规程。
- 已知限制：foliate paginator 上游自述「慢、部分 CSS 不合预期」；ruby 标签曾报影响渲染与搜索（#124），L1 CJK 夹具持续回归；竖排支持经逻辑属性实现（#36 已关闭），渲染质量属 L3 人工冒烟范围。
