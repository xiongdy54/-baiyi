# 批注样张对齐与阅读器工具栏重排

> 状态：**设计待用户审阅；未实施**。
> 适用层：文件阅读器（EPUB / PDF）与摘录复习页；粘贴书 Markdown 阅读容器维持当前布局行为。
> 规格日期：2026-09-28。
> 视觉基准：`design-samples/annotation-two-modes.html`（摘录页批注栏、阅读器三页签、图谱目录、选区菜单、编辑浮层）。
> 代码基线：分支 `摘录复习改版`，提交 `a6d4f53ef49ceac8feee83660c311088881406d9`；确认时已跟踪文件无改动。工作区未跟踪截图、临时量测脚本、其他样张与 F40 夹具保持原样，不纳入基线提交。

## 1. 目标与非目标

### 目标

- 将摘录复习正文和批注栏实际显示对齐到 HTML 样张。
- 将阅读器目录浮层升级为可开合的右侧共用侧栏，完整实现「目录 / 摘录 / 图谱」三个页签；「摘录」页复用注解卡片及现有批注栏交互。
- 以精简单行工具栏减少阅读器 chrome：常驻侧栏入口与翻页；低频导图/复习动作进入「更多」，阅读模式/主题/缩放进入「阅读设置」。
- 图谱侧栏只移除不需要的占比条，不改主进程图谱算法、IPC 数据契约或其他消费者。
- 维持 PDF 与 EPUB 的阅读位置、标记与选区正确；不把面板覆盖到正文上。

### 非目标

- 不改数据库 schema、摘录队列、调度、批注写入语义或 IPC 数据模型。
- 不重做两种批注面（保留唯一 Zotero 式展示）。
- 不改阅读器工具栏中低频动作的业务处理函数；只调整入口容器/显隐及必要的按钮标签。
- 不改变图谱区间的含义；本规格中它是现有 `nodeRange` 覆盖区间，而不是 `ownedRanges`。
- 不尝试为 EPUB 的 CSS Custom Highlight API 添加 SVG 角标；此为现有引擎接口能力边界。
- 不清理、不提交工作区现存未跟踪文件，除非之后另获明确指示。

## 2. 设计决定

### D1：代码样式以当前 HTML 样张为准，覆盖其实际列出的界面

- 摘录页正文：`--fs-title-l`（26px）/ 1.5 行高；仅限定 `.extract-page` 中的摘录卡正文，避免影响 `ReviewView` 合并复习里复用的 `ExtractCardFace`。
- 摘录页批注栏：延续现有 280px `.annot-side` 和 `AnnotationPanel`；保留样张外已有的筛选、排序、内联改批注、改色、二次确认删除、跳转/定位交互。
- 保留样张和现有 token 的瑞士风规则：Token 字号/间距、直角、hairline、主题色、深浅主题；不加新的圆角、投影、第二焦点色或说明性小字。

### D2：阅读器三页签栏为右侧开合式，占位，不覆盖正文

- 顶部当前「目录」按钮改为单一「侧栏」入口，明确可以访问目录、摘录、图谱；不新增并列的第二个入口。
- 点击入口打开/关闭右侧 280px 栏；关闭按钮与原入口都可关闭。打开侧栏时保留最后选择的页签。入口可用条件是三类内容任意一类存在（可用目录、当前文档注解、可用图谱）；三者都不存在时隐藏/禁用入口，不能再沿用 PDF「无目录即不渲染入口」的旧条件。
- 有 TOC 时渲染目录 tab；有 current-document annotations 时渲染摘录 tab；有已发布图谱且映射数据可用时才渲染图谱 tab。各 tab 按各自数据可用性独立出现。若栏仅因原文注解打开、该 PDF 无目录：显示摘录 tab 及注解列表，不伪造目录内容或图谱 tab。
- 右侧栏和阅读视口处于同一横向布局。打开侧栏时 PDF.js 容器和 EPUB host 的**内容视口宽度真实收缩 280px**，不能仅画在原正文上方；关闭时恢复完整宽度。
- 改为右侧 dock 后，目录活动章节标记不再使用旧的「左侧浮层 + 正文 padding-left」几何。PDF/EPUB 两引擎均以新的右侧视口边界为准。
- 侧栏宽度是既有契约 280px。窗口当前有 `minWidth:1120`、`minHeight:640`，不调整其数值；需要以窗口最小档做真实 GUI 验证。

### D3：「摘录」页签复用真实注解数据与批注栏能力

- 用 `workflowAPI.listAll()` 当前有效的摘录行，过滤当前 `documentId` 并排除有 `parentExtractId` 的子摘录（原文侧没有整卡自有批注；listAll 本身已滤除软删行）。面板排序需使用可复核的文档位置，不得直接把 `listAll()` 的优先级/到期顺序冒充阅读位置：PDF 依 `pageIndex` 与 sourceAnchor.rects 的首矩形几何排序；EPUB 依 CFI resolve 后的章节索引与 Range 文档顺序排序。位置不可解析的老数据稳定放在已解析数据之后，仍可时间排序；不得借用文本搜索制造隐式重锚。时间排序仍使用既有组件的时间排序行为。
- 以共享 `AnnotationPanel` 展示现有卡片层级：批注色竖线/色点、引文、非空批注、时间、摘录/高亮类型。阅读器不出现摘录页才有的“整卡置顶”项。
- 复用现有 `app.annotationFilter` 与色板设置，并保留筛选、排序、内联编辑、改色、二次确认删除。
- 侧栏条目执行“定位到该注解”的真实导航，而不是仅打开旧 hover popover：增加只读 `goToMark(id)` kernel 能力，按已有标记 ID 跳到 PDF 页或 EPUB CFI；通过适配层完成，不在业务组件触碰 PDF.js DOM 或 EPUB iframe DOM。PDF `sourceAnchor` 只有页码和矩形，故此入口承诺“目标页＋标记可见”，不承诺精确恢复页内矩形的垂直位置；EPUB 有 CFI 时导航到该 CFI/Range 的位置。
- PDF 导航成功后以用户条目的 annotationColor/标记 id 触发短时强调（不新增落库字段或改标记持久样式）；若目标矩形实际不可见，则只能报告导航到页，不能断言矩形已露出。老数据缺少可定位 sourceAnchor 时保留条目可见、返回不可定位，并在栏内显示中性状态，不用 anchorText 搜索伪装精确落点。
- 标记指针语义原样保留：正文 hover 预览 `MarkPopover`，正文 click 打开 `AnnotationEditor`。侧栏导航是第三个独立入口，不改变 hover/click 决定。
- 当前 `ReaderDocMark` 缺少 `createdAt`。共享面板的阅读器行需要它来显示样张时间，由 `buildDocMarks` 的纯函数输入/展示 view model 带出 `createdAt`；不把 UI 字段混入内核绘制 `ReaderDocMark` 契约。
- 两类条目颜色继续复用 `annotColor.ts` 与现有主题 Token；当前配色以及清空批注/改色/删除的写入语义不变。

### D4：图谱页签仅做表示层调整

- `electron/main.js` 的 `mindmap:mapTree`、`mindmapCore.buildExtractionModel`、`MapTreeItem.start/end/depth` 和所有调用方保持不变。
- 侧栏移除 `.map-bar` 占比条及 `mapUnitCount` 对显示的依赖；节点行呈现标题、现有 `[start,end)` 覆盖区间与层级（如“单元 0–2 · L1”），维持现有层级缩进与点击跳转。
- 测试保留对覆盖区间嵌套、同级不重叠/全篇覆盖、层级缩进的检查；只将 UI 判据从“存在占比条”改为“占比条不存在且起止/层级文字可见”。
- 文档更正：现有 IPC 返回 `model.nodeRange`，不是 `ownedRanges`；规格与注释不得声称此界面使用父范围减子范围。

### D5：阅读工具栏采用 B 双入口精简

- 常驻行保留：侧栏入口、上页/下页。
- 「更多」折叠入口收纳：导图、按书范围复习摘录、复习闪卡。
- 「阅读设置」折叠入口收纳：阅读模式、阅读主题、PDF 缩放。
- 默认两组均折叠；使用语义按钮与 `aria-expanded`/`aria-controls`、可见焦点样式；`Esc`/点外关闭临时展开菜单。现有 `readerSettings` 的读取、写入和应用路径保持原样；展开态不持久化。
- 阅读设置控件在组内按 `模式 → 主题 → 缩放` 排列；PDF 才有缩放；同一菜单打开时另一个关闭。窄窗下菜单必须可完整命中，不遮挡侧栏 tab 触点。

## 3. 布局与定位不变量

### 3.1 阅读器 dock

- 视口可用宽度：关闭时 `W`，打开时 `W - 280px`（允许浏览器边框/测量误差 ≤1px）。
- 侧栏矩形右边缘与阅读容器右边缘对齐；侧栏左边缘等于剩余正文容器右边缘；正文与侧栏矩形不相交。
- 拖拽选区菜单、AnnotationEditor、MarkPopover 均继续按真实 viewport rect 定位；打开/关闭侧栏后不得被层级或 overflow 裁掉。
- 展开工具栏菜单以 anchor 视口 rect 放置，屏幕边缘夹紧，不能盖侧栏 tab 行的有效点击区域。

### 3.2 摘录正文

- 样张正文内容 computed font-size=26px、line-height=1.5；元信息/动作仍取原档。
- `AnnotationPanel` 有条目时栏宽 280px，正文与栏不相交；无条目时仍按当前契约不显示摘录页栏。
- 复习页 `ReviewView` 复用的 `ExtractCardFace` computed font-size 保持改前基线；scope 不得泄漏。

### 3.3 锚点稳定

- 开合栏、展开/收起工具栏不得持久化新的阅读进度，也不得覆盖“跳转现场查看”语义。
- PDF 数值缩放（50–300%）：缩窄/放宽时先快照当前页、PDF 内容坐标与对应缩放，之后还原视口宽度但不改变当前Scale preset；用页内容坐标验证目标位置，viewport rect 差 ≤2px，当前页不变。PDF `page-width`/`page-fit`：保留 PDF.js 的 adaptive scale 行为，页宽变化后 scale 会按新 viewport 重算，容许 rect 随缩放改变，不断言固定屏幕位置；只断言当前页不被误改且比例语义仍为对应 fit preset。关闭侧栏恢复 viewport 后同理重新适配；用户明确导航/翻页除外。侧栏注解点击须目标页与矩形到位。
- EPUB：开合前快照当前 CFI（必要时同时 snapshot fractional fallback）；宽度变化后等待 rendition reflow / `relocated` 稳定，再恢复到快照 CFI。只有该次布局恢复期间的被动 relocate 被抑制写入进度；后续由真实用户翻页/滚动产生的 relocate 必须照常写入。侧栏注解按 CFI 导航。
- 普通用户主动翻页/滚动仍按原逻辑更新进度。不可定位老数据不能虚报跳转成功。

## 4. UI 状态与可访问性

- 侧栏入口有明确可访问名称「侧栏」，`aria-expanded` 与打开状态一致，`aria-controls` 指向侧栏。
- 页签维持 `role=tablist/tab`、`aria-selected`；同刻只渲染一个 panel；Esc 关闭侧栏时焦点回到侧栏入口。
- 工具栏折叠入口为按钮，不用仅 hover 才可用的交互；能以 Tab/Shift+Tab/Enter/Space 全程操作。
- menu 内控件具 label/title，焦点环沿用 accent，不用 outline 做装饰描边覆盖焦点。
- close control 始终可见且有 accessible name；目录空时入口仍可经注解/图谱开启，并展示目录空态；无 map 时只隐藏 map tab，不隐藏可用的共用侧栏入口。

## 5. 错误与兼容处理

- 不新增持久化设置键；侧栏开合、页签当前项、工具栏展开态均为 Reader 会话状态。
- 阅读器摘录面板读取失败按现有增强信息策略显示空/不可用状态，不阻塞阅读器和工具栏。
- 标记定位能力在 kernel 作为可选/最小扩展，由 PDF/foliate adapter 实现；若目标锚不能 resolve，返回明确 `false`，侧栏不假装滚动成功，条目本身保留。
- 侧栏条目导航只新增一个与原文标记指针分开的触发入口：hover 标记仍预览 `MarkPopover`；click 正文标记仍直接打开 `AnnotationEditor`。不得把历史上已裁定的正文点击语义改回“点击先钉住 hover 浮层”。
- 图谱数据读取失败不显示图谱页签，保持现有 fail-closed 增强信息策略。
- 现有 `AnnotationPanel` 的失焦编辑、删前确认、颜色落库路径不改；阅读器侧内联编辑/颜色写入沿用 `useSelectionActions` 的事件广播，确保 `marksRef` 重算并重画标记。
- PDF 角标保留。EPUB Highlight API 仅提供文本高亮，无法提供与 PDF 相同的右上角形状角标；此差异是明确的技术接受差异，不扩展到 vendor 或 DOM 装饰层。

## 6. 候选范围与文件边界

表现/渲染改动预期集中：

- `src/components/Reader.tsx`：顶部双入口控件、文件阅读器侧栏开合与 dock 布局接线、读取当前文档注解、锚点快照/恢复的 UI 编排；Markdown 阅读器容器不改。`onProgress`/进度写入逻辑只可加明确的布局抑制闸，不重写既有计时或统计管线。
- `src/components/reader/ReaderSidebar.tsx`：右侧三页签、全量注解面板、图谱文字区间行、无占比条。
- `src/components/reader/AnnotationPanel.tsx`：仅在共享 API 真有缺项时做最小 props/可访问性调整；不复制实现。
- `src/components/reader/ReaderExtractsPanel.tsx`：可改造成纯注解数据 hook / view-model builder；过滤语义见 D3；保留一个单一数据入口，不并行双渲染。
- `src/components/ExtractCardFace.tsx`/`src/theme.css`：限定摘录复习页正文字号；阅读器 toolbar/sidebar/dock/map-row 样式；不得波及 `ReviewView` 合并复习卡面。
- `src/components/icons.tsx`：仅在现有本地图标缺少侧栏/更多/阅读设置符号时增加遵守现有尺寸/线宽规范的内联 SVG path。
- `src/lib/reader/kernel.ts`、`src/lib/reader/pdf/adapter.ts`、`src/lib/reader/foliate/adapter.ts`：仅添加按标记 ID 精确定位所必需的 adapter 能力；不改变源锚数据模型。
- `tests/annotations.gui.mjs`、`tests/reader.engine.mjs`、`tests/pdf.driver.js`/PDF L1 驱动：新增 UI、定位与几何判据；根据真实调用关系更新被废弃的 `tests/visual-audit10.mjs`、`visual-audit11.mjs` 旧左侧浮层假设，或明确退役它们。
- `AI_DEVELOPMENT_GUIDE.md`：需求/实现边界已超出 D66 的旧规格，先 bump 版本并登记新决策；同步侧栏开合、工具栏结构、PDF/EPUB 锚点行为、图谱条仅属表示、EPUB 角标差异及测试义务。
- 不改 `electron/main.js`、`electron/mindmapCore.js`、preload 图谱接口、`MapTreeItem` 区间语义或任何数据库 schema。

具体文件最终以实现期代码审阅为准；若为完成 UI 发现需要业务数据库/IPC 变化，停止并再次与用户确认，不借此规格默许扩权。

## 7. 验收与回归

### GUI 主判据

1. 默认启动：常驻顶栏只见侧栏/翻页与两个精简入口；“更多”或“阅读设置”打开关闭可操作；阅读模式/主题/缩放原设置值与设置写回一致。
2. 侧栏闭合：内容视口宽度基线被记录；打开侧栏后宽度差 280±1px；正文/侧栏无重叠，右侧边界齐平；关闭还原到基线。
3. 边界尺寸：窗口最小合法尺寸 1120×640 和更宽窗口均检查；sidebar 打开、toolbar 更多/设置菜单、selection menu、editor 同时序交互无裁切/错误遮挡；粘贴书 Markdown 阅读视图在开关事件不可达且 DOM/计算布局保持改前基线。
4. 页签：目录/摘录依可用数据出现、图谱仅在有已发布图时出现；有图和无图两组夹具分别验 tab 数量（无图书籍仍须能通过目录/注解开启侧栏）；同刻一个面板可见；active tab accent 2px；侧栏入口关后正文恢复，下一次开保留会话页签。
5. 摘录页签：夹具至少包含两条带批注、一个纯高亮、两种颜色；卡片字段、时间、排序/筛选、编辑/清空、改色、二次确认删除均真实可用并回读持久化数据。
6. 注解跳转：PDF 与 EPUB 夹具各至少一条同文档已定位标记；记录跳前/后 location；侧栏 click 走 `goToMark(id)`，PDF 判据是目标 pageIndex 到位且目标矩形非零、属于该页，不要求 target.rect.top 回到 viewport（sourceAnchor 没有该持久字段）；EPUB 判据是 adapter 返回成功且 current CFI 与 target CFI 经 CFI comparator 至少同一目标 Range/文本位置，几何进入可视区。目标夹具必须改变 page/CFI（变化非零）。坏 id / 老数据无 pageIndex+rects 或 CFI 作负对照：不可定位条目仍在栏中并显示中性 unavailable 状态，导航返回 false/有界失败，不能显示成功或调用模糊文本搜索。
7. PDF 侧栏导航/视口重排边界：① `goToMark(id)` 负对照时报告未定位/false，不宣称矩形可见。② 在侧栏开合期间，`page-width`/`page-fit` 保持 preset 且 computed scale 重新适配视口；不错误要求固定 viewport rect。③ 明确用户翻页的正向对照必须能改变 pageIndex 并按原逻辑写一次 progress。由于 PDF 适配层没有按页内 XY 滚动的既存 API，数值缩放档下本批也不承诺 snapshot/restore viewport offset；只断言开合本身不改变 `currentPageNumber`，必要的更强页内像素锚留待单独授权新增 API。
8. EPUB 锚点：① 在章节中部真实点击侧栏 CFI，adapter `view.goTo(cfi)` 成功，当前位置以 EPUB CFI comparator 对目标 Range 定位，并用 range 文本相等与可视几何交叉判定（如当前 CFI API 无法严格比较，应以 resolve 目标 Range + text equality 作主要 oracle）。② 打开/关闭侧栏触发真实 ResizeObserver/reflow 后，记录初始 CFI，最终定位到同一目标 Range 文本、目标 Range 进入 viewport；被动 relocate 不误写 progress，随后的用户主动翻页/滚动 CFI 改变且照常保存。验收几何容差是 reflow 后“目标进入可视 viewport”而不是要求保留相同 CSS px 的旧 rect。
9. 摘录页：computed 26px / 1.5；注解栏宽 280px；正文列 + 栏几何正确；合并复习用 `ExtractCardFace` 仍保持此前 14px 内容档。
10. 图谱 UI：`.map-bar`/`[data-map-bar]` 数量为 0；单元区间与层级文字在场；原有区间覆盖/嵌套、同级不重叠/并集检查保持；主进程 mapTree 返回结构对变更前后深度相等（非更改/过滤字段）。
11. 图片对照：深浅主题、PDF 与 EPUB、sidebar closed/open、toolbar collapsed/expanded 各截图；主会话逐张目视；截图涉及对齐/遮挡的结论另报矩形差/scrollWidth/clientWidth。
12. 对照自证：每个可测断言对目标集合必须非空；至少注入一个错位 sidebar width/错误 pageIndex/多渲染 map bar 的坏例能判红，再恢复后判绿；不把空运行算成功。

### 测试矩阵

- 先 `npm run build`，再 `node tests/annotations.gui.mjs`（该套件会 taskkill 全局 electron；执行前确认无用户/并行 Electron 实例；使用隔离 userdata）。
- 阅读器定位变更：`npx electron tests/reader.kernel.cjs`（fake kernel/API 语义）+ `node tests/reader.engine.mjs`（EPUB L2）+ `npx electron tests/pdf.kernel.cjs`（PDF L1，扩展成按标记定位与尺寸变更）。
- 必须保持：`node tests/marks.gui.mjs`、`node tests/breadcrumb.gui.mjs`、`node tests/multiselect.gui.mjs`，摘录页既有 GUI 与 `tsc --noEmit`。
- 更新 GUI 断言及截图：侧栏按钮由「目录」变「侧栏」；旧 visual-audit 的左侧命中坐标需移为右侧、按实际 viewport 几何定位，不保留过期左 dock 测量。
- 开发机验证外，执行本项目当前指定的“他人电脑”离线/无 GPU/非英文路径等已可复现分发检查；项目尚无 installer/distribution 通道，报告必须说明未能验证真实干净机器安装启动，不可声称异机分发已通过。

## 8. 已知限制

- `.extract-page` 正文在样张为 26px；ReviewView 会复用卡片组件，字号必须以宿主 scope 限定。
- PDF 页宽变化会触发 pdf.js ResizeObserver；页码稳定是硬判据，不假设 width 改变无副作用。
- EPUB 重新排版会改变可视几何，必须使用 CFI 保存/恢复，不能只比较旧 viewport x/y。
- EPUB 标注目前只能用 CSS Custom Highlight，不画 PDF 式角标（接受差异）。
- 按标记 ID 定位必须经 kernel/adapter，业务 UI 不可触碰 PDF.js DOM 或 EPUB iframe DOM。
- 样张的“图谱区间说明”误称 ownedRanges；实际侧栏数据是主进程传回 nodeRange 覆盖区间，数字与样张截图相符。本次只删 bar，不替换区间语义。

## 9. 决策记录草案

- **D67（待指南更新）**：按 HTML 样张完整对齐摘录正文、开合式右侧批注/目录/图谱栏与精简阅读器工具栏；侧栏按 ID 走内核定位（PDF 保证页，EPUB 保证 CFI Range）；图谱只隐藏占比条且保留主进程 nodeRange 契约；PDF 数值缩放保页内点、fit 模式自适应；EPUB resize 恢复目标 CFI 且抑制被动进度写入；EPUB 角标缺失为接受的适配器能力差异。
