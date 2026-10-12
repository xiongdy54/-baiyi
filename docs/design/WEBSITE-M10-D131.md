# M10 官网 — 设计稿与静态站点实现（D131，建议版本 v48.88）

> 任务来源：主线盘点项「M10 官网 | ❌ 未启动」。本文档是官网的设计稿与实现记录，站点落 `website/`（纯静态：手写 HTML + CSS + 少量原生 JS，零框架、零构建器、零外部网络请求）。
>
> 设计依据：`AI_DEVELOPMENT_GUIDE.md` §6.2（已实现功能规格——官网文案唯一事实来源）/ §1 全局原则 / §6.3（AI 制卡体系）/ §9.2 主线状态表；`docs/swiss-international-style.md`；`docs/design/MOTION-DESIGN-SPEC.md`（D120）；`package.json`；`electron-builder.yml`。排版决策引用 better-layout / better-typography 两个 skill 的条款（条款名以引号标注，均为其 SKILL.md 原文小节标题或表格条目）。
>
> 约束：只允许新建 `website/` 目录内文件与本文档；不改 `AI_DEVELOPMENT_GUIDE.md`、不改任何 src/electron 文件；无 git commit；无 npm run build。营销页可用摄影图但本站无真实素材——一律用排版构成的抽象示意，**禁止造假截图**（swiss「图片与插画」节）。

---

## 1. 产品命名与事实考据

| 项 | 值 | 出处 |
|---|---|---|
| 对外显示名（品牌简称） | **增量阅读** | `electron-builder.yml` → `nsis.shortcutName: 增量阅读`（桌面/开始菜单快捷方式显示名，唯一对外的中文产品名） |
| 产品全称 | **一站式渐进阅读学习软件** | `AI_DEVELOPMENT_GUIDE.md` 文档标题；`package.json` 无 `productName`/`description`，按任务规则取兜底 |
| 下载产物形态 | Windows x64 · NSIS 向导式安装 · 可自选安装目录 · 卸载不删数据 | `electron-builder.yml`（`win.target nsis/x64`、`oneClick:false`、`allowToChangeInstallationDirectory:true`、`deleteAppDataOnUninstall:false`） |
| 发布状态 | **已配置构建、未对外发布**（`--publish never`，publish 置 null 杜绝自动更新/遥测/发布通道） | `package.json` `dist` 脚本；`electron-builder.yml` 头注 |

**宣传红线（事实核对结论）**：M15 材料知识导图 v47 实现已于 2026-09-18 整体回滚、仅存重设计契约（§9.2 M15 行）；知识图谱可视化属打磨项未实现（§4.10）。两者**均不上官网**。官网只宣传 §6.2/§9.2 中 ✅ 状态的已实现功能，逐条对照见 §9。

---

## 2. 信息架构（单页，锚点分区）

| # | 区块 | 目标 | 内容要点 | 事实来源 |
|---|------|------|---------|---------|
| 0 | 顶栏（sticky） | 品牌识别 + 锚点导航 + 主 CTA | 品牌名「增量阅读」+ 四锚点（能力/隐私/技术/下载）+ 主按钮「获取」 | — |
| 1 | 首屏 hero | 一句话定位 + 本地优先承诺 | kicker（本地优先 · 渐进阅读）→ Display 大标题 → 副文案（无网络无账号 100% 可用）→ 双 CTA（下载占位锚点 / 查看核心能力）→ 右侧排版抽象示意（非截图，带「排版抽象示意」meta 注记） | §1.1 |
| 2 | 核心能力 `#capabilities` | §6.2 真实功能总览 | 6 张能力卡（01–06）+ 次级能力清单（词典/日记/统计/备份/快捷键） | §6.2、§9.2 各行 |
| 3 | 工作流 | 讲清使用闭环 | 阅读 → 摘录批注 → 制卡 → 复习 → 下一步推荐，5 步 hairline 连接 | §6.1、§6.2、§9.2 M17 |
| 4 | 隐私与本地优先 `#privacy` | 黑底宣言卡 | 零账号 / 零遥测 / 零云端 / 数据归属用户；AI 为可选 Provider 可关可缺 | §1.1、§1.7 |
| 5 | 技术形态 `#tech` | 交付形态与数据归属 | 桌面应用 / 本地 SQLite / 文件真源 / 安装形态 | §2、§7.2、electron-builder.yml |
| 6 | 下载 `#download` | 诚实占位 | 「桌面安装包构建中，发布渠道筹备中」+ 禁用态按钮（预留样式、无链接）+ 平台/形态说明 | §1 考据表 |
| 7 | 页脚 | 导航 + 合规说明 | 静态页面声明（不收集数据、零外部请求）、锚点导航、版权 | — |

阅读顺序自上而下、重要性前置（better-layout「Order by importance」）；本地优先承诺在首屏与隐私区重复出现——它是产品的第一卖点（§1.1 原则 1）。

---

## 3. 网格、间距与断点（引用 better-layout）

### 3.1 网格

- 12 列 grid：`grid-template-columns: repeat(12, 1fr)`，gutter 24px（`--sp-6`），行间距用 `gap`（swiss「子元素间距用 grid gap / flex column + gap，禁用逐个 margin-top 硬堆」）。
- 版心 `max-width: 1200px`，水平内边距 `clamp(20px, 5vw, 64px)`，左对齐 + 非对称留白（swiss「网格至上」「页面大标题 text-align:center 禁止」）。
- 区块分组靠**空间**不靠线：区块间垂直间距 96px（桌面）/ 64px（≤767），区块内元素间距 16–32px——组间距 ≥ 2× 组内间距（better-layout「Group with space, not lines」：`8px intra-group to 16px+ inter-group`）。hairline 只用于顶栏底缘、页脚上缘与定义列表行分隔（swiss「Hairline 是手术刀」）。

### 3.2 断点（内容驱动，锚定任务四档）

| 档 | 范围 | 网格行为 | 依据 |
|---|------|---------|------|
| Base | 375–767 | 单列流；能力卡全宽；hero 示意移到文案下方；触控目标 ≥44px（swiss 可访问性） | better-layout「Hold structure until it breaks」——塌得晚，先保单列可读 |
| md | ≥768 | 能力卡 2 列（span 6）；工作流 5 步改纵向时间线 | 内容实际放不下 3 列才塌 |
| lg | ≥1024 | 完整 12 列；能力卡 3 列（span 4）；hero 双栏（7/5 分） | 12 列网格全量生效 |
| xl | ≥1440 | 版心仍 1200 上限，两侧留白加大；无内容拉伸 | 版心定宽，避免长行（better-typography「Cap the measure」） |

### 3.3 方向与安全

- 依赖方向的间距一律逻辑属性（`padding-inline` / `margin-inline`）（better-layout「Align to shared edges」表格：`margin-inline-start` / `padding-inline-end`）。
- 背景色块可通栏（better-layout「Content bleeds, controls float」），文字与控件始终在版心内；移动端按钮与版心边缘保持 ≥16px 内缩（better-layout「Inset buttons from the edges」）。
- 全站单方向（zh-CN，LTR），但布局不写死 left/right。

---

## 4. 字号阶梯（引用 better-typography）

| Token | 字号/行高 | 字重 | 用途 | 条款依据 |
|---|---|---|---|---|
| `--fs-display` | clamp(40px, 5.5vw, 56px) / 1.05 | 300 | hero 大标题 | swiss Display 40-56/1.0 权重 200-300；「越大越细」；权重 <300 仅限 28px+ 展示场景（better-typography「Fewer fonts, sizes and weights」） |
| `--fs-h1` | 28px / 1.2 | 400 | 区块主标题（h2） | swiss Title L |
| `--fs-h2` | 20px / 1.3 | 500 | 卡片/子块标题（h3） | swiss Title S |
| `--fs-body` | 16px / 1.7 | 400 | 段落正文 | better-typography「Size and contrast floors」：长文正文 16px 起步；中文行高 1.7（swiss `--lh-prose`） |
| `--fs-secondary` | 14px / 1.6 | 400 | 次级描述、定义列表值 | swiss Secondary；≥14px（better-typography UI 文本下限） |
| `--fs-meta` | 12px / 1.4 | 500 | kicker、标签、注记、页脚 | swiss Meta；全站最小字号 12px（严禁 <11px） |

排印细则（均为 better-typography 条款落地）：

- 「Heading sizes descend with level」：h2 → h3 → body 逐级递减，同档相邻层级靠字重与间距区分。
- 「Letter-spacing by size」：Display `letter-spacing: -0.02em`；Meta kicker `+0.08em`（中文小字加字距）；正文 0。
- 「Cap the measure」：段落 `max-width: 62ch`。
- 「Wrap deliberately」：标题 `text-wrap: balance`；段落 `text-wrap: pretty`；`overflow-wrap: break-word` 兜底长串。
- 「Tabular numbers on changing values」与 swiss「数字一律 mono + tnum」：区块编号 01–06 用 `--font-mono` + `font-variant-numeric: tabular-nums`。
- 「Load intended weights and styles」：系统字体栈自带动词重，禁 `font-synthesis: none`（栈内 300/400/500/600 均由真实字面承担；缺字面由栈回退，不做伪斜体）。
- 「Language and bidi behavior」：`<html lang="zh-CN">`。
- 字体栈照抄 swiss「字体系统」：`--sans` / `--sans-zh` / `--mono`，零外链字体文件（「Serve the right format」的本仓变体：不加载任何 webfont，全部系统栈）。

---

## 5. 色彩 Token（swiss 映射到站点自有 CSS 变量）

不引 `src/theme.css`，站点 `:root` 自持一组同源 Token（取值与 swiss「Token 落地」逐字一致）：

```
--paper:#fafaf8; --grey-1:#f0f0ee; --grey-2:#d4d4d2; --grey-3:#737373; --ink:#0a0a0a;
--accent:#002FA7(克莱因蓝 IKB); --accent-on:#ffffff; --accent-soft:rgba(0,47,167,.08);
--success:#1A7F37; --warning:#9A6700; --error:#B42318;   （本站仅 error 备用，页面未用语义色装饰）
--border-subtle:#e0e0e0; --text-secondary:#525252; --text-helper:#737373;
```

- 单一焦点色：IKB 蓝只出现在主 CTA、区块编号、焦点环、示意构图的一处强调块——同屏焦点色唯一（swiss 设计哲学 1）。
- 黑底宣言卡（隐私区）用 `card-ink` 语义（swiss 卡片四类之一）：`#0a0a0a` 底 + `#f5f5f2` 主文字 + `#a3a3a3` 次文字（实测对 `#0a0a0a` 对比 ≈7.8:1，≥4.5 通过）。
- 禁渐变/禁阴影/禁圆角；唯一阴影为零（无浮层）。
- 对比度自查：`--ink` 对 `--paper` ≈17:1；`--text-secondary` ≈7.4:1；`--text-helper` ≈4.5:1（仅用于 12px+ meta）；`--accent-on` 对 `--accent` ≈10.7:1；`--accent` 文字对 `--paper` ≈10:1。全部 ≥4.5:1。

---

## 6. 动效表（引用 MOTION-DESIGN-SPEC D120 档位）

站点不引 theme.css，但**档位/缓动/降级三件套逐字沿用**规范取值：

| 效果 | 场景 | 规格 | 规范依据 |
|---|---|---|---|
| 首屏入场 | hero 主列/示意列 | `opacity 0→1 + translateY(var(--shift-sm)=4px)→0`，200ms `--ease-enter cubic-bezier(0,0,.2,1)`，子项 stagger 30ms×≤4，总预算 ≤400ms | §5.3 首屏入场 + §3.6 stagger 预算 |
| 滚动入场（reveal） | 各区块/能力卡进入视口 | 同上手法 200ms `--ease-enter`；stagger 30ms/张 ×≤8 | §10-R2 书架入场规格（同构场景）；§3.6 |
| hover | 按钮/链接/卡片行 | 底色 `--grey-1`，160ms（`--dur-hover`）`--ease-enter`；**禁抬升、禁缩放、禁阴影**；规则包 `@media (hover: hover)` | §4 Hover 规范（禁抬升为用户裁决） |
| 按压 | 按钮 `:active` | `scale(0.95)`（`--scale-press`）60ms | §4 active 档 |
| 键盘焦点 | 全部可交互元素 | 2px accent 外描边 offset 2px，瞬时出现不过渡 | §4 focus-visible 行 + swiss 状态设计 |
| 降级 | `prefers-reduced-motion: reduce` | 全部入场/过渡规则写在 `@media (prefers-reduced-motion: no-preference)` 作用域内——reduce 时规则不在场、元素直落终态 | §3.2 reduced-motion 双轨制 |
| 禁项 | — | 零动画库（附录 A 零依赖）；只动画 `transform/opacity`；同屏并发动效 ≤3；无滚动劫持/视差 | 附录 A 实现约束 |

实现：`IntersectionObserver` 触发 `.is-in`（唯一 JS 动效职责，渐进增强——无 JS 时内容直显，见 §10）。平滑滚动 `scroll-behavior: smooth` 同样置于 no-preference 作用域。

---

## 7. 组件规范（swiss 状态设计落地）

| 组件 | 规格 |
|---|---|
| 顶栏 | sticky（z 200 档语义），`--paper` 实底 + 下缘 1px hairline；高度 64px；品牌名左、导航右 |
| 按钮 | 直角无圆角；主按钮 accent 填充 + `--accent-on` 文字，高 48px（lg）；次按钮 hairline 描边 + ink 文字；hover 底色 `--grey-1`（次）/ 加深（主）；禁用态文字与边框 `--grey-2`、不响应 hover（swiss disabled） |
| 能力卡 | `card-fill`（`--grey-1` 底）六张同类并列；编号 mono accent；禁混用卡片类型 |
| 宣言卡 | `card-ink` 黑底，仅隐私区一张 |
| 定义列表 | 行间横向 hairline（`--border-subtle`），键左值右，仅横线禁竖线（swiss 表格规则同理） |
| 链接 | 辅助链接 `--text-helper`，hover 变 `--ink`；正文内链接 accent + 下边线 |
| 空态/占位 | 下载区 = 一句话说明 + 禁用态预留按钮，不放装饰元素（swiss empty 状态 + v48.82/D126 装饰退役） |

---

## 8. 响应式与可访问性

- 四档断点行为见 §3.2；移动端触控目标 ≥44×44（swiss 可访问性）。
- 语义化 HTML：`header/nav/main/section/footer` + 跳转正文 skip link；每个 section `aria-labelledby` 指向其标题。
- 键盘：所有交互元素 Tab 可达，焦点环可见，焦点顺序 = DOM 顺序 = 视觉顺序；导航 scrollspy 用 `aria-current="true"` 表达。
- `::selection` 用 accent-soft，保持选中文字可读（better-typography「Keep useful text selectable」）。
- 零外部网络请求：无 GA、无 CDN、无外链图；favicon 为本地 `assets/favicon.svg`，杜绝 404。

---

## 9. 文案与事实对照表（每个卖点注明出处）

### 9.1 hero 与通用

| 文案 | 出处 |
|---|---|
| 「一站式渐进阅读学习软件」 | GUIDE 文档标题（package.json 无 productName 的兜底命名，§1） |
| 「书架、阅读、摘录、制卡、复习——在无网络、无账号的情况下 100% 可用」 | §1.1 原则 1（纯本地优先）逐条转写 |

### 9.2 核心能力六卡

| # | 卡片 | 宣传点 | 出处 |
|---|---|---|---|
| 01 | 阅读内核（一切皆书） | EPUB/MOBI/AZW3/FB2/CBZ + PDF 原生阅读 + Word/TXT/MD/HTML 导入；目录侧栏；滚动/分页/双页对开；纸白/羊皮/暗夜外观；进度精确回到原位 | §6.2 阅读器段（foliate 内核、格式清单、目录/模式/外观、CFI 进度）；§9.2 M6 行 |
| 02 | 摘录与就地批注 | 选区摘录、就地批注、批注栏与注解导航、摘录按 SuperMemo 语义调度、一屏一条沉浸处理 | §6.2 摘录复习段；§6.8-11/12/13（批注 D61–D65、就地批注 R21–R40、Reader dock D67）；§6.8-2 |
| 03 | AI 制卡 | 选中文本即出卡片草稿；挖空/问答/翻转问答/图片挖空四种形式；材料类型本地路由；CardLint 质检；**AI 输出一律先草稿、人工确认才入库；无 AI 服务时降级手动** | §6.3.2 主流程；§6.3.10 四形式与路由；§6.3.4 CardLint；§1.7（人工确认 + 可降级） |
| 04 | FSRS 复习 | 连续刷题、四档评分、自动下一张、撤销评分、跳转原文、Leech 难点六步处理、FSRS 参数优化器 | §6.2 连续复习段/记忆难点/FSRS 优化器；§4.4 调度契约 |
| 05 | 学习者模型与下一步推荐 | 「下一步」面板、学习轨道、知识点掌握五级、多种结构化推荐；用户记忆分层文件（core/index/topics）接地制卡 | §9.2 M17 行（✅ v48.80，L0–L6）；§9.2 M14 行（✅ v45+v46）；§4.20、§4.18 |
| 06 | 数据与统计 | 统计仪表盘（热力/完成度/领域分布/评分构成/一日时间轴）；卡片浏览器（查询语法/批量动作/筛选牌组）；备份与恢复；日记与 AI 洞察 | §9.2 D122 行；§6.8-6；§9.2 M2 行；§6.5 |

### 9.3 次级能力清单（一览行）

词典（在线 Free API/Jisho + 本地 StarDict/DSL/ECDICT，§9.2 M7 行）；快捷键与命令注册表（§9.2 M4 行）；UDC 领域分类（§6.2 统计数据段）。

### 9.4 隐私区（card-ink 宣言）

| 文案 | 出处 |
|---|---|
| 「零账号 · 零遥测 · 零云端」 | §1.1（核心功能无网络无账号）；electron-builder.yml「publish 置 null（杜绝任何自动更新/遥测/发布通道）」 |
| 「数据留在你的电脑上——本地 SQLite 数据库与 Markdown 文件，卸载也不删」 | §7.2（写入归属/本地持久化）；§4.18-2（用户记忆以文件为真源）；electron-builder.yml `deleteAppDataOnUninstall:false` |
| 「AI 是可选能力：自带密钥、随时可关，关掉后一切功能照常手动可用」 | §1.1（可选 Provider）+ §1.7（缺失时降级手动） |

### 9.5 技术区

| 文案 | 出处 |
|---|---|
| 「桌面应用：Electron，Windows x64」 | §2 技术栈；electron-builder.yml win.target |
| 「本地数据库 + 本地文件即真源；每次写入原子落盘」 | §7.2（persist() 原子写）；§4.18-2 |
| 「安装：NSIS 向导式，可自选安装目录，卸载不删数据」 | electron-builder.yml nsis 段 |

### 9.6 下载区（诚实占位）

- 主文案：**「桌面安装包构建中，发布渠道筹备中。」**（对应事实：electron-builder 已配置完成但 `--publish never`、未发布——§1 考据表）
- 预留按钮：禁用态「Windows 安装包 · 暂未发布」，无 href、无假链接；辅注「发布后本页将直接提供下载」。
- 说明行：平台 Windows x64 / 形态 NSIS 向导式安装，可自选安装目录。

### 9.7 明确不宣传（红线）

材料知识导图（M15 已回滚，§9.2）；知识图谱可视化（§4.10 打磨项）；在线功能/同步/商业化（M9 ❌）；插件/主题社区（M11 ❌）；任何版本号/用户量/评分等无源数字（swiss「有真实数据才用图表，禁止为概念编造数值」同理延伸到文案）。

---

## 10. 实现结构（website/）

```
website/
├── index.html        单页；语义化区块；内联 SVG 构图；本地 favicon
├── css/style.css     Token(:root) → 基础 → 布局 → 组件 → 动效(no-preference) → 断点
├── js/main.js        js 类标记 + IntersectionObserver reveal + scrollspy + 年份（≤80 行，零依赖）
└── assets/favicon.svg 直角几何 mark（IKB 方块）
```

- 渐进增强：`<html class="no-js">` → main.js 首行置 `js`；`.reveal` 初始隐藏规则只写在 `html.js` 前缀 + no-preference 作用域内——无 JS 或 reduce 环境内容全部直显。
- `file://` 直开无 404：所有资源相对路径，无绝对 URL、无外链。

## 11. 自检记录

见 §13 附记（实现后已回填）。

---

## 12. 验收标准对照

| 验收项 | 结果 |
|---|---|
| `website/index.html` file:// 直开无 404、无控制台报错 | ✅（jsdom 全脚本渲染 0 报错；CDP 真实 Chromium 全区块捕获 0 控制台错误/0 异常；资源相对路径齐备，jsdom 资源缺失清单为空） |
| 渲染截图 1440 与 375 两档 | ✅（pen.dev MCP 与 browser-use 插件在本子代理环境均不可用 → 降级方案：node http 服务 + CDP 驱动本机 headless Chromium，1440×900 与 375×812 逐区块截图 + 两档全页截图，见 §13） |
| 设计稿含信息架构/网格断点/字号阶梯/动效表/事实对照/GUIDE 登记块 | ✅ 本文 §2/§3/§4/§6/§9/§14 |
| 无虚构功能宣传、下载占位无假链接 | ✅ §9.6/§9.7（占位按钮为非交互 `<span aria-disabled>`，无 href） |

## 13. 附记：渲染自检（已回填，2026-10-12）

**工具链说明**：验收标准首选的 pen.dev 浏览器 MCP（`mcp__pencil__browser`）在本环境不可用（Pencil 桌面端未运行），备选 browser-use 插件亦不可用（子代理无浏览器权限）。按验收标准降级路径执行：**node 起本地 http 静态服务**（127.0.0.1:8742）+ **CDP（remote-debugging-port + 原生 WebSocket，零新增依赖）驱动本机 headless Chromium 154** 完成真实渲染截图与布局测量——比 DOM 结构自查更强，达成了两档截图核查的实质目的。

### 机械自检（全部通过）

| 检查 | 结果 |
|---|---|
| jsdom 全脚本渲染（runScripts + 资源加载） | 0 运行时错误；25 个 `.reveal` 全部落终态；aria-labelledby / 内部锚点 / 资源引用零缺失 |
| CSS var 引用有效性（swiss「引用有效性」差集审计） | 未声明引用 = 空；未使用声明 = 空（`--d` 为 inline stagger 索引，带 `var(--d, 0)` 回退，不计） |
| 禁项扫描 | border-radius / box-shadow / gradient 全部 0；<12px 字号 0；@import/@font-face/外链 0；hover 抬升 0 |
| 裸 ms 值 | 60 / 160 / 200 / 30(stagger 步长) 四种，全部来自 MOTION-DESIGN-SPEC §1/§3.6 档位 |
| 对比度（WCAG 程序计算） | 11 个内容色对全部 ≥4.5:1（最低 helper #737373/paper = 4.54）；禁用态按钮 grey-2 系 swiss 明文规定，属 WCAG 非活动组件豁免，其信息在下载区 lede 完整冗余 |
| 水平溢出 | 真实 Chromium 布局测量：scrollW == clientW（1440→1440，375→375）；无元素右缘越界 |

### 截图核查（CDP headless Chromium，逐区块 + 全页）

- **1440×900**：hero 双栏 7/5 对齐、能力卡 3 列、工作流 5 列 hairline 顶线对齐、黑底宣言卡 4 列事实、下载占位禁用态、页脚；scrollspy `aria-current` 的 2px accent 下划线随区块正确切换。
- **375×812**：单列流、sticky 顶栏（导航收起、CTA 44px 触控高）、标题 balance 两行、卡片全宽、宣言卡纵排、无溢出。
- **全页两档**（captureBeyondViewport，先滚动触发全部 reveal 再回顶）：内容链完整无缺失。

### 发现并修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | `js/main.js` 直接调用 `window.matchMedia`，在无该 API 的环境抛 TypeError 且中断 reveal 回退（jsdom 自检暴露） | 加 `typeof window.matchMedia === "function"` 守卫；复测 0 错误、回退生效 |
| 2 | hover 状态色变化无过渡声明，缺 MOTION-DESIGN-SPEC §4 的 160ms 档 | no-preference 作用域内补 `transition`（background/color/border/text-decoration 色），并清理两个未使用 token（`--grey-3` 并入文字角色注释、`--ease-press` 并回 `--ease-out-soft`） |
| 3 | 375 档定义列表双列过窄，值列逐字折行（截图发现） | ≤767 断点改 dt/dd 上下结构；复测通过 |
| 4 | 无障碍：键盘焦点可达性 | 全局 `:focus-visible` 2px accent 环 + skip link（结构自检通过，未逐键人工走查，记 Not verified） |

**Not verified**：真实浏览器人工键位走查（Tab 顺序/焦点环实操）与 200% 缩放、RTL 镜像（单语站点未做 RTL）；前者结构面（DOM 顺序 = 视觉顺序、无正 tabindex）已由代码与 jsdom 检查覆盖。

---

## 14. 附录：GUIDE 登记块（仅文本建议，本文不改 GUIDE）

> 按硬不变量 3「先改文档再编码」，M10 启动须由总控在 `AI_DEVELOPMENT_GUIDE.md` 登记。以下为建议登记文本（建议版本号 **v48.88**；决策号沿用本稿 D131）。

**版本号（文档标题）**：

```
# 一站式渐进阅读学习软件（**v48.88**） — AI 开发指导文档
```

**§8.1 决策日志新增行**：

```
| D131 | M10 官网启动：官网交付为纯静态单页（website/，手写 HTML+CSS+原生 JS，零框架零构建器零外链）；文案唯一事实来源=§6.2/§9.2 已实现功能（材料导图等未实现项不宣传）；下载区为诚实占位（安装包已配置未发布，不放假链接）；视觉遵循 docs/swiss-international-style.md、动效遵循 docs/design/MOTION-DESIGN-SPEC.md（D120）档位；设计稿与实现记录 docs/design/WEBSITE-M10-D131.md | 主线盘点「M10 官网 ❌ 未启动」；用户指令「我引用的对话内容的任务，请全部帮我实现和处理」（2026-10-12） | v48.88 |
```

**§9.2 M10 状态行更新文本**：

```
| M10 | 官网 | 🟡 静态站点已交付（website/ 单页：首屏/核心能力/工作流/隐私/技术/下载占位/页脚；设计稿 docs/design/WEBSITE-M10-D131.md）；对外发布渠道与正式部署未启动（对应 M9 边界） |
```

**§9.5 下一步建议行（可选）**：`M10 收尾：官网对外部署渠道由用户拍板后接入真实下载链接（当前为诚实占位）。`

