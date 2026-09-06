# 一站式渐进阅读学习软件 — AI 开发指导文档（总纲，锁定版 v10）

> 本文档是后续所有开发的唯一依据。AI 在任何一次迭代中，必须严格按本文锁定的技术方案和接口实现，不得擅自更换技术栈、引入云端依赖、一次性做多个功能。
> 核心原则：**纯本地软件 / 最大灵活性 / 每次只实现一个最小单元 / 需求可变**。
>
> **v6 变更记录（AI 辅助制卡与助读体系）：** 依据《有效的学习：组织知识的 20 条原则》与知乎收藏夹《制卡原则与知识表述》（22 篇补充文献）重设计制卡与复习流程——新增第 8 章（AI 制卡主流程 / 制卡提示词锁定基线 / CardLint 质检 / AI 阅读助手 / Leech 六步处理 / 干扰检测 / 枚举序列背诵公式模式 / 问题-功能映射总表）；数据模型扩展 Card 并新增 CardIssue、AIGenBatch；接口新增 17-19；EventBus 新增 3 个事件；Phase 表新增 12-16。AI 制卡从此为**主路径**，手动制卡保留为基线与降级路径。
>
> **v7 变更记录（Topic 优先级与推迟调度）：** 新增 §9——确认摘录时手动优先级 + 默认优先级设置 + 负载感知推迟算法（科学化调度）的设计承诺；第一版固定 ×1.6 推迟为占位实现，按 §9 规格在 Phase 2.x 替换。
>
> **v8 变更记录（实现落地注记）：** Card 数据模型增补 `occlusionJson{rects[{x,y,w,h,ord}], assetPath}`（图像遮挡框坐标，Phase 16 需要）；§9.1.1 修正——手动制卡的优先级通过制卡表单滑杆设置（已实现），摘录时优先级沿默认值；AI 服务预设锁定两种（Command Code GOAT Plan / 通用 OpenAI 兼容），Key 经 Electron safeStorage 加密存于本地 `ai-config.json`。
>
> **v9 变更记录（AI 制卡执行架构与联网背景检索）：** 新增 §8.13——明确 AI 制卡为「管线编排」而非内置 Agent（§8.13.1-8.13.4 步骤-执行-实现现状对照表）；新增联网事件背景检索环节（§8.14，DuckDuckGo HTML 无 Key 方案，blockReasons 触发），GOAT 预设模型名修正为 `z-ai/glm-5.3-flash`（Provider API 实测前缀）。
>
> **v10 变更记录（本地模型接入）：** AI 服务预设新增第三项「本地模型」（§1 表 AI 行同步）——Ollama（默认 `http://localhost:11434/v1`）与 LM Studio（1234）的 OpenAI 兼容端点，无需 Key；8GB 显存推荐 `qwen3:8b`（5.2GB，制卡质量优先）/ `qwen3:4b`（2.5GB，速度优先）/ `glm4:9b`（5.5GB，GLM 系）。本地服务连接失败时给出可操作指引；「拉取模型列表」对本地端点免 Key。
>
> **v11 变更记录（FSRS 调度正确性契约，v10.4/v10.5 增补并入）：** 依据 FSRS 调度正确性测试（tests/fsrs/REPORT.md）暴露的 F1-F5 缺陷，新增 §11「FSRS 调度与复习队列契约」——FSRS 状态字段全量持久化契约（§11.1，禁止部分字段往返）、fuzz 策略锁定为关闭（§11.2）、预览与实际调度同源强制（§11.3）、leech 标记禁止整卡覆盖回写（§11.4）、到期队列排序与轮询（§11.5）、核心算法回归测试义务（§11.6）。§6 硬性约束同步新增第 7 条；Phase 3 验收标准修订为含多轮调度连续性；§1 AI 行补记 v10.4（reasoning_content 思考信号转发）与 v10.5（GLM-5.2+ reasoning_effort 思考强度，默认 low）落地。

## 0. 全局原则（最高优先级）

1. **纯本地优先（Local-first）：** 核心功能（书架、阅读、摘录、制卡、FSRS复习）在无网络、无账号下100%可用。所有网络功能（MinerU云解析、Z-library/Anna、视频、AI总结）都是可选 Provider，可开关、可缺失，不阻塞启动。
2. **为未来账户功能留位，但现在不做：** 引入 `Account / Sync` 抽象接口，现在只实现 `LocalNoopAccount`（本地单用户）。将来加登录、云同步时，只新增实现类，不改业务代码。所有数据表从第一天起带 `userId / updatedAt / syncVersion` 字段。
3. **最大灵活性：** 一切可变的东西都走接口 + 配置 + 插件槽，不写死。具体见第3章接口清单。
4. **最小单元迭代（支持继续切细）：** 本文档第5章的每个 Phase 是独立可运行版本。用户有权把任何 Phase 继续切分为 `Phase X.1 / X.2 / ...` 更小单元，每次只做其中一个。AI 只做当前指定的最小单元的 Goals，Non-Goals 碰都不碰。
5. **不引入重型后端：** 不起自建服务器、不要求 Docker、不要求 GPU。本地解析、云解析切换只换 Provider 实现。
6. **需求可变（含渐进阅读流程可重设计）：** 用户明确：整体需求、渐进阅读流程都可能在开发中修改。因此阅读/摘录/推送流程必须走 `ReadingWorkflowProvider` 接口，不许写死 SuperMemo 细节。需求变更时先更新本文档对应章节（ bump 版本号 v2 -> v3 ），再写代码。
7. **AI 输出必须人工确认、可降级（v6 新增）：** 所有 AI 功能（制卡、解释、助记、措辞优化、诊断）的输出一律先进草稿/预览区，经用户逐张/逐条确认或编辑后才写入正式表；AI Provider 缺失或关闭时，对应功能全部可降级为手动操作，不阻塞启动与核心流程。制卡/助读提示词一律走 `PromptTemplate` 版本表；AI 生成的卡片不许绕过 `CardLintEngine` 质检直接入 FSRS 队列。

## 1. 锁定的技术方案（不得擅自更改，变更先改文档）

| 层 | 锁定选型 | 说明 / 来源 |
|---|---|---|
| 桌面壳 | Electron + Vite | 不用 Wails v3 alpha（不稳定）、不用纯Web。Electron 对零基础最友好，`session / safeStorage / iframe` 正好覆盖登录复用和视频嵌入需求 |
| 语言 | TypeScript（严格模式） | 前后端统一 TS，便于以后复用 `ts-fsrs`、`readability/turndown` 生态 |
| 前端 | React 18 + Vite + Zustand + TanStack Query | 状态走 Zustand store，异步走 Query，不允许组件直查 SQLite |
| UI 地基 | 自研 Design Tokens（抄 xiadown Dream 思路，去小鸡化）+ CSS变量主题层 + **多皮肤体系；默认皮肤 = 瑞士国际主义风格（docs/swiss-international-style.md），最终目标：按不同视觉语言提供多套完全不同的皮肤（规范见 §4 视觉皮肤体系）** | `body` 通用变量 + `.theme-light / .theme-dark` 分模式。业务组件禁止写死 hex、禁止写死插画路径。**默认皮肤（瑞士风）是一切界面开发的基线：任何新增/修改界面必须先在默认皮肤下完全符合 docs/swiss-international-style.md——全局唯一主 accent 已锁定 IKB 蓝 `#002FA7`（深色提亮 `#5B7FE8`），Token 已在 `src/theme.css` 落地，每界面完工自查"设计哲学 7 条 + 禁止清单 + 五项必查"。皮肤只改表现层，禁止影响业务逻辑。** `pets.css / pet-player / 宠物画廊 / appicon小鸡` 全部删除或降级为可选 `mascot-pack`，默认关闭，由 `appearance.mascot.enabled=false` 控制 |
| 外部UI代码/提示词集成 | 允许用户从外部UI网站粘贴代码片段或AI提示词，见第7章工作流 | 所有外部UI必须经过 Tokens 适配层，不许直写硬编码样式，不许破坏亮/暗两模式 |
| 本地数据库 | SQLite（better-sqlite3 / Electron SQLite）+ 逻辑仓储层 | 表见第2章。文件存在用户数据目录，支持一键备份/还原 Vault 文件夹 |
| Markdown管线 | `readability/defuddle -> turndown -> DOMPurify -> Markdown` | 网页、MinerU、EPUB章节统一洗成此格式入库 |
| PDF原文显示 | PDF.js | 只做页级同步，不做像素级同步（技术上不可能） |
| PDF转Markdown | MinerU 云精准API（MVP），预留本地切换 | 接口 `POST /api/v4/extract/task`，`model_version=vlm`，`enable_table/formula=true`，异步轮询 `GET /task/{id}`。超200页/200MB用 `page_ranges` 切片。本地部署以后只换 Provider，不改调用方 |
| EPUB导入与阅读 | `@likecoin/epub-ts`（首选，TS重写版epub.js，1依赖jszip，970+测试） | 备选 `futurepress/epub.js` 原版、`intity/epub-js`、`TreineticEpubReader`。实现：`JSZip解包 -> container.xml/OPF/spine -> 章节XHTML -> 同Markdown管线 -> Document.blocksJson`，保留 `TOC + EpubCFI locations`。渲染用 `book.renderTo()`，原文与解析md同样做页级/章节级对照。详见附录B |
| 渐进阅读队列 | `ReadingWorkflowProvider` 接口 + 默认 SuperMemo19 实现 | 默认：双队列 Topic/Item + `priority 0-100 + auto-postpone + A-Factor`，`Items:Topics` 默认5:1可配。用户重设计流程时只换实现类 |
| 间隔重复 | `ts-fsrs`（FSRS v6，MIT） | 每张卡独立 `Difficulty/Stability/Retrievability/due`。Anki cloze语法 `{{c1::答案::hint}}` 正则解析，多挖空按 ordinals 分卡 |
| 视频播放 | `iframe` 嵌入（`player.bilibili.com` + `youtube-nocookie embed`） | 不自研 DASH/WBI，不集成 `bili-kernel`（GPL+Win-only）。登录态复用 Electron session |
| 视频AI总结 | 照搬 `Bilibili-Obsidian-Clipper MIT` 管线 | `view -> player/v2 -> subtitle body -> Markdown(章节+热评) -> OpenAI兼容流式 -> 侧边栏` + `一键加入学习`。无字幕轨则降级提示 |
| AI制卡/助读（v6） | AIGateway 统一管线 + 制卡提示词（`PromptTemplate` 版本化，锁定基线见 §8.3）+ `CardLintEngine` 静态质检 + 本地相似检索 | AI 制卡为主路径，手动制卡为降级路径（见第 8 章）。相似卡片检索第一版纯本地（n-gram + 归一化编辑距离），不强制嵌入模型；数学公式渲染锁定 KaTeX。v10.4：思考模型 reasoning_content 经 `thinking` 信号转发至渲染层（等待期状态行）；v10.5：GLM-5.2+ 随请求发送 `reasoning_effort`（设置页思考强度，默认 low），非 GLM 模型不发送 |
| 登录复用 | Electron版 AppSession：内嵌登录窗 + 浏览器Cookie导入 + 系统加密存储 | 抄 xiadown `sitepolicy + StableAuth` 思想，用 `safeStorage` 存 vault。Z-lib 存 `remix_userid/key`，Anna 存 `secret key` 当次透传 |
| 背景音内置 | Moodist（MIT）裁剪/自托管 | 唯一可直接集成的。Endel/Brain.fm/myNoise/Noisli 全部只做外链跳转，不嵌入（无公开API/DRM/许可禁止） |
| 网页剪藏 | 以 `obsidian-clipper MIT` 为交互母版 | 高亮三态、模板变量、URL自动触发，锚定参考 Hypothesis |
| 插件/主题 | 自研轻量市场，兼容 Obsidian/Logseq字段超集 | 清单见第4章。第一版只支持本地文件夹安装 |

## 2. 数据模型（第一天就要建好，方便扩展）

```text
User { id, name, createdAt }
LibraryItem { id, userId, title, sourceType[paste/pdf/epub/markdown/video/web], sourceUrl?, cover?, createdAt, updatedAt, syncVersion }
Document { id, libraryItemId, markdown, blocksJson[{index, page_no?, spineHref?, cfi?, bbox?, type?[content/ai-supplement], anchor?}], tocJson?, createdAt }
Extract { id, userId, parentType[document/extract], parentId, contentMarkdown, provenance[user/ai-explain], anchorRef{blockIndex, anchorText}?, priority[0-100], topicNextAt, workflowStateJson?, createdAt }
Card { id, userId, noteText, cardType[qa/cloze/imageOcclusion/seq/mnemonic/application], clozeOrds, cardOrd, frontMarkdown, backMarkdown,
       contextPrefix, contextRef{documentId, extractId, blockIndex?, anchorText?},
       mnemonic?, example?, sourceRef{title, url?, page?}?, dateStamp?,
       priority[0-100], tags[], knowledgePointId?,
       fsrs{D,S,R,due,lapses,state[new/learning/review/relearning]},
       leech{isLeech, suspendedAt?, resolution[none/reworded/split/supplemented/deprioritized/postponed/mnemonic/resumed]},
       generatedBy[manual/ai], genBatchId?, createdAt, updatedAt, syncVersion, isDeleted }
CardIssue { id, cardId, ruleId, severity[error/warn/info], message, source[lint/ai/review-mark], status[open/fixed/dismissed], createdAt, resolvedAt? }
AIGenBatch { id, userId, scope[card-gen/card-formula/card-seq/card-enum/card-mnemonic/card-contrast/card-wording/card-basic/reader-explain/leech-rescue], sourceText, contextJson, promptTemplateId, resultJson, status[draft/accepted/partial/rejected], createdAt }
ReviewLog { id, cardId, rating[Again/Hard/Good/Easy], reviewedAt, durationMs }
Asset { id, libraryItemId, kind[pdf-original/epub-original/image/audio], path, hash }
PromptTemplate { id, scope[video-summary/reader-assist/card-generation/card-formula/card-seq/card-enum/card-mnemonic/card-contrast/card-wording/card-basic/reader-explain/leech-rescue/global], name, content, version }  // AI提示词版本化，应对需求变更；制卡族默认内容以 §8.3 为锁定基线
Setting { scope[app/theme/plugin.<id>], key, valueJson }   // 含可选 userProfile（§8.6）、leechThreshold、每日复习上限等
UiDraft { id, source[external-site/ai-prompt], rawCode?, promptText?, adaptedCss?, status[draft/applied/rejected] } // 外部UI草稿区，不直接进主UI
```

v6 数据模型要点说明：

- **Card 拆分字段对应制卡原则：** `contextPrefix`（原则16 上下文线索）、`mnemonic/example`（原则7/14）、`sourceRef`（原则18 提供来源）、`dateStamp`（原则19 时间标记）、`priority`（原则20）、`knowledgePointId`（同一知识点的卡片簇：冗余、双向卡、主卡+辅助卡共享一个 id，支撑原则17 与「整散结合」）。
- **Card.leech** 记录记忆难点状态与处理决议，与 FSRS `lapses` 联动（§8.7）。
- **CardIssue** 是统一的卡片问题池：`CardLint` 质检结果、AI 生成时的 warnings、复习中用户「标记待改」都写这里，定期编辑会话统一清理（§8.7、Phase 15）。
- **AIGenBatch** 记录每一次 AI 生成（含提示词版本与输入上下文），可回溯、可重放、可整批拒绝；AI 结果先落此表，确认后才转正式 Card / Document 补充块。
- **Document.blocksJson 的 `type:ai-supplement + anchor`** 支撑「AI 解释回写原文」（§8.5）；**Extract.provenance/anchorRef** 使 AI 解释同时成为渐进阅读队列中的正式材料。
- **cardType 扩展**：`imageOcclusion`（图像遮挡，原则8）、`seq`（序列/续写背诵卡）、`mnemonic`（助记双卡）、`application`（应用/启明卡：「当我遇到 X 应该问自己什么」）。

所有业务表必含 `userId / updatedAt / syncVersion / isDeleted`，为将来账户同步留位。`workflowStateJson / PromptTemplate.version` 是为渐进阅读重设计留的扩展口。

## 3. 必须保留的接口/抽象（扩展灵活性的关键）

AI 在任何 Phase 都不得绕过这些接口直写实现：

1. `EventBus`：唯一事实通道。核心事件名锁定：`stats/updated, library/changed, todo/changed, pomodoro/tick, pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed, cards/changed, ai/batchDone, leech/detected`（后三个为 v6 新增）。番茄 tick 只允许单一 Clock Service 发。
2. `CommandRegistry`：所有动作先注册 `{id,title,when,keybinding}`，按钮/右键/灵动岛只是渲染。
3. `SettingsStore`：三层 `app / theme / plugin.<id>`，插件只能读写自己命名空间，经 JSON Schema 声明。
4. `PluginHost`：`load/unload/enable/disable + contributes{commands, widgets, views, themes, permissions}`。清单字段锁定：`id/version/minAppVersion/permissions/contributes/compat`。
5. `ParserProvider`：`submit(file|url) -> poll(taskId) -> {markdown, blocks[]}`。实现：`MineruCloudProvider`，以后加 `MineruLocalProvider`。
6. `EpubProvider : LibrarySourceProvider`：`parseEpub(arrayBuffer) -> {metadata, toc, chaptersHtml[]} / renderTo(el)`，锁定用 `@likecoin/epub-ts`，章节HTML复用 Markdown管线。
7. `AuthSessionProvider`：`startLogin(site) / finishLogin() / importBrowserCookies() / getCookies(domain)`。站点配置表 `sitepolicy{...}`，加新站只加配置。
8. `LibrarySourceProvider`：`ZlibProvider / AnnaProvider / WebClipperProvider / LocalFileProvider / EpubProvider`，统一返回 `LibraryItem+Document`。域名、镜像列表全放配置，支持用户自填 baseUrl。
9. `ReadingWorkflowProvider`：`nextTopic() / postpone() / setPriority() / serializeState()`。默认SM19实现，用户重设计时替换，不动阅读器UI。
10. `VideoProvider`：`BilibiliProvider / YouTubeProvider`，只暴露 `getPlaybackUrl / getSubtitles / getChapters`，播放一律 iframe。
11. `AIGateway`：`AIProvider{baseUrl,model,apiKey} + ContextProvider + PromptTemplate registry + stream/cancel`。各功能不许直调 LLM，提示词必须走 `PromptTemplate` 版本表。
12. `AudioProvider`：`MoodistLocalProvider` 内置 + `ExternalLinkProvider{endel, brainfm}` 外链。
13. `StatusBarWidgetHost`：槽位 `left/center(island)/right`，widget 声明 `{id,slot,order,visibility,refreshInterval,settingsSchema}`。
14. `AccountSyncProvider`：现在只实现 `LocalNoopAccount`，接口预留 `login/logout/getProfile/push/pull`。
15. `UiAdapter`：外部UI代码入口，`adaptExternalCode(rawCode) -> tokens化CSS + 主题校验`，见第7章。
16. UI Slots：`commandPalette / sidebarView / statusBarWidget / editorSlash / blockMenu / themeCSS`。
17. `CardGeneratorProvider`（v6）：`generateCards(sourceText, context, mode) -> CardDraft[]`。实现 `AICardGenerator`（经 AIGateway + `PromptTemplate` 的 card-* 族模板）。AI 制卡、公式分解、序列生成、枚举拆解、助记卡、对比卡、前置知识卡全部经此接口；UI 只消费 CardDraft，不感知 LLM 细节。
18. `CardLintEngine`（v6）：`lint(cardDraft) -> CardIssue[]`。纯本地静态规则，不调 LLM，对 AI 卡与手动卡一视同仁；规则清单锁定见 §8.4。
19. `SimilaritySearchProvider`（v6）：`findSimilar(cardText, k) -> {cardId, score}[]`，用于制卡查重与记忆干扰检测。第一版实现为本地 n-gram + 归一化编辑距离；未来换嵌入模型只换实现类，不改调用方。

## 4. 插件/主题市场（现在只定规范，不实现市场）

- 插件目录 = 文件夹 `plugins/<id>/` 内 `plugin.json + main.js + styles.css(可选) + data.json`。
- `plugin.json` 必填：`id, name, version(semver), minAppVersion, description, author, permissions[], contributes{}`。
- `versions.json` 做版本回落，强制 semver。
- 主题是特殊插件：`type:theme`，`theme.json + theme.css`，复用安装通道，支持 `snippets/` 叠加。
- 主题 CSS 头可用 `/* @settings */ YAML` 声明可调项，自动生成设置面板。

### 视觉皮肤体系（多视觉语言，v5 新增）

- **定位：** 瑞士国际主义（`docs/swiss-international-style.md`）是**默认皮肤**与全应用基线，设置项 `app.skinId` 默认指向它。最终目标：在同一 Token 架构上，按不同视觉语言（如瑞士风、玻璃拟态 xiadown、新粗野主义、编辑部杂志风、终端极客风等）提供多套**完全不同**的完整皮肤，用户在设置中切换。
- **"完全不同"的判定标准：** 差异必须体现在整套设计语言（设计哲学、色板、字体气质、形状语言/圆角、密度、组件形态、动效性格），而不是只换一个 accent 色。只换色的不算新皮肤。
- **皮肤包结构（与本章主题插件机制统一）：** 内置皮肤放 `src/skins/<id>/`，可分发皮肤为 `skins/<id>/` 文件夹（`skin.json + tokens.css + skin.css(可选) + preview(可选)`）；`skin.json` 必填 `id / name / version(semver) / minAppVersion / appearance[light|dark|both] / author / description`。主题插件（`type:theme`）与内置皮肤走同一加载通道。
- **每套皮肤的硬性要求：**
  1. **只改表现层：** Token 覆盖 + 组件样式覆盖 + 可选装饰层；禁止触碰业务逻辑、接口、数据结构；
  2. **Token 驱动：** 该皮肤的色值/字号/间距/圆角/层级/阴影全部在其 `tokens.css` 内声明，禁止业务组件硬编码；
  3. **亮暗策略显式声明：** `appearance: both` 的皮肤必须提供 `.theme-light / .theme-dark` 两套色值组，正文对比 ≥ 4.5:1；单模式皮肤在设置中隐藏不适用的模式切换或标注"跟随皮肤"；
  4. **可访问性底线不放松：** 文字 ≥ 11px、键盘焦点环可见、`prefers-reduced-motion` 必须尊重——无论何种视觉语言；
  5. **先规范后代码：** 每套皮肤必须有独立的视觉规范文档（`docs/skins/<id>.md`），写明其设计哲学、色板、字体、形状语言与组件差异；规范经用户确认后才动代码。
- **流程：** 每套新皮肤是独立最小单元（可按 Phase X.Y 切细），一次只做一套；验收 = `切换 -> 重启保持 -> 切回默认皮肤无样式残留` 可演示。默认皮肤永不因新增皮肤而被改动；修默认皮肤 = 修 `docs/swiss-international-style.md` + `src/theme.css`，先 bump 本文档。

## 5. 功能总表与最小单元切分（非一次性实现，可继续切细）

> 每次迭代只做一个最小单元（Phase 或 Phase X.Y）。AI 开工前复述 Goals / Non-Goals，完工按 Acceptance 自检。用户可随时要求把当前单元再切细，AI 必须停下等切分确认。

- **Phase 0 — 空壳启动：** Electron 空窗 + 主题地基 + SettingsStore + EventBus + 空书架页。验收：能启动、能切换亮/暗、设置持久化。可切细如 0.1只跑空窗，0.2加主题开关。
- **Phase 1 — 手动粘贴成书（示例粒度）：** 粘贴框 -> 存 LibraryItem+Document -> 书架列表。验收：重启不丢。不做阅读器、摘录、制卡、PDF/EPUB、网络。
- **Phase 2 — 阅读器+摘录（可重设计）：** 打开阅读，选中摘录进 Topic 队列，按 priority 推送，可继续摘录。走 `ReadingWorkflowProvider`，以后换流程不改UI。验收：摘录链可追溯。
- **Phase 3 — 制卡+FSRS（手动基线）：** 侧边栏两模式制卡，问答/填空/多挖空，带上下文引用，进 FSRS 队列。验收：Anki cloze round-trip；**且 FSRS 调度连续性验收（v11）——同一张卡连续评分 ≥3 轮，每轮落库的 fsrs 状态完整（含 S/D/reps），下一轮调度以完整状态为输入，第 3 轮后的间隔与 ts-fsrs 参考引擎（enable_fuzz=false）一致（天级容差内）；到期队列仅含 due<=now 的卡且按 due 升序**。手动制卡是基线与 AI 缺席时的降级路径，同样过 `CardLint`（v6 修订）；AI 主路径见 Phase 13。
- **Phase 4 — PDF MinerU双栏：** 本地PDF -> MinerU云 -> 右md左PDF页级同步+开关。验收：超限提示切片。
- **Phase 4b — EPUB导入（新增）：** 直接导入.epub进书架，解析TOC+章节转md，阅读器复用Phase2，保留原文包做对照。技术见附录B。验收：大书分章加载不卡。
- **Phase 5 — 网页剪藏插件：** 浏览器插件摘录 -> 本地收件箱。
- **Phase 6 — Z-lib/Anna连接器：** 镜像发现+自填域名+Cookie/key导入+搜索加入书架（BYOA，有风险提示）。
- **Phase 7 — 视频+AI总结：** iframe播放B站/YT + Clipper字幕管线 + 一键加入学习。
- **Phase 8 — 背景音：** 内置 Moodist + Endel/Brain.fm外链。
- **Phase 9 — 灵动岛状态栏：** 顶部 widget host + 3个widget。
- **Phase 10 — TODO/番茄：** 各为独立插件。
- **Phase 11 — AI全局 + 插件/主题市场：** AIGateway全量 + 本地安装 + 中心索引。
- **Phase 12 — AI 阅读助手（v6 新增）：** 阅读器/摘录卡中选中文字 -> `Alt+E` AI 解释流式侧栏 -> 回答下方三按钮：「插入原文」（回写为 ai-supplement 块 + provenance 摘录入队）、「就此制卡」（转 Phase 13 管线）、「换个角度」追问。验收：AI Provider 关闭时入口隐藏、无网络核心流程不受影响；插入块可溯源、可撤销。可切细：12.1 仅解释侧栏，12.2 回写+摘录，12.3 制卡衔接。
- **Phase 13 — AI 辅助制卡（v6 新增，主路径）：** 选中文本 -> `Alt+C` -> `CardGeneratorProvider` 按 §8.3 提示词生成 CardDraft 批次 -> `CardLint` 质检 -> 预览面板逐张编辑/接受/拒绝 -> 入 FSRS 队列（带 contextRef/sourceRef/knowledgePointId）。验收：草稿含 ruleNotes 与 lint 结果；批次可整批拒绝；无 AI 时降级手动制卡入口不变。可切细：13.1 生成+JSON解析，13.2 lint+预览，13.3 措辞优化/拆分按钮，13.4 枚举模式，13.5 相似查重提示。
- **Phase 14 — Leech 记忆难点处理（v6 新增）：** lapses 达阈值（默认8可配）自动标记+暂停 -> 通知中心提示 -> 六步处理向导（AI 诊断/补前置卡/重设问法/删除或降优先/推迟/助记卡，见 §8.7）-> 处理后重置为新卡或恢复 -> leech 清理面板（tag:leech 过滤、批量操作、占比统计）。验收：标记-暂停-处理-恢复全闭环可演示；「标记并暂停」复习中一键可用。可切细：14.1 检测+暂停+通知，14.2 向导（无AI步骤），14.3 AI 救援步骤，14.4 面板统计。
- **Phase 15 — 干扰检测与卡片维护（v6 新增）：** `SimilaritySearchProvider` 制卡查重 + leech 触发相似检索 + 对比卡生成；复习中「标记待改」入 CardIssue；定期编辑会话（类似 leech 清理，处理 marked/lint 问题）；「补进度」积压分散（§8.12）；卡片编辑历史（渐进措辞优化）。验收：相似检索纯本地可演示；编辑会话清空 issue 队列。可切细：15.1 查重，15.2 对比卡，15.3 标记待改+编辑会话，15.4 补进度。
- **Phase 16 — 背诵/序列/公式/遮挡模式（v6 新增）：** `seq` 续写卡背诵模式（文章诗歌，含首句强化）；`card-seq` 序列卡生成器（位置/前后驱/完形）；`card-formula` 公式地标+符号分解（KaTeX）；`imageOcclusion` 图像遮挡卡（PDF/EPUB 截图 + 遮挡框编辑器）。验收：四种 cardType 全流程（生成-复习-统计）可演示。可按模式切细为 16.1-16.4。

## 6. 给 AI 的硬性约束

1. 开工只做用户指定的最小单元，其他代码一行都不写。
2. 不新增 `Account` 真实现、不接付费/盗版代理、不把 Cookie/key 打日志或上传。
3. 所有站点域名、API baseUrl、镜像列表、提示词内容必须放配置或 `PromptTemplate` 表，不许写死。
4. 每次完工必须保证：`启动 -> 该单元主流程 -> 重启不丢数据` 可演示，并告诉用户如何点。
5. 遇到文档未覆盖的选择，先停下问用户，不擅自决定。需求变更先改本文档 bump 版本再编码。
6. **视觉风格以默认皮肤（瑞士国际主义）为基线（v4 新增，v5 修订）：** 任何新增/修改的界面、组件、样式，必须先保证在**默认皮肤**下完全符合 `docs/swiss-international-style.md`——逐界面自查"设计哲学 7 条 + 禁止清单"，完工执行"五项必查"（深色模式、键盘焦点可达、< 11px 文字、同屏多焦点色、硬编码魔法值）；色值/字号/间距/圆角/层级一律走 Design Tokens，禁止硬编码魔法值。做其他皮肤时按 §4"视觉皮肤体系"另立规范开发，不得以"换皮肤"为由绕过默认皮肤基线，也不得为适配某皮肤改动业务逻辑。唯一例外：用户按 §7 粘贴的外部 UI 代码仍按逐字还原原则处理。
7. **AI 结果不落地原则（v6 新增）：** AI 生成的卡片/解释/助记一律先写 `AIGenBatch` 草稿，用户确认后才转正式 Card / Document 补充块；禁止 AI 结果绕过预览与 `CardLint` 直接进 FSRS 队列。提示词内容只存 `PromptTemplate` 表（默认版本以 §8.3 为锁定基线），不许写死在代码里；改提示词 = 新增版本记录，不覆盖旧版。AI 上下文注入用户已有卡片/画像时，只注入经用户确认相关的最小集合，不整库上传。
8. **核心算法回归测试义务（v11 新增）：** 涉及 FSRS 调度、制卡质检（CardLint）、 cloze 解析、Markdown 管线的改动，必须附可重复运行的自动化测试（放 `tests/` 目录），并在完工报告里给出运行结果；FSRS 调度相关改动一律以 `tests/fsrs/` 黄金参考对照套件回归（§11.6）。文档数据模型中声明的字段（如 §2 `fsrs{D,S,R,due,lapses,state}`）不允许实现时静默裁剪——存不下、往返不了的字段等于没设计，发现冲突先改文档再编码。

## 7. 外部UI网站协作流（新增）

用户会从网上UI设计站复制代码或AI提示词来定制UI。AI 按此流程处理：

0. **与皮肤体系的关系（v4 新增，v5 修订）：** 除本章用户主动粘贴的外部 UI 代码外，应用一切原生界面开发视觉统一遵循默认皮肤规范 `docs/swiss-international-style.md`（见 §6.6）。两者冲突时：外部代码按 §7.2 逐字还原优先；其余一律以默认皮肤规范为准。用户粘贴并 applied 的代码，如成体系，可按 §4"视觉皮肤体系"沉淀为独立皮肤包，不得直接覆盖默认皮肤。

1. 用户粘贴的外部代码一律先存 `UiDraft{rawCode/promptText}` 草稿，不直接覆盖 `theme.css` 或组件。
2. **逐字还原原则（v3 新增，最高优先）：** 用户给定参考代码时，必须逐字还原原版效果——颜色、尺寸、圆角、图层结构、动画参数、滤镜等一律保持原值，不做任何"优化"、删减或替换（包括看似无用的图层，如 backdrop-filter 模糊层）。只有两类例外：(a) 用户明确提出修改需求；(b) 与安全等硬性原则冲突，且必须先说明并征得同意。§7.2 的 Tokens/双主题适配仅在用户要求主题联动时执行。
3. AI 经 `UiAdapter` 做适配时（仅限第2条例外场景）：替换硬编码色为 Design Tokens 变量、补 `.theme-light/.theme-dark` 两套值、校验对比度与圆角/密度规范。
4. 用户粘贴的提示词（如 v0 / 同类站生成语）视为 `promptText`，AI 用它生成草稿后同样走适配。
5. 只有用户说“应用这个UI”才从 `draft -> applied`，并保留回滚。每个应用记录来源URL（用户提供），方便后续溯源。
6. 外部代码不许引入新的UI框架、不许直连网络字体/统计脚本，纯本地。

## 8. AI 辅助制卡与助读体系（v6 新增，锁定设计）

> 本章把《有效的学习：组织知识的 20 条原则》（下称「20 条」）与知乎收藏夹《制卡原则与知识表述》22 篇补充文献（下称「补充文献」）中提出的**每一个问题**映射为软件功能。§8.11 的问题-功能映射总表是设计验收清单：表中任何一行没有对应功能落地，视为设计缺口，不得宣称体系完成。AI 制卡为**主路径**，手动制卡为基线与降级路径。

### 8.1 制卡原则知识库（单一事实来源）

- 全部制卡原则只存在于两处：`PromptTemplate` 的 card-* 族提示词（给 LLM 的规则文本）与 `CardLintEngine` 规则表（给本地静态质检的规则）。**代码、组件、文档中不许再散落第二份原则文本**，避免规则漂移。
- `PromptTemplate` scope 锁定（v6）：`card-generation`（主制卡）、`card-formula`（公式分解）、`card-seq`（序列/背诵）、`card-enum`（集合/枚举拆解）、`card-mnemonic`（助记）、`card-contrast`（干扰对比）、`card-wording`（措辞优化）、`card-basic`（前置知识补卡）、`reader-explain`（阅读解释）、`leech-rescue`（难点诊断）。默认内容以 §8.3 为锁定基线，用户可在设置中查看、微调并另存新版本（不覆盖默认版）。

### 8.2 AI 辅助制卡主流程（替代手动制卡）

1. **入口：** 阅读器原文 / Topic 队列中的摘录，选中一段文字 -> `Alt+C` 或右键「AI 制卡」。也支持在 AI 解释侧栏直接「就此制卡」（§8.5）。
2. **上下文打包（ContextProvider）：** 自动注入——所选文本 + 所在章节标题/书名/来源 URL + 同章节已确认卡片（供联想与查重）+ 可选 userProfile（§8.6）。只注入最小相关集合，不整库上传（§6.7）。
3. **生成：** `CardGeneratorProvider.generateCards()` 走 `card-generation` 提示词（§8.3），输出结构化 CardDraft 批次。模式自动路由：检测到集合/枚举 -> `card-enum`；序列/诗文 -> `card-seq`；公式 -> `card-formula`；用户显式选模式则优先。
4. **质检：** `CardLintEngine.lint()` 对每张草稿跑 §8.4 规则 -> CardIssue[]，预览面板逐张显示卡面预览 + lint 结果 + ruleNotes + warnings。
5. **确认入库：** 用户逐张「编辑 / 接受 / 拒绝」或整批操作；编辑器内一键「AI 优化措辞」「AI 拆分这张卡」。接受后写入 Card（`generatedBy:'ai'`，带 contextRef/sourceRef/dateStamp/priority/knowledgePointId），进 FSRS 队列。整批记录留 `AIGenBatch`，可回溯重放。
6. **超量制卡默认值：** 每个知识点默认产 2-4 张卡（防孤儿卡），单批次上限默认 10、可配。用户觉得多可直接删——删卡成本远低于补卡成本。
7. **渐进/迭代制卡：** 重访同一材料时提供「补充制卡」（只增补新角度卡，不重复已有 knowledgePoint）；复习中发现的表述问题走「标记待改」入 CardIssue（Phase 15 编辑会话统一处理），对应补充文献「迭代式写卡」与「渐进措辞优化」。
8. **手动制卡保留：** Phase 3 双模式侧栏不变，作为 AI 缺失时的降级路径；手动卡同样过 lint。用户自己的推导与洞见（「缓存你的见解」）走手动路径或对自写文本调 AI 制卡。

### 8.3 制卡提示词锁定基线（card-generation 默认模板）

> 提示词按「理解检查 -> 硬性规则 -> 输出格式 -> 禁止事项」组织。以下为锁定基线全文（存入 PromptTemplate 的默认版本）；任何修改必须新增版本号并先改本文档。

```text
你是间隔重复制卡专家。把用户提供的文本转化为记忆卡片。你必须逐条遵守以下规则；
违反任何硬性规则的卡片视为无效，必须自行返工后再输出。每张卡片标注所依据的规则编号。

【第一步：理解检查（20条 规则1）】
- 若文本依赖用户可能不理解的前提概念，不要直接制卡：在 blockReasons 中列出这些概念，
  并建议先生成「解释」或「前置知识卡」。
- 先判定文本包含哪些知识点（knowledgePoints）。每个知识点默认产出 2-4 张相互关联的卡
  （防孤儿卡）；单一孤立事实至少 2 张（正向+反向或事实+解释）。

【第二步：硬性规则】
R1 不理解不学：每张卡必须建立在可理解基础上；依赖未解释术语时先产前置卡（card-basic）。
R2 最小信息（规则4）：一卡一问一答；答案尽可能短（目标 ≤15 字）；多个信息点拆成多张卡。
   不产"简述/描述/谈谈"式大问题。
R3 单义性（精准且一致）：问题必须唯一指向一个目标答案；不允许"正确但不相干"的替代答案。
   例子类知识一律反转为「X 是 Y 的例子」，禁止「举一个 Y 的例子」。
R4 禁止是否题：答案为是/否/对/错的题必须重构为开放问题（可保留原事实为陈述卡挖空）。
R5 避免集合/枚举（规则9/10）：不产「列出所有…」的卡。集合先按共同点分组再逐项挖空（保持
   顺序，形成视觉形状记忆）；有序枚举 >5 项必须拆解为重叠挖空或序列卡。
R6 上下文前缀（规则16）：front 以简短领域前缀开头（如「统计:」「线代:」），保证脱离原文
   可独立理解；不得围绕"课本/本文"设问。
   【前缀铁律】前缀只能是领域/学科名，禁止包含任何可作为答案的内容词——若前缀与答案
   重复或提示答案（如答案「优绩主义」配前缀「优绩:」）视为泄题：必须改用更上位领域词
   （如「社会思想:」）或去掉前缀。检验法：遮住答案，只看前缀+问题能否猜出答案。
R7 措辞最短路径（规则12）：删除不影响答案确定的冗余词；front 越短越好，防止模式匹配。
R8 双向与多角度（规则17）：成对概念（术语<->定义、符号<->含义、原因<->结果）默认生成
   正向+反向两张；高价值知识点追加通俗解释版或严格定义版。
R9 例子与个性化（规则14/15）：抽象概念必须配具体例子；若提供用户画像，优先用其生活线索；
   允许生动甚至情绪化的例子（仅自用），可带幽默与联想。
R10 联想已有记忆（规则13）：若提供了用户已有卡片，新卡措辞尽量挂接已有概念；发现相近
   概念必须在 warnings 中提示潜在记忆干扰。
R11 来源与时间戳（规则18/19）：每张卡带 sourceRef（书名/章节/URL）；易变数据（统计数字、
   版本号、价格、政策）必须带 dateStamp。
R12 助记克制（规则7）：默认不加助记；仅当知识点零散难记或用户要求时，另产助记双卡
   （助记本身一张 + 用助记引导答案一张），不混入普通卡。
R13 挖空规范（规则5）：cloze 每卡挖空 ≤2 处，语法 {{c1::答案::提示}}；背诵诗文用
   「上文续写」卡，禁止机械逐词挖空整篇。
R14 优先级建议（规则20/3）：基础概念、高适用性规则 ≥70；一般细节 40-60；边缘信息 ≤30
   并在 warnings 提示「考虑不做卡」。
R15 应用与启明卡：对方法论/可迁移概念，追加 application 卡（「当我遇到X应该问自己什么」），
   答案不要求唯一，允许每次生成新例子。
R16 实体全名（v10.1）：人名、地名、机构名、作品名在卡片中必须保留原文完整全名，禁止
   缩略（「迈克尔·杨」不得写成「杨」）——缩略在大规模卡片积累后无法对应到具体实体。
   中文外文名保留原文译名全称；确需简称时用「全名（简称）」先建立映射。检验法：半年后
   重读这张卡，能否仅凭卡面确定实体所指。

【第三步：输出格式】
严格输出 JSON，不输出其他文字：
{
  "knowledgePoints": [{"id":"kp1","summary":"一句话概括"}],
  "blockReasons": ["需要先理解：X、Y"],
  "cards": [{
    "cardType": "qa|cloze|application|mnemonic",
    "knowledgePointId": "kp1",
    "contextPrefix": "领域:",
    "front": "…", "back": "…", "cloze": null,
    "example": null, "mnemonic": null,
    "sourceRef": {"title":"…","url":null,"page":null},
    "dateStamp": null,
    "prioritySuggestion": 0,
    "ruleNotes": ["R2","R6"],
    "warnings": ["与已有卡『…』可能干扰"]
  }]
}

【禁止事项】
- 禁止把多个知识点合并进一张卡；禁止复述原文长句作为答案。
- 禁止枚举式大答案；禁止是否题；禁止模糊问法（"为什么重要？"这类无唯一抓手的问题）。
- 禁止无例子支撑的抽象定义卡；禁止编造来源。
```

`card-formula / card-seq / card-enum / card-mnemonic / card-contrast / card-wording / card-basic / leech-rescue` 各模板在主提示词基础上叠加模式专属段（见 §8.7-§8.10），共用同一套 R 规则与输出格式，具体文本随各 Phase 实现时以 §8.3 为基线派生并入库版本化。

### 8.4 CardLint 静态质检规则（对 AI 与手动卡一视同仁，纯本地）

| ruleId | 检查内容 | severity | 对应原则 |
|---|---|---|---|
| L1 | back 信息过载（字数或信息单元超限，默认 >60 字 / >3 单元） | warn | 规则4 最小信息 |
| L2 | 是否题（答案为 是/否/对/错/正误 单词） | warn | 补充文献·避免判断题 |
| L3 | 集合型问法（问句含「有哪些/列举/分别」且答案多项） | warn | 规则9 避免集合 |
| L4 | 有序枚举 >5 项未拆解 | warn | 规则10 避免枚举 |
| L5 | 缺 contextPrefix | info | 规则16 上下文线索 |
| L6 | 缺 sourceRef | info | 规则18 提供来源 |
| L7 | AI 标记的单义性问题（ruleNotes/warnings 带歧义标记） | warn | 精准性/一致性 |
| L8 | 孤儿卡（knowledgePointId 下仅 1 张且非基础事实） | info | 补充文献·避免孤立卡片 |
| L9 | 单卡 cloze 挖空 >2 处 | warn | 规则4/5 |
| L10 | front 过长（默认 >80 字，模式匹配风险） | warn | 规则12 措辞优化 |
| L11 | imageOcclusion 卡缺 Asset / 图链失效 | error | 规则8 图像填空 |
| L12 | 易变内容缺 dateStamp（含统计/版本/价格关键词） | info | 规则19 时间标记 |
| L13 | 前缀泄题：contextPrefix 与答案内容重叠（如答案「优绩主义」配前缀「优绩:」） | warn | 规则16 上下文线索 |
| L14 | 实体全名疑似缩略：front/back 含单字中文人名后缀或孤立外文名片段（杨/马丁·等模式） | warn | R16 实体全名 |

severity 语义：error 阻止入库（必须修复）；warn 显示于预览与卡片详情，用户可选择接受（自负其责）；info 仅提示。所有 lint 结果写 CardIssue，卡片详情页可随时查看「这张卡违反了哪些原则」——对应补充文献「卡片低级错误检查器」的诉求。

### 8.5 AI 阅读助手（选中文本 -> 解释 -> 回写材料）

1. **入口：** 阅读器/摘录卡中选中文字 -> `Alt+E`「AI 解释」-> 侧栏流式回答（`reader-explain` 模板：先一句话直答，再解释机制，最后主动联系用户已有概念与文中上下文；允许「换个角度」追问：通俗解释 / 严格定义 / 举个例子 / 为什么会这样）。
2. **回答下方固定三动作（用户明确要求的核心交互）：**
   - **「插入原文」：** 把回答以 `> [AI 补充 · 日期]` 引用块插入 Document 当前锚点之后（`blocksJson` 记 `type:ai-supplement, anchor`），同时写 `Extract{provenance:'ai-explain', anchorRef}` 进入渐进阅读 Topic 队列——AI 回答就此**成为阅读材料本身的一部分**，可继续摘录、可继续制卡，作为补充材料与制卡原材料。
   - **「就此制卡」：** 把「选中文本 + AI 回答」合并为 sourceText，直接调 `CardGeneratorProvider`（进 §8.2 流程）。
   - **「换个角度」：** 以追问轮次继续对话，任一轮回答都可插入/制卡。
3. **理解闭环（规则1/2 落地）：** AI 制卡时若 blockReasons 非空，预览面板顶部提示「该文本依赖未建立的理解」，给两个按钮：「先去解释」（跳 §8.5）、「生成前置知识卡」（card-basic）。整体图景卡：`card-generation` 可对整章生成少量 overview 卡（主旨/结构/与已学章节的关系），支撑「先学后记」。

### 8.6 个性化与用户画像

- 设置中可选填 `userProfile`（职业、兴趣、正在做的项目、生活线索，纯本地存储于 Setting），注入制卡/解释提示词的「个性化例子」段（R9）。
- 关闭画像时模板自动降级为通用例子，功能不缺失；画像内容永不上传到除 LLM Provider 之外的地方，并在 AI 设置页明示。

### 8.7 Leech（记忆难点）处理流程

> 对应补充文献《如何应对记忆难点（Leech）》六步决策框架，以及用户要求：FSRS 标记的 Leech 卡必须暂停并提示用户处理。

1. **检测与暂停：** 每次复习 Again 使 `fsrs.lapses+1`；`lapses >= leechThreshold`（默认 8，可配）-> 置 `leech.isLeech`，卡片自动移出复习队列（暂停），通知中心弹出「发现记忆难点」提示。`leech/detected` 事件驱动。
2. **复习中的轻量动作：** 「标记并暂停」一键（等效 Anki `*@`）——挂起当前卡 + 建 `CardIssue{source:'review-mark'}`，不打断复习节奏；稍后在编辑会话处理。
3. **六步处理向导（点击通知或 Leech 面板进入）：**
   - Step 1 明显原因？-> 展示卡片 + 历史 lint 问题 + 「AI 诊断」（`leech-rescue`：分析遗忘原因——歧义/干扰/缺前置/信息过载/是否题残留）。
   - Step 2 补充卡片？-> 「AI 生成前置知识卡」（card-basic：对卡内可能不熟的术语产 2-3 张基础卡）；若相似检索命中 -> 「AI 生成对比卡」（§8.8）。
   - Step 3 考察点不对？-> 「AI 重设问法」（card-wording：给 2-3 种替代问法，消除枚举/是否/歧义）。
   - Step 4 不重要？-> 删除（带「重要」标签的卡红字提醒）/ 降优先级。向导明示取舍逻辑：放弃最难的 10% 可换取约 3 倍学习吞吐（来自 20 条理论文），删除是理性决策不是失败。
   - Step 5 暂缓？-> 推迟到指定日期自动恢复（`leech.resolution:'postponed'`，典型场景：备考冲刺期先搁置）。
   - Step 6 助记？-> 「AI 生成助记双卡」（card-mnemonic：助记本身一张 + 用助记引导答案一张）。
   - 处理完成默认「重置为新卡」（进度清零，因卡片已改），仅微小改动可选「仅恢复」；清除 leech 标记避免重复处理。决议写 `leech.resolution`。
4. **Leech 清理面板：** 侧栏视图，过滤 `isLeech / tag:leech`，顶部显示未处理数与建议周期（每 1-2 周）；支持批量「删除 / 降优先 / 移除 leech 标记」；统计 leech 占比、按来源章节分布——佐证规则20 的优先级取舍。

### 8.8 干扰检测与对比卡

1. **制卡时查重：** `SimilaritySearchProvider.findSimilar(newCard)`；高分命中 -> 预览面板并排显示相似旧卡，提示「可能形成记忆干扰」，给「AI 合并 / 改写区分 / 照常创建」三选。
2. **Leech 触发时：** 自动检索相似卡；命中 -> 向导 Step 2 直接提供「生成对比卡」（card-contrast：一组「A 与 B 的区别」「A 的关键特征」「B 的关键特征」卡，各带 contextPrefix）。文献实证：专门区分相似概念的卡常能同时救活两张 leech。
3. **实现约束：** 纯本地（n-gram + 编辑距离起步），接口化，未来可换嵌入；不依赖云端。

### 8.9 集合 / 枚举 / 序列 / 背诵处理（card-enum / card-seq）

- **集合/枚举（规则9/10 + 补充文献《Anki 中处理枚举的实例》）：** 检测到集合问法（lint L3/L4 或 AI 判断）自动切 `card-enum` 模式：① 按共同点分组（纲举目张，如「与 O2 相关」「与 H+ 相关」）；② 组内逐项挖空、保持顺序（视觉形状记忆）；③ 可选缩略助记（从词本身出发、顺口踏板）。
- **序列（补充文献·序列脚本）：** `card-seq` 生成器产「位置->元素、元素->位置、前驱、后继」卡 + 完形序列卡 + 一张全文串联测试卡；数量可配（默认精简集）。
- **背诵模式（补充文献《运用记忆系统背诵文章段落》）：** 文章/诗歌用「上文续写卡」（前 1-2 句 -> 下一句），**禁止机械逐词挖空整篇**（文献实证其乏味低效）；段落开头自动强化（首词卡、开篇短语卡、首句卡）；可选措辞赏析卡（「作者为何用 X 而非 Y」），把背诵引导为深度理解。

### 8.10 公式与数学（card-formula）

- **地标-细节两层结构（补充文献《怎样用 Anki 理解公式》）：** 先产地标卡（概念直觉、关键图像、概念抓手），再对公式**每个符号/每一项**产细节卡，最后保留一张完整公式卡；三层共享 knowledgePointId 成簇。
- **推导步骤卡（20条 规则17）：** 复杂证明/推导可拆为推导步骤序列，每步一张，训练最短推理路径。
- **变式与边界卡（补充文献《用间隔重复看穿数学概念》）：** 可选生成「改动假设会怎样」「举一个反例」「为什么实数域下证明失效」类问题，突破原定理边界。
- **渲染：** 公式统一 Markdown + KaTeX（§1 锁定），前后端一致。

### 8.11 问题-功能映射总表（设计验收清单）

> 两文档提到的每个问题都必须能在此表找到对应功能；「落点」指向本章小节与 Phase。实现顺序按 Phase 表，但**不得宣称体系完成于全部行落地之前**。

| # | 来源 | 问题 / 原则 | 软件功能 | 落点 |
|---|---|---|---|---|
| 1 | 20条#1 | 不理解就不要学 | 制卡前理解检查（blockReasons）+「先去解释」+ 前置知识卡 | §8.5 / §8.3R1 / P12-13 |
| 2 | 20条#2 | 先学后记，先建整体图景 | Topic 先于 Item 的工作流 + 整章 overview 卡 | §8.5.3 / P2 |
| 3 | 20条#3 | 从基础开始 | 前置卡 + priority 基础分 + 逐卡可设期望保留率 | §8.3R14 / P13-14 |
| 4 | 20条#4 | 最小信息原则 | L1 lint + R2 提示词 +「AI 拆分这张卡」 | §8.4 / §8.2.5 |
| 5 | 20条#5 | 完形填空 | cloze 语法 + L9 挖空上限 | P3 / §8.3R13 |
| 6 | 20条#6 | 使用图片 | 卡片图片字段 + Asset + 提示词建议配图场景 | §2 Card / P16 |
| 7 | 20条#7 | 助记技巧 | mnemonic 字段 + card-mnemonic 助记双卡 | §8.7Step6 |
| 8 | 20条#8 | 图像填空 | imageOcclusion 卡型 + 截图遮挡编辑器 | P16 |
| 9 | 20条#9 | 避免集合 | card-enum 分组拆解 + L3 | §8.9 |
| 10 | 20条#10 | 避免枚举 | 重叠挖空 + 序列卡 + L4 | §8.9 |
| 11 | 20条#11 | 对抗干扰 | 相似检索 + 对比卡 + 上下文前缀 | §8.8 |
| 12 | 20条#12 | 优化措辞 | card-wording 一键优化 + R7 + L10 | §8.2.5 / §8.7Step3 |
| 13 | 20条#13 | 联想其他记忆 | 制卡上下文注入已有卡 + R10 + 知识点簇 | §8.2.2 |
| 14 | 20条#14 | 个性化与例子 | userProfile + R9 例子必配 | §8.6 |
| 15 | 20条#15 | 借助情绪状态 | R9 允许生动/情绪化例子（仅自用） | §8.3R9 |
| 16 | 20条#16 | 上下文线索简化措辞 | contextPrefix 必填 + L5 + 禁止围绕来源设问 | §8.3R6 |
| 17 | 20条#17 | 冗余不违背最小信息 | 双向卡/多角度卡默认生成 + knowledgePointId 簇 | §8.3R8 |
| 18 | 20条#18 | 提供来源 | sourceRef 自动填充 + L6 + 卡背小字展示 | §8.2.5 |
| 19 | 20条#19 | 时间标记 | dateStamp + L12 易变内容检测 | §8.3R11 |
| 20 | 20条#20 | 确定优先顺序 | priority 0-100 + AI 建议 + leech 取舍统计 | §8.3R14 / §8.7.4 |
| 21 | 补充·精准vs一致 | 问题须精准且一致 | R3 单义性硬规则 + L7 | §8.3 / §8.4 |
| 22 | 补充·设计明晰卡片 | 例子陷阱/多正确答案/是否题 | R3 例子反转 + R4 + L2/L7 | §8.3 / §8.4 |
| 23 | 补充·Nielsen | 孤儿问题必错 | 知识点≥2卡 + L8 + 超量制卡默认 | §8.2.6 |
| 24 | 补充·Nielsen | 复习积压吓人 | 「补进度」积压均匀分散到未来 N 天 | §8.12 / P15 |
| 25 | 补充·JAnki | 边缘技术卡片占时间 | 卡组主题级暂停 + 过滤牌组临时集中复习（强记） | §8.12 |
| 26 | 补充·JAnki | 复习负担过重弃坑 | 每日复习上限可配 + 超限顺延不堆积 | §8.12 |
| 27 | 补充·Leech六步 | 反复遗忘的难点卡 | 六步处理向导 + 自动暂停 + 清理面板 | §8.7 / P14 |
| 28 | 补充·Leech | 复习中无法当场修卡 | 「标记并暂停」一键 + CardIssue 池 | §8.7.2 |
| 29 | 补充·Andy | 卡片应聚焦/可控/费工夫 | R2/R3/R7 硬规则 + lint 全套 | §8.3 / §8.4 |
| 30 | 补充·Andy | 超量制卡经验法则 | 默认 2-4 卡/知识点，单批上限 10 可配 | §8.2.6 |
| 31 | 补充·Andy | 迭代式写卡、随时间修订 | 「补充制卡」+「标记待改」+ 编辑会话 + 编辑历史 | §8.2.7 / P15 |
| 32 | 补充·Andy | 假阳性/假阴性（模式匹配、歧义） | L10 问题长度 + R3 + R6 禁依赖来源 | §8.4 |
| 33 | 补充·Andy | 开放式清单/启明卡/创意卡 | application 卡型（R15）+ 标签式关联 | §8.3R15 / §2 |
| 34 | 补充·枚举实例 | 枚举分类+缩略助记 | card-enum 三步（分组/顺序挖空/助记） | §8.9 |
| 35 | 补充·政史地 | 大块知识整散结合 | 主卡+辅助卡 = knowledgePointId 簇 | §8.2.5 |
| 36 | 补充·背诵段落 | 机械完形低效、开头难 | 续写卡背诵模式 + 首句强化 + 措辞赏析卡 | §8.9 / P16 |
| 37 | 补充·统计公式 | 公式死记硬背风险 | card-formula 地标+符号两层 | §8.10 / P16 |
| 38 | 补充·看穿数学 | 单角度理解不足 | 变式/边界卡 + 多角度表述（R8） | §8.10 |
| 39 | 补充·渐进阅读经验 | Y型多解问题、语义模糊 | R3 + R6 添加限定条件；逻辑综合题先拆事实卡 | §8.3 |
| 40 | 补充·20周年版 | 渐进简化、知识达尔文主义 | 渐进措辞优化（编辑历史）+ 知识点簇淘汰冗余 | §8.2.7 / P15 |
| 41 | 补充·元规则 | 学习乐趣下降即违规 | 「不再关心」标记 + 定期清理提示 + 混编洗牌 | §8.12 |
| 42 | 补充·按来源组织 | 牌组组织方式 | 卡组默认按 LibraryItem 来源组织 + 全局混编选项 + tags 多维过滤 | §8.12 |
| 43 | 补充·间隔重复实践 | 序列记忆脚本化 | card-seq 生成器 | §8.9 / P16 |
| 44 | 补充·间隔重复实践 | 缓存自己的见解 | 洞见走手动/AI 制卡路径，标 tags:['insight'] | §8.2.8 |
| 45 | 用户要求 | 阅读中选中文本让 AI 解释，回答可加回材料 | AI 解释侧栏 + 「插入原文」回写为正式材料 | §8.5 / P12 |
| 46 | 用户要求 | AI 制卡替代手动制卡，严格遵从原则 | CardGeneratorProvider + §8.3 锁定提示词 + CardLint + 预览确认 | §8.2-8.4 / P13 |

### 8.12 复习体验元规则（乐趣 / 积压 / 诚实）

- **补进度：** 到期积压超阈值时一键把积压卡均匀分散到未来 N 天（默认 7），界面不展示惩罚性大数字（Nielsen：「希望 Anki 有而未有的功能」）。
- **每日上限：** 可配（默认关闭，建议 40）；超限自动顺延到次日，不堆积、不挫败（对应 JAnki「降低强度」）。
- **全局混编：** 复习队列跨来源洗牌选项（对应「一个大牌组」实践）；保留按来源/标签过滤牌组做临时集中复习（强记模式，对应「考前突击/项目前重拾边缘技术」）。
- **保持诚实：** Again 按钮文案不带惩罚语言；评分 purely 用户自评，软件不做道德评判（对应「保持诚实/乐趣」元规则）。
- **情绪联系维护：** 卡片可标「不再关心」；leech 清理面板与编辑会话定期提示清理这类卡（「直接砍掉是最佳做法」）。

## 9. Topic 队列优先级与推迟调度（v7 新增，设计确认）

> 用户确认的两项设计承诺。第一版实现（Phase 2）中优先级固定 50、推迟间隔固定 ×1.6 均为**占位**，按本节规格在 Phase 2.x 替换。

### 9.1 摘录优先级（手动 + 默认）

1. **摘录时手动设置：** 阅读器/摘录卡中执行摘录时，摘录确认区提供优先级选择（默认值 = 设置中的默认优先级，不强制展开——高级用户可折叠）。走 `ReadingWorkflowProvider.setPriority()` 接口（已预留），换流程不改 UI。
2. **默认优先级设置项：** `SettingsStore` 新增 `app.extractDefaultPriority`（默认 50，范围 0-100）；设置页「阅读与队列」区块提供调整。
3. **队列中可改：** 学习队列的每条 Topic 显示当前优先级（已实现），Phase 2.x 补「行内修改优先级」。
4. **与卡片优先级的关系：** Topic 的 priority 服务于阅读推送顺序（SM19 语义，0 最高 100 最低或反之以实现为准并前后一致）；Card.priority 按 §8.3 R14 独立体系，二者不混用。

### 9.2 负载感知推迟算法（科学化调度，替换固定 ×1.6）

推迟天数的计算**必须**综合以下因素（实现时全部走 `ReadingWorkflowProvider` 内部，UI 不感知）：

| 因素 | 作用 | 来源 |
|---|---|---|
| 当前优先级 priority | 高优 Topic 推迟更短（先回来），低优更长；边界：0-30 / 31-70 / 71-100 三档基础间隔 | §8.3 R14 精神 |
| 当日到期负载 dueLoad | 今日到期 Topic+Item 总量超「每日预算」（§8.12 每日上限同源配置）时，推迟间隔拉长、并把回推日期分散到未来多天，避免制造新的堆积峰值 | §8.12 补进度/每日上限 |
| 历史推迟次数 postponeCount | 随推迟次数增长逐步拉长间隔（含轻微随机抖动 ±10% 防止整批同日回堆）；连续被推迟的 Topic 提示「考虑删除或降优先」（知识达尔文主义，§8.11 #40） | 20条#20 / 补充·20周年版 |
| 内容密度 contentDensity | 摘录字数/信息单元多者允许更短回访间隔（长文一次读不完） | SM19 摘录语义 |
| 间隔上限 | 180 天封顶（防遗忘）；手动推迟不受自动上限约束 | 现有实现保留 |

- **实现顺序：** Phase 2.1（摘录时优先级 + 默认优先级设置 + 队列行内改优先级）→ Phase 2.2（负载感知推迟替换 ×1.6，含抖动与负载分散）。
- **验收：** 2.1 = 摘录时可选优先级且重启保留；2.2 = 在高负载日构造 >预算 的到期量，推迟结果自动分散且高优先回。

## 10. AI 制卡执行架构（v9 新增，锁定设计）

### 10.1 制卡管线的步骤定义（回答"有哪些步骤"）

AI 制卡 = **固定顺序的管线编排**，共 7 步：

| # | 步骤 | 执行位置 | 实现现状 |
|---|---|---|---|
| 1 | 模式路由（auto 检测公式/序列/枚举，选 card-* 模板） | 渲染层 `detectMode()`，纯本地规则 | ✅ 已实现 |
| 2 | 取提示词（`PromptTemplate` 表按 scope 取默认版本） | 渲染层 → IPC → SQLite | ✅ 已实现 |
| 3 | 上下文打包（材料+来源+已有卡+用户画像+联网背景） | 渲染层 `ContextProvider` 段 | ✅ 已实现（联网背景 v9 增补） |
| 4 | LLM 流式生成（严格 JSON，经 AIGateway 主进程转发） | 主进程 `ai.js`（Key 解密/HTTPS/流转发） | ✅ 已实现（v9 起带字数进度显示） |
| 5 | JSON 解析 + 容错（截取首尾大括号） | 渲染层 `extractJson()` | ✅ 已实现 |
| 6 | CardLint 质检（L1-L12 纯本地）+ 相似查重（n-gram） | 渲染层 `lintCard()` + IPC | ✅ 已实现 |
| 7 | 用户确认入库（逐张接受/编辑/整批拒绝 → AIGenBatch 状态流转） | 渲染层预览面板 + IPC | ✅ 已实现 |

### 10.2 需不需要内置 AI Agent？

**不需要，且明确不采用**。理由：

1. **流程是确定的**：7 步顺序固定、无分支循环，管道编排天然够用；Agent（LLM 自主决定下一步）适用于开放式任务，此处引入只会增加不可控性与延迟。
2. **可审计性**：管线每步的输入输出都可落库（AIGenBatch），Agent 的多轮自主决策难以完整留痕。
3. **成本**：管线 = 1 次 LLM 调用；Agent 循环 = N 次调用 + 工具往返，制卡场景不值。
4. **预留**：若未来出现真正需要自主性的环节（如 Phase 12 的多轮追问升级为自主检索），在 `CardGeneratorProvider` 接口内换一个 Agent 实现即可——接口不变，UI 不变。

### 10.3 各步骤的执行环节（回答"什么环节执行哪个步骤"）

- **1-3 在渲染进程**（拿到选中文本后立即执行，纯本地，毫秒级）；
- **4 在主进程**（唯一网络出口：解密 Key、发 HTTPS、SSE 流式转发——Key 不进渲染层）；
- **5-6 回渲染进程**（流结束后立即本地解析+质检，毫秒级）；
- **7 在渲染进程**（等用户操作，不阻塞）。
- 瓶颈唯在第 4 步服务端生成：实测（Command Code Provider + z-ai/glm-5.3-flash）短问答 TTFB≈5s，完整制卡流式输出约 45-60s/3800 字——属模型侧延迟，UI 以流式字数进度如实呈现。

### 10.4 实现现状结论（回答"是否真正实现了这些步骤"）

7 步全部真实实现、有对应代码与数据落点；v9 增补两点：第 3 步新增可选联网背景检索（§10.5）；第 4 步新增流式字数进度。已知限制：图像遮挡编辑器（Phase 16 的画框 UI）未做；多挖空制卡的 c2/c3 快捷标记待补。

### 10.5 联网事件背景检索（v9 新增）

- **触发：** 制卡结果 `blockReasons` 非空（模型判定缺事件背景/前置知识）时，预览面板出现「搜索网络补充背景后重试」按钮；用户主动点击，不自动联网。
- **实现：** 主进程 DuckDuckGo HTML 端点抓取（无 Key、纯本地请求、截取前 6 条标题+摘要），注入提示词的【联网检索到的事件背景】段（明确标注"仅供理解，禁止编造来源"）后重新走管线。
- **边界：** 不做自动多轮 Agent 检索；检索结果只作理解上下文，来源以原材料为准（R11）。


## 11. FSRS 调度与复习队列契约（v11 新增，锁定设计）

> 本章源于调度正确性测试（tests/fsrs/REPORT.md，2026-09-06）暴露的 F1-F5 缺陷。FSRS 是本软件的核心资产，调度错误直接摧毁产品价值；本章条款为硬性契约，任何涉及调度的改动不得违反。

### 11.1 FSRS 状态全量持久化契约（修复 F1）

- §2 `Card.fsrs{D,S,R,due,lapses,state}` 的**每一个字段都必须持久化、且在下一轮调度时全量回填**。ts-fsrs 的间隔计算依赖稳定性 S 与难度 D，丢任何字段 = 调度输入错误。
- 持久化格式：`fsrs_json` 至少含 `{state, due, lapses, stability, difficulty, reps, lastReview}`（对应 ts-fsrs Card 的 state/due/lapses/stability/difficulty/reps/last_review）；库版本升级新增字段时须写一次性迁移回填历史卡。
- 禁止「部分字段序列化 + createEmptyCard() 兜底重建」的实现——新卡兜底只允许出现在**首次创建**时。

### 11.2 fuzz 策略锁定（修复 F2）

- `enable_fuzz` 锁定为 **false**。理由：本应用把「预览间隔」直接展示在评分按钮上，fuzz 的随机抖动使预览值偏离算法真实值、且预览与实际调度两次计算因种子不同而互不一致，破坏「所见即所存」。
- 若未来要开 fuzz，必须同时满足：预览与实际调度共用同一次计算结果（§11.3），且在设置中向用户明示「间隔含随机抖动」。先改本文档再改代码。

### 11.3 预览与实际调度同源（修复 F2 的展示面）

- 评分按钮上的预览间隔与点下按钮后实际写入的 due **必须来自同一计算结果**，禁止两次独立调用引擎（两次调用的 `new Date()` 与 fuzz 种子不同）。
- 实现形态不限定（推荐：预览时缓存四档完整结果，评分时取对应档），但「同一轮复习内预览=落库」是验收硬条件。

### 11.4 leech 标记不得覆写调度状态（修复 F3）

- 复习中触发 leech 标记（自动或手动「标记并暂停」）时，只允许**字段级更新 leech/suspended 相关字段**（`leech_json`），禁止把复习前取的整卡快照（含旧 fsrs 状态）回写。
- 一般规则：**任何「复习后附加动作」（leech 标记、issue 记录、通知）都不得修改 `fsrs_json`**；需要改卡内容时，先取数据库最新状态再合并，不用组件内存快照。

### 11.5 到期队列排序与轮询（修复 F4/F5）

- 到期队列（复习视图）排序 = **due 升序**（最早到期的先复习），同 due 按 priority 降序。禁止按 created_at 排序。
- 复习视图须周期性轮询到期变化（间隔 30-60s），learning step（1m/10m）到期后无需手动切换视图即应出现。

### 11.6 核心调度回归测试套件（修复「无测试义务」缺口）

- `tests/fsrs/` 黄金参考对照套件为调度正确性的验收工具：L0 参数基线 + 黄金剧本（golden.json）、L1 适配层往返连续性（含长间隔决定性场景）、L2 数据库集成（沙盒 userData）、L4 review_logs 重放审计；UI 层（L3）按需手工/半自动执行。
- 调度相关任何改动（fsrs 封装、db 卡片字段、复习视图评分链）合入前必须全绿：`node tests/fsrs/golden.cjs && node tests/fsrs/adapter.test.cjs && node tests/fsrs/adapter.long.test.cjs && npx electron tests/fsrs/db.test.cjs && node tests/fsrs/audit.cjs`。


## 附录A — 参考项目网址（锁定，后续开发按此查）

- xiadown（UI/登录/Cookie/播放/音乐母版）：https://github.com/arnoldhao/xiadown
- Bili.Copilot（B站客户端/AI总结思想）：https://github.com/Richasy/Bili.Copilot
- bili-kernel（仅当API字典查WBI/DASH，不直接集成）：https://github.com/Richasy/bili-kernel
- Bilibili-Obsidian-Clipper（字幕+AI总结管线，直接抄）：https://github.com/haixiong1997/Bilibili-Obsidian-Clipper
- MinerU云API文档：https://mineru.net/apiManage/docs
- MinerU开源版：https://github.com/opendatalab/MinerU
- FSRS算法组织：https://github.com/open-spaced-repetition ；TS库 `ts-fsrs`，Rust库 `fsrs-rs`
- Obsidian Clipper（剪藏母版）：https://github.com/obsidianmd/obsidian-clipper
- Omnivore（Readability+高亮模型参考）：https://github.com/omnivore-app/omnivore
- Hypothesis（标注锚定参考）：https://github.com/hypothesis/browser-extension
- Memex（全文检索收件箱参考）：https://github.com/WorldBrain/Memex
- Moodist（内置背景音，直接集成）：https://github.com/remvze/moodist
- Endel（仅外链）：https://app.endel.io/
- Z-library入口与说明：https://zh.articles.sk/ ；https://zh.articles.sk/z-access#useful_link_tab
- Anna's Archive：https://zh.annas-archive.gl/
- Logseq/Obsidian插件市场机制参考：Logseq marketplace / obsidian-releases
- Z-library单点登录说明 singlelogin：https://singlelogin.co （以Z-Access页为准，谨防钓鱼）

## 附录B — EPUB实现备忘（供Phase 4b用，现在不写代码）

- 首选 `@likecoin/epub-ts`：https://github.com/likecoin/epub.ts （`epub.js` 的TS重写，API兼容，`import ePub from '@likecoin/epub-ts'`，渲染 `book.renderTo(el)`，Node解析用 `@likecoin/epub-ts/node` + `linkedom`）。
- 原版对照：https://github.com/futurepress/epub.js/ ；备选：https://github.com/intity/epub-js ，https://github.com/Treinetic/TreineticEpubReader
- 流程：读 ArrayBuffer -> JSZip解包 -> container.xml/OPF -> spine章节XHTML -> 转Markdown入库（复用第1章管线）-> TOC存 `tocJson`，位置存 CFI/location ->  frozen 原包存 `Asset{kind:epub-original}` 做对照。
- 注意：DRM书跳过并提示；大书按章节懒加载；样式经 `UiAdapter` 脱敏，不直接套用出版社CSS。
