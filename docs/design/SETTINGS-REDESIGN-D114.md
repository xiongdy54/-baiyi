# 设置页信息架构与排版重设计 · 设计稿（D114，v1）

> 日期：2026-10-07 · 作者：ui-ux-architect · 状态：**待实施**（D114；建议版本 **v48.70**）。
> 决策登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D114**（条目草稿见 §14，由主控誊写）。
> 视觉基准：`docs/swiss-international-style.md`（布局模式库「设置页：左锚点导航 + 720px 内容列，分组 card-fill」）+ GUIDE §5.1/§5.3。
> 动效基准：dylantarre/animation-principles skill 体系 8 篇（§11 逐条引用）；与瑞士风动效规则冲突处**以项目规范为准**（§11.0 裁决表）。
> 范围：**纯表现层 / 信息架构层**。不改任何 IPC、设置键名、存储结构、归一函数、业务逻辑；不删任何设置项。

---

## 0. 用户原话（2026-10-07，逐字留痕）

「现在设置页面的排版布局还有功能归类太乱了，请从dylantarre/animation-principles这个仓库里寻找相关的skill，加载所需的全部skill，完全从头设计整个设置页面，功能分类也要重新归类。不必要的说明文字全部去掉，必要的说明以鼠标悬停时显示的方式呈现。」

## 1. 用户目标 → 本稿落点

| # | 用户决策 | 本稿落点 |
|---|---|---|
| 1 | 排版布局完全重做 | §6 页面结构（分组 card-fill 内容列 + 双层锚点导航 + 行网格） |
| 2 | 功能归类重新归类 | §5 新信息架构：14 项平铺导航 → **5 组 13 项**；4 个无导航孤儿区块收编；映射表 §5.3 覆盖率 100% |
| 3 | 不必要的说明文字全部去掉 | §9 文案处置表：逐条 form-hint → 删除 / 转 tooltip / 保留行内（契约与状态文字保留） |
| 4 | 必要说明改悬停提示 | §8 tooltip 交互规格（自定义组件，hover + 键盘 focus 双路触发） |
| 5 | 动效引用 animation-principles skill | §11 动效章节（8 篇 skill 原理 → 适用点 + 项目 Token 落地） |

## 2. 当前问题（逐条证据）

证据均指向 `src/components/SettingsPanel.tsx`（2541 行版）与 `src/theme.css`。

| # | 问题 | 证据 |
|---|---|---|
| P1 | **4 个区块是导航孤儿**：`卡面信息密度`/`标签功能`/`摘录复习`/`每日上限` 在 DOM 里存在，`sections` 导航数组（L2364-2381，14 项）没有它们的入口——滚轮能碰到、导航点不到，与 v45 修复前的「皮肤/强调色」缺陷同型（该修复注释见 L2362-2363，但后来新增的四个区块重蹈覆辙） | sec-cardface L657 / sec-tags L703 / sec-extracts L757 / sec-limits L868 对照 L2364-2381 |
| P2 | **导航会说谎（滚动高亮盲区）**：滚动监听只跟踪有导航项的 section（L2392-2395 按 navIds 过滤），滚过 4 个孤儿区块时高亮停留在错误项 | L2389-2433 |
| P3 | **归类按开发批次堆叠，不按用户心智**：复习域的 6 个区块被拆散在导航各处——「学习日」夹在「统计仪表盘」与「同源卡延后」之间（L2512-2514）、「每日上限」排在「AI 服务」之后（L2521）、「卡面/标签/摘录复习」无入口；「全局快捷键」与「快捷键」是同一主题两个导航项两个区块（L2533/2535） | 渲染顺序 L2508-2535 |
| P4 | **粒度失衡**：「外观」组占 3 个导航项但每节只有 2-3 个控件（L2473-2506）；「AI 服务」一节是整个子应用；「标签功能」一节只有一个开关 | L2464-2481, L328-511, L703-721 |
| P5 | **教程式静态长文遍地**：同源卡延后 3 行记忆课（L579-583）、摘录引擎 6 行实验说明（L806-811）、每日上限 4 行硬边界论文（L870-874）、标签 3 行（L705-708）、阅读节每个控件后跟一行 hint（L1337/1356/1372/1393/1409/1425/1501/1521）——违反 GUIDE §5.3「设置页：说明性文字只保留『操作必需』，删除教程式长文」 | 全文 53 处 `.form-hint` JSX 用法，其中**静态说明类 19 处**（§9 处置表逐条列出），其余为状态输出/操作必需/错误文案 |
| P6 | **节内无二级结构**：sec-reader 一节 17 个控件单列平铺（L1320-1560），外观/交互/摘录卡三种主题混排；sec-dict 四个 h4 之外仍有一条 40+ 行的连续流 | L1320-1560, L1916-2013 |
| P7 | **视觉不符合同**：布局模式库指定设置分组用 card-fill，现行实现是 hairline 分隔的透底节（theme.css L1592-1598）；节与节之间只有 `margin-top 32` + 底线，分组感弱 | `docs/swiss-international-style.md`「布局模式库·设置页」 vs theme.css L1592-1598 |
| P8 | 全部说明无键盘/触屏等价通道（原生散落的 `.form-hint` 段落靠阅读顺序，改为 tooltip 后必须补 focus 触发——本稿 §8.4 解决） | — |

## 3. 设计语言基准

- 形状/色/字/距全部走既有 Token（`--paper`/`--grey-*`/`--accent`/`--fs-*`/`--sp-*`），**零新增色值、零圆角、零阴影（浮层除外）**。
- 分组容器：`card-fill`（`--grey-1` 直角底，swiss 卡片四类之「默认中性」），多卡并列同类——符合布局模式库。
- 密度档：comfortable（控件高 32/40，同现状）；同页不混档。
- 动效：全部新动效规则写在 `@media (prefers-reduced-motion: no-preference)` 内；缓动/时长一律走 Token（§5.1 D88 族 + 本稿新增 3 枚，§11.2），组件禁裸写贝塞尔/时长。

## 4. 现行设置项全量清单（逐节盘点，映射的源）

> 「行号」= SettingsPanel.tsx；「测试钩」= GUI 测试依赖的选择器/文案（§12 逐文件展开）。控件共 **66 项**，全部只重排、不删减。

### 4.1 sec-appearance 主题模式（L2473-2483）
| # | 设置项 | 控件 | 键 / 来源 | 测试钩 |
|---|---|---|---|---|
| 1 | 主题模式 浅色/深色 | seg-tabs ×2 | Props.theme → onThemeChange（theme.mode） | — |

### 4.2 sec-skin 皮肤（L2485-2498）
| 2 | 皮肤选择 | skin-list 按钮 ×N | Props.skinId → onSkinChange（app.skinId） | — |

### 4.3 sec-accent 强调色（L2500-2506）
| 3 | 自定义强调色 | color input | Props.accentColor → onAccentChange（app.accentColor） | — |
| 4 | 恢复默认强调色 | button | onAccentChange("") | — |

### 4.4 sec-reader 阅读（L1260-1562，17 项）
| 5 | 多段选择修饰键 | Dropdown | app.multiSelectKey | — |
| 6 | 默认标注模式 高亮/摘录+高亮 | seg-tabs | app.annotateMode | data-annot-mode（读侧同名钩在 Reader.tsx L1383-84，设置侧钩无测试引用） |
| 7 | 默认标注形式 高亮/下划线 | seg-tabs | app.annotateForm | — |
| 8 | 批注色板（≤8 色有序） | swatch 按钮 ×10 | app.annotatePalette | — |
| 9 | 自定义取色 显示/隐藏 | seg-tabs | app.annotateCustomEnabled | — |
| 10 | 批注栏默认筛选 全部/摘录/高亮 | seg-tabs | app.annotationFilter | — |
| 11 | 阅读主题预设 纸白/羊皮/暗夜/自定义 | seg-tabs | app.readerSettings.appearance.theme | — |
| 12 | 自定义背景/文字色 | color ×2 | appearance.bgColor / fgColor | —（条件：theme=custom） |
| 13 | 阅读字号 12-32 | range | appearance.fontSize | — |
| 14 | 正文字体 | text input | appearance.fontFamily | — |
| 15 | 摘录卡编辑工具栏 | checkbox | app.extractEditorToolbar | **data-testid=setting-extract-editor-toolbar**（须在 #sec-reader 内，extract-editor.gui L586/600） |
| 16 | 工具栏形态 悬浮 | checkbox | app.extractEditorToolbarFloat | **data-testid=setting-extract-editor-toolbar-float** |
| 17 | 工具栏固定位置 顶部 | checkbox | app.extractEditorToolbarTop | **data-testid=setting-extract-editor-toolbar-top** |
| 18 | 阅读器选区动作组 悬浮 | checkbox | app.readerActionsFloat | **data-testid=setting-reader-actions-float** |
| 19 | 摘录卡字号跟随阅读界面 | checkbox | app.extractFaceFontFollow | **data-testid=setting-extract-font-follow** |
| 20 | 摘录卡字号 10-40 | range | app.extractFaceFontSize | **data-testid=setting-extract-font-size**（条件：19 关） |
| 21 | 摘录卡字体 | text input | app.extractFaceFontFamily | **data-testid=setting-extract-font-family**（条件：19 关） |

### 4.5 sec-widgets + sec-dashreset 统计仪表盘（L93-173）
| 22 | 组件可见性（每组件） | checkbox ×N | dashboard.hiddenWidgets | — |
| 23 | 组件宽度 宽幅/窄幅（每组件） | seg-tabs-sm ×N | dashboard.layout.sizes | — |
| 24 | 恢复默认排列与宽度 | button | dashboard.layout = null | — |

### 4.6 sec-learningday 学习日（L516-548）
| 25 | 新一天起点 0-23 时 | Dropdown ×24 | app.dayCutoffHour | — |

### 4.7 sec-siblingbury 同源卡延后（L552-631）
| 26 | 同源卡延后 开/关 | seg-tabs-sm | app.siblingBury.enabled | **#sec-siblingbury 内首个 .seg-tabs 的「开/关」**（m12.gui L139/146） |
| 27 | 新卡同源延后 | checkbox | siblingBury.newCards | — |
| 28 | 复习卡同源延后 | checkbox | siblingBury.reviewCards | — |
| 29 | 同源组每日放行 1-20 张 | number | siblingBury.perDay | — |
| 30 | 短材料阈值 50-100000 字符 | number | siblingBury.sourceTextLimit | — |

### 4.8 sec-cardface 卡面信息密度（L635-682）
| 31 | 显示助记 | checkbox | app.cardFaceExtras.mnemonic | **data-cf-mnemonic**（d104.gui L100，document 级查询） |
| 32 | 显示例子 | checkbox | app.cardFaceExtras.example | **data-cf-example**（同上） |
| 33 | 显示来源 | checkbox | app.cardFaceExtras.sourceRef | data-cf-source |

### 4.9 sec-tags 标签功能（L688-721）
| 34 | 启用标签功能 开/关 | seg-tabs-sm | app.tagsEnabled | **data-testid=tags-enabled-toggle + data-tags-on / data-tags-off**（d107.gui L54，document 级查询） |

### 4.10 sec-extracts 摘录复习（L726-819）
| 35 | 并入复习队列 开/关 | seg-tabs-sm | app.extracts.mergeIntoReview | **#sec-extracts 内首个文本「开」按钮**（extract.gui L263） |
| 36 | 混编规则 上限1:4/按到期 | Dropdown | app.extracts.interleave | — |
| 37 | 摘录推送引擎 | Dropdown | app.extracts.engine | **选项按钮含「SuperMemo 传统推送」/「AI 推送」**（extract.gui L586/600；label 常量 EXTRACT_ENGINE_LABEL 不动） |
| 38 | AI 重排 立即重排 | button | rerankExtractsNow() | **[data-rerank-now]**（extract.gui L593） |

### 4.11 sec-limits 每日上限（L824-907）
| 39 | 每日新卡片上限 | number | app.limits.newCardsPerDay | **#sec-limits 内 input[type=number] 序位 0**（extract.gui L282 setNum(0)） |
| 40 | 每日卡片复习上限 | number | app.limits.cardReviewsPerDay | **序位 1**（setNum(1) → 硬边界拒存） |
| 41 | 每日新摘录上限 | number | app.limits.newExtractsPerDay | 序位 2 |
| 42 | 每日摘录处理上限 | number | app.limits.extractReviewsPerDay | 序位 3 |
| 43 | 复习上限用尽后仍发新卡与新摘录 | checkbox | limits.ignoreReviewLimitForNew | — |
| 44 | 今日已用（四类用量+阻塞态） | 只读状态行 | fetchLimitsState() | 状态文字，保留 |

### 4.12 sec-ai AI 服务（L175-512）
| 45 | 供应商预设（4 分组 ×15 项） | skin-list 按钮 | aiGateway.setConfig({preset}) | **.ai-preset-group-label=「官方云服务/聚合平台/本地运行时/通用」；.ai-preset-group .skin-list button=15；.ai-preset-name 首位=硅基流动**（d112.gui L93-101） |
| 46 | Key 创建链接 | form-hint 内 `<a>` | presetMeta.keyUrl | 操作必需，保留行内 |
| 47 | 检测本地服务 | button | aiGateway.detectLocal() | **#sec-ai 内文本「检测本地服务」→「检测中…」**（d112.gui L114-121） |
| 48 | 本地探测结果 | ai-test-ok/fail | LocalDetectResult | 状态文字 |
| 49 | Base URL（custom 预设） | text input | cfg.baseUrl | —（条件：preset=custom） |
| 50 | 服务地址（local 预设）+ /v1 校验 | text input + 错误行 | cfg.baseUrl | —（条件：preset=local；/v1 警告=错误状态，保留） |
| 51 | 模型名 + 拉取列表下拉 | text input + model-dropdown | cfg.model | — |
| 52 | 思考强度 低/中/强 | seg-tabs ×3 | cfg.reasoningEffort | —（条件：model 匹配 GLM-5.2+） |
| 53 | API Key | password input | cfg.apiKey（save 后清空） | — |
| 54 | 保存配置 / 测试连接 / 拉取模型列表 | button ×3 | handleSave/Test/FetchModels | busy 文案「保存中…/测试中…/拉取中…」 |
| 55 | 测试/切换结果 | ai-test-ok/fail | notice | 状态文字（d112 G3 依赖「已切换服务」） |

### 4.13 sec-dict 词典/下载（L1816-2013）
| 56 | 词典来源 本地/在线/自动 | seg-tabs | app.dictMode | **#sec-dict 内首个 .seg-tabs**（m7.gui L87） |
| 57 | 弹窗显示字段 | check-inline ×N | app.dictPopupFields | — |
| 58 | 发音来源 系统TTS/在线音频 | seg-tabs | app.dictAudioSource | — |
| 59 | 自动发音 | checkbox | app.dictAutoSpeak | — |
| 60 | 一键下载（目录行 ×N + 下载/更新按钮） | dict-catalog-row | dictAPI.download() | 行文案（大小/简介/推荐）被 m7 断言「齐备」 |
| 61 | 本地导入词典文件 | button | dictAPI.importFile() | — |
| 62 | 已安装词典（启用/停用/删除） | dict-catalog-row ×N | dictAPI.toggleSource/removeSource | — |

### 4.14 sec-memory 用户记忆（L912-1122）
| 63 | 用户记忆 开/关 | seg-tabs-sm | memoryApi.setEnabled | **#sec-memory 内 .seg-tabs-sm「开/关」**（m14 L100/144/179） |
| 64 | 文件位置 + 打开文件夹/打开 core.md | mono 路径 + button ×2 | memoryApi.openFolder/openFile | span.mono（m14 L105） |
| 65 | 立即整理（待处理 N 条） | button | memoryApi.tidyNow | 文本「立即整理」（m14 L160） |
| 66 | 记忆用量 | 只读状态行 | status.usage | 保留 |
| 67 | 注入预算 200-20000 字 | number | app.memory.injectBudget | — |
| 68 | 补处理进度 + 中止 | 状态行 + button | backfillCancel | 保留（§6.7.2 契约） |
| 69 | 重置记忆 清空记忆文件…→确认清空/取消 | 两段确认 | memoryApi.reset | 文本「清空记忆文件」「确认清空」（m14 L167/171） |
| 70 | 首次开启说明（已知悉，开启/取消） | 确认面板 | introAcked | 文本「开启用户记忆前请了解」「已知悉，开启」（m14 L101/151）+「补处理预估」「暂不」（L102/156） |

### 4.15 sec-fsrs FSRS 参数优化（L1125-1241）
| 71 | 复习记录数 / 当前参数来源 | 只读状态行 | optimizerAPI.stats/current | 保留 |
| 72 | 开始优化（训练进度%） | button | optimizerAPI.train | — |
| 73 | 应用优化结果 | button（条件：训练完成） | optimizerAPI.apply | — |
| 74 | 恢复默认 | button（条件：source=optimizer） | optimizerAPI.reset | — |
| 75 | logLoss/RMSE | 只读状态行 | metrics | 保留 |

### 4.16 sec-backup 备份与恢复（L1614-1813）
| 76 | 当前数据统计 | 只读状态行 | backupAPI.info | 保留 |
| 77 | 立即备份 | button | backupAPI.create | — |
| 78 | 包含 AI Key | checkbox | includeKey（备份参数，非落库键） | — |
| 79 | 打开备份文件夹 / 更改备份位置 | button ×2 | openDir/pickDir（app.backupDir） | — |
| 80 | 每日首启自动备份 开/关 | seg-tabs-sm | app.autoBackupEnabled | — |
| 81 | 保留份数 1-90 | number | app.autoBackupKeep | — |
| 82 | 备份列表（手动/自动/安全标签 + 恢复） | backup-row ×N | backupAPI.list | **#sec-backup .backup-row + 每行「恢复」按钮 ≥3**（m2.gui L117/119） |
| 83 | 确认恢复 / 从备份文件恢复… | 确认面板 + button | backupAPI.restore/pickFile | — |
| 84 | 重启应用（恢复完成后） | button | backupAPI.relaunch | — |

### 4.17 sec-global 全局快捷键（L2153-2350）
| 85 | 快速记录 启用+键位+恢复+状态 | checkbox + kb-key + kb-reset + gs-state | app.globalShortcuts.quickCapture | **#sec-global 内 .kb-key[0] 可点；文案含 Ctrl+Alt+Space**（m8 L265-268） |
| 86 | 失焦自动隐藏 | checkbox | quickCapture.hideOnBlur | — |
| 87 | 添加学习材料 启用+键位+恢复+状态 | 同上 | globalShortcuts.addMaterial | 文案含 Ctrl+Alt+N（m8 L265） |
| 88 | 随系统启动 | checkbox + 状态 | globalShortcuts.autoLaunch | — |
| 89 | 试一下快速记录 | button | shortcutsApi.toggleCapture | — |
| 90 | 冲突提示 | kb-conflict | 捕获校验 | **#sec-global .kb-conflict**（m8 L277） |

### 4.18 sec-shortcuts 快捷键（L2016-2121）
| 91 | 全部恢复默认 | button | commandRegistry.resetAll | — |
| 92 | 应用内键位 14 行（阅读 5 + 复习 9） | kb-row ×14（kb-key/kb-reset/kb-conflict） | app.keybindings | **.kb-row-title「评分 Good/Hard」；.kb-key；.kb-conflict；.kb-reset**（m4 L383-412）；**m4 L378 断言 document 级 .kb-row === 13**（见 §12-T7：与现状 14+3=17 已不符，属既有失真，随迁移一并对齐） |

> 清单合计 92 个条目（66 个可操作控件 + 26 个只读状态/条件块）。§5.3 映射表按区块级给出去处，区块内条目随区块整体迁移，条件渲染关系一律原样保留。

## 5. 新信息架构

### 5.1 分类原则

1. **按用户心智分域，不按开发批次**：界面长什么样 → 怎么读 → 怎么学与调度 → 智能能力 → 数据安全与效率。
2. **每个导航项必须对应 DOM 里真实存在的区块**（消灭 P1/P2 孤儿）；区块数 = 导航项数 = 13。
3. 同域低频小节**物理合并**（h4 子块），合并只发生在无测试钩或钩子可随迁的区块上（§5.3 逐条标注）。
4. 组名与组内项名 ≤ 6 字，避免与既有测试的精确匹配冲突（§5.4 冲突核查）。

### 5.2 新分类树（5 组 13 项）

```
设置
├─ 界面
│  └─ 主题与颜色        ← sec-appearance ∪ sec-skin ∪ sec-accent（物理合并；h4：主题模式 / 皮肤 / 强调色）
├─ 阅读
│  └─ 阅读              ← sec-reader（id 不变；节内新增 h4 三分组：阅读外观 / 选区与批注 / 摘录卡编辑器）
├─ 复习与调度
│  ├─ 摘录复习          ← sec-extracts（id 不变）
│  ├─ 每日上限          ← sec-limits（id 不变）
│  ├─ 调度规则          ← sec-learningday ∪ sec-siblingbury（物理合并为 sec-schedule；h4 内层保留 id sec-learningday / sec-siblingbury）
│  ├─ 卡面与标签        ← sec-cardface ∪ sec-tags（物理合并为 sec-cardtags；h4 内层保留 data-cf-* / tags-enabled-toggle 钩）
│  └─ FSRS 优化         ← sec-fsrs（id 不变）
├─ 智能
│  ├─ AI 服务           ← sec-ai（id、内部结构、四分组渲染零改动）
│  ├─ 词典与查词        ← sec-dict（id 不变；原「词典/下载」改名）
│  └─ 用户记忆          ← sec-memory（id 与结构零改动；§6.7.1 契约）
└─ 数据与效率
   ├─ 备份与恢复        ← sec-backup（id 不变）
   ├─ 快捷键            ← sec-global ∪ sec-shortcuts（物理合并为 sec-shortcuts；h4「应用内快捷键」+ h4「全局快捷键」内层保留 id sec-global）
   └─ 统计仪表盘        ← sec-widgets ∪ sec-dashreset（物理合并；「恢复默认排列」成为组内一行）
```

要点：
- **摘录复习 / 每日上限 / 卡面与标签 / 调度规则归入「复习与调度」**——学习日与上限同口径（都按学习日切点计算），同源卡与混编同属队列策略，卡面/标签是复习呈现开关。
- **FSRS 优化属调度域**（训练的是调度权重），排在组尾（低频高级操作）。
- **用户记忆归「智能」**：它是 AI 自动维护能力（§6.7），且是 consent 面，独立导航项保持可见、可控、可停止。
- 皮肤注册表当前仅 1 项，与主题/强调色同属「界面长什么样」——合并后不再占 3 个导航位。

### 5.3 旧 → 新映射表（覆盖率 100%）

| 旧区块 / 条目（§4 编号） | 新去处 | 合并方式 | 测试钩处置 |
|---|---|---|---|
| sec-appearance #1 | 界面 › 主题与颜色 | 成为目标节 h4「主题模式」 | 无钩 |
| sec-skin #2 | 界面 › 主题与颜色 | h4「皮肤」 | 无钩（sec-skin id 退役） |
| sec-accent #3-4 | 界面 › 主题与颜色 | h4「强调色」 | 无钩（sec-accent id 退役） |
| sec-reader #5-21 | 阅读 › 阅读 | **id sec-reader 原样保留**，17 项节内重排为 3 个 h4 组 | setting-extract-*、setting-reader-actions-float 8 个 testid 原样保留且仍在 #sec-reader 内 |
| sec-widgets #22-23 / sec-dashreset #24 | 数据与效率 › 统计仪表盘 | sec-dashreset 撤销，「恢复默认排列与宽度」成为节内一行（settings-row） | 无钩（sec-dashreset id 退役，原即无导航） |
| sec-learningday #25 / sec-siblingbury #26-30 | 复习与调度 › 调度规则 | 合并为 sec-schedule；学习日、同源卡延后为两个 h4 子块，子块根元素**保留 id sec-learningday / sec-siblingbury** | #sec-siblingbury 及其首个 .seg-tabs 开/关 原样保留（m12） |
| sec-cardface #31-33 / sec-tags #34 | 复习与调度 › 卡面与标签 | 合并为 sec-cardtags；两个 h4 子块 | data-cf-* / tags-enabled-toggle / data-tags-on/off 原样保留（d104/d107 为 document 级查询，位置无关） |
| sec-extracts #35-38 | 复习与调度 › 摘录复习（组首） | id 不变，内部不动 | 全部钩原样 |
| sec-limits #39-44 | 复习与调度 › 每日上限 | id 不变，内部不动 | number 序位 0-3、.ai-test-err 原样 |
| sec-ai #45-55 | 智能 › AI 服务 | **整节零改动**（仅随全局排版换壳） | 全部钩原样 |
| sec-dict #56-62 | 智能 › 词典与查词 | id 不变；导航文案「词典/下载」→「词典与查词」 | #sec-dict、首个 .seg-tabs 原样（m7 用 includes(「词典」) 匹配导航，改名安全） |
| sec-memory #63-70 | 智能 › 用户记忆 | 整节零改动 | 全部钩原样 |
| sec-fsrs #71-75 | 复习与调度 › FSRS 优化 | id 不变 | 无钩 |
| sec-backup #76-84 | 数据与效率 › 备份与恢复 | id 不变 | .backup-row /「恢复」原样 |
| sec-global #85-90 / sec-shortcuts #91-92 | 数据与效率 › 快捷键 | 合并为 sec-shortcuts；h4「全局快捷键」子块根元素**保留 id sec-global**，其内 .kb-key / .kb-conflict / Ctrl+Alt+Space / Ctrl+Alt+N 文案原样 | #sec-global 钩（m8）、导航精确匹配「快捷键」（m4）、.kb-row-title/.kb-key 原样；m4 行数断言随 §12-T7 迁移 |

覆盖率核对：§4 清单 18 个区块 / 92 条目全部出现在上表，**无一处删除**；4 个孤儿区块（P1）全部获得导航入口。

### 5.4 导航文案与测试的冲突核查

| 测试匹配 | 现值 | 新值 | 判定 |
|---|---|---|---|
| d112：`.settings-nav button` === 「AI 服务」 | AI 服务 | AI 服务 | 精确匹配保持 |
| m2：=== 「备份与恢复」 | 备份与恢复 | 备份与恢复 | 保持 |
| m4：=== 「快捷键」 | 快捷键 | 快捷键（合并节） | 保持；合并后 document 内**恰好一个**按钮文本 === 「快捷键」（「全局快捷键」降为 h4 非按钮） |
| m12：includes 「同源」 | 同源卡延后 | 同源卡延后（h4 标题，非导航） | **注意**：合并后导航项叫「调度规则」，不再含「同源」→ m12 需迁移为直接定位 `#sec-siblingbury`（§12-T4） |
| m7：includes 「词典」 | 词典/下载 | 词典与查词 | includes 匹配保持 |
| 组标题（非 button） | — | 界面 / 阅读 / 复习与调度 / 智能 / 数据与效率 | 组标题渲染为 `<div>` 非 `<button>`，不进 `.settings-nav button` 查询集 |

## 6. 页面结构

### 6.1 骨架（≥1024px 窗口）

```
┌ modal-panel-wide（980px，max-height 80vh）────────────────────┐
│ modal-header：设置                                    [×]     │ ← 不变（Title L / 300）
├ settings-layout.modal-scroll（内部滚动）──────────────────────┤
│ ┌ settings-nav（180px，sticky top:0）─┐ ┌ settings-content ──┴──┐
│ │ 界面                                │ │ ← 720px 内容列，左对齐  │
│ │   主题与颜色                        │ │                        │
│ │ 阅读                                │ │  ┌card-fill 主题与颜色┐ │
│ │   阅读                              │ │  │ h3 主题与颜色      │ │
│ │ 复习与调度                          │ │  │ h4 主题模式  [seg] │ │
│ │   摘录复习                          │ │  │ h4 皮肤      [list]│ │
│ │   每日上限                          │ │  │ h4 强调色    [row] │ │
│ │   调度规则                          │ │  └────────────────────┘ │
│ │   卡面与标签                        │ │  ┌card-fill 阅读──────┐ │
│ │   FSRS 优化                         │ │  │ h3 阅读            │ │
│ │ 智能                                │ │  │ h4 阅读外观        │ │
│ │   AI 服务                           │ │  │  行：label ⓘ  控件 │ │
│ │   词典与查词                        │ │  │ h4 选区与批注      │ │
│ │   用户记忆                          │ │  │ …                  │ │
│ │ 数据与效率                          │ │  │ h4 摘录卡编辑器    │ │
│ │   备份与恢复                        │ │  └────────────────────┘ │
│ │   快捷键                            │ │  …（13 块，间距 sp-6）  │
│ │   统计仪表盘                        │ │                         │
│ └─────────────────────────────────────┘ └────────────────────────┘
└───────────────────────────────────────────────────────────────┘
```

- **导航（settings-nav）**：宽 160→180px；组标题 = Meta 档（12px/600/`--text-helper`，上 24px 下 8px），项 = 既有按钮样式（左缘 2px 条选中态不变，theme.css L1545-1562）。组标题是 `<div>`，不可点、不进 Tab 序。
- **内容列**：max-width 720px 保留；每个导航项 = 一个 `card-fill` 区块（`--grey-1` 底、直角、padding `--sp-6`、块间距 `--sp-6`、区块列表 `display:flex;flex-direction:column;gap:var(--sp-6)`，替代现有 hairline 分隔节——theme.css L1592-1598 的节间距规则随之改写）。
- **区块内层级**：h3（Title S 18/500）→ 行组 → h4（Secondary 13/600，节内分组，间距上 24 下 8，theme.css L1613-1618 既有规则）。行与行 `gap: var(--sp-2)`。
- **行（settings-row）**：`label（Body 14 / --text-primary）+ ⓘ（可选）… 控件右对齐`；既有 flex 行保留，label 部分包一层 `<span className="settings-row-label">` 以容纳 ⓘ 图标。长表单（AI 字段、正文字体）仍用 label 在上的 `.form-field`（§5.4「表单 label 在输入框上方」），两类不混排：**开关/段控行=横排行；文本输入=纵排字段**。
- **状态行**（今日已用 / 记忆用量 / 备份统计 /检测结果等）保留 `.form-hint` 样式但语义改为状态输出（`role="status"`，§10）。

### 6.2 窗口窄/矮时的行为

| 条件 | 行为 |
|---|---|
| 窗口宽 < 1044px（modal 缩到 `calc(100vw - 64px)` 后内容列 < 720） | `.settings-layout` 断为纵向：导航变**顶部横向滚动条**（`flex-direction:row; overflow-x:auto`，组标题内联为分隔点），sticky top:0 吸 modal-header 下缘；内容列 100% 宽。断点写在容器查询 `container-name:settings` 上（对齐 D51 吸顶工具条的容器查询先例），阈值单调（860px 一档，不搞多档回退） |
| 窗口高 < 640px | modal-header padding 由 `--sp-6/--sp-8` 收为 `--sp-4/--sp-6`；导航组标题在矮窗口随横排收纳（上条已覆盖） |
| 任何断点 | 不出现水平滚动条；控件不换行错位（行内 wrap 仅限 AI 服务按钮组与快捷键行，沿用 settings-row-wrap） |

### 6.3 导航与滚动同步

保留现有 scroll-spy 机制（scroll + scrollend + 220ms 尾随测一次，L2389-2433 的收敛修正全部继承），仅改数据源：`sections` 数组变为 `{ groups: [{ label, items: [{ id, label }] }] }`，navIds 集合随之生成；**13 区块 = 13 导航项一一对应**，不再需要「跳过无导航节」的特判。点击导航 → `scrollIntoView({behavior:"smooth"})` + 目标 h3 `focus({preventScroll:true})`（h3 加 `tabindex="-1"`，屏幕阅读器可达）。

## 7. 组件拆分

| 组件 | 新增/复用 | 说明 |
|---|---|---|
| `SettingsPanel`（默认导出） | 改造 | 保留 modal 骨架 + useDialogA11y；`sections` 常量改为分组结构；渲染分组导航 + 13 个区块组件 |
| `SettingsNav` | **新增**（从 SettingsPanel 抽出） | 分组渲染 + scroll-spy（逻辑平移，不改行为） |
| `SettingsInfo`（tooltip 触发器） | **新增** `src/components/SettingsInfo.tsx` | ⓘ 按钮 + 浮层（§8）；全页唯一 tooltip 实现点 |
| `SettingsSection` | **新增**（薄壳） | card-fill 区块容器：h3 + children；统一间距与 a11y（h3 tabindex=-1） |
| 既有 17 个区块函数 | 复用改造 | DashboardSection / AISection / LearningDaySection(+SiblingBury 合并) / SiblingBurySection / CardFaceExtrasSection(+Tags 合并) / TagsEnabledSection / ExtractReviewSection / LimitsSection / MemorySection / FSRSSection / BackupSection / GlobalShortcutsSection(+Shortcuts 合并) / ShortcutsSection / ReaderSection；合并时**只动 JSX 外壳与文案，不动 state/处理函数/落库调用** |
| `Dropdown` | 复用 | 直角下拉原样 |
| `.settings-row` / `.seg-tabs` / `.skin-list` / `.kb-*` / `.backup-*` / `.dict-catalog-*` 等 CSS | 复用 | 仅按 §6.1 调整节容器与间距规则 |

新文件仅 2 个（SettingsNav 可并入 SettingsPanel 内部以减少文件数——实施时可二选一，验收以行为为准）。**除 theme.css 追加设置节样式外不触碰其它样式域。**

## 8. Tooltip 交互规格（SettingsInfo）

### 8.1 实现决策：自定义组件，不用原生 `title`

| 维度 | 原生 title | 自定义组件（选定） |
|---|---|---|
| 触发时机 | OS 约 1s 延迟，不可控 | hover intent 500ms，可控 |
| 键盘 focus 触发 | 各浏览器不一致，Electron 无保证 | `:focus-visible` 必现（§8.4） |
| 视觉 | 系统样式，无法守 Token（违反「未 Token 化」禁令） | paper 底 + hairline + `--shadow-float`，Meta/Secondary 字号 |
| 浮层翻转 | 无（会被窗口边缘裁剪，违反 D56 翻边规则） | placePopover 同款翻转 |
| 内容 | 纯文本 | 富文本（可含 mono 路径、`<a>`） |

### 8.2 触发与消失

| 事件 | 行为 |
|---|---|
| pointerenter（pointer: fine） | 500ms 延迟后显示（防扫过轰炸；同屏最多 1 个 tooltip，新触发器显示即关旧） |
| pointerleave | 立即开始消失（100ms 淡出）；指针在 200ms 内移入浮层则取消消失（可选中/复制文本） |
| 触发器 focus-visible | 立即显示（无延迟，键盘用户已表达意图） |
| blur / Esc / 点击任处 | 立即消失；Esc 不冒泡干扰设置模态（stopPropagation 仅当 tooltip 开着） |
| 滚动（scroll 容器滚动） | 立即消失（锚点位置已失效，不做跟随） |
| pointer: coarse（触屏） | 点按 ⓘ 切换；点其它处关闭（hover-interactions skill：触屏无 hover，必须有无 hover 等价路径） |

### 8.3 视觉与放置

- 浮层：`--paper` 底 + `1px --border-subtle` + `--shadow-float`（浮层唯一阴影条款）+ 直角；文字 Secondary 13/1.5 `--text-secondary`，max-width 320px，padding `--sp-3`。
- 放置：锚定 ⓘ 图标，竖直优先**上方**居中、越界翻下方；水平右缘优先对齐、左越界翻左——D56「实测一次翻到另一侧」规则的直用。
- z 层：新增 Token `--z-tooltip: 450`（modal 400 < tooltip 450 < toast 500；D114 登记项，见 §14）。
- 语义：ⓘ 为 `<button type="button" class="settings-info" aria-label="{label}的说明" aria-expanded>`；浮层 `role="tooltip"` + id，行控件容器挂 `aria-describedby={tipId}`（tooltip 开着才挂，避免全页噪音）。

### 8.4 键盘与可达性（硬性）

1. ⓘ 进入 Tab 序，Tab 顺序 = 视觉顺序（行内最末）。
2. **focus 即显示**（§8.2）——键盘用户与鼠标用户信息等价，对应可访问性「不用 hover 作为唯一信息载体」。
3. `prefers-reduced-motion`：显示/消失无过渡（瞬时）。
4. 对比：浮层文字 `--text-secondary`（#525252）on `--paper` ≈ 7:1，达标。

### 8.5 内容规范

一句话原则：**说「这对你的影响与默认值为什么这样」，不讲教科书**。≤ 2 句、≤ 80 字；含数值边界（如 1:4、5 倍、10-40px）与跨界面联动（如「阅读器顶栏主题菜单读写同一份设置」）。逐条文案见 §9 处置表的「tooltip 文案要点」列。

## 9. 文案处置表（说明文字逐条去向）

> 范围：现行全部**静态说明类** `.form-hint` / 行内说明（状态输出类一律保留，见表尾）。判定规则=GUIDE §5.3：操作必需 → 行内；行为语义/边界 → tooltip；显而易见/教程式 → 删除。

| 位置（行号） | 现文案摘要 | 处置 | 去向 / tooltip 文案要点 |
|---|---|---|---|
| reader L1322 | 阅读器顶栏主题菜单与本区块同源 | → tooltip | 挂「阅读主题预设」行：与阅读器顶栏「主题」菜单是同一份设置 |
| reader L1337 | 多段选择修饰键解释（3 行） | → tooltip | 挂「多段选择修饰键」：按住它再选不相邻段=加选；重复选=移出；Esc 清空；纯键盘组合不受影响 |
| reader L1356 | 标注模式两模式差异 | → tooltip | 挂「默认标注模式」：高亮=纯批注；摘录+高亮=同时建摘录；选区菜单里可临时切换 |
| reader L1372 | 标注形式差异 | → tooltip | 挂「默认标注形式」：底色 / 2px 色线；同样可临时切换 |
| reader L1393 | 色板即调色排顺序 | → tooltip | 挂「批注色板」：顺序=调色排顺序；点色即执行当前模式动作 |
| reader L1409 | 自定义取色含义 | → tooltip | 挂「自定义取色」：调色排末位是否显示「自定义…」 |
| reader L1425 | 批注栏筛选含义 | → tooltip | 挂「批注栏默认筛选」：批注栏打开时的初始筛选 |
| reader L1501 | 工具栏三键总说明（4 行） | → tooltip ×3 | 分别挂「编辑工具栏」（关闭仍可用 markdown/快捷键）、「工具栏形态」（悬浮=锚定选中文字弹层）、「固定位置」（钉顶/钉底；悬浮优先） |
| reader L1521 | 选区动作组悬浮含义 | → tooltip | 挂「阅读器选区动作组」：同一组按钮，默认固定顶栏 |
| widgets L162 | 宽幅/窄幅与拖动换位说明 | → tooltip | 挂 h4「统计组件」：宽幅=通栏；窄幅=半幅自动成对；拖标题栏换位 |
| learningday L536 | 学习日口径说明（2 行） | → tooltip | 挂「新一天从」：凌晨学习计入前一天；只影响统计，不影响 FSRS 间隔 |
| siblingbury L579 | 同源延后机理（3 行课） | → tooltip | 挂「同源卡延后」：同源组同日只放行一张，防互相泄题；不改调度、次日自动解封、仍可主动复习 |
| siblingbury L624 | 短材料阈值解释 | → tooltip | 挂「短材料阈值」：该长度以内才按同一次选区建组 |
| cardface L659 | 纯显示开关说明 | → tooltip | 挂 h4「卡面信息密度」：关闭即不渲染对应块；不改卡内数据 |
| tags L705 | 标签总开关波及面（3 行） | → tooltip | 挂「启用标签功能」：关闭隐藏六处入口；已存数据原样保留，重开即恢复 |
| extracts L759 | 并入队列语义（3 行） | → tooltip | 挂「并入复习队列」：开启后按混编规则推送；关闭在「摘录」页连续处理 |
| extracts L784 | 混编可随时切换不写调度 | → tooltip | 挂「混编规则」：切换不写任何调度状态，未放行摘录仍照常到期 |
| extracts L806 | 实验引擎 6 行说明 | **拆**：1 行行内 + tooltip | 行内保留「实验功能 · 早期开发阶段」标识句；完整语义（本地因子排序/AI 重排经本地裁决/无损切回/Frontier 未接入）入「摘录推送引擎」tooltip |
| limits L870 | 四类上限口径+硬边界（4 行） | → tooltip ×2 | 挂 h4「每日上限」（按学习日计算、全部范围共享额度、填 0=不限）；挂「每日卡片复习上限」（硬边界：≥新上限×5；10 倍内提示） |
| limits L889 | 结构闸解释 | → tooltip | 挂「复习上限用尽后仍发新卡」：关闭（默认）=防积压的结构闸 |
| ai L365 | 本地端口说明 | → tooltip | 挂「服务地址」：Ollama 11434 / LM Studio 1234，无需 Key |
| dict L1918 | 查词流程说明 | 删 | 流程用户已用过才进设置；来源必显已在弹窗自证 |
| dict L1926 | 来源模式动态解释 | → tooltip（静态合并） | 挂「词典来源」：本地=不联网；在线=Free Dictionary/Jisho；自动=在线优先失败回落本地 |
| dict L1939 | 字段默认说明 | → tooltip | 挂「弹窗显示字段」：例句关闭不影响原句保存与挖空卡 |
| dict L1946 | 发音来源动态解释 | → tooltip | 挂「发音来源」：TTS=离线可用需语音包；在线=真人音频缺失回落 TTS |
| dict L1978 | StarDict 版权注 | → tooltip | 挂 h4「一键下载」：版权不明包仅本地导入；Wiktionary 全量仅在线 |
| memory L1018 | 四件事 consent 说明 | **保留行内** | §6.7.1 契约要求的「说明文案」，是 consent 面，不得降为 hover |
| memory L1063 | 注入预算解释 | → tooltip | 挂「注入预算」：制卡单次注入上限；core/目录/主题按比例分配 |
| global L2279 | 全局键语义+被占用说明（3 行） | → tooltip | 挂 h4「全局快捷键」：无焦点也生效；被占用=系统层冲突，换组合即可 |
| global L2311 | 失焦隐藏括注 | → tooltip | 挂「失焦时自动隐藏」：内容已即时保存；不勾选需 Esc 关闭 |
| shortcuts L2081 | 捕获操作说明（2 行） | → tooltip | 挂 h3「快捷键」：点键位框按新组合，Esc 取消；冲突拒存；输入框编辑键不受影响 |
| 全部 `savedTick`「已保存…」、usage/统计行、检测结果、错误与确认面板 | — | **保留行内** | 这些是**状态输出**（ai-test-ok/fail/err、usage、backup counts、restore confirm、intro 面板），不是静态说明 |

净效果：静态说明段从 19 处降为 1 处保留（memory consent）+ 1 处行内标识句（实验功能），其余 17 处转 tooltip 或删除；页面正文密度显著下降，信息不丢失（tooltip 全量承载 + 键盘等价）。

## 10. 各状态规格

> 基线：swiss「状态设计」表 + 既有实现。下列只列设置页涉及件；未列者按 swiss 通用规则。

| 元件 | 默认 | Hover | Focus（键盘） | Loading | Empty | Error | Disabled |
|---|---|---|---|---|---|---|---|
| 导航组标题 | Meta 12/600 helper 色 | —（非交互） | 不进 Tab 序 | — | — | — | — |
| 导航项 | secondary 色，左缘 2px 透明条 | 底 `--grey-1` + primary 色（不位移） | 2px accent outline offset 2 | — | — | — | — |
| 导航项选中 | accent-soft 底 + 左缘 2px accent + primary | 同 hover | 焦点环叠加 | — | — | — | — |
| card-fill 区块 | grey-1 底，无描边 | — | — | 数据未达时内容区 `SkeletonBlock`（AI L508 / widgets L128 现状保留） | 皮肤列表单选项即内容；无空态场景 | — | — |
| 行 label ⓘ | helper 色 16px | accent 色（150ms） | 焦点环 + tooltip 立现 | — | — | — | — |
| seg-tabs 开/关/档位 | 未选中 secondary | 底 `--grey-1` | 2px accent outline | — | — | — | grey-2 文字，无 hover |
| checkbox / range | 现状（accent-color accent） | — | 浏览器焦点环 + 2px accent outline | — | — | — | — |
| number input | hairline 描边 | border-strong | 2px accent outline | — | — | 越界/硬边界拒存：error hairline 描边 + `.ai-test-err` 行内文案（extract.gui 依赖） | — |
| 文本输入（form-field） | 现状 L1440-1473 | border-strong | 2px accent outline | — | — | 同上（/v1 校验 ai-test-fail） | — |
| 主/次/描边按钮 | 现状 | grey-1（D88 豁免件不用于设置页 24px 档） | 2px accent outline | busy 文案（「保存中…」等）+ 可选 SkeletonBlock | — | 结果走 ai-test-fail 行 | busy 互斥（busy!=="" 全组禁用，现状） |
| Dropdown | 现状 | dd-btn grey-1 | 2px accent outline | — | 空列表：model-dropdown「列表无匹配」现有文案 | — | — |
| tooltip | 隐藏 | —（自身非交互，浮层文本可选） | — | — | — | — | 触发器 disabled 时不触发 |
| 备份/词典列表行 | hairline 分隔 | 行底 grey-1 | 行内按钮各自焦点 | 下载进度行（现有 mono 百分比） | 已安装为空=整块不渲染（现状） | 损坏标记「清单损坏」（现有） | restored/busy 时恢复钮禁用（现状） |
| 键位捕获（kb-key） | mono 框 | grey-1 | 2px accent outline | 捕获中：`.capturing` 高亮 + 「按下新键…」 | — | 冲突：`.kb-conflict` error 文字 | 键位未自定义时「恢复」禁用（现状） |
| 两段确认（重置/恢复） | 第一段 outline 钮 | — | 确认面板出现时**焦点落「取消」**（D50 破坏性确认先例） | busy 文案 | — | error 填充仅「确认清空/确认恢复」 | — |

## 11. 动效章节（animation-principles skill → 适用点）

### 11.0 冲突裁决表（项目规范优先，硬性）

| skill 建议 | 瑞士风/项目规则 | 裁决 |
|---|---|---|
| hover-interactions：卡片 hover 位移/缩放/阴影 | swiss「hover 底色 grey-1；不位移、不缩放、不发光」；D88 阴影豁免仅 ≥32px 可点控件 | **采纳项目规则**：设置页一切 hover 只做底色/描边/文字色过渡 |
| micro-100-200ms：下拉项弧线、图标跟随等 | swiss「每处动效与图形语义耦合；禁止统一 fade-up」 | 不引入无语义装饰动效；仅 §11.2 列举点生效 |
| timing-mastery 的戏剧化时长 | swiss 缓动 120-240ms、浮层进 150 出 100 | 全部压进项目区间 |
| 各 skill 裸写贝塞尔/时长 | §5.1「组件禁裸写贝塞尔/裸写时长」 | 一律走 Token（§11.2） |

### 11.2 Token（新增 3 枚，D114 登记；其余复用 D88 族）

```css
:root {
  --z-tooltip: 450;        /* modal(400) < tooltip(450) < toast(500) */
  --dur-tip-in: 150ms;     /* tooltip 入场＝浮层进 150ms */
  --dur-tip-out: 100ms;    /* tooltip 出场＝浮层出 100ms */
}
/* 复用：--ease（栏级）、--ease-out-soft、--dur-hover(160ms)、--dur-press(60ms)、--shadow-float */
```

### 11.3 原理 → 适用点（逐 skill 注明）

| Skill / 原理 | 适用点 | 落地 |
|---|---|---|
| **staging-mastery**：一屏一个焦点、层级靠对比不靠颜色；negative space | 设置页的「焦点」是**当前区块的 h3 与其行组**——card-fill 分组块 + 组间 24px 留白实现隔离；导航选中是全页唯一 accent 位（accent-soft 底 + 2px 条），ⓘ/状态行全部灰阶，不与选中态争焦点 | §6.1 结构；唯一 accent 用在导航选中 + 主按钮，语义色只出现在错误/成功状态行 |
| **timing-mastery**：帧数=权重；快速反馈 vs 从容展示要分层 | 交互权重分层：hover/按压（轻，60-160ms）＜ tooltip 与「已保存」（中，150ms）＜ 区块滚动定位（smooth，浏览器节奏）；不存在 >240ms 的设置页动效 | §11.2 Token；scrollIntoView 保持现有 smooth |
| **slow-in-out-mastery**：入场 ease-out、出场 ease-in；80/20 法则 | tooltip 入场 `--dur-tip-in` ease-out（快起缓停=「我响应了」），出场 `--dur-tip-out` ease-in；卡片下拉（dd-menu）维持既有入场 | `.settings-info-tip` transition 规则（reduced-motion 内瞬时） |
| **instant-0-100ms**：即时速反馈，确认而非沟通 | seg-tabs 选中、checkbox、导航 hover 底色——≤100ms 级（`--dur-press` 60ms / hover 160ms 归 micro 带）；不做位移 | 按钮/段控 transition 用 `--dur-hover`/`--dur-press`（D88 已有，直接继承） |
| **micro-100-200ms**：tooltip/dropdown/tab 的黄金带 | tooltip 150/100ms、导航项 hover 160ms、「已保存」状态行淡入 150ms | 全部 `--dur-hover` / `--dur-tip-*` + `--ease-out-soft` |
| **hover-interactions**：hover 是预览不是表演；进出速率不对称（in ≤200ms、out 略慢）；触屏无 hover | 全页 hover：in 160ms ease-out-soft，out 200ms；ⓘ 触屏点按路径（§8.2）；不做 lift/scale（§11.0 裁决） | CSS：`:hover` 160ms / 非 hover 态 200ms |
| **micro-interactions**：每个交互元件都要反馈；禁用态无动画；group related feedback | 「已保存，XX 即时生效」状态行统一淡入（现 26 处 savedTick 输出获得一致进场，替代瞬跳）；disabled 一律无 transition | `.settings-saved { animation: tip-fade 150ms var(--ease-out-soft) }`（no-preference 作用域） |
| **Quick Start · Staging/Timing 总纲** | 全页自查：任意时刻滚动停住，视线只有一个 card-fill 块是「当前」（导航高亮同步）——滚动高亮 120ms 色过渡让焦点交接可感知但不抢戏 | 导航 `.active` 色过渡 `--dur` `--ease`（既有） |

**降级纪律**：§11 全部新增动画写在 `@media (prefers-reduced-motion: no-preference)`；reduce 下 tooltip 瞬时显隐、状态行瞬现、无 smooth scroll（scrollIntoView 行为改 `auto`）。

## 12. 测试影响清单与迁移方案（11 个 GUI 套件）

> 原则：**优先保钩**（id/testid/文案不动则零迁移）；确需动测试的逐条列出，迁移全部是**选择器级**改动，不改断言语义。

| # | 套件 | 依赖的设置页钩子 | 影响 | 迁移 |
|---|---|---|---|---|
| T1 | d112.gui.mjs | `.topbar-right [title="设置"]`；nav ===「AI 服务」；`#sec-ai`；4 分组 label；15 供应商按钮；`.ai-preset-name` 首位硅基流动；「检测本地服务」两态；`.ai-test-ok/fail` | **零影响**（AI 节整节零改动，导航文案不动） | 无 |
| T2 | extract-editor.gui.mjs | `#sec-reader` 存在；`#sec-reader input[data-testid="setting-extract-editor-toolbar"]` | **零影响**（sec-reader id 与 8 个 testid 原样，且仍在 #sec-reader 内） | 无 |
| T3 | extract.gui.mjs | 打开设置后直接查 `#sec-extracts`/`#sec-limits`；首个「开」按钮；number 序位 0/1；`.ai-test-err` 含「5 倍」；下拉项「SuperMemo 传统推送」/「AI 推送」；`[data-rerank-now]`；含「重排」的 `<p>` | **零影响**——前提：所有区块**常挂载单列滚动**（无懒加载/无 tab 条件渲染），打开设置即查得到（本稿 §5.2 已作为硬约束）；sec-extracts 内「并入复习队列」须仍是该节第一个 开/关 段控 | 无 |
| T4 | m12.gui.mjs | nav includes「同源」→ `#sec-siblingbury` → 首个 `.seg-tabs` 开/关 | **需迁移**：合并后导航项为「调度规则」，不再含「同源」 | 测试改为：打开设置后直接 `document.querySelector("#sec-siblingbury")`（id 保留在子块上），再走原 开/关 断言；或导航断言改 includes「调度」。**推荐前者**（与 m8/m14 同款直达模式，少一次导航依赖） |
| T5 | m14.gui.mjs | `#sec-memory` 全套（无需导航） | **零影响**（memory 节零改动） | 无 |
| T6 | m2.gui.mjs | nav ===「备份与恢复」→ `#sec-backup` → `.backup-row` ×≥3 +「恢复」 | **零影响** | 无 |
| T7 | m4.gui.mjs | nav ===「快捷键」；`.kb-row` 计数 === 13；「评分 Good/Hard」行捕获/冲突/恢复 | **需迁移（含既有失真修正）**：合并后 nav「快捷键」仍精确命中；但 `.kb-row` 为 document 级计数——**现状即已失真**（commands.ts L21-35 共 14 行 + sec-global 3 行 = 17 ≠ 13，该断言随 v36 全局快捷键引入后已过时）；合并把两处放进同文档仍是 17 | 断言改为作用域计数：`document.querySelectorAll('#sec-shortcuts .kb-row').length` === 17（14 应用内 + 3 全局）；或拆两条：`#sec-global .kb-row`===3 + 应用内组 14。**推荐前者**，并把注释改为实际行数 |
| T8 | m7.gui.mjs | nav includes「词典」→ `#sec-dict` → 首个 `.seg-tabs` 文案 | **零影响**（改名「词典与查词」仍 includes「词典」；注意合并节里「词典与查词」必须是唯一含「词典」的导航按钮） | 无 |
| T9 | m8.gui.mjs | 打开设置直接查 `#sec-global`；文案含 Ctrl+Alt+Space/Ctrl+Alt+N；`.kb-key[0]`；`.kb-conflict` | **零影响**（#sec-global id 保留在 h4 子块根上；内部结构不动） | 无 |
| T10 | d104.gui.mjs | 打开设置后 document 级 `[data-cf-mnemonic]`/`[data-cf-example]` | **零影响**（data-cf-* 原样；位置随迁至「卡面与标签」节，document 查询无感） | 无 |
| T11 | d107.gui.mjs | 打开设置后 document 级 `[data-tags-on]`/`[data-tags-off]` | **零影响**（同上） | 无 |

迁移量合计：**2 个套件需要测试文件改动（T4、T7），9 个零迁移**。硬前提（实施验收项 A1）：设置页所有区块常挂载、无条件性卸载（AI 节 `if (!cfg) return null` 的载入期瞬态维持现状即可，测试有等待）。

## 13. 验收清单（前端实施自查，机械可查）

**A. 信息架构**
- [ ] A1 打开设置后不点导航，`#sec-appearance/#sec-reader/#sec-extracts/#sec-limits/#sec-schedule/#sec-learningday/#sec-siblingbury/#sec-cardtags/#sec-fsrs/#sec-ai/#sec-dict/#sec-memory/#sec-backup/#sec-shortcuts/#sec-global` 全部可 `querySelector` 命中（常挂载）。
- [ ] A2 `.settings-nav button` 数 = 13；组标题为非 button 元素；导航项与区块一一对应，scroll-spy 在滚到底时落在最后一项。
- [ ] A3 §5.3 映射表 92 条目逐一在新 DOM 有落点（抽查脚本：按 §4 清单的 testid/文案逐个 query）。
- [ ] A4 旧 4 个孤儿区块（卡面信息密度/标签功能/摘录复习/每日上限）各有一个导航项可滚达。
- [ ] A5 导航文案：恰有一个按钮 ===「AI 服务」、一个 ===「备份与恢复」、一个 ===「快捷键」、一个 includes「词典」。

**B. 测试**
- [ ] B1 `node tests/d112.gui.mjs`、`m2/m7/m8/m14`、`d104/d107`、`extract.gui.mjs`、`extract-editor.gui.mjs` 全绿（零迁移 9 件）。
- [ ] B2 T4（m12）、T7（m4）按 §12 迁移后全绿；m4 断言与实际行数一致。
- [ ] B3 8 个 data-testid（setting-extract-editor-toolbar/-float/-top、setting-reader-actions-float、setting-extract-font-follow/-size/-family、tags-enabled-toggle）+ data-cf-×3 + data-tags-on/off 全部仍在，且前 8 个的 queryable 位置符合 §4 表注（extract-* 在 #sec-reader 内）。
- [ ] B4 tsc 0 错误；`npm run build` 成功。

**C. 视觉合同**
- [ ] C1 内容区 13 个分组块全部 `card-fill`（grey-1 底、直角、无描边、无阴影）；块间距 = `--sp-6`；内容列 max-width 720px。
- [ ] C2 全页无新增硬编码 hex/px/贝塞尔/时长（grep 审查）；新 Token 仅 `--z-tooltip/--dur-tip-in/--dur-tip-out`。
- [ ] C3 同屏唯一 accent 位 = 导航选中（+AI 保存主按钮等既有主钮）；语义色只出现在状态行。
- [ ] C4 深色模式下 card-fill/tooltip/导航对比达标（grey-1 深色档 + paper 底 tooltip）。
- [ ] C5 无 <11px 文字；状态行 mono 数字 tabular-nums。

**D. Tooltip**
- [ ] D1 全页静态说明 `.form-hint` 仅剩 §9 表「保留行内」两类（memory consent + 实验标识行）；grep `.form-hint` 于 SettingsPanel 的静态说明段 ≤ 2 处。
- [ ] D2 ⓘ 触发：hover 500ms 显 / 离开即隐；`focus-visible` 立即显；Esc/滚动/点外关闭；同屏最多 1 个。
- [ ] D3 tooltip 视觉 = paper + hairline + `--shadow-float` + 直角；max-width 320px；z = `var(--z-tooltip)`。
- [ ] D4 触屏（pointer:coarse）点按 ⓘ 可开合；`prefers-reduced-motion` 下无过渡。
- [ ] D5 每个按钮 `aria-expanded` 正确翻转；行容器在开启时挂 `aria-describedby`。

**E. 行为与状态**
- [ ] E1 每一行设置项操作后落库路径与改版前一致（抽查：multiSelectKey、extracts.mergeIntoReview、limits 硬边界拒存、tagsEnabled、backupKeep、keybindings 捕获）。
- [ ] E2 窗口宽 <1044px：导航变顶部横排、内容列不出现水平滚动条；矮窗口头部收窄（§6.2）。
- [ ] E3 全部新动效规则位于 `@media (prefers-reduced-motion: no-preference)`。
- [ ] E4 键盘：Tab 可达导航项与全部控件、ⓘ；焦点顺序=视觉顺序；两段确认焦点落「取消」。

## 14. D114 决策登记草稿（主控誊写 §8.1 用）

| 项 | 内容 |
|---|---|
| 决策号 | D114 |
| 版本 | v48.70 |
| 一句话 | 设置页信息架构重设计：14 项平铺导航收编为 5 组 13 项（消灭 4 个无导航区块），分组改 card-fill，19 处静态说明收编为自定义 tooltip（hover+focus 双路触发），动效引用 animation-principles skill 体系并按瑞士风裁决收敛。 |
| 新 Token | `--z-tooltip:450`、`--dur-tip-in:150ms`、`--dur-tip-out:100ms` |
| 契约影响 | 设置页 sec-* 锚点体系变更（sec-skin/sec-accent/sec-dashreset 退役；新增 sec-schedule/sec-cardtags；sec-global/sec-learningday/sec-siblingbury 降为子块 id 保留）；测试迁移 2 件（m12 导航选择器、m4 kb-row 计数作用域 + 既有失真修正）；零设置键、零 IPC、零 schema 变更 |
| 设计稿 | `docs/design/SETTINGS-REDESIGN-D114.md` |

## 15. 范围外

- 不改 AI_DEVELOPMENT_GUIDE.md（版本 bump 与 D114 登记由主控执行）、不改 HISTORY.md。
- 不动任何设置键名/归一函数/主进程 settings:set 写侧（§7.4 各键语义原样）。
- 不做设置页搜索/筛选、不做设置项导入导出（可入 §9.4 池，非本次）。
- 不改 AI 服务节的内部信息架构（D112/D113 刚收口，四分组渲染是测试契约）。
- 用户记忆节的 consent 文案与一次性说明面板保持 §6.7 契约原样（仅随排版换壳）。
