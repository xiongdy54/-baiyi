# 一站式渐进阅读学习软件 — AI 开发指导文档（**v48.15，书架页重设计定契约（D51）**：网格改 `minmax(下限,1fr)` 消除右侧留白（任意窗口宽度富余恒 0，1200px 实测 5 列各 208px；旧算法同宽余 40px）/ 新增**吸顶工具条**收纳 视图·密度·排序·添加材料主按钮（§5.3）/ 书卡由「整块封面 + hover 黑幕」改「**封面 + 排印图注**」（书名与进度常驻可读，操作收进 40px ink 动作条，语言与归组走共享 `Dropdown`）（§5.4）/ **手动顺序拖拽 + `Alt+方向键`** 与文件夹**三区落点**（两侧重排、中央成组）/ **文件夹**（拖到书上即成组、就地命名不自动取名、标签页 + 一排书脊 + hover 成员名册、三条退出路径、只有解散没有删除、一层为限）/ 顺序与文件夹存 `settings.app.shelfOrder`·`shelfFolders`（**零 schema 变更**，备份包本已含 `settings.json`）/ 空态不再重复主行动（连带修订 swiss 文档「状态设计 · empty」）/ 极窄窗口工具条**单调退让阶梯**（900/1100/1280 容器宽，实测踩过非单调导致中段两行的坑）；设计依据与实测数据见 `design-samples/bookshelf-redesign.html`；前序 **v48.14，UI 优化收口**：分支 `UI优化` 全界面契约审查与收口——派生 Token 求值层修复（`var()` 在声明元素上求值，上层覆盖带不动派生档 → 凭空第二个焦点色）/ 卡片四类由文档词汇转为落地 / 表格收口为只画横向 hairline / 死 CSS 清理 34 条 / 三项行为缺陷修复（保存锁死·开书空白·原生弹窗改内联）/ 键盘可达补口（仪表盘 Alt+方向键重排、8 模态焦点陷阱）/ §5.4 跳转文案去箭头 / §5.3 补 2px 半档 / 原第二皮肤下线、扩展点改判 M11 预留；**决策与验收全量见 §8.1 D50**；前序 **v48.13，M15 收口**：评审闸门＝severity / Published·Candidate 发布模型 / 展开≠深化 + 按需深挖 + 增量评审 / 重启续跑（interrupted ≠ failed）/ 同材料串行化 / 全局后台活动指示器；**现行契约汇总见 §4.19 v48.13 收口块**（D45–D49）；v48，M15 材料知识导图重设计定契约（纯文档：D40 补录 + D41/D42 新增，§4.19 v48 全节重写，决策日志去重与错号修正）；v46，M14-UM2 用户记忆「接地与检索」落地——M14 全部收口（实现完成情况见 §9.1 M14 两 blockquote，§6.3.3 v7 基线转实现）；v45，M14-UM1 用户记忆「记忆文件与整理管线」落地（实现完成情况见 §9.1 M14 UM-1 blockquote，偏差补记 §8.2）；v44，用户四项拍板定契约（纯文档）：① **R20 记忆接地白名单原则化**（§4.18-9 v44 blockquote）——凡按提示词规范或卡型规则**需要情境**的卡片一律允许记忆接地（新增探针卡 application/transfer 维度），scope 注册表显式声明 `situationRequired`，不需要情境的一律不注入；② **K3 探针卡生命周期修订**（§4.7 末 v44 blockquote）——新增前沿探索开关 `settings.app.frontierExploration.enabled`（默认关）；开启后探针**免逐张预确认**（§1.7 有界例外，闸门后置到首评）以真实卡行混入复习队列、正面与普通卡无区别、背面首次揭示探针身份 + 四档自评 + **质量评判（接受/不接受）**；**一次性证据原则**——mastery 证据只取首次作答（满权重高独立性），该卡后续任何复习不再产生掌握度证据（重复复习同一探针会退化为机械记忆，对掌握度的证明力随重复递减——用户 2026-09-17 洞察）；**卡片去向按质量评判分流（v44 同日修订）**——用户接受→保留为普通卡正常进 FSRS 间隔重复（新情境考察题本身有记忆价值），不接受→suspend 退役留审计；后续前沿检查生成全新情境新探针；③ **新增 §4.19 材料知识导图 + M15 批次**——思维导图＝材料作者视角的知识组织（每份材料独立产物，随书存储、层级树展示），知识图谱＝用户大脑知识画像，**两图独立并行、允许联结**（导图节点可就此制卡、证据使图谱侧长出 KP）；阅读器目录按钮旁新增「导图」按钮，生成前选范围（整书/章/更小结构）与覆盖粒度（预估调用量先行）；**质量优先于成本**（用户明示立场）；四阶段管线（本地解析→章节抽取分片缓存→整书聚合→图先于图示）；集成 diagram-design skill（MIT，§4.19-4：选型=确定性本地函数按材料类型×领域×篇幅×粒度定白名单与数量）；）；**v43 K2-B 完成**（LKM 余下 4 scope 播种 v1 + 出层契约校验 `electron/kpScopes.js` + KnowledgeLint K4/K7/K8 + prompt-lab ×N 离散度守门，完成情况见 §9.1 K2-B blockquote）；v42 M14「用户记忆 User Memory」定契约（D39，纯文档）：由 AI **自主维护**的分层记忆文件（`core.md` + `index.md` + `topics/<生活域>/<主题>.md`，**总量不设上限、永不自动删除、不做衰减**——预算只约束**单次注入量**）；条目三级模型（事件/处境/事实，照自传体记忆三级）；**生活域＝封闭分类（8 + 其他）+ AI 命名子主题**；制卡时按需检索注入，为「应用卡」提供**真实处境**接地（R20），**拒用铁律：无贴合处境必须省略**；落地为 §1.7 **有界例外**（唯一「AI 自主写、不经逐条确认」的用户数据）+ 六条护栏；实现拆 UM-1 记忆文件与整理管线 / UM-2 接地与检索两批，排在 K2-B 之后）

> 本文档是后续所有开发的唯一依据。AI 在任何一次迭代中，必须严格按本文锁定的技术方案和接口实现，不得擅自更换技术栈、引入云端依赖、一次性做多个功能。
> 核心原则：**纯本地软件 / 最大灵活性 / 每次只实现一个最小单元 / 需求可变**。
>
> **文档结构导读（v13）：** 全文按六个关注域组织——
> **第一部分 Architecture（架构）**：技术栈、进程与模块、数据模型、接口抽象、AI 管线、FSRS 调度契约、Learner Knowledge Model 架构（v24：§4.5–§4.13）、结构连接（v33：§4.14）、插件体系（§4.15）、同源卡延后（v34：§4.16）、成长反馈呈现层（v39：§4.17）、用户记忆（v42：§4.18）。
> **第二部分 Design System（设计系统）**：瑞士风基线、Token、顶栏导航、页面排版、组件规范、皮肤体系。
> **第三部分 Product Spec（产品规格）**：核心用户流程、已实现功能规格、AI 制卡与助读体系（含提示词锁定基线与质检规则）、Topic 队列、日记模块（v36：§6.5）、成长反馈呈现规格（v39：§6.6，含正反馈分级总表）、用户记忆的可见性与设置（v42：§6.7）。
> **第四部分 Coding Rules（编码规则）**：硬性约束、数据完整性、测试义务、提示词/配置管理、安全。
> **第五部分 Decisions（决策记录）**：关键决策日志与已接受偏差。
> **第六部分 Roadmap（路线图）**：主线批次 M1–M11（v14 重排；v17 按用户构想增补 M8 日记与 AI 洞察，接下来开发的主线；v33 把 LKM 实施路线 K0–K9 整体并入 M8；v36 把 M8 拆为 M8-A 日记与快速记录 / M8-B AI 洞察；v39 定成长反馈契约并排期 M13，排在 K 系列之后；v40 定 K1 先行排期与 M8-B/K1 架构契约，M8 内部顺序改为 M8-A ✅ → K1 → M8-B → K2–K9；v42 定义 M14 用户记忆，排在 K2-B 之后）、主线状态表、历史阶段存档、可选更新池与技术债。
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
8. **知识三层分离（v24，最高不变量，设计稿 §72）：Knowledge Structure（知识之间如何关联）≠ Learner State（我掌握了什么）≠ Learning Recommendation（下一步学什么）。** AI 制卡只产出结构提案，知识状态只来自可审计学习证据，推荐只使用知识模型的派生视图——三层绝不互相冒充。
9. **知识状态可重算（v24，最高不变量，设计稿 §73）：** 所有 Learner Knowledge State 必须能从 `knowledge_evidence` + `review_logs` 原始证据按 `(modelVersion, parameterVersion)` 重新计算。禁止只存最终百分比，禁止把旧算法输出写死，禁止无证据直接写 mastery。
10. **AI 不是事实源（v24，最高不变量，设计稿 §74）：** AI 是知识结构提议者 + 候选排序器，不是数据库事实源。AI 推荐/洞察只能消费 Knowledge Model 的派生视图，不得自己重新定义用户知识状态；AI 推测的关系与判断必须标记 `source=AI-inference` + confidence，未经确认不得升级为用户事实。
8. **知识三层分离（v24，最高不变量，设计稿 §72）：Knowledge Structure（知识之间如何关联）≠ Learner State（我掌握了什么）≠ Learning Recommendation（下一步学什么）。** AI 制卡只产出结构提案，知识状态只来自可审计学习证据，推荐只使用知识模型的派生视图——三层绝不互相冒充。
9. **知识状态可重算（v24，最高不变量，设计稿 §73）：** 所有 Learner Knowledge State 必须能从 `knowledge_evidence` + `review_logs` 原始证据按 `(modelVersion, parameterVersion)` 重新计算。禁止只存最终百分比，禁止把旧算法输出写死，禁止无证据直接写 mastery。
10. **AI 不是事实源（v24，最高不变量，设计稿 §74）：** AI 是知识结构提议者 + 候选排序器，不是数据库事实源。AI 推荐/洞察只能消费 Knowledge Model 的派生视图，不得自己重新定义用户知识状态；AI 推测的关系与判断必须标记 `source=AI-inference` + confidence，未经确认不得升级为用户事实。

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
  main.js            入口：窗口、IPC 注册（50+ 通道）、bookasset/pdfres 协议、联网搜索、单实例锁
  db.js              sql.js 仓储层：17 张表（含 v36 `journal_entries`、v40 K 系列 6 表）、迁移、黄金查询、日记持久化节流钩子
  ai.js              AI 网关：配置/加密/流式/模型列表/reasoning_effort
  optimizer.js       FSRS 参数优化器（fsrs-rs-nodejs 封装）
  prompts.js         10 个提示词模板（版本化播种，当前 v3）
  quickCapture.js    v36（M8-A）：快速记录窗口单例 + 全局快捷键组（快速记录/添加学习材料）+
                     草稿-发送状态机 + 防抖持久化（唯一持久化例外，D34）
  journalTime.js     v36：日记自然日纯函数（journalDateOf；与 fsrsTime.js 同构、无依赖）
  preload.js         contextBridge：settings/window/library/workflow/cards/
                     reading/stats/issues/batches/prompts/similarity/ai/optimizer/journal/capture API
  preload-capture.js v36：捕获窗口最小桥（journalAPI 子集 + captureAPI + settingsAPI）
src/                 渲染层（React + TS）
  App.tsx            视图路由（shelf/queue/review/browse/journal/stats/reader/extractReader）
                     + 顶栏文字导航 + App 级「添加书籍」模态（v36）
  capture.tsx        v36：捕获窗口入口（capture.html；主题跟随 + CaptureEditor）
  theme.css          全部 Design Token 与组件样式（瑞士风）
  components/        Bookshelf / QueueView / ReviewView（连续刷题）/ CardBrowser / JournalView（v36）/
                     CaptureEditor（v36）/ Reader / SettingsPanel / dashboard（统计）/ Dropdown /
                     OcclusionShapes（遮挡形状渲染，复习端+确认面板共用）/
                     reader（ReaderEngine + TocSidebar + ImageFocus 图片聚焦选区）
  lib/reader/        阅读内核防腐层（v20 D20）：kernel.ts（业务唯一依赖）/ service.ts（组合根）/
                     foliate/**（全仓库唯一 foliate-js 豁免目录：adapter/selection/appearance）/ testing/fakeKernel
  vendor/foliate-js/ foliate-js 冻结快照（MANIFEST.json 记 upstream commit/本地补丁/升级规程）
  lib/               fsrs（调度封装）/ cards（CardLint+cloze+AI 制卡）/ ai（网关客户端）/
                     occlusion（图片选区几何：像素↔百分比/包围盒/形状归一化/SVG 图元）/
                     journal（v36 日记客户端 + journal/changed 事件桥）/ readingWorkflow（SM19 Provider）/
                     library / settings / eventbus / epub / stats / udc
  skins/             皮肤注册表（当前仅默认皮肤）
tests/fsrs/          FSRS 黄金参考回归套件（六件套，见 §4.4.6 / §7.3）
```

启动加载顺序（决策 D6）：`dist/index.html` 存在则 `loadFile` 直用；不存在（纯开发）才尝试 vite dev server。**多入口（v36）**：vite 构建产出 `dist/index.html` 与 `dist/capture.html`（捕获窗口 `loadFile` 后者；dev 下走 `http://localhost:5173/capture.html`）。**单实例（v36）**：`app.requestSingleInstanceLock()`——第二次启动聚焦已有窗口后退出（全局快捷键需唯一宿主；两个进程会各持一份 sql.js 内存库）。

## 4. 数据模型与接口抽象

### 4.1 数据表（23 张；另加 v42 用户记忆文件树——**非 DB 真源**，见 §4.18）

核心业务表带 `userId/updatedAt/syncVersion/isDeleted` 四件套，删除一律软删除：

- **users / library_items / documents / assets / extracts / cards / card_issues / ai_gen_batches / review_logs / fsrs_configs**（另有 review_skips）
- `cards.fsrs_json`：**全字段持久化** `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}`（§4.4.1 契约）
- `cards.fsrs_config_id`（v23）：当前 FSRS 状态**最近一次因调度写入**所用参数配置（滚动语义，非出生标签；写入规则见 §4.4.9）
- `cards.occlusion_json`：图片挖空 `{rects:[{x,y,w,h,ord}], assetPath, shapes?:[{ord,kind:rect|ellipse|polygon, …}]}`（区域与形状均为相对图片百分比坐标；**rects 恒为形状包围盒**——旧渲染与 L11 校验的兼容层，shapes 为精确轮廓：rect 用 x/y/w/h、ellipse 用 cx/cy/rx/ry、polygon 用 points[{x,y}]；图片资产入 assets 表 kind=image-occlusion，v15 补齐生成链路，v25 补手绘选区形状）
- `cards.context_ref_json`（v35）：`{documentId, extractId?, anchorText?, anchorRatio?, cfi?, chapterIndex?, pageIndex?, readerEngineVersion?, imageSource?, imageAnchor?}`——跳转原文锚点（定位体系见 §6.2 锚点体系：文本 cfi+chapterIndex+anchorText；PDF 系 pageIndex+anchorText；正文图片系 imageSource="engine"+imageAnchor{alt?, contextText?}+当前 locator；**资源库选图 imageSource="library" 且无任何定位锚——复习端隐藏跳转按钮**）
- `cards.sibling_key`（v34，§4.16）：**同源组标识**——同一制卡来源单元产出的多张卡共享同一 key（结构性同源=制卡动作内的单元键；短材料同源=来源锚点键；NULL=不参与延后）。**只服务「今日队列视图」，不参与 FSRS 调度**（调度事实仍只有 `fsrs_json`，§4.4）
- `cards.memory_ref_json`（v42，§4.18）：**记忆接地溯源（只记来源，不承担判定）**——`{itemText, itemDate, topicPath, runId, verified}`；`itemText` 是卡片情境所引记忆行的**逐字抄录**，本地只做「该文本确实存在于记忆文件中」的子串存在性校验（**不是相关性判定**），失败时 `verified=false` 并在确认面板标「情境来源存疑」；空/NULL＝该卡情境未来自记忆。不改卡面语义、不参与调度（§1.10）
- （v16 移除 `cards.reverse_json`：翻转问答卡改为创建两张独立问答卡，见 D18；已建过该列的旧库残留列无碍，新库不再建列）
- `extracts.context_ref_json`：同上（v12.3 新增，含旧库迁移）
- `cards.leech_json`：`{isLeech, suspended, suspendedAt, resolution}`
- `review_logs.fsrs_before_json`（v22）：该次评分**前**的 FSRS 全字段快照（可空——旧日志与未传快照的调用为 NULL，不可撤销）。撤销评分的数据基础。
- `review_logs`（v23 增列）：`fsrs_after_json`（评分后全字段快照，Undo 一致性校验与审计用）、`leech_before_json`（评分前 leech_json 快照——撤销时**精确恢复**而非推断，F10）、`fsrs_config_id`（本次评分所用参数配置）、`fsrs_before_config_id`（评分前状态归属配置，撤销恢复用）、`review_seq`（全局插入序，唯一索引；排序不变量见 §4.4.9）
- `fsrs_configs`（v23，D22）：**不可变调度配置快照**——`{id, algorithm('FSRS'), algorithm_version(6，算法代际非 npm 包版本), weights_json(21 维), scheduler_options_json(完整调度参数), config_fingerprint(UNIQUE), source(default|optimizer|manual), created_at}`；只增不改，活跃项由 `settings.app.fsrsConfigId` 指针指定（§4.4.10）
- `prompt_templates`：版本化提示词（当前 v3，旧版留痕）
- `journal_entries`（v36，M8-A 日记）：**流式日记条目**——`{id, user_id, entry_date TEXT('YYYY-MM-DD' 自然日), content_markdown, source('app'|'capture'), is_draft(0|1), created_at, updated_at, sent_at, sync_version, is_deleted}`。日志式追加、无强制分类/标签/双链（D19 Non-Goals）。**三条口径约定**：① `entry_date` 取**自然日**（本地钟面 00:00 切），不随 `settings.app.dayCutoffHour` 学习日切点漂移（用户 2026-09-14 拍板：切点可被用户随时改，日记归属不能因此变；将来若要「学习日视图」由 `entry_date + 时刻` 派生计算，不反向写入）；② **草稿行**（`is_draft=1`，全局至多一条）承载「未发送的快速记录」——内容随时落库（防抖持久化），按「发送」定格为正式条目（`sent_at` 落值、`is_draft` 归 0），`created_at` = 草稿首字符时刻（决定 `entry_date`，跨日续写不改变归属）；③ 条目只作为**第二输入通道**事实，不进 FSRS 队列、不产生 mastery 证据（§4.13/LKM K7 只消费其 demand 信号）。
- `knowledge_points`（v40 K1，§4.6 Layer B）：**KnowledgePoint 一等实体**——`{id, user_id, canonical_label, description, domain_id(受控一级领域，可空), parent_knowledge_point_id(可空), status('active'|'merged'|'deprecated'), merged_into(合并指向，status='merged' 时非空), alias_json(JSON 数组), language_variants_json, confidence(0-1), metadata_json, created_at, updated_at, sync_version, is_deleted}`。**KP 不属于任何一张卡也不属于任何一本书**，卡/材料/日记只是知识点的证据与载体；`canonical_label` 非唯一事实，必须配 alias；归一合并＝软删除 + 别名指向（`merged_into` + `alias_json`），可回滚可重算（§1.9）。
- `knowledge_relations`（v40 K1，§4.6 item 4）：**知识关系边**——`{id, user_id, from_knowledge_point_id, to_knowledge_point_id, relation_type(封闭 9 枚举), confidence(0-1), source('user'|'ai-inference'|'imported'|'inferred'), source_ref_json(可空：依据 span/卡片/日记引用), structure_label(仅 analogous_to：结构模式名), mapping_json(仅 analogous_to：槽位对应明细), created_at, updated_at, sync_version, is_deleted}`。**唯一约束 `(from, to, relation_type)`**；`prerequisite` 边写时无环校验（BFS 检测，建环拒绝并返回环路径——KnowledgeLint K3 在 K1 即落地，纯本地无 AI）；`analogous_to` **不参与无环约束**、不派生 due/优先级；`source='ai-inference'` 未经确认不得冒充用户事实（§1.10）。**v1 只建表：`analogous_to` 的结构匹配引擎 K9 才启用**，此前该类型仅允许手动确认入库。
- `knowledge_external_refs`（v40 K1，§4.6 item 3）：**外部 ID grounding**——`{id, user_id, knowledge_point_id, ref_kind('wikidata-qid'|'wikipedia-url'|'isbn'|'doi'|'custom'), ref_value, source_label, created_at, sync_version, is_deleted}`。外部 ID 只作 grounding，**不是事实源**；同一 KP 可挂多条。
- `knowledge_proposals`（v40 K1，§4.6 item 6）：**AI 提案暂存（staging）**——`{id, user_id, proposal_kind('point'|'relation'|'merge'), payload_json(与目标表同构的草稿), status('pending'|'accepted'|'rejected'), confidence, scope(产出该提案的提示词 scope，手动提案填 'manual'), source_run_id(insight_runs.id 可空), created_at, resolved_at, sync_version, is_deleted}`。**全部 AI 提案先进本表**（§1.7 草稿纪律），用户确认后才写入 `knowledge_points/relations` 正式表；K1 阶段生产者只有手动创建与存量迁移回填，AI 生产者随 K2 接入。
- `insight_runs`（v40 M8-B，§4.13-2/§9.1 M8-B-4）：**洞察运行记录（append-only 事实 + 反馈载体）**——`{id, user_id, range_kind('7d'|'30d'|'all'|'custom'), range_from, range_to(自然日闭区间，范围快照), entry_count(打包日记条数), entry_ids_json(打包条目 id 清单), evidence_package_json(实际发送的 Evidence Package 快照，token 审计用), model(模型标识), prompt_scope('journal-insight'), prompt_version(提示词版本), output_json(§4.13-2 结构), token_used, feedback_json(四档反馈 + 竞争解释二选 + 结构定向反馈), status('running'|'done'|'failed'|'cancelled'), error_text(可读失败原因), created_at, updated_at, sync_version, is_deleted}`。**反馈只写本表**（四档有用/部分有用/无关/不确定 + 竞争解释二选），只调 `utility` 权重、**永不写 mastery**（§4.11-5）；结构分支定向反馈（接受 / 拒绝：结构不成立｜不感兴趣｜太难）同落 `feedback_json`。
- `personal_meaning_candidates`（v40 M8-B，§4.13-3）：**Personal Meaning 第三图候选（独立候选表，D37）**——`{id, user_id, label, kind('Concept'|'Preference'|'Value'|'Interest'|'Experience'|'Question'|'Choice'), source_insight_run_id, evidence_refs_json(可点击证据链：cardId/extractId/documentId/diaryEntryId), note(用户补充), status('proposed'|'accepted'|'rejected'|'ignored'), created_at, updated_at, sync_version, is_deleted}`。AI 只提议，**用户确认（accepted）后才成事实**；确认后仍只在本表内——第三图的跨图边与 proposals 机制复用等 K 系列扩展，本表不写入任何 mastery/FSRS 字段。
- `memory_runs`（v42 M14，§4.18 / §9.1 M14（UM-1））：**记忆整理运行留痕（append-only）**——`{id, user_id, kind('ingest'|'consolidate'), trigger('auto'|'startup'|'manual'|'backfill'), covered_from_ts, covered_to_ts, entry_ids_json(本次窗口的日记条目 id 清单), entry_count, snapshot_json(整理前 core.md + index.md + 被触及主题文件全文快照，供复现与回滚判断), model, prompt_scope('user-memory'), prompt_version, output_json(AI 原始输出), applied_json(实际操作与跳过原因逐条留痕), status('running'|'done'|'failed'|'skipped'), error_text, created_at, updated_at, sync_version, is_deleted}`。**记忆正文不在本表**——本表只记录「哪一轮整理动了什么、跳过了什么」，文件本身是唯一真源（§4.18-2）；未整理水位线 `lastCoveredAt`（§4.18-16，补处理依据）由本表成功记录推进。
- **用户记忆文件树（v42，§4.18——本项目首个非 DB 的用户数据真源）**：`<userData>/memory/` 下的 `core.md`（恒定注入，≤800 字）+ `index.md`（目录，恒定注入，≤1,200 字）+ `topics/<生活域>/<主题>.md`（按需注入，单文件 ≤1,200 字）。**AI 自主维护、用户可外部编辑**（§1.7 有界例外，六条护栏见 §4.18-14）；DB 侧只留 `memory_runs` 运行留痕与 `cards.memory_ref_json` 溯源。**备份（M2）必须包含 `memory/` 目录**；遥测 / 出错一键上传白名单（§7.6）永不包含其内容（该通道与 AI 调用的区分见 §4.18-15）。
- `knowledge_points`（v40 K1，§4.6 Layer B）：**KnowledgePoint 一等实体**——`{id, user_id, canonical_label, description, domain_id(受控一级领域，可空), parent_knowledge_point_id(可空), status('active'|'merged'|'deprecated'), merged_into(合并指向，status='merged' 时非空), alias_json(JSON 数组), language_variants_json, confidence(0-1), metadata_json, created_at, updated_at, sync_version, is_deleted}`。**KP 不属于任何一张卡也不属于任何一本书**，卡/材料/日记只是知识点的证据与载体；`canonical_label` 非唯一事实，必须配 alias；归一合并＝软删除 + 别名指向（`merged_into` + `alias_json`），可回滚可重算（§1.9）。
- `knowledge_relations`（v40 K1，§4.6 item 4）：**知识关系边**——`{id, user_id, from_knowledge_point_id, to_knowledge_point_id, relation_type(封闭 9 枚举), confidence(0-1), source('user'|'ai-inference'|'imported'|'inferred'), source_ref_json(可空：依据 span/卡片/日记引用), structure_label(仅 analogous_to：结构模式名), mapping_json(仅 analogous_to：槽位对应明细), created_at, updated_at, sync_version, is_deleted}`。**唯一约束 `(from, to, relation_type)`**；`prerequisite` 边写时无环校验（BFS 检测，建环拒绝并返回环路径——KnowledgeLint K3 在 K1 即落地，纯本地无 AI）；`analogous_to` **不参与无环约束**、不派生 due/优先级；`source='ai-inference'` 未经确认不得冒充用户事实（§1.10）。**v1 只建表：`analogous_to` 的结构匹配引擎 K9 才启用**，此前该类型仅允许手动确认入库。
- `knowledge_external_refs`（v40 K1，§4.6 item 3）：**外部 ID grounding**——`{id, user_id, knowledge_point_id, ref_kind('wikidata-qid'|'wikipedia-url'|'isbn'|'doi'|'custom'), ref_value, source_label, created_at, sync_version, is_deleted}`。外部 ID 只作 grounding，**不是事实源**；同一 KP 可挂多条。
- `knowledge_proposals`（v40 K1，§4.6 item 6）：**AI 提案暂存（staging）**——`{id, user_id, proposal_kind('point'|'relation'|'merge'), payload_json(与目标表同构的草稿), status('pending'|'accepted'|'rejected'), confidence, scope(产出该提案的提示词 scope，手动提案填 'manual'), source_run_id(insight_runs.id 可空), created_at, resolved_at, sync_version, is_deleted}`。**全部 AI 提案先进本表**（§1.7 草稿纪律），用户确认后才写入 `knowledge_points/relations` 正式表；K1 阶段生产者只有手动创建与存量迁移回填，AI 生产者随 K2 接入。
- `insight_runs`（v40 M8-B，§4.13-2/§9.1 M8-B-4）：**洞察运行记录（append-only 事实 + 反馈载体）**——`{id, user_id, range_kind('7d'|'30d'|'all'|'custom'), range_from, range_to(自然日闭区间，范围快照), entry_count(打包日记条数), entry_ids_json(打包条目 id 清单), evidence_package_json(实际发送的 Evidence Package 快照，token 审计用), model(模型标识), prompt_scope('journal-insight'), prompt_version(提示词版本), output_json(§4.13-2 结构), token_used, feedback_json(四档反馈 + 竞争解释二选 + 结构定向反馈), status('running'|'done'|'failed'|'cancelled'), error_text(可读失败原因), created_at, updated_at, sync_version, is_deleted}`。**反馈只写本表**（四档有用/部分有用/无关/不确定 + 竞争解释二选），只调 `utility` 权重、**永不写 mastery**（§4.11-5）；结构分支定向反馈（接受 / 拒绝：结构不成立｜不感兴趣｜太难）同落 `feedback_json`。
- `personal_meaning_candidates`（v40 M8-B，§4.13-3）：**Personal Meaning 第三图候选（独立候选表，D37）**——`{id, user_id, label, kind('Concept'|'Preference'|'Value'|'Interest'|'Experience'|'Question'|'Choice'), source_insight_run_id, evidence_refs_json(可点击证据链：cardId/extractId/documentId/diaryEntryId), note(用户补充), status('proposed'|'accepted'|'rejected'|'ignored'), created_at, updated_at, sync_version, is_deleted}`。AI 只提议，**用户确认（accepted）后才成事实**；确认后仍只在本表内——第三图的跨图边与 proposals 机制复用等 K 系列扩展，本表不写入任何 mastery/FSRS 字段。

### 4.2 必须保留的接口/抽象（25 项，任何 Phase 不得绕过）

1. `EventBus`：唯一事实通道。锁定事件：`stats/updated, library/changed, todo/changed, pomodoro/tick, pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed, cards/changed, ai/batchDone, leech/detected`（**v36 增 `journal/changed`**：主进程日记写入后经 `journal:changed` 推送到各窗口，渲染层桥接为 EventBus 事件，日记页订阅刷新）
2. `CommandRegistry`：动作注册 `{id,title,when,keybinding}`（✅ M4 落地：`src/lib/commands.ts` + `src/lib/useCommands.ts`，§9.1 M4）
3. `SettingsStore`：三层 `app / theme / plugin.<id>`，settings.json 持久化（v48.15 / D51：书架的 `app.shelfOrder` 与 `app.shelfFolders` 也走这一层——视图组织数据入设置不入 DB，先例＝`dashboard.layout`；备份包已含 `settings.json` 故 M2 覆盖，见 §5.4）
4. `PluginHost`：`load/unload/enable/disable + contributes`（规范见 §4.15，未实现）
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
20. `SiblingQueueView`（v34，✅ 实现：`electron/db.js computeTodayQueue`）：`computeTodayQueue(now?) → {cards, deferred[]}`——**今日复习队列与「今日到期」统计的唯一口径**（§4.16 item 6）：同源卡延后、到期筛选、规范序排序全部在此函数内完成，复习页与统计/仪表盘一律消费其输出，禁止各自实现到期口径（现 `listDueCards` 的 `due ≤ now` 与 `getStatsOverview` 的 `due ≤ today24` 分叉即本项要消除的历史问题，v34 已消除并有断言锁定）
21. `JournalCapture`（v36，✅ 实现：`electron/quickCapture.js` + `electron/journalTime.js` + `electron/db.js` journal 段 + `src/lib/journal.ts` + `src/components/CaptureEditor.tsx`）：**第二输入通道的写入面**——`{ toggle() / show() / hide() / status() / flush() }`，独占三件事：① **全局快捷键组**（快速记录 `Ctrl+Alt+Space` / 添加学习材料 `Ctrl+Alt+N`，皆可改；注册失败必须可见）；② **捕获窗口单例**（常驻复用、关闭=隐藏、跨日不混稿）；③ **草稿-发送协议**（`draftSave` 防抖落库 → `draftSend` 定格为一条）。写入一律经主进程（sql.js 单实例），渲染层只持 API。**日记自动保存的持久化节流**（尾随 4s / 上限 20s + 隐藏·发送·退出强制 flush）是本项对 §7.2「每次落库即落盘」的**唯一例外**，理由与边界见 D34。
22. `GrowthReadModel`（v39，📐 规范，未实现）：**成长反馈的唯一数据面**——`growth:*` 只读 IPC 暴露 §4.17 的成长事件与派生统计（记忆层读 `review_logs` / `cards`，知识层读 K1–K4 产出），纯函数、可重算、零写路径；复习端提示、会话成果汇总、仪表盘组件、Territory 一律消费本项输出，**禁止各自实现事件判定口径**（同 §4.2-20 的口径唯一精神）。
23. `KnowledgeBase`（v40，K1 实现）：**知识地基的唯一读写面**——`electron/db.js` 仓储函数 + `knowledge:*` IPC，承载 KP / Relation / ExternalRef / Proposal 四表的 CRUD、归一合并（merge＝软删除 + `merged_into` + alias 指向，可回滚）、`prerequisite` 无环校验、生命周期（`active / merged / deprecated`）。**口径唯一**：一切 KP 检索（含 M8-B Evidence Package 的子图展开）必须经本项，禁止各组件自写 KP 查询绕过别名/生命周期语义；读侧只读 FSRS 事实（§4.12），写侧零调度字段。§4.2-24 `InsightEngine` 是它唯一的 M8 消费者。
24. `InsightEngine`（v40，M8-B 实现）：**AI 洞察的唯一编排面**——`buildEvidencePackage(range) → runInsight(package) → output / feedback / toCards`：① `buildEvidencePackage`＝本地检索打包（禁全库直发，§4.13-5）；② `runInsight`＝取 `journal-insight` 提示词模板 → LLM 流式 → JSON 解析容错 → 写 `insight_runs`；③ `feedback`＝四档 + 竞争二选 + 结构定向反馈，只写 runs 表；④ `toCards`＝「就此制卡」复用既有制卡管线 + CardLint（§4.2-18），**洞察输出直接入库**。渲染层只持 API 与展示（`InsightPanel`），禁止在组件内自拼上下文或直调 LLM。
25. `UserMemory`（v42，📐 规范，未实现；§4.18）：**用户记忆的唯一读写与检索面**——`{ read() / applyRun(ops) / selectForMaterial(materialCtx) / validateRef(draft) / reset() / status() }`，实现落 `electron/memoryStore.js`（文件树读写 + op 执行）+ `electron/memoryRetrieve.js`（纯函数：领域映射与宽召回，两侧同源 esbuild 打包进测试）+ `memory:*` IPC（`memory:status / read / maintain / selectForMaterial / reset / openPath`）。独占四件事：① **文件树是唯一真源**（`core.md` / `index.md` / `topics/<生活域>/<主题>.md`），任何组件不得自行读写记忆文件；② **整理轮执行**（精确文本匹配 + 不删不改写原则 + 手写区保护 + 预算校验，§4.18-11/12）；③ **检索装配**（Stage A 宽召回 + 目录恒定注入的注入块渲染，§4.18-7/8）；④ **溯源校验**（`validateRef` 只做子串存在性，不做相关性判定，§4.18-10）。渲染层只持 API 与展示，禁止在组件内自拼记忆上下文或直调 LLM。
23. `KnowledgeBase`（v40，K1 实现）：**知识地基的唯一读写面**——`electron/db.js` 仓储函数 + `knowledge:*` IPC，承载 KP / Relation / ExternalRef / Proposal 四表的 CRUD、归一合并（merge＝软删除 + `merged_into` + alias 指向，可回滚）、`prerequisite` 无环校验、生命周期（`active / merged / deprecated`）。**口径唯一**：一切 KP 检索（含 M8-B Evidence Package 的子图展开）必须经本项，禁止各组件自写 KP 查询绕过别名/生命周期语义；读侧只读 FSRS 事实（§4.12），写侧零调度字段。§4.2-24 `InsightEngine` 是它唯一的 M8 消费者。
24. `InsightEngine`（v40，M8-B 实现）：**AI 洞察的唯一编排面**——`buildEvidencePackage(range) → runInsight(package) → output / feedback / toCards`：① `buildEvidencePackage`＝本地检索打包（禁全库直发，§4.13-5）；② `runInsight`＝取 `journal-insight` 提示词模板 → LLM 流式 → JSON 解析容错 → 写 `insight_runs`；③ `feedback`＝四档 + 竞争二选 + 结构定向反馈，只写 runs 表；④ `toCards`＝「就此制卡」复用既有制卡管线 + CardLint（§4.2-18），**洞察输出直接入库**。渲染层只持 API 与展示（`InsightPanel`），禁止在组件内自拼上下文或直调 LLM。

### 4.3 AI 制卡执行架构

管线编排（明确**不采用内置 Agent**）：① 模式路由（detectMode 纯本地）→ ② 取提示词（PromptTemplate v3）→ ③ 上下文打包（材料+来源+已有卡+用户画像+联网背景）→ ④ LLM 流式生成（主进程，Key 不进渲染层，reasoning_content 经 thinking 信号转发）→ ⑤ JSON 解析容错 → ⑥ CardLint + 相似查重 → ⑦ 用户确认入库（AIGenBatch 留痕）。①②③⑤⑥ 渲染层毫秒级；④ 主进程；瓶颈在服务端（GLM 推理模型首字前思考 0.5-1 分钟，UI 以思考字数+秒数如实呈现）。

联网背景检索：blockReasons 非空时手动触发，Bing→DuckDuckGo→百度 回退，结果仅作理解上下文（禁止编造来源）。

### 4.4 FSRS 调度契约（硬性，v11 定；v20/v23 加固）

> **最高不变量（v23）**：同一份用户复习事实，不允许存在两套不同解释。调度事实=`cards.fsrs_json`；评分事实=`review_logs`（含 before/after 快照、config 归属、review_seq）；参数事实=`fsrs_configs` 不可变快照；时间事实=`reviewed_at`+`review_seq`；撤销事实=快照恢复。统计、优化器、审计、Undo 一律从这些事实推导，禁止各自再造解释。

1. **全量持久化**：`fsrs_json` 含 `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}` 全字段（v20 补 `learningSteps`＝ts-fsrs 学习步进索引，F7 修复——缺失会使 learning 档第 2 步的 Good 永不毕业、在 10 分钟档死循环）且下轮全量回填；禁止部分字段序列化 + createEmptyCard 兜底（兜底仅限首次创建与历史缺字段基线回填）。`elapsed_days/scheduled_days` 无需持久化（v20 源码核对结论）：前者由 last_review 与复习时刻现场重算（ts-fsrs `AbstractScheduler.init`），后者调度器只写不读，均不影响调度。
2. **fuzz 锁定 false**：预览值即算法真实值。开 fuzz 须先改本文档。注记（v23）：**false 是产品策略（预览=落库+确定性测试+审计重放），不是 FSRS 算法正确性要求**。
3. **预览与调度同源**：preview() 一次算四档完整结果（含落库状态），评分复用；「所见=所存」是验收硬条件。preview/next 均支持可选 `now` 参数（v20，默认取真实时间，渲染层行为不变）——这是 M3 时间轴模拟的时间注入机制。preview/next 均支持可选 `now` 参数（v20，默认取真实时间，渲染层行为不变）——这是 M3 时间轴模拟的时间注入机制。**过期 preview 判废（v23）**：previews 携带源卡 fsrs 引用，评分提交时源不符则现场重算，禁止复用过期预览。
4. **复习后附加动作不得改 fsrs_json**：leech 标记走字段级 `leech_json` 更新（cards:updateLeech），禁止整卡快照回写。改卡内容先取库内最新状态合并。**撤销评分（v22）是「复习回退」而非附加动作**：将 fsrs_json 恢复为该次评分的 `fsrs_before_json` 快照（全字段含 learningSteps）并移除该条复习日志——不触碰预览=落库、fuzz=false 等调度语义，属于 Anki 式标准撤销。**撤销评分（v22）是「复习回退」而非附加动作**：将 fsrs_json 恢复为该次评分的 `fsrs_before_json` 快照（全字段含 learningSteps）并移除该条复习日志——不触碰预览=落库、fuzz=false 等调度语义，属于 Anki 式标准撤销。v23 起撤销不变量升级为 §4.4.9。
5. **到期队列**：due 升序、同 due priority 降序；复习视图 30s 轮询。
6. **回归测试义务**：调度相关改动合入前 `tests/fsrs/` 六件套全绿（L0 golden / L1 adapter / L1 补强 / L2 db / L4 audit / L5 simulate 时间轴模拟（v23 增 S6 时间语义/S7 参数环境），§7.3）+ undo 套件 + persist 边界套件（v23）。
7. **参数优化器**：`fsrs-rs-nodejs` 从 review_logs 训练 21 维权重；无效样本过滤（单次复习卡/全同日卡/无跨天间隔前缀，防 Rust panic；v20/F8 补：`evaluate` 评估子集须 ≥2 条复习且末条 delta_t>0——学习/重学步同日恢复收尾的样本 evaluate 拒绝，训练不受影响，评估取可评估子集、无可用子集时指标为 null）；训练/应用/重置经 `fsrs_configs` 不可变快照 + `settings.app.fsrsConfigId` 指针（§4.4.10），delta_t 由 canonical 函数构建（§4.4.8）；手动触发；失败返回 `{ok:false}` 不阻塞调度。
8. **时间语义（v23，三概念严格分离）**：① **调度 elapsed_days**＝ts-fsrs 内部 UTC 日历日差（库内部实现，不可注入日切点）；② **优化器 delta_t**＝`calculateFsrsDeltaT(prev, cur)`（electron/fsrsTime.js 唯一出口，独立实现 UTC 日历日差，**不 import ts-fsrs**），是「锁定版本 ts-fsrs 5.4.2 时间语义的复刻，非 FSRS 永久规范」——依赖升级致 L6-A 红灯＝时间语义变更触发重新审计（预期行为非缺陷）；③ **产品学习日**＝`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0；用户钦定凌晨切点习惯，D23），**仅统计口径**（今日/热力/日聚合/月内分组），禁止进入 FSRS 调度与训练。①②同语义是本项目工程不变量（非 FSRS 规范要求），oracle=ts-fsrs `repeat()` 返回的 ReviewLog.elapsed_days 行为级对照（L6-A）。学习日（本地切点）与 FSRS 语义在本地凌晨时段的统计口径差＝产品语义选择（§8.2）。
9. **原子提交、持久化边界与 Undo 不变量（v23）**：saveReview/undoLastReview 必须 BEGIN/COMMIT 事务，COMMIT 后才 persist；**review 成功边界 = SQLite COMMIT + persist 成功 + IPC 成功**（三者齐才算成功）；措辞精度：这是**崩溃一致性**而非跨内存库与文件系统的 ACID——「review 在 SQLite 内原子提交；持久化采用原子文件替换；二者之间若进程崩溃，回退到上一次完整持久化版本，不允许产生部分/不一致的持久化数据库」。persist＝同目录 tmp + fsyncSync + renameSync 原子替换（Windows REPLACE_EXISTING），失败 throw→IPC reject→UI 错误横幅＋停留当前卡＋评分/跳过/删除封锁＋「重试保存」（`persistNow`＝**纯持久化重试，绝不重新执行任何业务 mutation**）；禁止静默降级、禁止自动 rollback 已 COMMIT 事务；全库快照自愈：任一后续成功 persist 补齐失败窗口期全部内存变更（窗口内崩溃＝丢窗口变更但一致）；启动时残留 `library.db.tmp` 一律删除（tmp 永远不是事实源）。**UndoableReview 不变量**＝review_seq 最新插入序 ∧ 有 before+after 快照 ∧ 卡当前 fsrs 与 `fsrs_after_json` **8 字段全等**（state/due/lapses/stability/difficulty/reps/lastReview/learningSteps，引用 §4.4.1）∧ 无 after 的旧日志（v22 及以前）不可撤销；leech 回退＝恢复 `leech_before_json` 确切前置状态＋关闭本次 LEECH issue，禁止以「当前 suspended」推断；config 恢复查 `fsrs_before_config_id`；**排序不变量＝review_seq**（表内唯一、按插入序单调递增、撤销删除后序号允许复用——seq 是排序非身份，身份=id；禁止按 id/reviewed_at 排序）。**config_id 写入规则**：createCard✅ / 评分✅ / 重置 FSRS 状态✅ / 编辑内容·挂起·恢复·改优先级❌ / resolveLeech 仅 reset 路径✅。
10. **参数环境（v23，D22）**：`fsrs_configs`＝不可变调度配置快照（结构见 §4.1）——**所有影响 FSRS 调度结果的 option 必须入 scheduler_options_json**（新增 option 漏快照＝契约违规）；禁止 UPDATE（db.js 不提供更新 API）；同一配置（config_fingerprint 唯一）永远只有一个 config_id；切换＝移动 `settings.app.fsrsConfigId` 指针（指针非配置本体，事实源=fsrs_configs）；reset＝指针回 cfg-default（普通不可变行，业务逻辑禁止特判，seed/migration 除外）；apply 相同配置按指纹去重重指；`cards.fsrs_config_id`＝当前状态最近一次因调度写入所用配置（滚动语义）；**应用新参数只影响未来调度，不回算任何存量卡片的 S/D/due/fsrs_config_id**；audit 按每条日志的 fsrs_config_id 分段构引擎重放（NULL→cfg-default）；`settings.app.fsrsWeights` 字段废除（存量迁移播种为 config 行后删除）；requestRetention 单一命名（对齐 ts-fsrs）；maximumInterval=36500 为产品选择非算法要求。
11. **模块边界（v23）**：运行时唯一直接 import ts-fsrs 的文件＝`src/lib/fsrs.ts`；优化器 delta_t 唯一出口＝`electron/fsrsTime.js`（独立实现，无库依赖）；业务组件禁止 import ts-fsrs、禁止自算调度或日期差。

### 4.5 Learner Knowledge Model 架构总览（v24，定稿；实现按 K0–K9 分批，见 §9.1 M8）

> 来源：桌面设计稿《学习者知识模型与自适应学习系统设计稿》（LKM §0–§87 + Insight 增补 21 节）经本会话 8 问打磨 + 双轨调优 + 一键上传合并。本节只定架构与契约，**v24 不实现任何业务功能**（K0 纯设计，见 §9.1 M8）。
> 长期循环：`阅读 → AI 识别知识结构 → Knowledge Graph → Learner Knowledge State → Learning Frontier → 下一步学习知识 → 材料匹配/AI 搜索 → 阅读/制卡/复习 → 新证据 → 状态持续更新`；第二通道 `日记 → 现实问题/需求信号 → 知识缺口 → Frontier`（M8 联动）。产品最终回答的不是"AI 觉得用户会什么"，而是"根据知识结构 + 真实长期证据，用户掌握各知识的概率有多大、下一步什么知识学习价值最高且处于可吸收挑战范围内"。
>
> 理论取位：BKT 作"隐藏状态须由行为证据持续推断"的思想与可解释概率推断基础，不照搬经典 BKT 四参数；DKT 现阶段不用作核心（Local-first、单用户初期数据不足、可解释与审计要求），浅层可解释 Bayesian/BKT-inspired（BEMM）优先，未来预测模型只作辅助不取代事实层。

### 4.6 Knowledge Ontology（知识本体，v24）

1. **UDC 退位（设计稿 §4/§71）：** UDC 只保留为统计与粗粒度分类（`cards.domain` legacy 字段 + `getStatsOverview` 口径不变），**不再作为 Learner Knowledge Graph 的事实基础**。新事实模型＝Knowledge Domain + Knowledge Ontology 双层。
2. **Layer A Knowledge Domain（粗粒度领域）：** 只回答"大致属于什么大的学习领域"，用途限导航/统计/聚合/初步检索/AI 上下文压缩/推荐过滤。建 10–15 个稳定一级领域（候选：Mathematics / Natural Sciences / Computer Science / Engineering & Technology / Medicine & Health / Social Sciences / Economics & Business / Law & Politics / Humanities / Language & Linguistics / Arts & Design / Education / Philosophy & Religion / Geography & Environment / Interdisciplinary）。二级、三级只在必要时建。一级领域不是图谱节点主体。
3. **Layer B KnowledgePoint 一等实体（设计稿 §6）：** `knowledgePointId` 从制卡批次字符串升级为独立实体——**知识点不属于任何一张卡也不属于任何一本书，卡/材料/日记只是知识点的证据与载体**。字段：`id（本地稳定主键）/ userId / canonicalLabel / description / domainId / parentKnowledgePointId? / status(active|merged|deprecated) / alias[] / languageVariants[] / confidence / metadataJson / createdAt / updatedAt / isDeleted`。`canonicalLabel` 非唯一事实，必须配 alias；外部 ID（Wikidata Q-ID / Wikipedia URL / ISBN/DOI 等）只作 grounding，放 `knowledge_external_refs`，不是事实源。
4. **Knowledge Relation（设计稿 §7；v33 扩为 9 种）：** `relationType` 封闭枚举：`prerequisite / part_of / related_to / contrasts_with / example_of / application_of / generalization_of / specialization_of` + **（v33 新增）`analogous_to`（结构类比 / 跨域同构）**。字段：`id / fromKnowledgePointId / toKnowledgePointId / relationType / confidence / source(AI|user|imported|inferred) / sourceRef? / createdAt / updatedAt`；`analogous_to` 另带 `structureLabel?`（结构模式名，如「负反馈调节」「二分对立」）与 `mappingJson`（槽位对应明细，形状见 §4.14）。唯一约束 `(from, to, relationType)`；**prerequisite 边必须无环**（KnowledgeLint K3），自循环一律 error。`analogous_to` **不参与 prerequisite 无环约束**（它描述结构对应关系，不是学习前置，也不派生任何 `due`/优先级）；`source=AI-inference` 未经确认不得冒充用户事实。**v33 放开枚举的理由与边界见 D32：`generalization_of / specialization_of` 只覆盖同域抽象层级，跨域结构对应此前无处安放。**
5. **AI metadata 封闭化（打磨 Q1，设计稿 §9–§10 收紧）：** AI 不得自由写 0–1 浮点"感觉值"。`novelty` 只许 `known|adjacent|new|uncertain` 四选一（是"相对于现有知识模型的位置判断"，不是掌握状态）；`estimatedDifficulty / learningDistance / aiConfidence` 只许写 **1–5 档序数 + 判定锚语 + 引用的原文 span/已有 KP evidence**，连续 0–1 只由本地版本化映射函数算出；`requiredPrerequisites` 是候选集合，须按 confidence/既有图谱/后续证据逐步验证；`domain` 沿用受控清单 ≤2 个。无 evidence 的 metadata 本地降级为 `uncertain`。
6. **AI 输出契约：** 制卡 JSON 保留 `{knowledgePoints, blockReasons, cards[]}` 并扩展 `knowledgeMeta{novelty, conceptualDepth, estimatedDifficulty档, requiredPrerequisites[], learningDistance档, aiConfidence档}`；**全部 AI 提案先进 `knowledge_proposals` 暂存表**（§1.7 草稿纪律），经用户确认或高置信规则确认后才入 `knowledge_points/relations` 正式表。换模型漂移用 prompt-lab"同材料 × N 模型"离散度测试守门（`novelty/relationType` 不一致率超阈则收紧锚语或降档使用）。
7. **建图策略＝混合式（打磨 Q3）：** 小而稳的 Domain 主干 seed（只定"我是谁的上一级"）+ 新材料导入时增量发现（parse → AI 抽 KP/关系候选 → 本地 n-gram 归一建议合并 → 确认/高置信自动合并）。**禁止纯现场建图**（ID 不稳定则证据无法累积、Beta 永为 cold start）。归一器第一版复用 `findSimilarCards` 的 n-gram 思路（同 Domain 内 label 相似 + 前置重叠），合并＝软删除 + 别名指向，可回滚、可重算。
8. **Knowledge Merge 生命周期（设计稿 §58–§59）：** `active / merged / deprecated`；AI 可提议合并，用户不必逐条处理；高置信自动合并，低置信留候选关系；不只依赖字符串匹配。

> **K1 落地细化（v40，D37）**：① **环检测先行**——`prerequisite` 无环校验（KnowledgeLint K3）在 K1 即实现为**纯本地写时校验**（BFS 检测，建环拒绝并返回环路径），不等 K2 的 AI 提案管线；② **`analogous_to` 只建表**——v1 允许该 relation_type 入库但结构匹配引擎（槽位映射生成）K9 才启用，此前只有手动确认路径；③ **旧字段迁移**——`cards.knowledge_point_id / cards.domain` **不删列不改语义**（存量制卡链路照旧），K1 起由 `KnowledgeBase` 在读取侧提供「旧 KP 字符串 → 别名候选 → 正式 KP」的归一建议（回填 `knowledge_proposals`，用户确认后成正式 KP），存量语义零风险；④ **归一器**——第一版复用 `findSimilarCards` 的 n-gram 思路（同 Domain 内 label 相似 + 前置重叠），merge 操作＝被合并 KP 软删除 + `merged_into` 指向 + alias 并入，**可回滚**（恢复 status=active + 清 merged_into + alias 还原）；⑤ **管理面最小化**——K1 只交付 KP 最小管理页（搜索/合并确认/别名查看）+ 卡片浏览行详情 KP 别名显示，完整图谱 UI（K8）与 staging 确认流（K2）不在本批。

> **AI 抽取归一硬性规范（v41，D38，K2-A 三层确定性架构）**：**背景**——用户实测 K1 本地归一建议不可决策：AI 制卡写入 `cards.knowledge_point_id` 的是**每批材料内部的簇编号（kp1/kp2…）**，同一字符串在不同材料间必然碰撞（A 书的 kp1 与 B 书的 kp1 无关），且字符串匹配无内容感知（D29 同局限）。故引入 AI 抽取，但 AI 的漂移风险用**架构**压制而非提示词祈祷——分三层，**AI 只居中间层，进出两端都是确定性本地代码**：
> 1. **本地规范化收敛（入层）**——`normalizeKpLabel`（NFKC + 去标点空白 + 大小写折叠）产出 `normKey`；**同一 normKey 全库至多一个 active KP**（归一器与裁决器共同保证）；AI 无论跑多少次，同名永远收敛到同一行。
> 2. **AI 只输出提案（中层，封闭契约）**——AI 输出项形状 `{clusterKey, canonicalLabel, aliases[], domain[], description, action:'link'|'create'|'skip', targetKpId?, confidence:1-5, evidence}`（关系项另见 `knowledge-relation` scope）；**禁止 AI 生成任何 ID**（targetKpId 必须取自输入候选清单，越界即降级为 create/pending）；**evidence 必须原文引用输入中给出的卡面片段**，无依据降 uncertain；domain 越界（非 UDC 受控清单）本地置空。
> 3. **本地裁决器（出层，结果与 AI 跑几次无关）**——① normKey 精确命中已有 KP（canonical 或 alias）→ **确定性自动归一**（该旧簇值并入目标 KP 别名，落一条 `auto:true` 的已接受提案留痕，不产生待办）；② AI 新名与已有 KP 撞 normKey → **强制转 link**（AI 不可能制造重复 KP）；③ 同一 run 内多个簇归一后同名 → 合并为一条提案（`clusters[]` 数组）；④ 一个簇同时匹配多个目标 / AI 目标 id 越界 → 一律 pending 不自动；⑤ 关系端点必须是输入候选清单内的 KP id 或本 run 的簇键；prerequisite 建环的 AI 关系**本地直接丢弃并留痕**（KnowledgeLint K2/K3）；⑥ 其余 create/merge/relation → pending 提案。
> 4. **幂等键**——提案指纹 `fingerprint = sha1(kind + clusterKey/端点对 + action + normKey)`；同指纹提案（**任何状态**，含已拒绝）已存在 → 跳过不再生成。「同一批存量数据重复点 AI 整理 = 零新增、零变化」由指纹 + 规范化 + 裁决器三者共同保证。**已拒绝的提案永不重提**（用户否决即事实）。
> 5. **批次簇键（跨材料碰撞解绑）**——簇键 `clusterKey`：新制卡（v41 起 AI 制卡落库写入 `cards.gen_batch_id`）＝`batch:<genBatchId>:<knowledgePointId>`；存量卡（gen_batch_id 为空）＝`doc:<documentId>:<knowledgePointId>`（同一本书内同簇同批）；无锚点卡＝`legacy:<knowledgePointId>`。**同一簇 = 同一制卡动作内的一段材料**，跨书同名簇不再混组。
> 6. **最小输入窗口**——每次只喂「尚未归一的簇」+「相关候选 KP 清单（cap 60）」，已归一事实不进输入（AI 看不到就不可能推翻）；已 accepted 的提案对应簇不再入队。
> 7. **漂移守门**——temperature 固定 0.1、提示词 scope 独立版本化、prompt-lab「同材料 × N 次」离散度测试（§4.6 item 6 既定）；模型换版不改变本地三条裁决规则。
> 8. **触发与确认（用户 2026-09-15 拍板）**——触发＝**制卡顺带**（卡片接受入库后台静默跑一轮，不阻塞不弹窗，无 Key 静默跳过）+ **手动批量**（知识点页签「AI 整理」按钮，处理全库存量待归一簇）；确认＝**提案制 + 一键全接受**（高确定性项自动归一免确认，新建/合并/关系进提案列表，支持逐条或一键全部接受；§1.7 AI 输出须确认才入正式表的红线不变）。
> 9. **红线不变**——AI 永不写 `fsrs_json / review_logs / knowledge_evidence / learner_knowledge_states`；只产 `knowledge_proposals` 与「确定性自动归一」两类写；关系与 KP 永不派生 due/优先级。

> **AI 抽取归一硬性规范（v41，D38，K2-A 三层确定性架构）**：**背景**——用户实测 K1 本地归一建议不可决策：AI 制卡写入 `cards.knowledge_point_id` 的是**每批材料内部的簇编号（kp1/kp2…）**，同一字符串在不同材料间必然碰撞（A 书的 kp1 与 B 书的 kp1 无关），且字符串匹配无内容感知（D29 同局限）。故引入 AI 抽取，但 AI 的漂移风险用**架构**压制而非提示词祈祷——分三层，**AI 只居中间层，进出两端都是确定性本地代码**：
> 1. **本地规范化收敛（入层）**——`normalizeKpLabel`（NFKC + 去标点空白 + 大小写折叠）产出 `normKey`；**同一 normKey 全库至多一个 active KP**（归一器与裁决器共同保证）；AI 无论跑多少次，同名永远收敛到同一行。
> 2. **AI 只输出提案（中层，封闭契约）**——AI 输出项形状 `{clusterKey, canonicalLabel, aliases[], domain[], description, action:'link'|'create'|'skip', targetKpId?, confidence:1-5, evidence}`（关系项另见 `knowledge-relation` scope）；**禁止 AI 生成任何 ID**（targetKpId 必须取自输入候选清单，越界即降级为 create/pending）；**evidence 必须原文引用输入中给出的卡面片段**，无依据降 uncertain；domain 越界（非 UDC 受控清单）本地置空。
> 3. **本地裁决器（出层，结果与 AI 跑几次无关）**——① normKey 精确命中已有 KP（canonical 或 alias）→ **确定性自动归一**（该旧簇值并入目标 KP 别名，落一条 `auto:true` 的已接受提案留痕，不产生待办）；② AI 新名与已有 KP 撞 normKey → **强制转 link**（AI 不可能制造重复 KP）；③ 同一 run 内多个簇归一后同名 → 合并为一条提案（`clusters[]` 数组）；④ 一个簇同时匹配多个目标 / AI 目标 id 越界 → 一律 pending 不自动；⑤ 关系端点必须是输入候选清单内的 KP id 或本 run 的簇键；prerequisite 建环的 AI 关系**本地直接丢弃并留痕**（KnowledgeLint K2/K3）；⑥ 其余 create/merge/relation → pending 提案。
> 4. **幂等键**——提案指纹 `fingerprint = sha1(kind + clusterKey/端点对 + action + normKey)`；同指纹提案（**任何状态**，含已拒绝）已存在 → 跳过不再生成。「同一批存量数据重复点 AI 整理 = 零新增、零变化」由指纹 + 规范化 + 裁决器三者共同保证。**已拒绝的提案永不重提**（用户否决即事实）。
> 5. **批次簇键（跨材料碰撞解绑）**——簇键 `clusterKey`：新制卡（v41 起 AI 制卡落库写入 `cards.gen_batch_id`）＝`batch:<genBatchId>:<knowledgePointId>`；存量卡（gen_batch_id 为空）＝`doc:<documentId>:<knowledgePointId>`（同一本书内同簇同批）；无锚点卡＝`legacy:<knowledgePointId>`。**同一簇 = 同一制卡动作内的一段材料**，跨书同名簇不再混组。
> 6. **最小输入窗口**——每次只喂「尚未归一的簇」+「相关候选 KP 清单（cap 60）」，已归一事实不进输入（AI 看不到就不可能推翻）；已 accepted 的提案对应簇不再入队。
> 7. **漂移守门**——temperature 固定 0.1、提示词 scope 独立版本化、prompt-lab「同材料 × N 次」离散度测试（§4.6 item 6 既定）；模型换版不改变本地三条裁决规则。
> 8. **触发与确认（用户 2026-09-15 拍板）**——触发＝**制卡顺带**（卡片接受入库后台静默跑一轮，不阻塞不弹窗，无 Key 静默跳过）+ **手动批量**（知识点页签「AI 整理」按钮，处理全库存量待归一簇）；确认＝**提案制 + 一键全接受**（高确定性项自动归一免确认，新建/合并/关系进提案列表，支持逐条或一键全部接受；§1.7 AI 输出须确认才入正式表的红线不变）。
> 9. **红线不变**——AI 永不写 `fsrs_json / review_logs / knowledge_evidence / learner_knowledge_states`；只产 `knowledge_proposals` 与「确定性自动归一」两类写；关系与 KP 永不派生 due/优先级。

> **K1 落地细化（v40，D37）**：① **环检测先行**——`prerequisite` 无环校验（KnowledgeLint K3）在 K1 即实现为**纯本地写时校验**（BFS 检测，建环拒绝并返回环路径），不等 K2 的 AI 提案管线；② **`analogous_to` 只建表**——v1 允许该 relation_type 入库但结构匹配引擎（槽位映射生成）K9 才启用，此前只有手动确认路径；③ **旧字段迁移**——`cards.knowledge_point_id / cards.domain` **不删列不改语义**（存量制卡链路照旧），K1 起由 `KnowledgeBase` 在读取侧提供「旧 KP 字符串 → 别名候选 → 正式 KP」的归一建议（回填 `knowledge_proposals`，用户确认后成正式 KP），存量语义零风险；④ **归一器**——第一版复用 `findSimilarCards` 的 n-gram 思路（同 Domain 内 label 相似 + 前置重叠），merge 操作＝被合并 KP 软删除 + `merged_into` 指向 + alias 并入，**可回滚**（恢复 status=active + 清 merged_into + alias 还原）；⑤ **管理面最小化**——K1 只交付 KP 最小管理页（搜索/合并确认/别名查看）+ 卡片浏览行详情 KP 别名显示，完整图谱 UI（K8）与 staging 确认流（K2）不在本批。

### 4.7 Knowledge Evidence 与 BEMM（v24，设计稿 §11–§21 收紧）

1. **FSRS 管记忆、LKM 管能力（设计稿 §13/§53）：** `FSRS = Card-level memory state`（这张卡记得怎么样），`LKM = Concept-level competency state`（这个知识点整体掌握到什么程度）。单卡 stability 高只证明该卡信息保持好，**不得直接断言 KnowledgePoint mastered**。四问分离：这张卡何时复习 / 用户懂什么概念 / 下一步学什么 / 用什么材料——各由 FSRS / LKM / Frontier / Material 模型回答。
2. **五维状态（设计稿 §11–§12）：** 每 KP 每维度一个 Beta 后验 `Mastery ~ Beta(α,β)`，`estimate=α/(α+β)`，同时存 `confidence + evidenceCount + lastEvidenceAt`。五维：`recognition（识别判断）/ recall（无提示主动回忆，主源 QA/Cloze/FSRS）/ conceptualUnderstanding（关系机制，主源 why/how·解释·对比·因果卡）/ application（解决实际问题，禁由纯背诵卡推断）/ transfer（迁移新情境，最高层证据）`。存 `(alpha,beta)` 全量，**禁只存百分比**；UI 显示 `developing / functional / strong / uncertain` 四态，算法用连续值。
3. **知识状态持续演化、无永久标签（§20–§21）：** 长期无证据 → confidence 下降 → 回 `uncertain`；**禁简单复制 FSRS 遗忘曲线**（FSRS 管记忆项目，mastery 是高层能力估计，半衰期独立参数化）。
4. **BEMM v1（设计稿 §14）：** 第一阶段用项目自研 Bayesian Evidence Mastery Model（BKT 思想 + 连续状态 + 多维 evidence），不是经典 BKT。输出形如 `estimate=0.73, confidence=0.81, evidence=18`——同 estimate 下 evidence=2 与 30 完全不同，Frontier 必须同时看 estimate 与 confidence（§15）。
5. **证据权重矩阵＝可配置 defaults（§16）：** Recognition/Cloze/QA/Explain/Application/Transfer 六行 × Recall/Understanding/Application/Transfer 四列初始值只作 v1 默认，**禁作科学常数**，全部进 `lkm_configs.params_json` 待校准。
6. **Review Evidence 投影（§17）：** Again/Hard/Good/Easy 先转 memory evidence，再按 `cardType + KP + review上下文 + FSRS 状态（stability/距上次时间/难度/是否提示/同质重复/跨卡泛化）` 投影到能力维度；**禁把 Good 直接等于 mastery 上涨**。防刷卡：`reliability = 基础权重 × reviewOutcomeStrength × itemSpecificity × independence`（§18）——连续同质卡全 Good 的 independence 打折；同 KP 上 recall+explain+application+transfer 均成功则 strength 极高。
7. **Bottleneck 聚合防刷满（§19）：** 总体分用短板聚合（如 min 或调和平均），禁简单平均——`understanding=0.84, application=0.42, transfer=0.20` 时总体不得 0.9。
8. **分层证据策略（打磨 Q2，否决强制周测）：** ① 日常复习投影（低权重）；② **dimension 探针卡**（复用 `application` 卡类型 + `dimension` 标签，新情境出题非原题重问，独立 `knowledge-probe` 模板经测试台播种；评分仍用四档，落库记高 independence 证据；探针卡本身是普通卡，独立 FSRS 状态，D18 合规）；③ **Frontier Check 按需触发**（仅 `recall/understanding ≥ functional` 且高层证据不足、`evidenceNeed` 高时提议 1 道应用/迁移小任务，可做可不做、不惩罚）。结果记 `probe_runs`，探针卡复习日志照常进 FSRS 并另派生一条 `knowledge_evidence(sourceId=probe_run_id)`。
9. **evidence 表（§44–§46）：** `knowledge_evidence` append-only：`id / knowledgePointId / sourceType(card_review|probe|application_task|reading|diary_signal|user_confirm|ai_inference) / sourceId（review_log_id 或 probe_run_id，只存引用不复制日志）/ dimension / outcome(0-1) / strength / reliability分解 / observedAt / modelVersion(LKM-vN) / parameterVersion / cardType+FSRS快照引用`。链路 `review_logs → Evidence Projection → knowledge_evidence → learner_knowledge_states`；FSRS 仍是唯一复习事实源（§4.4 最高不变量）；`ai_inference` 只作结构推断证据，禁冒充 mastery evidence。`card_knowledge_points` 允许多 KP 归属（主 KP 保留 + `secondaryKnowledgePointIds[]`）；拒收的卡不产生 evidence，接受的卡才建/链知识。
10. **重算能力（§47–§48）：** `knowledge evidence + model version` 可重算全部状态；算法结构变 bump `LKM-vN`，纯参数变 bump `parameterVersion`，双版本并行。
11. **结构假设不产 mastery 证据（v33）：** `analogous_to` 关系与结构驱动入口（§4.14）只产**结构推断**，按 item 9 的 `ai_inference` 口径处理——只作结构证据，**禁冒充 mastery evidence**。结构入口给用户的是「切入点」，真正改变掌握状态的仍是随后实际学习产生的 `reading / card_review / probe / application_task` 证据；初步认知模型的 confirm/refute 判定必须基于这些真实证据，**不得用「用户当时接受了推荐」充当证据**。

> **探针卡契约 v44 修订（用户 2026-09-17 拍板；K3 实现时按本 blockquote 执行，与上方 item 8 ③「Frontier Check 按需提议、可做可不做」冲突处以本节为准）**
>
> 1. **动机（用户洞察）**：请求制探针下用户可永远拒绝 → 应用/迁移维度永远没有证据 → 掌握度无法更新、前沿推进停滞。同时**探针题首次出现在用户面前时对掌握度的证明力最强**——一旦进入复习队列被反复记忆，就会形成机械记忆，对掌握程度的反映随重复次数递减直至无效。两条合起来要求：探针必须是**队列义务**而非可选拦路题，且证据必须**一次性**。
> 2. **前沿探索开关**：`settings.app.frontierExploration.enabled`，**默认关闭**。关闭＝零探针生成与入队（掌握度只靠日常复习投影（低权重），前沿对高层证据不足的 KP 以 `evidenceNeed` 标注「待验证」，不阻塞其余推荐）；开启＝探针卡按本节混入复习队列，为队列义务（无跳过；不适用 `w` 跳过与 `review_skips`），设置页须说明开启后探针会出现在复习中。
> 3. **免逐张预确认（§1.7 有界例外，登记 §8.2）**：K3 引擎按触发条件（`recall/conceptualUnderstanding ≥ functional` ∧ 高层证据不足 ∧ `evidenceNeed` 高，同 item 8 ③）后台生成探针并**直接以真实卡行入队，不经逐张预览确认**——人工闸门后置到首评（见 item 5）。护栏：① 只消费本节触发条件、宁缺毋滥（单 KP 同时至多 1 张待答探针）；② 背面首评即质量评判（不接受即作废退役）；③ 每轮生成落 `probe_runs` 留痕（可审计可复现，§1.9）；④ 探针永不写 FSRS 调度字段之外的 LKM 越权写（§4.12 不变）。
> 4. **混队呈现**：探针卡正面与普通卡**完全无区别**（防预期效应污染首次作答）；翻到背面才出现探针标识 + 新情境题的参考要点（idealAnswerPoints）+ 四档自评（Again/Hard/Good/Easy 心智，评分照常走复习管线写 `review_logs`）。探针卡不建 `sibling_key`、不参与同源延后。
> 5. **首评质量评判（后置人工闸门）**：首次评分时同屏要求用户评判「这张探针是否有效反映了我对该知识点的掌握」——**接受 / 不接受**（原因枚举：情境不贴合 / 题面跑题 / 过易 / 过难，可跳过原因）。不接受 → 该次 `knowledge_evidence` **不生成**（或生成即标 invalid）、探针卡 suspend 退役、`probe_runs` 标 `rejected` 并留原因，反馈用于抑制同类探针（同 K2-A「已拒绝永不重提」的指纹精神，指纹含 dimension + 情境结构特征）。
> 6. **一次性证据原则（本修订核心）**：探针的 mastery 证据**只取首次作答**（满权重、高 independence）；**该卡后续的任何复习都不再产生掌握度证据**——重复复习同一探针测的是「对这道题的记忆」而非能力，其证明力随重复递减。探针测**能力**（competency）、FSRS 测**保持**（retention），职责分离。
> 7. **卡片去向按质量评判分流（v44 同日修订，用户 2026-09-17 拍板）**：质量评判为**接受** → 探针卡**保留为一张普通卡**，正常进入 FSRS 队列间隔重复（用户判断：新情境考察题本身有记忆价值）；其后续复习照常写 `review_logs` / FSRS，只是**不再派生任何 mastery 证据**（evidence 只与首评绑定）。质量评判为**不接受** → 卡 suspend 退役留审计（item 5 语义不变）。两种去向都**不影响**「后续前沿检查为同一 KP 生成全新情境的新探针」——`knowledge-probe`「禁原题重问」随之升级为**禁跨探针情境复用**（同一 KP 历史探针情境入禁用清单，随 K3 落地）。
> 8. **撤销联动**：undo 首评（v22 语义物理删日志）→ 该探针的 evidence 级联失效（§4.12-3 既有语义）、`probe_runs` 标 undone；卡片去向跟随质量评判——**已接受的恢复为普通卡参与调度**（FSRS 状态由快照恢复，v22 语义天然支持），**不接受的保持退役不复活**（拒绝是用户显式判断，不因撤销复活）；同 KP 的下一次探针照常生成全新情境（首遇纯度不可恢复，不重放旧题）。
> 9. **记忆接地**：application/transfer 维度探针按 §4.18-9 R20 v44 原则注入用户记忆（情境措辞专用，R20 全部铁律与 `memoryRef` 溯源适用）；`knowledge-probe` 模板届时升 v2（记忆块注入 + `memoryRef` + 背面揭示所需字段），先 prompt-lab 验证再播种（M1 纪律）。

### 4.8 Learning Frontier（v24，设计稿 §22–§25）

1. **定义：** 与已掌握知识充分关联、前置基本满足、尚未充分掌握、挑战处于可吸收范围的知识候选集。是 `Ready enough + Novel enough + Connected enough + Challenging enough + Useful enough` 的交集，不是"最难的"也不是"最新的"。
2. **候选分：** `readiness（前置掌握）× novelty（未知度）× connectivity（与既有图谱连接，孤立新领域降权）× challengeFit × utility（目标/阅读史/日记/主题/用户选择/近期关注）× evidenceNeed（confidence 低则值得验证）`。
3. **Challenge Fit：** challenge＝内容难度 + 前置缺口 + novelty + 密度 + 抽象度 + 任务要求；能力＝前置 mastery + 近期表现 + 阅读理解证据；映射到 `comfortable / growth / stretch / too_hard` 四档（初始阈值可配，后续按表现自动校准）。**不用固定 i+1**。desirable difficulties 有边界条件，过高认知负荷损害学习。
4. **两类入口（v33 增补，完整定义见 §4.14）：** 候选生成有两条通路——**入口 A 前置驱动**：现行六因子评分，`readiness` 主导，适用于既有领域内的下一步；**入口 B 结构驱动**：由 `structureFit（与已持有知识结构的对应强度）` 主导的**探索性**候选，允许在**前置缺口存在**时推荐用户未接触过的领域（`readiness` 低不再等于判死）。入口 B 放宽的是**候选生成与 `connectivity` 口径**——`connectivity` 语义就此分拆为「前置连接」与「结构连接」两类，**结构连接不得冒充前置满足**；入口 B **不豁免**该领域后续必要的前置，推荐时仍须标注主要前置缺口并给出「结构切入后如何补前置」的路径，进入后的学习路径仍由常规 Frontier 接管。入口 B 必经 §4.14 的三道闸门与护栏，且只作探索性建议、须用户确认。
5. **RL 延后（§64）：** 先解决"状态如何正确估计"，再谈策略优化。

### 4.9 Material Knowledge Profile 与推荐（v24，设计稿 §26–§32）

1. **材料画像：** 每份材料存 `knowledge coverage（KP→覆盖度）+ prerequisiteGap + conceptDensity + estimatedDifficulty + estimatedChallenge + completionStatus`；难度分解 `conceptualDifficulty / languageDifficulty / prerequisiteDifficulty / density / applicationDemand / transferDemand` 六维（语言学习场景下语言难与概念难可反向）。
2. **候选池：** 未读 + 阅读中 + 读完 + 摘录 + 用户导入（PDF/EPUB/TXT/Markdown/Word）+ 联网新材料。导入时走 profiling 管线（parse → 语义分析 → KP/关系抽取 → 难度估计 → 落库），推荐时直接查。**（v33）** 结构驱动候选（§4.14）还要「用户未接触过的领域」，该来源在 K6 联网发现落地前**只能从已导入未读材料或用户手动提供的材料中生成**，禁凭空列举领域与书目。
3. **两阶段推荐（禁每次全库扫）：** Stage A 本地候选生成（状态/完成度/难度/偏好/Frontier 快筛）；Stage B AI 只重排候选，输出 `reason / knowledgeCoverage / nextConcepts / expectedChallenge`（**v33：** 结构驱动候选另须输出 `structureMapping`，见 §4.14）。联网材料不得直成事实，须经 AI 分析 → 本地元数据 + 来源记录。
4. **推荐解释：** 展示可验证数据依据（已掌握 X / 当前 Frontier Y / 本书覆盖章节 / 新知识占比 / 预计挑战档 / 前置缺口），不展示模型隐藏推理链。排序长期演化（规则 → 贝叶斯校准 → 上下文排序 → bandit → 个性化序列），但候选事实永远来自本地 Knowledge Model。**推荐理由三类（v33）：** `knowledge-driven`（前置/缺口驱动，既有领域内的下一步）／`meaning-driven`（日记与现实需求驱动，§4.13）／**`structure-driven`（结构连接驱动，§4.14）**；第三类必须同时给出「结构相似之处（槽位映射表）」与「至少一条主要差异」，禁只给结论。
5. **AI 上下文压缩（§61）：** 发给 AI 的不是全库，而是本地检索的 `当前材料 + Relevant Subgraph + Learner State 摘要 + Current Frontier + 相关材料 + 相关日记信号`（**v33：** 结构驱动场景另加 `已持有结构子图`——构成该结构的 KP + 关系边，作为槽位映射的 A 侧依据）。

### 4.10 Knowledge Graph 可视化与生成动画（v24，打磨 Q4，设计稿 §33–§35）

1. **图谱首先是检索引擎**（检索/路径规划/推荐/关联与缺口发现），视觉只是表现层。节点含 Material / Card / DiaryEntry / LearningSession，核心边 `part_of / related_to / introduced_by / reviewed_by / supported_by / mentioned_in / motivated_by`。
2. **Obsidian 式规格（K0 只定规格不实现）：** 2D canvas 力导图（非 3D），子图限流（默认 ≤200 节点，只画 Relevant Subgraph）；节点大小＝evidenceCount，颜色＝四态，边型＝relationType，边透明度＝confidence，`source=AI` 用虚线标非事实；点节点出证据链（KP → Cards/Extracts/Diary/Sources + estimate/confidence/evidence）。面板走瑞士风 Token。**（v33）** `analogous_to` 跨域结构边按 `source=AI` 虚线绘制，可叠加/切换显示「结构连接」层——与「前置/证据」层共处一张图但语义分离（结构边不承载掌握度、不进入 Frontier 的前置判定，仅作检索与解释线索）。
3. **生长动画＝真实回放（K8 验收）：** 推荐/洞察管线 emit 阶段事件（扫描 N 节点 → 发现 M 缺口 → 筛出 K 可学 → 检查 X 份材料 → 推荐 Y），UI 按事件逐批淡入/连边生长；**禁无数据的假扫描动画**。同理 Insight Evidence Trail（概念信号 → 检索 → 图遍历 → 证据 → 竞争解释 → 组装）须由 `insight_runs` 真实计数字段驱动。

### 4.11 LKM 双轨调优（v24，打磨 Q5/Q7/Q8 + 开发者轨）

1. **共用底座（仿 D22）：** `lkm_configs{id, modelVersion(LKM-vN), parameterVersion, params_json(§4.7 的全部待校准参数：先验/权重矩阵/guess-slip/reliability/Bottleneck/Frontier 权重/挑战阈值/衰减半衰期), config_fingerprint UNIQUE, source(default|user_trained|dev_candidate), createdAt}` + `settings.app.lkmConfigId` 活跃指针。只增不改，切换只移指针，apply 指纹去重，reset 回默认，失败 `{ok:false}` 不阻塞复习。
2. **Track A 用户本地优化器（仿 optimizer.js 四步）：** `buildLkmTrainSet → train → evaluate(可评估子集) → apply/reset`；目标是**预测下一次同 KP 任务成功概率**（Brier/Calibration/AUC，§49–§50），禁拟合 mastery 本身；小数据用 Beta-Binomial MLE/网格搜索，纯 JS 本地算子，**禁复用 `fsrs-rs-nodejs`**（FSRS 专用）。主观感受不进目标函数。
3. **Track A 数据门（必须设门）：** 全局校准门 `knowledge_evidence ≥ 150 条 ∧ 覆盖 KP ≥ 20 ∧ 每 KP ≥ 3 条独立证据 ∧ 时间跨度 ≥ 21 天 ∧ application/transfer 探针 ≥ 10 条`，未达标按钮置灰并显示 `已积累 n/m`，用默认参数 + 全员 `uncertain` 宽 Beta；单 KP 永远可推断但证据不足只给低 confidence（Frontier 以 `evidenceNeed` 排成"待验证"）。训练输入同样过滤单证据/全同日/无跨天前缀（F8 教训）。
4. **Track B 开发者默认参数优化：** 主力＝仿真轨迹库（K3–K5 的 Good/Good/Again/Application/Transfer、同质刷卡、前置缺失序列）+ LKM 实验台旋钮（证据投影/Bottleneck/Frontier 六因子可调，跑同一批仿真比 Brier 与排序）+ 专家先验；辅力＝自愿匿名聚合（独立 `app.lkmCalibrationConsent`，默认关，与 telemetryConsent 分离；只收 `date / LKM 与参数版本 / evidence 与 KP 与探针计数 / Brier 分箱 / 接受率·读完率·挑战与反馈分布`，**禁 diary/cards 原文、禁 KP label 原文、禁 book title**）。无聚合数据照样发版（默认参数标注"基于仿真+先验"）。候选默认以 `dev_candidate` 行播种、小批本地前后对比验证后转正；结构变升 `LKM-vN`，纯参数变升 `parameterVersion`。
5. **用户感受位置（打磨 Q7）：** 客观校准（调 Beta/权重）只看下任务成功率；主观反馈（Insight `有用/部分有用/无关/不确定` + 竞争解释二选，推荐 `接受/打开/读完/放弃 + 挑战四档 + 有用度`）只调 `utility` 权重与 `challengeFit` 阈值，存 runs 表 feedback 字段；用户拒掉的解释永不再当事实。两者分开记、分开评，禁满意度污染能力估计。**（v33）** 结构驱动推荐另记定向反馈：`接受（开始收集该领域材料）/ 拒绝（结构不成立｜不感兴趣｜太难）`——「结构不成立」回填并降权/失效该结构模式（`analogous_to` 候选），是修正结构匹配器的主要监督信号（§4.14）；「不感兴趣/太难」只调 `utility` 与 `challengeFit`。

### 4.12 LKM 与 FSRS 隔离边界（v24，打磨 Q6，硬性）

1. **读：** LKM 只读 `cards.fsrs_json`、`review_logs`（before/after/leech_before/config/review_seq 全套）、`cards.fsrs_config_id`；订阅 `COMMIT + persist + IPC` 成功之后事件，review 成功绝不等 LKM。
2. **写：** LKM 只写自有表 + `lkm_configs` 指针。**禁写 `fsrs_json / leech_json / fsrs_config_id / review_logs / priority / due`**；探针用独立 `probe_runs` 队列，不碰 due 队列与 30s 轮询。
3. **撤销联动：** `undoLastReview` 物理删日志后，派生 evidence 级联失效或标 stale 后台重算，绝不阻塞 undo 事务本身。
4. **回归：** 任何 LKM 相关改动合入前重跑 `tests/fsrs/` 六件套 + undo + persist；`src/lib/fsrs.ts` 唯一 import ts-fsrs、`electron/fsrsTime.js` 唯一算 delta_t 的边界（§4.4.11）保持不变。

> **v44 注记（探针入队方式修订，§4.7 v44 blockquote 为准）**：item 2 的「探针用独立 `probe_runs` 队列，不碰 due 队列」修订为——**生成调度与留痕**仍归 `probe_runs`，但**入队展示复用普通复习队列**（探针卡以真实卡行混入、正面无区别，前沿探索开关开启时为队列义务）；「禁碰 due 队列」的本意（LKM 不改写既有卡片的调度字段）不变——探针卡是新建独立卡行，其 `due` 由建卡时一次性设定，**LKM 永不改写任何卡（含探针卡）的 `fsrs_json / leech_json / fsrs_config_id / due / priority`**；探针首评后按质量评判分流——接受＝转普通卡正常 FSRS 调度（后续复习不再派生 mastery 证据），不接受＝suspend 退役（§4.7 v44 blockquote item 7）。

### 4.13 Insight 与 Personal Meaning Graph（v24，设计稿增补 §1–§21）

1. **Insight 产品定义：** 不止找知识缺口，更帮用户发现未明确意识的思想/兴趣/价值/选择模式，用已学知识作解释框架。输出 `Hypothesis / Alternative Interpretation / Knowledge Connection / Question`，不定确定性结论。
2. **三层证据：** `FACT（Diary/Reading/Card/Review/Extract/反馈原文，AI 不得改）/ LEARNED（KP/关系/摘录/卡/书/来源，须可追溯）/ INFERENCE（AI 假设类比模式理论映射，须标推测）`。Insight 输出结构 `{observation[], knowledgeLinks[], interpretations[{claim, type=hypothesis, evidence[], confidence}], alternativeInterpretations[], questions[], uncertainties[]}`，每条解释须引 `knowledgePointId / extractId / cardId / documentId` 可点击证据链。
3. **Personal Meaning Graph：** 独立于 World Knowledge 与 Learner Knowledge 的第三张图，节点 Personal Concept/Preference/Value/Interest/Experience/Question/Choice；AI 只提议 Personal Concept（如 Discipline/Autonomy/Curiosity），用户可确认/拒绝/编辑/忽略，确认后才成事实。三图可跨图建边，禁合并。
4. **竞争解释与边界：** 涉价值观/倾向的 Insight 默认 ≥2 个竞争解释防确认偏误；心理/哲学解释只许 `could / one possible interpretation / consistent with / resembles`，禁下病理与人格断言。
5. **知识库四层与检索：** KP+关系 / 证据记忆（卡+摘录+复习+阅读）/ 个人思想记忆（日记+反馈）/ 来源记忆（书+文+档）；**禁全库直发 LLM**，走本地检索 → 相关 KP → 子图 → 相关卡/摘录 → 来源 → Evidence Package → LLM 合成；grounding 优先级用户自有材料 > 用户确认洞察 > 知识图谱 > 通用权威 > 模型先验，越靠后越标推测。**Evidence Package 结构冻结（v40，D37）**：`{diarySpans[{entryId, entryDate, text, charFrom, charTo}], kpSubgraph{kps[{id, canonicalLabel, aliases[], domainId}], edges[{id, from, to, relationType, confidence, source}]}, cards[{cardId, front, back, domain, kpId?}], extracts[{extractId, text, documentId}], sources[{documentId, title, sourceType}], tokenBudget, groundingOrder[...]}`——由 `InsightEngine.buildEvidencePackage` 独占装配（§4.2-24），`evidence_package_json` 全量快照入 `insight_runs` 供审计与复现；token 超限时按 grounding 优先级**从后往前**裁剪（先裁先验层、保用户材料），并在 UI 明示裁剪发生。**Evidence Package 结构冻结（v40，D37）**：`{diarySpans[{entryId, entryDate, text, charFrom, charTo}], kpSubgraph{kps[{id, canonicalLabel, aliases[], domainId}], edges[{id, from, to, relationType, confidence, source}]}, cards[{cardId, front, back, domain, kpId?}], extracts[{extractId, text, documentId}], sources[{documentId, title, sourceType}], tokenBudget, groundingOrder[...]}`——由 `InsightEngine.buildEvidencePackage` 独占装配（§4.2-24），`evidence_package_json` 全量快照入 `insight_runs` 供审计与复现；token 超限时按 grounding 优先级**从后往前**裁剪（先裁先验层、保用户材料），并在 UI 明示裁剪发生。
6. **反馈与升级：** 每条重要 Insight 记反馈；Insight 发现的新关系只进候选（`source=AI-inference`），确认后升级；暴露的缺口进 Frontier 再进推荐；推荐须区分 knowledge-driven 与 meaning-driven（后者由 Personal Meaning + Frontier 驱动）。**四种 Insight（v33 扩为 Knowledge/Self/Frontier/Structure）可组合但语义分离**——第四类 Structure（结构连接）见 item 7 与 §4.14。
7. **Structure Insight（结构连接，v33 增补）：** 由「已持有知识结构 ↔ 候选领域知识结构」的对应关系驱动的洞察，是 AI 洞察的重要一支（完整契约见 §4.14）。输出契约：`{structureConnection: {ownedStructure: {knowledgePointIds[], relationEdges[], structureLabel}, connectionMode, candidateDomain, counterpartStructure, slotMapping[{fromKnowledgePointId?, toLabel, relationType, confidence}], whyThisDomain, disanalogy[]（≥1 条主要差异）, expectedEntryPoint（初步认知模型的最小骨架）, falsifiableQuestions[], uncertainties[]}}`；必须能回答「为什么推荐这个领域」与「结构相似在哪里」；每条映射须可点击追溯到 KP/卡/摘录，无依据一律降 `uncertain`；`ownedStructure` 侧证据不足时不出建议。

### 4.14 结构连接 Structure Connection（v33，Insight 第四分支 + Frontier 第二入口）

1. **命题。** i+1 的「i」不止是已掌握的具体知识点与前置，也包含**已有知识中的相关结构**。因此进入一个新领域有两条路——**前置驱动**（该领域的前置已具备）与**结构驱动**（该领域的知识结构与你已持有的结构高度对应，即使前置缺口存在）。**关键命题：AI 洞察的关键不只是控制新知识的难度，更在于找到新知识与已有认知结构之间的可连接点。** 结构驱动的进入不以该领域的前置知识为切入点，而以结构相似性为切入点；用户接受后先建立**粗略的初步认知模型**，再在该模型上吸收略高于当前理解水平的新信息并持续修正它，从而不断扩展知识面。
2. **连接手法（封闭枚举）+ 强制输出。** `connectionMode ∈ {analogy（类比：A 域结构 ↔ B 域结构整体对应）/ abstraction（抽象：把已有结构提升为更高层的模式，再找实例化它的领域，依赖 generalization_of 边）/ combination（组合：两个及以上已有结构交叉，指向交叉/新兴领域）}`——即「类比 / 抽象 / 组合」三类手法；**三种手法都必须产出槽位映射 `mapping`**（逐槽列出 A 侧 KP/关系 ↔ B 侧概念/关系的对应 + 各自 confidence）。即「类比、映射、组合、抽象」四要素＝**三类手法 + 一项强制输出**。
3. **v1 落库形态最小化（显式声明）。** 不新增「结构」实体表：**已持有结构 = 本地检索选出的 KP + 关系子图（结构模式）**；跨域对应落 `knowledge_relations.relationType = analogous_to`（带 `structureLabel` + `mappingJson`，§4.6）；结构假设落既有 `knowledge_proposals` / `insight_runs`。是否升级为 `knowledge_structures` 一等表（结构可命名、可复用、可跨材料累积）留待实现批按复用频次再定——避免 v1 过早锁死 schema。
4. **初步认知模型（tentative model）生命周期（硬性）。** 结构驱动推荐被用户接受后建立的是**粗略模型**，不是既成结论。状态机 `proposed → accepted(tentative) → refining（吸收新材料中）→ converged / replaced / abandoned`。推进循环＝**结构切入 → 吸收略高于当前理解水平的新信息 → 修正该模型**；每次 confirm/refute/revise 记可审计事件并链到证据（判定口径见 §4.7 item 11：只用真实学习证据）；模型 `replaced` 时旧模型**留痕**不删（对齐 §1.9 可重算、§1.10 AI 不是事实源）。
5. **推荐理由必须说明（用户硬要求）。** 结构驱动的推荐与洞察**必须**输出：①为什么推荐这个领域；②结构相似之处（槽位映射表，可点击到 KP/卡/摘录）；③**至少一条主要差异（disanalogy）**——防把类比当同构、防确认偏误（与 §4.13 item 4 竞争解释纪律同源）；④**可证伪的追问 `falsifiableQuestions[]`**（供后续修正判定）。**禁只给结论、禁编造对应**：每条对应须可追溯，无依据一律降 `uncertain`（同 §4.6 AI metadata 封闭化）。
6. **Frontier 第二入口（与 §4.8 item 4 成对）。** `structureFit（结构对应强度）= 结构模式完整度 × 槽位对应覆盖率 × 对应关系类型一致性 × AI 置信档`，与「已持有结构的证据强度」共同决定候选排序。结构入口放宽的是**候选生成与 `connectivity` 口径**，**不豁免**进入后的必要前置：推荐须标注该领域主要前置缺口 + 「结构切入后如何补前置」的路径，进入后学习路径仍由常规 Frontier 接管；挑战档照常映射到四档（结构入口典型落在 `growth / stretch`）。
7. **三道闸门 + 护栏（缺一不出建议）。** 闸门：①**结构确实已持有**——`ownedStructure` 侧 KP 须有 evidence（且 user_confirm 或高置信），冷启动库不出结构驱动建议；②**材料可读性达标**——候选材料 `languageDifficulty / conceptDensity` 不超可读阈，防「结构像但读不懂」；③**用户信号**——存在兴趣/现实需求/日记 demand，或用户主动要求探索。护栏：结构入口**只能是探索性建议**、须用户确认；**禁自动下载材料、禁自动入队、禁自动制卡**（沿用 D29 克制精神）；不改动 §4.8 四档挑战阈值与 desirable difficulties 边界。
8. **合规。** AI 只提议、用户确认后才成事实（§1.7）；结构假设标 `source=AI-inference` + confidence，未经确认不得升级为用户事实（§1.10）；**不写 mastery、不碰 FSRS 调度字段**（§4.12）；结构边不参与 prerequisite 无环约束，也不派生 `due` / 优先级。结构驱动的候选与解释走独立提示词 scope（§6.3.11 `structure-analogy`）。

### 4.15 插件/主题体系（规范，未实现）

- 插件 = 文件夹 `plugins/<id>/`（plugin.json + main.js + styles.css + data.json）；`versions.json` 版本回落。
- 主题是特殊插件（type:theme）；`/* @settings */` YAML 声明可调项。
- 皮肤体系：内置 `src/skins/<id>/`；每套皮肤只改表现层；亮暗对比 ≥4.5:1；先规范后代码。

### 4.16 同源卡延后 Sibling Burying（v34 定契约并实现，✅ 见 §9.1 M12；队列视图契约；**非 FSRS 契约**）

1. **问题与定位（用户 2026-09-14 要求）。** 制卡原则本身要求同一材料产出多角度卡——R8 双向多角度、R19 内容卡与归属卡拆分、G6/G10「单一孤立事实至少 2 张」、D18 翻转对的两张独立卡、D27 一卡多空分答拆卡、M7 单词四卡、D26 同图多卡——这些卡**必然同源、内容高度重叠**。若同日全部出现，先出的一张会为其余卡**泄题**，其余卡退化成「刚看过答案」的易题，FSRS 会把这份人为的容易误读成稳定度（D29 已就「混淆型 lapses 污染 FSRS」记录同类风险，本契约是同一风险的调度侧解法）。**规则：同一制卡来源单元产出的卡片，同一学习日内只放行一张，其余延后至次日**——即 Anki 的 sibling burying 语义（Bury new siblings / Bury review siblings，延后于日切自动解封）。
2. **两个概念。** `siblingKey`（同源组标识，落 `cards.sibling_key`，§4.1）与**学习日**（沿用 §4.4.8 / D23 的 `learningDayStartMs(ts, dayCutoffHour)`，与统计同一口径）——本批是学习日**除统计外**的第二个使用点（队列视图），**仍不进入 FSRS 调度与训练**（D23 不变量不变）。
3. **延后 = 队列视图，不是调度写入（本批关键决策）。** 延后**不写** `fsrs_json`、**不改** `due`、**不写** `review_logs`、**不触发** leech：其实现是「今日队列」这一**纯函数**（输入＝卡片集合 + `review_logs` + `sibling_key` + 学习日窗口 + `now`；输出＝今日放行卡 + 延后卡清单）。理由：
   - ① **用户诉求是「不污染 FSRS」**——Anki 的做法是 bury 时把 `due` 推到次日，这本身就改写了调度字段，使该卡下次复习的 `elapsed_days` 与 `scheduled_days` 错位、优化器 `delta_t` 被这一日改动污染；改为纯视图后调度字段一字不动，该卡下次被复习时的逾期语义与「用户自己晚了一天复习」完全一致（FSRS 本就把逾期当作正常输入）。
   - ② **不制造第二套解释**（§4.4 最高不变量）——被延后的卡在库里的到期事实没有任何变化，只是「今日队列视图」不放行它；视图是派生量，不是对同一事实的另一种记录。
   - ③ **撤销天然正确**——撤销某次评分会物理删除该条 `review_logs`（v22/v23），组内「今日已放行」的占用随之释放，兄弟卡自动回到今日队列；无需像 Anki 那样额外维护 unbury 逻辑（这正是「不落库」换来的性质）。
4. **组内规则（每日额度 `perDay`，默认 1）。**
   - **当日剩余额度 = `perDay` − 组内当日已评分卡数**（`review_logs.reviewed_at ∈ [学习日起点, +24h)`，同一卡当日多次评分只记一张）；剩余额度 ≤ 0 → 该组当日不再放行任何卡（`perDay=1` 时即「答过一张，其余全组延后」，与 Anki 由「答完一张」触发 bury 的行为一致）。
   - 剩余额度 > 0 → 按既有规范序（`due` 升序 → 同 due 按 `priority` 降序，§11.5）取该组**至多「剩余额度」张**放行，其余当日延后。**放行顺序稳定**：组内首张未被答完时，次日仍放行同一张（用户始终先掌握首张，避免跳答导致同源卡错位；与 Anki 新卡按序收集的行为一致）。
   - `new` 卡与 `review` 卡**分别**受两个开关控制（对齐 Anki 的 Bury new / Bury review siblings）；**learning / relearning 步进中的卡不参与延后**（其 `due` 由学习步决定，延后会破坏步进）。
   - 挂起（leech suspended）卡照旧排除；**被延后的卡在卡片浏览页仍可见、可显式打开复习**——延后只作用于队列，不阻止用户主动复习某张卡。
5. **分组键建立规则（确定性；禁 AI 判定）。**
   - **结构性同源（必然重叠）→ 制卡动作内的单元键**：翻转对（D18 一次动作的两张互为翻转卡）、一卡多空分答拆卡（D27 同一父草稿拆出的各卡）、单词四卡（M7 同一次查词）、同图多卡（D26 同一次选区确认）——由调用点显式给出该单元的键（`act:<单元 id>` / 父草稿键），**与来源文本长度无关**（这些卡无论材料多长都必须错日）。
   - **短材料同源 → 来源锚点键**：`src:<documentId>:<extractId | hash(anchorText)>`，**仅当本次制卡源文本长度 ≤ `sourceTextLimit`（默认 300 字符，约一两句）时建立**。长选区（整节/整章一次产十几张卡）**不建键**——那些卡锚定的是不同知识点，强行同组会退化成「每天只准学一张」的阻塞。
   - **无锚点的手工卡**（阅读器外直接输入、无选区）→ NULL，不参与延后。
   - **明确不做「内容重复度分析后决定延后」**（用户提出的备选方案，见 §9.4 该行）：本地 n-gram 检不出**换了措辞**的同源卡（D29 已记录同一局限——词面相似度检不出「高尔吉亚 vs 巴门尼德」），而用户报告的场景恰恰是「同一句话产出的多角度卡互相泄题」，由**来源分组**确定性覆盖；改由 AI 判定调度侧延后则违反 §1.7（AI 输出须人工确认）/§1.9（状态可重算）/§1.10（AI 不是事实源）——调度决策必须可复算、可解释。
6. **口径唯一（硬性）。** 「今日到期 / 已完成 / 剩余」与复习队列必须由**同一个** `SiblingQueueView.computeTodayQueue(now?)`（§4.2-20）产出。现状两处分叉须在本批统一：`listDueCards()` 过滤 `due ≤ now`、`getStatsOverview()` 统计 `due ≤ today24`。统一后：队列＝视图放行卡；KPI「今日到期」＝视图放行数，**另列「同源暂缓 N」**（不静默少卡）；被延后的卡若被用户显式复习，仍计入 `completedToday`，`remaining` 保持 `max(0, …)` 兜底。时间注入 `now` 供测试（同 §4.4.4 的 `preview/next` 时间注入精神）。
7. **可观测与可解释。** 复习页/队列页对延后须给出可读原因（「与今日已放行的『X』同源，今日暂缓」并给出组内已放行卡标题）；当日延后卡可在「今日暂缓」展开区查看；卡片浏览页状态列可筛选「今日同源暂缓」。延后**不是学习证据**，不进 LKM（§4.7），也不进 `review_skips`（`w` 跳过是会话级用户动作，语义不同，勿混用）。
8. **合规边界。** 不写 FSRS 调度字段、不改 `preview/next`（§4.12）；不改变卡片形态、不做复习期变形（D18）；不改 cloze 契约（§5.4）；不新增 AI 调用（本批零提示词变更）；设置项落 `settings.app.siblingBury = {enabled, newCards, reviewCards, perDay, sourceTextLimit}`（`enabled` 默认开，其余按上方默认值）。

### 4.17 成长反馈 Growth Feedback（v39，呈现层只读契约；产品体验最高层；实现见 §9.1 M13）

> 来源：用户提供的 ChatGPT 草案《Growth Feedback / 成长反馈系统》（2026-09-15）经本会话审阅与扩展——草案的"真实性优先 / 行为与成长分离 / 累计变化必须可见 / 不制造惩罚性反馈 / 不设万能总分 / 不奖励垃圾积累 / 视觉变化必须对应真实数据 / 四层 Dashboard / 知识疆域 / 成长记录 / Momentum / 核心闭环 / 最高层产品目标"**全部保留**；修正其对 LKM 数据的依赖假设，补全首次语义、撤销联动、防回灌、回落规则与正反馈分级（决策 D36）。**产品规格（正反馈分级总表与全部文案）见 §6.6**。**排期（用户 2026-09-15 拍板）：整批排在 M8-B 与 K0–K9 之后**——本层消费 K 系列产出的知识模型 / 算法 / Frontier 数据，先于 K 落地会把表现层建在空数据上。

1. **命题与定位。** 学习不仅需要真实发生，也需要让真实发生的成长被用户感知。本层是**真实学习证据、知识结构变化与能力变化的可视化表现层**（presentation-only），只读 Knowledge Structure、Learner Knowledge State、Evidence、Learning Frontier 及其派生统计。产品目标（用户草案原话保留）：**"我不是在不断完成学习任务，而是在不断扩张自己的知识疆域、建立自己的认知结构，并获得过去没有的能力。"** 这是本软件区别于普通阅读器、Anki、知识管理软件与打卡 App 的核心体验。
2. **术语消歧（硬性）。** ① 本节的"反馈"＝**呈现（presentation）**，与 §4.11-5 的"主观反馈"（Insight 有用度 / 推荐接受度，只调 `utility` 权重与 `challengeFit` 阈值）是两套互不相干的东西——命名、表、IPC 前缀一律分离（本层统一 `growth:*`），禁混用；② "连续"在本指南已指"连续复习"（D8），本层**禁**引入连续打卡语义；③ 状态词表锁死 §4.7：四态 `developing / functional / strong / uncertain` + 五维 `recognition / recall / conceptualUnderstanding / application / transfer`，本层**不得发明新状态名**；④ `mastery` 是 LKM 的估计量，本层只做呈现，不生产、不写回。
3. **只读不变量（硬性，最高优先）。** 不得写 `fsrs_json / leech_json / fsrs_config_id / review_logs / review_skips / priority / due` 或卡片内容；不得写 `knowledge_evidence / learner_knowledge_states / knowledge_relations` 或任何 LKM 表——**本层比 §4.12 再退一层：连 LKM 也只读不写**；不得进入 FSRS 调度、训练与推荐排序，不得作为 `utility / challengeFit` 的输入（与 §4.11-5 双向隔离）；读侧一律在 review 的 `COMMIT + persist + IPC` 成功之后（§4.4-9 成功边界），**派生失败静默降级，绝不影响评分、跳过、删除与 Undo**；全部本地派生、零网络（§1.1）。**本层不新增业务表**；若将来需要派生缓存，必须带 `derivationVersion`、可从原始证据全量重建、永不成为事实源（§1.9 精神 + D22 式指纹治理）。
4. **四层口径（Dashboard 信息架构）。** ① **Activity（我做了什么）**：阅读 / 摘录 / 制卡 / 复习 / 日记 / Application·Transfer 任务——**活动量不得冒充成长**（卡片数、摘录数、材料数、AI 调用数只作 Activity 指标，永不生成成长提示，也不作为最高层成长指标）；② **Growth（知识发生了什么变化）**：新 KnowledgePoint / 新学习证据 / 四态变化 / 新知识关系 / Frontier 推进 / 新探索领域；③ **Capability（我现在能做什么）**：达到 `functional / strong` 的知识点、完成 Application / Transfer 的知识点、从"过去做不到"到"现在能够做到"的跃迁——**每一项必须可点击到证据链**（KP → Evidence → 卡 / 摘录 / 日记 / 来源），不可追溯的项降级为 Growth 或删除；④ **Territory（我的疆域扩展到了哪里）**：见 item 7。**不设万能总分**（禁把复杂 Knowledge State 压成单一 Overall Learning Score），**也不得把四态压成一个环形总进度条**（总分换皮同样禁止）。streak / 连续学习天数归 **Activity 层**（用户 2026-09-15 拍板）：保留既有 KPI 与里程碑尺，但禁用「即将断签 / 补签」类文案与提醒，Growth / Capability 永不引用它。与既有仪表盘的接入方式见 §6.6.4（既有 12 组件与用户自定义布局不动，新组件带 `layer` 归属）。
5. **成长事件模型（本层的事实基础）。** 定义封闭枚举 `GrowthEvent`，判定一律是**对既有原始证据的纯函数重算**（§1.9 精神）；每个事件带 `tier ∈ {capability（能力，L0）/ structure（结构，L1）/ consolidation（建制，L2）/ minor（次要，L3，仅进会话成果汇总）}`，tier 即提示优先级（§6.6.1 分级总表）。**记忆层（只读 `review_logs`（含 before/after 快照）+ `cards`）**：`material` 材料级跨越（某书 / 某领域巩固覆盖率首达阈值，样本门槛 ≥8 张卡）；`group` 组级毕业（`sibling_key` 或 `knowledge_point_id` 组（≥2 张）内全部卡达同一阶段）；`leech-recovery` Leech 康复（反复遗忘的卡消解后首次稳定）；`relearning-recovery` 遗忘后康复（首次 Relearning → Review）；`retention-180 / retention-60` 单卡长期维持梯队（stability 首达 180 / 60 天）。**知识层（只读 K1–K4 产出）**：`transfer-first` 首次完成 Transfer；`application-first` 首次完成 Application；`kp-strong / kp-functional` 某 KP 四态首达（聚合口径按 §4.7-7 短板聚合，禁简单平均）；`structure-link` 首次建立跨域可靠连接（`analogous_to` 经用户确认——按 §4.7-11 只作结构证据，**不进 mastery 估计**）；`domain-entry` Frontier 首次推进到新领域。**禁止项（封闭）**：禁由一次 Good / Again 直接生成事件（§4.7-6）；禁由累计数量生成事件；禁生成无法点击到证据的事件；禁由 AI 判定（§1.10）；禁把"用户接受了推荐 / 洞察"当作能力事件。**明确排除（用户 2026-09-15 判定，理由见 §6.6.1 取消项）**：单卡学习步毕业（Learning → Review）与单卡巩固 21 天——前者每张新卡必经、零信息量，后者普通卡数次成功复习即达、频率高区分度低，均**不产生任何提示**（保留在分级表中标注"取消"，防未来实现者加回）。
6. **首次语义、撤销联动与防回灌（工程硬性）。** ① 每个 `(事件类型, 实体, 维度)` 只报一次，"首次达成时刻"由 `review_seq` 全局序（§4.4-9 排序不变量）重算得出，**不落表、不另存事实**；② 撤销评分物理删日志 → 派生事件**自动回退**，且回退**静默**（不提示、不警告、不出现"你失去了…"）；重评再次跨越可再次触发（真实的重做）；③ **防回灌**：首次上线时存量历史会"已经达成"大量里程碑——提示只接受**刚提交的这次评分触发的跨越**，存量达成项不逐个弹（另给一次性"盘点"入口，用户主动打开）；④ **单次评分至多一条提示**，多条命中取 §6.6.1 表中最高级；同级按事件类型固定序 → 实体 id 字典序（确定性、可重算、可测试）；⑤ L2 级（建制类）同类事件单日折叠（如"今天另有 3 张卡进入长期维持"），L0 / L1 天然稀有、不设上限；⑥ 全库聚合视图（Territory / Growth Records）必须防抖或缓存；如实测出现性能问题**不得**把成本加在评分路径上（现状：仪表盘每次 `cards/changed` 全量重算 `stats:overview`，其内还有 N+1 查询热点——本层聚合不得叠加同类模式）。
7. **长期反馈：Growth Records / Growth Timeline / Territory。** ① **Growth Records**＝可验证的历史成长事件档案（时间戳 + 事件 + 证据链），只收录 §6.6.1 的 L0–L2 项（**取消项不收录**），以"过去做不到 / 现在能够做到"的时间线表达，**不做排行榜、不做分享、不做推送**；② **Growth Timeline**：知识层阶段序 `接触 → 建立结构 → 形成证据 → 达到 functional → Application → Transfer`，记忆层阶段序 `新卡 → 学习步 → 长期复习 → 巩固 → 康复`；每个事件可点击进入 `KnowledgePoint → Evidence → Cards / Extracts / Diary / Source`，**不得出现无证据的"AI 认为你进步了"**；③ **Territory（知识疆域）**：复用 §4.10 图谱（K8）与 §4.6 / §4.8 数据，视觉阶段 `未知 / 未接触（fog）→ 已接触 → 已投入 → functional → strong / 应用 / 迁移` **逐项映射到四态 + 五维 + Evidence，不新增事实状态**（映射表见 §6.6.4）；**回落规则**：知识状态会回落（§4.7-3 长期无证据 → confidence 下降 → 回 `uncertain`），Territory 展示**现状**（可收缩），Growth Records 是**历史**（不撤销），一切回落只体现在图面、**不提示不警告**；④ **动画纪律**：一切生长 / 点亮 / 连边动画必须由真实事件计数驱动（§4.10-3 **禁无数据的假扫描动画**），遵守 `prefers-reduced-motion`（沿用 theme.css 既有三处先例），禁止庆祝动画、彩带、虚拟货币、经验值与强制弹窗。
8. **Momentum（可选，最后落地）。** 只描述"近期系统是否在持续运动"，**不定义成功 / 失败、不设目标、不设惩罚**：窗口 7 / 28 天（"今天"聚合用学习日口径，D23）；指标＝阅读活动、新知识 / 新证据、Application / Transfer、Frontier 推进（后三者 GF-2 口径）；**禁显示连续天数语言、禁颜色褒贬（不给红绿、不给趋势箭头）**，窗口内活跃学习日 < 3 不显示；**不得作为任何排序 / 推荐 / 权限的输入**，纯呈现。
9. **合规与红线汇总。** §1.8 三层分离（结构 ≠ 状态 ≠ 推荐）/ §1.9 可重算 / §1.10 AI 不是事实源；§4.7-6 禁把 Good 直接等于 mastery 上涨（与 §6.6.1 分层措辞配套：记忆层只说记忆语言、知识层才说知识语言）；§4.10-3 禁假动画；§4.12 只读 FSRS（本层再退一层）；§6.3.8 非惩罚性复习体验；D19（日记只产 demand 信号、不产 mastery 证据）；D23（学习日仅作统计口径）；D29（克制：禁自动扩产 / 禁自动入队）。
10. **实现批次（见 §9.1 M13）。** 内部两步：**GF-1 记忆层**（零 schema 变更、零新写路径，只读 `review_logs` / `cards`）→ **GF-2 知识层**（依赖 K1–K4 的 evidence / states / relations / Frontier 就绪）。整批排在 K 系列之后（用户 2026-09-15 拍板）；GF-1 为零依赖子集，未来如用户要求提前，须**先改本文档**。

### 4.18 用户记忆 User Memory（v42，D39；契约；产品规格 §6.7；批次 §9.1 M14）

> **来源与依据（用户 2026-09-15 构想 + 本批调研，出处见附录C）。** 用户观察：**应用卡（R15「当我遇到X应该问自己什么」）是知识点与现实情境之间的节点，而日记正是现实情境的记录**；因此要求软件维护一份**类似 Hermes（Nous Research `hermes-agent`）的用户记忆**，并明确四条：① **记忆完全不需要用户参与维护**（用户已经要阅读、摘录、制卡、复习、维护知识点，再维护记忆得不偿失）；② 记忆须**覆盖日记中的一切**（烦恼、心理状态、情绪及其起因、与谁聊到什么、见闻等）；③ **越久远的记忆越珍贵**，不得因容量淘汰早期记忆；④ 判断「情境是否贴合」**交给模型**，**不写本地语义门槛**（本地实现成本高，且一旦不够完美就会过严，反致功能失效）。**调研结论**：Hermes 的零维护靠「小文件 + 装满即合并删旧」，与②③**直接冲突，不可照搬**；自传体记忆是三级结构且长程保持近幂函数、不做衰减，分级存储（无限归档 + 有界上下文）是共识解法；用户检索自有资料靠**导航**（56–68%）远多于搜索（4–15%），故**文件按主题切分、时间作条目标签**；「候选一二十条、注入五到十条」有实测支撑（Zep 15/5 配置）。全部出处与数字见附录C。

1. **命题与定位。** 用户记忆＝**从日记增量整理出的、关于用户长期处境的可持续事实与处境记录**，用途只有一个：**为制卡提供真实处境**——让 R15 应用卡与 R12/R9 助记的生活线索**锚定在用户真正经历过的事情上**，而不是模型编造的通用场景。**它不是第二份日记**（日记是原始记录，记忆是结构化条目）、**不是知识库**（不产 KP、不产 mastery 证据）、**不是画像**（分工见 item 14）。它是「现实经验 ↔ 所学知识」的交汇点，也是 M8 第二输入通道在制卡侧的落地。
2. **形态（硬性）：分层文件即真源。** 记忆真源是 `<userData>/memory/` 下的 Markdown 文件树，**不是 DB 表**——本项目**首个非 DB 的用户数据真源**。理由：① 用户可随时用任意编辑器打开、阅读、修改（用户明确要求「设置中提示记忆文件位置、允许手动打开编辑，**不在软件内集成记忆编辑窗口**」）；② 记忆是长文而非常规查询对象，文件形态天然适配；③ 与 Hermes / Claude Code / Letta 一致。DB 侧只留 `memory_runs`（运行留痕）与 `cards.memory_ref_json`（溯源）。
3. **文件树与预算（总量不限，单次注入有界）。**
   ```
   memory/
     core.md                     长期稳定事实（身份 / 长期项目 / 稳定偏好 / 长期困扰）   恒定注入，≤800 字
     index.md                    目录：生活域 → 主题文件（主题名 · 条数 · 日期区间）      恒定注入，≤1,200 字
     topics/<生活域>/<主题>.md     条目正文，单文件 ≤1,200 字，超长拆续篇（目录登记）
   ```
   **总量不设上限、永不自动删除、不做衰减**（依据见上）；`core.md` / `index.md` 超限时**只降级与合并、不淘汰**：core 中不再稳定或不再当前的条目**降级**到对应主题文件（不删）；目录超限时由 AI **合并相近主题**（合并文件 + 更新目录），**不做隐藏、不设归档池**——旧条目始终可被检索到。
4. **条目三级模型（照自传体记忆三级，中文命名）。** `事件`（单次：某天发生的事、对话、见闻）／`处境`（反复出现或延续的处境、模式、长期困扰）／`事实`（稳定属性与偏好）。条目**一行一条、以日期开头**：`- YYYY-MM-DD ｜ 一句话 ｜ [生活域 · 子主题 · 关联领域 · 情绪]`（方括号内为标签，后三者可选；情绪用少量词，不引问卷式长标签）。**同一处境的多次记录是真实记录，不得合并**；只有**近似重复**（同一天同一件事被写成两条）才允许合并。
5. **生活域＝封闭分类（8 + 其他），子主题由 AI 命名。** 生活域固定为 **工作与学业 / 人际与家庭 / 情绪与状态 / 健康与作息 / 财务与生活 / 兴趣与见闻 / 成长与目标 / 观念与价值 / 其他**（来源为 WHOQOL 六域、个人幸福指数七域、DISE 压力事件清单与 PERMA 的并集收敛，逐项依据见附录C）。**封闭顶层 + AI 子层**：顶层白名单可校验、跨时间一致；子主题（即主题文件名）由 AI 自由命名与演化，**旧条目不因改名而移动**。
6. **知识域用在书那一侧（领域→生活域映射表，封闭）。** **不要求模型给日记内容猜 UDC**（「和妈妈吵了一架」没有稳定学科归属）；用反向映射作检索键：

   | 书侧领域（UDC 叶） | 记忆侧候选生活域 |
   | --- | --- |
   | 004 计算机·AI / 62 工程技术 / 51 数学·统计 | 工作与学业、成长与目标 |
   | 159.9 心理学 | 情绪与状态、人际与家庭 |
   | 316 社会学·人类学 / 32 政治·法律 | 人际与家庭、观念与价值、兴趣与见闻 |
   | 33 经济·金融 | 财务与生活、工作与学业、兴趣与见闻 |
   | 37 教育·教学 | 成长与目标、人际与家庭 |
   | 61 医学·健康 / 796 体育·运动科学 | 健康与作息、兴趣与见闻 |
   | 1 哲学·逻辑 / 2 宗教·神学 | 观念与价值、成长与目标 |
   | 7 艺术·设计 / 78 音乐 / 79 影视·游戏 / 8 语言·文学 / 91 地理 / 93 历史·考古 | 兴趣与见闻、观念与价值 |
   | 53 物理·天文 / 54 化学 / 55 地球·环境 / 57 生物 / 63 农业 | 兴趣与见闻、成长与目标 |
   | other 其他 | （不映射，仅靠词面召回） |

   映射表**封闭**，改动须先改本文档。
7. **检索（两阶段；本地只做宽召回，不做相关性判定）。** **Stage A＝本地宽召回**（确定性、可测）：材料信号（书名 / 章节标题 / 正文词面 n-gram / **本书已有卡的 UDC 域分布**）→ 经映射表落到候选生活域 → 在 `index.md` 中选出 **1–2 篇主题文件**（宁多勿少；**不做语义否决、不设硬门槛**——用户拍板：本地门槛成本高且易过严，会让功能失效）。**Stage B＝由模型在制卡调用内自行判断用不用、用哪条**（R20 拒用铁律，item 9）。**目录恒定注入**：即使 Stage A 命中为空，`index.md` 仍全量注入，模型可据此在 `warnings` 中点名「本次材料可能与主题 X 相关但未提供内容」——**可观测、不静默**，同时是调参与人工补正的依据。
8. **注入预算与装配。** 注入块＝`core.md`（≤800 字）+ `index.md`（≤1,200 字）+ 命中主题文件（≤2,400 字）≈ **4,400 字 ≈ 3,100 token**（按项目内 CJK 0.7 字/token 估算），由 `settings.app.memory.injectBudget` 调节。**只在记忆接地 scope 集合内注入**：`card-generation / card-formula / card-seq / card-enum / card-mnemonic / card-contrast`；`card-vocab / card-literature / card-occlusion` **不注入**（这些模式不产情境卡）。注入块带**用量头**（照 Hermes 渲染块）与「仅用于情境接地」的用途声明。
9. **拒用铁律（R20，硬性）。** 记忆**只能**用于：① 应用卡（R15）的**情境部分**；② 助记卡（R12/R9）的**生活线索**。**禁止**用于：③ **答案与事实内容**（答案必须来自材料）；④ 其他任何卡面字段；⑤ 为使用记忆而扭曲情境或强行关联。**没有贴合的处境时必须省略记忆内容**——`memoryRef: null` 是**合法且受鼓励**的结果（宁缺毋滥）；**不得因存在记忆而增加应用卡产出**（D29 克制）。措辞（用户 2026-09-15 拍板）：**可含用户自己的具体事物**（项目名 / 领域 / 书名等，让用户一眼认出「这就是我遇到的事」），**禁第三方隐私**（他人姓名、机构、联系方式），**禁逐字搬日记原句到卡面**。

> **R20 v44 修订：白名单由枚举制改为原则制（用户 2026-09-17 拍板）**
>
> 1. **原则**：凡按提示词规范或卡型规则**需要情境**的卡片，一律允许记忆接地；**不需要情境的卡片类型一律不注入**。原白名单（应用卡 R15 + 助记卡 R12/R9）收编为该原则下的首批成员，新增消费方不再逐次修改本节文本。
> 2. **落地形态：scope 注册表显式声明**——每个 PromptTemplate scope 增加声明位 `situationRequired`（提示词播种时随模板写入），注入管线只对声明为 true 的 scope 装配记忆块。**v1 声明清单**：`card-generation`（其中 R15 应用卡分支）、`card-mnemonic`（R12/R9 助记）、`knowledge-probe`（**仅 application / transfer 两维**——识别/回忆/概念理解探针不需要情境，不注入）；**排除不变**：`card-vocab / card-literature / card-occlusion / card-formula / card-seq / card-enum / card-contrast`（无情境语义）、`journal-insight`（直接消费日记原文，注入记忆属冗余）。
> 3. **未来候选（本次探索结论，接入须先改本表 + prompt-lab 验证）**：① K3 Frontier Check 应用任务（与探针同性质，K3 落地时按本原则自动适用）；② AI 阅读助手的解释措辞（**当前不接**——超出「制卡情境」边界，且涉及 §4.18-14 ⑥「不作推荐/掌握度输入」的边界地带，须单独决策）；③ 词卡的例句情境（`card-vocab` 当前排除不变；如未来做 AI 例句可复议）。
> 4. **铁律其余条款全部不变**：记忆只出情境不出答案与事实；`memoryRef` 逐字抄录 + 子串校验；无贴合处境必须省略（`memoryRef: null` 合法且受鼓励）；不因存在记忆而增加产卡数量；禁第三方隐私；禁逐字搬日记原句；记忆永不进入评分、掌握度、推荐、统计的任何输入（§4.18-14 ⑥）。

10. **溯源（轻量、不阻断、非相关性判定）。** 每张卡输出 `memoryRef`＝**逐字抄录**所引记忆行（或 `null`）；本地**仅做子串存在性校验**（该文本是否真的在记忆文件中），失败只在确认面板标「情境来源存疑」，成功则落 `cards.memory_ref_json`、卡面显示「情境来自记忆」徽标、卡片浏览页可筛选。**不新增 CardLint 规则、不阻断入库**（避免过严，§6.3.4 本次不变）。
11. **整理（全自动零维护）。** ① **触发**：日记变更后**防抖**整理（最小间隔默认 30 分钟）+ **启动补跑**（距上次成功 ≥12h 且存在未整理条目）；无 Key 静默跳过；设置页另有**立即整理**（供外部编辑后手动刷新）。② **摄入轮**（`kind='ingest'`）：输入＝`index.md` + `core.md` + **上次整理之后新增/改动的日记条目**（草稿永不入包）；输出＝**操作列表**（追加条目 / 新建主题 / 提升到 core / 标记取代）。③ **周期整理轮**（`kind='consolidate'`，每 N 轮或目录超限触发，轮转处理 1–2 个主题文件 + core）：合并近似重复、拆分超长文件、修正归类、core 过期条目降级。④ **写作纪律**（照 Hermes 的经验）：写成**陈述性事实**而非对自己的指令（祈使句会在后续被当作命令重读）；「一周内即过期的事」不写进记忆（留在日记里）；只记日记中**确有**的内容，禁推断人格、禁病理断言（同 §4.13-4 措辞纪律）。
12. **不删、不改写（硬性）。** AI 操作只有**追加**与**标记**（`add` / `merge`＝追加合并行 + 给被合并行加标记 / `mark`＝标记「已被取代」「已结束」），**永不删除条目、永不原地改写既有正文**；执行一律**精确文本匹配**，匹配不到即跳过并把原因写入 `memory_runs.applied_json`（**绝不整文件重写**——用户外部编辑过的内容因此不会被覆盖）。文件内 `<!-- 用户手写区 -->` 标记段 **AI 永不改动**。
13. **提示词纪律。** 新 scope `user-memory` v1（摄入轮与整理轮各一套输入输出契约：禁编造出处、只记日记确有的内容、禁人格/病理断言、宁缺毋滥、预算与合并规则）；制卡族基线 **v6 → v7**（新增 R20 + 输出字段 `memoryRef`；`card-vocab` / `card-literature` 明确注明 R20 不适用）；**先测试台验证再播种**（M1 纪律，§7.4）。
14. **人机边界与六条护栏（§1.7 有界例外）。** 记忆是本项目**唯一「AI 自主写、不经用户逐条确认」的用户数据**——这是对 §1.7 的**有界例外**（同步登记于 §8.2 偏差表），成立条件是六条护栏缺一不可：① **唯一消费者**是制卡草稿的情境措辞，而每张卡**最终仍逐张经确认面板**（人工闸门保留在末端）；② 记忆**只出情境、不出答案与事实**（item 9）；③ **不写卡片正文、不写 FSRS / LKM 任何字段**（§4.12）；④ 设置页**明示文件路径** + 可**停用**（停用即零调用零注入）+ 可**重置** + 可**立即整理**（§6.7）；⑤ 每轮整理写 `memory_runs` 留痕（**可审计、可复现**，§1.9）；⑥ **永不进入遥测与出错上报**、**永不作为调度 / 推荐 / 掌握度 / 统计的输入**（§7.6、§4.7）。**与相邻概念的边界**：`personal_meaning_candidates`（M8-B）＝洞察对「你」的一次性解读（宽口径、长文、只在洞察面板内）；`context.userProfile`（画像槽）＝泛化偏好（**v1 仍不接线**，其语义是 R9「优先用」而无拒用纪律，与记忆不同）；本层与二者**不互相写入**，将来若打通须**先改本文档**。
15. **合规与通道澄清（防误读，硬性）。** §1.1 纯本地：记忆文件在本地磁盘，只有**整理**与**接地**两次 AI 调用经**用户自己的 Key** 出网（与 M8-B 同纪律，发送前可预览）；§1.9 文件即真源 + 运行留痕可复现；§1.10 **记忆不是事实源**——它不注入任何知识性断言、只作情境措辞，卡片答案始终来自材料；§4.12 不触 FSRS 与 LKM；D18（不新增卡形态、不做复习期变形）；D19（日记只产 demand 信号，记忆不写 mastery）；D29（克制：禁自动制卡、禁自动入队）。**两条通道必须分清**：**AI 调用通道**＝记忆（在检索命中范围内）**会**发送给用户配置的模型，**这正是本功能的用途**；**遥测 / 出错一键上传通道**（发给开发者，尚未实现）＝白名单（§7.6）**永不包含**记忆内容。M2 备份 / 恢复**必须包含** `memory/` 目录。
16. **开关、停用与补处理（用户 2026-09-15 追加要求，硬性）。** ① **开关**：`settings.app.memory.enabled`，**默认关闭**（本功能会把日记正文自动发送给模型，属隐私敏感项，与 §7.5 / §7.6 的 consent 纪律一致；**一次性开启说明 ≠ 逐条确认**，仍满足「零维护」）；**关闭即停用**——零整理调用、零记忆注入、零检索，但**不删除记忆文件**（文件保留在磁盘，重新开启即继续使用）。② **首次开启说明**（一次性）：明确告知将发送什么（日记新增/改动内容片段）、何时触发、注入预算、路径与可随时关闭；用户确认后才生效。③ **补处理（backfill，本项核心）**：**关闭期间记录的日记不得丢失**——开启（或重新开启）后，以**未整理水位线**为界把该窗口内的日记全部补做整理：水位线取自 `settings.app.memory.lastCoveredAt`（**首次开启时为空 ⇒ 窗口＝全部历史日记**；关闭期间的水位线**照旧保留**，故重新开启只需补关闭期间新增/改动的那一段）。④ **分批与可续跑**：批次**按时间正序**（早期记忆珍贵，先建早期处境）、每批 ≤ N 条且受 token 预算约束，批间串行；每批完成即推进水位线并写 `memory_runs`（`trigger='backfill'`），**应用退出、失败或用户在途中关闭都不丢进度**，下次继续。⑤ **可见与可控**：补处理前给出**范围与预估**（待整理条数 / 批数 / 预估调用次数与 token，照 M8-B 的「发送前预览」纪律），用户可确认或取消；进行中显示进度（「补处理：已整理 120/430 条」）并可中止；**补处理只是一连串摄入轮，同样遵守 item 12「不删不改写」**。⑥ **与自动触发的接续**：补处理完成后自动回到 item 11 的常规防抖节奏，无需再操作。

### 4.19 材料知识导图 Material Mind Map（v44 定位 D40；**v48 全节重写＝重设计契约 D41/D42**；批次 §9.1 M15）

> **构想来源（用户 2026-09-17）**：手动制卡时用户手选字段，AI 只看到选区文本，缺乏整本书整体思维与知识结构的把握；且推荐需要材料级知识覆盖数据。用户原始设想经讨论拍板为：**导图独立产物 + 按需生成 + 质量优先于成本**（「知识相关数据都是长期记忆的、十分有价值的信息，以质量优先，而非成本优先」——是否生成可选，一旦生成即以质量为先）。
> **v47 回滚与 v48 重设计（2026-09-18）**：v47 曾按「六维难度评估 + 知识点候选提名 → 整书聚合 → AI 生成 SVG」实现，实测三大失败点——①聚合主干结构空洞笼统；②AI 直接生成整幅 SVG 观感差、成功率低、长 SVG 易截断变形；③知识点候选粒度不对、聚合凑不出有洞察的层级。经用户决定整体回滚（快照 `docs/m15-archive/`）。本节按用户新设计委托书（`docs/导图功能设计需求-给ChatGPT.md`）+ ChatGPT 65-Task 重设计方案（经代码库现状审查与 A–H 补充约束审查后并入）全节重写；**「知识点候选」中间表示与「AI 直接生成 SVG」正式废弃、不得回潮**。
> **v48.5 实施追记（2026-09-18，用户实测四轮反馈 + ChatGPT 双轮审查修订，D43）**：① **结构制卡**——节点「就此制卡」≠ 对章节原文制卡：新制卡分支 `card-structure` v1，输入=节点结构语义包（本节点/父链/直接子结构/证据引文，**不携带章节原文全文**），只对**作者组织方式**出题（关系/派生/顺序/对比/分组等九类封闭枚举，随卡 warnings 标注），答案必须完全可从语义包推导、禁新评价判断、禁退化成普通知识卡；管线（确认面板/CardLint/S1/KP 归一）不变，auto 路由不选它。② **逐节点深挖（expand）管线**——单次调用输出上限装不下全书递归树：section 首层输出带 `expandable/stopReason`（v3），**仅 expandable=true 的叶进入深挖队列**（禁全叶无条件调用），expand 单层 children 逐层推进；stopReason 封闭枚举 `atomic_structure / textually_trivial / max_depth / call_budget`（后二者=系统强制停止，非正常原子化完成）；`settings.app.mindmapMaxCalls`（默认 300）只约束 expand，触顶 → **run=partial、新版本存为未激活、旧 active 保持、completeness 留痕**（不伪装完整生成）。③ **取消覆盖粒度选项，内部恒 detailed**——详细程度是内部质量标准而非用户选项。④ 「正文」伪节点三重修：epub.ts 无标题 fallback=材料名（现场重建、存量自动生效）+ normalizeTocTree 唯一权威顶层塌缩 + 伞形清单补「正文/目录」。⑤ remap 主条件修订：标题相等降为弱辅助信号**不得单独映射**（同名节点遍布全书必误绑），主条件=单元锚/quoteHash 重叠，拆分/合并不强行承接。⑥ 评审 >120 节点按顶层分支递归分片 + 根一致性复审（跨分支重复/冲突），不截断树不删证据。⑦ 版本删除 = material_maps 真删（事务性 active 顺延），shards 为缓存保留。⑧ 费用预览诚实化：基础分析 N + 深挖首波约 M + 后续动态追加 + 预算上限，运行中显示已累计。

> **v48.11 实施追记（2026-09-19，真实运行数据审计 + ChatGPT 三轮审查，D44）**：**根因＝深挖作用域错误（correctness + performance 双缺陷）**。本机真实库审计（`docs/m15-v48.10-性能审计.md`）证实：深挖产出的子节点继承父节点**全部单元锚**，导致每个节点在每一层都重读父级整段原文——一本 13 万字书 = **每个节点 17 次调用**（= 整本按段落分片数），上午会话 81 次调用切成 4 个「每作业恰好 17 次」的作业；实测单次调用中位 **36 秒且与输入规模无关**（8 千字与 13 万字同速，输出/reasoning 主导），故首层 17 次 ≈ **10.2 分钟**是硬成本，而深挖预算 300 触顶 ≈ 3 小时；run 账本只记到 85/113 次（editorial/review 不上计数 + 作业边界才写库）。修复九条：① **sourceSpans（全文 UTF-16 码元一维坐标 + 多区间）与 unitAnchors（证据定位/remap 语义）分离**——evidence 命中 → 聚类（≤400 码元）→ 行边界扩边（≤1500/侧）→ **与产生它的调用区间求交钳制**（无交集记 `scope_conflict` 且该节点禁止深挖）；② 深挖/补漏输入**只读自身 span**（多片段带显式【原文片段 i/N】标记），按段落→句→硬切三级**只切不删**（硬切留 200 码元重叠窗口并按 canonical span 去重），单片上限 6000 是 **payload 上限、不是材料上限**；③ **残余覆盖账 + 补漏作业**：`父 span − ⋃子 span`，缺口 ≥800 字且 ≥15% 且轮次 <2 → 同层优先补漏（防「深层好看但覆盖是假的」与重复补漏）；④ **run 级统一预算**（section/expand/gapfill/merge/global/editorial/review 全计入，含格式修复尝试）＋输出上限（maxNodes 8/25/60、maxOutputTokens 12000）→ 超限走**降级阶梯**（降深→拆 scope→标记留续跑），**禁截断**；⑤ 传输层：捕获 finish_reason（length=截断）、`stream_options.include_usage`、**abort 归因**（看门狗=timeout ≠ 用户取消）、429/5xx 重试（Retry-After 优先 + 指数退避 + jitter；**流已开始即不重试**＝unknown_outcome，防重复计费）；⑥ 可观测性：新表 **`material_map_calls`（账本真源）** + run 总账（requested/cacheHits/repair/retries/failed/cancelled/unknownOutcome/outputOverflow/byKind）+ **启动僵尸对账**（running→failed_timeout）+ partial 归因（`partial:call_budget` / `partial:call_failed`）；⑦ **阶段化**：首层就绪即落一版可看的图（status=`section_ready` **≠ completed**，版本立即激活），深挖为**可续跑第二阶段**（同 runId + 同 params 再调用，section 全命中缓存、零重复计费、重启后可用）；⑧ **并发阶梯**：同层独立作业批量并行（默认 concurrency=1 等价串行），429 → 降半 + 60 秒冷却 + 连续 3 次成功才升档，**单作业失败不杀整批**（整轮降 partial 不伪装完整）；⑨ 父节点主张由子节点证据组合支撑（§4.19-5）——TOC 中间节点在 merge/global 被预算挡掉时不再因「无直接证据」级联删树。**验收**：m15r core 74（+24 坐标系/区间代数/span 推导/切分/钳制）/ engine 80（+18：E16 作用域红线（深挖 payload 不含父级原文）+ 阶段化 + 续跑，E17 并发 + 失败隔离）/ db 30 / layout 15 / gui 17 全绿 + tsc 0 + dist 重建。

> **v48.13 实施追记（2026-09-20，真实 run 法医调查 + ChatGPT P1–P4，D45）**：**根因＝评审闸门把「描述标签」当成「严重度」**。本机真实库最近一次完整 run（`ea70cad5`，2026-09-19 20:52:49→21:02:05，材料 2,757 字，32 次调用，墙钟 556s）里评审模型**明确返回 `status:"pass"`**、summary 肯定「整体忠实呈现作者…递进组织…非目录复刻…不影响结构质量」，两条 issues 均为 `severity:"low"`；但 `runReview` 无视模型 status，用 `type==="topic_list" || type==="hollow_parent" || severity==="high"` 重算 → `x72` 的 `type=topic_list`（severity=low）触发无条件 fail → run 停在 `waiting_user/review_failed`，**72 节点成品被扣在 `staging` 不激活**。而评审提示词【纪律】第 1 条恰恰写着「fail 仅用于明确缺陷；轻微问题用 review 并列 issues」——**引擎比它自己的提示词更严，并改写了模型的判断**。同批第二个缺陷：`section_ready` 无条件 `isActive=true`，把上一轮 `7901b94d` 产出的 **85 节点 complete 成品顶成 inactive**，用户实际看到「图从 85 个节点缩回 10 个 + 语义评审未通过」。修复（P1）：① **severity 才是闸门、type 只是描述标签**——仅 `severity==="high"` 阻断；模型显式 `status=fail` 且给出 issue 时作**单向棘轮**仍阻断（模型说 fail 不作废，模型说 pass 不能抵消 high）；其余有 issue → `review`（**不阻断但记录**，进 `run.output.metrics.reviewStatus/reviewIssues`，此前通过路径直接把 issues 丢弃）。② **Published / Candidate 发布模型**——`publishNow = section_ready ? !publishedElsewhere : !partial`：已有别处发布版本时首层只作**候选**（落库可查看、不激活），续跑完成后才**事务性发布**并让旧版退位；无任何历史版本时首个首层作 provisional 发布；partial 永不发布（不伪装完整）。run 输出新增 `published` / `candidate` / `heldByPublishedMapId` 留痕。③ **广播契约自足**（P2 地基）——所有进度广播（含 `coverage_audit`/`expand`/`retry`）一律携带 `runId`/`documentId`/`title`，且**终态失败与待确认也必须广播**（`failed`/`review_failed`/`cancelled`——此前失败只回给 IPC 调用方，用户离开工作区后完全不可见）。**验收**：m15r engine 143（+18：E23 评审闸门 5 例 / E24 发布模型 6 例 / E25 广播契约 6 例 + E22 既有）/ core 79 / db 30 / layout 15 / **activity 21（新）** / gui 18（+1：空闲时指示器不得渲染）全绿 + tsc 0 + dist 重建。**仍未实施**：P3 应用重启续跑——见 §9.1 M15 v48.13 条目。

> **v48.13 P4 实施追记（2026-09-20，用户拍板「改成增量评审」后实施，D46）**：**「展开」与「深化」正式分家**。① **展开＝纯 UI**：节点已有 children 时的折叠/展开是渲染层状态，**零 AI 请求**（`deepen()` 对已有子结构的节点直接返回 `invalid/already_expanded` 且不消耗调用，E26⑤ 锁定）；**深化＝生成**：节点尚无更深结构、且有 sourceSpans 时才创建后台任务。② **增量深化＝以已存地图为基底的作用域受限 generate**：不重建（不跑 section、不依赖分片缓存）、不跑 merge/global（上层结构已在原图定稿，重跑只会让未深化分支跟着变）、不跑 editorial（整树润色按次点击重跑不划算）、不做覆盖审计/补漏——差异共五处，全部在代码内显式标注；收益是「不必等整图跑完就能先看某一支」（实测一次深化 = 2 次调用：目标节点的分片深挖 + 1 次增量评审）。③ **增量评审**：评审范围 = 目标节点 + 本次新生成的子孙 + 必要父/兄弟上下文，payload 明确声明「材料其余部分未改动、不在本次评审范围内」；**结果只决定这一支能否发布**——单分支评审未通过时 run 停在确认、地图行原封不动、其余分支完全不受影响（E26⑧ 锁定），这是「按需深化」与「整树闸门」冲突的正解。④ **原地发布**：深化就地更新同一版本行（版本 id 不变、卡片溯源不断链），`isActive` 保持不变（深化不改发布关系）。⑤ **UI 明确区分「没画出来」与「没有更深的内容」**：可深化节点在画布上带＋号徽标（与折叠 +N 同槽位、二者互斥），节点详情给出「深化此节点」按钮与说明，终态节点明确写「已是终态（原子结构/纯过渡文字）」；画布提示条同步说明区别。⑥ **已知代价（不粉饰）**：深挖指纹 `expandFingerprint` 含 depth，而首层图没有 global 根、同一节点 depth 比整图浅一层 → 深化用掉的深挖缓存与之后的全量重生成**不共享**，该分支会被重新分析；取舍可接受（一次深化只 1～2 次调用），已写进代码注释与特征化测试 E26⑦。**验收**：engine 162（+19：E26 深化 19 例）/ core 79 / db 30 / layout 15 / activity 21 / gui 23（+5：可深化徽标 / 深化入口互斥三态）全绿 + tsc 0 + dist 重建。

> **v48.13 P3 实施追记（2026-09-20，D47）**：**被打断 ≠ 失败**。① 启动对账从「收敛为 `failed_timeout`」改为收敛为 **`interrupted`**（`error_code='interrupted'`，文案写明「已完成分片保留在缓存，继续生成零重复计费」）——把「关掉应用」记成一次超时失败，既误导用户也让账本失真；② 新增 **`listResumableMaterialMapRuns()`**（连表带出材料标题）：可续跑 = `interrupted`（被关闭打断）+ `section_ready`（首层就绪待续跑），走 `mindmap:pendingRuns` IPC；③ 渲染层启动时用该列表**播种全局指示器**——应用重启后用户看到的是「导图生成被中断 · 可继续」，而不是什么都没有；④ 指示器点击打开导图时携带 `resumeRunId`（App→Reader→工作区），工作区收完原文即以**同一 runId** 续跑（已完成分片全部命中缓存，零重复计费）；首层就绪的 run **不自动续跑**——按需深化（P4）由用户点具体节点决定；⑤ 只有**正在跑**的任务才显示「取消任务」（被中断/首层就绪给「取消」是假动作）；⑥ 播种只接受 `interrupted`/`section_ready` 两种状态，其余一律不播种（宁可少提示，也不能把已完成的图显示成「被中断可继续」——E26/A6 测试锁定）。**验收**：engine 162 / core 79 / **db 37（+7）** / layout 15 / **activity 29（+8）** / **gui 24（+1：重启后可续跑运行被识别）** 全绿 + tsc 0 + dist 重建。

> **v48.13 P5 真实运行审计与修复（2026-09-20，用户实测「优绩主义」重新生成后追问三件事，D48）**：现场数据（run `50074faf`，20:55:21→21:03:08，墙钟 **466.7s**）——首层 section×2 = **73s** 就绪，其后**自动深挖 22 次 + editorial + review = 393s**，收尾时一次 ECONNRESET 使整轮降级 `partial:call_failed`。三个缺陷 + 一个产品口径修正：① **「已取消」误显（P2 引入的真 bug）**：引擎除终态外还广播**子事件**（`expand` 每个深挖作业一次 / `coverage_audit` / `retry` / `waiting_model`），P2 首版把 `stage` 直接当阶段存 → `describeTask` 落到 `default` 分支 → 运行中的任务被显示成「已取消」（用户在一次正常运行里看到两次）。修：`normalizeStage()` 白名单（子事件 → running；未知事件**沿用上一次、绝不编造状态**）+ `default` 返回 null 兜底。② **一次失败把可用成果作废**：旧规则「partial → 不发布」在本轮更新的是**当前已发布那一行**时（续跑/深化）会把用户手上已经能看的图置为未发布——73 节点整张失联（文档没有 active 版本）。修：**已发布的版本不因一次失败而消失**（`reuseIsPublished` → partial 也保持发布），降级事实由 run 行 `completeness=partial:call_failed` 如实留痕。③ **并发写同一行地图**：主 run 续跑深挖期间用户又点了某节点「深化」，两个 run 各以不同基底装配、先后写同一行，先完成的被覆盖。修：引擎级**同材料同范围串行化守卫**（`findRunningMaterialMapRun`；同一 runId 续跑不算冲突）+ UI 侧运行中禁用深化。④ **产品口径修正：首层就绪后不再自动续跑整树深挖**。首层 73s 即已可用，自动深挖让它又多跑 393s，而用户以为图出来就该结束了——这与 D46 的「初始只需足够深入、最深的枝条按需展开」直接冲突，也与本轮真实体验一致。改为：首层就绪即 `phase=done` 可看可操作；画布带＋号节点按需深化；想一次跑完的人用侧栏**显式「自动深挖全部（约 N 次调用）」**（原能力保留，但不再默认发生）。⑤ 指示器：点「打开导图」后（非运行中）本条提示即消失——用户已经去看图，提示的使命结束；仍在运行的除外（那时用户要的是看得见的进度）。**验收**：engine 174（+7 E27 发布规则回归 / +5 E28 串行化守卫）/ core 79 / db 37 / layout 15 / activity 34（+5 A7 子事件归一）/ gui 24 全绿 + tsc 0 + dist 重建。

> **v48.13 P6 空态自救与入口可见性（2026-09-20，用户反馈「成果不见了、也找不到历史版本、也找不到自动深挖全部」，D49）**：用**探针复现**（启动真实应用 + 预置「只有未激活版本」的库）确认了两处入口被条件挡住——这本身也是个教训：上一轮我写下「历史版本里就有」时**没有验证**，实际那是错的。① **历史版本区被两重条件挡住**：它渲染在 `hasKey ? … : …` 分支内、又嵌在 `phase === "done" && structure` 里——于是「无 Key」或「没有已发布版本」时用户看不到任何版本入口（真实现场：一次失败的收尾把已发布版本置为未激活，用户重开只看到「尚未生成」，以为 73 节点成果丢了）。修：**版本区移出这两重条件**（它是纯只读操作），任何阶段/无 Key 都可见；空态且 versions 非空时明确写出「当前没有已发布的版本，但历史里有 N 个——点下面任意一版即可激活查看（成果没有丢）」。探针验证：点击版本 → `emptyStill=false`、画布渲染出节点，**成果真的找得回来**。② **「自动深挖全部」可见性条件过窄**：此前只在 `phase === "done" && expandPlan && plannedCalls > 0`（＝刚跑完首层的那一瞬间）出现，关掉工作区再进来、或打开一张旧图就永远不出现。修：改为按**当前图里可深化节点数**（无子结构 ∧ 有 sourceSpans）决定，并在没有本轮 run 时也能直接走完整管线。③ **版本行版面**（用户反馈「标题格太小、字挤在一起；删除按钮只有两个字却占很大地方」）：标题与时间拆成两行，标题撑满可用宽度并可换两行（`-webkit-line-clamp: 2`）+ `min-width: 0` 允许收缩；删除按钮改为固定 44px 不参与拉伸。**验收**：engine 174 / core 79 / db 37 / layout 15 / activity 34 / **gui 30（+6：空态恢复 4 条 + 自动深挖全部可见 1 条 + 第二本材料前置）** 全绿 + tsc 0 + dist 重建。

> **v48.13 P6.1 版本行版面修复（2026-09-20，用户截图反馈，D49 追加）**：**根因是 CSS 特异性**——既有规则 `.mindmap-versions button`（特异性 0-1-1）把 width:100% 也打给了**删除按钮**，压过 `.mindmap-version-del`（0-1-0）的 width:44px。于是两个按钮都想要整行宽：标题格被压成 min-content（时间逐字断行成一条竖条，用户截图正是如此），删除按钮撑满整行并**溢出区域边界**。修：把该规则收窄为 `.mindmap-versions .mindmap-version-pick`（选择版本那一格），激活态的 `.mindmap-versions li.is-active button` 同步收窄。**并补几何断言**（此前只断言「元素存在」，正是这类尺寸错误漏网的原因）：删除按钮 ≤56px、标题格 ≥ 行宽−删除格−间距、两者均不得溢出区域边界；截图核验（真实应用 + 预置一长一短两个未激活版本）：标题两行截断、时间独立一行、删除格 44px 且完全在界内。**验收**：engine 174 / core 79 / db 37 / layout 15 / activity 34 / **gui 32（+2 几何断言）** 全绿 + tsc 0 + dist 重建。

> **v48.13 P6.2「自动深挖全部」禁用条件修复 + 文案口径对齐（2026-09-20，用户实测，D49 追加）**：用户反馈「生成初步导图后按钮变灰、悬停出禁止符号、点不动」。根因：`disabled={deepenBusy || runInFlight || !lastRunId}` 里的 **`!lastRunId`** —— `lastRunId` 只在本次会话生成/续跑过才有值，重新打开工作区看已有图时它必然是 null，于是按钮常驻灰色；而 `handleDeepenAll` 早已支持「没有 run 时回退完整管线」，条件与实现自相矛盾。修：禁用只拦「正在跑」与「正在深挖」，禁用时 title 说明原因，文案按状态区分。（生成之前不显示是**正确**的：那时还没有图，没有可深化的节点。）同批纠正两处**被 P5 改坏的口径**：① 生成前提示原写「逐层深挖至作者组织单元的原子结构」（默认只到首层后已不成立）→「生成先落地一层可用结构（首层），更深的枝条按需深化」；② 预览的「计划调用」原把终编辑与评审算进首次生成 →「首次生成（首层）：N 次结构分析；终编辑与评审等后续完整生成/自动深挖全部时才跑」。**验收**：engine 174 / core 79 / db 37 / layout 15 / activity 34 / **gui 33（+1：打开已有图时可点击）** 全绿 + tsc 0 + dist 重建。

> ### v48.13 收口（2026-09-20，D45–D49 全部落地）——**本节现行契约以此块为准**（其上前各版本追记仅作沿革与证据）
>
> **① 生成节奏**：初始生成**只落地一层可用结构**（section 首层，小材料约 1 分钟级），随即可用；更深的枝条**按需**深化——画布带＋号的节点 → 详情「深化此节点」（一次 = 该节点分片深挖 + 1 次增量评审），或由用户**显式**点侧栏「自动深挖全部（N 个可深化节点）」一次跑完。**默认不为用户看不到的细节预先付费。**
>
> **② 展开 ≠ 深化**：已有子结构节点的展开/收起是**纯渲染层操作、零 AI 请求**；只有「尚无更深结构 ∧ 有 sourceSpans」的节点才谈得上深化（引擎对前者直接返回 `already_expanded` 且不消耗调用）。UI 三处区分「没画出来」与「没有更深的内容」：＋号徽标 / 「深化此节点」按钮 / 终态说明。
>
> **③ 语义评审**：**severity 才是闸门**（`severity==="high"` 是唯一标签无关的硬阻断，`type` 只是描述标签）；模型显式 `status=fail` 且给出 issue 时**单向棘轮**仍阻断（模型说 fail 不作废，模型说 pass 不能抵消 high）；其余意见**不阻断但留痕**（`metrics.reviewStatus/reviewIssues`）。初次生成评审整树；**深化只评本次新增分支 + 必要父/兄弟上下文，结果只决定这一支**（单分支失败不连坐整图）。确定性完整性校验（JSON 合法/节点唯一/父存在/无环/span 合法/引文可逐字定位）始终是独立硬门，不因模型 pass 放行。
>
> **④ 发布模型**：Published / Candidate——首层候选**不得顶掉**已发布版本（无任何历史版本时，首个首层作 provisional 发布）；续跑/深化**原地更新同一版本行**且**不改发布关系**；**已发布的版本不因一次失败而消失**（partial 也保持发布，降级由 `completeness=partial:*` 如实留痕）；partial 永不作为新版本发布（不伪装完整）。
>
> **⑤ 任务生命周期**：由**主进程**持有——离开工作区/回正文/切界面都不取消（只有显式「取消任务」才取消，且该入口只在任务真正在跑时出现）；**同一材料同一范围串行化**（已有未收敛 run 时拒绝再起一轮，`code: busy`；同 runId 续跑不算冲突）；应用重启时未收敛的 run 收敛为 **`interrupted`（不是失败）**，启动即播种右下角指示器，点击打开导图并以同 runId 续跑（缓存命中、零重复计费）。
>
> **⑥ 入口与呈现**：右下角**全局活动指示器**（收起态 24px —— v48.14 / D50 UI 收口时从 22px 提上来，
> 22px 既不在 8px 网格上也低于 WCAG 2.2 的 24×24 最小目标；hover 与键盘 focus 都能展开、Esc 收起；完成态「导图已更新」点击直达；**打开或关闭后本条即消失**，仍在运行的除外）；**历史版本区任何状态都可见（含无 Key）**，空态明确告知「当前没有已发布的版本，但历史里有 N 个——点一版即可激活查看（成果没有丢）」；无 Key 只读降级（可阅读/展开/跳正文/制卡，生成入口禁用并说明）。
>
> **⑦ 不变式**：导图不写知识图谱、不产 mastery、不进 FSRS 与推荐（D40 至今不变）；`partial` 不伪装完整；任何阶段都**不把「未继续生成」显示成失败**；本版新增的一切深挖都必须由用户动作触发，不得回潮为默认自动深挖整树。
⑨ **单章兜底**——TOC 顶层塌缩后分析树仅剩 scope 根时（无 # 标题书），根自身由一次 section 调用负责全文首层分析（global 需有已分析子节点才触发，单章书不满足——修复实测「零调用/字数 0」）；⑩ **生成范围选择暂撤**（恒整份材料）——章节识别尚不精确，待统一识别能力完善后恢复。

1. **两图分立（最高定位，用户拍板，v44 不变）。** **材料知识导图＝材料的作者视角**——「这份材料本身是如何组织知识、观点、论证、解释与展开过程的」，每份材料独立产物；**用户知识图谱＝用户大脑视角**（§4.6 / §4.7 的 `knowledge_points` + `knowledge_relations` + 证据）。**导图永不直接写入知识图谱**：不产掌握度、不产学习稳定性、不直接创建 KP/图谱节点/关系、不进 FSRS、不影响推荐、不参与复习调度。**唯一合法联结链**：材料 → 导图节点 → 用户点击「就此制卡」→ 既有制卡管线 → 用户实际复习 → Review Log → KP → 用户知识图谱。
2. **入口、范围与覆盖（全屏 Overlay 工作区，v47.2 决策保留）。** ① 阅读器目录按钮旁新增「**导图**」按钮；② 点击切换**占满软件窗口的全屏 Overlay**（挂 Reader 外层、**内核不销毁**，按钮变「正文」返回即原位，无需位置恢复链）；③ 生成前选**范围**＝本地已解析章节层级树的任意子树（整书 / Part / 章 / 节），**不得让 AI 判断章节范围**；无目录材料仅支持整书范围（按提取单元分片）；④ **覆盖粒度**三档（概览/标准/详细）——粒度控制的是**语义结构的详细程度**（分析层级深度），**永不截断用户已选材料原文**；⑤ 操作全部收进**右侧边栏**（生成/重生成/状态/缓存/节点信息），画布保持空旷。
3. **生成管线＝自底向上递归归并（作者组织单元，D41-①③）。** 废弃「知识点候选列表」中间表示。AI 首要输出是**作者组织单元**：回答「**作者正在这里做什么**」——`authorial_role`（封闭枚举：introduce/distinguish/decompose/sequence/cause_effect/problem_solution/claim_evidence/question_answer/general_specific/contrast/example/application/critique/synthesis/extension/parallel/summary，禁止模型自造类型）+ `central_question` + `main_move` + `progression` + `relation_to_parent` / `relation_to_siblings`（非根）。管线：**本地结构解析**（零调用：TOC → 提取单元树 + 文档线性化）→ **单元分析**（scope `material-map-section`）→ **逐级归并**（scope `material-map-merge`：章级 → Part 级 → …，父级输入＝parentOwnedText + 直接子节点已完成的结构分析 + TOC 信息，禁止把父级全文重复发送；**归并节点必带 `grouping_basis`**（封闭枚举 sequence/causal/contrast/hierarchy/problem_solution/claim_evidence/general_specific/parallel/synthesis + explanation + evidence_refs）——无法证明为什么同属一个高级结构就**不许强行合并**；纯复述子节点清单视为低质量）→ **全书归并**（scope `material-map-global`：输入＝TOC + 各 Part/章已完成 semantic maps + evidence 引用，**不发全书原文**）→ **editorial 终编辑**（scope `material-map-editorial`：**禁止读取全书原文**，只收最终结构 JSON + evidence + TOC；仅允许删重复节点/并同义结构/修笼统标题/修层级，**禁止创造新的无证据内容、禁止重新「创造一张导图」**）→ 本地校验 → 布局渲染。
4. **取文与 parent-owned text（D41-②）。** 恢复内核 **`getSectionText`** 全格式取文能力（foliate 走 `book.resolveHref` + `sections[].createDocument()`；PDF 逐页 `getTextContent`——两引擎对同一文件输出确定）。**文档级线性化**＝按提取单元顺序拼接的确定性坐标系（每单元一段 [start, end)，其 hash 即 sourceRevisionHash 依据）；**parentOwnedText ＝ 线性化区间上的集合差**（parentSourceRanges − descendantOwnedRanges），**严禁字符串减法**（string.replace / 查找后删除一律禁止）。EPUB 多级 TOC 指向同一 href 时，以**共享文本区间的最深 TOC 节点为实际提取 owner**，上层节点保留完整 tocPath 但无文本 ownership。单个提取单元过长时**只按段落/块边界分片**，禁止任意字符硬切。
5. **证据契约（D41-④：direct / compositional 双证据 + 命中数裁决）。** 节点**标题允许抽象命名**（如「概念建立」「问题 → 机制 → 应用」），**不要求 title ∈ sourceText**；硬约束是**节点的语义主张必须可追溯到一个或多个逐字 evidence**。**direct evidence**＝quote 逐字存在于该节点所属提取单元的抽取快照；**compositional evidence**＝高层归并节点引用同图内后代节点的 exact evidence（引用必须存在、禁悬空）。**裁决**（offset 仅作 AI 提示，不作裁决依据）：对 quote 在快照中做逐字匹配——**0 次命中 → REJECT；1 次命中 → ACCEPT；多次命中 → 以 AI offset 消歧，取包含或最邻近且唯一的命中，不能唯一确定则 AMBIGUOUS**（证据有效性成立但标记 `positionAmbiguous`，跳正文降级为只到单元锚）。落库保存 `quoteHash` + 最终本地确认的 `matchStart/matchEnd`；**抽取快照文本不入库**（sql.js 全量落盘，防库膨胀），只存快照 hash，校验时本地重抽取并先比 hash，不一致则用 quote 重新定位。**禁止模糊搜索替换、禁止自动改写成相近句子、禁止猜测模型想引哪句。**
6. **本地确定性校验器（校验先于一切 AI 评审）。** schema 与 ID / 树结构（全节点 root 可达、parentId 存在、childIds 与 child.parentId 双向一致、无环、层级连续不断裂）/ 非 root 节点须有 ≥1 条 evidence（direct 或 compositional）/ quote 逐字与命中数裁决（上条）/ 编造章节锚拒绝 / 无据关系 REJECT / 孤儿节点 REJECT / 同层大量重复标题警告 / 笼统空盒父节点（「介绍/内容/相关知识/其他/总结/基础/核心」类，除非材料本身如此）警告与 REVIEW。校验全不过 → 不渲染、不进语义审查。
7. **存储（3 表）与版本/缓存/增量（D41-⑤）。** `material_maps`（每版本一行：id / documentId / scopeAnchor+scopeKind / granularity / **structureJson（节点+边+证据内嵌）** / sourceRevisionHash / promptVersion / provider+model+modelConfigHash / **nodeRemapJson** / isActive / 软删除与审计列）；`material_map_shards`（分片缓存，逻辑键＝documentId + 单元锚 + 运行类别 + granularity + promptScope + promptVersion + 单元文本 hash + **provider + model + modelConfigHash**——换模型或关键生成参数不得复用旧结果；命中要求全键一致，升版即失效重补）；`material_map_runs`（状态机 / 预计与实际 token 与费用 / repair 次数 / 错误码）。**版本化**：重新生成不删旧图，新成功版本置 active，**新版本失败旧图继续展示**；`sourceRevisionHash` 变化的单元局部失效（旧地图版本保留可回看）。**增量重生成**：只有变化单元及其祖先归并链重新调用 AI，其余分支用缓存。M2 备份为整库文件自动覆盖；**SVG 只是视图、JSON 才是数据**。
8. **成本预览与实际记录（同一 payload builder，D41-③ 配套）。** 发送前预览与实际发送**必须使用同一个 `buildExactPromptPayload` 产物**，禁止预览一套拼接、发送另一套。预览展示：材料 / 范围 / 覆盖粒度 / 已有缓存命中 N/M / 预计新调用次数 / 待发送原文字数（**精确**）/ 预计 Token（**估算**，沿用 estimateTokens 口径并明示非计费精确值）/ 预计费用（内置默认模型单价 + settings 可编辑，币种随单价）。provider 返回实际 usage 时回记 runs 并显示「预计 ¥X / 实际 ¥Y」；无 usage 时明确标注估算。ai.js 同批增补：SSE 末块 usage 解析（全应用受益）、AbortController 取消链、错误机读 code（timeout / rate_limit / network / http / json）。
9. **渲染与交互（D42）。** AI 只输出结构 JSON，**永不输出坐标/颜色/SVG/动画**。本地确定性 tidy tree 布局（自研纯函数、无随机源，同一 JSON 布局恒等，布局 100 次逐字节一致入测试）+ SVG 渲染器（只读 validated MaterialMap）。视觉服从瑞士风 Token：单 accent（root 为全图唯一 accent 焦点）、节点 card-outlined（paper + 1px hairline）、正交肘形连线、直角、无阴影渐变、8px 基线、≥11px 文本、深色模式、键盘可达（Tab 进入 / Enter 选中 / Space 展开折叠 / 方向键移动 + 焦点环）、`prefers-reduced-motion`。**语义缩放 7/12/24**：默认 root + 约 ≤7 个一级结构，逐级展开 ≤12 / ≤24，大图靠折叠/缩放/搜索而非全展开；zoom out 隐藏 summary 等低优先级信息只留标题。交互：滚轮缩放、拖动平移、fit、展开/收起、选中、focus 居中、节点详情侧栏（标题/作者组织作用/展开方式/原文依据+跳正文/学习状态+就此制卡）、**本地搜索**（title/summary，命中后展开祖先+focus+选中，不调 AI）、**自包含 SVG 导出**（无 JS/无外链/无远程字体/坐标固定）。**图标**＝现有内联 SVG 优先，缺失的将 Lucide path 本地内嵌（ISC、零依赖），不引入 lucide-react（D42-④）。
10. **制卡联结与学习状态（节点身份 remap，D41-⑥）。** 节点「就此制卡」→ **既有 createAcceptedCard 管线**（不复制新制卡系统）：注入**有界** materialMapContext（当前节点 → 父 → 祖先路径 → 必要兄弟 → 节点 evidence → 材料级结构摘要，≤1200 字，禁止整图无限塞入）；`cards.context_ref_json.mindmapNodeId` 溯源 + `siblingKey = act:mindmap-<nodeId>`（创建时点值）。**重生成不保 nodeId 稳定**：新版被用户接受时执行本地确定性 remap（提取单元覆盖重叠 → evidence quoteHash 重叠 → 标题精确相等，按序打分），oldId→newId 存 `nodeRemapJson`；**卡片永不改写**，学习状态查询沿 remap 链解析；未匹配旧卡留在旧版本语境；title 不作身份。节点可显示「已有 N 张卡 / 知识点已存在」（只读查询 `knowledge_points` 真实数据），但学习状态**只映射显示**——不得改变地图结构/节点位置/组织关系（用户背熟不自动变绿、不移动、不消失）。
11. **失败状态机、修复与取消（D41-③）。** 状态：pending / estimating / waiting_user / running / validating / completed / failed_network / failed_timeout / failed_rate_limit / failed_json / failed_validation / cancelled。首字符静默约 40 秒是已知模型行为——显示「正在等待模型响应…」，**禁止虚假进度百分比**。模型输出 JSON 语法错误最多允许一次 **STRUCTURE_FORMAT_REPAIR** 调用（不加节点/不加证据/不改语义，只转合法 JSON；仍失败即 failed_json，不偷偷继续；额外调用计入实际费用）。**取消**＝停止尚未开始的请求 + 终止可取消的请求 + **已成功完成的分片照常入缓存** + 不产出半成品 active map + 旧图保留；再次生成从缓存续。**任何失败（超时/JSON/证据/网络）都不覆盖或删除旧地图。**
12. **合规。** 全书/章节文本发送 AI ＝ 用户主动触发 + **发送前预览**（上条）+ 用户自有 Key；无 Key 时可读降级——可阅读已有导图/展开折叠/节点查看/跳正文/看学习状态，生成与重生成按钮 disabled + 说明「配置 AI Key 后可生成新的材料知识导图」（**不弹错误弹窗**）；导图永不自动生成、永不做逐条确认流（生成的是分析视图，节点制卡仍逐张经确认面板）；导图永不作为推荐/掌握度/调度输入（与 §4.18-14 ⑥ 同口径）。

---

# 第二部分 Design System（设计系统）

## 5.1 瑞士风基线

唯一视觉规范：`docs/swiss-international-style.md`（Token、字号阶梯、灰阶、单一焦点色、直角无阴影、Lucide 图标、禁止清单、五项必查）。全局主 accent 锁定 IKB 蓝 `#002FA7`（深色提亮 `#5B7FE8`），用户可在设置中自定义（写 `--accent` 变量）。所有色值/字号/间距走 `src/theme.css` Token，业务组件禁止硬编码。

设计哲学七条：单一焦点色 / 极致字号对比（越大越细）/ 无衬线 / 直角纯色 / 8px 网格 / hairline 分割 / 克制。

**Token 求值层纪律（v48.14 / D50 新增，硬性）**：自定义属性里的 `var()` 在**声明它的那个元素上**求值，之后按求得的结果继承。两条后果必须遵守——① **引用未定义的变量会让整条声明作废（IACVT）**，不是"这一项没生效"：实测踩过 `--sp-5`（margin 静默归 0）、`--fs-title`（词典头词塌陷）、`--card-pad`（导图画布 padding 归 0）、`--text-on-accent`（深色覆盖层文字 1.09:1 完全看不见）；② **派生 Token 必须与它依赖的 Token 声明在同一层**——`:root` 里写 `--accent-soft: color-mix(… var(--accent) …)` 会被 IKB 钉死，皮肤/主题在 `body` 上改 `--accent` 带不动它，同一界面凭空多出第二个焦点色。故 `--accent-soft/-hover/-pressed`、`--text-primary`、`--text-helper`、`--shadow-panel` 一律在 `body` 与 `body.theme-dark` **各重算一次**。**规则：凡会被上层（皮肤 / 主题 / 内联）覆盖的 Token，其派生档必须在上层重新声明一次。** 审查配方：全仓 `var(--x)` 引用与 `--x:` 声明做差集，**差集必须为空**。

③ **反向推论（v48.14 补，深色自定义 accent 缺陷）**：同一条求值机制也决定了**运行时内联覆盖的目标元素**。`--accent` / `--accent-on` 的深色档声明在 `body.theme-dark` 上（不在 `:root`），因此运行时写入自定义强调色**必须写 `document.body.style`** —— 内联样式优先级高于任何选择器，才压得住那条声明；只写 `documentElement` 的话，自定义色停在什么都不画的 `:root` 上，整个 `body` 子树被 `body.theme-dark` 重新声明回主题默认蓝，表现为「深色模式下自定义颜色不生效、全部回落蓝色」，而浅色模式因为 `body` 不声明 `--accent`（正常继承）反而看起来是好的。**规则：内联覆盖某个 Token 时，必须写在「该 Token 最深的那条主题声明所在的元素」上或其内联样式层，而不是习惯性地写在 `:root`。** 该缺陷自 v20 起即存在（601aa93 差分实测同样失败，非 v48.14 引入），由 `tests/accent.gui.mjs` 锁定。

## 5.2 顶栏与导航（v12.2 定，方案 A）

- 顶栏左侧**文字导航**：`书架 / 队列 / 复习 / 卡片 / 日记 / 数据`（v36 增「日记」），当前项 accent 色 + 2px 底线；常驻可见，点击切换视图。
- **无品牌字块**（「渐进阅读 INCREMENTAL READING」已删）；切换页面后顶栏以浅色小字显示当前位置（`topbar-title`，hairline 左分隔），不与导航高亮重复表达。
- 右侧仅设置齿轮 + 窗控三键。导航按钮 `no-drag` 可点；顶栏空白与标题区保持 `drag` 可拖窗口。
- **页内禁止重复导航文字**（如复习页不再出现「REVIEW 复习」大标题）；页内只保留右上角/左上角计数（`review-count`）。

## 5.3 页面排版规则（网格系统 + 极简）

- 内容版心 720px（长文单列测量宽），8px 基线，spacing Token `{4,8,12,16,24,32,48,64}`；**v48.14（D50）补半档**：确需 2px 时一律写 `calc(var(--sp-1) / 2)`，**不写裸 `2px`**（用于行内 code 上下留白、chip 内沟、超密列表行距等光学微调）；`1px` 只允许出现在 hairline（描边/分隔线）与「让底色透出来当分隔线」的 gap 上。
- 复习页：kicker/标题行已删；卡面正面/背面统一 **26px / 1.5 行高**（markdown 子元素 `font-size:inherit` 防回落），hairline 分隔问题与答案；左对齐非对称留白。
- 评分模块：4 等分 grid，min-height 56px；**四按钮样式统一**（灰底 + 左缘 4px 语义色条：Again 红 / Hard 黄 / Good 蓝 / Easy 绿），无填充差异；hover 统一 grey-2；键盘焦点环 2px accent。
- 设置页：左侧锚点导航 + 内容列；说明性文字只保留「操作必需」（Key 获取链接、数据门槛、当前状态），删除教程式长文。
- 文字规则（better-typography）：正文 1.5-1.7 行高、`text-wrap` 按角色、数字 tabular-nums、Meta ≥12px、正文 ≥14px。
- **书架网格（v48.15 / D51，硬性）**：列宽一律 `repeat(auto-fill, minmax(min(100%, var(--shelf-min)), 1fr))` + `align-content:start`，**禁止**再写死定宽（`repeat(auto-fill, 200px)`）或配 `justify-content:start/space-between`——前者把 0–223px 余量整块甩成右侧空白，后者把余量摊进间距使间距不再守 Token。密度三档只换 `--shelf-min` 一个 Token（紧凑 152 / 标准 200 / 宽松 248），列数由容器宽度自然决定，不需要 JS 断点表。验收口径：**任意窗口宽度下"内容宽 − 轨道总宽 − gap 合计"必须为 0**（`tests/shelf.gui.mjs` 有几何断言）。
- **吸顶页工具条（v48.15 / D51）**：需要在滚动中常驻可达的页面级控件（视图切换 / 密度 / 排序方式 / 主行动）统一放 `.shelf-bar`——`position:sticky; top:0; z-index:var(--z-sticky)` + `--paper` 底 + 下缘 hairline，左=计数与面包屑、右=主行动，主按钮恒在最右。**这是"主行动"的唯一位置**：同一屏不再往内容区里塞第二个主按钮（空态亦如此，见 §5.4）。控件同取 32px（compact 档，与顶栏同档），不往内容区放 40px 档；页内仍禁止重复导航文字（§5.2），故工具条左侧只留计数，不出现「书架 / SHELF」大标题。
  - **窄窗口退让阶梯必须单调**（容器查询 `container-name:shelf`，阈值按容器宽 = 窗口 − 内边距 64 − 滚动条约 15）：容器宽 900 以下收起密度档、1100 以下收起提示文字与小键标、1280 以下收起分组小标签。反例已实测踩过：三档阈值各回各的（620/720/840）会让 760 与 900 两处挤成两行。

## 5.4 组件规范

- **评分按钮**：语义只以色条表达（见上），数字用 mono + tabular-nums。
- **EditableText（内联编辑）**：React 不描述子节点的「裸壳」div（命令式写入 innerText），杜绝 contentEditable 与 React 共管 DOM 导致的 removeChild 崩溃与内容叠加；点击出光标、失焦落库、无任何框线；**正面点击=翻面，翻面后问题与答案区才可编辑**。
- **cloze 编辑回写**：问题区编辑的是显示文本（当前挖空为 `[…]`），落库时 `[…]` 自动还原为原挖空语法并同步 noteText；其他挖空若被改动则降级为普通文字（可接受）。
- 跳转链接：**`跳转原文`**（accent 色 Meta 档文字按钮，hover 下划线），出现于复习卡 meta 行、队列摘录条目与卡片浏览详情（仅带锚点数据时）。**v48.14（D50）文案修订**：原锁定为 `跳转原文 →`，尾部箭头已删——按钮文字本身即标签，箭头属装饰性字符图标（`docs/swiss-international-style.md` 禁止清单「不得用 ✓ ✗ → ‹ › ⋮ ★ 充当状态符或图标」），且跨平台字形宽度不一致；指向语义由 hover 下划线与所在上下文承担。**跳转是「现场查看」语义（v19）**：跳转会话中阅读器不写阅读进度与阅读字数统计（App 对 jumpAnchor 会话不传 onProgress），切出后记录的位置仍是上次真实阅读位置，不会被跳转位置覆盖。
- **图片聚焦层（v25）**：全屏 fixed 覆盖层（`--z-toast - 1`），背景 `rgba(10,10,10,.55)` + `backdrop-filter: blur(10px)` 实现「周围区域模糊」；图片由原位置 FLIP 飞入居中（240ms `--ease`，reduced-motion 关闭过渡）；顶部居中悬浮工具条（paper 底 + hairline 边框 + `--shadow-float`），工具按钮选中态用 accent-soft 底 + accent 边框；选区图元统一走 `.occlusion-shape`（考察区 accent 填充、其余 ink 填充、预览 accent 描边，`vector-effect: non-scaling-stroke` 保描边不随百分比坐标系拉伸）；选区状态一律以**相对图片百分比**保存，仅在读取指针位置时做像素换算（`src/lib/occlusion.ts` 为唯一换算口）。
- **UDC 领域选择（v25，M5）**：chip（accent-soft 底 + accent 边框 + 主领域标「主」）+ 受控清单下拉（复用 `.dd` 直角下拉样式，`udc-menu` 限高滚动），上限 2（`UDC_MAX`）。
- **快速记录窗口（v36，M8-A）**：**独立 BrowserWindow 单例**（`560×380`、`frame:false`、`alwaysOnTop`、`skipTaskbar`、`resizable:false`、`show:false` 起）——不是主窗口内的弹层；每次呼出按**鼠标所在屏幕**水平居中、顶部 18%，渲染层 `capture:ready` 就绪后才 show（杜绝白闪）。
  - 结构：header 40px（左「快速记录」Meta 档 + 右当日 meta `09-14 周日 · 今日已记 3 条`，mono tabular-nums；header 为拖拽区）+ 编辑区（纯 textarea 源码编辑，18px/1.7，`--text-primary`，无边框无装饰）+ footer 44px（hairline 上边；左＝保存状态：实心 accent 方块「已保存 HH:mm」/ 空心方块「输入中」/ `--error` 「保存失败，重试中」；右＝`发送` 主按钮 + `Esc 隐藏` 提示）。
  - **唯一 accent** 只出现在发送按钮与保存状态点；圆角 0、无阴影（除 `--shadow-float`）、暗色随 `theme.mode`、`prefers-reduced-motion` 遵守。
  - **日记页**：内容版心 720px 长文单列；日期倒序、**日组内正序**（今天在最上，组内从早到晚，今天组末为输入行/草稿行——「追加到当日结尾」的字面实现）；日头 sticky（`09-14 周日 · 3 条` mono + hairline）；条目行 hover 才出操作（编辑/复制/删除，Meta 档文字按钮）；草稿行虚线边 + accent 标记；输入行 `Enter 提交 · Shift+Enter 换行`。低饱和、无卡片化容器（条目之间只用 hairline 与 8px 网格，不用边框盒子堆叠）。
- **全局快捷键族（v36）**：同族两键语义对称——`Ctrl+Alt+Space` 记下自己的思考（**不打断**当前页面，浮层在鼠标屏）、`Ctrl+Alt+N` 收进别人的材料（主窗口前置 + **就地**弹出「添加书籍」模态，**不切换视图**，阅读位置与复习会话原地保留）。默认值刻意避开被常用软件占用的组合（如 QQ 截图的 `Ctrl+Alt+A`）；捕获/校验/「被占用」提示统一在设置页 `sec-global`。
- **书架图注卡（v48.15 / D51，取代原「整块封面 + hover 黑幕」）**：卡片 = 封面（2:3 直角 `object-fit:cover`）→ 2px 进度轨（`--grey-2` 槽 / `--accent` 填，写法 `calc(var(--sp-1) / 2)`）→ 图注区（书名 Body 14/1.4 weight 500 两行截断 + 第二行 Meta 12 mono `42% · 09-18 · 中`）。**书名与进度常驻可读**，不再只有 hover 才见；无封面仍用现骨架（灰底 + 8×8 accent 方块 + 左下标题）。操作收进 hover / `:focus-within` 显形的 40px `--overlay-ink` 动作条（重命名 · 语言 · 归入文件夹 · 删除，Lucide 16/stroke 1.5，只用 `opacity` 不用 `visibility` 以保键盘可达）；**卡面上禁止永久挂原生 `<select>`**（压在任意封面上既难看又跳主题），语言与归组一律走共享 `Dropdown`（`.dd`）。删除仍走就地二次确认（D50 行为不变，焦点默认落「取消」）。
- **书架文件夹（v48.15 / D51）**：识别度**只靠形状不靠颜色**——顶部 12px 标签页（`--paper` 底 + `--border-strong` hairline，压住卡顶边）+ 中段一排书脊（成员封面裁成竖窄条，最多 5 条、单条封顶 56px 并左对齐，超出折叠成 `+N` 计数块；**不封顶时单成员文件夹会画成一大块灰板，反而最不像书脊**）+ 底部成员数 Title L 26/300 + Meta 档「本」+ 右对齐均值。hover / `:focus-within` 时封面区整块翻成 `--overlay-ink` **成员名册**（序号 + 书名，前 6 条，超出「还有 N 本，进去看全部」），底部 40px 留给动作条。图注区与书卡同规格。**文件夹只是书架视图的组织方式，不改变任何数据归属**：卡/摘录/进度/领域标签仍各挂各书，统计、今日队列、FSRS、导图、记忆一律不感知它。
- **拖拽落点三区（v48.15 / D51）**：拖动时目标按横向分三区——左缘 28% 排到其前、**中央 44% 归组**、右缘 28% 排到其后；两种意图必须长得不一样（两侧画 2px accent 竖条，中央整块 `--accent-soft` + accent 描边 + 浮出「归入《X》」标），不靠修饰键区分。键盘与不精确指针的等价路径：聚焦后 `Alt+←/→`（与仪表盘 D50-④ 同一条语义），以及动作条「归入文件夹」菜单（新建并放入 / 列出各文件夹带成员数 / 移出当前）。**拖拽与归组仅在排序=手动顺序时可用**，其余三种排序下把手不渲染并写明已停用，禁止出现"看着能拖、拖了没反应"。
- **顺序与文件夹的持久化（v48.15 / D51）**：`settings.app.shelfOrder: string[]` 与 `settings.app.shelfFolders: {id,name,items[],created}[]`（§4.2-3 `SettingsStore` app 层，先例＝仪表盘布局 `settings.dashboard.layout`）。**不新增数据库列**：备份包本就含 `settings.json`（`electron/backup.js`），M2 恢复天然覆盖、零迁移；主进程 `listItems()` 的 `ORDER BY created_at DESC` 一字不改，排布与归组全在渲染层按 id 数组派生。**代价如实登记**：将来接 `AccountSyncProvider` 时 id 数组的跨设备合并比列排序复杂，届时一次性折算成 `sort_order` 列即可。新增材料不在数组里时插到队首并高亮 1.2s（避免"导入完找不到"）。
- **回退路径可发现性（v48.15 / D51）**：进入文件夹后必须有三条明显的出路——① 工具条最前端 `返回书架` 描边钮（Lucide 左箭头 + 文字，32px，兼作**拖出落点**：书拖到它上面＝移回书架）；② 顶栏「书架」导航；③ `Esc`。退出后焦点落回那张文件夹卡并 `aria-live` 播报。**禁止**同一行再放一个纯文本「书架」小字（两种写法并存，人要猜哪个是出口——第一版就被实测打回）。解散 ≠ 删除：文件夹只提供「解散」与「全部移回书架」，不提供删除。
- **书架空态（v48.15 / D51）**：几何装饰 + 一句话，**不再放主行动按钮**（工具条主按钮已在同一视口顶部常驻），文案直接指过去「用右上角的『添加材料』，或按 Ctrl+Alt+N」。此项连带修订 `docs/swiss-international-style.md`「状态设计 · empty」与「布局模式库 · 空状态」两处。
- **图片聚焦层（v25）**：全屏 fixed 覆盖层（`--z-toast - 1`），背景 `rgba(10,10,10,.55)` + `backdrop-filter: blur(10px)` 实现「周围区域模糊」；图片由原位置 FLIP 飞入居中（240ms `--ease`，reduced-motion 关闭过渡）；顶部居中悬浮工具条（paper 底 + hairline 边框 + `--shadow-float`），工具按钮选中态用 accent-soft 底 + accent 边框；选区图元统一走 `.occlusion-shape`（考察区 accent 填充、其余 ink 填充、预览 accent 描边，`vector-effect: non-scaling-stroke` 保描边不随百分比坐标系拉伸）；选区状态一律以**相对图片百分比**保存，仅在读取指针位置时做像素换算（`src/lib/occlusion.ts` 为唯一换算口）。
- **UDC 领域选择（v25，M5）**：chip（accent-soft 底 + accent 边框 + 主领域标「主」）+ 受控清单下拉（复用 `.dd` 直角下拉样式，`udc-menu` 限高滚动），上限 2（`UDC_MAX`）。

## 5.5 皮肤体系

默认皮肤 = 瑞士风（`skinId:"none"` 即基线本体）；注册表当前仅登记这一支（原第二皮肤「下蛋 Dream 玻璃拟态」已下线删除）。新皮肤按 §4.15 规范另立，先规范后代码。

**当前状态：机制在场、皮肤为零**（v48.14 / D50 明确）。`--shadow-panel`、`--radius-pill` 两个 Token 与 `docs/swiss-international-style.md`「皮肤层」一节**目前是零消费者的预留扩展点**——基线取值即瑞士风默认（面板阴影同 `--shadow-float`、`--radius-pill: 0`），**没有任何实现覆盖它们则外观完全不变**。它们服务 §9.1 **M11「界面自定义与主题社区」**：将来加皮肤时只需整套替换 Token，不必再往组件上打补丁。这不是对基线（直角 / 零阴影 / 单一焦点色）的放松，也不得被引用为在基线界面里引入圆角、渐变、玻璃拟质的理由。

---

# 第三部分 Product Spec（产品规格）

## 6.1 核心用户流程

书架（粘贴/EPUB 成书）→ 阅读器（选中文字 → 手动制卡 / AI 制卡 / AI 解释 / 摘录；制卡与摘录**记录选区锚点**）→ 学习队列（摘录 Topic，推迟/打开/跳原文）→ **连续刷题复习**（自动出下一张、评分四按钮、跳过/标记暂停/删除、跳转原文并可返回恢复现场、双面内联编辑）→ 卡片浏览（Anki 式全量表格 + 行维护 + Leech 六步处理）。设置：主题/皮肤/强调色/AI 服务（4 预设+思考强度）/FSRS 优化/统计仪表盘/备份与恢复/快捷键。

## 6.2 已实现功能规格（v31 状态）

- **书架**：粘贴成书、EPUB 导入（封面/TOC）、上次阅读位置、删除（软删）；统一导入入口（D30，可一次多选批量）；**「添加书籍」模态可经全局快捷键 `Ctrl+Alt+N` 呼出（v36）**——主窗口前置 + 就地弹出、不切换视图。**v48.15（D51）版面与能力重写**：吸顶工具条（§5.3）承载 计数 / 面包屑 / 视图切换（封面墙 ↔ 目录表）/ 密度三档 / 排序方式（手动顺序 · 最近阅读 · 添加时间 · 标题）/ 添加材料主按钮；书卡改「封面 + 排印图注」（§5.4）；**手动顺序下可拖拽重排**（`Alt+←/→` 键盘等价）；**文件夹**——拖书到另一本书中央即成组并就地命名，点卡进入（面包屑 + 返回钮 + `Esc` 三条出路），hover 显示成员名册，只有解散没有删除；顺序与文件夹存 `settings.app.shelfOrder` / `shelfFolders`（零 schema 变更）；空态不再放第二个主按钮。目录表视图下同一套拖拽/改名/归组在行内可用，表格只画横向 hairline。
- **阅读器（v20 阅读内核，D20「一切皆书」）**：文件书（EPUB/MOBI/AZW3/FB2/CBZ）由 vendor foliate-js 渲染；粘贴书导入时**确定性合成 EPUB**（markdown-it→HTML、一级标题章节化、KaTeX 服务端渲染自包含内嵌；存量粘贴书首开惰性合成）；摘录打开时合成为单章 EPUB 进同一内核（无 markdown 阅读边界；摘录不落进度/统计）。react-markdown 退出阅读路径（仅 AI 面板回答）。能力：**目录侧栏**（book.toc 层级树+当前章高亮+点击跳转）、**阅读模式**（滚动/分页/双页对开）与**翻页交互**（‹›按钮、←→/PageUp/PageDown/空格键、分页模式左右点击热区；分页滚轮=翻页，滚动模式章尾续滚自动进下一章/章首回上一章——vendor 补丁 paginator wheelTurn，跨章节由 #turnPage 处理）、**外观**（纸白/羊皮/暗夜/自定义背景文字色、字号、字体；快捷控件与设置页「阅读」区块同读写 `settings.app.readerSettings`）、**链接**（内链内核 CFI 精确跳转；外链 adapter 拦截→`shell:openExternal` 仅 http/https）、**选区服务**（引擎 iframe 选区→既有制卡/AI 解释/摘录/图片挖空菜单全链路不变）、**进度**（progressJson 扩展 `{cfi,fraction,ratio,lastText,readerEngineVersion}`，恢复优先 CFI）。
  - **锚点体系（可降级恢复）**：制卡/摘录 contextRef.locator = cfi（结构级，绑定特定 EPUB 结构非永久 ID）+ chapterIndex（章节兜底）+ anchorText（文本终极兜底）+ readerEngineVersion（回归归因）。恢复链：CFI→章节+文本→全文搜索→人工提示。存量纯文本锚卡经 search 定位。
  - **跳转原文错位修复（v35，用户 2026-09-14 实测：图片问答卡与文字卡跳转均回开头）**：① **根因**——`pageIndex` 在建卡时已入库（`buildLocator`，PDF 系）但复习页/CardBrowser/App 三处 anchor 类型均丢弃，PDF 卡跳转永远走文本搜索、失败即停开头（跳转 open 跳过进度恢复，搜索失败即留首位）；图片入口主动清锚（图片点击清 `engineSelRef`、提交清 `anchorRef`）致 `enrichedContextRef` 退化为裸 `{documentId}`，拿题面全文搜必失败；Markdown 分支找不到文本回退上次阅读进度（为 0 即停顶部）且 `jump` 未下传 `anchorRatio`。② **修复**——`pageIndex/chapterIndex/anchorRatio` 全链路透传（`CardRecord.contextRef` 类型补齐 + `ReviewView/CardBrowser/App.handleJumpToDoc/ReaderEngine`）；跳转顺序 `cfi→pageIndex→chapterIndex→anchorText（判空守卫）`；Markdown 找不到文本回退本卡 `anchorRatio`；正文图片制卡记图片锚点（引擎当前 locator+章节+alt/周边文字，Markdown 记比例+alt/上下文），跳转落图片所在章节/页附近。③ **图内区域精确高亮**——图片卡跳转附带本卡 occlusion（rects/shapes 百分比口径复用），foliate/markdown 正文原图命中后叠加本卡区域高亮（3 秒或随导航清除），未命中/PDF 系走右下角「原图对照」浮层（asset 图+本卡区域+关闭）。④ **查看原图**——复习与卡片浏览的图片卡增「查看原图」lightbox（全图+遮挡显隐+滚轮缩放+Esc/背景关闭），不进阅读器。⑤ **按钮态**——`hasSourceAnchor(ref)` 任一锚存在即有；资源库选图（`imageSource="library"`，图不在书中）隐藏跳转；其余无锚点旧卡置灰+tooltip 说明，不再跳回开头误导。
  - **主进程导航防护**：`will-navigate` 仅放行同页刷新（复习页「刷新」），其余页面级导航一律拦截；`setWindowOpenHandler` 拒绝开窗、http(s) 交系统浏览器；外链 IPC `shell:openExternal` 仅允许 http/https。
  - 选中操作菜单、AI 解释侧栏、AI 制卡面板、图片挖空、递进补卡、材料类型路由（§6.3）在内核视图下行为不变。
  - **正文图片点选聚焦与形状选区（v25，M5 批次）**：点击正文图片 → 图片上浮居中、周围区域模糊（backdrop-filter）聚焦视线；顶部居中悬浮工具条提供**三类区域选区**（矩形拖动 / 圆形（椭圆）从圆心拖出 / 多点连线多边形——逐点点击连线、≥3 点后点回起点闭合）与提交动作（AI 制卡 / 手动制卡）；**点击模糊区域退出聚焦**（Esc 先清选区、无选区时退出）。选区坐标以相对图片百分比保存；AI 提交时把选区裁剪图交 GLM 识别内容，**遮挡区域恒取用户选区**（模型看到的是裁剪图，其坐标属裁剪坐标系，禁止写进 occlusion_json）；手动提交进入「手动制卡」弹窗的图片挖空页签（M5 字段集）。图片字节经 `assets:saveImage` 落盘入 assets 表（无需文件对话框）。
  - **正文图片点选聚焦与形状选区（v25，M5 批次）**：点击正文图片 → 图片上浮居中、周围区域模糊（backdrop-filter）聚焦视线；顶部居中悬浮工具条提供**三类区域选区**（矩形拖动 / 圆形（椭圆）从圆心拖出 / 多点连线多边形——逐点点击连线、≥3 点后点回起点闭合）与提交动作（AI 制卡 / 手动制卡）；**点击模糊区域退出聚焦**（Esc 先清选区、无选区时退出）。选区坐标以相对图片百分比保存；AI 提交时把选区裁剪图交 GLM 识别内容，**遮挡区域恒取用户选区**（模型看到的是裁剪图，其坐标属裁剪坐标系，禁止写进 occlusion_json）；手动提交进入「手动制卡」弹窗的图片挖空页签（M5 字段集）。图片字节经 `assets:saveImage` 落盘入 assets 表（无需文件对话框）。
  - **递进补卡（v16）**：AI 制卡结果的知识点摘要含「（后续可补：…）」注记时（v4 候选 G8 产出，`parseFollowUps` 解析），逐项渲染「询问 AI 相关内容」「直接制卡」；询问 AI 的解释追加在面板最下方且解释末尾也带「直接制卡」；直接制卡以原选文为材料 +「本次制卡重点」指令 + 已有卡清单（防重复）生成 1-3 张补充卡，**追加到卡片清单末尾**（带「补充」徽标），已有卡始终在上；所有卡沿用同一次选区锚点（跳转原文同一位置）。补充制卡指令经请求装配注入（context.focus），提示词模板不变。
- **四种核心卡形式（v16 修订，M1.1）**：挖空（cloze 契约不变）/ 问答（qa）/ **翻转问答（制卡手段，非卡类型：创建时拆为两张互为翻转的独立 qa 卡）**/ **图片挖空（imageOcclusion，GLM 多模态识别遮挡区域生成）**；既有 application/mnemonic/seq/formula 类型保留。
- **手动制卡（M5，v25 与 AI 制卡同构）**：四类型页签（问答 / 翻转问答 / 填空题 / 图片挖空）+ UDC 领域标签（≤2，对齐 R17）+ contextPrefix / 助记 / 知识点分组 / 日期标记（规则19）+ 优先级；入口三类——选区菜单「制卡」（文本）、快捷键 Ctrl+Z、**图片聚焦工具条「手动制卡」（图片挖空页签预填选区）**；一律过 CardLintEngine 并做 S1 相似检索。
- **手动制卡（M5，v25 与 AI 制卡同构）**：四类型页签（问答 / 翻转问答 / 填空题 / 图片挖空）+ UDC 领域标签（≤2，对齐 R17）+ contextPrefix / 助记 / 知识点分组 / 日期标记（规则19）+ 优先级；入口三类——选区菜单「制卡」（文本）、快捷键 Ctrl+Z、**图片聚焦工具条「手动制卡」（图片挖空页签预填选区）**；一律过 CardLintEngine 并做 S1 相似检索。
  - 翻转问答（D18）：**不存在复习期形态变化的卡片类型**——手动制卡「翻转问答」页签与 AI 面板「转翻转卡」按钮都产出/拆分出两张互为翻转的独立问答卡，各自拥有独立 FSRS 调度状态；B 面留空时自动正反互换。
  - 图片挖空：阅读器选区菜单「图片挖空」→ 选本地图片 → 落盘 assets/ + 入 assets 表 → dataURL 交 GLM 多模态（card-occlusion 模板）→ 返回 regions（百分比坐标，渲染端钳制 0-100）→ 确认面板图上叠加预览、逐区域接受（每区域一张卡，共享同一 occlusionJson，cardOrd=区域序号）；**v25 起正文图片另有正交入口**：点击正文图片进入聚焦 → 手绘选区（矩形/圆形/多点连线多边形）→ AI 制卡（裁剪图交模型识别内容、遮挡区域取用户选区）或手动制卡；既**不做既有卡片的遮挡区域编辑器**（D16 保持）**也不做整图手动遮挡编辑器**。**复习端展示规范（v16-c，用户钦定）**：正面 = 原始图片 + 主题色遮挡块（考察区域 accent 色、其余区域 ink 色）；答案面 = 原始图片（无任何遮挡覆盖）+ 答案文本。测试台结果面板同规范渲染（图片+遮挡块+显示答案切换）。v25：遮挡块按 shapes 精确渲染（矩形/椭圆/多边形，SVG 百分比坐标系 + non-scaling-stroke），无 shapes 的存量卡回退 rects 矩形。
- **学习队列**：due 摘录列表（priority 升序）、推迟（×1.6 占位）、打开摘录阅读（嵌套摘录）、跳转原文（带锚点条目）。- **连续复习**：进入即开始；每张卡实时取 due 队首（FSRS due 升序）；评分四按钮（预览=落库，§7.3）；自动下一张；本轮计数；跳过（due+10min，不写 log）；标记并暂停；**删除**（确认后软删，自动下一张）；**跳转原文**（保存现场→阅读器锚点定位+高亮→返回恢复该卡与翻面状态）；内联编辑（翻面后问题+答案皆可，cloze 语法自动回填）；leech 自动检测（lapses≥8 暂停+通知）；**撤销评分（v22）**：撤销最近一次可撤销的评分（快捷键 Z / 「撤销评分（X）」按钮，收尾页同样可用）——恢复该卡评分前 FSRS 快照、物理移除该条复习日志（训练输入与统计自动回到评分前）、若本次评分触发 leech 挂起则一并回退（解除挂起+关闭本次产生的 LEECH issue）；撤销后该卡回到当前位并展开背面，可立即重新评分；撤销不改变调度语义（§4.4.4）。
- **卡片浏览（v19 Anki 式改造）**：全量卡片表格（题面/类型/状态/到期/复习次数/遗忘次数/优先级/来源书名，listAllCards 补 docTitle JOIN）+ 搜索（题面/答案/前缀/来源/领域/标签）+ 类型/状态筛选（共享直角 Dropdown，类型项按库内实有动态生成）+ 排序（到期/创建/优先级/遗忘）+ 页签（全部卡片/到期卡片/记忆难点，到期与难点口径与 db.js listDueCards/listLeechCards 一致）。**行详情** = 卡面预览与内联编辑（复用复习 CardFace/EditableText，cloze 自动回填挖空语法）+ 元数据（含 FSRS 稳定度/难度）+ 质检问题（CardIssue）查看 + 操作：暂停/恢复调度、推迟 1/7 天、重置为新卡、删除（确认后软删）、跳转原文（returnTo=browse）、Leech 卡「六步处理」入口。评分调度仍在复习页，此处不写复习日志。
- **记忆难点**：Leech 六步向导（AI 诊断/补卡指引/换问法/删除降优先/推迟/助记 + 重置为新卡/恢复）。
- **统计数据**：仪表盘（学习热力/今日完成度/领域分布/评分构成等），UDC 领域分类，组件拖拽排列。（用户主导开发）
- **FSRS 优化器**：设置 → FSRS 优化；手动训练/应用/恢复默认（§7.7）。
- **启动**：单窗口防重入（**v36 升级为 `app.requestSingleInstanceLock` 进程级单实例**：第二次启动聚焦已有窗口并退出——全局快捷键必须只有唯一宿主，否则两个进程争抢注册且各自持有一份 sql.js 内存库）；dist 优先加载。
- **日记（v36，M8-A）**：顶栏「日记」页 = Logseq 式流式时间线（日期倒序 / 日组内正序 / 今天组末为输入行）；条目可增删改、可搜索；**快速记录窗口**（全局快捷键 `Ctrl+Alt+Space`）随想随记、输入即落库、按「发送」定格为一条；不进 FSRS 队列、不强制制卡（Non-Goals）。完整规格见 §6.5。

## 6.3 AI 辅助制卡与助读体系（v6 锁定，主体实现）

### 6.3.1 制卡原则知识库（单一事实来源）

制卡原则只存在于两处：`PromptTemplate` 的 card-* 族提示词（给 LLM）与 `CardLintEngine` 规则表（本地质检）。代码、组件、文档中不许散落第二份原则文本。scope 锁定：`card-generation / card-formula / card-seq / card-enum / card-mnemonic / card-contrast / card-wording / card-basic / card-occlusion（v15 新增，图片挖空）/ reader-explain / leech-rescue`。

### 6.3.2 AI 制卡主流程

入口：阅读器选中文本 → `AI 制卡`（也支持 AI 解释侧栏「就此制卡」）。七步管线见 §4.3。确认入库：逐张「接受/编辑/拒绝」或整批拒绝；落库带 contextRef（含锚点）/sourceRef/dateStamp/priority/knowledgePointId；超量制卡默认每知识点 2-4 张、单批上限 10；迭代制卡（补充制卡不重复已有 knowledgePoint）；手动制卡保留为降级路径，同样过 lint。

### 6.3.3 制卡提示词锁定基线（PromptTemplate 当前版本 v7）

基线组织为「理解检查 → 硬性规则 R1-R17 → 输出格式 → 禁止事项」，全文以 `electron/prompts.js` 的 v7 播种内容为唯一准绳（历史版本留痕于 prompt_templates 表）。核心规则摘要（完整文本见 prompts.js）：

- R1 不理解不学（blockReasons + 前置卡）；R2 最小信息（答案 ≤15 字）；R3 单义性；R4 禁是否题；R5 避免集合/枚举；R6 上下文前缀（前缀铁律：禁止泄漏答案）；R7 措辞最短；R8 双向多角度；R9 例子个性化；R10 联想已有卡；R11 来源与时间戳；R12 助记克制；**R13 挖空规范（hint 禁令 + v4 加一卡多空两形态 `clozeMode`：together 同答=缺省一起回忆一起遮蔽 / per-blank 分答=系统自动拆每空一卡，见 D27）**；R14 优先级建议（基础 ≥70 / 一般 40-60 / 边缘 ≤30）；R15 应用/启明卡；R16 实体全名；R17 领域标注（UDC 受控清单，domain 字段 ≤2 个）；**R19 观点归属（v5 加归属锚强制：论证/理论/学说/观点性内容一律带提出者锚——front 或 contextPrefix 人名全名+学派，内容卡与归属卡拆分，见 D29）**；**R18 数字克制（v6：改为无数值门槛的软引导——同日用户反馈「≥2 个数字即不合格」过严已取消）**；**R20 记忆接地（v7，契约 §4.18-9/-10）**——当请求注入了【用户记忆】块时：记忆**只能**用于应用卡（R15）的情境部分与助记卡（R12/R9）的生活线索，**禁止**用于答案与事实内容（答案必须来自材料），**禁止**为使用记忆而扭曲情境；**没有贴合的处境必须省略**（`memoryRef: null` 合法且受鼓励）；措辞可含用户自己的具体事物（项目/领域/书名），**禁第三方隐私**（他人姓名、机构），**禁逐字搬日记原句到卡面**；每张用到记忆的卡须输出 `memoryRef`（**逐字抄录**所引记忆行）。`card-vocab` / `card-literature` 明确注明 R20 不适用（无情境卡）。**v6 取消 G9「退出红线」**（用户 2026-09-13 拍板：值得记就做、可以少做但不做空——保留「单一孤立事实至少 2 张」下限，删除「提不出 3-5 个好问题一张也别产」）。
- 输出严格 JSON：`{knowledgePoints, blockReasons, cards[{cardType, knowledgePointId, contextPrefix, front, back, cloze, clozeMode, example, mnemonic, sourceRef, dateStamp, prioritySuggestion, ruleNotes, warnings, domain, memoryRef}]}`（**v7 增 `memoryRef`**：情境所引记忆行的逐字抄录或 `null`，见 §4.18-9/-10）。
- 修改提示词 = 播种新版本记录，不覆盖旧版（当前 v7：**v42 定契约 / v46（M14-UM2）实现播种**——R20 记忆接地段组装进制卡族常量 + 输出字段 `memoryRef`；v7 实际覆盖 9 个 v6 scope，`card-vocab` 保持 v1（`situation_required=0` 把关注入，避免版本号跳跃）且其常量已注明 R20 不适用供 prompt-lab 直引；v6：**M1 v4 候选正式并回**——取消 G9 退出红线、G6/G7 完善并与 CardLint L16 对齐（L-A 数字密度同日取消、L-B 不做）、card-literature 专用文学模板接上；v5：R19 归属锚强制；v4：R13 一卡多空两形态 + clozeMode 字段；v3：R13 hint 禁令 + R17 领域标注）。

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
| L16 | 开放式/集合型答案缺合格线标注（「至少回忆 N 种」等可字面判定措辞；M1 缺口 L-C，对齐 R2/R5 的 G7） | warn |

severity 语义：error 阻止入库；warn 可选择接受；info 仅提示。所有 lint 结果写 CardIssue，卡片详情可查「违反了哪些原则」。另有 S1（相似卡警告）。

> **M1 缺口 Lint 处置（v31）**：L-C 宽容度标注 → 落地为 **L16**；**L-A 数字密度不做**（v31 曾实现为 L15，同日经用户反馈「≥2 个数字即不合格」对「十位数」等常见情况过严而**删除**，R18 同步改为无数值门槛的软引导）；**L-B 观点归属不做**——「有争议/非公认」属语义判断，本地启发式误报高，改由 R19 提示词自律（§6.3.3）。L16 对 AI 卡与手动卡一视同仁（手动制卡不走提示词，本地 lint 是其唯一兜底，§6.2 手动制卡）。

### 6.3.5 AI 阅读助手

选中文本 → `AI 解释` 侧栏流式回答（先直答再机制再联系上下文；追问：通俗解释/严格定义/举个例子/为什么）。回答下方动作：就此制卡（进 AI 制卡流程）。回答运行期显示思考/等待状态（思考字数 + 已等待秒数）。

（v12.2 起新增：解释侧栏与跳转原文、删除按钮等复习链路增强，见 6.2。原 §8.5「插入原文回写为 ai-supplement 块」仍为规划项，见 Roadmap。）

### 6.3.6 Leech 处理

lapses≥8 自动标记+暂停+CardIssue+通知；复习中「标记并暂停」一键；六步向导（诊断 AI / 补前置卡 / 重设问法 / 删除或降优先 / 推迟 / 助记）+「重置为新卡 / 仅恢复」；Leech 面板（卡片浏览页）。处理决议写 `leech.resolution`。

### 6.3.7 干扰检测

制卡时相似检索（n-gram），高分命中写 S1 警告提示可能干扰；对比卡生成走 card-contrast 模板（向导内指引）。

### 6.3.8 复习体验元规则

补进度不展示惩罚性大数字；每日上限可配（未实现，规划）；全局混编选项（规划）；Again 按钮措辞不带惩罚；卡片可标「不再关心」（规划）。

**同源卡延后（v34，§4.16）**：同一制卡来源单元产出的多张卡（翻转对 / 分答拆卡 / 单词四卡 / 同图多卡 / 同一句短材料的多角度卡）在同一学习日只放行一张，其余延后至次日——延后不写 FSRS（不改 `due`、不产生评分日志），只作用于今日队列视图；复习页须显示延后原因与「同源暂缓 N」，统计「今日到期」与队列同口径。

**成长反馈微提示（v39，§4.17 / §6.6）**：复习评分后若达成真实跨越，可在卡面下方出现**一条**轻提示（自动消失、可点击看证据链）——**非阻塞**（不拦下一张卡、不改卡面布局、不发通知、不注册快捷键）、**单次评分至多一条且取分级表最高级**、可整体关闭；streak / 连续学习天数归 Activity 层并受措辞纪律约束（禁「即将断签 / 补签」类表述与提醒，§6.6.4）。

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
  | image 图片材料 | 制卡入口选图 / 正文图片点选（v25） | card-occlusion | 图片挖空 |
  | literature 文学/诗歌背诵（v16） | 本地识别：词牌/诗体标识、《篇名》标题、行密度/短句密度（verseSignals；v16-c 扩展近体诗定长行与现代自由诗、标记兜底放宽长行） | card-literature（**v31 起播种专用文学模板 v6**；此前 v1/v5 由 card-seq 模板占位，属死代码缺陷） | 问答（seq 续写逐句全覆盖 + 措辞/观察卡；contextPrefix=「文体·篇名:」类别标识） |

  材料类型识别是**确定性本地函数**（同一文本必然同一结果，与提示词无关）；识别不确定时由 AI 面板的类型选单手动覆盖，**选单选择按书记忆**（v16：`settings.app.materialTypes` 以 itemId/documentId 为键，同书再次制卡自动沿用用户上次选择，首次制卡即生效）。

  （词汇/单词类材料 → 建议 M7 词典批次；代码/编程类 → 候选新类型待用户表态；详见 `docs/M1-prompt-coverage-report.md` §三-C、§四）
- **提示词测试台（独立最小软件，v15 已建成；v16 候选补丁就绪）与调优闭环（用户钦定）**：`prompt-lab/`（独立 Electron 应用，复用主软件 `ai.js` 网关与 `prompts.js` 基线、esbuild 打包 `cards.ts` 的路由/JSON 容错/Lint 纯函数为 vendor bundle；**必须经 `npx electron prompt-lab` 或根目录 `启动提示词测试台.bat` 启动，浏览器直开 index.html 无本机接口**）。闭环：**AI 按用户要求修改测试台内的提示词/流程 → 用户在测试台手动实测（文字/图片材料）→ 用户反馈测试结果 → 决定是否并回主软件**；并回时提示词播种新版本（旧版留痕）。测试台配置与提示词编辑存独立 userData（`%APPDATA%/prompt-lab/`），不写回主软件；主软件内不做提示词调优试验。
- **v4 候选已并回（v16 候选 → v31 用户确认并回）**：`prompt-lab/prompts-draft.js` 按覆盖核对报告实现 G1-G9（R3 精准性/一致性双维、输出前自检段、R8 五视角、公式地标双卡强制+边界三问、R18 数字克制、R19 观点归属、等价答案宽容与部分枚举合格线、首轮克制多轮递进、**退出红线——v31 已取消，见下**）+ **card-literature 文学/诗歌背诵候选**（续写骨架**逐句全覆盖**/开头优先/措辞选择卡/原文改进卡/高层次观察卡/放过标点/名言署名，研究依据见报告 §四、§4.4）；G10 挖空 ≤2 处维持（用户拍板）、G11 词汇归 M7（用户拍板）、G12 进可选池。**v31 用户确认后已并回主软件并播种 v6**（`card-generation` 族 + `card-literature` 专用模板；因 v5 已被 v30a/v30b 两批占用，目标版本统一升到 6 才能对存量库补播）。**v31 调整**：取消 G9「退出红线」（用户拍板：值得记就做、可以少做但不做空）；G6/G7 完善并与本地 CardLint L16 对齐。R18 同日修订为无数值门槛的软引导（原「≥2 个数字即不合格」+ L15 因过严取消）。**v16-b（雨霖铃实测反馈修复）**：detectMaterialType 加诗词启发式 verseSignals（原仅三类正则致诗词落概念兜底）；extractJson 括号平衡扫描（模型 JSON 后附说明文字曾致「Unexpected non-whitespace character」解析失败）；文学候选 L1 整篇背诵逐句全覆盖（一句一卡成链，优先于首轮克制）——真实验证：自动路由 card-literature、9 张续写卡覆盖全篇+6 张理解卡。
- **提示词覆盖核对（v15 已完成，只报告不改）**：逐条核对结论与 14 项缺口（G1-G14）、CardLint 缺口（L-A/L-B/L-C）、处置建议见 `docs/M1-prompt-coverage-report.md`；**任何一项的增改须经用户确认后走测试台验证 → 播种新版本**。**v31 状态**：G1-G9 已并回主软件（G9 经用户拍板取消）；L-C 落地为 CardLint **L16**（§6.3.4）；**L-A 数字密度与 L-B 观点归属均不做**（L-A 曾实现为 L15、同日因过严删除）；G10（挖空 ≤2）/G14（遮挡区域 1-6）维持；G11 归 M7；G12/G13 留可选池/文档。

### 6.3.11 LKM 专用 PromptTemplate 分支（v24 规范，K2 起按需播种；v33 增 `structure-analogy`）

- **禁把知识模型职责塞进 `card-generation`（设计稿 §55–§56）：** 制卡提示词只管制卡。LKM 新增 **6 个独立 scope（v24 五个 + v33 一个）**，各自版本化播种、各自走测试台验证：`knowledge-extraction`（KP 抽取：label/description/domain/封闭档位 + evidence span）/ `knowledge-relation`（关系抽取：**9 种** relationType 封闭枚举（v33 含 `analogous_to`）+ 置信档 + 依据）/ `material-difficulty`（材料六维难度档位估计 + 覆盖 KP 候选）/ `knowledge-probe`（dimension 探针卡：新情境出题，沿用四档评分心智，输出带 `dimension` 标签）/ `frontier-explain`（推荐解释：只组织已验证数据依据，禁编造扫描数字；**v33 扩：结构驱动推荐必须附槽位映射表 + 至少一条主要差异，不得只给结论**）/ **`structure-analogy`（v33 新增，承载 §4.14 结构连接）**：输入＝已持有结构子图（KP + 关系边）+ 候选领域，输出＝槽位对应明细 + 相似度 1–5 档 + 判定锚语 + 依据 span；**禁编造对应**（无依据降 `uncertain`），连接手法只许 `analogy / abstraction / combination` 三选一。
- 每个 LKM 模板必须含判定锚语（什么条件下写哪一档）+ evidence 引用要求（无 evidence 降级 `uncertain`）+ 封闭选项清单（写法照抄 R17 UDC 清单注入方式）。
- **v41（K2-A，D38）播种记录**：`knowledge-extraction` v1（簇归一：`clusterKey` 原样回抄 + canonicalLabel/aliases/domain（UDC 注入）/description/action link|create|skip + targetKpId 只许取自候选清单 + confidence 1-5 档 + evidence 原文引用卡面片段）与 `knowledge-relation` v1（关系抽取：端点只许候选清单 id 或本 run 簇键 + 9 种 relationType 封闭枚举 + 方向锚语「A --prerequisite--> B 表示学 B 前提是会 A」+ confidence + evidence；禁编造）已随本批播种；prompt-lab 同步基线直引。**余下 4 scope 于 v43 随 K2-B 播种（见下条）。**
- **v43（K2-B）播种记录**：`material-difficulty` v1（材料六维难度 conceptualDifficulty/languageDifficulty/prerequisiteDifficulty/density/applicationDemand/transferDemand 各 1-5 档 + 判定锚语 + evidence 原文照抄 + overallGrade + 覆盖 KP 候选**只提名不建卡不建 KP** + 前置缺口提示）/ `knowledge-probe` v1（dimension 封闭五维 recognition/recall/conceptualUnderstanding/application/transfer + **新情境出题禁原题重问** + 可判定答案要点，评分沿用 FSRS 四档心智）/ `frontier-explain` v1（candidateId **只许回抄输入候选清单** + **禁编造扫描数字** + expectedChallenge 封闭四档锚语 + 结构驱动候选必须附槽位映射 + ≥1 条主要差异）/ `structure-analogy` v1（connectionMode 三选一 + 槽位映射 fromKpId 只许子图 id + 相似度 1-5 档锚语 + disanalogy ≥1 + **无 evidence 降 uncertain**）播种；**出层契约校验器 `electron/kpScopes.js`**（纯函数、零依赖、主进程/prompt-lab/测试三方共用：越界 id 丢弃留痕 / 缺 evidence 降 uncertain / 封闭枚举越界本地清理 / 禁编造数字=文本数字须能在输入原文找到 + `scopeDispersion` 离散度守门）；prompt-lab 基线直引 +「×N 次离散度」运行入口（§4.6 item 6/7），并补齐 journal-insight / knowledge-extraction / knowledge-relation 在测试台 `BASELINE_SCOPES` 的可见性（此前只进 DRAFT_SCOPES，测试台列表一直看不到）。
- **v44 预告（随 K3 落地；M15 已回滚待重设计）**：`knowledge-probe` 将升 v2——记忆块注入（application/transfer 维度，R20 v44 原则 + `memoryRef` 输出，§4.18-9）+ 背面揭示所需字段（探针标识 / 参考要点 / 质量评判原因枚举）+ 禁跨探针情境复用（同 KP 历史情境入禁用清单，§4.7 v44 blockquote）；先 prompt-lab 验证再播种。M15 v48 重设计后 `diagram-generation` 播种预告作废（v47 遗留）——M15 改播 `material-map-section / material-map-merge / material-map-global / material-map-editorial` 四 scope（§4.19-3，D41）。
- **v41（K2-A，D38）播种记录**：`knowledge-extraction` v1（簇归一：`clusterKey` 原样回抄 + canonicalLabel/aliases/domain（UDC 注入）/description/action link|create|skip + targetKpId 只许取自候选清单 + confidence 1-5 档 + evidence 原文引用卡面片段）与 `knowledge-relation` v1（关系抽取：端点只许候选清单 id 或本 run 簇键 + 9 种 relationType 封闭枚举 + 方向锚语「A --prerequisite--> B 表示学 B 前提是会 A」+ confidence + evidence；禁编造）已随本批播种；prompt-lab 同步基线直引。**余下 4 scope（material-difficulty / knowledge-probe / frontier-explain / structure-analogy）随 K2-B 播种。**

### 6.3.12 KnowledgeLint（v24 规范，独立于 CardLint，设计稿 §57；v33 增 K9/K10）

| ruleId | 检查内容 | severity |
|---|---|---|
| K2 | prerequisite 自循环 / 环（A 是 B 的前置且 B 是 A 的前置） | error |
| K3 | relation 自循环（from == to） | error |
| K4 | domain 不在受控清单 / KP 与卡 domain 不一致 | warn |
| K5 | AI relation confidence 低于阈值（进候选池，不进正式表） | info |
| K6 | knowledgePoint 疑似重复（归一器提议合并） | warn |
| K7 | concept 过宽（覆盖面过大，建议拆分） | info |
| K8 | concept 过窄（单例孤立，建议合并或挂靠） | info |

severity 语义与 CardLint 对齐：error 阻止入正式表；warn 可选择接受；info 仅提示。KnowledgeLint 只校验知识结构，不碰 FSRS 调度字段。

> **KnowledgeLint 落地形态注记（v43）**：K2（prerequisite 环）/ K3（自循环）已随 K1 落地为**写时校验**（`wouldCreatePrerequisiteCycle` 建环拒绝 / `createKnowledgeRelation` 自循环拒绝）；K5（低置信进候选池）/ K6（疑似重复提议合并）已随 K2-A 落地为**提案裁决形态**（指纹幂等 / n-gram+AI 归一建议）；**K4/K7/K8 于 v43 随 K2-B 落地为报告型检查**——`db.runKnowledgeLint()`（K4：KP domain 不在 UDC 受控清单、关联卡主类与 KP 主域不一致 → warn；K7：关联卡跨 ≥3 个 UDC 主类 → info 建议拆分；K8：零关系边且关联卡 ≤1 张 → info 建议合并或挂靠），IPC `knowledge:lint`，KnowledgeManager「质量检查」按钮手动触发、只读非阻断、确定性启发式零维护；K9/K10 仍随 K9 批次。

### 6.3.11 LKM 专用 PromptTemplate 分支（v24 规范，K2 起按需播种）

- **禁把知识模型职责塞进 `card-generation`（设计稿 §55–§56）：** 制卡提示词只管制卡。LKM 新增 5 个独立 scope，各自版本化播种、各自走测试台验证：`knowledge-extraction`（KP 抽取：label/description/domain/封闭档位 + evidence span）/ `knowledge-relation`（关系抽取：8 种 relationType 封闭枚举 + 置信档 + 依据）/ `material-difficulty`（材料六维难度档位估计 + 覆盖 KP 候选）/ `knowledge-probe`（dimension 探针卡：新情境出题，沿用四档评分心智，输出带 `dimension` 标签）/ `frontier-explain`（推荐解释：只组织已验证数据依据，禁编造扫描数字）。
- 每个 LKM 模板必须含判定锚语（什么条件下写哪一档）+ evidence 引用要求（无 evidence 降级 `uncertain`）+ 封闭选项清单（写法照抄 R17 UDC 清单注入方式）。

### 6.3.12 KnowledgeLint（v24 规范，独立于 CardLint，设计稿 §57）

| ruleId | 检查内容 | severity |
|---|---|---|
| K2 | prerequisite 自循环 / 环（A 是 B 的前置且 B 是 A 的前置） | error |
| K3 | relation 自循环（from == to） | error |
| K4 | domain 不在受控清单 / KP 与卡 domain 不一致 | warn |
| K5 | AI relation confidence 低于阈值（进候选池，不进正式表） | info |
| K6 | knowledgePoint 疑似重复（归一器提议合并） | warn |
| K7 | concept 过宽（覆盖面过大，建议拆分） | info |
| K8 | concept 过窄（单例孤立，建议合并或挂靠） | info |

severity 语义与 CardLint 对齐：error 阻止入正式表；warn 可选择接受；info 仅提示。KnowledgeLint 只校验知识结构，不碰 FSRS 调度字段。

## 6.4 Topic 队列优先级、推迟与下一条摘录推荐（v24 增补 Next Extract，用户已确认五项）

摘录默认 priority 50；推迟固定 ×1.6 封顶 180 天（占位）；负载感知推迟（priority 三档基础间隔 + dueLoad 分散 + postponeCount 抖动 + 上限 180 天）为设计承诺，已降级可选更新池（§9.4），替换时点未排期。

### 6.4.1 下一条摘录推荐（Next Extract，v24 规范，K4–K5 落地，一步到位）

- **定位：** Frontier 的首选落点是摘录而非整本书。摘录是用户亲手搁置的最小未理解单元（暂时不理解、等前置补上再学），与 SuperMemo Extract / Priority Queue 同构：先分散摘出、排队、前置补上后回头消化。从 KP 到摘录是一跳直达，无需先经整书再定位章节。
- **不碰现有语义：** 到期队列仍按 `priority ASC + topic_next_at ASC` 确定性排序（用户已习惯）。推荐以"推荐面板 + 可选排序开关"叠加：队列页顶部"下一条推荐"Top 1–3 + 可验证一句话解释；原列表默认顺序不变，另给"按推荐排序"开关，切过去才重排，切回恢复。**禁静默重排。**
- **破格上浮（用户确认一）：** 允许未到期但前置刚补上的摘录破格上浮；前置不满足的摘录即使 priority 高也压住，并明示缺口。
- **搁置原因（用户确认二）：** 摘录创建时加可选单选 `shelveReason`：`need-prerequisite（缺前置）/ too-dense（太密）/ need-example（缺例子）/ language（语言卡）/ other`。`need-prerequisite` 直接记一笔 `prerequisiteGap` 信号，不靠 AI 猜。
- **制卡语义：** 制卡（carded）= 用户开始建立理解的信号，只产生一条低权重 `card_creation` 证据；mastery 是否上涨只看后续复习与探针表现。制卡多但 mastery 低的 KP，其摘录加分（用户在主动啃）。
- **画像来源（按优先级）：** ① 已链卡片继承（该摘录"就此制过卡"的，直接继承 KP + domain，权重最高）；② AI 抽取候选（无链卡时走 `knowledge-extraction` 模板，先进 staging，画像缓存进 `material_knowledge_points(sourceType=extract)` + `material_knowledge_profiles`，推荐时直接查）；③ 搁置原因 + 父摘录链（`parentChain` 上下文归属）。画像字段沿用 §4.9（coverage + prerequisiteGap + 六维难度封闭档 + completionStatus）。
- **排序分：** `extractScore = KP_frontier（覆盖 KP 按覆盖度加权，前置就绪权重最高）× dueBoost（已到期加分，前置刚补上可破格）× userPriority（原样尊重，不反转）× staleness（搁置越久温和加分，防永久沉底）× diversity（同书/同 KP 连击降权，防隧道）`。最优先的永远是"前置刚好补上、只差一层"的，不是"最难的"。
- **两阶段省 token：** Stage A 本地筛 Top 20；Stage B 只对 20 条做 AI 重排与解释（`reason / knowledgeCoverage / nextConcepts / expectedChallenge`），与 §4.9 一致。离线回退"到期 + priority"基线排序。
- **动作：** 打开 / 推迟（仍只走现有 `postponeExtract` 用户动作，推荐禁写 `topic_next_at/priority`）/ 忽略（记反馈，只调 `utility`，不碰 mastery）。读完闭环沿用现有：打开 → 就此制卡（制卡管线 + CardLint）→ 标 `carded` → FSRS 复习 → 高层证据够了建议 `resolved`。
- **落地（用户确认五，一步到位）：** 不做 E0 启发式先行版，等 LKM K1–K4 就绪后按本节完整实现（见 §9.1 M8 实施路线 E 行）。

### 6.4.2 摘录状态机（细粒度 + 可扩展，用户确认四）

- **状态字段：** `extracts.status TEXT` + `status_version INTEGER` + `status_detail_json`（搁置原因、恢复条件、推迟计数等）。状态词汇表版本化；读取到未知状态一律按 `open` 对待（前向兼容）。
- **v1 状态（`status_version=1`）：** `open（刚摘出）/ reading（已打开在读）/ carded（已就此制卡，理解开始，非掌握）/ consolidating（卡在复习中，前置链补齐中）/ resolved（已理解，可归档，须用户确认或卡毕业+探针通过后建议确认）/ postponed（仍太难，继续推迟，带恢复条件）/ dismissed（不再关心，不再推荐）/ archived（归档留痕）`。
- **扩展预留：** 未来新增状态只增 `status_version=2` 词汇并写迁移映射，禁复用旧状态名、禁改旧状态语义；`status_detail_json` 为开放对象，新维度只加键不改键；`shelveReason` 枚举新增值同样只增不改。`resolved` 永不自动归档（须用户确认），`dismissed` 可随时召回。

## 6.5 日记模块与快速记录（v36，M8-A 已实现；洞察 M8-B 设计见 §9.1 M8-B）

> 构想来源见 §9.1 M8 引言（D19）。一句话定位：**学习材料的第二输入通道**——软件现有的全部输入通道收的都是「他人创造的」（书 / 文章 / 视频文案），日记收的是「**自己感受到的**」（日常事件引发的感悟与思考）。人在记录感受时的选择倾向，与选择学习材料时的倾向很可能相似，因此日记是已学知识的一种**边界拓展**。

**原则（Non-Goals 硬边界）**：不做强制标签 / 分类 / 双链；不做整理性结构要求；日记**不进 FSRS 队列、不强制制卡**（D18 精神——日记是输入面，不是复习面）；不做云端同步；洞察不自动定时触发。日记只产生 demand signal（§4.13 / K7），**禁直接写 mastery**。

### 6.5.1 三个入口，一个事实源

| 入口 | 位置 | 动作 |
| --- | --- | --- |
| 日记页 | 顶栏导航第 5 项「日记」 | 浏览 · 内联编辑 · 删除 · 搜索 · 加载更早 |
| 日记页当日输入行 | 「今天」区块**末尾** | `Enter` 提交为一条 · `Shift+Enter` 换行 · 失焦且有内容则自动提交（不静默丢弃） |
| 快速记录窗口 | 全局快捷键 `Ctrl+Alt+Space`（设置可改） | 弹出 → 写 → 发送 / 隐藏，**全程零点击** |

三个入口写同一张 `journal_entries`；任何写入经主进程后广播 `journal:changed`，日记页（及未来洞察页）实时刷新。

### 6.5.2 快速记录窗口：草稿-发送协议（v36 核心契约）

用户原话要求（2026-09-14）：「无需任何点击，随用户的输入同步保存到当日日记结尾，另起一行」+「增加一个发送按钮；不按也一律及时保存，按了则把当前全部内容算作一条存入日记；再按快捷键呼出应是空白的；不按发送而失焦则隐藏窗口但内容不算结束，再次呼出可以继续向下写」。

实现为**一条草稿行 + 两个动作**：

- **草稿（draft）**：首次输入即创建（`is_draft=1`，全局至多一条），输入停顿**防抖 1.2s** 落内存库 → 显示「已保存 HH:mm」。**永不丢**：失焦隐藏、切换页面、进程崩溃（最多丢最后几秒，见 D34）都不影响已写入内容。
- **发送**：`发送` 按钮（或 `Ctrl+Enter`）→ 该草稿 `is_draft=0` + `sent_at=now`，**定格为日记里的一条**；编辑器立即清空、窗口保持打开可继续写下一条；`entry_date` 取草稿 `created_at` 的**自然日**（跨日续写不改变归属）。
- **隐藏**：`Esc` 或失焦（`hideOnBlur` 默认开）→ 只隐藏、**不结束草稿**；再呼出载入草稿原文、光标置末尾继续向下写。
- **跨日边界**：存在**非今日**旧草稿时，呼出默认空白 + 顶部一行提示「09-14 有未发送草稿 · 继续写 / 丢弃」——既不让今天的随想混进旧草稿，也不让草稿隐身（草稿同时出现在日记页对应日期下，带「草稿 · 未发送」标记与 发送 / 继续写 / 删除 动作）。
- 空内容（trim 后为空）不建草稿行、不产生条目；`发送` 按钮在空内容时置灰。
- 键盘：`Esc` 隐藏 · `Ctrl+Enter` 发送 · `Enter` 换行（源码编辑，不做实时预览——日记页负责 Markdown 渲染）。

### 6.5.3 日记页排版

- **日期倒序、日组内正序**：今天在最上，组内从早到晚，今天组末是输入行/草稿行——新写的内容天然出现在「当日结尾」。
- 日头 sticky：`09-14 周日 · 3 条`（mono + hairline）；条目行 = mono 时间戳 + Markdown 正文（remark-math / rehype-katex 复用既有渲染链）+ hover 操作（编辑 EditableText 裸壳 / 复制 / 删除）。
- 顶部：搜索（内容子串，服务端过滤 + 命中数）与「回到今天」；底部「加载更早」（200 条/页）。
- 空状态：说明这是什么 + 提示快捷键，不堆教程文字（§5.3 规则）。

### 6.5.4 边界与已知取舍

- **无自动整理、无日历视图、无导出**为 v1 显式 Non-Goal（导出/日历/多草稿/实时预览入 §9.4）。
- 主窗口日记输入行**不采用草稿协议**（避免同一时刻两条草稿的歧义）：它是提交式输入（Enter 提交 / 失焦自动提交），未提交内容只存在于 DOM 中——与快速记录窗口的分工是「随手碎片 vs 坐下来写」。
- 日记写入**不触碰** `cards / review_logs / extracts / fsrs_configs` 任何字段（m8 测试有零影响断言）。

## 6.6 成长反馈呈现规格（v39，规范，未实现；契约见 §4.17，实现见 §9.1 M13）

> 本节的**正反馈分级总表是文案与优先级的唯一事实来源**——所有正反馈文字提示（复习页提示条、会话成果汇总、仪表盘 / Territory 中的成果文案）一律取自本表，禁自行发明文案或调整顺序（调整须先改本文档）。

### 6.6.1 正反馈分级总表（唯一事实来源：文案 + 优先级）

排序原则（用户 2026-09-15）：**越能体现用户能力提升的指标越靠前**；越简单的越靠后；**最无关紧要的从提示面取消**（不显示），以免提示频率过高稀释获得感。**单次评分多条命中时取本表最高级的那一条**（§4.17-6）；**措辞分层（用户 2026-09-15 拍板）**：记忆层事件只说记忆语言（卡片 / 间隔 / 复习节奏），知识层事件才说知识语言（知识点 / 能力维度）；**禁**「掌握 +1」「你已掌握」这类把一次评分等同于能力上涨的表述（§4.7-6）。

| 序 | 级别 | 事件（`GrowthEvent`） | 触发的可重算口径 | 文案（示例，实现批定稿） | 数据来源 | 投放面 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **L0 能力** | `transfer-first` 首次完成 Transfer | 首条 `transfer` 维度证据（探针 / 任务闭环） | 「首次迁移成功：你把『XX』用到了新情境里」 | `knowledge_evidence` | 提示条 + 汇总 |
| 2 | **L0 能力** | `application-first` 首次完成 Application | 首条 `application` 维度证据 | 「首次应用成功：你用『XX』解决了一个实际问题」 | `knowledge_evidence` | 提示条 + 汇总 |
| 3 | **L0 能力** | `kp-strong` 知识点达到 strong | 某 KP 四态聚合（短板聚合，§4.7-7）首达 `strong` | 「『XX』达到 strong：能回忆、能讲清、能应用」 | `learner_knowledge_states` | 提示条 + 汇总 |
| 4 | **L0 能力** | `kp-functional` 知识点首次达到 functional | 首达 `functional`（含 `developing → functional` 跃迁） | 「『XX』达到 functional：第一次能脱离提示讲清楚」 | `learner_knowledge_states` | 提示条 + 汇总 |
| 5 | **L1 结构** | `structure-link` 首次建立跨域可靠连接 | 首条 `analogous_to` 经用户确认（只作结构证据，§4.7-11） | 「你确认了一条跨领域连接：『A 的结构』↔『B 领域』」 | `knowledge_relations` | 提示条 + 汇总 |
| 6 | **L1 结构** | `domain-entry` Frontier 首次推进到新领域 | 新 domain 首次出现 functional 级 KP | 「开始进入新领域：XX（由你已有的 XX 结构切入）」 | Frontier 派生 | 提示条 + 汇总 |
| 7 | **L2 建制** | `material` 材料级跨越 | 某书 / 某领域巩固覆盖率首达阈值（默认过半 / 全覆盖；样本 ≥8 张卡） | 「《XX》已过半进入长期记忆」 | `cards` + `review_logs` | 提示条 + 汇总 |
| 8 | **L2 建制** | `group` 组级毕业 | `sibling_key` / `knowledge_point_id` 组（≥2 张）内全部卡达同一阶段 | 「这一组 4 张卡全部进入长期复习」 | `cards` | 提示条 + 汇总 |
| 9 | **L2 建制** | `leech-recovery` Leech 康复 | 反复遗忘的卡消解后首次稳定 | 「那张总记不住的卡稳住了」 | `review_logs` + `leech_json` | 提示条 + 汇总（单日折叠） |
| 10 | **L2 建制** | `relearning-recovery` 遗忘后康复 | 首次 Relearning → Review | 「这张卡遗忘后又回来了」 | `review_logs` before/after 快照 | 提示条 + 汇总（单日折叠） |
| 11 | **L2 建制** | `retention-180` 单卡长期维持 180 天 | 单卡 stability 首达 180 天 | 「这张卡半年不用复习了」 | `review_logs` before/after 快照 | 提示条 + 汇总 |
| 12 | **L3 次要** | `retention-60` 单卡长期维持 60 天 | 单卡 stability 首达 60 天 | 「这张卡进入 60 天档」 | `review_logs` before/after 快照 | **仅会话汇总** |
| 13 | **取消** | 单卡巩固 21 天 | 普通卡数次成功复习即达——频率高、区分度低 | — | — | **取消**（不产生提示） |
| 14 | **取消** | 学习步毕业（Learning → Review） | **每张新卡必经、零信息量** | — | — | **取消**（不产生提示） |

**取消项保留在表中并标注理由**：防止未来实现者"顺手加回来"。**不入表的 Activity 项**（永不生成正反馈提示）：书籍读完、摘录数、卡片数、AI 调用数、阅读时长、日记条数——只作 Activity 统计（§4.17-4）。

**分级与取舍理由**：L0 是知识层能力证据（Application / Transfer 为最高层证据，§4.7-5/6），天然稀有且最能体现"过去做不到、现在能做到"；L1 是认知结构与探索方向的扩展（§4.14 / §4.8）；L2 是记忆与建制的真实跨越（跨卡聚合或稀有康复），足够真实但不足以反映能力；L3 与取消项是"每张卡都会经历"的过程性指标——正是用户判定"无关紧要、会稀释获得感"的一类。

### 6.6.2 复习页微反馈（评分跨越提示）

- **形态（用户 2026-09-15 拍板）**：卡面下方轻提示条（不是弹窗、不进卡面内部），自动消失（建议 4–6s，实现批定）；点击可展开证据链（卡片 / 组内卡 / 相关日志摘要），对应 §4.17-7 的可追溯要求。
- **非阻塞硬性**：不拦下一张卡的加载与渲染、**不改变卡面布局（不推挤卡面）**、不抢焦点、不注册任何快捷键（D18 精神：复习期卡片形态不变）；同一时刻至多一条，新一条出现直接替换上一条（不排队、不堆叠）。
- **无障碍与动效**：`role="status"` + `aria-live="polite"`（评分后焦点不在提示上；参考 Reader 的 `aria-live` 先例）；进出场动效遵守 `prefers-reduced-motion`（theme.css 既有三处先例）；颜色只用 Swiss token（单焦点色，禁装饰性彩色）。
- **设置**：`settings.app.growthFeedback = {enabled}`（默认开）；关闭即**零渲染零计算**（读取路径短路，不派生事件）。
- **不丢弃**：会话内被"取最高级"规则挤掉的其余命中不丢弃，进 6.6.3 会话成果汇总。

### 6.6.3 会话成果汇总（本轮成果）

- 位置：复习会话结束页（现 `.review-session`「本轮 N 张已复习」区域）。
- 内容：本轮全部命中，按 6.6.1 序排列（含仅汇总项与折叠计数）；每条可点击看证据链。
- 空态：本轮无命中时不强行编造——只显示既有「N 张已复习」（不产生"今日无成长"之类的负面对照）。

### 6.6.4 仪表盘四层与 Territory 映射

- **层归属**：`WIDGETS` 增加 `layer ∈ {today, growth, capability, territory}` 字段；默认布局把 Growth / Capability 组件排在 Today 之后；**不推翻既有 12 组件、拖拽排序与隐藏机制**（用户主导的仪表盘，v24 起既有约定）。
- **Today（Activity 口径）**：既有 KPI / 学习热力 / 今日完成度；streak 保留但归本层（文案纪律见 §4.17-4）。
- **Growth**：新增「成长记录」组件——近期 L0–L2 事件时间线（可点开证据链）；GF-2 再增「能力变化」（四态迁移计数）。
- **Capability**：新增「能力里程碑」组件——首次 functional / strong / Application / Transfer 清单（GF-2）；每项可点击到证据链，不可追溯的项不显示。
- **Territory**：Territory 视图（新导航项或独立视图，落点实现批定）。**GF-1 阶段只以「材料 / 领域巩固地图」形态存在，不得自称知识疆域**；GF-2 升级为知识疆域图（复用 K8 力导与真实事件动画，§4.10-3 禁假动画）。
- **视觉阶段映射表**（Territory；**不是新的事实状态**）：

| 草案视觉阶段 | 事实依据（只读） | 四态 / 维度口径 | 备注 |
| --- | --- | --- | --- |
| Unknown Fog（未知 / 未接触） | 无 `knowledge_evidence` | `uncertain`（无证据） | 不显示任何"未学"评价性暗示 |
| Discovered（已接触） | 低权重证据（`reading / card_creation / diary_signal`） | `developing`（低 confidence） | "接触"不是掌握 |
| Engaged（已投入） | `card_review` 投影累积、持续学习轨迹 | `developing`（confidence 上升） | |
| Functional | `recall / conceptualUnderstanding` 维度 ≥ functional | `functional` | 由 BEMM（§4.7）估计 |
| Strong / Applied / Transfer | 叠加 `application / transfer` 维度证据 | `strong` 或维度达标标记 | **叠加标记**而非新状态 |

- **数据可得性对照**：记忆层（GF-1）＝`cards` / `review_logs`；知识层（GF-2）＝`knowledge_evidence` / `learner_knowledge_states` / `knowledge_relations` / Frontier 派生。**GF-2 不得先于 K3 落地**（§4.17-10）。

### 6.6.5 边界与 Non-Goals

- 无排行榜、无分享、无推送通知、无虚拟货币 / 经验值 / 等级、无庆祝动画（§4.17-3 / §4.17-7）。
- 不做"每日目标 / 打卡 / 连续天数提醒"；streak 只作 Activity 描述且受措辞纪律约束。
- Momentum 完整版最后落地（§4.17-8）；成长记录导出 / 自定义成长目标 / 里程碑分享入 §9.4 延后池（未排期不得自行领取）。
- 不新增 AI 调用（本层零提示词变更）；不产生 mastery 证据；不改任何学习事实（§4.17-3）。

## 6.7 用户记忆的可见性与设置（v42，契约 §4.18；批次 §9.1 M14）

> 定位：用户记忆由 **AI 自主维护**（§4.18-14 有界例外），因此产品面**唯一必须做好的事是「可见、可控、可停止」**——**不提供任何编辑界面**（用户 2026-09-15 明确要求：只在设置中提示文件位置，需要时自行用外部编辑器打开）。UI 集中在一处（设置页 `sec-memory`）+ 两处轻标记（制卡确认面板、卡片浏览页）。

### 6.7.1 设置页「记忆」区（`sec-memory`，唯一入口）

| 元素 | 说明 |
| --- | --- |
| 总开关 | 「用户记忆（AI 自动维护）」——**默认关闭**；关闭 ＝ 零整理调用、零注入、零检索，**但不删除已有记忆文件** |
| 文件位置 | 显示 `<userData>/memory/` 全路径 + 「打开文件夹」与「打开 core.md」两个按钮（用系统默认编辑器打开，软件内不集成编辑器） |
| 立即整理 | 手动触发一轮摄入（用于外部编辑文件后刷新）；无未整理条目时置灰并说明原因 |
| 注入预算 | 显示注入预算与当前三段用量（core / 目录 / 主题文件 + 合计 token 估算），可调 |
| 重置记忆 | 清空记忆文件（**二次确认** + 明示「只删除记忆，不影响日记与卡片」） |
| 说明文案 | 一行说清四件事：会发送什么（日记新增/改动片段）、何时发送（防抖整理与启动补跑）、发到哪里（你自己配置的模型）、不会做什么（不上传遥测、不写卡片正文、不参与调度） |

### 6.7.2 首次开启与补处理（§4.18-16）

- 首次开启弹**一次性说明**（发送什么 / 何时 / 预算 / 路径 / 可随时关闭），确认后生效并**立即开始补处理**——窗口＝**全部历史日记**（水位线为空）。
- 补处理前给出**范围与预估**（待整理条数 / 批数 / 预估调用次数与 token），用户可确认或取消。
- 进行中在设置区顶部显示进度「补处理：已整理 120/430 条日记」+「中止」按钮；**中止、失败或退出应用都不丢进度**，下次继续（水位线推进制）。
- 关闭后再开启：只需补**关闭期间**新增/改动的那一段（水位线保留），行为与首次一致。
- 补处理完成后自动转入常规节奏（防抖整理 + 启动补跑），**用户无需再做任何事**。

### 6.7.3 制卡侧的可见性（两处轻标记）

- **制卡确认面板**：`memoryRef` 校验通过的卡显示「情境来自记忆」徽标（点开可看所引记忆行与日期）；校验失败显示「情境来源存疑」并**默认不勾选**（用户可自行决定保留，§4.18-10）。
- **卡片浏览页**：可按「记忆接地」筛选；卡片详情显示所引记忆行与所属主题路径。**记忆条目被降级/停用或文件被外部编辑后，已入库卡片不做任何自动改写**（§1.7 / §4.12），仅在详情页标注「来源可能已变更」。
- **无 Key 或开关关闭时零渲染零请求**：不显示空壳徽标、不发起检索。

### 6.7.4 边界与 Non-Goals

- **不做记忆编辑界面**（用户明确要求）；不做记忆图谱可视化、不做时间轴/时期视图（入 §9.4 可选池）。
- **不做逐条确认流**——这是有界例外的要点：一旦改成逐条确认就不再是「零维护」；只保留 item 14 的六条护栏与 6.7.1 的总开关。
- 不在设置页暴露提示词或整理内部细节；不提供「导出记忆」按钮（文件本身可直接复制，导出入 §9.4）。
- 不改日记页与复习页的既有布局（唯一例外：§6.7.3 的确认面板徽标）。

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
- **持久化节流例外（v36）**：日记自动保存（快速记录输入中）走**防抖持久化**（尾随 4s / 上限 20s + 隐藏·发送·退出强制 flush），是本项目对「每次落库即落盘」的**唯一例外**（理由与代价见 D34）；其余任何写入（含日记页的提交/编辑/删除）仍走即时 `persist()`。新增表一律进主库（M2 备份打包整库，自动覆盖）。
- **用户记忆文件树不在主库（v42，§4.18-2）**：`<userData>/memory/` 是记忆的**唯一真源**，「新增表一律进主库」的规则**对它不适用**——**M2 备份 / 恢复必须显式包含该目录**（§4.1 记忆文件树声明、§9.1 M14 验收 ⑨）；文件写入一律**原子替换**（tmp + rename），禁止留下半截文件；整理执行只追加与标记，**绝不整文件重写**（§4.18-12）。

## 7.3 测试义务

- FSRS：`tests/fsrs/` 六件套（§4.4.6）——L0 golden（13）/ L1 adapter（15）/ L1 补强（6）/ L2 db（23）/ L4 audit（配置感知分段重放）/ L5 simulate（451，含 S6 时间语义/S7 参数环境/S8 F9 热生效），全绿。另有 undo 套件（`tests/undo.test.cjs`，29）与 persist 边界套件（`tests/persist.test.cjs`，14）——FSRS 调度链路改动须三者全跑。
- M1 制卡体系：`tests/m1.test.cjs`（材料路由/L11/cloze 契约/翻转卡约束，45 断言，依赖 `tests/m1.cards.bundle.cjs`，改 cards.ts 后须用 esbuild 重打包）+ `tests/m1.e2e.cjs`（`npx electron tests/m1.e2e.cjs`，须先关应用）+ `tests/m1.gui.mjs`（CDP 驱动真实 UI 冒烟，须先以 `--remote-debugging-port=9224` 启动应用）。
- M5 手动制卡 / 图片选区（v25）：`tests/m5.test.cjs`（28 断言：像素↔百分比换算 / 包围盒 / 归一化钳制 / 形状可用性 / SVG 图元 / 存量 rects 降级 / L11 shapes 语义 / 用户选区 AI 链路不变量（presetRegion 优先于模型 regions）；依赖 `tests/m5.occlusion.bundle.cjs` 与 `tests/m5.cards.bundle.cjs`，改 `src/lib/occlusion.ts`、`src/lib/cards.ts` 后须重打包：`node_modules/.bin/esbuild src/lib/occlusion.ts src/lib/cards.ts --bundle --platform=node --format=cjs`）+ 阅读内核 L0/L1 的 S16 图片点击契约 + `tests/reader.engine.mjs` L2 的 4c–4h（点选聚焦 / 模糊退出 / 三类工具条 / 画选区 / 手动制卡落库 shapes / 填空题挖空标记 frontMarkdown）。
- M2 备份与恢复：`tests/backup.test.cjs`（node 直跑，33 断言：zip 回环/恢复 staging 换入/路径穿越防护/自动备份按天去重与轮换）+ `tests/m2.gui.mjs`（CDP 驱动真实应用端到端：备份→恢复→重启数据不丢→设置页 UI，须先以 `--remote-debugging-port=9224` 启动应用；恢复目标是刚创建的备份，不丢数据）。
- M6-1 导入格式扩展（v26）：`tests/m6-1.test.cjs`（node 直跑 49 断言：Word 含图转换（GFM 表格/EMF 跳过不打乱序号/10MB 守卫）、TXT 编码（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退）、合成 EPUB 图片（manifest 条目/字节落包/src 重写/两次合成字节一致/identifier 折入图哈希）；改 `src/lib/epub.ts` 或 `electron/importers.js` 后须保证全绿，epub.ts 每次运行前自动 esbuild 重打包）+ `tests/m6-1.gui.mjs`（CDP 驱动真实应用端到端 23 断言，自启自关：三格式导入→assets 落盘→Word 内嵌图真实渲染→GBK 无乱码→选区制卡→重启不丢→清理）。
- M6-1 导入格式扩展（v26）：`tests/m6-1.test.cjs`（node 直跑 43 断言：Word 含图转换（GFM 表格/EMF 跳过不打乱序号/10MB 守卫）、TXT 编码（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退）、合成 EPUB 图片（manifest 条目/字节落包/src 重写/两次合成字节一致/identifier 折入图哈希）；改 `src/lib/epub.ts` 或 `electron/importers.js` 后须保证全绿，epub.ts 每次运行前自动 esbuild 重打包）+ `tests/m6-1.gui.mjs`（CDP 驱动真实应用端到端 23 断言，自启自关：三格式导入→assets 落盘→Word 内嵌图真实渲染→GBK 无乱码→选区制卡→重启不丢→清理）。
- M6-2 PDF 基础文本导入（v27）：`tests/m6-2.test.cjs`（node 直跑 22 断言：手工构造无压缩 PDF 夹具走真实 pdfjs 提取——书签大纲章节化/字号标题/页分块/单章回退/扫描版拒绝/空页统计/跨页段落愈合/确定性；CJK 重组规则在纯函数层测试）+ `tests/m6-2.gui.mjs`（CDP 端到端 15 断言，自启自关：导入→扫描版拒绝→assets→目录跳章→正文渲染→选区制卡→重启不丢→清理）。改 `electron/importers.js` 的 PDF 段落后须两套件全绿。
- M6-3 导入格式收口（v30）：`tests/m6-3.test.cjs`（node 直跑 24 断言：Readability 正文提取/噪音剔除/GFM 表格/回退链/HTML 字节解码（UTF-8 BOM/严格 UTF-8/GBK）/D30 路由表；HTML 转换依赖 DOM——用 **jsdom（devDependency）** 构造全局 window/document/DOMParser 后 esbuild 打包 `src/lib/htmlImport.ts` 测试）+ `tests/m6-3.gui.mjs`（CDP 端到端 14 断言：HTML/FB2/CBZ 建册→assets 落盘→阅读→重启不丢→清理；CBZ 的固定布局容器在闭式 shadow DOM，画面经截图人工确认）+ 阅读内核 L1 `FORMAT` 段（CBZ/FB2 直读 4 断言）。
- M6-2 修订原生阅读（v28）：`tests/pdf.kernel.cjs`（L1 级：打开→大纲→选区页码→relocate→goTo(pageIndex)→search 往返）+ `tests/m6-2native.gui.mjs`（CDP 端到端 20 断言：导入→原生渲染断言 canvas+文本层→目录跳章→选词制卡 contextRef 含 pageIndex→摘录→翻页进度落库→重启回同页→清理）。
- M7 词典 Provider（v32；v38 增语言路由与日→中解析器）：`tests/m7.test.cjs`（node 直跑 **84 断言**：取词判定/规范化候选/**语言路由（v38 D35：guessLanguage 词内+句级信号、resolveLookupLanguage 五级链、pickLocalHit 三档）**/四卡快照/Context 分离/Manager 在线优先+回落+缓存许可/local 隔离/目录分类（含 v38 jamdict-cn/kaikki 两新条目）/**v38 新解析器夹具（kaikki JSONL 流式+gzip magic、jamdict sqlite schema 探测与 chn 释义、gz 嗅探路由）**；依赖 `tests/tmp-m7/` esbuild 产物，改 `src/lib/dict.ts`、`src/lib/dictCatalog.ts` 后须重打包：`node_modules/.bin/esbuild src/lib/dict.ts src/lib/dictCatalog.ts --bundle --platform=node --format=cjs --outdir=tests/tmp-m7`；改 `electron/dictStore.js` 后同样重打包且 **v38 起必须 `--external:sql.js`**（内联会使 sql-wasm.wasm 相对 bundle 目录定位失败）：`node_modules/.bin/esbuild electron/dictStore.js --bundle --platform=node --format=cjs --external:electron --external:sql.js --outfile=tests/tmp-m7/dictStore.cjs`）+ `tests/m7.prompts.test.cjs`（6 断言，electron 隔离 userData：card-vocab 播种 v1/四卡条款/主制卡 v6 不受影响/幂等）+ `tests/m7.gui.mjs`（CDP 自启自关 **10 断言**：启动→dictAPI 桥接→card-vocab 可取→sec-dict 可见→目录行含 JMDict/ECDICT/CC-CEDICT→**v38 目录含 jamdict-cn/kaikki 日→中**→**libraryAPI.setItemLang 桥接**→来源三档）+ e2e `tests/m7.dict.e2e.mjs`（真下载 CC-CEDICT 7 断言）与 `tests/m7.ecdict.e2e.mjs`（sqlite 夹具 4 断言，M7_TEST_USERDATA 隔离）。
- M12 同源卡延后（v34）：`tests/m12.test.cjs`（`npx electron tests/m12.test.cjs`，electron 隔离临时库 42 断言：额度规则/开关矩阵/步进卡豁免/挂起排除/长选区不建组/延后零写库不变量/撤销额度回收/跨日时间注入/统计同口径/siblingKeyFor 键规则矩阵；依赖 `tests/m12.cards.bundle.cjs`，改 `src/lib/cards.ts` 后须重打包：`node_modules/.bin/esbuild src/lib/cards.ts --bundle --platform=node --format=cjs --outfile=tests/m12.cards.bundle.cjs`）+ `tests/m12.gui.mjs`（CDP 自启自关 24 断言：同句 3 卡→今日 1 张→暂缓展开→评分后收尾→fsrs 零变化→浏览页页签→设置即时生效与持久化→清理；隔离同 M7 用 `M7_TEST_USERDATA`）。改 `electron/db.js` 队列/统计段后两套件全绿。
- M8-A 日记与快速记录（v36）：`tests/m8.test.cjs`（`npx electron tests/m8.test.cjs`，electron 隔离临时库 **65 断言**：journal CRUD/软删/分页/搜索/日期分组与计数 / `journalDateOf` 自然日边界（00:00·23:59·跨月·跨年·闰年）/ 草稿唯一性与幂等 / 发送后再写产生新草稿 / 空内容拒绝 / **防抖持久化只落盘一次 + flush 后重启读回 + 未 flush 时磁盘不超前** / journal 写入对 cards·review_logs·extracts 零影响 / 两组全局快捷键配置归一化（非法回落、两者不得相同、关闭态不注册、「未注册必给可读原因」））+ `tests/m8.gui.mjs`（CDP 自启自关 **40 断言**：导航出现「日记」→ 主窗口提交一条 → `capture:toggle`（与快捷键同一入口）→ 连上捕获窗口目标输入 → 不发送隐藏再呼出内容仍在 → 发送后清空且主窗口实时出现该条 → `libraryAPI.requestAdd()` 弹出添加模态且当前视图未变 → `shortcutsStatus` 两键 registered=true → 设置页区块与冲突拒绝 → 重启不丢 → 清理）。改 `electron/db.js` journal 段 / `electron/quickCapture.js` / `src/components/JournalView.tsx` / `src/components/CaptureEditor.tsx` 后须全绿。
- **主题 Token 层（v48.14）**：`tests/accent.gui.mjs`（`node tests/accent.gui.mjs`，CDP 自启自关 **16 断言**，`M7_TEST_USERDATA` 隔离）——自定义强调色在**浅/深两套主题下都必须真正落地到渲染元素**（量 `body` computed `--accent` / `--accent-soft` / `--accent-on` + `.btn-primary` 实际 `background-color` + `.nav-item.active` 的 `color` + 原生控件 `accent-color`，不只测 Token 也测落地），覆盖：浅色基线、深色主场景（历史缺陷：`body.theme-dark` 的声明盖掉 `:root` 内联值 → 全应用回落 IKB 蓝）、深浅来回切换后自定义色存活、**反白档按底色亮度双向翻转**（浅黄 accent → 纯黑且对比 ≥4.5:1；深蓝 accent 在深色主题下 → 纯白且 ≥4.5:1，压过深色默认的纯黑）、恢复默认时两套主题各自回到 `#002fa7` / `#5b7fe8`。改 `src/lib/accentVar.ts`、`src/theme.css` 的 `:root` / `body.theme-dark` 块、或 `App.tsx` / `CaptureEditor.tsx` 的 accent 接线后须跑本套件；**该套件已验证有牙齿**——把 `applyAccent` 临时退回只写 `documentElement` 会立刻红 7 条。
- 卡片/摘录跳转、内联编辑：E2E 手动验证（启动→操作→DB 断言→清理测试数据，测试数据用 FSRSTEST 等前缀）。
- 阅读内核（v20）四层测试（§7.1.10 升级规程）：L0 `src/lib/reader/testing/fakeKernel.ts`（业务单测替身+语义定义）；L1 `npx electron tests/reader.kernel.cjs`（adapter 契约 + CJK 专项 ruby/竖排夹具，jszip 现场构造夹具书，esbuild JS API 打包 driver——**禁用 execSync+npx**，Windows 下会挂起）；L2 `node tests/reader.engine.mjs`（CDP 端到端，自启自关应用，FSRSTEST 前缀）；L3 真实语料人工冒烟（含日文竖排/ruby 真书）。
- 测试脚本临时文件用完即删；测试数据写入前先备份 library.db。

## 7.4 提示词与配置管理

- 提示词版本化播种：目标版本号在 `ensurePromptTemplates`，低于目标版本插入新版，旧版留痕；改提示词先改本文档。
- AI Key：safeStorage 加密、按服务商独立存储（`keys[preset]`），切换预设只恢复该服务自己的 Key。
- FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用。
- v29（D26）：`card-occlusion` 播种 v2「图片制卡内容感知 v2（候选）」——regions 改为每卡自带、cardType 增 qa（看图问答）、内容感知多形式出卡；主软件直插候选版（用户真实书籍实测反馈即闭环输入），后续调优走测试台；v1 留痕。
- v30（D27）：主链提示词播种 **v4**——R13 新增一卡多挖空两形态（`clozeMode` together 同答=缺省 / per-blank 分答=系统自动拆每空一卡），输出 schema 增 `clozeMode` 字段；card-enum 注明组内挖空属同答；card-literature 随 card-seq v4 同步播种防漂移。
- v30（D29）：主链提示词播种 **v5**——R19 归属锚强制（论证/理论/学说/观点性内容一律带提出者锚：front 或 contextPrefix 人名全名+学派/年代；内容卡与归属卡拆分；相似论证 warnings 提示易混）；card-occlusion 播种 **v3**（同条款适配图片卡：遮挡卡走 contextPrefix、看图问答卡写进题面）。
- v31：主链提示词目标版本 **5→6**（存量库必须更高版本号才会补播）——M1 v4 候选经用户确认并回：**取消 G9** 退出红线、R18 改**无数值门槛**软引导、R19/R2/R5 完善；`card-literature` 改播**专用文学模板 v6**（修复「写了却无人引用」的死代码，旧序列占位行留痕）。CardLint 新增 **L16** 宽容度标注（L-A 数字密度同日取消、L-B 不做）。
- v32：M7 词典 Provider 架构一次交付（**D31**：`DictionaryManager → DictionaryProvider[] → DictionaryEntry + ReadingContext → VocabularyCard` 快照卡；阅读器/弹窗/制卡只依赖接口。来源模式 local/online/auto——auto=优先在线、失败/超时/无结果回落本地，结果必显来源徽标。在线：Free Dictionary API（EN 首发）+ Jisho（JA，主进程代理过 CORS）+ Wiktionary（通用，先 EN/JA 最小字段）+ Wordnik（仅可选）。缓存 `dictionary_cache` + Provider 许可声明 `supportsCaching/cacheTTL/license/attributionRequired`。弹窗默认仅拼写/音标+播放/1–2 释义+一键制卡+来源，字段经 `settings.app.dict.popupFields` 可配，capabilities 缺失自动隐藏；词典例句关闭绝不影响原句保存。四卡快照制（D18 合规）。`WordNormalizer` 独立于阅读器核心。发音默认系统 TTS，接口形状按未来 AudioProvider 对齐。设置 `sec-dict` 一键下载：JMDict_e（约10MB，CC-BY-SA 署 EDRDG）/ ECDICT 完整+mini（MIT）/ FreeDict eng-zho（约1–2MB，GPL 注来源）/ jpn-eng（折叠备选）；CC-CEDICT/WordNet 第二批；朗道/牛津（版权不明，仅本地导入+风险注）；Kaikki 全量（数 GB，仅在线 API + 高级 URL）。`card-vocab` 新 scope 播种 **v1**（既有 v6 不动，旧版留痕）。**v32 追记（2026-09-14 实测修复，用户三问题回归）**：① Jisho 非官方 API 已下线（任何词返回 404 页）→ 在线日语查词移除，日语由 JMDict 本地包承担；dictionaryapi.dev 实测直连超时（需系统代理兜底）；Manager 增**语言路由**（在线 Provider 按 guessLanguage 过滤）+ **超时短路**（超时 Provider 本轮剩余候选不再重试，12s×N 候选曾拖 30s+）+ **纯大小写变体去重**（moral/Moral 不再双查）。② 下载目录全部 **curl 实测直链**：JMDict=www.edrdg.org（10.5MB gzip；ftp.edrdg.org https 不可达）、ECDICT 完整版=sqlite zip 207MB（repo ecdict.mini.csv 实测仅 53 行样例，mini 档砍掉）、CC-CEDICT=mdbg zip 4MB（提升入批）；FreeDict（tar.xz 无 lzma）/WordNet（多文件）停靠后续批次不给按钮。③ 下载/导入统一 `importDictRowsFromPath` 路由（.csv/.u8/.gz/.zip/.db/.dsl/StarDict 目录；ECDICT sqlite 表自动探测）+ **按名 upsert 自愈**（旧假来源行重复下载即修复）+ 状态语义 **done=已建索引 / saved=仅落盘不登记来源**（假「下载完成」不再出现）。④ **词条存独立 `dictionary.db`**（electron/dictDb.js，sql.js 独立实例+原子落盘+will-quit 兜底）——大词典入主库会让每次 persist 全量导出膨胀数百 MB 拖垮复习写路径。⑤ 测试：m7 33 断言 + **dict e2e 7 断言**（真下载 CC-CEDICT 12 万词→查「苹果」出英文；sqlite zip 夹具→查 moral 出中文）+ GUI 8 断言；全回归 m1 83/m5 34/m4 40/m6 49+22+24/backup 33/persist 14/undo 29/prompts 14+6 全绿。**v32 追记二（同日，用户实测 55% 卡死）**：`parseCedictText` 曾用 `out.some()` 去重致 **O(n²)**（12 万词条约百亿次比较）把主进程堵死（窗口无响应、进度停在 55%）——改 **Set 去重**，三个解析器统一改 **async generator**（每 5000 行 setImmediate 让出主进程），`dictDb.insertRows` 每 5000 行让出 + onProgress 回调（索引进度「已 N 词条」实时上报，期间界面保持响应）；索引流程改**先建索引、count>0 才登记来源**（解析器为流式无需整体物化）；m7 增解析器段（37 断言，含 3 万行 O(n²) 回归守卫 + 引号跨行 + JMdict 样例）；e2e 全程（下载 4MB+12 万词条建索引+查词）实测 **6 秒**。**v32 追记三（同日，用户实测 ECDICT 全量查不到词）**：`iterEcdictSqlite` 实测 ECDICT sqlite 全量 **340 万行**（stardict.db 812MB，moral 在），此前 `insertRows` cap=120 万触发截断且 ECDICT sqlite **行序非字母序**（开头全是数字词）——moral 被截在库外（用户实测查不到）。修复：cap 放开 350 万（防失控保险，须高于已知全量）+ iterEcdictSqlite 单行释义截 250 字符（词条库实测约 650MB 磁盘）+ capped 状态透传（done-capped 提示「已索引 N 词条，达到安全上限有截断」）。隔离 e2e 实测：全量 340 万导入+建索引 **44 秒**、moral 命中中文释义。**教训与配套**：① 词典 e2e 曾共用真实 userData——按名 upsert 会动用户已装来源，main.js 增 `M7_TEST_USERDATA` env 隔离（e2e/gui spawn 传临时目录），用户真实库已核查未损；② `removeSource` 增 VACUUM（DELETE 曾留 950MB 空闲页文件）；③ DictPanel 查词失败时列出已装词典并提示「CC-CEDICT 是中→英词典（头词为中文），查英文需 ECDICT」——用户三连查不到的直接原因之一即 CC-CEDICT 本不含英文头词。m7 37/e2e 7+4/GUI 8/全回归 m1 83、m5 34、m4 40、m6 49+22+24、backup 33、persist 14、undo 29、prompts 14+6 全绿；tsc 0；dist 重建。**v32 追记四（同日，用户实测空白单词卡 + 勾选需求）**：① **空白卡根因**——一键制卡在 createAcceptedCard 建卡后又调 `cardsApi.update({id, dictJson})` 写词典快照，而 cards:update 是**全行 UPDATE**（db.js updateCard 21 列直写，仅 domain/fsrs/leech/dict_json 4 列有 prev 回退），partial 对象把 front/back/noteText/contextPrefix 等 **17 列清空**（用户实测 4 张卡正反面全空白）；修复=**dictJson 随插入一次写入**（createAcceptedCard ctx 扩 dictJson 字段，insertCard 本已支持 dict_json），删除事后 update——**纪律：cards:update 禁止 partial 对象，改内容先 getCard 合并**。② **四卡勾选按语言记忆**（用户需求）：DictPanel 一键制卡前可勾选四种形式（中→外/外→中/听音/原句挖空），勾选状态按语言存 `settings.app.dictVocabKinds: Record<语言, VocabKind[]>`（照抄 materialTypes 范式，从未用过的语言默认全 4 种，toggle 即落盘）；`buildVocabDrafts(entry, ctx, kinds?)` 缺省全 4、按全集顺序过滤、空集=0 张（按钮置灰「至少勾选一种」）；按钮文案动态「一键制卡（N 张）」；onMakeCards 签名改 (entry, ctx, kinds)。③ 测试：m7 42（增 M7-7 kinds 过滤 5 断言）/e2e 7/GUI 8/全回归 m1 83、m5 34、m4 40、m6 49+22+24、backup 33 全绿；tsc 0；dist 重建。**v32 追记五（同日，用户拍板单词卡面模板 + 复习发音）**：① **卡面句式定稿**（替换旧「→ 外文拼写？」式）：前缀标签=语言名（`英语:`/`日语:`…，languageLabel 映射，未知→词汇）；中→外 front `释义：<释义>（请回忆英文拼写）`（「英文」=cueName 随语言变：日语/法文…未知→外文）、back `词（读法） /音标/`；外→中 front `拼写：<词>（请回忆单词含义）`（**不带音标**——发音是回忆目标，旧模板曾泄漏）、back `/音标/`+空行+释义；听音 front `发音：🔊（请回忆英文拼写与单词含义）`；原句挖空 front 不变、back 同①+释义段。**ECDICT pos 列实为词频码「j:93/n:7」一律不入卡面与前缀**；fmtPhonetic 裸音标自动包 /…/（'mɒrәl→/'mɒrәl/）；dict:lookupLocal 仅透传干净词性（^[a-z]+(\.[a-z]+)*$）。② **复习端发音**：review-meta 行 🔊 按钮（dict_json 存在即显示，正反面可听）；`settings.app.dictAudioSource: "tts"（默认）|"online"`，设置→词典/下载 两档切换；playVocabAudio=online 模式优先 dict_json.audio（在线 provider 真人音频，缺失回落 TTS）、tts 模式=系统 TTS（ttsLangTag 映射 BCP-47）；dict_json 快照扩 audio 字段。③ 存量旧卡不迁移（用户可删旧卡重制）。④ 测试：m7 53（增 M7-3b 卡面句式 13 断言：句式精确匹配/音标包裹/pos 隔离/②无泄漏/cueName 随语言/日语读法）/e2e 7/GUI 8/全回归 m1 83、m5 34、m4 40、m6 49+22+24、backup 33 全绿；tsc 0；dist 重建。**v32 追记六（同日，用户反馈正面发音交互）**：发音按钮从 review-meta 行**内嵌进卡面右上角**（CardFace qa/cloze 两分支，`.vocab-speak-btn` absolute + onClick stopPropagation 防触发翻面；review-face 补 position:relative）——正面即可点按发音（此前正面 🔊 只是听音卡题面文本字符，点它会翻面）；`settings.app.dictAutoSpeak`（默认关）=**自动发音**，出到单词卡即朗读（ReviewView effect 按 current.id 触发、每卡现读设置改开关即时生效；设置→词典/下载 checkbox）。测试 m7 53/e2e 7/GUI 8/回归全绿；tsc 0；dist 重建。**v32 追记七（同日，用户反馈挖空卡歧义 + 发音按钮入位）**：① **例句挖空卡词义提示**——挖空答案即用户选中词，其释义查词时已获得，**front 加第二段 `（提示：<释义>）`** 锁定唯一答案；**调研结论：不引本地翻译引擎**（transformers.js+OPUS-MT 每语言对 50-300MB/CPU 推理慢/质量一般，Argos 为 Python 生态集成差，收益边际——提示目的是锁定单词，词义即足）；若未来要整句译文走「制卡时 AI 网关翻译一次烘焙进卡面」（复习期零依赖），入 §9.4 可选池。② **发音按钮入位**：dict_json 每卡增 `kind`（中→外/外→中/听音/挖空，Reader 按草稿分别写入）；CardFace 移除右上角固定按钮，改为**听音卡按钮嵌题面字段内**（存量无 kind 卡按 front 前缀「发音：」判定）、**其余三种嵌答案字段**（答案文本后，翻面出声验证）；听音卡 front 去 🔊 字符（真按钮替代）。③ 测试：m7 54（听音 front 无 🔊+挖空 front 提示行断言）/e2e 7/GUI 8/全回归 m1 83、m5 34、m4 40、m6 49+22+24、backup 33 全绿；tsc 0；dist 重建。**。
- v42：用户记忆 User Memory（**D39**，契约 §4.18，产品规格 §6.7）——新 scope `user-memory` 播种 **v1**（摄入轮 / 整理轮两套输入输出契约：禁编造出处、只记日记中确有的事实、禁人格与病理断言、宁缺毋滥、预算与合并规则）；制卡族基线 **v6 → v7**（新增 R20 记忆接地 + 输出字段 `memoryRef`；因 card-* 各 scope 独立播种，v7 覆盖主链 10 个 scope，`card-vocab` / `card-literature` 注明 R20 不适用）；配置 `settings.app.memory = {enabled（**默认 false**——本功能会把日记正文自动发送给模型，按 §7.5/§7.6 的 consent 纪律默认关闭）, injectBudget, minIntervalMinutes, consolidateEvery, lastCoveredAt（未整理水位线，补处理依据 §4.18-16）}`；记忆文件位置 `<userData>/memory/`（`core.md` / `index.md` / `topics/<生活域>/<主题>.md`）；**M2 备份 / 恢复必须包含该目录**；**遥测与出错上报白名单（§7.6）永不包含其内容**。
- v43：K2-B 播种 4 个 LKM scope **v1**（§6.3.11 v43 记录为完整依据）——`material-difficulty` / `knowledge-probe` / `frontier-explain` / `structure-analogy`，均含判定锚语 + evidence 引用要求 + 封闭选项清单三要素；**出层契约校验与离散度守门落在 `electron/kpScopes.js`**（纯函数，主进程/prompt-lab/测试三方共用；scope 独立版本化不变）；prompt-lab 基线直引（DRAFT_TAG=v43-baseline-20260916）+「×N 次离散度」运行入口，并补齐 journal-insight / knowledge-extraction / knowledge-relation 在测试台 `BASELINE_SCOPES` 的可见性（此前只进 DRAFT_SCOPES，测试台列表一直看不到）。

## 7.5 安全

- Key/Cookie 不进日志、不上传；渲染层不持有明文 Key（流式转发在主进程）。
- 联网检索结果只作理解上下文；AI 禁止编造来源。
- **用户记忆的两条通道必须分清（v42，§4.18-15）**：**AI 调用通道**——记忆在检索命中范围内**会**发送给用户自己配置的模型（这是功能用途本身：用户自己的 Key、用户自己的数据）；**遥测 / 出错一键上传通道**——发给开发者，其白名单（§7.6）**永不包含**记忆内容，与卡片正文、日记原文同级禁区。

## 7.6 出错一键上传（v24 规范，未实现；用户需求：失败现场可修复依据）

1. **入口与 consent：** 设置页「出错时一键上传」按钮（仅手动触发，无后台自动上报）。独立 consent `app.errorReportConsent`，默认关闭；首次点击先弹说明（收什么/不收什么）再经用户确认发送。关闭后零网络请求。复用遥测规格（`docs/SPEC-usage-telemetry.md`）的队列思路，独立队列文件 `error-report-queue.json`（上限 500 条、失败保留下次重试、内存兜底 + 重启补发——persist/备份"盘不可写"场景下报告自身也写不下时先驻内存）。
2. **白名单（只允许这些字段）：** `appVersion / os platform / 失败动作类型（grade/skip/suspend/delete/undo/train/apply/backup/restore/locate/lint）/ cardId / review_seq / AI preset 与 model（去 Key 后）/ HTTP status / error_code（AI_NO_KEY 保留 code）/ duration_ms / optimizer 计数（reviewCount/cardCount/logLoss）/ backup meta（valid/app/format）/ kernel 定位层级（cfi/章节/文本命中与否）+ readerEngineVersion / lint ruleId + severity / 磁盘错误码（ENOENT/EACCES/ENOSPC 等）/ 重试次数`。
3. **禁区（绝不打包）：** `prompt/completion 正文 / front/back/sourceText / API Key / 文件绝对路径 / ai-config.json 全文 / settings.json 中的 keys`。上报前本地过滤器按白名单字段逐项放行，非常见字段一律丢弃。
4. **五处吞异常必须加 code + context（实现本节的前置修复）：** ReviewView 评分/挂起/跳过/删除/撤销 catch（现丢原始 err）/ persistNow 重试 catch / settings 读失败静默回退（记 scope.key + 回退事实）/ getConfigRow 坏行吞 null（记 configId + 损坏字段）/ applyPendingRestore marker 损坏删标记（记 marker 错误）。无根因的报告不准上传——先有 code，才有修复价值。
5. **红线：** 与遥测红线一致（首启同意外，本节另需独立确认；可关即零上报；不采内容）。错误报告与 LKM 自愿聚合（§4.11.4）共用"聚合只上传统计、原文永不离机"原则，consent 各自独立。

## 7.6 出错一键上传（v24 规范，未实现；用户需求：失败现场可修复依据）

1. **入口与 consent：** 设置页「出错时一键上传」按钮（仅手动触发，无后台自动上报）。独立 consent `app.errorReportConsent`，默认关闭；首次点击先弹说明（收什么/不收什么）再经用户确认发送。关闭后零网络请求。复用遥测规格（`docs/SPEC-usage-telemetry.md`）的队列思路，独立队列文件 `error-report-queue.json`（上限 500 条、失败保留下次重试、内存兜底 + 重启补发——persist/备份"盘不可写"场景下报告自身也写不下时先驻内存）。
2. **白名单（只允许这些字段）：** `appVersion / os platform / 失败动作类型（grade/skip/suspend/delete/undo/train/apply/backup/restore/locate/lint）/ cardId / review_seq / AI preset 与 model（去 Key 后）/ HTTP status / error_code（AI_NO_KEY 保留 code）/ duration_ms / optimizer 计数（reviewCount/cardCount/logLoss）/ backup meta（valid/app/format）/ kernel 定位层级（cfi/章节/文本命中与否）+ readerEngineVersion / lint ruleId + severity / 磁盘错误码（ENOENT/EACCES/ENOSPC 等）/ 重试次数`。
3. **禁区（绝不打包）：** `prompt/completion 正文 / front/back/sourceText / API Key / 文件绝对路径 / ai-config.json 全文 / settings.json 中的 keys`。上报前本地过滤器按白名单字段逐项放行，非常见字段一律丢弃。
4. **五处吞异常必须加 code + context（实现本节的前置修复）：** ReviewView 评分/挂起/跳过/删除/撤销 catch（现丢原始 err）/ persistNow 重试 catch / settings 读失败静默回退（记 scope.key + 回退事实）/ getConfigRow 坏行吞 null（记 configId + 损坏字段）/ applyPendingRestore marker 损坏删标记（记 marker 错误）。无根因的报告不准上传——先有 code，才有修复价值。
5. **红线：** 与遥测红线一致（首启同意外，本节另需独立确认；可关即零上报；不采内容）。错误报告与 LKM 自愿聚合（§4.11.4）共用"聚合只上传统计、原文永不离机"原则，consent 各自独立。

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
| D25 | **正文图片可点选聚焦并手绘选区制卡**（用户 2026-09-12 需求）：点击正文图片 → 上浮居中 + 周围模糊（点击模糊区域退出）；顶部悬浮工具条三类选区（矩形 / 圆形 / 多点连线多边形 ≥3 点回起点闭合）→ 提交 AI 制卡（裁剪图交多模态识别内容，**遮挡区域恒取用户选区**）或手动制卡。D16 修正范围明确化：**新增「为创建卡片而手绘区域」**；仍不做「既有卡片的遮挡区域编辑器」与「整图手动遮挡编辑器」（后者保留在可选池） | 图片内容此前无法被选中（选区服务只认文本，正文图片无任何交互入口），AI 只能看图猜遮挡点；用户需要「指哪挡哪」。坐标系纪律：模型收到的是选区裁剪图，其返回坐标属裁剪坐标系——写进 occlusion_json 必然错位，故 presetRegion 场景一律以用户选区为准（tests/m5.test.cjs M5-8 锁定） | v25 |
| D17 | 商业化在线功能（遥测/反馈/更新/多提供商/充值分发）入主线，遥测按 Hermes 规格红线实施 | 商业化前提是数据能力；红线保用户可控（首启同意/设置可关即零上报/不采内容） | v14 |
| D18 | **翻转问答卡 = 制卡手段而非卡类型**：选择创建翻转问答时创建两张互为翻转的独立问答卡（各自独立 FSRS 调度）；**今后禁止设计任何「复习时形态会变化」的卡片，一切卡片设计以 FSRS 算法为核心** | 一张卡在复习期变形（换面出题）会让同一张卡承载两种回忆任务，干扰 FSRS 对稳定度/难度的估计（调度假设每次复习针对同一题面） | v16 |
| D19 | 日记与 AI 洞察入主线（新增 M8，原 M8–M10 顺延为 M9–M11）：学习材料二分——他人创造的与自我感受到的；日记 = 主动记录的学习内容输入、已学知识的边界拓展；洞察按需触发（用户点击），日记不进 FSRS 队列、不强制制卡 | 记录感受的倾向与选择学习材料的倾向很可能相似，日记与知识库存在双向潜在关联（当下已学或将来习得的材料）；流式随想随记、无需整理 | v17 |
| D26 | **选区即画布——AI 图片制卡内容感知升级（v29 修订 D25 遮挡语义）**：用户在正文图片上划选的区域 = AI 制卡的完整图片范围，同时随图提交**图片周边文字上下文（上方 1 段 + 下方 2 段，foliate 系从章节 DOM 提取、PDF 系降级取同页文本层文字）**，AI 结合上下文出题（无关则忽略）；模型在选区内**按制卡原则自选考察方式**产出混合卡型——单挖空遮挡卡 / 一卡多挖空遮挡卡（如思维导图同分支多关键词同遮同答）/ 看图问答卡（正面图+题面文字，occlusionJson 挂图、rects 空数组）——每张卡自带 regions（选区图百分比坐标），经映射公式 `fullX = rect.x + rx×rect.w/100` 写回全图坐标并钳制 [0,100]；模型未返回有效卡时回退旧语义（整选区单卡）。L11 随之放宽为「有 asset 即有效」（rects/shapes 可空，支撑看图问答卡） | D25 的「模型坐标一律不采纳」是因当时未实现裁剪→全图映射；用户实测整选区单卡无线索不可作答，且思维导图等内容需要内容感知的多样考察方式；提示词 card-occlusion 播种 v2（主软件直插候选版，用户真实书籍实测反馈即闭环输入，后续调优走测试台） | v29 |
| D27 | **一卡多挖空两形态：同答 / 分答**（用户 2026-09-13 拍板）：AI 一卡挖 2 处时按考察意图分两形态——**同答（together，缺省）**：两空强关联需同时回忆（并列根脉/组内逐项/相邻窗口），复习正面全部挖空为[…]、背面按文本顺序列出全部答案（①②…）；**分答（per-blank）**：两空相互独立应分别作答，模型输出 `clozeMode:"per-blank"` 单份草稿，系统自动拆成每空一张独立卡（`clozeOrds=[自己的 ord]`，复习各遮一处、另一空原文显示在正面、背面只给本空答案，各自独立 FSRS 调度）。渲染端约定：**clozeOrds 空 = 遮全部 ord 且随编辑后实际文本走**（存量多空卡自动按同答渲染）；`commitQuestion` 按文本顺序逐个还原[…]（旧实现只还原第一个，多空卡编辑一次即毁第二空挖空语法） | 渲染端此前只支持单空卡：多空卡正面漏答案（只遮 `ords[0]`）、背面只显示第一个空的答案（extractClozeAnswer 非全局正则单 ord）；R13「每卡挖空 ≤2」承载的两种考察意图（一起回忆 vs 分别作答）无法区分。配套：parseCloze.render 接受 ord 数组 + renderDetail 返回文本顺序被遮序、extractClozeAnswers、expandClozeDraft 拆卡（generateCards 出卡前 + acceptDraft 接受时双入口）、提示词播种 v4 | v30 |
| D28 | **看图问答卡卡面定版**（用户 2026-09-13 拍板）：正面 = 图片 + 题面文字；背面 = 图片（无遮挡）+ **题面文字（翻面后不消失，与答案同屏）** + 答案；题面正反面皆可内联编辑（编辑同步 noteText）。普通图片挖空卡维持 v16-c 规范不变：正面 = 图 + 遮挡、背面 = 图无遮挡（+答案文本区） | v29 卡面只在翻面前渲染题面（`hasFrontText && !showBack`），翻面后题面整个从卡面消失——按问答卡习惯「翻面 → 点题目编辑」时题目不可点不可见（用户报告「有些问答卡无法点击编辑」的根因，隔离实例 CDP 实测确认） | v30 |
| D29 | **观点/理论/论证类内容的归属锚强制**（用户 2026-09-13 要求研究并安排重制卡检验）：凡卡面考察某人/某学派的论证、理论、学说、看法（公认事实除外），front 或 contextPrefix 必须带提出者锚——人名全名（R16）+ 学派/年代可选；材料考不出提出者 → 「材料中的作者认为…」+ warnings「归属未定，请人工补」；**内容卡与归属卡拆分**（「谁提出 X」独立成卡，各自 FSRS 调度）；同知识域有相似论证时 warnings 提示易混。**易混对比卡生成机制口径**（同日问答定版）：提醒走两层——①生成时 AI 语义提醒（R10：生成请求注入已有卡清单，模型发现相近概念必须在 warnings 报干扰，确认面板可见）；②接受时本地相似提醒（S1：n-gram+编辑距离，防换皮重复卡）；**对比卡生产走用户主导的 card-contrast 模式**（材料含两个易混概念时选该模式产三件套），不做全自动生成——本地 n-gram 检不出跨人语义易混（高尔吉亚 vs 巴门尼德），是否易混最终由用户记忆体验判定，且对比卡多为低优先级（R14），自动扩产违背首轮克制与确认制。候选增强（v30 同日已实现）：复习工具行「对比卡」按钮 + Leech 向导「生成对比卡」按钮 → `ContrastCardModal` 确认框（生成进度/无 Key 错误重试/逐张入库与放弃）；生成走 `generateContrastDrafts`（候选清单 `buildContrastCandidates` **只排除基准卡——挂起卡保留**（用户「标记并暂停」常是疑似重复之后处理，正是对比卡要找回的候选）；排序=同主领域卡优先、域内新→旧；文本去重；每条截 50 字、cap 500（个人库多年一般不超，接近全覆盖）；`existingCardsLimit` 放开 10 张截断，focus 指令要求模型从清单选最易混一张为 B、无真实混淆风险时允许空卡不硬凑）；入库走 `createAcceptedCard`（与 Reader 确认面板同链路：per-blank 展开+lint+S1 相似，Reader.acceptDraft 已重构共用） | 无归属锚时检索线索不唯一（R3 单义性受损）：同一论证结构可属多个哲学家（高尔吉亚《论非存在》三分结构与巴门尼德/梅利苏斯/亚里士多德《物理学》生成二分高度相似），混淆型 lapses 污染 FSRS；R19 原范围只覆盖「有争议结论」且未进图片链路（card-occlusion 无归属条款，用户实测 4 张高尔吉亚卡全部无归属） | v30 |
| D30 | **导入入口统一为单按钮 + 多选批量导入**（用户 2026-09-13 要求）：书架只保留一个「导入文件」入口，一次可多选；按**文件扩展名**自动路由到对应导入管线（epub/html 渲染层解析、docx/txt/md/pdf 主进程转换、mobi/azw3/fb2/cbz 原文件入库直读）；逐文件聚合报告成功与失败（含原因），单个失败不中断整批。分格式按钮与分格式 pick IPC 不再挂 UI（IPC 保留供测试/其他调用方） | 分格式按钮随格式增加而膨胀（M6-1 五按钮 → M6-3 将达七按钮），且用户批量导入场景（一次多本）此前需反复点选；按扩展名路由的判断是确定性的，与 §2「一切可变的东西走接口」不冲突（路由表可扩展为新格式） | v30 |
| D22 | **FSRS 参数环境版本化**：`fsrs_configs` 不可变配置快照（完整 weights+scheduler_options，指纹去重）+ `settings.app.fsrsConfigId` 活跃指针；应用新参数只影响未来调度，不回算任何存量卡片状态；review_logs 记录每条评分的参数归属，audit 按配置分段重放；settings.app.fsrsWeights 双事实源废除 | 同一套 ts-fsrs 可存在多套参数环境，历史数据模型必须在第一条优化记录产生之前定型；「audit 读当前权重」无法重现历史（多配置时代日志会被统一错放）；双事实源（config+镜像）会导致 audit/UI/engine 各读不同来源 | v23 |
| D23 | **产品学习日与 FSRS 时间语义分离**：`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0）仅定义统计口径的「学习日」（今日完成度/热力/日聚合/月内分组），不进入 FSRS 调度 elapsed_days 与优化器 delta_t；优化器 delta_t 与调度器同语义（工程不变量，行为级 oracle 锁定） | 用户钦定凌晨切点习惯（学习到凌晨不算新一天）；但调度器（ts-fsrs）内部时间语义不可注入切点——把切点塞进优化器会重建「调度≠训练」语义分叉，违背 M3 统一时间语义目标；凌晨学习的痛点本质是统计口径问题，与训练数据无关 | v23 |
| D20 | **阅读器 = foliate-js 单内核「一切皆书」+ ReaderKernel 防腐层**：文件书走 vendor foliate-js；粘贴书/摘录确定性合成 EPUB 进同一内核（摘录无 markdown 阅读边界）；锚点统一 CFI + 四层可降级恢复；PDF 走 PDF.js 基座（R4，PdfAdapter 独立于 Kernel 抽象，不预设「一切皆 foliate」）；多语言排版（CJK 竖排/ruby）为内核承诺并纳入 L1 夹具。业务代码禁止直接依赖 foliate-js（§7.1.9） | 用户需求：完整阅读器（多格式界面统一/目录/模式切换/外观自定义/标注/内外链接）。foliate-js 为调研后唯一可嵌入的宽松许可引擎（MIT；Readest/Anx/Foliate 三个生产应用同型验证）；文本锚点精度不足（同章重复错位）而 CFI 字符级精确；防腐层隔离其 API 不稳定风险 | v20 |
| D24 | **Learner Knowledge Model 架构定稿（v24，纯文档不实现）：** 三层分离 + 状态可重算 + AI 非事实源升最高不变量（§1.8–1.10）；知识本体＝Domain + KP 一等实体 + 8 种封闭关系（§4.6）；BEMM 五维 Beta + Bottleneck + 分层证据（§4.7，否决强制周测）；Frontier 六因子 + 四档挑战（§4.8）；材料画像 + 两阶段推荐（§4.9）；Obsidian 式 2D 图 + 真实回放动画规格（§4.10）；双轨调优（用户轨本地优化器 + 开发者轨仿真为主，§4.11）；FSRS 隔离边界（§4.12）；Insight 三层证据 + Meaning 第三图（§4.13）；LKM 五独立提示词分支 + KnowledgeLint K2–K8（§6.3.11–12）；出错一键上传白名单/禁区/队列（§7.6）；路线 K0–K8（§9.1；**v33 增补见 D32：** K9 结构连接 + 实施路线整体并入 M8，关系枚举 8→9、LKM scope 5→6、KnowledgeLint 扩到 K10） | 用户桌面设计稿（LKM §0–§87 + Insight 21 节）经 8 问打磨合并：AI metadata 封闭化防换模型漂移、混合建图保 ID 稳定、分层探针替代周测、双轨调优解默认与个人参数、一键上传补失败根因。v24 只定架构与契约，K0 起按最小单元实现 | v24 |
| D31 | **词典 Provider 可插拔架构（v32，M7 一次交付）**：Manager → Provider[] → Entry + Context → 快照卡；local/online/auto（auto=优先在线回落本地）；四卡快照制（D18 合规）；系统 TTS 默认发音；一键下载首批 JMDict_e/ECDICT/FreeDict（朗道牛津仅导入+风险注，Kaikki 仅在线+高级 URL） | ChatGPT 十四节审查合并：Local/User 合并；ECDICT 提前；共享 Entry 改快照；在线走主进程代理 | v32 |
| D32 | **结构连接 Structure Connection（v33，用户 2026-09-14 构想，纯文档零代码）**：i+1 的「i」除已掌握知识点与前置外还包含「已有知识中的相关结构」；连接手法封闭枚举 `analogy / abstraction / combination` 且**三种都必须产出槽位映射 mapping**；初步认知模型生命周期 `proposed → accepted(tentative) → refining → converged / replaced / abandoned`；推荐必须说明推荐理由 + 结构相似之处 + 至少一条主要差异（disanalogy）+ 可证伪追问；**关系枚举 8→9**（新增 `analogous_to`——结构类比/跨域同构，不参与 prerequisite 无环约束、不派生 due/优先级）；Insight 三分支→四分支（+Structure）；LKM 实施路线整体移入 §9.1 M8、K0–K9（K9＝结构连接）；v1 落库最小化（不建结构实体表：已持有结构＝本地检索出的 KP+关系子图，跨域对应落 `analogous_to`+`structureLabel`+`mappingJson`） | 用户：LKM 是软件核心功能之一；`generalization_of / specialization_of` 只覆盖同域抽象层级，跨域结构对应此前无处安放 | v33 |
| D33 | **同源卡延后 Sibling Burying（v34，定契约 + 同日实现）**：同一制卡来源单元产出的多张卡（翻转对 / D27 分答拆卡 / M7 单词四卡 / D26 同图多卡 / 对比动作）在同一学习日**只放行一张、其余延至次日**；**延后是队列视图纯函数 `computeTodayQueue` 而非调度写入**（不改 due、不写 fsrs_json、不产 review_logs、不触发 leech——Anki 式 bury 对 elapsed_days/delta_t 的扰动在本软件中不存在）；`cards.sibling_key` 分组键确定性规则（结构性同源＝制卡动作单元键、短材料同源＝来源锚点键 ≤300 字符、长选区不建键）；同源额度按 review_logs⋈sibling_key **全量**统计（已评分兄弟卡 due 移入未来仍在额度内——m12 实测修正） | **否决**「内容重复度分析决定延后」备选：本地 n-gram 检不出换措辞同源卡（D29 同局限），AI 判定调度违反 §1.7/§1.9/§1.10；该备选入 §9.4 池 | v34 |
| D34 | **M8-A 日记与快速记录（v36，用户 2026-09-14 需求「随想随记 + 全局快捷键弹出小编辑器、输入即保存」）**：Logseq 式流式日记（`journal_entries.entry_date` **自然日口径**，不随学习日切点漂移）+ 全局快捷键 `Ctrl+Alt+Space` 快速记录捕获窗口（草稿-发送协议、输入即落库、跨日不混稿）+ `Ctrl+Alt+N` 就地呼出「添加书籍」（不切换视图）；**防抖持久化（尾随 4s / 上限 20s + 隐藏·发送·退出强制 flush）是本项目「每次落库即落盘」的唯一例外**（理由与代价见 §6.5/§8.2）；单实例锁；日记不进 FSRS 队列、不强制制卡（M8-B 洞察按需触发，D19） | 随想随记的输入摩擦必须为零；崩溃最多丢最后几秒为用户接受的代价；学习材料二分——他人创造的与自我感受到的（第二输入通道） | v36 |
| D35 | **词典查词语言路由（v38，用户 2026-09-15 实测：日语书选「山」被判中文走 CC-CEDICT）**：纯汉字串消歧**五级链**＝面板手动切换 > 词内假名/々〆 > 句中假名 > 书籍语言（`library_items.lang`）> 字面正则；`dict_sources.lang` 来源语言列 + 本地命中 `pickLocalHit` 按来源语言精确匹配优先（不再被先入库的 CC-CEDICT 抢走）；DictPanel 语言 chips；日→中词典调研结论：JMdict 官方无中文版，可自由再分发者仅 jamdict-cn 与 kaikki zhwiktionary 两部（版权词典 OCR 产物排除） | 五级链保证「更近的语言信号优先」；来源语言精确匹配是本地多词典命中正确性的唯一可靠判据 | v38 |
| D36 | **成长反馈 Growth Feedback＝呈现层只读（v39；契约 §4.17，产品规格 §6.6，批次 §9.1 M13）**：① **只读不变量**——不写 FSRS 字段与 `review_logs`、不写 LKM 表、不进调度 / 训练 / 推荐排序、不作 `utility / challengeFit` 输入；读侧只在 `COMMIT + persist + IPC` 成功之后，派生失败静默降级；② **四层口径**——Dashboard 分 Activity / Growth / Capability / Territory，活动量不得冒充成长，Capability 每项必须可点击到证据链，**不设万能总分**且禁"环形总进度条"变体；③ **正反馈分级总表**（§6.6.1，用户 2026-09-15）——越能体现能力提升越靠前，单次评分多条只取最高级，最无关紧要的两项（单卡学习步毕业、单卡 21 天巩固）**取消**；**措辞分层**：记忆层只说记忆语言、知识层才说知识语言，禁「掌握 +1」（§4.7-6）；④ **首次语义**——`(事件, 实体, 维度)` 只报一次，首次时刻由 `review_seq` 全序重算不落表，撤销静默回退，防回灌只报"本次评分触发的跨越"；⑤ **streak 归位**（用户 2026-09-15）——保留既有 streak KPI 与里程碑尺，归 Activity 层 + 措辞纪律（禁「即将断签」类文案与提醒）；⑥ **排期**（用户 2026-09-15）——整批排在 M8-B 与 K0–K9 之后（成长反馈消费 K 系列产出的知识模型 / 算法 / Frontier 数据）；内部两步 GF-1 记忆层（零 schema 变更、零新写路径）→ GF-2 知识层（依赖 K1–K4） | 用户草案《Growth Feedback / 成长反馈系统》的"真实性优先 / 行为与成长分离 / 不设总分 / 不奖励垃圾积累 / 视觉变化必须对应真实数据 / 不制造惩罚性反馈"原则保留；修正其对 LKM 数据的依赖假设（LKM 在代码中零实现）、补全首次语义与撤销联动、防回灌与回落规则，并按用户 2026-09-15 要求把"最无关紧要的提示"从提示面取消以免稀释获得感 | v39 |
| D37 | **M8-B + K 系列整体架构契约（v40，用户 2026-09-15 四项拍板）**：① **K1 先行**——知识地基（`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals` 四表 + 归一合并 + active/merged/deprecated 生命周期 + `prerequisite` 无环校验）提到 M8-B 之前实现，M8-B 直接消费真实 KP/子图，**不做 UDC+n-gram 临时适配器**（避免给 M8-B 建一层 K1 落地后即报废的中间抽象）；M8 内部顺序改为 **M8-A ✅ → K1 → M8-B → K2–K9**；② **架构先行两步走**——本批纯文档冻结契约（六表 schema + §4.2-23 `KnowledgeBase` + §4.2-24 `InsightEngine` + Evidence Package 结构冻结），实现分 K1、M8-B 两批，每批独立可运行；③ **Personal Meaning 独立候选表**——`personal_meaning_candidates`（含 `proposed/accepted/rejected/ignored` 状态机）随 M8-B 建表，第三图跨图边与 proposals 机制复用等 K 系列再扩；④ **完整 K1**——四表全建 + 合并可回滚（`merged_into` + alias）+ 旧字段不删列（存量 `cards.knowledge_point_id/domain` 语义不动，读取侧提供归一建议回填 proposals） | M8-B 规格（§4.13-5 禁全库直发、LEARNED 层须可追溯 KP）的前提是 KP 可检索可追溯，没有 K1 的洞察只能退化为「日记内主题汇聚」，与已定规格差距过大；先做 K1 的一次性成本换 M8-B 直接落最终架构；架构先行符合「需求变更先改文档（§1.6）」与「一次只实现一个最小单元（§1.4）」；独立候选表换最小 schema（用户不选轻量 JSON 方案——确认状态机值得一等公民字段） | v40 |
| D38 | **AI 抽取归一与关系（K2-A）＝三层确定性架构（v41，用户 2026-09-15 拍板触发/确认/范围）**：**问题**——用户实测 K1 本地归一建议不可决策：AI 制卡把「每批材料内部簇编号（kp1…）」直接写进 `cards.knowledge_point_id`，跨材料必然碰撞（不同书的 kp1 无关却同名），本地字符串匹配看不出卡片实际讲什么；用户要求改 AI 处理并给「硬性处理规范，以免 AI 多次处理生成不同结果」。**方案**：① 三层架构——**本地规范化收敛（入）→ AI 只输出封闭契约提案（中）→ 本地裁决器（出）**，AI 跑 N 次结果不变由规则保证而非模型稳定性；② 规范化 `normalizeKpLabel` 产 `normKey`，同 normKey 全库至多一个 active KP；③ 幂等键 `fingerprint=sha1(kind+clusterKey/端点+action+normKey)`，同指纹任何状态已存在即跳过（**含已拒绝 —— 否决即事实，永不重提**）；④ 批次簇键 `batch:<genBatchId>:<kp>`（v41 起 AI 制卡落库写 `gen_batch_id`）解绑跨书碰撞，存量回落 `doc:<documentId>:<kp>`；⑤ 裁决器确定性规则——normKey 命中→自动归一（别名并入+auto 提案留痕）；AI 新名撞已有 normKey→强制转 link；run 内同名簇合并为一条提案 `clusters[]`；目标歧义/越界→pending；prerequisite 建环的 AI 关系本地丢弃留痕；⑥ 触发＝**制卡顺带**（接受入库后后台静默）+ **手动批量**（知识点页签「AI 整理」）；确认＝**提案制 + 一键全接受**（§1.7 红线不变）；⑦ 范围＝**抽取 + 归一 + 关系**（K2 六 scope 之前 2 个：`knowledge-extraction` / `knowledge-relation` 播种 v1），余下 4 scope 与 KnowledgeLint K4/K7/K8 完整落地留 K2-B | 用户 2026-09-15 三问拍板（触发/确认/范围）；「硬性规范」经本会话设计为架构层保证：AI 只在中层且不能生成 ID，进出两端全是本地确定性代码——这是「同输入重复跑不出新结果」的唯一可靠形态（提示词自律做不到）；簇编号跨材料碰撞是存量数据的事实缺陷，批次簇键是本地可算的唯一性解 | v41 |
| D39 | **用户记忆 User Memory（v42，用户 2026-09-15 构想 + 本批调研；契约 §4.18，产品规格 §6.7，批次 §9.1 M14）**：① **用途单一**——由日记增量整理出的用户真实处境，为**应用卡（R15）的情境部分**与助记卡（R12/R9）的生活线索提供接地，让「当我遇到 X 应该问自己什么」锚定在用户真正经历过的事上，而不是模型编的通用场景；② **形态＝分层文件真源**（本项目首个非 DB 用户数据真源）——`<userData>/memory/` 下 `core.md`（恒定注入 ≤800 字）+ `index.md`（目录，恒定注入 ≤1,200 字）+ `topics/<生活域>/<主题>.md`（按需注入，单文件 ≤1,200 字）；**总量不设上限、永不自动删除、不做衰减**（用户：「越久远的记忆越珍贵」），预算只约束**单次注入量**（合计 ≈4,400 字 ≈3,100 token，可调）；③ **条目三级模型**（事件 / 处境 / 事实，照自传体记忆三级）+ **生活域封闭分类（8 + 其他，由 WHOQOL / 个人幸福指数 / DISE / PERMA 并集收敛）+ AI 命名子主题**；④ **检索两阶段**——Stage A 本地**宽召回**（书名/章节/正文词面 + 本书已有卡 UDC 域 → 领域映射表 → 1–2 篇主题文件）+ **目录恒定注入**（召回为空也不静默：模型可在 warnings 点名缺失主题）；Stage B **交给模型**判断用不用（**不写本地相关性门槛**——用户拍板：本地门槛成本高、且一旦不够完美就会过严而使功能失效）；⑤ **拒用铁律（R20）**——记忆只出情境、**不出答案与事实**（答案必须来自材料）；**无贴合处境必须省略**（`memoryRef: null` 合法且受鼓励）；措辞可含用户自己的具体事物（项目/领域/书名）、**禁第三方隐私**、**禁逐字搬日记原句到卡面**；溯源只做**逐字抄录 + 子串存在性校验**（非相关性判定，失败只标注不阻断，不新增 CardLint）；⑥ **整理全自动零维护**——日记变更防抖整理 + 启动补跑；**摄入轮**（只追加与标记）+ **周期整理轮**（合并近似重复 / 拆分超长 / core 降级，**同一处境的多次记录不合并**）；**永不删除、永不原地改写**，执行一律精确文本匹配、**绝不整文件重写**（用户外部编辑不被覆盖），手写区 AI 永不改动；⑦ **§1.7 有界例外**——本功能是唯一「AI 自主写、不经逐条确认」的用户数据，以六条护栏为成立条件（唯一消费者是制卡草稿情境 + 末端确认面板保留 / 不出答案 / 不写卡片正文与 FSRS·LKM / 设置页明示路径 + 可停用 + 可重置 / 每轮留痕 / 永不上传遥测且永不作调度与掌握度输入）；⑧ **开关与补处理**（用户 2026-09-15 追加）——`settings.app.memory.enabled` **默认关闭**，关闭期间日记照记、**水位线保留**，重新开启即**分批补处理**关闭期间的日记（时间正序、可中断可续跑、进度可见），窗口过大时先给范围与预估再开始；⑨ **提示词**——新 scope `user-memory` v1（摄入轮 / 整理轮契约）+ 制卡族 **v6→v7**（R20 + `memoryRef`），先测试台再播种；**M2 备份必须包含 `memory/`**；实现拆 **UM-1 记忆文件与整理管线 / UM-2 接地与检索** 两批，排在 **K2-B 之后**。 | 用户 2026-09-15 构想（Hermes 式记忆文件）经本会话调研后改造 + 三条追加要求（零维护 / 覆盖日记一切内容 / 越久远越珍贵）。**否决「照搬 Hermes」**：其 2,200/1,375 字符硬上限靠「装满即合并删旧」维持，与「越久远越珍贵」直接冲突；**否决「单一记忆文件」**：不分层则每次注入要么过大（长上下文退化有实测依据：Chroma Context Rot）、要么淘汰早期记忆；**否决「本地语义相关性判定」**（用户拍板：实现成本高、易过严）；**否决「逐条确认提案流」**（同前：与零维护直接冲突），改用有界例外 + 六护栏。选型依据：分级存储（MemGPT 归档/上下文分离、Letta「文件树当路标」、Claude Code「索引上限 + 主题文件按需读」）、PIM「导航 56–68% 远多于搜索 4–15%」（故文件按主题切、时间作标签）、Zep 15/5 实测（≈756 token / 77.06%）、自传体记忆三级与长程保持近幂函数（故不衰减）——出处见附录C | v42 |
| D40 | **M15 材料知识导图定契约（v44，用户 2026-09-17 拍板；补录——此前仅在 §4.19/§9.1 引用未入本表）**：两图分立（导图＝作者视角独立产物、知识图谱＝大脑画像，联结只经「节点制卡→复习→学习证据→KP」真实链路）；**质量优先于成本**（无截断）；阅读器目录旁「导图」入口 + 范围/粒度选择 + 发送前预览；图先于图示 + 本地校验；分片缓存；无 Key 可读降级；导图永不写知识图谱/不产 mastery/不进 FSRS 与推荐。v47 按此实现后因生成质量不达标整体回滚（快照 `docs/m15-archive/`），v48 重设计沿用其定位与全部拍板 | 用户 v44 四项拍板；v47 实测教训（主干空洞/SVG 观感差/知识点候选粒度不对）沉淀于 §9.1 M15 回滚注记 | v44 |
| D41 | **M15 重设计架构（v48，ChatGPT 65-Task 方案经代码库现状审查 + A–H 补充约束审查后并入，用户 2026-09-18 批准）**：① **作者组织单元**取代知识点候选中间表示——AI 首答「作者在这里做什么」（authorial_role 封闭枚举 + relation_to_parent/siblings + progression；归并节点必带 grouping_basis，无法证明同属一个高级结构不许强行合并），TOC 作结构先验、**自底向上递归归并**；② **parent-owned text＝区间集合差**（文档级线性化坐标系，**禁字符串减法**；同 href 多级 TOC 以最深节点为提取 owner、上层保 tocPath 无 ownership；超长按段落/块边界分片、禁字符硬切）；③ **四层提示词契约** `material-map-section/merge/global/editorial` v1 + **AI 语义审查确认制**（审查只管结构质量/作者组织表达/层级合理性/目录机械复制/空洞节点，事实与字符校验归本地 Validator；输出机读 issues（nodeId/type/severity/repairScope∈section_analysis／chapter_merge／global_merge／editorial，单元格内用全角分隔）；FAIL 展示问题+重估费用，**用户确认后**仅重跑对应归并阶段；一次 repair＝重跑+本地校验+语义复审，仍 FAIL 即停；用户主动「重新生成」属新运行不受限；旧有效地图永不因失败消失）；④ **双证据模型**——节点标题允许抽象命名（无需 title∈sourceText），语义主张须可追溯 **direct evidence**（quote 逐字命中本单元抽取快照）或 **compositional evidence**（引用同图内后代节点 exact evidence，禁悬空）；**证据裁决＝0 命中 REJECT / 1 命中 ACCEPT / 多命中以 AI offset 消歧、无法唯一确定则 AMBIGUOUS**（证据有效但 positionAmbiguous，跳正文只到单元锚）；offset 仅作提示非裁决依据；抽取快照文本**不入库**（sql.js 全量落盘防库膨胀）只存 snapshotHash/quoteHash/matchStart/matchEnd；⑤ **存储 3 表**——`material_maps`（每版本一行：scope/粒度/结构 JSON（节点+边+证据内嵌）/sourceRevisionHash/promptVersion/provider+model+modelConfigHash/nodeRemapJson/isActive）、`material_map_shards`（逻辑键 documentId+单元锚+运行类别+粒度+promptScope+promptVersion+文本hash+provider+model+modelConfigHash）、`material_map_runs`（状态机/预计与实际 token 费用/repair 次数/错误）；节点↔卡片关联经 `cards.context_ref_json.mindmapNodeId` 派生查询（**卡片永不改写**，imageSource 先例）；M2 整库备份自动覆盖；⑥ **节点身份 remap**——新版地图被用户接受时本地确定性匹配（提取单元覆盖重叠 → evidence quoteHash 重叠 → 标题精确相等，按序打分），oldId→newId 存 `nodeRemapJson`，学习状态查询沿 remap 链解析；未匹配旧卡留在旧版本语境；title 不作身份、siblingKey 保持创建时点值 | v47 实测三失败点 + 代码库现状（ai.js 无 usage 捕获/取消/机读错误码；备份整库覆盖；kpScopes 逐字裁决先例）；语义审查「确认后再重跑」与「动工前提交基线」经用户拍板（2026-09-18） | v48 |
| D42 | **M15 交互与视觉（v48）**：① 导图＝挂 Reader 外层的**全屏 Overlay**（内核不销毁，返回正文天然原位，无需位置恢复链；ImageFocus 同款模式）；② evidence 导航＝`goTo(单元锚)` + quote 高亮 best-effort（**高亮失败≠导航失败**），不新造定位系统；③ 渲染＝AI 只输出结构 JSON，**本地确定性 tidy tree 布局**（自研纯函数、无随机源、同一 JSON 布局恒等）+ SVG 渲染器；语义缩放 7/12/24 密度阶梯；自包含 SVG 导出（无 JS/无外链/无远程字体）；④ **图标**＝现有内联 SVG 优先（2026-09-18 核查：项目无 lucide 依赖、图标全部手绘内联），缺失的将 Lucide path 本地内嵌（ISC 许可、零依赖、无 CDN）对齐 token 线宽字号，**不引入 lucide-react**；其余视觉服从瑞士风 Token（单 accent / 无阴影渐变 / 直角 / 8px 基线 / ≥11px 文本 / 深色模式 / reduced-motion） | v47.2 全屏工作区决策保留（需求文档「已实现并获认可，保留」）；视觉 Skill 的 Lucide 要求与规则 19（不新增不必要依赖）通过「本地内嵌 path」同时满足 | v48 |
| D43 | **M15 v48.5 实施修订（用户实测四轮反馈 + ChatGPT 双轮审查）**：① **制卡语义分立**——阅读器选中文本=具体知识卡（考事实/概念/表达），导图节点=结构卡（考作者组织方式，card-structure 分支、九类结构关系封闭枚举随卡标注、答案须完全可从语义包推导、禁评价性判断与事实退化）；② **expand 深挖管线**——expandable/stopReason 原子性判断为正常终止依据（文本长度仅为复杂度信号），仅 expandable=true 入队；max_depth/call_budget 为系统强制停止并在 run/metrics 留痕；预算触顶 → partial（未激活版本+旧 active 保持）；③ **删除语义**——material_maps 真删+事务性 active 顺延，shards=缓存保留；④ **remap 主条件**——单元锚/quoteHash 重叠，标题仅弱辅助禁止单独映射；⑤ 评审分片+根一致性；⑥ 粒度选项移除（恒 detailed） | 用户四轮实测（点击失效/拖动选字/详细粗略/制卡按钮）+ ChatGPT 两轮计划审查（expand 触发条件、remap 标题风险、partial 语义、覆盖统计口径） | v48.5 |
| D44 | **M15 v48.11 作用域修复与可观测性（性能 + 正确性）**：① 深挖作用域的权威定义＝节点自身 **sourceSpans**（全文 UTF-16 码元一维坐标、多区间、由 evidence 命中 + 聚类 + 行边界扩边 + **父级交集钳制** 确定性推导），`unitAnchors` 退回纯「证据定位/remap 覆盖」语义；② 深挖/补漏只读自身 span，超限**只切不删**（段落→句→硬切+重叠、按 canonical span 去重）；③ 残余覆盖账 + 补漏（coverageGap 与轮次上限）；④ 预算＝run 级全量计数，输出超限走降级不截断；⑤ 账本真源＝`material_map_calls` + run 总账 + 启动僵尸对账；⑥ 首层就绪（section_ready）与深挖续跑分立，深挖可中断可续；⑦ 并发默认 1、429 降半+冷却、单作业失败隔离 | 本机真实运行审计（81 次调用/4 作业各 17 次、单次 36 秒与输入无关、账本缺 28/113）+ ChatGPT 三轮审查（先修作用域再谈并发；evidence 是锚点不等于作用域；只切不删；输出不截断；preview 分阶段；benchmark 重复取中位） | v48.11 |
| D45 | **M15 v48.13 发布模型与评审闸门（P1 正确性修复 + P2 后台任务指示器）**：① 语义评审的阻断条件收敛为**严重度**（`severity==="high"` 唯一硬闸门；`type` 只是描述标签；模型显式 fail 且给 issue 时单向棘轮仍阻断），非阻断意见**必须留痕**（`metrics.reviewStatus/reviewIssues`）；确定性完整性校验（JSON/nodeId/parent/cycle/span/引文可定位）仍是独立硬门，不因模型 pass 放行。② 建立 **Published Map / Candidate Map** 概念：候选版本不得顶掉已发布版本；首层中间态仅在「无任何已发布版本」时作 provisional 发布；候选在续跑达到可发布条件后**事务性**成为新的 active（旧版退位不删）。③ 生成任务由主进程持有、与任何界面生命周期解耦（离开导图/回正文/切工作区都不取消，**只有显式点击取消才取消**）；新增全局**后台活动指示器**（右下角、默认极小收起、hover/keyboard focus 展开、单一 accent/直角/无渐变/reduced-motion）与「导图已更新」完成态（措辞刻意不是「生成完成」——深化随时会让它继续长大）。④ 终态文案诚实化：候选 ≠ 失败，未继续深化 ≠ 失败，失败不覆盖旧图。 | 真实 run `ea70cad5` 法医调查（模型 status=pass + type=topic_list + severity=low 被引擎改判 fail）+ 85 节点成品被 10 节点中间态顶掉的现场 + 用户四项设计调整 + ChatGPT P1–P4 批次建议 | v48.13 |
| D46 | **M15 v48.13 P4 展开与深化分家 + 增量评审 + 增量深化（用户拍板「改成增量评审」）**：① 「展开」（已有子结构、纯 UI、零 AI 请求）与「深化」（尚无更深结构、创建后台任务）在数据模型、引擎 API 与 UI 三处严格区分，未深化 ≠ 没有更深内容（可深化节点带＋号徽标 + 详情说明 + 终态说明）；② 深化 ＝ 以已存地图为基底的作用域受限 generate（不重建 / 不重跑 merge·global / 不跑 editorial / 不补漏），一次深化 = 目标节点分片数 + 1 次增量评审；③ 语义评审作用域改为**增量**：只评本次新增分支 + 必要上下文，结果只决定该分支能否发布，单分支失败不连坐整图；整树评审仍用于初次生成；④ 深化就地更新同一版本行且**不改发布关系**；⑤ 已记录已知代价：深挖指纹含 depth，首层图与整图深度不同 → 深挖缓存不跨路径复用（特征化测试锁定，不写虚假承诺）。 | 用户 2026-09-20 拍板「改成增量评审，然后继续完成后续步骤」；ChatGPT P1–P4 批次建议 §9/§10/§11；v48.13 法医调查（单分支失败不应连坐整图） | v48.13 |
| D47 | **M15 v48.13 P3 应用重启续跑（被打断 ≠ 失败）**：① 启动对账 status 由 `failed_timeout` 改为 **`interrupted`**（关掉应用不得被记成一次失败）；② 新增 `listResumableMaterialMapRuns()`（`interrupted` + `section_ready`，连表带材料标题）与 `mindmap:pendingRuns` IPC；③ 渲染层启动即播种全局指示器 → 重启后显示「导图生成被中断 · 可继续」；④ 点击携带 `resumeRunId` 经 App→Reader→工作区透传，收完原文即同 runId 续跑（缓存命中、零重复计费）；首层就绪的 run 不自动续跑（按需深化由用户点节点决定）；⑤ 只有正在跑的任务才显示「取消」；播种只认 `interrupted`/`section_ready`，其余状态一律不播种。 | ChatGPT P3 契约（「应用重启后 running/queued/recoverable → 自动恢复或重新入队；不得把正常退出等价于任务失败；同 runId cache hit 不重复产生 API 成本」）；用户「每次完成请提交改动」 | v48.13 |
| D48 | **M15 v48.13 P5 真实运行审计修复 + 「首层即成品」口径**：① 引擎子事件（expand/coverage_audit/retry）不得当阶段用——状态归一白名单 + 未知事件沿用上一次不编造；② **已发布的版本不因一次失败而消失**（partial 时若本轮更新的是已发布那一行则保持发布；降级由 run 行 completeness 留痕）；③ 引擎级**同材料同范围串行化守卫**（防两 run 并发写同一行地图互相覆盖；同 runId 续跑不算冲突）；④ **首层就绪后不再自动续跑整树深挖**——初始只需「足够深入」，更深的枝条按需深化；原「一次跑完全部」能力改为侧栏显式按钮「自动深挖全部（约 N 次调用）」，不再默认发生；⑤ 指示器在用户点「打开导图」后消失（非运行中）。 | 用户实测追问（21:03 那次 466.7s 的运行：首层 73s、其后自动深挖 393s；运行中两次出现「已取消」）+ 库内只读审计（run 50074faf 时间线 / 地图 active 状态 / 无任何 cancelled 运行或调用）| v48.13 |
| D49 | **M15 v48.13 P6 空态自救与入口可见性**：① **历史版本区移出 `hasKey` 与 `phase==="done" && structure` 两重条件**（纯只读操作，任何状态/无 Key 都可见）+ 空态明确告知「没有已发布版本但历史里有 N 个，点一版即可激活（成果没丢）」；② **「自动深挖全部」按当前可深化节点数决定可见性**（此前只在刚生成完那一瞬可见），无本轮 run 时也能走完整管线；③ 版本行版面重排：标题/时间分两行、标题撑满宽度可换两行、删除按钮固定 44px 不拉伸；**根因是 CSS 特异性**（`.mindmap-versions button` 0-1-1 的 width:100% 压过 `.mindmap-version-del` 0-1-0），收窄选择器为 `.mindmap-versions .mindmap-version-pick` 并补几何断言（gui 32）。教训入档：上一轮写下「历史版本里就有」时未经验证，实际是错的——本轮改用**探针复现**（真实应用 + 预置只有未激活版本的库）先复现再修，并把复现固化为 gui 断言。 | 用户实测反馈（成果不见了 / 看不到历史版本 / 看不到自动深挖全部按钮 / 版本格版面不合理）+ 探针复现 | v48.13 |
| D50 | **v48.14 UI 优化收口（分支 `UI优化`，全量落在表现层，`electron/*` 零改动）**：① **两项视觉受控例外拍板（用户）**——评分按钮组四色保留为「**档位序数色**」受控例外（互斥序数档位，非"同屏多焦点色"；映射 error/warning/accent/success 固定语义 Token，全应用仅此一处，禁止外溢到卡片/徽章/图表，新序数控件须先登记），阅读正文衬线保留为「**阅读正文除外**」（哲学 3 只约束界面 chrome；阅读器工具条/目录/菜单/批注卡仍须无衬线）——两条均已写入 `docs/swiss-international-style.md`；② **§5.4 跳转链接文案去掉尾部箭头**（`跳转原文 →` → `跳转原文`），理由见 §5.4；③ **§5.3 spacing 补 2px 半档**写法；④ **六项功能/交互级变更登记**：`AddBookModal.handleSave` 补 try/catch/finally（此前 onSave 一 reject 就永久卡在"保存中…"且异常被静默吞掉）、`ReaderEngine` 新增 `onError` + 阅读器错误块与「重试」入口（此前开书失败只剩空白正文区，**§5.x 原无阅读器错误态规范，本条即其首次落地**）、AddBookModal 3 处 `window.alert` 与 Bookshelf 的 `confirm`/`alert` 改内联反馈条 + 书架卡片**就地二次确认**（确认态常驻可见、焦点默认落「取消」；§5.4/§6.5 原未规定确认形态，本条为规范起点）、仪表盘 **Alt+←/→ 键盘重排**（把手由装饰 SVG 改为 `<button>`，与拖拽共用同一条 `reorder()` 落库路径）、8 个模态补 `role="dialog"`/Esc/焦点陷阱/焦点归位、新增 Token `--shadow-panel`/`--radius-pill`/`--lh-prose`/`--error-on·-soft·-hover·-pressed`；⑤ **派生 Token 求值层修复**（本轮最有价值的架构发现）：自定义属性里的 `var()` 在**声明它的元素上**求值后才继承，故 `:root` 里的 `--accent-soft` 会被 IKB 钉死、上层改 `--accent` 带不动 → 同一界面出现第二个焦点色；派生档改为在 `body` / `body.theme-dark` 各重算一次，并把「**凡会被上层覆盖的 Token，其派生档必须在上层重新声明一次**」与「**全仓 `var()` 引用与 `--x:` 声明做差集，差集必须为空**」写入 swiss 文档「引用有效性」；⑥ **卡片四类由文档词汇转为落地**（`.ai-draft`/`.kmg-prop-card`/`.card-quote`/`.ins-quote`/`.dash-widget` 挂语义类，收掉三处"灰底又叠描边"混用与一处把 `--border-strong` 当列表卡默认描边），表格收口为「只画横向 hairline」；⑦ **死 CSS 清理 34 条零引用规则**；⑧ **皮肤扩展点保留但改判为 M11 预留**：原第二皮肤「下蛋 Dream 玻璃拟态」已下线（`c3fd637`），`--shadow-panel` / `--radius-pill` 与 swiss 文档「皮肤层」一节现为**零消费者的预留扩展点**（基线取值即瑞士风默认，不覆盖则外观不变），服务 §9.1 M11「界面自定义与主题社区」，非对基线的放松；⑨ **测试义务补跑与两处陈旧声明**：补跑 18 个 GUI/E2E 套件（reader L2 20/20、reader.paging 9/9、m8 40/40、m12 24/24、m15r 33/33、m14 18/18、m8b 13/13、m6-1 23/23、m6-2native 20/20、m6-3 14/14、k1 16/16、k2a 8/8、k2b 9/9、m7 10/10 全绿）；`m6-2.gui` 8/15、`m1.gui` 14/2、`m2.gui` 19/3、`m4.gui` 19/13 **在 `main` 上数字与失败断言逐字相同**，判定为既有陈旧断言而非回归——§7.3 把它们列为测试义务但实为红，待单独修断言。⑩ **深色模式自定义强调色失效修复**（用户实测反馈「自定义的绿色在深色下全变回蓝色」）：根因是 `applyAccent` 只写 `documentElement`，而深色档声明在 `body.theme-dark`，声明胜过继承 → 自定义色停在无渲染的 `:root` 上；改为写 `body`（内联压过任何选择器）+ 保留 `:root` 一份，机制与修法见 §5.1-③，回归锁为 `tests/accent.gui.mjs` 16 断言（已验证撤掉修复即红 7 条）。**差分实测确认该缺陷自 v20 起即存在、非本分支引入**（601aa93 上 `body` computed `--accent` 同为 `#5b7fe8`、主按钮同为 `rgb(91,127,232)`，逐字相同）。 | 用户四项指令（新建分支不动 main / 分支改名 UI优化 / 结合 Design Review + 瑞士风审查全界面 / **只碰 UI 相关代码**）+ 两项视觉拍板 + 契约一致性审查报告（`architecture-health`，2026-09-21：4 处文档↔代码矛盾、2 处陈旧声明、6 项未登记变更）+ 两分支成对截图对照与差分实测 | v48.14 |
| D51 | **v48.15 书架页重设计（分支 `UI优化`）**：① **留白根因与修法**——`repeat(auto-fill, 200px)` + `justify-content:start` 把 0–223px 余量整块甩成右侧空白，改 `repeat(auto-fill, minmax(min(100%, var(--shelf-min)), 1fr))` 让余量被各列等分吸收；1200px 容器实测 5 列各 208px、富余 0.00px（旧算法同宽余 40px），并把它写成 `tests/shelf.gui.mjs` 的几何断言防回归。② **吸顶工具条**收纳 视图 / 密度 / 排序 / 添加材料（§5.3）：主按钮不再藏在书墙末尾，空态随之去掉重复主按钮（连带修订 swiss 文档两处空状态规则）；窄窗口**单调退让阶梯**（900/1100/1280 容器宽）——非单调阈值实测会让 760/900 两处挤成两行。③ **书卡改图注制**（§5.4）：书名与进度常驻、操作收进 40px ink 动作条、卡面原生 `<select>` 换成共享 `Dropdown`。④ **手动顺序 + 文件夹**：拖拽三区落点（两侧重排 / 中央归组，两意图不同形）、`Alt+方向键` 与仪表盘同语义、命名不自动取名也不 AI 取名（默认「未命名文件夹」+ 成组即弹输入框，Esc 取消不留空盒）、文件夹识别度只靠形状（标签页 + ≤56px 书脊条 + Title L 成员数）、hover 名册列成员、**三条退出路径**、**只有解散没有删除**、**一层为限**（嵌套需求由阅读器目录承担）。⑤ **数据落点定为设置而非新列**：`app.shelfOrder` / `app.shelfFolders`，零迁移、备份已覆盖、`listItems()` 不动；云同步期合并复杂度如实登记为代价并保留 `sort_order` 折算升级路径。⑥ **文件夹不改数据归属**：统计 / 今日队列 / FSRS / 导图 / 记忆一律不感知。⑦ 样张 `design-samples/bookshelf-redesign.html` 为设计依据与实测记录（可改宽度、可拖拽、可成组）。⑧ 本轮属交互级变更，按 §8.2 结论**不适用纯样式豁免**，故文档先行：§5.3 / §5.4 / §6.2 / §4.2-3 已先落地规范再写码。 | 用户两轮书面需求（① 缩放留白 ② 无法拖拽排序 ③ 添加按钮在最末尾且封面形态按钮难看 ④ 视图/密度/排序进工具条 ⑤ 空态去重复主按钮 ⑥ 文件夹：拖到书上成组 + 自定义命名）+ 三轮实测反馈（「2 本本」双单位、文件夹样式无识别度 + hover 需见成员、回退入口不明显）+ 样张逐宽扫描与浏览器内交互回归 | v48.15 |

## 8.2 已接受偏差（实现与原锁定方案的差异）

| 偏差 | 原锁定 | 现状 | 处置 |
|---|---|---|---|
| 状态管理无 Zustand/TanStack Query | §2 表 | React state + EventBus | 接受为既成（D2），不再计划迁移 |
| 数据库 sql.js 而非 better-sqlite3 | §2 表 | sql.js 全量回写 | 接受；数据量显著增长后迁移（Roadmap） |
| 联网检索三引擎回退 | 文档锁 DDG 单方案 | Bing→DDG→百度 | 接受（更稳） |
| UI 微调类任务未逐次 bump 文档 | §1.6 | v12.2-v12.4 界面微调直接实施 | v13 重构时补记；此后功能级变更仍须先改文档，纯样式微调豁免。**v48.14 复核**：`UI优化` 分支据此豁免纯样式部分（Token 收口 / 间距 / 字号 / 色彩 / 死 CSS），但其中 6 项属功能/交互级、当时未先改文档即实施——已于 **D50** 一次性补记收口（含 §5.4 文案与 §5.3 半档两处指南修订）。教训入档：豁免只覆盖"纯样式"，**新增 UI 元素、新增键盘能力、改变确认形态一律不算纯样式**。 |
| 产品学习日（本地日切点）与 FSRS 时间语义（UTC 日历日）统计口径差 | §4.4.8 | 本地凌晨时段（00:00–切点）的复习：学习日统计算「昨天」，FSRS elapsed/delta_t 按 UTC 日历日计 | 接受（D23 产品语义选择）：准点复习下两者恒等；仅影响统计口径，不影响调度/训练一致性 |
| **§1.7 有界例外：AI 自主写用户记忆、不经逐条确认**（v42，D39 / §4.18-14） | §1.7 AI 输出必须人工确认 | 记忆文件由 AI 在整理轮中自主增补与标记，用户不逐条确认（设置页只给总开关 / 路径 / 立即整理 / 重置） | 接受并限定：唯一消费者是制卡草稿的**情境措辞**，每张卡仍逐张经确认面板（人工闸门保留在末端）；配六条护栏（不出答案 / 不写卡片正文与 FSRS·LKM / 路径可见 / 每轮留痕 / 开关可停用 / 永不上传遥测且不作调度与掌握度输入）；关闭开关即零调用零注入 |
| **用户记忆以文件而非 DB 为真源**（v42，D39 / §4.18-2） | §1 纯本地 + §7.2 数据完整性（DB 为事实源） | `memory/` 目录的 Markdown 文件是记忆唯一真源，DB 只留 `memory_runs` 运行留痕与 `cards.memory_ref_json` 溯源 | 接受：用户要求「设置中提示路径、自行用外部编辑器打开」且软件内不设编辑器；文件即真源符合 §1.9（run 快照 + 精确匹配 op 可复现）；**M2 备份必须包含该目录**；永不进入遥测白名单（§7.6） |
| **用户记忆整理的 AI 编排在主进程**（v45 / §9.1 M14 UM-1） | K2-A/M8-B 先例：AI 调用由渲染层编排（主进程不拼提示词） | 摄入轮/整理轮/补处理由 `electron/memoryTidy.js` 在主进程编排，经注入的 chat 包装既有 chatStream 调用（Key 不进渲染层） | 接受：记忆整理是**后台基础设施**（防抖/启动补跑/补处理须与窗口生命周期解耦，且 m14 库测直跑主进程）；提示词纪律不变——文本只来自播种模板 `user-memory`，主进程不写提示词正文 |

| **EditableText 键盘焦点环**（v48.14 / D50） | §5.4「点击出光标、失焦落库、**无任何框线**」 | 鼠标路径仍零框线（`.review-editable:focus { outline: none }` 保留）；仅 `:focus-visible` 加 2px accent 环 | 接受并限定：§5.4 的「无任何框线」原意是**去掉编辑态的视觉装饰框**，不是取消键盘焦点指示——改前该处 `outline:none` 特异性 (0,2,0) 压过全局 `:focus-visible` (0,1,0)，键盘用户内联改卡时完全看不到光标落点，同时违反 §5.3「键盘焦点环 2px accent」与 swiss 禁止清单「❌ 移除焦点环且无替代」。指南两处本就互斥，此条把边界写死：**框线装饰 = 一律禁止；焦点指示 = 键盘必须可见**。 |
| **§7.3 四个 GUI 套件实为红**（v48.14 / D50 发现） | §7.3 把 `m6-2.gui` / `m1.gui` / `m2.gui` / `m4.gui` 列为测试义务（隐含绿） | 实测 8/15、14/2、19/3、19/13；**在 `main` 上数字与失败断言逐字相同**（如 m1 期望选区菜单 5 按钮、实际 6；m4 期望快捷键区块 13 行、实际 17） | 判定为既有陈旧断言而非回归，**不在本分支修**（属功能层断言，越出「只碰 UI」边界）。待办：单独修这四个套件的断言与前置库状态说明，并在 §7.3 标注各套件所需的库状态；修好后 (e) 类检查才可作为 CI 闸门。 |

## 8.3 版本变更记录（摘要）

- **v6** AI 制卡与助读体系（第 6.3 节）；**v7** Topic 调度承诺；**v8** occlusionJson + Key 加密；**v9** 管线架构 + 联网检索；**v10** 本地模型预设；**v10.4** thinking 信号；**v10.5** reasoning_effort；**v11** FSRS 调度契约（§7）+ F1-F6 修复；**v12** FSRS 优化器（§7.7）；**v12.2** 界面重设计（A 导航/去重标题/连续复习/跳转原文/删除/双面编辑/EditableText/dist 优先）；**v12.3** 摘录锚点；**v12.4** 顶栏 no-drag 修复 + 问题区内联编辑；**v13** 本文档六部分重构（无业务逻辑变更）；**v14** 主线重排（主线批次 M1–M10，数据备份与恢复按用户要求入主线；原未实现 Phase 全部降级 §9.4 可选更新池；新增 6.3.10 规划与 D14–D17）；**v15** M1 落地（四卡形式：reverse 双向卡 + 图片挖空生成链路；材料类型路由 detectMaterialType + AI 面板手动覆盖；独立提示词测试台 prompt-lab；提示词覆盖核对报告；card-occlusion 新分支播种；修复 extractClozeAnswer 组序 bug——v3 无 hint 挖空卡背面曾恒为空串；修复 prompt_templates 首装播种条件——全新库上 reader-explain/leech-rescue 曾缺播种）；**v16** 翻转问答重设计（**D18**：废除 reverse 卡类型与 reverse_json——翻转问答=制卡手段，创建/转翻转卡时拆为两张互为翻转的独立 qa 卡；禁止复习期形态变化的卡片，一切卡设计以 FSRS 为核心）；测试台修复（labAPI 守卫 + 启动 bat + applyDraft）；测试台 v4 候选补丁（G1-G9 + card-literature 文学/诗歌背诵候选，待用户实测）；覆盖报告更新处置状态并新增文学性材料研究（§五→§四）；**v17** 日记与 AI 洞察入主线（**D19**：新增主线批次 M8——Logseq 式流式日记补上第二输入通道（自我感受到的学习材料）+「洞察」按钮按需触发 AI，发现日记与已学知识的双向关联；日记不进 FSRS 队列；原 M8–M10 顺延为 M9–M11）；**v18** M2 数据备份与恢复（设置页手动备份/恢复：单 zip 含清单、ai-config 默认不含勾选才含、备份位置可配；每日首启自动滚动备份按天去重+保留份数轮换；恢复=校验→安全备份→staging+标记→重启换入生效，运行期不动库文件；新增 `electron/backup.js`、`backupAPI`、设置「备份与恢复」区块；测试 `tests/backup.test.cjs` 33 断言 + `tests/m2.gui.mjs` 端到端）；**v19** 卡片浏览升级批次（① **跳转原文现场查看语义**：跳转会话阅读器不写阅读进度与阅读字数统计，切出后记录位置保持上次真实阅读位置——此前跳转后滚动/切出会把跳转位置写进 progressJson，丢失真实阅读进度；统一 `handleJumpToDoc(docId, anchor, returnTo)` 三处入口（复习/队列/卡片浏览），修复队列跳转返回落点曾错回复习页的死代码问题；② **卡片浏览 Anki 式改造**：全量卡片表格+搜索+类型/状态筛选+排序+行详情（卡面内联编辑/暂停恢复/推迟/重置新卡/删除/跳转原文/质检问题/Leech 入口），`listAllCards` 补 docTitle JOIN；③ **共享 Dropdown 组件**：dashboard/Dropdown.tsx 提升为 components/Dropdown.tsx（+align 左对齐变体），AI 制卡侧栏「材料类型」下拉由原生 select 换为直角下拉，与统计数据页风格一致（纯样式组件复用）；**v20** M3 FSRS 集成验证（**L5 时间轴模拟层** `tests/fsrs/simulate.test.cjs`：全生命周期单卡剧本/整体时间平移不变性/预览=落库同源逐轮验证/遗忘链 leech 触发/优化器训练输入链；**官方做法审计**实锤并修复 **F7**——`fsrs_json` 缺 `learningSteps`（ts-fsrs 学习步进索引）致 learning 档第 2 步 Good 永不毕业、10 分钟档死循环，契约 §4.4.1 补该字段；`fsrsEngine.preview/next` 增可选 `now` 时间注入参数（渲染层行为不变）；golden.cjs 过时的 fuzz=true 断言纠正为 false；回归义务升级六件套（§4.4.6/§7.3））；**v21** M4 快捷键（**CommandRegistry 落地**（§4.2-2）：`src/lib/commands.ts` 命令表 12 条=用户锁定键位、组合键规范化（存储=展示同串）、全局 keydown capture 分发（输入焦点绝不劫持、e.repeat 忽略、抑制集合）、键位覆盖项只存非默认于 `settings.app.keybindings` + `src/lib/useCommands.ts` ref 注册；阅读四键（制卡 Ctrl+Z/AI 制卡 Ctrl+X/AI 解释 Ctrl+A/摘录 Ctrl+S，动作与选区菜单按钮同源，when=有选区且无弹层）；复习键（空格翻面仅正面、1-4 评分仅背面、q/w/d 有卡即可，删除仍 confirm，busy 守卫防连发；跳过不计「本轮」为既有语义未动）；设置页「快捷键」区块（捕获新键 Esc 取消、冲突拒绝保存、单条/全部恢复默认）；测试 `tests/m4.test.cjs` 39 断言 + `tests/m4.gui.mjs` CDP 23 断言 + `tests/m4.cleanup.cjs` 摘录清库配套）；**v22** 复习撤销评分（用户需求：误评无撤回。review_logs 增 `fsrs_before_json` 评分前快照列（ALTER TABLE 迁移，旧日志 NULL 不可撤销）；db 增 `getLastUndoableReview`/`undoLastReview`（恢复快照→物理删除该条日志→本次触发 leech 则解除挂起并关闭本次 LEECH issue→返回恢复后的卡）；IPC `cards:lastUndoableReview`/`cards:undoReview`；`review` 调用链补第 5 参 fsrsBefore；命令表增 `review.undo`（Z，13 条）；复习页 meta 行「撤销评分（X）」按钮 + 收尾页撤销按钮；撤销后回到该卡背面可立即重评、本轮计数 -1；**决策：撤销=物理删除日志**——review_logs 本无软删机制（无 is_deleted 列），训练/统计 10 处查询直读该表，物理删除使优化器输入与统计自动干净，避免 10+ 处查询改动风险；测试 `tests/undo.test.cjs`（electron + 临时 userData 隔离库）+ m4 两套同步更新（13 命令 / GUI 撤销段））；**v23** M3 增补批次：FSRS 数据完整性加固与学习日语义（**最高不变量**「同一份复习事实不允许两套解释」入 §4.4；**D20** fsrs_configs 不可变配置快照（完整 weights+scheduler_options+指纹 UNIQUE，无 update API，切换=settings.app.fsrsConfigId 指针，reset=指针回 cfg-default，apply 指纹去重）+ **废除 settings.app.fsrsWeights 双事实源**（存量迁移播种后删除）；**D21** 学习日=统计口径（settings.app.dayCutoffHour 本地钟面 0-23 默认 0，`learningDayIndex/learningDayStartMs` 仅统计），禁止进入 FSRS 调度/训练；**fsrsTime.js 独立实现 canonical delta_t**（UTC 日历日差复刻 ts-fsrs 5.4.2 语义，无库依赖，oracle=ReviewLog.elapsed_days 行为级对照）；review_logs 增 fsrs_after_json/leech_before_json/fsrs_config_id/fsrs_before_config_id/review_seq（唯一索引，存量回填=rowid）；**review 成功边界=COMMIT+persist 成功+IPC 成功**（崩溃一致性措辞，非跨层 ACID）；persist() 原子写（tmp+fsyncSync+renameSync，失败 throw 无静默降级，启动清残留 tmp）；**persistNow 纯持久化重试**；**undo 重写**：8 字段 after 全等校验（v22 旧日志不可撤销）+leech_before 精确恢复（F10）+fsrs_before_config_id 恢复+review_seq 序+事务；saveReview/undo 事务化；fsrs.ts 由完整配置快照构引擎+主进程 fsrs:configChanged 推送热重建（**F9**）；SettingsPanel「新一天开始时刻」设置；ReviewView 过期 preview 判废+保存失败横幅；audit.cjs 按日志 config 分段重放；测试 S6 时间语义/S7 参数环境/undo U6-U9/persist 边界套件；缺陷修复 **F9**（权重应用不热生效，UI 曾宣称即刻生效）、**F10**（undo leech 以「当前挂起」推断误回退手动挂起）、**F11**（persist 非原子整库覆盖写））；**v23** M3 增补批次：FSRS 数据完整性加固与学习日语义（**最高不变量**「同一份复习事实不允许两套解释」入 §4.4；**D22** fsrs_configs 不可变配置快照（完整 weights+scheduler_options+指纹 UNIQUE，无 update API，切换=settings.app.fsrsConfigId 指针，reset=指针回 cfg-default，apply 指纹去重）+ **废除 settings.app.fsrsWeights 双事实源**（存量迁移播种后删除）；**D23** 学习日=统计口径（settings.app.dayCutoffHour 本地钟面 0-23 默认 0，`learningDayIndex/learningDayStartMs` 仅统计），禁止进入 FSRS 调度/训练；**fsrsTime.js 独立实现 canonical delta_t**（UTC 日历日差复刻 ts-fsrs 5.4.2 语义，无库依赖，oracle=ReviewLog.elapsed_days 行为级对照）；review_logs 增 fsrs_after_json/leech_before_json/fsrs_config_id/fsrs_before_config_id/review_seq（唯一索引，存量回填=rowid）；**review 成功边界=COMMIT+persist 成功+IPC 成功**（崩溃一致性措辞，非跨层 ACID）；persist() 原子写（tmp+fsyncSync+renameSync，失败 throw 无静默降级，启动清残留 tmp）；**persistNow 纯持久化重试**；**undo 重写**：8 字段 after 全等校验（v22 旧日志不可撤销）+leech_before 精确恢复（F10）+fsrs_before_config_id 恢复+review_seq 序+事务；saveReview/undo 事务化；fsrs.ts 由完整配置快照构引擎+主进程 fsrs:configChanged 推送热重建（**F9**）；SettingsPanel「新一天开始时刻」设置；ReviewView 过期 preview 判废+保存失败横幅；audit.cjs 按日志 config 分段重放；测试 S6 时间语义/S7 参数环境/undo U6-U9/persist 边界套件；缺陷修复 **F9**（权重应用不热生效，UI 曾宣称即刻生效）、**F10**（undo leech 以「当前挂起」推断误回退手动挂起）、**F11**（persist 非原子整库覆盖写））；**v24** Learner Knowledge Model 架构定稿（**D24**，纯文档零代码）：§1 增三最高不变量（§1.8-1.10）；§4 新增 §4.5 总览 + §4.6 本体（UDC 退位/Domain/KP/8 种封闭关系/AI metadata 封闭化/混合建图）+ §4.7 Evidence 与 BEMM（五维 Beta/Bottleneck/分层探针替代周测）+ §4.8 Frontier（六因子/四档挑战）+ §4.9 材料画像与两阶段推荐 + §4.10 Obsidian 式 2D 图与真实回放规格 + §4.11 双轨调优（lkm_configs 快照 + 用户轨门槛 + 开发者轨仿真为主）+ §4.12 FSRS 隔离边界 + §4.13 Insight 三层证据与 Meaning 第三图 + §4.14 插件节 renumber；§6.3 新增 LKM 五独立 scope（§6.3.11）+ KnowledgeLint K2-K8（§6.3.12）；§7 新增 §7.6 出错一键上传（白名单/禁区/队列/独立 consent + 五处吞异常补 code）；M8 补 LKM 日记联动（只产 demand 禁写 mastery）；§9 新增状态表 K0-K8 行 + §9.6 实施路线；第六部分标题同步 v24。**v24 增补（Next Extract，用户五项确认）：§6.4 扩展为队列 + 下一条摘录推荐（破格上浮允许、shelveReason 可选单选、推荐面板 + 独立排序开关、禁静默重排）+ 细粒度可扩展摘录状态机（status/status_version/status_detail_json，v1 八态，未知状态前向兼容 open）；§9.6 增 E 行（一步到位，随 K4–K5 落地，不做启发式先行版）。****v24 增补（Next Extract，用户五项确认）：§6.4 扩展为队列 + 下一条摘录推荐（破格上浮允许、shelveReason 可选单选、推荐面板 + 独立排序开关、禁静默重排）+ 细粒度可扩展摘录状态机（status/status_version/status_detail_json，v1 八态，未知状态前向兼容 open）；§9.6 增 E 行（一步到位，随 K4–K5 落地，不做启发式先行版）。**；**v25** M5 手动制卡优化 + 正文图片点选聚焦批次（**D25**：点击正文图片 → 上浮居中 + 周围模糊（点击模糊区域退出）→ 顶部居中悬浮工具条三类选区（矩形 / 圆形（椭圆）/ 多点连线多边形 ≥3 点回起点闭合）→ 提交 AI 制卡或手动制卡）：① **阅读内核新增 `imageClick` 事件**（`ReaderKernel.on("imageClick")`，语义 = src + 宿主视口坐标框 + 显示尺寸；图片字节由壳层按 src fetch，内核不搬数据；链接内图片让位链接）+ fakeKernel `__emitImageClick` 测试钩子；② **新增 `src/lib/occlusion.ts`**（像素↔百分比唯一换算口 / 形状包围盒 / 归一化钳制 / 可用性判定 / SVG 图元描述 / rects→shapes 存量降级）；③ **新增 `src/components/reader/ImageFocus.tsx`**（聚焦覆盖层）与 `src/components/OcclusionShapes.tsx`（复习端与确认面板共用形状渲染，variant=card|proposal）；④ **`cards.occlusion_json` 增 `shapes`**（rect/ellipse/polygon 精确轮廓，rects 恒为包围盒兼容旧渲染与 L11；L11 语义扩为「有 rects 或 shapes 且有 asset 即有效」）；⑤ `generateOcclusionCards` 增请求装配注入口（context.focus + **context.presetRegion**——用户选区场景下遮挡区域恒取用户选区，模型返回的 regions 属裁剪坐标系一律不采纳）；⑥ 新增 IPC `assets:saveImage`（渲染层字节直接落盘入 assets 表，替代文件对话框）；⑦ **M5 手动制卡**：四类型页签（含图片挖空）+ `UdcPicker`（UDC ≤2、首个为主）+ 字段对齐 AI（contextPrefix/domain/mnemonic/knowledgePointId/dateStamp/priority，generatedBy=manual）+ CardLint/S1 强制；⑧ **修复 F12**（填空题手动制卡的挖空语法此前未写入 frontMarkdown，复习端无挖空 ord → 挖空从不遮蔽）；⑨ 测试：新增 `tests/m5.test.cjs`（28 断言）、阅读内核 L0/L1 增 S16 图片点击契约、L2 增 4c–4h（聚焦/退出/画选区/手动制卡落库/填空题挖空标记）；顺带修复测试脚手架缺陷（reader.driver.js 的 runFake/runFoliate 曾返回 undefined 致统计恒 0 项；reader.engine.mjs 的 7c 顶层 await 语法错误；**m1.gui.mjs 自 v20 内核化起失效的 G1/G2/G3**——改按引擎视图注入选区并断言四类型页签，现 16/16 全绿）。**；**v26** M6-1 导入格式扩展首批（用户 2026-09-12 三项拍板：**Word 内嵌图必须保留并展示在阅读材料中**、**Anki 牌组不做**（成品问答卡不是阅读材料）、补调研主流格式——结论：必须支持=EPUB/DOCX/TXT（GBK 检测为中文刚需）/Markdown/HTML（M6-3）/PDF（M6-2），被动兼容零投入=MOBI/AZW3、FB2、CBZ（foliate 内核已可直读），跳过=KFX（DRM）/CBR（RAR 许可）/DJVU/CHM/ODT/.doc 二进制（提示另存 .docx）/RTF；M6 拆批 M6-1→M6-2（PDF 纯文本先行）→M6-3（HTML+调研收尾））：① **合成管线图片能力（唯一结构性改动）**——`buildSyntheticEpub` 增 `opts.images`（章节 img src 重写 `rewriteImgSrcs`→`images/<filename>`、OPF manifest 追加 image 条目、zip 落 `OEBPS/images/` 二进制、`imageHashSuffix` 把图片字节哈希折入 dc:identifier 防同文异图碰撞），**`SYNTH_GENERATOR_VERSION` syn-1→syn-2**（无图输入与 syn-1 字节级同构且 identifier 恒等，存量粘贴书 CFI 不受影响）；② 新增 `electron/importers.js`（主进程转换：mammoth `convertToHtml`+`convertImage` 收集内嵌图按出现序确定性命名 img-N.ext、turndown 主进程直跑（ATX 标题供章节切分）+ 自实现 GFM 表格规则、EMF/WMF 不可渲染格式跳过不打乱序号、单书图片总量 10MB 守卫超限中止；`decodeTextBytes` 编码检测 UTF-8 BOM→严格 UTF-8→UTF-16 LE/BE BOM→GBK 回退（原生 TextDecoder，零新增依赖）；`txtToMarkdown` 逐非空行成段（中文一行=一段主导形态，原文含 markdown 标记则自然章节化）；`markdownFromText` 直通；`titleFromFilename`）；③ `electron/db.js` 增 `createImportedDoc`（source_type=word/txt/markdown 统一建册，原文件落 assets kind=word/txt/markdown-original，内嵌图 kind=image-content，M2 备份自动覆盖）+ `readContentImages`（读侧取回图字节随合成落包）；④ IPC `library:pickWord/pickTxt/pickMarkdown`+`library:createFromWord/Txt/Markdown`+`library:readContentImages`；`libraryApi.pickImport/createImported/readContentImages`；AddBookModal 增 Word/TXT/Markdown 三按钮，App.loadReaderBook word 分支取图随合成 EPUB 内嵌（foliate 内核 blob 重写加载）；⑤ 测试：`tests/m6-1.test.cjs`（43 断言，node 直跑，esbuild ?raw CSS 插件现场重打包 epub.ts）+ `tests/m6-1.gui.mjs`（CDP 自启自关 23 断言：三格式导入→assets 落盘→Word 内嵌图 foliate 真实渲染→GBK 无乱码→选区制卡 CFI→重启不丢→清理，FSRSTEST 前缀）；阅读内核 L1 44/44、L2 20/20 回归全绿（粘贴书路径不受 syn-2 影响）；已知体验债：# 开头文档（Word 常见）打开落在空首章（§9.4 既有技术债），目录跳转可达，随未来 syn 版本升级一并修复。**；**v27** M6-2 PDF 基础文本导入（范围裁定：纯文本先行——PDF.js 提纯文本进合成 EPUB 管线；扫描版 OCR（页级 tesseract.js/MinerU 伴生）另批或可选池；版面保真渲染（R4 PdfAdapter 按页虚拟渲染/Range 流式）为后续独立批次，本批不预设 PDF 进内核原样渲染）：① 新增依赖 `pdfjs-dist` 6.3（legacy 构建主进程动态 import，CommonJS `await import()` 启动零开销；不碰 foliate vendor 快照；**cMapUrl/standardFontDataUrl 须以正斜杠结尾**否则 factory 校验报错；cmaps 目录为 CJK CID 字体必需）；② `electron/importers.js` 增 `pdfToMarkdown`：逐页 getTextContent → `itemsToLines`（hasEOL+y 双信号成行；行内 CJK 直接粘连/ASCII 按间隙补空格）→ `linesToMarkdown`（**段落切分行距用行距差 25 分位**估计正行距——中位数会被标题大间距抬高致全文粘连；缩进启发式：下行左缘缩进 > 0.9×中位字高且上行贴左缘即分段）→ 章节化三优先级（**书签大纲** getOutline+getPageIndex level1→`# `/level2→`## `，named dest 先解析、单条失败跳过；无大纲→`headingCandidates` 字号启发式（≥1.35×**全书行高下中位数**且 ≤60 字符，同字号天然不误判、偶数取下中位防上中位污染，≥2 条才启用）；再无→页数>8 每 10 页分块 `# 第 X–Y 页`）→ **跨页段落愈合**（上页末段无终止标点则移出与下页首段合并，CJK 粘连/ASCII 补空格）→ 全页无文本层（扫描版）throw 明确提示、部分空页返回 emptyPages；③ db 复用 createImportedDoc（source_type=pdf + pdf-original 资产）；IPC `library:pickPdf/createFromPdf`（返回 pages/emptyPages/chapters/outlineUsed）；AddBookModal「导入 PDF」按钮 + 空页提示；④ 测试 `tests/m6-2.test.cjs` 22 断言（手工构造无压缩 PDF 夹具走真实 pdfjs——**PDF 内容流不支持 CJK 字面量**，夹具限 ASCII、CJK 正确性由纯函数层覆盖）+ `tests/m6-2.gui.mjs` CDP 端到端 15 断言（含扫描版拒绝与重启不丢）；M6-1 回归 43/43。**；**v27→v28 修订说明**：用户实测 v27 提纯文本方案版面丢失不可接受，M6-2 改道原生阅读——pdf.js viewer 直读原文件 + 页码锚点（此前从未集成过 pdf.js 阅读器；渲染方案经实测调研：MuPDF AGPL 冲突商用路线、PDFium 绑定无文本层、Electron 内置查看器零 API、商业 SDK 不适合）；存量 PDF 书不迁移（用户手动删除）；提纯函数保留为全文检索备用。**；**v28** M6-2 修订完成（PDF 原生阅读落地：pdf.js viewer 直读 + 页码锚点；ES2025 兼容层随 Electron 升级删除；测试 pdf.kernel 14 + m6-2native.gui 20 全绿；回归 M6-1 43/M6-2 提纯 22/L1 44/L2 20 全绿）。**。**；**v29** 体验修复批（用户实测四项）：①Markdown 导入噪音清理（微信网页存档类 .md 的 style 块/data-URI 图标，markdownFromText 清洗，粘贴路径不碰）；②PDF 缩放（ReaderAppearance.zoom，adapter 映射 currentScaleValue/currentScale，open 默认 page-width，控制条 PDF 专用缩放 Dropdown）；③选区菜单一击消失（document mousedown 外点监听——原关闭只挂 surface pointerup，首点落在未跟踪元素时菜单残留）；④**D26 AI 图片制卡内容感知升级**（选区即画布+周边文字上下文随图提交上1段下2段、card-occlusion v2 播种——regions 每卡自带+cardType 增 qa+内容感知多形式出卡、preset 分支映射重写（每卡自带 rects、多挖空 ord=cardOrd 全 accent、qa 空 rects 挂图、回退单卡）、L11 放宽有 asset 即有效、CardFace 图文卡面、确认面板按 draft.cardType 逐张分流、foliate imageClick DOM 提取上下文/PDF 降级同页文本）。**。；**v30b** 复习卡面修复批（用户 2026-09-13 两项拍板，**D27/D28**）：①**D27 一卡多挖空两形态**——同答（together 缺省：正面全部挖空、背面按文本顺序①②列出全部答案）与分答（per-blank：模型单份草稿，expandClozeDraft 自动拆每空一张独立卡、clozeOrds=[自己的 ord]、各遮一处另一空原文显示、独立 FSRS 调度）；渲染端 clozeOrds 空=遮全部 ord（存量 5 张多空卡自动转同答，修复正面漏答案+背面只给一个答案）；parseCloze.render 接受 ord 数组 + renderDetail 文本顺序被遮序 + extractClozeAnswers；commitQuestion 按文本顺序逐个还原[…]（旧实现只还原第一个）；提示词播种 v4（R13 两形态+schema clozeMode+枚举同答注记；card-literature 随 card-seq 同步）；②**D28 看图问答卡卡面定版**——题面正反面都渲染（翻面后不再消失）且皆可编辑（同步 noteText）；③m1.test 补 M1-9 两形态 12 断言 + 修正 v29 遗留的 L11 旧断言（rects=[] 有 asset 合法）；隔离实例 CDP 冒烟三卡面（同答全遮背列①②/分答遮一显一/看图问答背面题面）实测通过；回归 m1 57/m5 34/m2 33/m4 40/m6-1 49/m6-2 22/persist 14/undo 29 全绿。**。；**v30b 同日追加（用户实测两项）**：④多空图片卡遮挡块颜色统一为考察区 accent——D26 每卡自带 rects 的 accent 判断曾错用批次卡序 cardOrd（一绿多黑/全黑，隔离实例实测确认）；渲染端改为**默认全部遮挡块 accent**（每卡区域都是本卡考察区），旧 v1 共享区域链路显式标记 `occlusion_json.regionScope:"shared"` 才保留「cardOrd 单区高亮、其余 ink」的 v16-c 语义；regionScope 经 acceptOcclusionDraft 透传落库。**。；⑤**D29 归属锚落地（用户 2026-09-13 研究后安排重制卡检验）**：R19 扩充（论证/理论/学说/观点一律归属+拆卡+易混 warnings）并适配 card-occlusion（模板升 v3，遮挡卡走 contextPrefix、看图问答卡进题面）；提示词播种 v5（v4 已于同日早前播种，故归属条款独立成版）；存量高尔吉亚 4 张卡由用户自行删除重制检验；⑥易混对比卡机制口径定版（提醒=R10 warnings 语义提醒+S1 本地相似，生产=用户主导 card-contrast 模式，不做全自动）；⑦对比卡一键动作落地（用户拍板采纳候选增强）：复习工具行「对比卡」按钮 + Leech 向导「生成对比卡」按钮 → 新组件 ContrastCardModal 确认框（进度/无 Key 错误重试/逐张入库或放弃）；cards.ts 新增 generateContrastDrafts（buildContrastCandidates 候选清单**只排除基准卡、挂起卡保留**（用户复审指正：暂停常是疑似重复之后处理）+ 同主领域卡优先排序 + 文本去重 + 图片卡用 back + cap 500；generateCards context 增 existingCardsLimit 放开 10 张截断；focus 指令选最易混一张为 B、允许空卡不硬凑）与 createAcceptedCard（建卡逻辑自 Reader.acceptDraft 抽取共用：per-blank 展开+lint+S1）；R19 补归属卡前缀豁免（归属卡 front/前缀禁现人名，防泄题）；m1 补 M1-10 候选清单 8 断言（65/65）；隔离实例冒烟按钮/确认框/无 Key 错误路径实测通过。**；**v31** M1 提示词基线确认并回与 CardLint 补齐（用户 2026-09-13 拍板）：① **v4 候选正式并回**——测试台 G1–G9 候选文本此前实际已在 `electron/prompts.js`，但文档与播种记录未同步，且 `card-literature` 有 `CARD_LITERATURE_PROMPT` 写了却无人引用的**死代码**（db 播种该 scope 时用的是 `CARD_SEQ_PROMPT`）。本批把提示词目标版本**统一升到 v6**（v5 已被 v30a/v30b 两批占用，存量库必须有更高版本号才会补播）并让 `card-literature` 播种专用文学模板，存量 v1/v5 序列占位行保留留痕；② **取消 G9「退出红线」**（值得记就做、可以少做但不做空——保留「单一孤立事实至少 2 张」下限，删除「提不出 3-5 个好问题一张也别产」）；③ **G6/G7 完善并与本地 lint 对齐**——R19 归属措辞要求可字面识别（归属动词+人名）、R2/R5 合格线要求可字面判定措辞（对齐 L16）；**R18 数字克制同日修订为无数值门槛的软引导**；④ **CardLint 落地 L16 宽容度标注**——**L-A 数字密度**曾实现为 L15，同日经用户反馈「≥2 个数字即不合格」对十位数等常见情况过严而**删除**（R18 同步去门槛）；**L-B 观点归属不做**（争议性属语义判断本地误报高，改由 R19 提示词自律）；⑤ `prompt-lab` 候选稿转为「基线直引」（DRAFT_TAG=v31-baseline，去 G9；`main.js` 的 card-literature 基线同步改用专用模板）；⑥ 测试：`tests/m1.test.cjs` 65→**78** 断言（M1-11 L16 + 「L15 已删除」、M1-12 提示词基线与 db 播种防回归）+ 新增 `tests/m1.prompts.test.cjs`（14 断言，隔离 userData 走真实 db：全新库播种 v6 专用模板 / 存量库 v5→v6 补播路径 / 幂等 / 内容抽查）；回归 m1 78、m5 34、m4 40、m6-1 49、m6-2 22、m6-3 24、backup 33、persist 14、undo 29、db 23 全绿；tsc 0 错误；dist 重建；⑦ **文档滞后收敛**——§9.2 R4 由 ❌ 改为「主体由 M6 交付」（仅剩 Range 流式与扫描版 OCR 留 §9.4）、两个 v30 拆为 **v30a**（M6-3 导入收口）/ **v30b**（复习卡面修复批）、**D27 重复编号拆分**（「导入入口统一」改 **D30**，「一卡多挖空两形态」保留 D27）、§6.2 标题改 v31 状态、§9.1 M6-1 断言 43→49、§7.4 补 v31 播种记录。**。**v33** 结构连接 Structure Connection（**D32**，纯文档零代码，用户 2026-09-14 构想）：① **新增 §4.14 结构连接**——i+1 的「i」除已掌握知识点与前置外还包含「已有知识中的相关结构」；推荐/洞察分「前置驱动」与「结构驱动」两类入口，结构驱动允许在**前置缺口存在**时进入用户未接触过的领域（放宽候选生成与 connectivity 口径、**不豁免**进入后的必要前置，进入后学习路径仍由常规 Frontier 接管）；连接手法封闭枚举 `analogy / abstraction / combination`，**三种都必须产出槽位映射 `mapping`**（即「类比、映射、组合、抽象」＝三类手法 + 一项强制输出）；明确**初步认知模型**生命周期 `proposed → accepted(tentative) → refining → converged / replaced / abandoned` 与「结构切入 → 吸收略高于当前理解水平的新信息 → 修正模型」循环（旧模型留痕）；推荐必须说明**推荐理由 + 结构相似之处 + 至少一条主要差异（disanalogy）+ 可证伪追问**；三道闸门（结构确实已持有 / 材料可读性达标 / 用户信号）+ 护栏（仅探索性建议、须用户确认、**禁自动下载/入队/制卡**、只读 FSRS）；**v1 落库最小化**（不新增结构实体表：已持有结构＝本地检索出的 KP + 关系子图，跨域对应落 `analogous_to` + `structureLabel` + `mappingJson`，结构假设落 `knowledge_proposals` / `insight_runs`；`knowledge_structures` 一等表留待实现批按复用频次再定）；② **§4.6 关系枚举 8→9**（新增 `analogous_to`（结构类比/跨域同构），不参与 prerequisite 无环约束、不派生 due/优先级）；③ **§4.7 增 item 11**（结构假设不产 mastery 证据，判定只用真实学习证据，不得用「用户当时接受了推荐」充当证据）；④ **§4.8 增「两类入口」item 4**（并分拆 `connectivity` 为「前置连接 / 结构连接」）；⑤ **§4.9** 推荐理由增第三类 `structure-driven` + Stage B 增 `structureMapping` + 结构候选来源限制（K6 前只能用已导入未读材料或用户手动提供，禁凭空列举领域书目）；⑥ **§4.10** `analogous_to` 跨域边虚线 + 可切换「结构连接」层；⑦ **§4.11** 结构推荐定向反馈（`接受 / 拒绝（结构不成立｜不感兴趣｜太难）`，「结构不成立」回填降权）；⑧ **§4.13 Insight 三分支 → 四分支**（Knowledge/Self/Frontier/**Structure**，补结构连接输出契约）；⑨ **§6.3.11 独立 scope 5→6**（新增 `structure-analogy`：已持有结构子图 + 候选领域 → 槽位对应 + 相似度 1–5 档 + 判定锚语 + 依据 span，禁编造对应；扩 `frontier-explain` 要求结构类推荐必附映射表与主要差异）；⑩ **§6.3.12 KnowledgeLint 增 K9/K10**（`analogous_to` 缺 mapping/低置信 info；已驳回结构模式再作事实 warn）；⑪ **§4.14 插件节 renumber 为 §4.15**（同步 §4.2 PluginHost、§5.5 皮肤、M11 与导读全部 live 指针）；⑫ **Roadmap 重组（用户拍板）**——**原 §9.6 LKM 实施路线整体移入 §9.1 M8**（M8 改题为「日记与 AI 洞察 + Learner Knowledge Model」，用户：LKM 是软件核心功能之一、属主线），K0–K8 扩为 **K0–K9**（K9＝结构连接，依赖 K1/K4/K5/K7、跨域材料来源受 K6 制约），§9.2 状态表 K 行与 M8 行同步、§9.5 下一步同步、§6.4.1「见 §9.6 E 行」改指 §9.1 M8 实施路线。**。**v34** 同源卡延后 Sibling Burying（**D33**，纯文档：本批先把契约与批次写入，代码按 §9.1 M12 实现）：① **新增 §4.16**——同一制卡来源单元产出的多张卡（翻转对 / D27 分答拆卡 / M7 单词四卡 / D26 同图多卡 / 同一句短材料的多角度卡）在同一学习日**只放行一张、其余延后至次日**；延后是**队列视图**（纯函数 `computeTodayQueue`）而非调度写入：不改 `due`、不写 `fsrs_json`、不产生 `review_logs`、不触发 leech——故 Anki 式 bury 对 `elapsed_days` / 优化器 `delta_t` 的扰动在本软件中不存在；② **§4.2 接口清单 19→20 项**（新增 `SiblingQueueView`：`computeTodayQueue(now?) → {cards, deferred[]}`，独占「今日到期」口径）；③ **§4.1 新增 `cards.sibling_key`**（同源组标识，NULL=不参与延后；明确声明不参与 FSRS 调度）；④ **分组键确定性规则**（结构性同源＝制卡动作单元键、与文本长度无关；短材料同源＝来源锚点键、源文本 ≤ `sourceTextLimit` 默认 300 字符；长选区不建键）——**否决**「内容重复度分析决定延后」备选（本地 n-gram 检不出换措辞同源卡，D29 同局限；AI 判定调度违反 §1.7/§1.9/§1.10），该备选入 §9.4 池；⑤ **§6.3.8** 补复习体验元规则（延后原因展示 + 「同源暂缓 N」+ 统计与队列同口径）；⑥ **Roadmap**：新增主线批次 **M12**（§9.1，位置排在 M8 之前、编号取 M 序列末尾以免打乱既有 M8/K0–K9 引用）、§9.2 状态表新增 M12 行、§9.4 新增「语义重复判定延后」池项、§9.5 下一步同步（M12 → M8）。**v34 实现（同日，§9.1 M12 完成情况为完整依据）**：数据层 `cards.sibling_key` + 全链路透传；建键 `siblingKeyFor` 纯函数 + 全部制卡调用点接入（翻转对 act:flip / 同图 img:assetPath / 单词四卡查词锚点 / 对比动作 act:contrast 不与基准卡同组 / per-blank 拆卡自动继承）；`computeTodayQueue`+`computeSiblingDeferred` 队列视图，`listDueCards` 与 `getStatsOverview` 统一接同一口径（**消除 due≤now vs due≤today24 历史分叉**，`dueToday+siblingDeferred==到期窗口总数` 有断言锁定）；体验：复习页「同源暂缓 N（明日自动解封）」展开区与可读原因、卡片浏览「今日暂缓」页签与状态列标记、设置 `sec-siblingbury`；**实测修正**：同源额度按 review_logs⋈sibling_key 全量统计——已评分兄弟卡 due 移入未来后不在候选集、初版额度未被消耗（m12 单测 M12-2 抓住）；**顺带修复既有缺陷**：main.js `M7_TEST_USERDATA` setPath 晚于 require("./db") 致 db/main 两侧 settings.json 分叉（M12 GUI 实测暴露，setPath 已上移至 require 之前）。测试：m12.test 42 断言（electron 隔离库）+ m12.gui 24 断言（CDP 端到端）+ 重启不丢冒烟；回归 m1 83/m5 34/m7 54/m6-1 49/backup 33/persist 14/undo 29/FSRS L2 db 23 全绿；tsc 0；dist 重建；FSRS 六件套其余层按 Non-Goals 声明未重跑（未触调度字段）。**；**v35** 跳转原文错位修复（用户 2026-09-14 实测：图片问答卡与文字卡跳转均回开头）：① 根因——pageIndex 入库有但复习页/CardBrowser/App 三处 anchor 类型丢弃 + 图片入口主动清锚致裸 documentId + Markdown 回退错进度 + anchorText 空值无守卫；② 修复——pageIndex/chapterIndex/anchorRatio 全链路透传 + 跳转顺序补 chapterIndex 与判空 + Markdown 回退本卡 anchorRatio + 正文图片记图片锚点（imageSource/imageAnchor）+ 图内区域高亮（locateImage+叠加层/PDF 对照浮层）+ 查看原图 lightbox + 资源库选图隐藏跳转 + 无锚点旧卡置灰提示；③ §4.1 context_ref_json 字段声明补齐 + §6.2 锚点体系追记；回归：tsc 0 + dist 重建 + 六组现场手动 E2E（粘贴书/EPUB/PDF 文字卡 + 正文图片遮挡/问答卡 + 资源库选图卡）+ 旧卡置灰 + 跳转不污染进度。**。**v36** M8-A 日记与快速记录（**D34**，用户 2026-09-14 需求「随想随记 + 全局快捷键弹出小 Markdown 编辑器，输入即同步保存到当日日记结尾另起一行」，并追加「给『添加新的学习材料到书架』的窗口也加一个快捷键」）：① **数据层**——新增 `journal_entries`（§4.1：`entry_date` **自然日**口径（不随学习日切点漂移，用户拍板）、`source('app'|'capture')`、`is_draft` 草稿位、`sent_at`）+ 六个仓储函数（含 `{deferPersist}` 开关，供自动保存节流）；② **新增 `electron/journalTime.js`**（自然日纯函数 `journalDateOf`，与 `fsrsTime.js` 同构、可独立测试）；③ **新增 `electron/quickCapture.js`**——捕获窗口单例（`560×380` 无框置顶 `skipTaskbar`、鼠标所在屏居中、`capture:ready` 就绪后 show 防白闪）+ **全局快捷键组**（`Ctrl+Alt+Space` 快速记录 / `Ctrl+Alt+N` 添加学习材料；注册失败在设置页显性提示，不让用户按了没反应）+ **草稿-发送状态机** + **防抖持久化**（尾随 4s / 上限 20s + 隐藏·发送·退出强制 flush；本项目「每次落库即落盘」的唯一例外，理由与代价见 D34）+ 跨日草稿不混稿；④ **捕获窗口渲染层**——`capture.html` + `src/capture.tsx` + `CaptureEditor.tsx`（vite 多入口：`index.html` + `capture.html`），header 当日 meta / 18px 编辑区 / footer 保存状态点 + 发送按钮；⑤ **日记页**——顶栏导航第 5 项「日记」+ `src/components/JournalView.tsx`（日期倒序·日组内正序、今天组末为输入行/草稿行＝「追加到当日结尾」的字面实现、hover 操作、搜索、回到今天、加载更早）+ `src/lib/journal.ts`（类型化客户端 + 主进程推送桥接为 EventBus `journal/changed`）；⑥ **App 级「添加书籍」模态**——`addOpen` 从 Bookshelf 上提到 App（快捷键呼出**不切换视图**，阅读位置与复习会话原地保留），书架两处入口复用同一模态；⑦ **单实例**——`app.requestSingleInstanceLock`（全局快捷键必须唯一宿主，第二次启动聚焦已有窗口）；⑧ **设置页 `sec-global`「全局快捷键」**——两键捕获/开关/失焦隐藏/随系统启动（`app.setLoginItemSettings`，默认关）+ 占用状态提示，键位校验复用 `commandRegistry.conflictWith` 并同时排除与另一全局键重复；⑨ 测试：`tests/m8.test.cjs` + `tests/m8.gui.mjs`（覆盖 CRUD/自然日边界/草稿协议/节流落盘一次/flush 后重启读回/快捷键配置归一化/捕获窗口端到端/添加模态不切视图/重启不丢），改 db journal 段后须全绿。**。**v37（补记）** 分页塌缩与导航假死修复（2026-09-15，代码已实现补记入档）：① 分页每页过少＝阅读器 margin 配置无单位 → paginator CSS 变量 `--_margin` 非法 → `grid-template-rows` 整条失效页面塌缩自锁，改为带 px；② 跳 Cover 后翻页/目录/滚轮全废＝paginator `#turnPage` 无 try/finally + `setSelectionTo` 死节点必抛 + 并发导航杀在途 iframe 加载致 View.load 永不 settle + 加载失败清空 #index，四处全修；新增永久回归 `tests/reader.paging.gui.mjs` 9/9；CDP exceptionDetails 在 `r.result` 下（老脚本全写错顶层）。**。**v38** 词典查词语言路由修复与日→中词典目录（**D35**，用户 2026-09-15 实测：日语文本选「山」被识别为中文、显示拼音、走 CC-CEDICT）：① **dict.ts 纯函数层**——`guessLanguage(word, sentence?)` 词内假名/日文记号（々〆）优先、句中假名次之；新增 `resolveLookupLanguage`（D35 五级链：手动切换 > 词内信号 > 句中假名 > 书籍语言 > 正则兜底）与 `pickLocalHit(hits, lang)`（sourceLanguage 精确匹配 > 空=未知语言 > 原序）；`DictLookupContext` 增 sentence/bookLanguage，Manager 解析后以统一 languageHint 下发（在线缓存键一致）；② **主进程**——`dict_sources` 增 `lang` 列（ALTER 迁移 + 存量按 format 回填 jmdict-xml→ja/cedict→zh/ecdict-*→en/stardict·dsl 留空），`indexDictSource` 按 format 写 lang，`dict:lookupLocal` 逐条附 `sourceLanguage`；③ **dictClient.ts**——`localProvider` 用 `pickLocalHit` 取命中（不再盲取 hits[0]），`lookupWord(raw, opts)` 携 sentence/bookLanguage/manualHint；④ **书籍语言属性**——`library_items.lang`（空=未知）+ 添加书籍模态语言下拉 + 书架卡片设置语言入口 + Reader 以当前书 lang 作 bookLanguage；⑤ **DictPanel 语言切换 chips**（自动/英/日/中/韩），点击重查、新选词重置自动；⑥ **下载目录新增两部日→中**（调研结论：JMdict 官方无中文版）——jamdict-cn（142MB zip sqlite，JMdict 约 19.1 万词条中文释义 AI 翻译、标注可能有误、EDRDG CC-BY-SA 署名）+ kaikki-zh-ja（216MB raw-wiktextract-data.jsonl.gz 按 lang_code==ja 过滤，中文维基词典人工编纂，CC-BY-SA+GFDL；官方简繁分卷已标记将下架故用原始包）；**dictStore.js 新解析器** iterJamdictSqlite（sqlite_master 探测 schema）与 parseKaikkiJsonl（zlib 流式逐行），main.js 导入路由扩展（.db/.zip 先探 jamdict 再落 ECDICT；.gz 小样嗅探 JSONL→kaikki / <JMdict>→jmdict / 否则 ecdict csv）；版权词典（新明解/明镜/MOJi/新世纪日汉等 OCR 产物）排除（§7.1.2）；⑦ 测试：m7.test.cjs 增语言判定矩阵/pickLocalHit/目录分类/解析器夹具断言，esbuild 重打包 tmp-m7，m7.gui.mjs 目录行数与语言切换冒烟。；**v39** 成长反馈 Growth Feedback 定契约（D36 + §4.17 + 产品规格 §6.6 + 批次 §9.1 M13）：**呈现层只读**（不写 FSRS 字段与 `review_logs`、不写 LKM 表、不进调度/训练/推荐排序、不作 `utility`/`challengeFit` 输入；读侧只在 COMMIT+persist+IPC 成功之后）；**四层口径** Activity/Growth/Capability/Territory（活动量不得冒充成长、Capability 必须可点击到证据链、不设万能总分、streak 归 Activity 层 + 措辞纪律）；**成长事件封闭枚举**（记忆层 `material`/`group`/`leech-recovery`/`relearning-recovery`/`retention-180`；知识层 `transfer-first`/`application-first`/`kp-strong`/`kp-functional`/`structure-link`/`domain-entry`）；**正反馈分级总表**（§6.6.1 唯一事实来源：越能体现能力提升越靠前，单次评分多条只取最高级，取消"单卡学习步毕业"与"单卡 21 天巩固"两项以免稀释获得感；措辞分层，禁「掌握 +1」）；**首次语义**（`(事件, 实体, 维度)` 只报一次、`review_seq` 全序重算不落表、撤销静默回退、防回灌）；**排期**（用户 2026-09-15）：整批排在 M8-B 与 K0–K9 之后，内部 GF-1 记忆层 → GF-2 知识层；本批纯文档、零代码。**。**v40** M8-B + K 系列整体架构定契约（**D37**，用户 2026-09-15 四项拍板，本批纯文档）：① **K1 先行**——知识地基四表提到 M8-B 之前，M8-B 直接消费真实 KP/子图、不做临时适配器；M8 内部顺序改为 M8-A ✅ → K1 → M8-B → K2–K9；② **架构先行两步走**——本批纯文档冻结契约，实现分 K1 与 M8-B 两批；③ **Personal Meaning 独立候选表**（`personal_meaning_candidates`，含确认状态机）；④ **完整 K1**（四表 + 归一合并可回滚 + 生命周期 + 环检测 + 旧字段不删列）。文档增补：§4.1 新增六表 schema（`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals / insight_runs / personal_meaning_candidates`）；§4.2 接口清单 22→24 项（新增 `KnowledgeBase` / `InsightEngine`）；§4.6 增 K1 落地细化（环检测先行 / `analogous_to` 只建表 / 旧字段迁移策略 / 归一器复用 n-gram / 管理面最小化）；§4.13-5 增 **Evidence Package 结构冻结**（diarySpans/kpSubgraph/cards/extracts/sources/tokenBudget/groundingOrder，`InsightEngine.buildEvidencePackage` 独占装配、超限按 grounding 从后往前裁剪）；§9.1 M8 增 K1 实现规格与排期重排、§9.2/§9.5 同步。**。v40 实现（同日，K1 与 M8-B 两批依次落地，完成情况全文见 §9.1 K1 / M8-B 节）：**K1**——四表 + 索引、`prerequisite` BFS 环检测（拒绝返回环路径）、merge 可回滚（mergeLog 精确还原 alias）、`resolveKpFamily` 族展开（合并不重写边）、`buildKnowledgeMigrationSuggestions` 幂等回填提案、IPC `knowledge:*` 15 通道、`KnowledgeManager.tsx`（CardBrowser「知识点」页签）+ 行详情「知识点」meta、`src/lib/knowledge.ts`；测试 k1.test **40** + k1.gui **15**。**M8-B**——`insight_runs` + `personal_meaning_candidates` 两表、`buildEvidencePackage`（草稿排除/子图一跳/legacy 与卡面双路命中/token 裁剪日记恒保留）、IPC `insights:*`/`meaning:*` + EventBus 增 `insight/changed`、`InsightPanel.tsx` 四步流（范围→预览→流式→输出渲染与反馈）+ JournalView「洞察」按钮、`journal-insight` v1 播种 + prompt-lab 基线直引（`structure-analogy` 播种随 K2，偏差已记录）；测试 m8b.test **35** + m8b.gui **13**。回归：m1 83 / m1.prompts 14 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0 错误；dist 重建；两批均不触 FSRS 调度字段（§7.3 声明）。**。****。**v40** M8-B + K 系列整体架构定契约（**D37**，用户 2026-09-15 四项拍板，本批纯文档）：① **K1 先行**——知识地基四表提到 M8-B 之前，M8-B 直接消费真实 KP/子图、不做临时适配器；M8 内部顺序改为 M8-A ✅ → K1 → M8-B → K2–K9；② **架构先行两步走**——本批纯文档冻结契约，实现分 K1 与 M8-B 两批；③ **Personal Meaning 独立候选表**（`personal_meaning_candidates`，含确认状态机）；④ **完整 K1**（四表 + 归一合并可回滚 + 生命周期 + 环检测 + 旧字段不删列）。文档增补：§4.1 新增六表 schema（`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals / insight_runs / personal_meaning_candidates`）；§4.2 接口清单 22→24 项（新增 `KnowledgeBase` / `InsightEngine`）；§4.6 增 K1 落地细化（环检测先行 / `analogous_to` 只建表 / 旧字段迁移策略 / 归一器复用 n-gram / 管理面最小化）；§4.13-5 增 **Evidence Package 结构冻结**（diarySpans/kpSubgraph/cards/extracts/sources/tokenBudget/groundingOrder，`InsightEngine.buildEvidencePackage` 独占装配、超限按 grounding 从后往前裁剪）；§9.1 M8 增 K1 实现规格与排期重排、§9.2/§9.5 同步。**。v40 实现（同日，K1 与 M8-B 两批依次落地，完成情况全文见 §9.1 K1 / M8-B 节）：**K1**——四表 + 索引、`prerequisite` BFS 环检测（拒绝返回环路径）、merge 可回滚（mergeLog 精确还原 alias）、`resolveKpFamily` 族展开（合并不重写边）、`buildKnowledgeMigrationSuggestions` 幂等回填提案、IPC `knowledge:*` 15 通道、`KnowledgeManager.tsx`（CardBrowser「知识点」页签）+ 行详情「知识点」meta、`src/lib/knowledge.ts`；测试 k1.test **40** + k1.gui **15**。**M8-B**——`insight_runs` + `personal_meaning_candidates` 两表、`buildEvidencePackage`（草稿排除/子图一跳/legacy 与卡面双路命中/token 裁剪日记恒保留）、IPC `insights:*`/`meaning:*` + EventBus 增 `insight/changed`、`InsightPanel.tsx` 四步流（范围→预览→流式→输出渲染与反馈）+ JournalView「洞察」按钮、`journal-insight` v1 播种 + prompt-lab 基线直引（`structure-analogy` 播种随 K2，偏差已记录）；测试 m8b.test **35** + m8b.gui **13**。回归：m1 83 / m1.prompts 14 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0 错误；dist 重建；两批均不触 FSRS 调度字段（§7.3 声明）。**。****v36** M8-A 日记与快速记录（**D34**，用户 2026-09-14 需求「随想随记 + 全局快捷键弹出小 Markdown 编辑器，输入即同步保存到当日日记结尾另起一行」，并追加「给『添加新的学习材料到书架』的窗口也加一个快捷键」）：① **数据层**——新增 `journal_entries`（§4.1：`entry_date` **自然日**口径（不随学习日切点漂移，用户拍板）、`source('app'|'capture')`、`is_draft` 草稿位、`sent_at`）+ 六个仓储函数（含 `{deferPersist}` 开关，供自动保存节流）；② **新增 `electron/journalTime.js`**（自然日纯函数 `journalDateOf`，与 `fsrsTime.js` 同构、可独立测试）；③ **新增 `electron/quickCapture.js`**——捕获窗口单例（`560×380` 无框置顶 `skipTaskbar`、鼠标所在屏居中、`capture:ready` 就绪后 show 防白闪）+ **全局快捷键组**（`Ctrl+Alt+Space` 快速记录 / `Ctrl+Alt+N` 添加学习材料；注册失败在设置页显性提示，不让用户按了没反应）+ **草稿-发送状态机** + **防抖持久化**（尾随 4s / 上限 20s + 隐藏·发送·退出强制 flush；本项目「每次落库即落盘」的唯一例外，理由与代价见 D34）+ 跨日草稿不混稿；④ **捕获窗口渲染层**——`capture.html` + `src/capture.tsx` + `CaptureEditor.tsx`（vite 多入口：`index.html` + `capture.html`），header 当日 meta / 18px 编辑区 / footer 保存状态点 + 发送按钮；⑤ **日记页**——顶栏导航第 5 项「日记」+ `src/components/JournalView.tsx`（日期倒序·日组内正序、今天组末为输入行/草稿行＝「追加到当日结尾」的字面实现、hover 操作、搜索、回到今天、加载更早）+ `src/lib/journal.ts`（类型化客户端 + 主进程推送桥接为 EventBus `journal/changed`）；⑥ **App 级「添加书籍」模态**——`addOpen` 从 Bookshelf 上提到 App（快捷键呼出**不切换视图**，阅读位置与复习会话原地保留），书架两处入口复用同一模态；⑦ **单实例**——`app.requestSingleInstanceLock`（全局快捷键必须唯一宿主，第二次启动聚焦已有窗口）；⑧ **设置页 `sec-global`「全局快捷键」**——两键捕获/开关/失焦隐藏/随系统启动（`app.setLoginItemSettings`，默认关）+ 占用状态提示，键位校验复用 `commandRegistry.conflictWith` 并同时排除与另一全局键重复；⑨ 测试：`tests/m8.test.cjs` + `tests/m8.gui.mjs`（覆盖 CRUD/自然日边界/草稿协议/节流落盘一次/flush 后重启读回/快捷键配置归一化/捕获窗口端到端/添加模态不切视图/重启不丢），改 db journal 段后须全绿。**。**；**v30a** M6-3 导入格式扩展收口（**HTML 文件导入**：新增 src/lib/htmlImport.ts（DOMParser + @mozilla/readability 正文提取 + DOMPurify 清洗 + turndown→markdown，Readability 失败回退整页管线）→ createImportedDoc(source_type=html) → synth 分支；**MOBI/AZW3/FB2/CBZ 被动兼容启用**（v26 调研称零投入，本批补齐入口）：library:pickEbook + db.createFromBookFile(source_type=ebook, kind=book-original, path=original.<ext>) + readEbookFile 返回 {bytes,name} + App ebook 分支 + adapter 按扩展名映射 File MIME（foliate makeBook 按魔数分发 ZIP/MOBI、CBZ/FB2 判定依赖扩展名，文件名必须保真）；**D30** 导入入口统一为单按钮 + 多选批量（按扩展名自动路由、聚合成功/失败报告、单失败不中断；分格式按钮下线，pick IPC 保留）；tests/m6-3.test.cjs（jsdom devDependency 驱动的 HTML 转换断言 + CBZ/FB2 夹具导入 + 路由表断言）。**M6 批次（M6-1/M6-2/M6-3）全部收口**）。**。；**v30** 复习卡面修复批（用户 2026-09-13 两项拍板，**D27/D28**）：①**D27 一卡多挖空两形态**——同答（together 缺省：正面全部挖空、背面按文本顺序①②列出全部答案）与分答（per-blank：模型单份草稿，expandClozeDraft 自动拆每空一张独立卡、clozeOrds=[自己的 ord]、各遮一处另一空原文显示、独立 FSRS 调度）；渲染端 clozeOrds 空=遮全部 ord（存量 5 张多空卡自动转同答，修复正面漏答案+背面只给一个答案）；parseCloze.render 接受 ord 数组 + renderDetail 文本顺序被遮序 + extractClozeAnswers；commitQuestion 按文本顺序逐个还原[…]（旧实现只还原第一个）；提示词播种 v4（R13 两形态+schema clozeMode+枚举同答注记；card-literature 随 card-seq 同步）；②**D28 看图问答卡卡面定版**——题面正反面都渲染（翻面后不再消失）且皆可编辑（同步 noteText）；③m1.test 补 M1-9 两形态 12 断言 + 修正 v29 遗留的 L11 旧断言（rects=[] 有 asset 合法）；隔离实例 CDP 冒烟三卡面（同答全遮背列①②/分答遮一显一/看图问答背面题面）实测通过；回归 m1 57/m5 34/m2 33/m4 40/m6-1 49/m6-2 22/persist 14/undo 29 全绿。**。；**v30 同日追加（用户实测两项）**：④多空图片卡遮挡块颜色统一为考察区 accent——D26 每卡自带 rects 的 accent 判断曾错用批次卡序 cardOrd（一绿多黑/全黑，隔离实例实测确认）；渲染端改为**默认全部遮挡块 accent**（每卡区域都是本卡考察区），旧 v1 共享区域链路显式标记 `occlusion_json.regionScope:"shared"` 才保留「cardOrd 单区高亮、其余 ink」的 v16-c 语义；regionScope 经 acceptOcclusionDraft 透传落库。**。；⑤**D29 归属锚落地（用户 2026-09-13 研究后安排重制卡检验）**：R19 扩充（论证/理论/学说/观点一律归属+拆卡+易混 warnings）并适配 card-occlusion（模板升 v3，遮挡卡走 contextPrefix、看图问答卡进题面）；提示词播种 v5（v4 已于同日早前播种，故归属条款独立成版）；存量高尔吉亚 4 张卡由用户自行删除重制检验；⑥易混对比卡机制口径定版（提醒=R10 warnings 语义提醒+S1 本地相似，生产=用户主导 card-contrast 模式，不做全自动）；⑦对比卡一键动作落地（用户拍板采纳候选增强）：复习工具行「对比卡」按钮 + Leech 向导「生成对比卡」按钮 → 新组件 ContrastCardModal 确认框（进度/无 Key 错误重试/逐张入库或放弃）；cards.ts 新增 generateContrastDrafts（buildContrastCandidates 候选清单**只排除基准卡、挂起卡保留**（用户复审指正：暂停常是疑似重复之后处理）+ 同主领域卡优先排序 + 文本去重 + 图片卡用 back + cap 500；generateCards context 增 existingCardsLimit 放开 10 张截断；focus 指令选最易混一张为 B、允许空卡不硬凑）与 createAcceptedCard（建卡逻辑自 Reader.acceptDraft 抽取共用：per-blank 展开+lint+S1）；R19 补归属卡前缀豁免（归属卡 front/前缀禁现人名，防泄题）；m1 补 M1-10 候选清单 8 断言（65/65）；隔离实例冒烟按钮/确认框/无 Key 错误路径实测通过。**。


**；**v45** M14-UM1 用户记忆「记忆文件与整理管线」实现（2026-09-17，完成情况全文见 §9.1 M14 UM-1 blockquote；§8.2 增「AI 编排在主进程」偏差行）：`electron/memoryStore.js`（memory/ 文件树真源 + applyOps 不删不改写 + 手写区保护 + index 确定性重生成）+ `electron/memoryTidy.js`（摄入/整理/防抖/补处理编排，AI 经注入 chat 包装 chatStream）+ `memory_runs` 表 + `listJournalEntriesSince` 水位线读取 + `user-memory` v1 播种 + `memory:*` IPC / preload memoryAPI / EventBus `memory/changed` + SettingsPanel `sec-memory` + M2 备份恢复覆盖 memory/；测试 m14.test 58 + m14.gui 18 全绿。**；**v45.1 用户反馈四项修复（同日）**：① 记忆手写区可见化（脚手架在标记间放可见引导文字，存量空手写区自动补）；② 设置导航「统计仪表盘」锚点修复；③ AI 服务卡死修复（socket 不活动超时 120s/30s + 渲染层 withTimeout 兜底）；④ 书架封面竞态修复（协议注册上移）+ 悬停改名（`library:setItemTitle`）。**；**v46** M14-UM2 用户记忆「接地与检索」实现（2026-09-17，M14 全部收口，完成情况全文见 §9.1 M14 UM-2 blockquote；§6.3.3 v7 基线由规格转实现）：R20 原则制 `SITUATION_REQUIRED_SCOPES` 注册表 + `prompt_templates.situation_required` 声明位 + 制卡族 v6→v7 + `electron/memoryRetrieve.js`（封闭映射 + Stage A 宽召回 + memoryRef 子串校验）+ `memory:retrieve` IPC + `cards.memory_ref_json` 溯源 + 确认面板轻标记与二次确认 + CardBrowser 记忆接地筛选 + 注入预算可调；测试 m14 78 / m1 85 / m1.prompts 22 + 全回归绿。**；**v47（已回滚，2026-09-18：真实生成质量不达用户预期；实现快照存 docs/m15-archive/，重做须按用户新设计重定方案）** M15 材料知识导图 + diagram-design 集成（2026-09-17；含 v47.1 质量优先修订——取消单章字数截断/预览步实测 Token，与 v47.2 全屏工作区改版——两项交互/质量决策保留在案，见 §9.1 M15 回滚注记）。**；**v48（实施中）** M15 材料知识导图重设计定契约（纯文档，2026-09-18）：ChatGPT 65-Task 重设计方案 + A–H 补充约束经代码库现状审查后并入（**D41/D42**；§4.19 全节重写、§9.1 M15 批次契约重写为 8 批推进、决策日志补录 D40）；同批修补文档自身缺陷：§9.2 M15 矛盾重复行合并、决策日志去重（D14–D19 / D24 / D25 / D27–D29 / D37 / D38 重复行删除）与错号行修正（旧「D20=参数环境 / D21=学习日」行删除——该二决策编号已分别被 v20 阅读器内核与 v23 重编号占用，规范为 D22/D23）。
**；**v48.5（实施中）** M15 用户实测修复四连（2026-09-18）：批 A 交互（画布点击=pointer capture 吞 click 根因修复/拖动选字 user-select:none/适应窗口行为级验收/默认展开三层/版本删除真删+active 顺延/正文伪节点三重修）；批 B 深挖管线（section v3 expandable/stopReason+expand 队列+预算 partial+评审分片+覆盖统计+费用诚实预估）；批 C 结构制卡（card-structure v1——对作者组织结构出题，管线不变）；批 D 文档与全回归（**D43**；m15r core 50/db 30/engine 47/layout 15/gui 9 全绿+m1 85+m1.prompts 25+全回归绿）。
**；**v48.11（2026-09-19）** M15 作用域修复与可观测性（D44；依据 `docs/m15-v48.10-性能审计.md` 真实运行审计 + `docs/m15-v48.11-重构方案.md`）：`mindmapCore` 新增全文一维坐标系（UTF-16 码元）与区间代数 / sourceSpans 推导 / 只切不删切分（+107 行）；`mindmapEngine` 深挖改为「只读自身 span」+ 残余补漏 + run 级预算 + 输出降级 + 调用日志 + 首层阶段化（section_ready）+ 并发批次（默认 1）+ 失败隔离；`ai.js` finish_reason/include_usage/abort 归因/429 重试；`db.js` material_map_calls 表 + 僵尸对账；UI 诚实状态（partial 不再显示为失败、深挖中可见首层图、preview 三口径）；`scripts/mindmap-profile.cjs` 只读性能采样器。测试 m15r core 74/engine 80/db 30/layout 15/gui 17 全绿 + tsc 0 + dist 重建。
**；**v48.15（2026-09-22，UI优化 分支，D51）** 书架页重设计（**文档先行**：§5.3 网格算法与吸顶工具条、§5.4 图注卡 / 文件夹卡 / 三区落点 / 持久化 / 退出路径 / 空态、§6.2 书架行改写、§4.2-3 记 `app.shelfOrder`·`app.shelfFolders`；`docs/swiss-international-style.md` 两处空状态规则补"主行动已在吸顶工具条常驻时不重复"）：① 网格 `repeat(auto-fill, minmax(min(100%, var(--shelf-min)), 1fr))` 消除右侧留白（余量被列等分吸收，定宽 + `justify-content` 一律禁止）；② 吸顶工具条收纳 视图（封面墙/目录表）· 密度三档 · 排序四档 · 添加材料主按钮，容器查询单调退让阶梯；③ 书卡改「封面 + 2px 进度轨 + 排印图注」，操作收进 40px ink 动作条，卡面原生 `<select>` 换共享 `Dropdown`；④ **手动顺序拖拽**（三区落点：两侧重排 / 中央归组）+ `Alt+方向键` 键盘等价；⑤ **文件夹**（拖到书上成组 + 就地命名 + 标签页与书脊合集面 + hover 成员名册 + 三条退出路径 + 只有解散没有删除 + 一层为限），顺序与归组存 `SettingsStore` app 层（零 schema 变更，备份已含 settings.json），不改任何数据归属；⑥ 空态去掉重复主按钮。设计依据与逐宽实测：`design-samples/bookshelf-redesign.html`。测试 `tests/shelf.gui.mjs`（含"右侧富余 = 0"几何断言）。
**；**v48.12-P0（测量面，实施中，2026-09-19）** 依 `docs/m15-v48.12-expand调度与性能方案.md`（rev.3）先补测量、不动生成逻辑：`ai.js` 打点 TTFT/首字节并上行；`material_map_calls` 增 5 列（ttft/first_byte/depth/parent_node_id/span_chars）；深挖调用记录 depth 与父节点；**修复 section 调用 `span` 形状**（此前 `span_hash` 恒为 `sha256("[]")`）与 **retries 恒 0** 的计数缺口；**跨阶段合并**（首层 `stopAfterSection` + 续跑两段各自 generate → 账本/用量/预算以 `prevLedger` 为基数累计，`callsDone` 对齐合并账本的 successfulCalls）；**节点 `sourceSpans`/`spanOrigin` 与结构 `coverageSummary` 落库**（离线审计不再反推）；review 计入 byKind；`mindmap-profile.cjs` 增第 ⑦ 段（覆盖三口径/零产出率/同 span 碰撞/结构质量/单位成本/TTFT）。**并修掉一个真 bug**：`core.deriveSourceSpans` 原「先扩边后钳制」会把父范围外的 evidence 伪造成父的整段归属（子节点可"拥有"整篇材料）——改为先裁剪后扩边、且扩边限定在宿主父区间内（§3.1b 守护用例逼出）。测试 core 79（+5 区间纪律）/ engine 93（+13 P0 断言）/ db 30 / layout 15 / gui 17 全绿 + tsc 0 + dist 重建。
**；**v48.12-P1–P4（2026-09-19，同批实施）** ① **覆盖审计**（`runCoverageAudit`）：**只审计有子节点的内部节点 + root**（叶的 span 即其内容，不审计——否则每个叶多发一次调用）；root 审计面 = `coverageUniverse − ⋃ownedSpans(一级)`；残余三分类（transition / 可行动 structural / 低于阈值碎片 ≤150 字只记账不强制 partial）；补漏带**输入产出不变检测**（`gapFillStalled`）；`completeness` 新增 `partial:coverage_gap`（不伪装 complete）。② **兄弟 span 细分**（`subdivideOverlappingSiblings`，重叠 >60% → 按各自 evidence 重推，只收窄不删节点）+ **高置信原子启发式**（`mindmapAtomicHeuristic`，默认**关**：极短∧单句∧无列举∧证据≤2 四条同时成立才跳过）。③ **批量深挖**（架构 B，`mindmapExpandBatch` 默认 1=关闭）：**碰撞组合批优先**（同 span 兄弟必须合批、绝不静默丢弃）+ 顺序打包 + **逐块可恢复解析**（括号平衡救援）+ **缺失成员逐块回退**（不回退整批；回退过的成员不再参与合批）。④ **有界递归**（架构 C，`mindmapExpandDepth` 默认 1）：嵌套子树递归落地并逐层钳制 + 带子节点不再入队。UI 同批诚实化（`coverage_audit` 广播、部分完成文案、预览「当前策略」行）。测试 core 79 / engine 118（+15）/ db 30 / layout 15 / gui 17 全绿 + tsc 0 + dist 重建；**batch 档位、递归深度、原子启发式开关仍待真实 Key 跑 E1–E7 后定档**。**；**v48.13（2026-09-20，M15 P1 正确性修复 + P2 后台可见性，D45）** ① 评审闸门：`severity==="high"` 成为唯一硬闸门（`type` 降为描述标签），模型 `status=fail`+issue 单向棘轮仍阻断，非阻断意见落 `metrics.reviewStatus/reviewIssues`（此前通过路径直接丢弃）；② 发布模型 Published/Candidate：`publishNow = section_ready ? !publishedElsewhere : !partial`——首层候选不再顶掉已发布版本，续跑完成才事务性发布；③ 广播契约自足（`documentId`/`title` 全量补齐 + 终态失败/待确认也广播）；④ 新增全局后台活动指示器（`src/lib/activity.ts` 纯状态机 + `src/components/BackgroundActivity.tsx` + theme.css，右下角收起态 22px（**v48.14 起提到 24px**，理由见 §4.19 ⑥）、hover/focus 展开、完成态点击打开导图、取消只能显式点击）；⑤ Reader 增 `openMindmapInitially` 入口、App 增 `openMaterialMap`（按 documentId 找回材料并在阅读器中打开导图）。测试 engine 143 / core 79 / db 30 / layout 15 / activity 21 / gui 18 全绿 + tsc 0 + dist 重建。**；**v48.13 P4（2026-09-20，D46，用户拍板「改成增量评审」后实施）** 展开与深化分家（展开＝纯 UI 零请求；深化＝按需生成）+ 增量深化（以已存地图为基底的作用域受限 generate：不重建/不跑 merge·global·editorial/不补漏）+ **增量评审**（只评新增分支 + 必要上下文，单分支失败不连坐整图）+ 原地发布（同版本行、发布关系不变）+ UI 三处区分「没画出来」与「没有更深内容」（＋号徽标 / 深化按钮 / 终态说明）；engine 162（+19 E26）/ gui 23（+5）全绿 + tsc 0 + dist 重建；**；**v48.13 P6（2026-09-20，D49）** 空态自救与入口可见性：历史版本区移出 `hasKey`+`phase done` 两重条件（只读操作任何状态可见）+ 空态告知「成果没丢、点一版即可激活」+ 「自动深挖全部」按当前可深化节点数可见 + 版本行版面重排；gui 30（+6）全绿。**；**v48.13 P5（2026-09-20，D48）** 真实运行审计与修复：引擎子事件不得当阶段用（「已取消」误显的真根因）+ 已发布版本不因一次失败而消失 + 同材料串行化守卫 + **首层就绪后不再自动深挖整树**（改为侧栏显式「自动深挖全部」）+ 指示器打开即消失；engine 174 / activity 34 全绿。**；**v48.13 P3（2026-09-20，D47）** 应用重启续跑：启动对账由 failed_timeout 改为 **interrupted**（被打断 ≠ 失败）+ `listResumableMaterialMapRuns()` + `mindmap:pendingRuns` IPC + 启动播种指示器 + 点击携带 resumeRunId 同 runId 续跑（缓存命中零重复计费）；db 37（+7）/ activity 29（+8）/ gui 24（+1）全绿。**v48.13 全部批次（P1–P6.2）收口**：P1 评审闸门 + Published/Candidate · P2 全局后台活动指示器 · P3 重启续跑（interrupted ≠ failed）· P4 展开/深化分家 + 增量深化 + 增量评审 · P5 真实运行审计修复（子事件归一 / 不因失败作废已发布版本 / 串行化守卫 / 首层即成品）· P6–P6.2 空态自救 + 入口可见性 + 版本行版面与禁用条件；测试合计 **engine 174 / core 79 / db 37 / layout 15 / activity 34 / gui 33 = 372 条全绿** + tsc 0 + dist 重建；**现行契约汇总见 §4.19 v48.13 收口块**。# 第六部分 Roadmap（路线图，v14 主线重排；v17 增补日记批次；v24 增补 LKM 路线；v33 LKM 路线 K0–K9 并入 M8 并增补结构连接；v34 增补同源卡延后批次 M12；v35 跳转原文错位修复；v36 M8 拆批并实现 M8-A 日记与快速记录；v38 词典查词语言路由修复与日→中词典目录；v39 定成长反馈契约（§4.17 + §6.6）并排期 M13 在 K 系列之后；v40 定 K1 先行排期与 M8-B/K1 架构契约（D37），M8 内部顺序 M8-A ✅ → K1 → M8-B → K2–K9；v42 定用户记忆契约（D39 + §4.18 + §6.7）并排期 M14 在 K2-B 之后；v44 探针契约修订（§4.7 blockquote）+ R20 原则化（§4.18-9）+ 新增 M15 材料知识导图（§4.19 + D40）；v45 实现 M14-UM1 用户记忆「记忆文件与整理管线」（§9.1 M14 UM-1 blockquote）；v46 实现 M14-UM2「接地与检索」——M14 全部收口（§9.1 M14 UM-2 blockquote）；v48 M15 重设计定契约（D41/D42，§4.19 v48 重写 + 决策日志去重修补））
**；**v48.12-fix1（2026-09-19，用户实测两 bug）** ① **删除的版本「复活」**——根因不是删除（`deleteMaterialMap` 确为真删）而是**每次生成落两行版本**：阶段化后一次用户生成 = 两次 `generate()`（首层 section_ready + 续跑深挖），两段各自 `saveMaterialMap`（INSERT 新 UUID）→ 历史版本里每次多一条同标题版本，删掉一条后另一条看着像复活（且 shards 缓存保留让重生成内容逐字相同）。修复：新增 `db.updateMaterialMap()` 就地更新 + `finalizeMap` 复用本 run 的 `run.output.mapId`（已被用户删除则照常插新行）；副产品＝版本 id 稳定、卡片溯源链不悬空。② **「就此制卡」发的是章节原文**——`makeCards` 用 `collect.textByUnit` 拼 ≤2400 字原文当材料，而 `card-structure` 提示词要求 `【结构语义包】`（本节点/父链/直接子结构/证据引文）且明写「你拿不到原文全文」；仓库里从未实现该包的构建。修复：新增纯函数 `buildStructureCardPackage(node, structure, 1200)`（超长优先砍摘要/证据条数，**绝不回退塞原文**），`makeCards` 改发语义包。③ 顺带新增预览卡「**强制重算**」开关（`params.force`）——实测复跑时 31 次调用中 26 次命中缓存，前后对比与 E1–E7 benchmark 必须勾选它才测的是算法。测试 engine 125（+7 E22）/ cardpkg 12（新增）/ core 79 / db 30 / layout 15 / gui 17 全绿 + tsc 0 + dist 重建。
> **v14 重排**：按用户 2026-09-08 指定，**M1–M10 为接下来开发的主线**（软件要实现的基本功能，排列顺序即开发优先级；一次只推进一批，§1.4）。原路线图中其余未实现 Phase 一律降级为 §9.4 可选更新池，**AI 不得自行领取**。
>
> **v17 增补**：按用户 2026-09-09 构想，新增主线批次 **M8 日记与 AI 洞察**（学习材料的第二输入通道，D19），原 M8–M10 顺延为 M9–M11，相对顺序不变。
>
> **v17 增补**：按用户 2026-09-09 构想，新增主线批次 **M8 日记与 AI 洞察**（学习材料的第二输入通道，D19），原 M8–M10 顺延为 M9–M11，相对顺序不变。
>
> **v24 增补**：Learner Knowledge Model 架构定稿（**D24**，纯文档不实现），实施路线 **K0–K9** 见 **§9.1 M8 实施路线**（v33 起整体并入 M8；K9＝结构连接为 v33 增补），一次只推进一批，与 M5–M11 主线穿插排期由用户指定。
> 
> **v33 增补**：**结构连接 Structure Connection（D32，§4.14）**——i+1 的「i」除已掌握知识点与前置外，还包含**已有知识中的相关结构**；AI 洞察可据结构相似性（类比/抽象/组合 + 槽位映射）推荐用户未接触过的领域，并必须说明推荐理由与结构相似之处。同时把 §9.6 的 LKM 实施路线整体移入 **M8**（用户：LKM 是软件核心功能之一，属主线），K0–K8 扩为 **K0–K9**。

## 9.1 主线批次

### M1 — AI 制卡体系升级（四卡形式 × 材料类型路由 × 提示词测试台）✅（v15 实现，v16 按用户反馈修订，v31 提示词基线确认并回）

> **v16 修订**：翻转问答卡重设计（D18——拆为两张独立问答卡，废除复习期变形设计）。
> **v31 确认并回**（用户 2026-09-13 拍板，见 §8.3 v31）：① **v4 候选正式并回并播种 v6**——此前 G1-G9 候选文本实际已在 `electron/prompts.js`，但文档与播种记录未同步，且 `card-literature` 存在 CARD_LITERATURE_PROMPT 无人引用的死代码；本批统一目标版本升到 v6（v5 已被 v30a/v30b 两批占用）并为 card-literature 播种专用文学模板，存量 v1/v5 序列占位行留痕。② **取消 G9「退出红线」**（值得记就做、可以少做但不做空，保留「单一孤立事实至少 2 张」下限）。③ **G6/G7 完善**并与 CardLint **L16**（宽容度标注）对齐；**L-A 数字密度**曾实现为 L15、同日经用户反馈「≥2 个数字即不合格」对十位数等过严而**删除**（R18 改为无数值门槛的软引导）；**L-B 观点归属不做**（R19 提示词自律）。
> **v15 完成情况**：① 卡形式扩展 ✅（翻转问答=两张独立卡；图片挖空：assets 入库→GLM 多模态→occlusionJson→确认面板→复习渲染→L11 语义修正）；② 材料类型路由 ✅（detectMaterialType 本地识别 + AI 面板类型展示/手动覆盖，映射表见 §6.3.10 **待用户确认后锁定**）；③ 提示词测试台 ✅（`prompt-lab/` 独立 Electron 应用；v31 起候选稿转为「基线直引」，调优闭环随时可由用户启动）；④ 提示词覆盖核对 ✅（缺口报告 `docs/M1-prompt-coverage-report.md`；G1-G9 已并回主软件，G10/G11 用户已拍板，L-C 落地为 L16（L-A/L-B 不做））。
> 遗留动作：材料类型映射表的最终确认（待用户）；提示词修改一律走「测试台验证 → 播种新版本」。

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
> **v23 加固增补**（经外部评审五轮收敛，§4.4.8-4.4.11 + D20/D21 + §8.3 v23 记录为完整依据）：① 时间语义统一——optimizer delta_t 弃 floor(24h)，canonical 函数（fsrsTime.js 独立实现）与调度器 UTC 日历日语义精确恒等，行为级 oracle（ReviewLog.elapsed_days）+ L6 负测试锁死，学习日切点仅统计（D21）；② 参数环境——fsrs_configs 不可变快照 + 指针（D20），废除 fsrsWeights 双事实源，review_logs 记录参数归属，audit 分段重放；③ 数据完整性——review_logs 增 after/leech_before/config 快照与 review_seq，saveReview/undo 事务化，persist 原子替换（F11），review 成功边界=COMMIT+persist+IPC；④ 缺陷修复 F9（权重应用不热生效）/F10（undo leech 误回退）/F11；⑤ 审计版本戳：**Audited against ts-fsrs 5.4.2 / fsrs-rs-nodejs 0.9.1 / package-lock resolved versions / 审计日期 2026-09-09**；FSRS 依赖升级为独立批次。
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

### M5 — 手动制卡优化 ✅（v25 实现）

**v25 完成情况**：① 卡类型选择框 ✅（问答 / 翻转问答 / 填空题 / **图片挖空**四页签；图片挖空页签在「图片聚焦 → 手动制卡」时预填选区与预览，无选区时给出进入路径提示）；② **UDC 领域标签多选** ✅（`UdcPicker`：受控清单下拉 + chip 展示，≤2 个、首个标「主」对齐 R17，与统计/图表口径一致）；③ **字段对齐 AI 制卡** ✅（手动卡写入 contextPrefix / domain / mnemonic / knowledgePointId / dateStamp（可选「标注日期」→ 当日）/ priority + 既有 contextRef 四层锚点与 sourceRef；`generatedBy="manual"`）；④ **强制过 CardLintEngine + 相似检索** ✅（lint 输入补全 contextPrefix/domain/dateStamp/knowledgePointId/occlusion，S1 相似警告同 AI 路径）。
**同批修复 F12**：填空题手动制卡此前把**未转换的原文**存进 `frontMarkdown`（挖空语法只进了临时变量），复习端 `parseCloze` 找不到挖空 ord → 挖空从不遮蔽、卡片退化为普通问答；现改为把带 `{{cN::}}` 标记的文本写入 `frontMarkdown`（L2 测试 4h 锁定）。
**同批新增（用户需求）**：正文图片点选聚焦 + 三类形状选区 + 选区提交（AI / 手动），见 §6.2 阅读器小节与 D25。
**测试**：`tests/m5.test.cjs`（28 断言：像素↔百分比换算、包围盒、归一化钳制、形状可用性、SVG 图元、存量 rects 降级、L11 shapes 语义、用户选区 AI 链路不变量）+ `tests/reader.kernel.cjs` L0/L1 S16（图片点击语义化）+ `tests/reader.engine.mjs` 4c–4h（点选聚焦 / 模糊退出 / 画选区 / 手动制卡落库 / 填空题挖空标记）。

### M6 — 导入格式扩展（v26 起按最小单元拆批：M6-1 Word/TXT/MD → M6-2 PDF → M6-3 HTML+调研收尾）

支持 Word（.docx）/ TXT / Markdown / PDF（基础文本导入）作为阅读材料；调研其他常见学习材料格式（HTML、MOBI 等）。PDF 的 MinerU 云解析双栏不在主线（可选池）。

> **批次拆分与范围裁定（v26，用户拍板 2026-09-12）**：
> ① **M6-1 = Word（.docx，内嵌图必须保留并展示在阅读材料中）+ TXT / Markdown 导入**（本批）；
> ② **M6-2 = PDF 原生阅读**（v28 修订：pdf.js 直读原文件 + 页码锚点；v27 曾实现提纯文本方案，用户实测版面丢失不可接受，已废弃为全文检索备用工具；扫描版 OCR 仍另批/可选池）；
> ③ **M6-3 = HTML 文件导入 + 格式调研收尾**（浏览器插件剪藏仍留可选池）；
> ④ **Anki 牌组明确不做**（用户拍板：Anki 牌组都是已经制作好的问答卡片，不是阅读材料，不进增量阅读管线）。

> **M6-2 修订完成情况（✅ v28 实现，2026-09-12）**
>
> **背景（用户 2026-09-12 实测结论）**：v27 曾实现"提纯文本 → 合成 EPUB"方案（pdfjs 主进程提纯 → markdown → 同一 foliate 内核），用户实测版面丢失不可接受（双栏/表格/图片/版式全丢）。**此前从未集成过 Firefox/pdf.js 阅读器**——pdfjs-dist 仅用于主进程提纯，foliate 快照的 pdf 模块被剔除（view.js isPDF 分支 throw）。本批改为原生阅读；提纯函数（pdfToMarkdown）与 tests/m6-2.test.cjs 保留为全文检索备用工具。
>
> **渲染方案调研结论（2026-09 实测核实）**：pdf.js（Apache-2.0）是唯一同时满足保真渲染/文本层选词/大纲+搜索/可商用许可的开放方案；MuPDF.js 技术最优但 AGPL-3.0 与闭源商业化路线冲突；PDFium JS 绑定仅原型级（无文本层证据）；Electron 内置 Chromium PDF 查看器零程序化接口（拿不到选词/页码/大纲，只能看不能制卡）；商业 SDK 按量计费或销售议价不适合。**决策：用 pdfjs-dist 自带的 viewer 组件**（web/pdf_viewer.mjs，已随包安装，无需新依赖）。
>
> **Goals**：新导入的 PDF 直接存原文件 → 书架打开即 pdf.js 原生渲染（版面 100% 保真）→ 选词/选句制卡与摘录走既有四键管线 → 页码锚点（pageIndex + anchorText）支持跳转原文与进度恢复。
>
> **Non-Goals**：扫描版 OCR（仍拒绝并提示）；R4 的 Range 流式/200MB+ 按需加载（本批整本打开，后续批次）；EPUB/Word/TXT/MD 链路不动；FSRS/提示词/cloze 不动；**存量 PDF 书不动**（用户手动删除，不做迁移）。
>
> **技术方案**：
> 1. **渲染集成**：新文件 `src/lib/reader/pdf/adapter.ts` 实现 ReaderKernel（与 foliate adapter 并列）；PDFViewer 按页 canvas+文本层（自带虚拟渲染）；worker 配本地 pdf.worker.mjs，不通则主线程直跑（文档写明）。
> 2. **页码锚点**：kernel.ts ReaderSelection.cfi 改可选 + 增 pageIndex；ReaderLocation 增 pageIndex?；RelocateInfo.chapterIndex 改可选；goTo 增 {pageIndex}；service.createKernel(host, engine)（默认 foliate）；buildLocator 签发 readerEngineVersion="pdfjs-<ver>"；ReaderEngine 跳转顺序 cfi→pageIndex→search→fraction。
> 3. **数据/IPC**：db.readPdfFile（查 kind='pdf-original'）；createFromPdf 改为只存原文（不再跑提纯）；App.loadReaderBook 增 pdf 分支 → {engine:"pdf"} 透传 ReaderEngine；progress 兼容 {pageIndex}。
> 4. **Reader UI（一次做全）**：选区菜单四键与快捷键零改动；目录接 getTOC()（无大纲隐藏）；模式→单页/对开/滚动；字号→缩放；深色→canvas CSS 滤镜（真机确认，不好则降级"PDF 仅纸白"）；图片挖空经 canvas 快照进 ImageFocus 复用。
>
> **验收标准**：双栏论文/含表含图 PDF 打开即原版面；选词制卡可用（contextRef 含 pageIndex）；关闭重开回同页；扫描版仍拒绝；`tests/pdf.kernel.cjs` + `tests/m6-2native.gui.mjs` 全绿；M6-1（43/43）、M6-2 提纯单测（22/22，函数保留仍须绿）、阅读 L1/L2 冒烟全绿。
>
> **实现落点（v28）**：`src/lib/reader/pdf/adapter.ts`（PDFViewer 按页 canvas+文本层；文本搜索不用 findController，用逐页 getTextContent 确定性扫描；imageClick 取 canvas 快照 dataURL；目录 href=`pdfpage:N`；模式→单页/对开/滚动，外观深色→canvas 反色滤镜）+ `vendor.d.ts`（pdfjs 无打包类型，本地声明）；**ES2025 兼容层**（pdf.js v6 要 Promise.try/Map.getOrInsertComputed/Uint8Array.toHex，Electron 31/Chromium 126 缺失：主线程补丁在 adapter.ts，worker 补丁经 `scripts/postbuild-pdf-compat.cjs` 前置进 dist worker（补丁源 `tests/pdf.compat.js` 单一来源；npm run build 已串接），Electron 升级到 Chromium 133+ 后删除）；public/pdfjs（cmaps+standard_fonts，Vite 直拷 dist，CJK 必需）；kernel.ts 页码锚点（ReaderSelection.cfi 可选+pageIndex、ReaderLocation.pageIndex?、RelocateInfo.chapterIndex 可选、goTo 增 {pageIndex}）；service.createKernel(host, engine)（默认 foliate）；buildLocator 签发 readerEngineVersion="pdfjs-6.3.289"；db.readPdfFile + IPC library:readPdfFile；createFromPdf 改为只存原文（轻量文本层扫描判扫描版，不再提纯；提纯函数保留为全文检索备用）；App.loadReaderBook pdf 分支 {engine:"pdf"} 透传 ReaderEngine（跳转 cfi→pageIndex→search→fraction；initLocation 兼容 pageIndex）；目录无大纲隐藏；theme.css 补 viewer 容器尺寸（否则可视计算全 0 不渲染）。**测试**：`tests/pdf.kernel.cjs` 14 断言（esbuild 异步打包+url-text 插件内联 worker 文本为 Blob URL+CSS 文本注入）+ `tests/m6-2native.gui.mjs` CDP 20 断言（连续两次全绿；原生渲染/canvas+文本层/目录跳章/选词制卡 pageIndex/摘录/重启回同页/清理）；回归 M6-1 43/43、M6-2 提纯 22/22、L1 44/44、L2 20/20。**已知限制**：整本打开（Range 流式后续批次）；PDF 内嵌图片不单独提取（页内图片经 canvas 快照走 ImageFocus 复用）；旋转/竖排页面未适配。
>
> **v28.1 用户实测排障补记（2026-09-13，952 页 50MB 中文书）**：① 渲染进程 file:// 页面 fetch/XHR file:// 子资源被 Chromium 拦截（字形数据全失败→白轮廓无文字+重试风暴）——新增 **`pdfres://` 特权协议**（main.js 注册 standard/secure/supportFetchAPI/stream，host=cmaps|standard_fonts|iccs|wasm，资源=public/pdfjs 构建时拷 dist/pdfjs），adapter 四类资源 URL 全走 pdfres（**icc/wasm 缺一不可**：v6 新增 ICC 色彩与 JPX/JBIG2 wasm 解码器，缺 wasm 时封面 JPX 图片解码失败且渲染任务可挂起）；② 主进程导入扫描的字体 URL 须为**正斜杠普通路径**（NodeBinaryDataFactory=fs.readFile，file:// 字符串被当路径必败）；③ **backgroundThrottling:false** 入 webPreferences——窗口遮挡时 Chromium 暂停 rAF，pdf.js 渲染任务会永远停在 RUNNING（canvas 已建但不挂载 DOM、无任何报错，现场曾误判为代码回归——44de302 纯净态复测同样失败后才锁定环境因素）；④ 书页宽度不一可能为 PDF 本征混排尺寸（探针实测本征宽 342–1080pt 混排），非渲染 bug；⑤ PDF 文本层乱码（选区复制出无意义字符）= 该 PDF 内嵌字体缺 ToUnicode 表，属文件自身数据缺陷，非渲染器问题。诊断方法论：CDP Target.setAutoAttach 抓 worker 控制台 + `__pdfViewerDebug` 钩子看 renderingState/canvas 挂载 + canvas getImageData 像素采样判定"真渲染 vs 白板"。
>
> **实现落点（v27）**：新增依赖 `pdfjs-dist`（6.3，legacy 构建主进程动态 import，CommonJS 内 `await import()` 启动零开销；cMapUrl/standardFontDataUrl 必须以正斜杠 `/` 结尾否则 factory 校验报错）；`electron/importers.js` 增 `pdfToMarkdown`（提取→行（hasEOL+y 双信号）→段落（25 分位行距 + 缩进启发式）→章节化三优先级→跨页段落愈合（上页末段无终止标点则与下页首段合并，CJK 粘连/ASCII 补空格）→扫描版拒绝）与纯函数 `itemsToLines/linesToMarkdown/headingCandidates/joinPageMarkdown/pdfOutline`；`electron/db.js` 复用 `createImportedDoc`（source_type=pdf，原文件 kind=pdf-original）；IPC `library:pickPdf`+`library:createFromPdf`（返回 {id,title,pages,emptyPages,chapters,outlineUsed}）；`libraryApi.pickImport/createImported` kind 联合类型扩 "pdf"；AddBookModal 增「导入 PDF」按钮 + emptyPages 提示。**测试**：`tests/m6-2.test.cjs`（22 断言：书签大纲/字号标题/页分块/单章回退/扫描版拒绝/空页统计/跨页愈合/CJK 纯函数/确定性；手工构造无压缩 PDF 夹具——PDF 内容流不支持 CJK 字面量，CJK 正确性由纯函数层覆盖）+ `tests/m6-2.gui.mjs`（CDP 自启自关 15 断言：导入/扫描版拒绝/source_type/assets/目录跳章/正文渲染/选区制卡 CFI/重启不丢/清理）；M6-1 回归 43/43 全绿。**已知限制**：版面保真渲染（R4 PdfAdapter 按页虚拟渲染）为后续独立批次；PDF 内嵌图片不提取；旋转/竖排页面未适配。

> **M6-1 完成情况（✅ v26 实现，2026-09-12）**
>
> **Goals**：.docx（含正文图片）/ .txt / .md 成为一等阅读材料——选文件 → 转 markdown+图片 → 走既有 `buildSyntheticEpub` 确定性合成管线 → 同一 foliate 内核阅读（目录/滚动分页/选区制卡走 detectMaterialType/CFI 锚点/M2 备份覆盖全部继承，零内核改动）。
>
> **Non-Goals**：PDF（含任何 OCR）→ M6-2；HTML 文件导入 → M6-3；Anki 牌组（用户拍板永不）；不改 FSRS/权重/提示词文本/cloze 契约；不修 `splitMarkdownChapters` 空首章技术债（改结构会致存量 CFI 失效，须随 SYNTH_GENERATOR_VERSION 升级另批处理——注意本批 syn-2 升级仅增图片能力，章节切分逻辑未动，见下）；MinerU 双栏在可选池。
>
> **技术方案**：
> 1. **合成管线图片支持（本批唯一结构性改动）**：`buildSyntheticEpub(title, markdown, opts?)` 增 `opts.images?: [{filename, bytes, mediaType}]`——① 章节 bodyHtml 内 `<img src>` 重写为 `images/<filename>`；② OPF manifest 追加 image 条目（spine 与 nav 不动）；③ `zip.file("OEBPS/images/…")` 落二进制；④ 图片字节 hash 折入 `dc:identifier` 的 stableHash 输入（同 markdown 不同图不再碰撞）。**`SYNTH_GENERATOR_VERSION`: syn-1→syn-2**（结构变更纪律 §7.1.11：存量粘贴书已存 CFI 走既有降级链——章节索引+anchorText→全文搜索；粘贴书无图时合成结构与 syn-1 逐字节同构，仅版本号元数据变化）。
> 2. **Word**：新增依赖 `mammoth`，`convertToHtml` + `convertImage`（`imgElement` 异步收集 `{bytes, contentType}`，文件名按出现序确定性命名 `img0/img1/…`）；mammoth HTML → 既有 turndown+DOMPurify 管线（放行 img，禁 style/script）→ markdown（`![](images/imgN.ext)` 占位）。DB `documents.markdown` 只存轻量占位文本，图片字节只进 EPUB。单书图片总量上限沿用资产 10MB 思路（超限导入时提示并中止）。
> 3. **TXT**：主进程读字节 → 编码检测（UTF-8 BOM / 无 BOM 试 UTF-8 严格解码 → UTF-16 LE/BE BOM → GBK 回退）→ 换行归一化（CRLF/CR→LF）→ 空行启发式段落化（不碰 `splitMarkdownChapters` 本体，输入侧产出合法 markdown；标题回退=文件名去扩展名）。
> 4. **Markdown**：读文本（同上编码检测）→ 直通作 markdown 输入（`html:false` 防注入由合成管线保证）。
> 5. **DB/IPC/UI**：`electron/db.js` 新增 `createFromWord/createFromTxt/createFromMarkdown`（照抄 `createFromEpub` 形状：library_items+documents 双写 + 原文件落 assets kind=`word-original/txt-original/markdown-original` + persist + library/changed）；`source_type` 新增 `word/txt/markdown`，凡写死 `source_type IN ('paste','epub')` 的查询一并放行；读取侧零改内核（`App.loadReaderBook` 的「epub→原书，其余→synth」二分支天然覆盖）；IPC `library:pickWord/pickTxt/pickMarkdown` + `library:createFromWord/Txt/Markdown`；`AddBookModal` 增三入口，`Bookshelf` 空态文案同步；M2 备份自动覆盖新资产（无需改 backup.js）。
>
> **格式调研结论（v26 定案，M6-3 只补 HTML 导入实现）**：
> | 档 | 格式 | 处置 |
> |---|---|---|
> | 必须支持 | EPUB（已成）、DOCX（M6-1）、TXT（GBK 检测为中文刚需）、Markdown（M6-1）、HTML（M6-3：单文件导入 Readability+turndown+DOMPurify）、PDF（M6-2 纯文本先行） | 按 M6-1→M6-2→M6-3 推进 |
> | 被动兼容（零投入） | MOBI/AZW3、FB2、CBZ（foliate 内核已可直读） | 保留内核直读，不写导入代码、不合成 |
> | 跳过 | **Anki 牌组（用户拍板）**、KFX（DRM 无开放库）、CBR（RAR 许可摩擦）、DJVU（遗留，扫描书走 PDF+OCR）、CHM（遗留）、ODT 与 .doc 二进制（提示「另存为 .docx」）、RTF（低频） | 导入对话框不支持即自然表达 |
>
> **验收标准**：三种格式各至少 1 真实文件走通「启动→导入→阅读（Word 内嵌图全可见且位置正确）→选区制卡/摘录→重启不丢」；原文件 assets 可回读；中文（GBK）无乱码；新书可进 Topic 队列与 FSRS；`tests/m6-1.test.cjs` 全绿（Word 含图转换/TXT 编码与归一化/MD 直通/合成 EPUB 图片 manifest 与确定性）。
>
> **实现落点（v26）**：`SYNTH_GENERATOR_VERSION` syn-1→**syn-2**；`src/lib/epub.ts` 增 `SynthImage/rewriteImgSrcs/mediaTypeForFilename/imageHashSuffix`；新增 `electron/importers.js`（mammoth convertImage 收集内嵌图、主进程直跑 turndown（ATX 标题 + 自实现 GFM 表格规则）、EMF/WMF 跳过、单书图片总量 10MB 守卫、`decodeTextBytes` 编码检测（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退，原生 TextDecoder 零新增依赖）、`txtToMarkdown` 逐非空行成段、`markdownFromText` 直通、`titleFromFilename`）；`electron/db.js` 增 `createImportedDoc`（source_type=word/txt/markdown，原文件 kind=word/txt/markdown-original，内嵌图 kind=image-content）+ `readContentImages`；IPC `library:pickWord/pickTxt/pickMarkdown` + `library:createFromWord/Txt/Markdown` + `library:readContentImages`；`libraryApi.pickImport/createImported/readContentImages`；AddBookModal 增 Word/TXT/Markdown 三按钮；`App.loadReaderBook` word 分支取图随合成落包。**测试**：`tests/m6-1.test.cjs`（49 断言——v26 交付时 43，v29 增清理断言后 49；node 直跑，每次运行前 esbuild 重打包 epub.ts，?raw CSS 插件）+ `tests/m6-1.gui.mjs`（CDP 自启自关 23 断言：三格式导入→assets 落盘→Word 内嵌图 foliate 内核真实渲染（blob 重写+naturalWidth>0）→GBK 无乱码→选区制卡 CFI→重启不丢→清理）。**已知体验债**：markdown 以 `# ` 开头的文档（Word 常见）打开落在空首章（§9.4 既有技术债），经目录跳转可达实际章节，随未来 syn 版本升级一并修复。
>
> **实现落点（v26）**：`SYNTH_GENERATOR_VERSION` syn-1→**syn-2**；`src/lib/epub.ts` 增 `SynthImage/rewriteImgSrcs/mediaTypeForFilename/imageHashSuffix`；新增 `electron/importers.js`（mammoth convertImage 收集内嵌图、主进程直跑 turndown（ATX 标题 + 自实现 GFM 表格规则）、EMF/WMF 跳过、单书图片总量 10MB 守卫、`decodeTextBytes` 编码检测（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退，原生 TextDecoder 零新增依赖）、`txtToMarkdown` 逐非空行成段、`markdownFromText` 直通、`titleFromFilename`）；`electron/db.js` 增 `createImportedDoc`（source_type=word/txt/markdown，原文件 kind=word/txt/markdown-original，内嵌图 kind=image-content）+ `readContentImages`；IPC `library:pickWord/pickTxt/pickMarkdown` + `library:createFromWord/Txt/Markdown` + `library:readContentImages`；`libraryApi.pickImport/createImported/readContentImages`；AddBookModal 增 Word/TXT/Markdown 三按钮；`App.loadReaderBook` word 分支取图随合成落包。**测试**：`tests/m6-1.test.cjs`（43 断言，node 直跑，每次运行前 esbuild 重打包 epub.ts，?raw CSS 插件）+ `tests/m6-1.gui.mjs`（CDP 自启自关 23 断言：三格式导入→assets 落盘→Word 内嵌图 foliate 内核真实渲染（blob 重写+naturalWidth>0）→GBK 无乱码→选区制卡 CFI→重启不丢→清理）。**已知体验债**：markdown 以 `# ` 开头的文档（Word 常见）打开落在空首章（§9.4 既有技术债），经目录跳转可达实际章节，随未来 syn 版本升级一并修复。

### M6-3 — HTML 文件导入 + 被动兼容格式启用（v30a 本批；M6 批次收口）

> **Goals**：① .html/.htm 单文件成为一等阅读材料（正文提取 → markdown → 确定性合成 EPUB 进同一 foliate 内核）；② 把 v26 调研结论里“被动兼容零投入”落到可用——MOBI/AZW3/FB2/CBZ 可直接导入并由内核直读（原文件按原扩展名入库，读侧保留文件名供 foliate 按魔数/扩展名分发）。
> ③ **统一导入入口 + 批量导入（用户 2026-09-13 要求，D30）**：书架只保留一个「导入文件」入口——一个文件对话框多选（扩展名覆盖全部支持格式），按扩展名逐文件自动路由到对应导入管线，聚合报告成功/失败，单个失败不中断整批。
>
> **Non-Goals**：浏览器插件剪藏（留 §9.4 可选池）；HTML 内嵌图片提取（与 EPUB 导入同策略剥离 img，正文文本为主；图片支持留可选池）；远程图片联网加载不做（纯本地）；MOBI/AZW3 的 DRM 文件（v20 既定：DRM 跳过并提示）；不改阅读内核 vendor 快照。
>
> **技术方案**：
> 1. **HTML 转换（渲染层）**：新增 `src/lib/htmlImport.ts`——`DOMParser` 解析 → **@mozilla/readability** 提取正文（标题/正文/署名）→ DOMPurify 清洗（禁 style/script/img/link/meta 与 style/class/id 属性）→ 复用既有 turndown（ATX 标题 + GFM 表格规则）→ markdown。**回退链**：Readability 返回 null（非文章页）时，整页 body 走同一 DOMPurify+turndown 管线，保证任意 HTML 可导入不失败。渲染层执行的理由：DOMParser/DOMPurify 均为浏览器原生能力，主进程需 jsdom 才能等价（不为单一功能引入运行时重依赖；jsdom 仅作测试 devDependency）。
> 2. **IPC/落库**：`library:pickHtml`（filters html/htm，返回 {name,path,data}）+ `library:createFromHtml({title,markdown,sourceName,originalBuf})` → `createImportedDoc(sourceType="html", originalName="original.html")`；`source_type='html'` 读侧天然走 synth 分支（同 paste/word/txt/markdown，零内核改动）。
> 3. **被动兼容格式**：新增 `library:pickEbook`（filters mobi/azw3/azw/fb2/fbz/cbz）+ db `createFromBookFile({title, originalBuf, ext, sourceName})`（source_type="ebook"，原文件 kind=`book-original`、path=`original.<ext>`，documents.markdown 空壳占位）+ `readEbookFile(itemId)` 返回 {bytes, name}（name=入库文件名，扩展名保真）；App.loadReaderBook 增 ebook 分支（foliate 引擎）；adapter `open` 的 File MIME 按扩展名映射（mobi/azw3/fb2/cbz 各自 MIME，缺省 epub）——foliate `makeBook` 用魔数分发 ZIP/MOBI，CBZ/FB2/FBZ 判定依赖扩展名，故**文件名扩展名必须保真**。
> 4. **UI（D30 统一入口）**：AddBookModal 去掉分格式按钮，仅保留一个「导入文件」——`library:pickImportFiles`（`properties: ["openFile","multiSelections"]`，扩展名覆盖 epub/pdf/docx/txt/md/markdown/html/htm/mobi/azw3/azw/fb2/fbz/cbz）；渲染层按**扩展名路由**：epub/html 走渲染层解析（读字节经 `library:readFileBytes`），docx/txt/md/pdf 走主进程 `createFrom*`（路径入参，主进程自行读盘），mobi/azw3/fb2/cbz 走 `createFromBookFile`（原文件按原扩展名入库）；导入中显示进度（第 N/M 个），结束聚合提示「成功 N 本，失败 M 个：文件名（原因）」；单个文件失败不中断整批。原分格式 `pick*` IPC 保留（测试与其他调用方仍在使用，不再挂 UI）。
>
> **调研收尾结论（M6 全批次定案）**：必须支持并已落地 = EPUB（v20）/ Word·TXT·Markdown（v26）/ PDF 原生阅读（v28）/ **HTML（本批）**；被动兼容已启用 = **MOBI·AZW3·FB2·CBZ（本批）**；跳过 = Anki 牌组（用户拍板）/ KFX（DRM 无开放库）/ CBR（RAR 许可摩擦，提示转 CBZ）/ DJVU·CHM（遗留格式，扫描书走 PDF+OCR）/ ODT·.doc 二进制（提示另存 .docx）/ RTF（低频）。**M6 批次至此全部收口**。
>
> **验收标准**：真实网页 HTML 导入后正文干净（无导航/脚本/样式噪音）、标题正确、可阅读可选区可制卡；非文章页 HTML 走回退链仍能导入；CBZ/FB2 夹具导入后内核可打开并渲染；MOBI/AZW3 同链路（需真实文件冒烟）；重启不丢数据；`tests/m6-3.test.cjs` 全绿。
>
> **完成情况（✅ v30 实现）**：**转换** src/lib/htmlImport.ts（DOMParser + @mozilla/readability 0.6 正文提取 → DOMPurify 清洗 → turndown（ATX + 自实现 GFM 表格规则）→ markdown；Readability 无正文时整页回退；decodeHtmlBytes 与主进程同策略的编码检测）；**统一入口（D30）** `src/lib/importKinds.ts`（扩展名→类型路由纯函数）+ `src/lib/importRouter.ts`（逐文件分发 + 批量聚合）+ AddBookModal 单「导入文件」按钮（进度 N/M、聚合成功/失败报告）；**IPC** pickImportFiles（multiSelections）/ readFileBytes / createFromHtml / createFromBookFile / readEbookFile；**被动格式** source_type=ebook、资产 kind=ebook-original path=original.<ext>（扩展名保真），App ebook 分支 + adapter 按扩展名映射 File MIME（foliate makeBook 按魔数分发 ZIP/MOBI，CBZ/FB2/FBZ 依赖扩展名/MIME）；**测试** tests/m6-3.test.cjs 24/24（jsdom devDependency 构造 DOM + esbuild 打包 htmlImport：Readability 提取/噪音剔除/GFM 表格/回退链/GBK 解码/路由表）+ tests/m6-3.gui.mjs 14/14（HTML·FB2·CBZ 建册→阅读→重启不丢→清理）+ L1 增 FORMAT 段（CBZ/FB2 直读 4 断言，L1 总计 48）；**CBZ 画面经截图人工确认**（红色测试图完整渲染——foliate-view/foliate-fxl 均闭式 shadow DOM，自动化探针不可及，画面属 L3 冒烟）。**已知限制**：HTML 内嵌图片剥离（与 EPUB 导入同策略）；MOBI/AZW3 无法手工构造夹具，需真实文件冒烟；HTML 文章以 `# 标题` 开头时落空首章（§9.4 既有技术债，目录一跳即达）。

### v29 — 体验修复批（2026-09-13，用户实测反馈四项）

> **① Markdown 导入噪音清理**：微信文章网页存档类 .md 含网页 `<style>` CSS 块与底栏 data-URI 图标（阅读/赞/分享等），直通导入后 CSS 被当转义文本显示、图标被当图片渲染。`markdownFromText` 增清洗：剔除 `<style>…</style>`/`<script>…</script>` 原始块（多行、大小写不敏感）与 `![…](data:image/…)` 数据图行；只动 Markdown 导入路径，粘贴路径不碰。tests/m6-1 增断言。
> **② PDF 缩放**：ReaderAppearance 增 `zoom?: "page-width" | "page-fit" | number`；pdf adapter applyAppearance 映射 `currentScaleValue/currentScale`，open 默认 page-width；Reader 控制条 PDF 引擎增「缩放」Dropdown（适应宽度/适应页面/50–200%），存 readerSettings.appearance.zoom 沿用持久化；foliate 引擎不显示。
> **③ 选区菜单一击消失**：菜单打开时挂 document 级 mousedown 捕获监听，目标不在菜单/面板内 → 立即清选区并关菜单（此前关闭只挂在各 surface 的 pointerup 上，第一下点击落在未跟踪元素时菜单残留）。
> **④ AI 图片制卡内容感知升级（D26）**：见决策日志。实现要点：foliate 引擎 imageClick 时从章节 DOM 提取上下文（图片所属段落之上 1 段 + 之下 2 段，各限长 ~500 字）写入 ReaderImageRef.contextText，PDF 降级取同页文本层文字（限长 ~600 字）；cards.ts 消注入【图片周边文字上下文】部件（注明相关则用无关则忽略）；提示词 **card-occlusion v2** 播种（regions 改为每卡自带、cardType 增 "qa"、内容感知多形式出卡）；cards.ts preset 分支按 D26 映射重写（每卡自带 rects/shapes、多挖空 ord=cardOrd 全 accent、qa draft 空 rects 挂图、0 有效卡回退整选区单卡）；L11 放宽「有 asset 即有效」；CardFace imageOcclusion 分支 frontMarkdown 非空时图下渲染题面；确认面板按 draft.cardType 逐张分流（遮挡走 acceptOcclusionDraft+区域预览+lint，qa 走 acceptDraft+编辑+转翻转卡）。
> **测试**：tests/m5.test.cjs 更新为 D26 语义后 34/34（上下文注入/映射多卡/qa 空 rects 挂图/无效区域过滤/回退单卡/L11 放宽）+ cards.ts 重打包；tests/m6-1 增清理断言后 49/49；tests/pdf.kernel 增 zoom 断言后 16/16；回归 m6-2native 20/20 / M6-2 22/22 / L1 44/44 / L2 20/20 全绿。
> **Non-Goals**：粘贴路径不清洗；提示词后续调优走测试台闭环（v2 为主软件直插候选版）；手动遮挡制卡不变；PDF 连续缩放滑块不做；PDF 段落级上下文提取不做（降级同页文本）。

### v30b — 复习卡面修复批（2026-09-13，用户两项拍板 + 两项实测反馈）

> **① 一卡多挖空两形态（D27）**：见决策日志。实现要点：`parseCloze.render` 接受 `number | number[] | null`（旧签名兼容）+ `renderDetail` 返回文本顺序 maskedOrds（ord 升序≠文本顺序，是[…]对位还原与答案排序的依据）；`extractClozeAnswers` 逐空取答案（含 hint 拼回）；CardFace cloze 分支 `maskOrds = clozeOrds 空 ? 全部 ord : clozeOrds`，同答卡正面全部挖空、背面按文本顺序 ①②… 列全部答案；`expandClozeDraft` 拆卡（generateCards 出卡前 + acceptDraft 接受时双入口），分答卡 `clozeOrds=[自己的 ord]`、cardOrd=拆卡序、各遮一处另一空原文显示、独立 FSRS 调度；`commitQuestion` 按文本顺序逐个还原[…]（旧实现 String.replace 只还原第一个，多空卡编辑一次即毁第二空挖空语法）；确认面板分答草稿带「分答·拆N张」徽标；提示词播种 **v4**（R13 两形态 + schema 增 `clozeMode` + card-enum 同答注记；card-literature 随 card-seq 同步防漂移）。存量多空卡（cloze_ords 空）自动按同答渲染，无需迁移。
> **② 看图问答卡卡面定版（D28）**：题面正反面都渲染（v29 曾 `hasFrontText && !showBack`，翻面后题面整个消失——用户报告「有些问答卡无法点击编辑」的根因）且皆可内联编辑（编辑同步 noteText）；普通图片挖空卡维持 v16-c 卡面规范。
> **③ 遮挡块颜色统一（用户实测反馈）**：D26 每卡自带 rects 后，accent 判断仍错用批次卡序 cardOrd 去匹配区域 ord——多空卡一绿多黑、甚至全黑（隔离实例实测确认）。OcclusionShapes 改为**默认全部遮挡块 accent**（每卡区域都是本卡考察区，同遮同答同色）；旧 v1 共享区域链路显式标记 `occlusion_json.regionScope:"shared"` 才保留「cardOrd 单区高亮、其余 ink」的 v16-c 语义；regionScope 经 acceptOcclusionDraft 透传落库；存量卡无需迁移（无共享标记即默认新语义，用户库无活着的共享卡）。
> **④ 归属锚强制（D29）**：见决策日志。R19 扩充（论证/理论/学说/观点性内容一律带提出者锚：front 或 contextPrefix 人名全名+学派/年代可选；内容卡与归属卡拆卡；**归属卡 front/前缀禁现人名防泄题**；材料考不出提出者 → 「材料中的作者认为…」+ warnings「归属未定」；相似论证 warnings 提示易混）并适配 card-occlusion 模板（升 **v3**：遮挡/多挖空卡走 contextPrefix「人名:」替代纯领域词、看图问答卡写进题面）；提示词播种 **v5**（v4 同日早前已随重启播种，故归属条款独立成版留痕）。
> **⑤ 易混对比卡一键动作（D29 候选增强，用户拍板采纳）**：复习工具行「对比卡」按钮 + Leech 向导「生成对比卡」按钮 → 新组件 `ContrastCardModal` 确认框（生成进度/无 Key 错误重试/逐张「入库/放弃」）。cards.ts 新增：`buildContrastCandidates`（候选清单**只排除基准卡、挂起卡保留**——用户复审指正：暂停常是「疑似重复之后处理」，正是对比卡要找回的候选；排序=同主领域卡优先、域内新→旧；文本去重；图片卡 front 无区分度改用 back；逐条截 50 字、cap 500——个人库多年一般不超，近似全覆盖）+ `generateContrastDrafts`（`generateCards` context 增 `existingCardsLimit` 放开原有 10 张硬截断；focus 指令要求模型从清单选出最易混一张为 B、无真实混淆风险时允许空卡不硬凑）+ `createAcceptedCard`（建卡逻辑自 Reader.acceptDraft 抽取共用：per-blank 展开 + lint + S1 相似检索，acceptDraft 已重构为调用它）。
> **⑥ 字段影响核查（用户问询归属锚）**：contextPrefix 的全部消费方=复习卡面渲染 / 卡片浏览搜索文本 / lint / 制卡字段流转，**无聚合统计或外键引用**——归属锚改前缀文本对 knowledge_point_id、domain（UDC）、tags、mnemonic、sourceRef、dateStamp、priority、FSRS 字段零影响；L13 前缀泄题 lint 兜底已存在（前缀与答案重叠 → warn，归属卡误写人名会被抓）；唯一行为差异=浏览页搜索按新前缀词命中（搜「高尔吉亚」可得、搜「西方哲学史」不命中新卡，预期）。
> **测试**：m1 **65**/65（新增 M1-9 两形态 12 断言 + M1-10 对比卡候选清单 8 断言；修正 v29 遗留失败的 L11 旧断言——rects=[] 有 asset 合法）+ cards.ts 重打包；回归 m5 34 / m2 33 / m4 40 / m6-1 49 / m6-2 22 / persist 14 / undo 29 全绿；tsc 0 错误；dist 重建；隔离实例 CDP 冒烟（同答全遮背列①② / 分答遮一显一 / 看图问答背面题面 / 多空卡三块全 exam / 共享卡单区高亮 / 对比卡按钮与确认框 / 无 Key 错误路径与空候选早返回）。
> **Non-Goals / 待办**：对比卡候选的**语义检索召回**入 §9.4 可选池（触发条件与方案见该行）——现阶段「同域优先 + cap500 + 去重」在个人库规模下近似全覆盖；对比卡自动生成不做（机制口径见 D29：两层提醒 + 用户主导）；复习对比卡快捷键未加（M4 命令表未动）。

### M7 — 词典（v32 DictionaryProvider 可插拔架构，一次交付）

参考 GoldenDict-ng（https://github.com/xiaoyifang/goldendict-ng）与原版 GoldenDict（https://github.com/goldendict/goldendict），研究部分集成或自行实现。不嵌入 GoldenDict-ng 本体（无稳定库 API、体积大），只做「解析同源词典文件自研读 + 送外部查词」两条轻路。

- 架构：`DictionaryManager → DictionaryProvider[] → DictionaryEntry + ReadingContext → VocabularyCard`（快照卡）。阅读器/弹窗/制卡只依赖 `DictionaryProvider` 接口，不依赖具体词典。首批 Provider：Local（随一键下载内置的 JMDict/ECDICT/FreeDict/StarDict 解析）/ User（用户手动导入的 StarDict/DSL/ECDICT 文件）/ Online（在线）；JMDict/ECDICT/Wiktionary/StarDict/FreeDict/FreeDictionaryAPI/Jisho/Wordnik 以后均为新增 Provider 文件，不改核心（本批先落地 FreeDictionaryAPI + Jisho + StarDict/ECDICT/FreeDict，Wiktionary 通用与 Wordnik 可选随后）。
- 统一 Entry：`{word, reading, pronunciation, audio, definitions, partOfSpeech, examples, synonyms?, antonyms?, etymology?, source, language, normalizedWord}`；Entry 与 ReadingContext（documentId/chapterId/CFI/pageIndex/anchorText/selectedText/normalizedWord/sentence/before-after）严格分离；四卡由同一 Entry+Context 起草、落库各自快照文本（D18 每卡独立 FSRS，禁止复习期变形与共享可变体）。
- 来源模式：设置 `local / online / auto` 三档（auto=优先在线，失败/超时/无结果回落本地）；任何模式结果必显来源徽标。
- 在线不绑定：Free Dictionary API（EN 首发，免 Key）+ Jisho（JA，主进程 `net.fetch` 代理过 CORS，渲染层不直 fetch）+ Wiktionary（多语言通用，先 EN/JA 最小字段）+ Wordnik（仅可选，Key 与商用条款单独确认）。URL/baseUrl/镜像进配置，不写死（§7.1.3）。AI 网关与 `ai:websearch` 只做中文释义缺口/无 Key 降级兜底。
- 缓存+许可：`dictionary_cache{providerId,language,normalizedWord,result,fetchedAt,version}`；Provider 声明 `supportsCaching/cacheTTL/license/attributionRequired` 并严格遵守（缓存≠永久分发）。
- 弹窗（阅读辅助优先，非词典页）：默认仅拼写/音标+播放/1–2 条释义+一键制卡+来源；`settings.app.dict.popupFields` 复选（拼写/音标/音频/释义默认开，词性/例句/同反义/词源默认关）；capabilities 缺失字段自动隐藏；例句关闭绝不影响原句保存。异步三态（原文即显→Loading→填充/错误重试/切本地），在线绝不阻塞阅读器。
- 规范化：`lookup(rawText, context)` + 独立 `WordNormalizer`（NFKC/小写/去标点/英语轻量还原/日语活用微表），不进阅读器核心。
- **v38 追记·语言路由（D35）**：`resolveLookupLanguage({word, sentence, bookLanguage, manualHint})` 按 D35 优先级链出语言；`Manager.lookup` 解析后以统一 `languageHint` 下发各 Provider（在线缓存键一致）。`dict_sources.lang` 按格式派生；`dict:lookupLocal` 逐条附 `sourceLanguage`；渲染层 `pickLocalHit(hits, lang)` 按语言优先取命中。DictPanel 选中词下方语言 chips（自动/英语/日语/中文/韩语），点击以对应 hint 重查，「自动」清除手动；新选词重置。书籍语言：`library_items.lang`（空=未知），添加书籍模态下拉 + 书架卡片设置入口；Reader 把当前书 lang 作为 bookLanguage 传入；批量导入的书默认未知，句子启发兜底。
- **v38 追记·日→中词典调研结论**：JMdict 官方**无中文版**（多语言版仅 eng/ger/rus/hun/dut/spa/fre/swe/slv 9 种欧语）；可自由再分发且整包可下载的日→中数据源仅二：**jamdict-cn**（JMdict 全部约 19.1 万词条的中文释义，由英文释义 AI 翻译而来、质量可用但需标注可能有误；GitHub release 142MB zip sqlite，代码 MIT、数据随 EDRDG CC-BY-SA 4.0 署名）与 **kaikki zhwiktionary 日语卷**（中文维基词典人工编纂的日语词条，含百科词/俗语；官方简繁分卷已标记将下架，**用原始包 raw-wiktextract-data.jsonl.gz 约 216MB 按 lang_code==ja 过滤**；CC-BY-SA + GFDL 双许可）。**不存在**可自由再分发的现成日汉 StarDict 整包（StarDict 官方库失修且混有来历不明词典；FreeMdict 论坛日汉资源均为新明解/明镜等版权词典 OCR 产物——**一律排除**，§7.1.2）。KANJIDIC2（1.5MB，13108 汉字音训/笔画/部首，CC-BY-SA 4.0，SKIP 码 CC-BY-NC-SA 需剔除）调研备用未纳入。
- 单词卡四种形式（快照制独立卡）：① 看中文回忆外文单词和发音；② 看外文回忆发音和中文意思；③ 听发音回忆外文和中文；④ 展示原句上下文并对选中词挖空回忆挖空内容。发音默认系统 TTS（Chromium speechSynthesis 零依赖，接口形状按未来 AudioProvider 对齐，不写死播放器）；provider audio 有则并列按钮。
- 设置一键下载（`sec-dict`，AI 节之后，直链均 curl 实测）：JMDict_e（约10MB，www.edrdg.org，CC-BY-SA 署 EDRDG）/ ECDICT 完整版（约207MB sqlite zip，MIT，repo mini.csv 实测仅样例）/ CC-CEDICT（约4MB mdbg zip）；Jisho 在线 API 已下线（日语由 JMDict 本地包承担）；FreeDict（tar.xz）/WordNet（多文件）停靠后续批次；StarDict 朗道/牛津（版权不明，仅本地导入入口+风险注，不接盗版 §7.1.2）；Kaikki/Wiktionary 全量（数 GB，仅在线 API + 高级 URL 自导入）。每行下载按钮 + 大小标签 + 一句话介绍 + 推荐语；EDRDG ftp 不可达用 https 域；下载失败给「复制链接」兜底。**v38 新增两条（download 档）**：jamdict-cn（约142MB zip，github release 直链；介绍注明「AI 翻译自英文释义、可能存在少量错误」+ EDRDG CC-BY-SA 4.0 署名）/ kaikki-zh-ja（约216MB raw jsonl.gz 直链；介绍注明中文维基词典人工编纂、CC-BY-SA + GFDL 署名同许可共享）。
- 调研可集成的在线词典（须含单词释义和发音、且有成熟集成方法）；支持用户手动导入词典。
- LKM 约束：domain 走 Language & Linguistics ≤2（§4.6）；背诵卡禁推 application/transfer（§4.7）；只读 FSRS（§4.12）。

### M12 — 同源卡延后 Sibling Burying ✅（v34 实现；**位置：排在 M8 之前**）

> **批次位置说明（用户 2026-09-14）**：本批是当前复习体验的直接补口（用户实测：短材料一次产多卡，同日复习时先出的一张为其余卡泄题、污染 FSRS 数据判断），故排在长周期主线 M8 之前；**编号取 M 序列末尾（M12）以免打乱既有 M8 与 K0–K9 的全部引用**。契约与决策已随 v34 写入本文档（§4.16 + D33），本批只做实现。
> **上游需求原话**：「对于同一笔记生成的多张卡片，只有一张卡片会被安排在当日进行复习，其他卡片会被延后。原因：当对较短的笔记制作多张卡片时，内容会有重叠。如果都在同一天复习，对其中一张卡片的记忆可能会让其他卡片变得过于简单，从而影响 FSRS 的数据和判断。」
> **v34 实现完成情况**：① **数据层** ✅（`cards.sibling_key` ALTER TABLE 迁移 + createCard/IPC/preload 透传；存量 NULL=不参与延后）；② **建键** ✅（`siblingKeyFor` 纯函数：显式键 → 短材料锚点键 `src:<docId>:<extractId|hash(anchorText)>`（≤ `sourceTextLimit` 默认 300）→ per-blank 拆卡 `act:split-*` → NULL；调用点全接：Reader 手动翻转对 `act:flip-*`、图片挖空（手动+AI）`img:<assetPath>` 同图分组、单词四卡=查词锚点键（同词同位置重复制卡归入同组）、普通 AI/手动卡=锚点键、ContrastCardModal `act:contrast-*` **不与基准卡同组**（消歧语义，D29））；③ **队列视图** ✅（`computeTodayQueue(now?)` + `computeSiblingDeferred`：到期筛选/挂起排除/组额度/规范序一次算完，now 可注入；`listDueCards` 改为其投影）；④ **口径统一** ✅（`getStatsOverview` KPI 改由同一函数驱动，`dueToday + siblingDeferred == 到期窗口总数` 有断言锁定，消除 `due≤now` vs `due≤today24` 历史分叉；统计页领域分布/漏斗/月度同改接）；⑤ **体验** ✅（复习页「同源暂缓 N 张（明日自动解封）」展开区+可读原因+收尾页同显+撤销刷新；卡片浏览页「今日暂缓」页签+状态列标记+行详情原因；设置 `sec-siblingbury`：总开关/新卡/复习卡两分开关/每日放行数/短材料阈值）；⑥ **实测修正（重要）**：同源额度按 `review_logs ⋈ cards.sibling_key` **全量**统计——已评分的兄弟卡 due 已被 FSRS 移入未来、不在当日候选集里，初版只统计候选集导致额度未被消耗（同日答一张后兄弟卡照常出现），被 `tests/m12.test.cjs` M12-2 抓住后修正；⑦ **顺带修复既有缺陷**：`main.js` 的 `M7_TEST_USERDATA` setPath 晚于 `require("./db")`——db.js 顶部 require 的 settingsStore 在模块加载时固化 SETTINGS_FILE，导致 db 侧读默认目录 settings.json、main 侧写隔离目录（M12 GUI「设置已写入但队列无响应」的根因），已把 setPath 上移至 require 之前。**测试**：`tests/m12.test.cjs`（electron 隔离临时库，42 断言：额度规则/开关矩阵/步进卡豁免/挂起排除/长选区不建组/延后零写库不变量（fsrs_json 与 due 逐字段相等+review_logs 条数不变）/撤销额度回收/跨日时间注入解封/统计同口径/siblingKeyFor 键规则矩阵）+ `tests/m12.gui.mjs`（CDP 端到端 24 断言：同句 3 卡→今日 1 张→暂缓展开→评分后收尾→fsrs 零变化→浏览页页签→设置即时生效与持久化→清理）+ 重启不丢冒烟（5 断言，一次性脚本已删）。**回归**：m1 83 / m5 34 / m7 54 / m6-1 49 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0 错误；dist 重建。**FSRS 六件套其余层未重跑**（本批不触调度字段与 preview/next，队列行为由 L2 db 队列断言覆盖，§7.3 声明）。

**目标**：同一制卡来源单元产出的多张卡，同一学习日只放行一张，其余延后至次日——**不写 FSRS**（不改 `due`、不写 `fsrs_json`、不产生 `review_logs`），实现为「今日队列」纯函数视图（§4.16 全文）。

1. **数据层（1 项新列）**：`cards.sibling_key TEXT`（迁移 ALTER TABLE，存量行 NULL＝不参与延后，无回填）。`createCard` / `cards:create` IPC / preload `cardsAPI.create` 透传该字段。
2. **分组键建立（3 类调用点，确定性规则见 §4.16 item 5）**：
   - `src/components/Reader.tsx` 手动制卡：`p.mode === "reverse"`（约 699-711，D18 一次动作产两张互为翻转卡）、图片挖空手动卡 —— 同一动作内的单元键；
   - `src/lib/cards.ts createAcceptedCard()`：`expandClozeDraft()` 拆出的分答卡（D27）**自动继承父草稿的键**（重点：拆卡前只知父子关系，此处是唯一能自动建键的位置）；AI 普通草稿 + `ctx.contextRef` 且源文本 ≤ `sourceTextLimit` → 来源锚点键；M7 单词四卡（`Reader.tsx:1301`）→ 一次查词一个键；对比卡三件套 → 一次对比动作一个键，**对比卡不与基准卡同组**（消歧用途，与基准卡同日出现有益，D29）；
   - 阅读器外的手工卡（无锚点）→ NULL。
3. **队列视图 `SiblingQueueView.computeTodayQueue(now?)`（§4.2-20，纯函数放 `electron/db.js`）**：到期筛选（新卡 `fsrs_json` NULL 视为 due=now）+ 挂起排除 + 同源组额度（`perDay`，组内当日有评分记录则全组当日不放行，学习/重学步进中的卡不参与）+ 规范序排序（due 升序 → priority 降序）一次算完，返回 `{cards, deferred[{cardId, siblingKey, reason, siblingCardId}]}`。
4. **口径统一（本批硬性收口）**：`listDueCards()` 与 `getStatsOverview()` 都改由该视图驱动——消除现存的 `due ≤ now`（队列）与 `due ≤ today24`（统计）分叉；仪表盘/统计页新增「同源暂缓 N」，与「今日到期」分列（不静默少卡）；复习页剩余数用视图输出、`remaining` 保留 `max(0, …)` 兜底。
5. **体验**：复习页/队列页显示延后原因与组内已放行卡标题、「今日暂缓」可展开查看；卡片浏览页状态列可筛选「今日同源暂缓」；被延后卡在浏览页仍可显式打开复习（延后只作用于队列）。
6. **设置**：`settings.app.siblingBury = {enabled(true), newCards(true), reviewCards(true), perDay(1), sourceTextLimit(300)}`，设置页「复习」区块暴露总开关 + 新卡/复习卡两个分开关（对齐 Anki Bury new/review siblings）+ 每日放行数 + 短材料阈值。
7. **撤销一致性（不新增代码，须验证）**：撤销评分物理删除 `review_logs`（v22/v23）→ 组内当日额度自动回收、兄弟卡自动回队；`w` 跳过（`review_skips`）**不消耗**同源额度（跳过 ≠ 复习，语义分离，§4.16 item 7）。

**Non-Goals**：不改 FSRS 调度与 `preview/next`、不跑六件套（本批不碰调度字段）；不做「内容重复度分析/语义相似判定后延后」（用户备选方案——已否决并降级入 §9.4，见 D33）；不做跨来源/跨书的相似卡延后（S1 查重与对比卡已成对覆盖）；不引入向量检索或 embedding；不改提示词（零播种）；不改 cloze 契约与卡面（D18/D27/D28 全部不动）；不新增「延后」按钮（Anki 的 manual bury 不在本批，用户未要求）。

**实现落点**：`electron/db.js`（`computeTodayQueue` + `listDueCards`/`getStatsOverview` 改接 + `createCard` 透传 + ALTER TABLE 迁移）、`electron/preload.js` + `electron/main.js`（IPC：视图查询与设置读写）、`src/lib/cards.ts`（`siblingKeyFor()` 助手 + `createAcceptedCard` 建键）、`src/components/Reader.tsx`（手动制卡与单词四卡建键）、`src/components/ReviewView.tsx` + `QueueView.tsx`（延后提示与同源暂缓展示）、`src/components/CardBrowser.tsx`（状态筛选）、`src/components/SettingsPanel.tsx`（siblingBury 区块）。

**验收标准**：① 选中一句话制 3 张卡 → 今日队列只出 1 张，另 2 张进入「今日暂缓」（原因可读）→ 次日（时间注入模拟）出第 2 张、第 3 张再延后一天；② 三张卡的 `fsrs_json`、`due`、`review_logs` 在延后发生前后**逐字段零变化**（本批核心不变量，断言 `due` 不变）；③ 长选区一次产 12 张卡 → 不建组、当日全部放行（无阻塞）；④ 翻转对 / 分答拆卡 / 单词四卡同一动作内错日；⑤ 统计「今日到期」与队列张数一致，且「同源暂缓 N」可见；⑥ 撤销评分后兄弟卡自动回队；⑦ 关闭总开关后行为与 v33 完全一致（零影响）。

**测试**：新增 `tests/m12.test.cjs`（`npx electron tests/m12.test.cjs`，临时 userData 隔离库；esbuild 打包纯函数：分组键规则矩阵（结构性/短材料/长选区/无锚点）、额度规则（当日已评分→全组不放行、perDay=1/2、步进卡豁免、挂起排除）、延后不写库断言（before/after 对比 `fsrs_json` 与 `due` 逐字段相等、`review_logs` 条数不变）、撤销释放额度、开关关闭零影响）+ `tests/m12.gui.mjs`（CDP 端到端：同一句制 3 卡 → 今日 1 张 → 复习页显示「同源暂缓 2」→ 时间注入/改库模拟次日 → 第 2 张出现 → 重启不丢设置 → 清理）。回归：卡片队列/统计相关既有套件（m1 / m3 队列断言 / backup 33 / persist 14 / undo 29）全绿；**FSRS 六件套无须重跑**（本批不触调度字段），但须在测试报告中显式声明该结论。

### M8 — 日记与 AI 洞察 + Learner Knowledge Model（核心：知识结构建模 / 自适应推荐 / 第二输入通道）

> **v36 拆批 / v40 重排（D37）**：**M8-A 日记与快速记录**（✅ v36 实现，产品规格见 §6.5，决策 D34）→ **K1 知识地基**（❌ v40 补实现规格，见下；用户拍板 K1 提到 M8-B 之前，M8-B 直接消费真实 KP/子图）→ **M8-B AI 洞察**（❌ 规格见下）→ **K2–K9** LKM 实施路线（📐 设计定稿未实现）。

> **构想来源（用户 2026-09-09）**：学习材料分两类——① **他人创造的**（书、文章、视频文案等，软件现有全部输入通道均属此类）；② **自己感受到的**（日常事件引发的感悟与思考，此前没有输入通道）。人在记录感受时的倾向与选择学习材料时的倾向很可能相似，因此日记作为**主动记录的学习内容输入**，是已学知识的一种**边界拓展**：今天的思考可能源于此前在软件中学过的某个方向的知识；也可能当下并无关联，但将来学习的他人创造的材料会与从前的日记产生联系——日记与知识库之间存在双向的潜在关联，由 AI 洞察来发现。

目标：提供随想随记、无需整理的流式日记（Logseq 式按日期流水记录），并提供「洞察」入口，由 AI 发现日记与已学知识之间的联系，或洞察有趣、有用的关联。

内容：

1. **数据层**：新增日记条目表（日期 + 文本/轻 Markdown，含 §1.2 留位字段）与洞察记录表；条目可补记、可编辑，但不做整理性结构要求（无强制标签/分类/双链）。
2. **日记界面**：主导航新增「日记」页，Logseq 式按日期倒序的流式时间线；随想随记、记入即可，无需反复整理。
3. **「洞察」按钮**：日记页的主操作，位置依设计系统规范（§5）在实现时确定；点击触发 AI 洞察——**按需触发，不做后台自动分析**。
4. **AI 洞察**：将日记（默认近期，洞察范围实现前与用户确认）与已学知识（UDC 领域、卡片、摘录、在读书籍）打包为上下文，输出：日记与已学内容的关联（某条感悟 ↔ 某本书/某张卡/某个领域）、跨条目的主题汇聚、开放性的追问；洞察结果可保存、可跳转到被关联的原文/卡片；随知识库增长重复洞察，会发现旧日记与新学材料之间的关联（第二方向）。
5. **洞察去向**：发现值得沉淀的感悟时提供「就此制卡」入口（复用既有制卡管线 + CardLint，§4.2-18）；洞察提示词遵循 M1 纪律——先测试台验证，再播种新版本。

Non-Goals：日记不进 FSRS 队列、不强制制卡（D18 精神——日记是输入面，不是复习面）；不做日记的强制整理与云端同步；洞察不自动定时触发。**v24 补充（LKM 联动）：日记只产生 demand signal（现实问题/需求信号 → 知识缺口 → Frontier），禁直接写 mastery；除非用户随后完成实际学习/回忆/应用任务（§4.7.9 sourceType=diary_signal）。Insight 三层证据与 Meaning 图见 §4.13。**

**v33 补充（结构连接分支）：** 洞察新增**结构驱动的推荐**（§4.14，D32）——AI 可用已持有知识中的**结构**而非前置，去连接一个用户未接触过但结构高度对应的领域，并说明推荐理由与结构相似之处（含至少一条主要差异）；用户接受后建立**初步认知模型**并进入「吸收 → 修正」闭环。跨域结构匹配引擎随 **K9** 落地；M8 落地时至少覆盖「结构相似性说明 + 槽位映射表」的输出与展示。

#### M8-A — 日记与快速记录 ✅（v36 实现；产品规格全文 §6.5，决策 D34）

**目标（用户 2026-09-14 原话）**：随想随记、无需整理；全局快捷键（类 `Ctrl+Alt+Space`）弹出**与软件同设计风格的小型 Markdown 编辑器**，**用户无需任何点击**、随输入同步保存到主软件日记模块**当日日记结尾、另起一行**；追加需求——「给『添加新的学习材料到书架』的那个窗口也增加一个快捷键」。

**落点**：`electron/journalTime.js`（自然日纯函数）、`electron/db.js`（`journal_entries` + 六个仓储函数 + `{deferPersist}`）、`electron/quickCapture.js`（捕获窗口单例 + 全局快捷键组 + 草稿-发送状态机 + 防抖持久化）、`electron/preload-capture.js`、`electron/preload.js` + `electron/main.js`（`journal:*` / `capture:*` / `library:requestAdd` / `shortcuts:status` IPC、`settings:set` 重注册、单实例、退出 flush）、`capture.html` + `src/capture.tsx` + `src/components/CaptureEditor.tsx`、`src/components/JournalView.tsx`、`src/lib/journal.ts`、`src/App.tsx`（导航第 5 项 + App 级添加模态）、`src/components/Bookshelf.tsx`、`src/components/SettingsPanel.tsx`（`sec-global`）、`src/theme.css`、`src/lib/eventbus.ts`。

**验收标准**：① 按下全局快捷键 → 无框小窗在鼠标所在屏弹出、**零点击**输入即同步落库（状态点从「输入中」变「已保存」）→ 主窗口日记页若打开则实时出现；② 不按发送就失焦 → 窗口隐藏、内容仍在，再呼出**继续向下写**；③ 按「发送」→ 内容定格为当日日记末尾的一条（带时间戳）→ 编辑器清空、窗口保持打开，再呼出为**空白**；④ 跨日：昨日未发送草稿不被今天的输入污染，呼出顶部提示可「继续写 / 丢弃」；⑤ 日记页日期倒序、日组内正序、今天组末是输入行；条目可编辑/删除/搜索；⑥ `Ctrl+Alt+N` → 主窗口前置 + 就地弹出「添加书籍」模态，**当前视图不变**（阅读位置与复习会话原地保留）；⑦ 快捷键被占用时设置页显示「被占用」而非静默失效；开机自启开关生效；⑧ 重启不丢数据（含草稿）。

**测试**：`tests/m8.test.cjs` + `tests/m8.gui.mjs`（详见 §7.3）。回归：m1 / m5 / m7 / m12 / m6 三套 / backup / persist / undo 全绿；tsc 0；dist 重建（vite 多入口）。**人工冒烟**（不可自动化）：真实按键（含中文输入法激活状态）、失焦隐藏手感、文件对话框前台弹出、开机自启登录项。

#### K1 — 知识地基（✅ v40 实现，D37；**位置：M8-B 之前**）

> **排期理由（用户 2026-09-15 拍板）**：M8-B 规格（§4.13-5 禁全库直发、LEARNED 层须可追溯 KP）的前提是 KP 可检索可追溯——没有 K1 的洞察只能退化为「日记内主题汇聚」，与已定规格差距过大。K1 先行的成本换 M8-B 直接落最终架构。

**目标**：落地 §4.6 本体的一等实体层——`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals` 四表 + 归一合并（可回滚）+ 生命周期（`active/merged/deprecated`）+ `prerequisite` 无环校验 + 旧字段迁移别名，为 M8-B 洞察检索与 K2+ 全部 K 批次提供地基。

1. **数据层（`electron/db.js`，六表 schema 见 §4.1）**：四表 CREATE + 索引（relations 唯一约束 `(from,to,type)`、points 按 `canonical_label` 普通索引）；`prerequisite` 写时 BFS 环检测（建环拒绝并返回环路径；`analogous_to` 不参与）；merge＝被合并 KP 软删除 + `merged_into` 指向 + alias 并入（**可回滚**：恢复 status + 清 merged_into + alias 还原）；全部写路径带 `sync_version/is_deleted` 四件套。
2. **旧字段迁移（不删列）**：`cards.knowledge_point_id / cards.domain` 存量语义零改动（制卡链路照旧）；`KnowledgeBase` 读取侧提供「旧 KP 字符串 → 同 Domain 内 label n-gram 相似候选」的归一建议，回填 `knowledge_proposals`（scope='manual'），用户确认后成正式 KP——只建议不自动写。
3. **IPC（`knowledge:*`）**：`knowledge:listPoints / getPoint / createPoint / updatePoint / mergePoints / unmergePoint / listRelations / createRelation / deleteRelation(软删) / listProposals / resolveProposal`；`knowledge:*` 全部走 `KnowledgeBase`（§4.2-23），读侧零 FSRS 写。
4. **最小管理面**：独立 KP 管理页（搜索 / 别名查看 / 合并确认 / 关系统计）+ 卡片浏览行详情显示 KP 别名；**完整图谱 UI 留 K8、AI staging 确认流留 K2**（proposals 表先建，K1 阶段生产者只有手动与迁移回填）。
5. **测试**：`tests/k1.test.cjs`（electron 隔离临时库：CRUD / 唯一约束 / 环检测拒绝与环路径 / merge 回滚 / alias 查询语义 / 软删除 / 迁移建议回填）+ `tests/k1.gui.mjs`（CDP：KP 页搜索合并、CardBrowser 别名显示）。回归：m1 / m5 / m7 / m12 / m8 + persist / undo 全绿；**本批不触 FSRS 调度字段**（须在测试报告显式声明）。

**Non-Goals**：AI 抽取（K2）、Evidence/BEMM（K3）、Frontier（K4）、画像推荐（K5）、联网（K6）、日记 demand 消费（K7）、图谱可视化（K8）、结构匹配引擎（K9）；不新增 AI 调用（零提示词变更）；不动制卡链路写语义。

> **K1 完成情况（✅ v40 实现，2026-09-15）**：① **数据层** ✅——四表 CREATE（`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals`，schema 见 §4.1）+ 索引；`prerequisite` 写时 BFS 环检测（拒绝并返回环路径）；merge＝软删除 + `merged_into` + alias 并入（mergeLog 记于被合并方 metadata_json，**unmerge 精确回滚**：还原 status/指针/被并入 alias）；**合并不重写关系边**（读取侧经 `resolveKpFamily` 族展开补语义）；生命周期 `active/merged/deprecated`（merged 只经 merge/unmerge 独占路径）；全部写路径即时 persist。② **旧字段迁移** ✅——`buildKnowledgeMigrationSuggestions`：扫存量 `cards.knowledge_point_id` 去重值 → 精确/n-gram（≥0.5）匹配 active KP → 'link' 提案，无命中 → 'create' 提案；**只回填 proposals 不自动写**（幂等，重复扫描零新增）；`resolveKnowledgeProposal(accepted)` 才写正式表。③ **IPC** ✅——`knowledge:listPoints/getPoint/createPoint/updatePoint/mergePoints/unmergePoint/listRelations/createRelation/deleteRelation/listRefs/createRef/deleteRef/listProposals/resolveProposal/migrationSuggestions`（main.js + preload `knowledgeAPI`）。④ **最小管理面** ✅——`src/components/KnowledgeManager.tsx`（CardBrowser 新增「知识点」页签：搜索/新建/别名维护/一跳关系/外部 ID/合并两步确认/解除合并/弃用；pending 提案区接受/拒绝）+ 卡片行详情 meta 增「知识点」行（legacy 值）；**完整图谱 UI 留 K8、AI staging 确认流留 K2**。⑤ **客户端** ✅——`src/lib/knowledge.ts`（类型化 API + 关系类型中文标签表）。⑥ **测试** ✅——`tests/k1.test.cjs`（electron 隔离临时库，**40 断言**：CRUD/别名检索/枚举/自循环/唯一约束/analogous_to 必带 structureLabel/环拒绝与环路径/非 prerequisite 不做环约束/merge 与 unmerge 精确回滚/族展开不重写边/迁移建议幂等/提案三通路决议/外部 ID/软删/零 FSRS 影响）+ `tests/k1.gui.mjs`（CDP 端到端，**16 断言**：页签挂载/新建/别名/建边/合并提示/解除合并/扫描归一建议/决策卡内容/接受前改名/行详情知识点）。回归：m1 83 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0 错误；dist 重建。**本批不触 FSRS 调度字段（K1 全部写路径均为新增独立表，对 cards/fsrs_json/review_logs 只读、实测零变化——§7.3 声明）**。顺带增量：`createFromPaste` 返回值追加 `documentId` 字段（供洞察来源 JOIN；既有 `{id,title}` 不变）。
> **v40.1 用户反馈修复（同日，提案决策卡）**：用户实测——「归一提案只有接受/拒绝按钮，没有具体提案内容，没法决策」。根因＝提案行只有一行摘要，而 AI 制卡写入 `cards.knowledge_point_id` 的常是**无语义簇 ID（「kp1」…）**，只显示旧值等于没有决策信息。修复为**提案决策卡**：每条提案显示类型徽标（归一链接/新建建议）+ 旧字段值 + 影响卡数 + **受影响卡面预览（至多 3 张 front + 余量计数）**；link 提案显示归并目标与相似度百分比；**create 提案接受前可编辑正式名称**（`resolveKnowledgeProposal` 增可选 `overridePayload`——与库内 payload 浅合并并落盘留痕，db/IPC/preload/client 四层透传）；无命中卡时显式说明「可能已被删除」。受影响卡索引随扫描同步刷新（v40 初版曾取挂载时快照致预览为空，k1.gui 断言已锁）。

#### M8-B — AI 洞察（✅ v40 实现，D37；v36 定义规格，v40 起排 K1 之后）

> 定位：由 AI 发现**日记与已学知识**之间的双向潜在关联（当下的思考源于此前所学；将来的材料与从前的日记产生联系），并发现用户**未明确意识**的思想/兴趣/价值/选择模式（§4.13）。四分支：**Knowledge / Self / Frontier / Structure**（v33 增补第四支，§4.14）。

1. **入口与范围**：日记页右上「洞察」按钮（**按需触发，禁后台自动分析**）；点开先选范围——近 7 天 / 近 30 天 / 全部 / 自定义区间；**发送前展示本次将发送的内容预览**（隐私透明，用户确认后才发）；有 token 预算上限与超限提示。
2. **上下文打包（禁全库直发，§4.13-5）**：本地检索先行——日记条目 → 相关 KP / 领域 → 子图 → 相关卡与摘录 → 来源（书/文），按 grounding 优先级（用户自有材料 > 用户确认洞察 > 知识图谱 > 通用权威 > 模型先验）装配 Evidence Package；越靠后越必须标推测。
3. **输出结构**（§4.13-2）：`{observation[], knowledgeLinks[], interpretations[{claim, type:hypothesis, evidence[], confidence}], alternativeInterpretations[], questions[], uncertainties[]}`；涉价值观/倾向的解释**默认 ≥2 个竞争解释**（防确认偏误）、措辞只许 `could / 一种可能的解释 / 与……一致 / 类似`，禁病理与人格断言；每条连接必须可点击跳转到卡/摘录/书/**日记原文**。
4. **存储与反馈**：`insight_runs`（范围快照 + 模型与提示词版本 + 输出 JSON + 反馈）；反馈四档（有用 / 部分有用 / 无关 / 不确定）+ 竞争解释二选；只调 `utility` 权重，**永不写 mastery**（§4.11-5）。结构分支另记定向反馈（接受 / 拒绝：结构不成立｜不感兴趣｜太难，§4.14-7）。
5. **去向**：① 就此制卡（复用既有制卡管线 + CardLint，§4.2-18）；② 跳转关联；③ 值得沉淀的感悟 → 候选 Personal Meaning（第三张图，用户确认后才成事实）；④ 暴露的缺口 → Frontier（K7 只产 demand signal）。
6. **提示词纪律**：新 scope `journal-insight`（＋结构分支 `structure-analogy`），**先测试台验证再播种**（M1 纪律，§7.4）。
7. **落点预案**：`src/components/InsightPanel.tsx` / `insight_runs` 表 + `insights:*` IPC / `electron/prompts.js` 播种 / `prompt-lab` 候选稿。**验收**：至少覆盖「结构相似性说明 + 槽位映射表」的输出与展示（v33 补丁）；洞察引用可点击追溯到原文；无 Key / 断网时按钮给出可读降级说明而非静默失败。

> **M8-B 完成情况（✅ v40 实现，2026-09-15；依赖 K1 地基同日落地）**：① **数据层** ✅——`insight_runs`（范围快照/evidence_package 全量快照/模型与提示词版本/输出 JSON/token_used/feedback_json/status/error_text）与 `personal_meaning_candidates`（proposed/accepted/rejected/ignored 状态机，封闭 7 kind）两表 + 仓储函数（§4.1）；反馈合并语义（分次写不互毁）。② **Evidence Package** ✅——`buildEvidencePackage(rangeKind, tokenBudget)`：日记（**只取已发送条目**，草稿永不入包）→ label/alias 子串命中 seed KP → 一跳子图（族展开）→ 命中卡（卡面含 label 或 legacy knowledge_point_id 精确）→ 命中摘录 → 来源 JOIN；token 粗估（CJK 0.7/字）超限按 grounding **从后往前裁剪**（先裁非 seed 边→减卡配额（floor 10）→减摘录（floor 5），日记恒保留），`grounded/trimmed` 显式标示；`groundingOrder` 固定五级。③ **IPC** ✅——`insights:buildPackage/create/complete/fail/get/list/feedback/delete` + `meaning:list/create/resolve/delete`（preload `insightsAPI`）；运行/反馈变化广播 `insight:changed` → EventBus 新锁定事件 `insight/changed`。④ **InsightPanel** ✅——JournalView 右上「洞察」按钮 → 模态面板四步流：范围（7d/30d/全部/自定义）→ **发送前 Evidence Package 预览**（条数/token 预算/日记原文摘要/裁剪警示，隐私透明）→ LLM 流式（复用 `ai:chat` 通道 + `journal-insight` 模板 + 括号平衡容错解析，GLM 思考期如实显示）→ 输出渲染（观察/知识关联（点击展开日记与卡/摘录原文 + 有来源跳转）/≥2 竞争解释（可二选）/追问/不确定/结构连接（相似说明 + 槽位映射表 + disanalogy + 可证伪追问展示））；反馈四档 + 竞争二选 + 结构定向反馈即时落表；**无 Key 可读降级**（预检 `hasKey`，按钮置灰 + 说明文案）。⑤ **去向** ✅——「就此制卡」复用 `createAcceptedCard`（per-blank 展开 + **CardLint** + S1 相似，sourceRef=AI 洞察+时间）；「沉淀为个人意义」按 7 kind 建 PMC 候选（确认后才成事实）；追问（缺口）随 output_json 留痕，K4/K7 接入 Frontier 后可消费（v1 只存不路由）。⑥ **提示词** ✅——`journal-insight` v1 播种（三层证据纪律/竞争解释/措辞禁令/禁止编造 ID/structureConnection 契约；**新 scope 首版直播种，照 card-vocab v32 先例**；prompt-lab `prompts-draft.js` 同步基线直引供调优闭环）；**偏差记录：`structure-analogy` 独立模板播种随 K2 提案管线落地**（v1 的结构分支由 journal-insight 的 structureConnection 可选对象承载，满足 v33 验收最低线「相似性说明 + 槽位映射表」）。⑦ **测试** ✅——`tests/m8b.test.cjs`（electron 隔离临时库，**35 断言**：播种内容抽查/范围口径与草稿排除/seed KP→子图→卡摘录来源全链/groundingOrder/裁剪与日记恒保留/runs 事实与反馈合并/结构反馈/未知范围拒绝/PMC 封闭枚举与确认状态机/零 FSRS 影响）+ `tests/m8b.gui.mjs`（CDP 端到端，**13 断言**：洞察按钮/面板挂载/无 Key 降级/预览条数与 token 行/日记原文摘要/发送置灰/自定义日期框/重选范围/关闭回路）。回归全绿（同 K1 清单）；tsc 0；dist 重建。**本批不触 FSRS 调度字段（洞察写路径仅新增两表，§7.3 声明）**。**人工冒烟待做**：真实 Key 下端到端一次洞察（GLM 思考静默期 UI 反馈 + 输出 JSON 实际质量）——提示词调优经 prompt-lab 闭环（§7.4）。

> **边界注记（v42，§4.18-11/-16）**：本节「入口与范围」的纪律——**按需触发、禁后台自动分析**——**只适用于洞察**（洞察是给用户看的产物）；**用户记忆的整理是基础设施**，按 §4.18-11/-16 **自动触发**（日记变更防抖 + 启动补跑 + 开关重开后的补处理），**不受本纪律约束**。两者的分工边界（记忆 ≠ Personal Meaning ≠ 画像）见 §4.18-14 与 §9.1 M14。

> **M8-B 完成情况（✅ v40 实现，2026-09-15；依赖 K1 地基同日落地）**：① **数据层** ✅——`insight_runs`（范围快照/evidence_package 全量快照/模型与提示词版本/输出 JSON/token_used/feedback_json/status/error_text）与 `personal_meaning_candidates`（proposed/accepted/rejected/ignored 状态机，封闭 7 kind）两表 + 仓储函数（§4.1）；反馈合并语义（分次写不互毁）。② **Evidence Package** ✅——`buildEvidencePackage(rangeKind, tokenBudget)`：日记（**只取已发送条目**，草稿永不入包）→ label/alias 子串命中 seed KP → 一跳子图（族展开）→ 命中卡（卡面含 label 或 legacy knowledge_point_id 精确）→ 命中摘录 → 来源 JOIN；token 粗估（CJK 0.7/字）超限按 grounding **从后往前裁剪**（先裁非 seed 边→减卡配额（floor 10）→减摘录（floor 5），日记恒保留），`grounded/trimmed` 显式标示；`groundingOrder` 固定五级。③ **IPC** ✅——`insights:buildPackage/create/complete/fail/get/list/feedback/delete` + `meaning:list/create/resolve/delete`（preload `insightsAPI`）；运行/反馈变化广播 `insight:changed` → EventBus 新锁定事件 `insight/changed`。④ **InsightPanel** ✅——JournalView 右上「洞察」按钮 → 模态面板四步流：范围（7d/30d/全部/自定义）→ **发送前 Evidence Package 预览**（条数/token 预算/日记原文摘要/裁剪警示，隐私透明）→ LLM 流式（复用 `ai:chat` 通道 + `journal-insight` 模板 + 括号平衡容错解析，GLM 思考期如实显示）→ 输出渲染（观察/知识关联（点击展开日记与卡/摘录原文 + 有来源跳转）/≥2 竞争解释（可二选）/追问/不确定/结构连接（相似说明 + 槽位映射表 + disanalogy + 可证伪追问展示））；反馈四档 + 竞争二选 + 结构定向反馈即时落表；**无 Key 可读降级**（预检 `hasKey`，按钮置灰 + 说明文案）。⑤ **去向** ✅——「就此制卡」复用 `createAcceptedCard`（per-blank 展开 + **CardLint** + S1 相似，sourceRef=AI 洞察+时间）；「沉淀为个人意义」按 7 kind 建 PMC 候选（确认后才成事实）；追问（缺口）随 output_json 留痕，K4/K7 接入 Frontier 后可消费（v1 只存不路由）。⑥ **提示词** ✅——`journal-insight` v1 播种（三层证据纪律/竞争解释/措辞禁令/禁止编造 ID/structureConnection 契约；**新 scope 首版直播种，照 card-vocab v32 先例**；prompt-lab `prompts-draft.js` 同步基线直引供调优闭环）；**偏差记录：`structure-analogy` 独立模板播种随 K2 提案管线落地**（v1 的结构分支由 journal-insight 的 structureConnection 可选对象承载，满足 v33 验收最低线「相似性说明 + 槽位映射表」）。⑦ **测试** ✅——`tests/m8b.test.cjs`（electron 隔离临时库，**35 断言**：播种内容抽查/范围口径与草稿排除/seed KP→子图→卡摘录来源全链/groundingOrder/裁剪与日记恒保留/runs 事实与反馈合并/结构反馈/未知范围拒绝/PMC 封闭枚举与确认状态机/零 FSRS 影响）+ `tests/m8b.gui.mjs`（CDP 端到端，**13 断言**：洞察按钮/面板挂载/无 Key 降级/预览条数与 token 行/日记原文摘要/发送置灰/自定义日期框/重选范围/关闭回路）。回归全绿（同 K1 清单）；tsc 0；dist 重建。**本批不触 FSRS 调度字段（洞察写路径仅新增两表，§7.3 声明）**。**人工冒烟待做**：真实 Key 下端到端一次洞察（GLM 思考静默期 UI 反馈 + 输出 JSON 实际质量）——提示词调优经 prompt-lab 闭环（§7.4）。

#### K2-A — AI 抽取归一与关系（v41 实现，D38；**位置：K1/M8-B 之后、K2-B 之前**）

**目标**：把「旧簇编号（kp1…）→ 正式知识点」这件事从本地字符串匹配升级为 AI 语义处理，且**多次处理结果确定**（用户硬要求）；范围＝K2 六 scope 中的 `knowledge-extraction`（抽取+归一）与 `knowledge-relation`（关系抽取）。

1. **三层确定性架构**（完整契约见 §4.6「AI 抽取归一硬性规范」）：本地规范化收敛（`normalizeKpLabel` → normKey，同 normKey 至多一个 active KP）→ AI 只输出封闭契约提案（禁生成 ID、evidence 必引用输入原文）→ 本地裁决器（自动归一 / 强制转 link / 簇合并 / 歧义转 pending / 建环丢弃 / 指纹幂等）。
2. **批次簇键**：`batch:<genBatchId>:<knowledgePointId>`（v41 起 AI 制卡落库写 `cards.gen_batch_id`）/ 存量回落 `doc:<documentId>:<kp>` / 无锚点 `legacy:<kp>`。
3. **数据层**：`knowledge_proposals` 增 `fingerprint` 列（幂等键，同指纹任何状态已存在即跳过——含已拒绝）；`kpNorm.js` 纯函数（normalizeKpLabel / kpClusterKeyFor / kpProposalFingerprint）；db 增簇列举（`listKpClusters`）、输入装配（`buildKpExtractionInput`）、裁决器（`applyKpExtraction`）、关系端点重解析（点提案接受后自动填充 pending 关系提案的 kpId 端点）。
4. **IPC/编排**：`knowledge:kpExtractPrepare`（主进程装配输入）/ `knowledge:kpExtractApply`（主进程裁决）；渲染层 `src/lib/kpExtract.ts` 负责调 AI（两 scope 各一次、temperature 0.1、无 Key 静默跳过）——编排位置与制卡/洞察管线一致（主进程不拼提示词）。
5. **触发**：① **制卡顺带**——`createAcceptedCard` 落库后按 `genBatchId+knowledgePointId` 组簇后台静默处理（不阻塞不弹窗）；② **手动批量**——知识点页签「AI 整理」按钮处理存量待归一簇。
6. **确认**：提案制 + **一键全接受**（高确定性项自动归一免确认；新建/合并/关系逐条或一键全部接受，点在前关系在后顺序解析）；**已拒绝永不重提**（指纹幂等）。
7. **测试**：`tests/k2a.test.cjs`（electron 隔离库：规范化/簇键/指纹幂等/自动归一/强制转 link/run 内簇合并/歧义 pending/建环丢弃/关系端点重解析/播种抽查）+ `tests/k2a.gui.mjs`（AI 整理按钮与无 Key 降级、一键全接受）。
**Non-Goals（留 K2-B）**：余下 4 scope、KnowledgeLint K4/K7/K8 完整落地、向量召回。

> **K2-A 完成情况（✅ v41 实现，2026-09-15）**：① **纯函数层** ✅——`electron/kpNorm.js`（`normalizeKpLabel` NFKC+去标点空白+小写 / `kpClusterKeyFor` batch>doc>legacy / `kpProposalFingerprint` sha1 / `isOpaqueClusterId` 编号识别）。② **数据层** ✅——`knowledge_proposals` 增 `fingerprint` 列（ALTER + 索引；同指纹任何状态含已拒绝即跳过——createKnowledgeProposal 返回 `{...proposal, created}`）；`listKpClusters`（跨书 kp1 碰撞按 batch/doc 拆簇 + 已归一判定：normKey 命中 KP 或已有提案引用 + samples 卡面证据）；`buildKpExtractionInput`（待归一簇 ≤40 + 候选 KP ≤60 + 关系输入端点清单）；`applyKpExtraction` 裁决器（AI 输出容错解析 → 分组 → 自动归一 / 强制转 link / run 内同名簇聚合 / 目标越界降级 create / 歧义转 pending / prerequisite 建环丢弃 / 关系端点封闭校验）；`applyPointLinkProposal`（确定性别名并入：canonicalLabel + 非编号旧值 + AI 别名；**编号 kp1 不做别名**）；`resolvePendingRelationRefs` + `tryResolveRelationPayload`（簇引用反查点提案标签补 normKey，两种顺序均可收敛）；`acceptAllPendingKnowledgeProposals`（点 create→link→关系→合并序，单条失败不中断）。③ **本地迁移建议簇感知重写** ✅——有语义旧值走 n-gram，编号簇跳过（交给 AI 整理）；指纹幂等对已拒绝同样生效。④ **IPC/编排** ✅——`knowledge:kpClusters/kpExtractPrepare/kpExtractApply/acceptAllPending`（main + preload）；`src/lib/kpExtract.ts` 渲染层编排（两 scope 各一次、temperature 0.1、无 Key 静默跳过、关系失败不阻塞归一）+ `autoQueueKpAiProcessing` 制卡顺带（接受入库后后台静默；`createAcceptedCard` ctx 增 `genBatchId` 并落库）。⑤ **提示词** ✅——`knowledge-extraction` v1（簇回抄/禁编造 ID/UDC 注入/evidence 原文引用/10 条硬性规范与自检）+ `knowledge-relation` v1（端点封闭/9 枚举/前置方向锚语/置信 ≥3 才输出）播种；prompt-lab 基线直引同步。⑥ **UI** ✅——知识点页签「AI 整理（N 簇待归一）」按钮（无 Key 可读降级、完成摘要含自动归一/新建/归并/关系/歧义/跳过计数）+「全部接受（N）」一键（确认后顺序落地）+ 提案决策卡支持 clusters[] 多簇聚合显示与关系提案端点标签解析（未解析显式标注「等待端点归一后可用」）+ 关系/合并提案可读渲染。⑦ **测试** ✅——`tests/k2a.test.cjs`（electron 隔离库 **39 断言**：纯函数矩阵/两 scope 播种抽查/跨书拆簇/批次键优先/已归一判定/create 提案与指纹幂等（重复跑零新增）/normKey 自动归一与别名并入/编号不做别名/目标越界降级/歧义 pending/自循环与编造 id 丢弃/prerequisite 建环丢弃/端点重解析两序/一键全接受/拒绝不重提/零 FSRS 影响）+ `tests/k2a.gui.mjs`（CDP **8 断言**：AI 整理按钮与簇计数/无 Key 降级/扫描决策卡/一键全接受/pending 清零）。回归：k1.test 42 / k1.gui 16 / m8b.test 35 / m8b.gui 13 / m1 83 / m1.prompts 14 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0；dist 重建。**本批不触 FSRS 调度字段（写路径仅 proposals/KP 别名，§7.3 声明）**。**人工冒烟待做**：真实 Key 下对存量库跑一次「AI 整理」（观察归一质量与成本），提示词调优走 prompt-lab 闭环。

> **K2-A 完成情况（✅ v41 实现，2026-09-15）**：① **纯函数层** ✅——`electron/kpNorm.js`（`normalizeKpLabel` NFKC+去标点空白+小写 / `kpClusterKeyFor` batch>doc>legacy / `kpProposalFingerprint` sha1 / `isOpaqueClusterId` 编号识别）。② **数据层** ✅——`knowledge_proposals` 增 `fingerprint` 列（ALTER + 索引；同指纹任何状态含已拒绝即跳过——createKnowledgeProposal 返回 `{...proposal, created}`）；`listKpClusters`（跨书 kp1 碰撞按 batch/doc 拆簇 + 已归一判定：normKey 命中 KP 或已有提案引用 + samples 卡面证据）；`buildKpExtractionInput`（待归一簇 ≤40 + 候选 KP ≤60 + 关系输入端点清单）；`applyKpExtraction` 裁决器（AI 输出容错解析 → 分组 → 自动归一 / 强制转 link / run 内同名簇聚合 / 目标越界降级 create / 歧义转 pending / prerequisite 建环丢弃 / 关系端点封闭校验）；`applyPointLinkProposal`（确定性别名并入：canonicalLabel + 非编号旧值 + AI 别名；**编号 kp1 不做别名**）；`resolvePendingRelationRefs` + `tryResolveRelationPayload`（簇引用反查点提案标签补 normKey，两种顺序均可收敛）；`acceptAllPendingKnowledgeProposals`（点 create→link→关系→合并序，单条失败不中断）。③ **本地迁移建议簇感知重写** ✅——有语义旧值走 n-gram，编号簇跳过（交给 AI 整理）；指纹幂等对已拒绝同样生效。④ **IPC/编排** ✅——`knowledge:kpClusters/kpExtractPrepare/kpExtractApply/acceptAllPending`（main + preload）；`src/lib/kpExtract.ts` 渲染层编排（两 scope 各一次、temperature 0.1、无 Key 静默跳过、关系失败不阻塞归一）+ `autoQueueKpAiProcessing` 制卡顺带（接受入库后后台静默；`createAcceptedCard` ctx 增 `genBatchId` 并落库）。⑤ **提示词** ✅——`knowledge-extraction` v1（簇回抄/禁编造 ID/UDC 注入/evidence 原文引用/10 条硬性规范与自检）+ `knowledge-relation` v1（端点封闭/9 枚举/前置方向锚语/置信 ≥3 才输出）播种；prompt-lab 基线直引同步。⑥ **UI** ✅——知识点页签「AI 整理（N 簇待归一）」按钮（无 Key 可读降级、完成摘要含自动归一/新建/归并/关系/歧义/跳过计数）+「全部接受（N）」一键（确认后顺序落地）+ 提案决策卡支持 clusters[] 多簇聚合显示与关系提案端点标签解析（未解析显式标注「等待端点归一后可用」）+ 关系/合并提案可读渲染。⑦ **测试** ✅——`tests/k2a.test.cjs`（electron 隔离库 **39 断言**：纯函数矩阵/两 scope 播种抽查/跨书拆簇/批次键优先/已归一判定/create 提案与指纹幂等（重复跑零新增）/normKey 自动归一与别名并入/编号不做别名/目标越界降级/歧义 pending/自循环与编造 id 丢弃/prerequisite 建环丢弃/端点重解析两序/一键全接受/拒绝不重提/零 FSRS 影响）+ `tests/k2a.gui.mjs`（CDP **8 断言**：AI 整理按钮与簇计数/无 Key 降级/扫描决策卡/一键全接受/pending 清零）。回归：k1.test 42 / k1.gui 16 / m8b.test 35 / m8b.gui 13 / m1 83 / m1.prompts 14 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0；dist 重建。**本批不触 FSRS 调度字段（写路径仅 proposals/KP 别名，§7.3 声明）**。**人工冒烟待做**：真实 Key 下对存量库跑一次「AI 整理」（观察归一质量与成本），提示词调优走 prompt-lab 闭环。

**M8 实施路线 K0–K9（v24 定稿，v33 增补 K9；一次只推进一批；v40 起 K1 提前到 M8-B 之前实现，v41 起 K2 拆为 K2-A/K2-B）**

> 设计稿 §75–§84 经打磨收敛。K0 为纯设计批次（Non-Goals：不改复习逻辑、不改 AI 制卡 UI、不实现图谱 UI、不实现推荐、不实现联网搜索；只做 interfaces/contracts/算法规格/测试与迁移策略）。旧 `cards.knowledge_point_id/domain` 迁移为 KP 别名与 legacy domain，不删列。

| 批次 | 内容 | 测试重点 |
| --- | --- | --- |
| K0 | 知识模型规格（本文 §4.5–§4.14 即 K0 交付物） | 契约评审：三不变量/FSRS 隔离/字段封闭性 |
| K1 | KP + Relation 地基（`knowledge_points/relations/external_refs/proposals` + 归一合并 + 生命周期） | merge/唯一性/环检测/别名/软删除/迁移 |
| K2 | AI 提案管线（6 独立 scope 播种（**v33 增 `structure-analogy`**）+ staging 确认 + KnowledgeLint K2–K10） | 未知关系处理/confidence/重复 KP/拒收卡不产 evidence/接受卡建链/结构对应不编造 |
| K2-A | **（v41，D38）AI 抽取归一与关系（K2 的前 2 个 scope 子集）**：`knowledge-extraction` + `knowledge-relation` 播种 v1 + 三层确定性架构（本地规范化收敛 → AI 封闭契约提案 → 本地裁决器）+ 批次簇键 + 幂等指纹 + 制卡顺带/手动批量触发 + 提案制一键全接受 | 同输入重复跑零新增（指纹幂等）/ 跨书 kp1 碰撞拆分（批次簇键）/ normKey 命中自动归一 / AI 新名撞已有强制转 link / prerequisite 建环丢弃 / 关系端点重解析 / 拒绝不重提；✅ v41 实现（规格与完成情况见 §9.1 K2-A 节） |
| K2-B | **（余下 4 scope）**：`material-difficulty` / `knowledge-probe` / `frontier-explain` / `structure-analogy` 播种 + KnowledgeLint K4/K7/K8 完整落地（K2/K3/K5/K6 已随 K1/K2-A 落地） | 各 scope 契约测试 + 离散度守门；✅ v43 实现（完成情况见下 blockquote） |
| K3 | Evidence + State（`knowledge_evidence/states/probe_runs` + BEMM + 分层探针；**探针生命周期按 v44 修订契约执行**——前沿探索开关 + 免预确认混队 + 背面揭示 + 质量评判 + 一次性证据按质量评判分流（接受转普通卡 / 不接受退役），见 §4.7 v44 blockquote） | 仿真轨迹 Good/Good/Again/Application/Transfer 下三维度独立变化；结构假设不产 mastery 证据（§4.7-11）；探针一次性证据（首评后零增量）/ 接受转普通卡正常 FSRS / 拒绝退役且同类不重提（§4.7 v44 blockquote） |
| K4 | Frontier 引擎（六因子 + 四档挑战 + **结构驱动第二入口**） | challenge fit / frontier ranking / 结构入口三道闸门与「不豁免前置」 |
| K5 | 材料画像 + 本地推荐（profile 表 + 两阶段 + 解释**三类理由**） | 20 在读 + 50 无关材料的 candidate ranking + explain |
| K6 | 联网发现（search provider + 画像 + 同管线排序） | 内容不编造/画像生成/同本地管线 |
| K7 | 日记信号（M8 联动：demand → 缺口 → Frontier，禁直写 mastery） | 日记只产 demand、有任务才转 evidence |
| K8 | 可视化动画（2D 力导 + runs 计数回放） | 真实数字驱动（gaps/frontier/materials/recommended），禁假扫描 |
| **K9** | **结构连接（v33 增补，§4.14，D32）：** 已持有结构子图检索 + 槽位映射（`analogous_to`）+ tentative model 修正闭环 + 第三类推荐理由（structure-driven）；依赖 K1/K4/K5/K7，跨域材料来源受 K6 制约 | 结构匹配质量 / 推荐解释与槽位映射表逐槽一致 / 「结构不成立」驳回后再不出同结构建议（K10）/ 冷启动库（无 evidence）不出建议 |
| E | 下一条摘录推荐（§6.4.1–6.4.2，一步到位，随 K4–K5 落地） | 20 在读 + 50 无关摘录中"前置刚补上"条排第一且解释与快照一致；拒收卡不产 evidence、制卡只产弱证据；未知 status 前向兼容为 open |

LKM 双轨调优（§4.11）与一键上传（§7.6）随 K3 起并行落地，不单独占批次。

> **K2-B 完成情况（✅ v43 实现，2026-09-16）**：① **4 scope 播种 v1** ✅（§6.3.11 v43 记录）——material-difficulty / knowledge-probe / frontier-explain / structure-analogy，三要素（判定锚语 + evidence 引用要求 + 封闭选项清单 UDC 注入）齐备；消费引擎分属 K3（探针运行 `probe_runs`）/ K4-K5（Frontier/材料画像）/ K9（结构类比引擎），**本批只定契约、零新表、零新增 AI 调用点**。② **出层契约校验** ✅——`electron/kpScopes.js` 纯函数（零依赖，对齐 kpNorm.js 惯例）：`validateMaterialDifficultyOutput` / `validateKnowledgeProbeOutput`（**禁原题重问**＝题面与原卡题面双向包含 + 最短 6 字守卫）/ `validateFrontierExplainOutput`（**禁编造数字**＝文本中数字须能在输入原文找到，违反置空留痕）/ `validateStructureAnalogyOutput`（`result:null` 显式不成立为合法路径）——越界 id 丢弃、缺 evidence 降 uncertain、封闭枚举越界清理、相似度 ≤2 低档留痕。③ **离散度守门** ✅——`scopeDispersion(outputs, fields, threshold=0.3)`（封闭字段众数占比 → 不一致率，超阈提示收紧锚语或降档使用，§4.6 item 6/7）+ `SCOPE_DISPERSION_FIELDS` 四 scope 封闭字段表。④ **KnowledgeLint K4/K7/K8** ✅（§6.3.12 注记）——`runKnowledgeLint()`（卡→KP 关联走读取侧别名家族，与 K1/K2-A 同口径）+ `knowledge:lint` IPC + KnowledgeManager「质量检查」按钮（结果按 ruleId 列出、severity 徽标、点 KP 名跳详情、可收起；手动触发、只读非阻断）。⑤ **prompt-lab** ✅——4 scope 基线直引（DRAFT_TAG=v43-baseline-20260916）+ 模式下拉 LKM 分组 + 合成输入载荷（KP/候选 id 白名单沙箱，真实候选随 K3-K5/K9 引擎接入）+ 出层契约裁决展示（降级/丢弃逐条留痕）+「×N 次离散度」按钮（vendor/kpScopes.js esbuild 打包，`npm run build:kpscopes`）；**顺手修复** journal-insight / knowledge-extraction / knowledge-relation 未进 `BASELINE_SCOPES` 致测试台列表不可见的缺口。⑥ **测试** ✅——`tests/k2b.test.cjs`（electron 隔离库 **48 断言**：4 scope 播种 version===1 与三要素抽查/幂等播种/四个校验器好坏样本契约断言（编造 id、缺 evidence 降 uncertain、封闭枚举越界、禁编造数字、原题重问、result:null 路径）/scopeDispersion 一致与超阈/数组路径展开/KnowledgeLint K4a·K4b·K7·K8 命中与不命中/零 FSRS 影响）+ `tests/k2b.gui.mjs`（CDP **9 断言**：种子数据/质量检查按钮/K8 命中渲染且无误报/点击跳详情/收起/4 scope v1 经 promptsAPI 可达前端）。回归：k1.test 42 / k1.gui 16 / k2a.test 39 / m8b.test 35 / m8b.gui 13 / m1 83 / m1.prompts 14 / m5 34 / m7 84 / m12 42 / m8 65 / m6-1 49 / m6-3 24 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0；dist 重建。**本批不触 FSRS 调度字段（零新表，写路径仅 prompt_templates 播种，§7.3 声明）**。**人工冒烟待做**：真实 Key 下 ① prompt-lab 各 scope ×N 次离散度实测（观察档位/枚举稳定性，超阈即收紧锚语）② M8-B 洞察与 K2-A AI 整理两笔存量冒烟（前批遗留）。

### M13 — 成长反馈 Growth Feedback（v39 定契约，未实现；**位置：排在 M8-B 与 K0–K9 全部完成之后**）

> **构想来源（用户）**：用户 2026-09-15 提供的 ChatGPT 草案《Growth Feedback / 成长反馈系统》（定位产品体验最高层），加上用户本人补充要求——"软件实时监测算法中的关键数据与指标，复习评分完成后若达成某项指标、实现了一次知识掌握的质的跨越，用小的激励文字告诉用户"。经本会话审阅与扩展为 §4.17 契约 + §6.6 产品规格 + D36；原始草案的"三轨统计 / 知识疆域 / 成长记录 / Momentum / 四层 Dashboard / 核心闭环 / 最高层产品目标"全部保留。
> **排期理由（用户 2026-09-15 拍板）**：成长反馈依赖 K 系列当中的知识模型、算法、Frontier 引擎等内容提供的数据。

目标：让用户感受到的是"我比过去多知道什么、能做什么、连接了什么"（知识疆域扩展与认知结构建立），而不是"今天完成了多少任务"。

内容（内部两步，一次只推进一批）：

1. **GF-1 记忆层（零 schema 变更、零新写路径，只读 `review_logs` / `cards`）**：`GrowthReadModel`（§4.2-22）纯函数派生 + `growth:*` 只读 IPC + 复习页微反馈提示条（§6.6.2）+ 会话成果汇总（§6.6.3）+ 仪表盘「成长记录」组件（记忆层事件：`material` / `group` / `leech-recovery` / `relearning-recovery` / `retention-180`）。
2. **GF-2 知识层（依赖 K1–K4）**：KP 四态跨越 / Application / Transfer / 结构连接确认 / Frontier 新领域 → 提示条与汇总 + Capability 组件 + Growth Timeline + Territory 映射（§6.6.4）+ Momentum（§4.17-8）。

Non-Goals：无排行榜 / 分享 / 推送通知 / 虚拟货币 / 经验值 / 庆祝动画 / 打卡目标；不写任何 FSRS 与 LKM 字段；不新增 AI 调用；不新建业务表；禁把四态压成单一总分（§4.17-4）。

**落点预案**：`electron/growth.js`（或 `src/lib/growth.ts` 纯函数，两侧同源 esbuild 打包进测试）+ `electron/main.js` / `electron/preload.js`（`growth:*` 只读 IPC）+ `src/components/ReviewView.tsx`（提示条 + 会话成果汇总）+ `src/components/dashboard/`（新组件 + `layer` 字段）+ Territory 视图（GF-2）+ `src/components/SettingsPanel.tsx`（`growthFeedback` 开关）+ `src/theme.css`。

**验收标准**：① 一次评分跨越触发时提示条出现，**不阻塞下一张卡的加载与渲染、不改变卡面布局**；② 单次评分多条命中只显示最高级一条（断言分级顺序矩阵）；③ 撤销评分后该事件静默消失、重评可再次触发；④ 防回灌：只报"本次评分触发"的跨越，存量达成项不逐个弹；⑤ 取消项（单卡学习步毕业、单卡 21 天巩固）**不产生任何提示**；⑥ 关闭开关后零渲染零计算；⑦ 文案符合分层措辞（记忆层无"掌握"字样）。

**测试**：新增 `tests/m13.test.cjs`（事件目录矩阵 / 首次语义与 `review_seq` 全序 / 撤销回退 / 防回灌 / 单日折叠 / 取最高级 / 取消项不触发 / 开关关闭零影响）+ `tests/m13.gui.mjs`（CDP：评分后提示条出现与消失、点击证据链、会话成果汇总、设置开关、重启不丢设置）。回归：undo 29 + persist 14 + m12 + m8 全绿；**本批不触调度字段**（同 M12 先例，须在测试报告中显式声明该结论）。

**v33 补充（结构连接分支）：** 洞察新增**结构驱动的推荐**（§4.14，D32）——AI 可用已持有知识中的**结构**而非前置，去连接一个用户未接触过但结构高度对应的领域，并说明推荐理由与结构相似之处（含至少一条主要差异）；用户接受后建立**初步认知模型**并进入「吸收 → 修正」闭环。跨域结构匹配引擎随 **K9** 落地；M8 落地时至少覆盖「结构相似性说明 + 槽位映射表」的输出与展示。



### M14 — 用户记忆 User Memory（v42 定契约，未实现；**位置：排在 K2-B 之后、K3 之前**）

> **构想来源（用户 2026-09-15）**：用户在使用 AI 制卡时注意到「当我遇到 X 应该问自己什么」这一类应用卡（R15）——它把知识点与现实情境连起来，而**日记正是现实情境的记录**；因此要求软件维护一份类似 **Hermes**（Nous Research `hermes-agent`）的**用户记忆文件**，制卡涉及情境时从中取材。附加要求：① **记忆完全不需要用户参与维护**（用户已需阅读、摘录、制卡、复习、维护知识点——「再维护一个记忆文件，辅助作用不足以抵消所花精力」）；② 记忆须**覆盖日记中的一切**（烦恼、心理状态、情绪及其起因、与谁聊到什么、见闻等）——它是「现实体验 ↔ 所学知识」的交汇点，**要充分利用**；③ **越久远的记忆越珍贵**（不得因容量淘汰早期记忆）；④ **判断情境是否贴合交给模型**（本地实现成本太高、且一旦不够完美就会过严，反致功能失效）；⑤ 开关可关，且**关闭期间记录的日记在重新开启后必须补处理**。
> **调研结论（本批，出处见附录C）**：Hermes 的双文件（`MEMORY.md` 2,200 字符 / `USER.md` 1,375 字符）+ agent 自主 `add/replace/remove` + 整块注入确有可借鉴处，但其零维护依赖**装满即合并删旧**，与③直接冲突 ⇒ **改为分层文件真源 + 按需检索注入**（MemGPT / Letta / Claude Code 的共识结构：无限归档 + 有界上下文，索引恒定注入、内容按需读）；分类依据取自传体记忆三级（Conway SMS）与 WHOQOL / 个人幸福指数 / DISE / PERMA 的生活域并集；检索键用「书侧 UDC 领域 → 记忆侧生活域」映射（**不要求模型给日记内容猜 UDC**）。

**目标**：把日记沉淀为**可追溯、可持续、永不淘汰**的用户记忆，并在制卡时按需接地——让应用卡的情境来自用户真实经历，而不是模型编的通用场景。

**内容（内部两步，一次只推进一批）**：

1. **UM-1 记忆文件与整理管线**：`electron/memoryStore.js`（文件树读写 + op 执行 + 预算校验 + 手写区保护 + 水位线）/ `src/lib/memory.ts`（类型化客户端 + EventBus 桥）/ `electron/main.js`（`memory:*` IPC、日记变更防抖触发、启动补跑、补处理批队列）/ `src/components/SettingsPanel.tsx`（`sec-memory`）+ `memory_runs` 表 + 首次开启说明与补处理进度 UI。**本步不改制卡链路**（无检索无注入），可独立验收。
2. **UM-2 接地与检索**：`electron/memoryRetrieve.js`（领域映射 + 宽召回纯函数，两侧同源 esbuild 打包进测试）+ `electron/prompts.js`（`user-memory` v1 + 制卡族 **v7**：R20 + `memoryRef`）+ `src/lib/cards.ts`（生成上下文增记忆块装配与校验）+ `cards.memory_ref_json` 落库 + 制卡确认面板徽标与卡片浏览页筛选。

**Non-Goals**：不做记忆编辑界面（用户明确要求只给路径）；不做逐条确认提案流（§4.18-14 有界例外的要点）；不做向量/嵌入检索（v1 纯本地词面 + 领域映射，向量入 §9.4）；不做记忆图谱与时间轴视图（§9.4）；不与 `personal_meaning_candidates`、`context.userProfile` 互相写入；不自动制卡、不自动入队；不写任何 FSRS / LKM 字段。

**落点预案**：见上「内容」两步的模块清单；契约 §4.18，产品规格 §6.7，决策 D39。

**验收标准**：① 日记新增 → 防抖后自动整理，`memory/` 下出现 `index.md` / `core.md` / 主题文件，`memory_runs` 有一条 `ingest` 记录；② **永不淘汰**：连续多轮整理后早期条目仍在（断言文件内容只增不减、删除类 op 被拒绝）；③ **补处理**：关闭开关 → 记录若干日记 → 重新开启 → 进度可见、可中止、可续跑，完成后窗口内条目全部已整理（水位线断言）；④ **外部编辑不被覆盖**：手工改文件某行后再跑整理，该行不变或仅被追加标记（精确匹配语义断言）；⑤ **接地**：命中主题时应用卡情境取自记忆且可点开查看所引记忆行；**未命中时不注入，且模型须在 warnings 点名缺失主题**（不静默）；⑥ **拒用铁律**：无贴合处境时输出 `memoryRef: null`、卡面情境为通用写法（断言不出现记忆特有名词）；⑦ `memoryRef` 校验失败只在确认面板标「情境来源存疑」并默认不勾选，**不阻断**整批；⑧ 关闭开关后零调用零注入零检索；⑨ 备份 / 恢复包含 `memory/`（M2 回归）。

**测试**：新增 `tests/m14.test.cjs`（electron 隔离库：文件树读写与 op 精确匹配执行 / **不删不改写断言**（删除类 op 被拒 + 文件内容只增不减）/ 手写区保护 / 预算与 core 降级 / 水位线与补处理分批（时间正序、可中断可续跑）/ 领域映射与宽召回纯函数矩阵 / `memoryRef` 子串校验 / 零 FSRS 与零 LKM 影响）+ `tests/m14.gui.mjs`（CDP：设置区开关与路径显示 / 首次开启说明 / 补处理进度与中止 / 未命中时的 warnings 提示 / 确认面板徽标 / 卡片浏览筛选 / 重启不丢设置与水位线）。回归：m8（日记源）+ m1 与 m1.prompts（提示词 v7 播种、CardLint 未变）+ backup 33（含 `memory/`）+ persist + undo 全绿；**本批不触 FSRS 调度字段**（须在测试报告显式声明该结论）。

> **UM-1 完成情况（✅ v45 实现，2026-09-17）**：① **文件树真源** ✅——`electron/memoryStore.js`（纯 node 零 Electron 依赖，可被库测直连）：`<userData>/memory/` 脚手架（core.md / index.md / topics/，含手写区标记与格式说明）、追加式写入（appendFileSync 只增字节）、**`applyOps`**（op 词表封闭 **add / merge / mark**；delete/rewrite/未知 op 一律 rejected 留痕；merge/mark **精确文本匹配**失败即 skipped 留因；行尾追加 `<!-- 已并入/已取代/已结束/已移至… -->` 是唯一允许的「改写」；`<!-- 用户手写区 -->` 区间内行不可命中、追加落区外）；index.md 由系统按主题文件**确定性重生成**（手写区保留；带标记行不计活跃条数——目录「主题 · 条数 · 日期区间」恒与文件一致）；用量三段统计（0.7 CJK token 估算，与 db.estimateTokens 同源）。② **编排** ✅——`electron/memoryTidy.js`（主进程，ctx 注入 {db, readSettings, writeSettings, chat, broadcast, userData, hasKey}，**chat 可注入 fake**）：`settings.app.memory`（enabled **默认 false** / introAcked / **lastCoveredAt 水位线** / tidyDebounceMinutes 30 / tidyMaxWaitMinutes 360 / backfillBatchEntries 30 / inputTokenBudget 12000 / consolidateEveryRounds 10 / 轮数与轮转游标）；**摄入轮**（`listJournalEntriesSince`：is_draft=0 + updated_at>水位线 + **时间正序**；token 预算与批条数截断 → system=播种模板 `user-memory` → 括号平衡容错解析 → applyOps → rebuildIndex → **水位线推进=本批最大 updated_at**（无论 op 落地与否）→ `memory_runs` 留痕）；**周期整理轮**（每 N 摄入轮或目录超限触发，轮转 ≤2 主题文件 + core；降级/拆分以 add+mark 两步表达，不删不搬原文）；**防抖**（trailing + max 双计时器，照 quickCapture 先例；journal:create/update/delete/draftSend 四个主进程写入点挂 notify）；**启动补跑**（whenReady 自动备份之后：enabled + 有未整理 + 距上次成功 ≥12h）；**补处理**（分批时间正序串行、逐批推进水位线并留痕 trigger='backfill'、可中止、失败/退出/中止不丢进度）；**开关关闭 = 零调用**（notify/补跑入口前置检查；文件与水位线保留）。③ **IPC/广播** ✅——`memory:*`（status / setEnabled（introAcked 只置真不回退）/ backfillPreview / backfillStart / backfillCancel / tidyNow / openFolder / openFile / reset）+ `memory:changed` 进度广播 + preload `memoryAPI`；**`memory_runs` 表**（append-only：input/output/applied_json 留痕，护栏⑤）。④ **渲染层** ✅——`src/lib/memory.ts`（类型化客户端 + `installMemoryBridge`）+ EventBus 新锁定事件 **`memory/changed`** + App.tsx 桥安装 + SettingsPanel **`MemorySection`（sec-memory，唯一入口 §6.7.1）**：总开关默认关 / 文件位置全路径 + 打开文件夹·打开 core.md / 立即整理（无 Key·无条目给可读原因，§6.7.3「无 Key 零渲染」落为禁用与提示）/ 用量行（core·目录·主题 + 合计 token）/ 重置二次确认（明示不影响日记与卡片）/ 四件事说明文案；**首次开启一次性说明 → 补处理预估（条数/批数/调用与 token）→ 进度「已整理 N/M 条」+ 中止**（§6.7.2）。⑤ **M2 备份覆盖** ✅——backup.js resolvePaths.memoryDir + createBackup walk `memory/**`（meta.memoryFiles 计数）+ applyPendingRestore 整体换入（不合并）；settings.json 随备份（水位线/introAcked 天然覆盖）。⑥ **播种** ✅——**`user-memory` v1**（摄入轮与整理轮共用一套契约：op 词表封闭 / 生活域 9 域 / 条目行格式 / 写作纪律（陈述句·一周内过期不记·禁人格病理断言·宁缺毋滥）/ match 逐字照抄 / 手写区禁令；新 scope 首版直播种照 card-vocab/journal-insight 先例）+ prompt-lab 基线直引与 `BASELINE_SCOPES` 同步。⑦ **测试** ✅——`tests/m14.test.cjs`（electron 隔离临时库，58→**61 断言**：播种契约抽查 / 脚手架与用量 / applyOps 矩阵（非法 target 含 index 与路径穿越、delete/rewrite 拒绝、merge/mark 匹配失败留因、手写区保护）/ index 重建 / 水位线（增量·草稿排除·时间正序·编辑重入窗）/ **fake chat 全管线**（默认关零调用、无 Key 跳过、正常轮落盘+留痕+水位线推进、AI delete 被拒且正常 op 照常落地、坏 JSON→failed 且不推水位线）/ 补处理（分批正序·中止续跑·逐批留痕）/ 外部编辑不被覆盖（只增不减）/ consolidate / 零 FSRS（fsrs 快照全等）/ 备份含 memory/ 与恢复换入）+ `tests/m14.gui.mjs`（CDP **18 断言**：区块挂载与四件事文案 / memory/ 路径显示 / 默认关 / 一次性说明 / 补处理预估 3 条 / 无 Key 降级（立即整理给原因、不出空壳进度）/ 重置二次确认与脚手架重建 / 重启不丢（enabled+introAcked）/ 再开启不重弹说明 / 清理）。回归：m1 83 / m1.prompts 14 / m5 34 / m6-1 49 / m6-3 24 / m7 84 / m8 65 / m12 42 / k1 42+16 / k2a 39+8 / k2b 48+9 / m8b 35+13 / backup 33 / persist 14 / undo 29 / FSRS L2 db 23 全绿；tsc 0 错误；dist 重建。**本批不触 FSRS 调度字段（新增独立表 memory_runs + 文件树，cards/review_logs 只读零写，§7.3 声明）**。**偏差**：摄入轮 AI 编排在主进程 memoryTidy（渲染层编排先例的例外），理由与护栏见 §8.2。**人工冒烟待做**：真实 Key 下补处理一次历史日记（观察整理质量与成本），提示词调优走 prompt-lab 闭环。v45.1 补记：手写区 `<!-- -->` 注释在 Markdown 预览不可见——脚手架改在标记间放可见引导文字（HANDWRITTEN_HINT），存量空手写区自动补引导。

> **UM-2 完成情况（✅ v46 实现，2026-09-17）**：① **R20 原则制落地** ✅——`prompts.js` 增 **`SITUATION_REQUIRED_SCOPES` 注册表**（v1 清单：card-generation / card-mnemonic / knowledge-probe=true；排除 scope 常量组装 R20 不适用段）+ `situationRequiredFor()`；`prompt_templates` 增 **`situation_required` 列**（ALTER + 存量按注册表回填 + 播种时随模板写入）——注入管线只对声明为 1 的 scope 装配记忆块。② **制卡族 v6→v7** ✅——TARGET_VERSION 升 7，v7 内容 = v6 基础文本 + **R20 情境段**（声明 scope：只作 R15 情境/R12·R9 生活线索、答案必须来自材料、`memoryRef` 逐字抄录、`memoryRef: null` 合法且受鼓励、禁第三方隐私与逐字搬日记原句、零命中时可在 warnings 点名缺失主题）或 **R20 不适用段**（排除 scope）；v6 行留痕；prompt-lab 基线直引自动跟随（DRAFT_TAG=v46-baseline-20260917）。③ **检索** ✅——`electron/memoryRetrieve.js`（纯函数零依赖，主进程/测试共用）：**封闭映射表 DOMAIN_TO_LIFE_MAP**（§4.18-6，最长前缀匹配防「159.9 心理学」被「1 哲学」吃掉）+ `lifeDomainsForUdc` + `extractSignalTerms`（标题/章节全量 + 正文 ASCII 词与 CJK 2-gram 采样）+ `pickTopics`（域命中×2 + 主题名词面×2 + 内容词面×1，**不做语义否决不设硬门槛**，宁多勿少取前 2，零命中返回空）+ `buildMemoryBlock`（**core/目录恒定注入** + 命中主题，带 R20 用途声明头与用量行；零命中显式提示模型在 warnings 点名；超预算按行截断留痕）+ `validateMemoryRef`（子串存在性）。④ **IPC/编排** ✅——`memory:retrieve`（main：enabled 检查 → **无 Key 跳过**（§6.7.3 零检索）→ 本书已有卡 UDC 域分布（`listCardDomainsForDocument`：LIKE + 精确 documentId 复核）→ 纯函数召回 → 组块）；`src/lib/cards.ts generateCards` 在 `situation_required=1` 时装配 `【用户记忆】`块进 user 消息（`memoryInjected/memoryBlockChars` 落 ai_gen_batches 留痕），**解析后逐卡校验 memoryRef**（命中=valid / 不命中=存疑）；`memoryRef`/`memoryRefValid` 随 CardDraft 经 per-blank 拆卡保留。⑤ **溯源落库** ✅——`cards.memory_ref_json`（ALTER；{line, verified}）；`createAcceptedCard` 落库：校验成功={line, verified:true}，失败但用户仍接受={line, verified:false}（浏览页标「来源存疑」），未用记忆=null。⑥ **UI** ✅——制卡确认面板轻标记：「情境来自记忆」（lint-info，悬停看逐字引用行）/「情境来源存疑」（lint-warn，**接受按钮需二次点击确认**＝「默认不勾选」语义，不阻断整批）；CardBrowser 工具栏「记忆接地」筛选按钮 + 行详情显示所引记忆行与校验状态（verified=false 标「来源可能已变更」）；设置页 sec-memory 注入预算可调（`settings.app.memory.injectBudget` 默认 4400 字，core/目录/主题按 800/1200/2400 配比缩放，§6.7.1）。⑦ **测试** ✅——`tests/m14.test.cjs` 扩至 **78 断言**（M14-13 v7 播种与 situation_required 矩阵 / M14-14 memoryRetrieve 纯函数矩阵 / M14-15 memory_ref_json 落库回读 + 本书域分布查询）；m1.test 85（M1-12 升 v7 基线断言）+ m1.prompts 22（P1/P2/P4 全线升 v7：全新库播种、存量 v6→v7 补播路径、situation_required 矩阵、R20 契约抽查）；回归 m8 65 / m12 42 / k1 42 / k2a 39 / k2b 48 / m8b 35 / persist 14 / undo 29 / m5 34 / m7 84 / backup 33 / FSRS L2 db 23 / m14.gui 18 / m8.gui 40 / m12.gui 24 / k2b.gui 9 全绿；tsc 0；dist 重建；cards bundle（m1/m5/m12）重打包。**本批不触 FSRS 调度字段（memory_ref_json 与 situation_required 均为旁路字段，§7.3 声明）**。**人工冒烟待做**：真实 Key 下开启记忆 → 选区制卡验证情境接地质量（memoryRef 是否可信、宁缺毋滥是否成立），调优走 prompt-lab 闭环；**M14 全部收口**。

> **回滚注记（2026-09-18，用户决定）**：v47 曾按本节契约实现四阶段管线（内核 getSectionText 取文 + material-difficulty 逐章抽取 + diagram-generation 聚合/图示 + 本地校验 + 全屏工作区 UI，完整快照存 `docs/m15-archive/`），但**真实生成质量不达用户预期**（主干结构空洞、SVG 图示观感差、长 SVG 成功率低），经用户决定整体回滚至 M15 之前状态；期间沉淀的通用决策保留在案：① **质量高于成本**（取消一切丢原文的字数截断，预览步实测 Token）；② **全屏工作区 + 右侧边栏**的交互形态（工具栏「导图/正文」切换）；③ 分片缓存「提示词版本失效重补」模式；④ diagram-design（MIT，cathrynlavery/diagram-design）风格要点与纯本地红线（禁外链字体）。重做须先按用户新设计（需求全文已整理至 `docs/导图功能设计需求-给ChatGPT.md`，2026-09-18）重定提示词与管线，再走 prompt-lab 验证。

### M15 — 材料知识导图 Material Mind Map 重做（v44 定契约 D40；v47 曾实现并于 2026-09-18 整体回滚；**v48 重设计定稿 D41/D42——§4.19 v48 全节重写为唯一实现依据**；位置：M14 之后，可与 K3 并行）

> **构想来源（用户 2026-09-17，保留）**：手动制卡缺整书视野 + 推荐需材料级覆盖数据。四项拍板：① 导图（作者视角）与知识图谱（大脑画像）**独立并行、允许联结**；② 整书 / 各章 / 更小结构范围 + 生成前选覆盖粒度（费用可预期）；③ 阅读器目录按钮旁「导图」按钮，按需生成、随时回看；④ **质量优先于成本**。
> **v48 重设计（2026-09-18，用户批准）**：ChatGPT 65-Task 执行方案 + A–H 补充约束经代码库现状审查后并入（D41/D42）；**「知识点候选」中间表示与「AI 生成 SVG」正式废弃**；实现按下列 8 批推进，每批测试全绿 + 全回归后才进下一批；依赖真实模型的语义质量冒烟与用户一起做（批 7）。用户同日拍板：语义审查 FAIL 后确认再重跑；动工前提交基线（已执行，7111a09）。

**目标**：为每份材料建立作者视角的知识导图（独立产物），打通「导图 → 制卡 → 学习证据 → 知识图谱」联结，并为制卡提供整书结构摘要（解决选区制卡缺整书把握）。

**内容（批次 0–7）**：
0. **批 0 文档（✅ 本批完成）**：§4.19 v48 全节重写；决策日志补录 D40、新增 D41/D42、多处重复行去重与错号行修正；§9.2 M15 矛盾重复行合并、§9.5 口径更新。
1. **批 1 数据与提取层**：内核 `getSectionText` 恢复（kernel + foliate/pdf adapter，reader.kernel/pdf.kernel 增补测试）；`material_maps / material_map_shards / material_map_runs` 三表 + 仓储函数；TOC → 提取单元树 / 文档线性化 / parentOwnedText 区间集合差（禁字符串减法）/ 段落分片 / 文本 hash；证据匹配器（0/1/多命中裁决 + quoteHash + matchStart/End）；校验器纯函数（§4.19-6 全清单）。
2. **批 2 AI 管线**：`material-map-section / merge / global / editorial` 四 scope 播种 v1（prompt-lab 可后续调优）；主进程编排引擎（ctx.chat 可注入，memoryTidy 先例）：自底向上递归归并、分片缓存（含 provider+model+modelConfigHash）、增量重生成（变化单元 + 祖先链）、失败状态机、JSON 一次格式修复、取消（ai.js 增 usage 捕获/AbortController/机读错误码，全应用受益）、AI 语义审查（确认制 + repair 一次上限，issues 机读）、重生成 remap。
3. **批 3 渲染与交互**：确定性 tidy tree 布局 + SVG 渲染器 + 主题 token 化 + 图标（现有内联优先 / Lucide path 本地内嵌）；全屏 Overlay 工作区（顶栏 导图/正文、画布、右侧边栏）；缩放/平移/fit/展开/收起/选中/focus；语义缩放 7/12/24；节点详情侧栏；空态/无 Key/加载骨架（禁假进度）；自包含 SVG 导出；本地搜索。
4. **批 4 成本与生成 UX**：范围选择器（本地 TOC 子树）+ 粒度三档；**发送前预览与实际发送同一 payload builder**（材料/范围/覆盖/缓存命中/预计调用/字数精确/Token 估算/费用）；重新生成先预览再确认；版本保留 + active 切换（失败不丢旧图）。
5. **批 5 学习链路**：节点「就此制卡」→ 既有 createAcceptedCard（materialMapContext 有界 ≤1200 字、siblingKey=act:mindmap-<nodeId>、context_ref.mindmapNodeId 溯源、卡片永不改写）；学习状态只读（已有 N 卡 / KP 已存在，沿 remap 链解析）；evidence 跳正文（goTo 单元锚 + quote 高亮 best-effort）。
6. **批 6 收尾**：键盘可达（Tab/Enter/Space/方向键 + 焦点环）；动效（--ease/--dur + prefers-reduced-motion）；大图性能（折叠子树不参与布局）；质量指标本地统计（不进用户 UI）；黄金 fixtures 落 tests。
7. **批 7 验收**：最终审计 grep（SVG 来源 / 外链 / 写图谱与 FSRS / 阴影渐变 / 小字号 / 裸 hex）；真实 Key 端到端冒烟（与用户一起）；DoD 核对（§4.19 v48 十二条 + A–H 逐条）。

**测试**：批 1 新增 `tests/m15r.*`（node 直跑：提取单元 / 线性化 / 区间差 / 证据裁决 / 校验器矩阵）+ 内核增补入 reader.kernel / pdf.kernel；批 2 `tests/m15r.engine`（electron 隔离库，fake-chat 全管线：生成/缓存/增量/超时/坏 JSON/假证据/取消/审查 FAIL 停/remap）；批 3 布局确定性 ×100 + SVG snapshot + `tests/m15r.gui.mjs`（CDP）；批 4/5 GUI 增补；每批全回归。

**Non-Goals**：导图不自动生成（用户主动触发）；导图结构不写知识图谱、不产 mastery 证据、不作推荐/调度输入；「知识点候选」中间表示与「AI 生成 SVG」不得回潮；首版只做水平层级树布局（不做多布局引擎）；不做导图协同编辑；推送/分享不做；不引 CDN 资源。

**v48.11–v48.13 增量批（实施中，D44/D45）**：
- **v48.11（✅）** 深挖作用域修复：`sourceSpans`（全文 UTF-16 一维多区间坐标）与 `unitAnchors`（证据定位/remap）分离；残余覆盖账 + 补漏作业；run 级统一预算 + 降级阶梯；`material_map_calls` 账本真源 + 启动僵尸对账；`section_ready` 阶段化 + 同 runId 续跑；并发阶梯与失败隔离。
- **v48.12（✅）** 覆盖审计（`runCoverageAudit`）+ 兄弟 span 细分 + 批量深挖（架构 B）+ 有界递归（架构 C）；三口径覆盖指标（`evidenceTextCoverage`/`structureCoverage`/`structuralResidual`）。
- **v48.13 P1（✅ 本批，D45）** **正确性修复**：① 评审闸门改为**严重度**唯一硬闸门（`type` 只是描述标签；模型 `status=fail`+issue 单向棘轮仍阻断）；非阻断意见留痕 `metrics.reviewStatus/reviewIssues`；② **Published/Candidate 发布模型**——首层候选不得顶掉已发布版本，续跑完成才事务性发布（修「85 节点成品被 10 节点中间态顶掉」现场）。
- **v48.13 P2（✅ 本批，D45）** **后台可见性**：广播契约自足（`documentId`/`title` 全量 + 终态失败/待确认也广播）；新增右下角**全局后台活动指示器**（收起态极小、hover/键盘 focus 展开、完成态「导图已更新」点击直接打开导图、取消只能显式点击）；Reader/App 增加由指示器直达导图的入口。
- **v48.13 P5（✅ 本批，D48）** 真实运行审计修复（用户实测「优绩主义」重新生成后追问）：①「已取消」误显真根因＝引擎子事件被当阶段用（状态归一白名单 + 未知事件不编造）；② 已发布版本不因一次失败而消失（partial 也保持发布，降级由 completeness 留痕）；③ 同材料串行化守卫（防并发写同一行地图）；④ **首层就绪后不再自动深挖整树**——改为侧栏显式「自动深挖全部（约 N 次调用）」，按需深化成为默认；⑤ 指示器点「打开导图」后消失（非运行中）。
- **v48.13 P3（✅ 本批，D47）** 应用重启续跑：启动对账 → `interrupted`（**不得把正常退出等价于任务失败**）+ `listResumableMaterialMapRuns()`（interrupted + section_ready，带材料标题）+ `mindmap:pendingRuns` IPC + 渲染层启动播种指示器 + 点击携带 `resumeRunId` 同 runId 续跑（缓存命中、零重复计费）；首层就绪不自动续跑（按需深化由用户点节点决定）；只有正在跑的任务才给「取消」入口。
- **v48.13 P4（✅ 本批，D46）** 展开与深化分家 + 增量深化 + **增量评审**：深化＝以已存地图为基底的作用域受限 generate（不重建/不跑 merge·global·editorial/不补漏），一次深化 = 目标分片深挖 + 1 次增量评审；评审只覆盖新增分支 + 必要上下文，**单分支失败不连坐整图**；原地更新同一版本行且不改发布关系；UI 三处区分「没画出来」与「没有更深内容」（＋号徽标 / 深化按钮 / 终态说明）。已知代价：深挖指纹含 depth → 首层图与整图的深挖缓存不跨路径复用（特征化测试锁定）。
- **本轮纪律（D45）**：不新增自动成本——不重新引入无限递归展开、不为 coverage 自动补全所有残余、不在用户未要求时做全深度展开。

**验收标准**（注：其中「选范围与粒度」两条入口已在 v48.5/v48.6 撤销——范围恒为整份材料、粒度恒为 detailed；**当前入口与运行口径以 §4.19 v48.13 收口块为准**）：按 §4.19 v48 十二条逐项，并落实：① 选范围与粒度后生成，画布出现导图且可回看、「正文」返回原位；② 重复生成只补缺失/失效分片（缓存断言，含换模型不复用）；③ 编造证据 / 孤儿 / 成环被本地校验拒绝渲染；④ 语义审查 FAIL 停在确认、确认后仅重跑对应阶段、一次上限、旧图始终保留；⑤ 节点制卡走确认面板 + CardLint，卡片可溯源到导图节点，重生成后沿 remap 解析；⑥ 无 Key 可读降级（生成禁用 + 说明，不弹错误）；⑦ 备份/恢复含三表（整库自动覆盖）；⑧ 取消/失败后旧图与缓存分片保留；⑨ 本批不触 FSRS 调度字段、零写 `knowledge_*`。

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

调研 Obsidian / Logseq 的界面自定义实现（主题格式、CSS 注入、可调项声明），借鉴到本软件：允许用户自定义界面主题，并留出将自定义主题上传到社区主题库的渠道。压轴原因：依赖插件/主题宿主（§4.15，未实现）落地，且主题社区需服务端，与「纯本地优先」的边界届时单独决策。

## 9.2 主线状态表

| 批次 | 内容 | 状态 |
|---|---|---|
| R1 | 阅读内核（一切皆书 + 防腐层 + CFI + 目录/模式/外观） | ✅ v20 实现（L1 38 项 + L2 11 项断言全绿；CJK ruby/竖排夹具通过） |
| R2 | 高亮标注 | ❌ |
| R3 | 阅读个性化完善 | ❌ |
| R4 | PDF + Word/TXT/MOBI（合流 M6） | ✅ 主体由 M6 交付（PDF 原生阅读 / Word / TXT / MOBI 直读，见 M6 行）；**剩余 Range 流式按需加载与扫描版 OCR 留 §9.4 可选池** |
| M1 | AI 制卡体系升级（四卡形式/材料路由/提示词测试台/覆盖核对） | ✅ v15 实现，v16 修订（D18 两张独立卡）；✅ **v31 提示词基线确认并回**（v4 候选→播种 v6：取消 G9、G6/G7 完善、CardLint L16 落地（L-A 数字密度同日取消、L-B 不做）、文学专用模板接上）；映射表最终确认待用户 |
| M2 | 数据备份与恢复（手动 + 自动滚动 + 恢复保护） | ✅ v18 实现（手动/自动/恢复全链路 + CDP 端到端验证） |
| M3 | FSRS 时间轴模拟验证 | ✅ v20 实现（L5 仿真层 + 官方做法审计 + F7/F8 修复）；✅ v23 加固增补（时间语义统一/参数环境/原子提交/Undo 不变量，F9-F11 修复） |
| M4 | 快捷键 + 自定义 | ✅ v21 实现（CommandRegistry 落地 + 阅读四键/复习键 + 设置页冲突检测与恢复默认）；v22 增补撤销评分（Z） |
| M5 | 手动制卡优化（类型选择/领域标签/流程对齐）+ 正文图片点选聚焦与形状选区 | ✅ v25 实现（四类型页签 + UdcPicker + 字段对齐 AI + CardLint/S1；点选聚焦三类选区 AI/手动提交；F12 填空题挖空落库修复） |
| M6 | 导入格式扩展（拆批：M6-1 Word/TXT/MD → M6-2 PDF 纯文本 → M6-3 HTML+调研收尾；Anki 不做） | ✅ M6-1 v26（Word/TXT/MD）+ ✅ M6-2 v28（PDF 原生阅读）+ ✅ **M6-3 v30a（HTML 导入 + MOBI/AZW3/FB2/CBZ 被动兼容启用）——M6 批次全部收口** |
| v29 | 体验修复批（Markdown 噪音清理 / PDF 缩放 / 选区菜单一击消失 / **D26 AI 图片制卡内容感知升级**） | ✅ v29 实现 |
| v30b | 复习卡面修复批（**D27** 一卡多挖空同答/分答两形态 + **D28** 看图问答卡背面题面定版 + 遮挡块颜色统一 + **D29** 归属锚强制，提示词播种 v4/v5） | ✅ v30b 实现 |
| v31 | M1 提示词基线确认并回（v4 候选并回播种 **v6**：取消 **G9** 退出红线 + G6/G7 完善 + CardLint **L16**（L-A 数字密度同日取消、L-B 不做）+ card-literature 专用模板接上，修复死代码） | ✅ v31 实现 |
| v30 | 复习卡面修复批（**D27** 一卡多挖空同答/分答两形态 + **D28** 看图问答卡背面题面定版 + 遮挡块颜色统一 + **D29** 归属锚强制，提示词播种 v4/v5） | ✅ v30 实现 |
| M7 | 词典（DictionaryProvider 可插拔：Manager→Provider[]→Entry+Context→快照卡；在线 Free API/Jisho + 本地 StarDict/DSL/ECDICT；设置一键下载） | ✅ v32 实现 |
| M8 | 日记与 AI 洞察（流式日记 + 洞察按钮 + AI 关联分析，第二输入通道） | ❌ |
| M9 | 在线功能（数据收集/反馈/更新/多提供商/API 分发） | ❌ |
| M10 | 官网 | ❌ |
| M11 | 界面自定义 + 主题社区 | ❌ |
| K0–K9 | Learner Knowledge Model（v24 架构定稿，纯文档；实现按 §9.1 M8 实施路线 K0–K9 分批） | 📐 v24 定稿（§4.5–§4.13 + §6.3.11–12 + §7.6 + D24）+ **v33 增补（§4.14 结构连接 + §6.3.11 `structure-analogy` + §6.3.12 K9–K10 + D32）**；实现未启动（K0–K9 见 §9.1 M8） |
| M13 | 成长反馈 Growth Feedback（呈现层只读；正反馈分级总表；微反馈 + 会话成果汇总 + 仪表盘四层 + Territory；内部 GF-1 记忆层 → GF-2 知识层） | ❌ v39 定契约（§4.17 + §6.6 + D36），实现未启动（**排在 M8-B 与 K0–K9 之后**，用户 2026-09-15 拍板） |
| M14 | 用户记忆 User Memory（AI 自主维护的**分层记忆文件**：`core.md` + `index.md` + `topics/<生活域>/<主题>.md`；日记增量整理；**总量不限、永不淘汰、不做衰减**；制卡按需检索接地——R20 + `memoryRef`；**§1.7 有界例外 + 六护栏**；开关默认关闭、重开后**补处理**关闭期间日记；内部 UM-1 记忆文件与整理管线 → UM-2 接地与检索） | ✅ **v45 UM-1 + v46 UM-2 全部实现**（UM-1：文件树 + memoryTidy 整理管线 + memory_runs + user-memory v1 播种 + sec-memory + M2 备份覆盖 memory/；UM-2：R20 situationRequired 声明位 + memoryRetrieve 宽召回 + 制卡族 v7 + memoryRef 校验与溯源 + 确认面板徽标/二次确认 + 浏览页筛选；完成情况见 §9.1 M14 两 blockquote） |
| M15 | 材料知识导图 Material Mind Map（导图=作者视角独立产物、知识图谱=大脑画像，两图独立并行+联结；全屏 Overlay 工作区 + 自底向上递归归并管线 + 区间集合差取文 + 双证据本地校验 + AI 语义审查确认制 + 分片缓存含模型三元组 + 节点制卡联结与 remap；**质量优先于成本**；**位置 M14 之后、可与 K3 并行**） | 📐 **v48 重设计定稿**（D40 补录 + D41/D42，§4.19 v48 全节重写，批次 0–7 见 §9.1 M15）；v47 曾实现已于 2026-09-18 整体回滚（生成质量不达用户预期，快照存 docs/m15-archive/） |

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
| 对比卡候选语义检索召回 | —（v30 D29 待办） | **触发条件**：卡片库总量超过 500 条、或同主领域候选在 buildContrastCandidates 中实际发生截断、或「同域优先排序」被实测证伪（易混卡未被召回）。**方案**：引入向量相似（本地 embedding 或 GLM embedding 接口，按库规模二选一）替代「同主领域优先 + 全量低截断」做候选召回，召回结果仍走现有 `generateContrastDrafts` 装配与 `ContrastCardModal` 确认框（上游契约不变）；同一向量索引未来可复用于 S1 相似检索（替代 n-gram 词面相似）与 R10 生成时干扰提醒。**现状**（v30）：同域优先 + cap500 + 文本去重 + 逐条 50 字，个人库多年规模下近似全覆盖 |
| 手动遮挡编辑器 | 16 | **仅剩「整图手动遮挡编辑器」与「既有卡片的遮挡区域编辑器」**；v25 起「为创建卡片而手绘区域」已实现（D25：正文图片点选聚焦 + 三类形状选区） |
| 每日上限 / 全局混编 / 「不再关心」 | — | §6.3.8 规划项；每日上限的「学习日」口径已具备（v23 settings.app.dayCutoffHour） |
| epub.js 兜底 adapter | — | foliate-js 不可用时的 Kernel 第二实现预案（epub.js 维护停滞，仅应急）； foliate pdf 模块（R4 验证，Anx Reader 已生产验证但上游标 experimental） |
| better-sqlite3 迁移 | 技术债 | sql.js 全量回写，数据量显著增长后迁移（接口已对齐） |
| electron-builder 打包 | 技术债 | 未配置，无安装包 |
| 历史数据兼容 | 技术债 | v11 前卡片 fsrs_json 无 S/D（基线回填）；存量 cloze 卡 hint 拆答案（渲染层已兼容）；存量摘录/部分卡片无锚点（降级上次阅读位置）；存量遮挡卡无 shapes（渲染层按 rects 矩形降级，v25） |
| 粘贴书合成 EPUB 的空首章 | 技术债 | markdown 以一级标题开头时，`splitMarkdownChapters` 会先压入一个空章（正文为空），阅读器首屏为空白页且目录多一项（L2 测试 toc=4 即此现象）。修复会改变合成结构 → 存量粘贴书已存 CFI 失效（§7.1.11 表述红线），须随 `SYNTH_GENERATOR_VERSION` 升级一并处理（届时走锚点降级链：章节索引+anchorText→全文搜索） |
| 成长反馈延后项 | —（v39 M13） | **① Momentum 完整版**（动能视图：7/28 天窗口、纯描述、无褒贬色，§4.17-8）；**② 成长记录导出**（Markdown / JSON）；**③ 自定义成长目标 / 用户自设事件**；**④ 里程碑分享**。以上均**未经用户提出**，不得自行领取 |
| 记忆语义检索（向量召回） | —（v42 M14 Non-Goal） | **现状**（UM-2 v1）：Stage A 只做本地宽召回（书名/章节/正文词面 + 书侧 UDC → 生活域映射）+ 目录恒定注入兜底。**触发条件**：实测出现「材料主题明确相关、但词面与领域映射均未命中主题」的漏召回，或主题文件数增长到目录检索开始失准。**方案**：为 `topics/*` 条目建本地嵌入索引（`bge-small-zh-v1.5` ONNX int8 约 23.9 MB / 512 维，中文检索 C-MTEB 61.77，经 transformers.js 在 Electron 内离线运行；或复用用户自己的 embedding 接口）作 Stage A 的增强通道——**同一索引可复用于 S1 相似检索与 R10 生成时干扰提醒**（与「对比卡候选语义检索召回」共建）。**不改变** §4.18 的其余契约（注入预算 / 拒用铁律 / 溯源） |
| 记忆图谱可视化 | —（Hermes `journey` / Memory Graph 式） | 把 `memory/` 的文件树与条目渲染成可交互图谱（按生活域 / 主题 / 时期聚类，可点开所引日记），复用 §4.10 的 2D 图能力。**未经用户提出，不得自行领取** |
| 记忆时间轴与时期视图 | —（v42 M14 Non-Goal） | `topics/` 按主题存、时间作条目标签（§4.18-4）。本项是**只读视图**：把全部条目按日期与时期（AI 维护的 life chapters）铺成时间轴供回看；纯呈现、零新事实、不进统计 |
| 记忆→直接播种制卡 | —（v42 M14 Non-Goal） | 反向路径：由记忆条目**直接**产出应用卡（「你反复遇到的这个处境 ↔ 某个已学 KP」），不依赖用户先在阅读器选中材料。**风险**：脱离材料出卡会绕过 R1（不理解不学）与来源锚定，须**先改 §4.18 与 R20** 再实现 |
| 记忆的情绪/状态标注细化 | —（v42 M14 v1 简化） | v1 用少量情绪词（§4.18-4）。若需细化：PANAS / PANAS-X 按条目标注过重（20–60 项），**推荐** valence（7 档）+ arousal（0–3）+ 至多 3 个 GoEmotions 标签（约 10–20 输出 token/条；出处见附录C） |
| 记忆导出与分享 | —（v42 M14 Non-Goal） | 导出 Markdown / JSON（文件本身可复制，故优先级低）；**分享**须先解决隐私问题（记忆含个人生活细节）。**未经用户提出，不得自行领取** |
| 用户画像接线（`context.userProfile`） | —（v42 §4.18-14） | `src/lib/cards.ts` 的画像注入槽（「用户画像（R9 个性化例子优先用）」）至今无调用方。画像语义＝泛化偏好（R9「优先用」、无拒用纪律），与记忆不同；若要接线须**先改本文档**并写清与记忆的边界（同为「你的东西」的两个槽不得互相覆盖） |

## 9.5 下一步

M6-1 已于 v26 实现完毕（Word（.docx 含内嵌图）/ TXT / Markdown 导入，合成管线图片能力 syn-2，见 §9.1 M6）。M6-2 v27 提纯方案已验证不可行并废弃为备用工具（用户实测版面丢失）。M6-2 已于 v28 修订完毕（PDF 原生阅读：pdf.js 直读原文件 + 页码锚点，见 §9.1 M6；存量 PDF 书不迁移，用户手动删除）。**M6-3 已于 v30a 实现完毕（HTML 文件导入 + MOBI/AZW3/FB2/CBZ 被动兼容启用，见 §9.1 M6-3）——M6 导入格式扩展批次全部收口**。**M1 已于 v31 收尾**（v4 候选经用户确认并回播种 v6、取消 G9、G6/G7 完善、CardLint L16 落地——L-A 数字密度同日取消、L-B 不做、文学专用模板接上；见 §9.1 M1 与 §8.3 v31），M1 剩余仅材料类型映射表的最终确认（待用户）。**M7 已于 v32 实现完毕**（DictionaryProvider 可插拔架构：Manager→Provider[]→Entry+Context→快照卡；在线 Free Dictionary API/Jisho + 本地 StarDict/DSL/ECDICT；设置 `sec-dict` 一键下载；card-vocab 播种 v1；见 §9.1 M7）。**M12 已于 v34 实现完毕**（同源卡延后 Sibling Burying：同一制卡来源单元的多张卡同一学习日只放行一张、其余延至次日；**延后是队列视图不写 FSRS**——不改 due、不写 fsrs_json、不产生 review_logs；统计与队列口径统一于 `computeTodayQueue`；测试 m12.test 42 + m12.gui 24 + 重启冒烟全绿，见 §9.1 M12）。**K1 知识地基与 M8-B AI 洞察已于 v40 实现完毕**（D37：K1 先行——四表 + 归一合并可回滚 + 生命周期 + `prerequisite` 无环校验 + 旧字段迁移提案；M8-B 直接消费真实 K1——洞察按钮 + Evidence Package 禁全库直发 + `insight_runs` + 三级证据 + 竞争解释 + 反馈 + 就此制卡 + Personal Meaning 候选独立表；测试 k1.test 40 + k1.gui 16 + m8b.test 35 + m8b.gui 13，回归全绿，见 §9.1 K1 / M8-B 完成情况）。**K2-A AI 抽取归一与关系已于 v41 实现完毕**（D38：三层确定性架构——本地规范化收敛 → AI 封闭契约提案 → 本地裁决器；批次簇键解绑跨书 kp1 碰撞；幂等指纹「同输入重复跑零新增、已拒绝永不重提」；触发＝制卡顺带 + 手动批量「AI 整理」；确认＝提案制 + 一键全接受；`knowledge-extraction` / `knowledge-relation` 两 scope 播种 v1；测试 k2a.test 39 + k2a.gui 8，回归全绿，见 §9.1 K2-A 完成情况）。**K2-B 已于 v43 实现完毕**（余下 4 scope（material-difficulty / knowledge-probe / frontier-explain / structure-analogy）播种 v1 + 出层契约校验 `electron/kpScopes.js` + KnowledgeLint K4/K7/K8 报告型检查 + prompt-lab ×N 离散度守门；测试 k2b.test 48 + k2b.gui 9，回归全绿，见 §9.1 K2-B 完成情况）。接下来按 **M14（用户记忆）→ M15（材料知识导图，可与 K3 并行）→ K3–K9** 推进（**实施路线已并入 M8**；见 §9.1 M8 与 §4.14；**K3 起探针卡生命周期按 v44 修订契约执行**——前沿探索开关 + 免预确认混队 + 背面揭示 + 质量评判 + 一次性证据（接受转普通卡正常 FSRS、不接受退役），见 §4.7 v44 blockquote；制卡记忆接地按 R20 v44 原则制执行，见 §4.18-9）。**M14 用户记忆已于 v42 定契约**（§4.18 + §6.7 + D39），排在 **K2-B 之后、K3 之前**（用户 2026-09-15 拍板）——它只依赖已完成的 M8-A 日记 / K1 知识地基 / 制卡管线，把日记里的**真实处境**接进应用卡的情境（R20），实现按 **UM-1 记忆文件与整理管线 → UM-2 接地与检索** 分批推进。**UM-1 已于 v45 实现完毕**（memory/ 文件树真源 + applyOps 不删不改写 + memoryTidy 整理管线（摄入/整理/防抖/补处理）+ memory_runs 留痕 + user-memory v1 播种 + sec-memory 设置区 + M2 备份覆盖 memory/；测试 m14.test 58 + m14.gui 18，回归全绿，见 §9.1 M14 UM-1 完成情况）；**UM-2 已于 v46 实现完毕**（R20 原则制 situationRequired 声明位 + memoryRetrieve 宽召回 + 制卡族 v7 + memoryRef 校验与溯源 + 确认面板徽标与浏览页筛选，M14 全部收口；见 §9.1 M14 UM-2 完成情况）。**下一批 M15 材料知识导图重做（v48 重设计已定稿 D41/D42，批次 0 文档批已完成、批 1 数据与提取层待启动；可与 K3 并行，批次划分解英 §9.1 M15）**。**M8-A 已于 v36 实现完毕**（日记与快速记录：`journal_entries` 自然日口径 + 日记页流式时间线 + 全局快捷键 `Ctrl+Alt+Space` 捕获窗口（草稿-发送协议、输入即落库）＋ `Ctrl+Alt+N` 就地呼出「添加书籍」模态；规格 §6.5 / 决策 D34；测试 m8.test + m8.gui，回归全绿，见 §9.1 M8-A）。**M7 已于 v38 追记收口查词语言路由**（决策 D35：纯汉字串消歧五级链＝面板手动切换 > 词内假名 > 句中假名 > 书籍语言属性 > 字面正则；`dict_sources.lang` 来源语言列与本地命中语言优先；`library_items.lang` 书籍语言属性（添加书籍下拉 + 书架卡片设置）；DictPanel 语言切换 chips；下载目录新增 jamdict-cn 与 kaikki zhwiktionary 日语卷两部日→中词典——JMdict 官方无中文版，此二为唯一可自由再分发来源；测试 m7.test 84 + m7.gui 10 + e2e 7+4，全回归绿，见 §9.1 M7）。提示词调优闭环随时可由用户启动（打开 `prompt-lab/` 测试台 → AI 改提示词 → 手动实测 → 反馈 → 决定是否并回）。**成长反馈（M13）已于 v39 定契约**（§4.17 呈现层只读 + §6.6 产品规格与正反馈分级总表 + D36），**未实现**——整批排在 M8-B 与 K0–K9 之后（成长反馈消费 K 系列产出的知识模型 / 算法 / Frontier 数据，用户 2026-09-15 拍板）。

---

## 附录A — 参考项目网址（锁定）

- Bili.Copilot：https://github.com/Richasy/Bili.Copilot
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

## 附录C — 用户记忆分层与分类依据（v42 调研）

> 本附录是 **§4.18 与 D39 的选型依据留痕**，避免未来实现者把「为什么这样分层、为什么按主题切」当成拍脑袋。全部条目为 2026-09-15 会话内检索所得；凡属本研究推得的结论一律标「推论」。**使用警告**：部分条目来自二手摘要（百科 / PMC / 厂商文档），实现批若要把某项当作硬依据，**先复核原文**。

### C.1 自传体记忆的组织与长程保持（⇒ 条目不衰减、分三级、时期作标签）

- **三级结构**（Conway & Pleydell-Pearce 2000；Conway 2005, *Journal of Memory and Language*）：**人生时期**（lifetime periods，带主题、边界模糊可重叠的时间段）→ **一般事件**（general events，反复事件与相关序列，按主题聚类、围绕目标达成或失败；「首次达成」尤其鲜明）→ **事件细节**（event-specific knowledge，单次的视觉/感官细节，**衰减快**，但起源性、转折性、锚定性事件抗衰减）。线索机制：时期知识提示一般事件、一般事件唤起细节——**时间与主题是同一层级的两个坐标，不是二选一**。⇒ 本设计取「事件 / 处境 / 事实」三级 + 时期作可选标签（§4.18-4）。
- **长程保持不是指数衰减**：Rubin & Wenzel 1996（*Psychological Review*, "One hundred years of forgetting"）表明长间隔保持更接近**幂函数**，遗忘曲线式简单方程不能很好拟合实测数据（Rubin, Hinton & Wenzel 1999）。⇒ **不做基于新近度的淘汰**（§4.18-3）。
- **身份相关记忆长期更凸显**：self-defining memories（情感强烈、定义「我是谁」）被评为更具体、更具身份相关性；回忆高峰文献（Berntsen & Rubin 的文化人生脚本；Thomsen & Berntsen 2008）显示重要事件集中于 15–25 岁。⇒ 支持用户「越久远的记忆越珍贵」的判断（§4.18 来源段）。
- **情感会随时间改变**（fading affect bias，Walker & Skowronski 2009）：留下的是「当时的感受」而非「现在的感受」。⇒ 情绪标注必须随条目带日期（§4.18-4）。

### C.2 生活域封闭分类的出处（⇒ §4.18-5 的 8 + 其他）

逐项对应（**并集收敛**，非自创，也未逐字照搬任一量表）：

| 生活域 | 来源 |
| --- | --- |
| 健康与作息 | WHOQOL 域 Physical / Level of Independence 及其 facets（疼痛与不适、精力与疲劳、睡眠与休息、行动能力、日常活动、工作能力）；个人幸福指数（PWI）域「健康」 |
| 情绪与状态 | WHOQOL 域 Psychological（positive / negative feelings、self-esteem、cognitions、body image） |
| 人际与家庭 | WHOQOL 域 Social Relationships（personal relationships、social support、sexual activity）；PWI「personal relationships」；DISE 压力类别 interpersonal tensions、network stressors |
| 工作与学业 | DISE 的 work/education stressors；WHOQOL facet Work capacity；iSAHIB 的 being evaluated / work-education |
| 财务与生活 | WHOQOL 域 Environmental（financial resources、home environment、physical safety and security）；PWI「standard of living」「personal security」；DISE finances / home |
| 兴趣与见闻 | WHOQOL facets recreation and leisure、new information or skills；日重建法（DRM）活动清单与 ATUS 一级类目中的休闲与社交活动 |
| 成长与目标 | PWI「what you have achieved in life」「future security」；PERMA 的 Accomplishment / Meaning；SMS 的「working self ＝ 目标层级」 |
| 观念与价值 | WHOQOL 域 Spirituality / Religion / Personal Beliefs；Schwartz 基本价值观十项（self-direction、universalism、benevolence 等） |
| 其他 | 兜底（不映射到书侧领域） |

### C.3 为什么按主题切文件、时间只作标签（⇒ §4.18-3 / §4.18-7）

- **导航远多于搜索（PIM 实证）**：Bergman 等 2008（*ACM TOIS*）——用户 **56–68%** 的文件检索靠导航，仅 **4–15%** 靠搜索；**搜索质量提高并不减少对层级归档的依赖**（搜索只是「想不起位置时」的兜底）。
- **Logseq / Obsidian 实践**：日志页采集、主题页归档（「把记录阶段与整理阶段分开」）；社区同时长期抱怨纯日更文件的堆积（「日文件夹里已有 300 个文件」）。⇒ 采集可按天，**存储必须按主题**。
- **纯 AI 自创分类不能当存储键**：folksonomy 的稳定性来自大规模人群共享标签（Golder & Huberman 2006），单人自创标签会漂移（同一主题在不同时期不同名）。⇒ **封闭顶层 + AI 子层**（§4.18-5）。

### C.4 分级存储与「索引恒定注入 + 内容按需读」（⇒ §4.18-3 / -7 / -8）

- **MemGPT**（arXiv:2310.08560）：主上下文三段（系统指令 / **固定大小的可读写工作上下文** / FIFO 队列）；以模型上下文窗口比例定义压力（约 70% 告警、100% 触发驱逐、驱逐约 50% 并重生成递归摘要）；归档存储为任意长度文本库、由模型**函数调用**检索（其实验用 PostgreSQL + pgvector / HNSW / 余弦相似，并用**分页**防止检索结果撑爆上下文）。**要点：无限外部存储 + 有界上下文块。**
- **Letta MemFS**：记忆是 git 仓库式 Markdown 文件树，`system/` 下文件每轮进系统提示，**「文件树本身始终在提示词里」充当路标（signposts）**，其余内容用普通文件工具按需读取；`/doctor` 审计「放置、重复、系统提示 token 占用」，重整前先备份；Dreaming 后台子代理按步数（示例 25 步）或上下文压缩触发做合并与提炼。**没有语义/向量索引，靠文件工具定位**。
- **Claude Code 自动记忆**：`MEMORY.md` 索引**只加载前 200 行或 25 KB**（先到者为准）+ 一主题一文件、**按需读取**；接近上限时提醒模型「一行一条、把细节移入主题文件、合并或删除过期条目」，**超限写入报错并要求重写索引**（超出部分下次加载即被丢弃）；`modified` 时间戳用于新鲜度判断；写作纪律「能从代码库推导的不记」「不要每次会话都记」。
- **本设计的取舍**：照抄「索引 + 按需读 + 硬预算」骨架，**去掉「装满删旧」**——总量不设限，只约束单次注入（§4.18-3）。

### C.5 注入多少条：候选与注入规模的实测锚点（⇒ §4.18-7 / -8 / -9）

- **Zep 的 50 组检索实验**：取 15 条事实 / 5 条摘要（默认档）≈ **756 token**，准确率 **77.06%**，完整性「上下文不足」**16.9%**；20/20（1,378 token）80.06%；30/30（1,997 token）80.32%——**20/20 之后收益趋平**。极低 k（5/2）时「上下文不足」高达 **23.8%**，说明「检索不到就什么都不给」是常见失败形态。⇒ 本设计：**候选宁多勿少、注入五到十条量级、目录恒定注入兜底**。
- **长上下文退化（Chroma "Context Rot"）**：18 个模型上性能**随输入长度一致退化**，「单个干扰项就会降低表现」；聚焦提示（平均约 300 token）显著优于全量提示（平均约 113k token）；**Claude 系模型幻觉率最低且常弃答**。⇒ 支持「控制注入量 + 把『没有相关的』做成合法答案」（R20 拒用铁律，§4.18-9）。
- **过度个性化 / 跨域泄漏有实测风险**（PersistBench：跨域样本中位失败率约 53%；OP-Bench 把过度个性化形式化为「无关性 / 重复 / 谄媚」）：记忆被无差别注入时模型会**过度关注**记忆。⇒ 本设计的三道对策：注入只发生在**记忆接地 scope**（§4.18-8）、用途被 R20 收窄到两个位点（§4.18-9）、**目录恒定注入使漏召回可观测**（§4.18-7）；若实测仍泄漏明显，按 §9.4「记忆语义检索」升级。

### C.6 检索方式与未来的向量通道（⇒ §4.18-7 现状 / §9.4 升级项）

- **词面 vs 稠密**：DPR（arXiv:2004.04906）在自然语言问答上比强 BM25 高 **9–19 个绝对点**（top-20 准确率）；BEIR（arXiv:2104.08663）结论是「**BM25 是稳健基线**」，重排类最强但成本高。⇒ v1 先用词面 + 领域映射（可测、零依赖），向量作增强通道。
- **离线嵌入可行性**：`bge-small-zh-v1.5`（BAAI）ONNX **int8 约 23.9 MB** / 512 维，中文 C-MTEB 平均 57.82、检索 61.77；`paraphrase-multilingual-MiniLM-L12-v2` int8 约 118 MB（50+ 语言）；transformers.js v3 支持 Node 侧 ONNX 推理。⇒ 数千条短文本的本地索引完全可行（索引自身约 10 MB 量级）。

### C.7 情绪标注方案（v1 简化 + 细化预案，⇒ §4.18-4 / §9.4）

- PANAS 20 项 / PANAS-X 60 项是问卷设计，不适合逐条归档；**GoEmotions 28 类**适合机器标注（BERT 级 F1 约 .46）；Plutchik 8 类 + 强度；Russell 两维（效价 / 唤醒）。
- ⇒ v1 用少量情绪词；若要细化，推荐 **valence（7 档）+ arousal（0–3）+ 至多 3 个 GoEmotions 标签**（约 10–20 输出 token/条）。

