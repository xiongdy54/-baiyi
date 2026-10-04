# EDITOR-EXTRACT-CARD-D93 — 摘录卡 WYSIWYG 编辑器 + 默认读态 + 字号同步（设计稿 v1）

> 决策号 **D93**（总控分配，当前 GUIDE §8.1 最大编号 D92）。本文档是两阶段流程的**第一阶段产物**：只调研、只设计，**不含任何代码改动**。第二阶段施工以本文档 §G 施工清单与机械验收清单为准，不得自创验收标准。
> 本文所有行号均为 2026-10-04 在 worktree `feat/editor-extract-card-d93`（基线 5b05dd8）实测，施工时以实际代码为准（可能小幅漂移）。

---

## 0. 用户原话（2026-10-04，逐字留痕）

第一条：

> "完善编辑器，完善对规范markdown语法的全面支持，先查找有没有开源成熟的markdown编辑器可以直接使用，同时在编辑器下方增加一个富文本编辑工具栏（这个工具栏可在设置中关闭）。摘录卡片不用这么大，请和阅读界面的文字同步，并且可以在设置中自定义字号和字体等。摘录卡片中目前有一个问题，就是阅读界面中可以点击高亮内容弹出弹窗进行批注或者更改颜色以及其他操作，而摘录卡片不行，因为摘录卡片是可编辑的，一点击直接进入编辑模式了，所以我希望摘录卡片默认是阅读模式，划选文字或者点击高亮区域时都不会进入编辑模式，只有点击摘录卡片上的非高亮区域时才会进入编辑模式。"

第二条（编辑器形态已拍板）：

> "我想要'所见即所得'型的编辑器，也就是按照语法输入markdown后直接把语法效果渲染显示出来"

---

## 1. 结论速览

1. **编辑器选型（§A）**：推荐 **Milkdown 7**（`@milkdown/kit` + `@milkdown/react`，`^7.22.2`，MIT）。核心理由：Milkdown 的文档模型**就是 remark AST**（markdown-first），"源文 markdown 进 / 源文 markdown 出"是它的原生路径而非附加转换器——这是五个候选中与本项目「`content_markdown` 是落库事实」最契合的一条；且其 math 组件的依赖（`remark-math ^6` + `katex ^0.18`）与仓内既有依赖**同版本族**。
2. **读态渲染**：沿用仓内既有渲染管线 react-markdown 10（闪卡面 / AIPanel 先例），新增 `remark-gfm ^4` 补齐表格/删除线/任务列表（"规范 markdown 全面支持"）；**编辑态与读态共用同一解析族**（remark-parse ^11）。
3. **偏移锚定不变式（§C，最高技术约束）**：`quote_range_json` / `contextRef.parentRange` / 面包屑 `viewRanges` **仍是 `content_markdown` 源字符偏移，零数据迁移**；写侧重映射链（`electron/annotationRange.js` @ `db.updateExtract`）**零改动**。新增读态渲染 DOM 与源偏移的**双向映射纯函数**（基于 remark-parse 的 `node.position`）。
4. **默认读态（§D）**：卡面默认渲染只读；**点非高亮区 → 进编辑**；**点高亮 → 批注浮层**（复用 AnnotationEditor 唯一浮层，对齐阅读器 `markClick` 交互）；**划选不进编辑**（选区菜单/五动作/多段集合机制原样保留）。
5. **工具栏（§E）**：编辑器下方一行富文本工具栏，新设置键 `app.extractEditorToolbar`（bool，默认开）可关。
6. **字号/字体（§F）**：删掉摘录页 26px 覆盖（"卡片字过大"根源），卡面字号经根级 CSS 变量与阅读器外观（`app.readerSettings.appearance`）**同步**，默认跟随、设置页可独立自定义字号/字体/行高。
7. **新增依赖 5 个**（全部 npm 打包、零网络）：`@milkdown/kit`、`@milkdown/react`、`remark-gfm`、`rehype-raw`、`rehype-sanitize`；直接声明 2 个既有传递依赖（`remark-parse`、`unified`）。**零 schema 变更、零新 SQLite 表/列、零新写通道**（保存沿用既有 `extracts` 更新 IPC）。
8. **新设置键 4 个**（`app` 层，§7.4 登记 + F18 `DOC_KEYS` 同步）：`app.extractEditorToolbar` / `app.extractFaceFontFollow` / `app.extractFaceFontSize` / `app.extractFaceFontFamily`。

---

## 2. 代码现状实测锚点（2026-10-04，worktree 基线 5b05dd8）

| # | 锚点 | 事实 |
| --- | --- | --- |
| 2.1 | `src/components/ExtractCardFace.tsx` | 三渲染分支：`viewOnly` → `textWithRanges` 纯文本 + `<mark class="extract-quote-hl">`（L345-350）；`handlers.onEdit` 在场 → `EditableText`（L351-352）；否则纯文本兜底（L353-355）。`domTextOffset`（L59-90）＝「文本节点累加 + `<br>` 计 1」纯文本偏移坐标系；`selectionOffsetsInBody`（L97-110）采集选区偏移；`parseQuoteRanges`（L34-51）规范化区间。选区采集 effect（L232-310）：mousedown 起手修饰位采样（D79）、mouseup 求或采集、动作面豁免清单（L280-283）。 |
| 2.2 | `src/components/EditableText.tsx` | 50 行裸壳 contentEditable，React 不接管子节点（D10）；失焦读 `innerText`（`\n{3,}` 归一 `\n\n`）提交，Esc = blur。**消费者**：ExtractCardFace（本任务移除）与 CardBrowser（闪卡面，保留）。 |
| 2.3 | `src/components/ExtractReviewView.tsx` | `bodyGroups`（L293-297）＝子摘录段锚批注按（色×形式）分组，**不含 id**；`anchorForAnnotation`（L311-319）＝按 `rangesByIdRef` 的父卡坐标区间算浮层锚点；批注轨 `onJump` → `setEditing`（L847-859）是**当前唯一**的浮层入口；`AnnotationEditor` 渲染于 L982-1005（容器＝页面矩形）；`handleFaceSelection`（L615-653）＝多段集合运算（D78/D79，渲染层偏移域）；头带提示文案「空格＝下一条 · Z＝撤销 · 正文可直接编辑」（L904）；工具栏 L880-894（D92 将改「制卡」disabled 与让位联动）。 |
| 2.4 | `src/components/ReviewView.tsx` | 合并复习分支（L523-566）渲染 `ExtractCardFace` + `ExtractActionsBar`，`exHandlers` 有 `onEdit`；**无 `useSelectionActions` import、无 AnnotationEditor、无 bodyGroups**（实测 grep 零命中）——点高亮弹浮层在该分支不存在任何既有接线。 |
| 2.5 | `src/lib/reader/bodyAnnotations.ts` | `paintBodyAnnotations`（L120-159）＝CSS Custom Highlight API 绘制层，按（色键×形式）注册 `::highlight(annot-body-*)`；`rangeFromOffsets`（L37-87）/ `rectFromOffsets`（L95-106）＝旧同构坐标系（文本节点累加 + br 计 1）；文件头注释（L1-4）明载「不得往 DOM 插 mark（与 EditableText 裸壳契约冲突）」。`BodyAnnotationGroup`（L108-114）＝`{color?, underline?, ranges}`，**无 id**。 |
| 2.6 | 阅读器高亮点击（对齐目标） | `src/components/Reader.tsx`：`k.on("markClick")`（L734-746）→ `setMarkEditor`（L394-400）→ `AnnotationEditor` 唯一浮层（L1735-1763，D85 悬停退役）；落库走 `useSelectionActions` 的 `saveAnnotationComment` / `saveAnnotationColor` / `removeAnnotation`。**`useSelectionActions.ts` 属 D92 施工面，本任务禁止改动该文件，只允许调用其现有导出。** |
| 2.7 | 字号现状 | `src/theme.css`：`.extract-face-body { font-size: var(--fs-body)… }`（L5707，--fs-body=14px）；`.extract-page .extract-face-body { font-size: var(--fs-title-l); line-height: 1.5 }`（L5711，--fs-title-l=26px，**"卡片字过大"的根源**）；`.extract-quote-hl { background-color: var(--hl-multi) }`（L5653）。阅读器字号存 `app.readerSettings.appearance.fontSize`（默认 17，`resolveAppearance` 钳 10–40，`src/lib/reader/foliate/appearance.ts` L35），只经 `injectAppearanceStyle`（L59-73）注入章节 iframe，**不进应用 DOM**。 |
| 2.8 | 设置体系 | `electron/main.js` `settings:set`（L180-210）写侧归一先例（`multiSelectKey`/`annotateMode`/…逐键 normalize）；渲染层 `src/lib/settings.ts`（`settingsStore.get/set` + `settings/changed` 广播）；订阅 hook 先例 `src/lib/annotationSettings.ts`（读侧归一 + eventBus 订阅 + `useAnnotationSettings`）；设置界面 `src/components/SettingsPanel.tsx`：`sec-reader` 区（L1141 起）有字号滑杆（L1263-1273，12–32）/字体输入（L1276-1283）/布尔开关先例，导航 `sections` 数组（L2086 起）。 |
| 2.9 | markdown 相关依赖（`package.json` 实测） | `react-markdown ^10.1.0` + `remark-math ^6.0.0` + `rehype-katex ^7.0.1` + `katex ^0.18.5`（闪卡面渲染先例 `CardBrowser.tsx` L1387、`AIPanel.tsx` L134/L452）；`turndown ^7.2.4`（HTML→MD）；`markdown-it ^14.3.1`（**第一方零引用**）；`dompurify ^3.4.14`。**无任何编辑器框架依赖**；react-markdown 10 内部依赖 `remark-parse ^11` + `unified ^11`。 |
| 2.10 | 落库与重映射 | `electron/db.js` `updateExtract`（L2813-2865）：内容变更 → `annotationRange.transformRanges(prevRanges, old, new)` 重映射**本条自身** `quote_range_json`；`comment/color/kind` 可写；撤销快照含区间。**注**：子摘录 `contextRef.parentRange` 不在重映射范围（既有边界，非本设计引入，见开放问题 ③）。`db.updateExtract` 走既有 `persist()` 原子写。 |
| 2.11 | multiHighlight | `src/lib/reader/multiHighlight.ts`：`update(action)` 直接取**当前原生 Selection Range** 画 `::highlight(multi-select)`——不经过偏移换算，读态渲染 DOM 下天然成立（划选高亮零改动）。 |
| 2.12 | 受影响测试（实测） | `tests/extract.gui.mjs` L94/L96-100 断言 `.extract-face .review-editable` 在场并直改 innerText 落库；L126-129 `.extract-face-text || .review-editable` 选择器；L904 附近提示文案。`tests/annotations.gui.mjs` L407 拖选源＝`.extract-face .review-editable`。`tests/breadcrumb.gui.mjs` L135/L229/L476 断言 `.extract-face-body .extract-quote-hl`（DOM `<mark>`）。GUIDE §7.3：`tests/annotation-range.test.cjs`（25 项）与 `tests/annotation-db.test.cjs`（15 项）必须保持绿；`tests/extracts.test.cjs` 137 项零回归。 |
| 2.13 | 闸门 | `tests/flows/f18-settings-matrix.cjs` L34 `DOC_KEYS`：新设置键必须登记进 GUIDE 并同步 DOC_KEYS，否则 Y1/Y2 判红。 |

---

## A. 开源 WYSIWYG markdown 编辑器选型调研

### A.1 调研方法

npm registry 版本/许可/体积数据为 **2026-10-04 `npm view` 实测**（非记忆）；能力判断基于官方文档与 GitHub 官方仓库/发布页。候选按"markdown 源进/源出受控往返"这一本项目硬指标挑选：**TipTap、Milkdown、Lexical、Vditor、BlockNote** 五个（另有多 markdown 编辑器 bytemd/editor.md 等因非 WYSIWYG 或无维护未入围）。

### A.2 候选横向对比

| 维度 | **Milkdown 7** | TipTap 3 | Lexical 0.52 | Vditor 4 | BlockNote 0.55 |
| --- | --- | --- | --- | --- | --- |
| 包与版本（npm 实测） | `@milkdown/kit` / `@milkdown/react` / `@milkdown/crepe` **7.22.2**（2026-09-23 发布） | `@tiptap/core` / `@tiptap/starter-kit` **3.31.4**；markdown 转换靠社区包 `tiptap-markdown` **0.9.0**（最后发布 2025-09-08） | `lexical` / `@lexical/markdown` **0.52.0** | `vditor` **4.0.0**（依赖仅 diff-match-patch，单包自包含） | `@blocknote/core` **0.55.0**（构建于 `@tiptap/core ^3.31.3`） |
| React 18 / Vite 6 / TS | 官方 `@milkdown/react` 绑定；ESM；TS 原生 | 官方 `@tiptap/react`；成熟 | 官方 `@lexical/react`；成熟 | **无 React 绑定**（命令式 init/destroy，React 里 ref 包装）；TS 类型自带 | 官方 React 绑定 |
| **markdown 源进/源出保真（决定项）** | **文档模型即 remark AST**（markdown-first）：解析与序列化是主路径而非外挂转换器；与仓内 react-markdown 同属 remark 生态（remark-parse ^11） | ProseMirror JSON 为主模型，markdown 靠外挂转换器；转换器与 core 版本节奏不同步 | 官方定位 markdown 为**交换格式**：transformers 未覆盖的构造导出时被丢弃/拍平；官方推荐 JSON 作存储——与「源文 markdown 是落库事实」直接冲突 | markdown-native（三模式均围绕源文本），**IR 模式即"按语法输入直接渲染"**——与用户第二条原话最贴合；但源↔DOM 映射是黑盒 | 导出 API 即名 **`blocksToMarkdownLossy`**（官方自认有损）；Notion 式块模型与连续摘录文本形态错配 |
| 内联彩色 mark | 不需要（本设计把多色批注整体留在读态绘制层，§C）；若未来需要：ProseMirror schema 自定义 mark，可行 | 同左（不需要；可自定义 mark） | 同左（可自定义 mark node） | 需 hack DOM | 同左（可自定义） |
| KaTeX | math 组件依赖 `remark-math ^6` + `katex ^0.18`（crepe 依赖实测）＝**与仓内依赖同版本族** | 无官方 math（社区扩展质量参差） | 社区 transformer | 内置 KaTeX/MathJax（**自带一份 katex 资产**，版本双轨需管理） | 需自建 |
| 中文 IME 证据 | 内核 ProseMirror＝业界 IME 处理最成熟的编辑器内核之一；GFM preset 带 Safari 表格 IME 修复（官方文档）；中文社区使用广泛。**如实记录**：ProseMirror 系存在已知 CJK composition 上游缺陷（2026-04 仍被上游跟踪）——风险由「默认读态、编辑是次级动作」+ §A.4 换备选判据兜底 | 同为 ProseMirror 内核，IME 面与 Milkdown 同源 | Meta 维护，有专门 IME 测试设施；但 markdown 路径已有损，IME 优势救不了决定项 | 中文项目（国内维护），IR 模式输入路径不经 ProseMirror，IME 反馈少 | ProseMirror 内核 |
| 体积（npm unpacked 实测） | `@milkdown/kit` ≈0.12MB 聚合薄包 + `@milkdown/core` ≈0.20MB + `@milkdown/prose` ≈0.15MB + presets；运行时 gzip 约 300KB 量级（Electron 本地打包，无 CDN） | `@tiptap/core` 3.2MB | `lexical` 3.2MB | **23.6MB**（自带字体/katex/highlight 资产） | `@blocknote/core` + tiptap 全家 |
| 许可证 / 维护 | MIT；活跃（月度发布） | MIT；商业公司维护，活跃 | MIT；Meta 维护，活跃 | MIT；个人主导，活跃 | **MPL-2.0**；活跃 |
| 纯本地合规 | npm 打包、零网络；**mermaid 组件不启用** | 同 | 同 | 自带资产＝离线可用但体积大 | 同 |

### A.3 唯一推荐

**`@milkdown/kit` + `@milkdown/react`，版本范围 `^7.22.2`（锁定 7.x）。**

理由（按权重）：

1. **往返保真是架构性的，不是承诺性的**：Milkdown 的编辑器状态序列化回 markdown 是它的第一公民路径（remark AST ↔ ProseMirror），五个候选中唯一"源文进、源文出"不需要附加转换器维护方的。本项目 `content_markdown` 是调度/批注/子摘录全链路的第一事实（§2.10），编辑器毁损源文是最大风险项。
2. **与既有渲染管线同族**：读态 react-markdown 10 与编辑态 Milkdown 7 都基于 remark-parse ^11——同一段 markdown 在读态/编辑态的解析结果一致，§C 的映射表两端语义统一，避免"两个解析器对同一源文解析不同"的隐性错位。
3. **KaTeX 依赖同版**（`remark-math ^6` + `katex ^0.18`），公式在读态（rehype-katex）与编辑态（milkdown math）用同一份 katex 资产。
4. MIT、活跃维护、TS 原生、ESM/Vite 6 无冲突、React 18 官方绑定、npm 打包零网络。

### A.4 何时换用备选（判据，全部可机械观测）

1. **金样例往返测试失败**（§G 验收 1）：对代表性 markdown 语料集（含粘贴书常见的原始 HTML 块/行内 HTML、多级列表、表格、公式、脚注式引用）执行 `serialize(parse(md))`，若**文本内容**（去语法符号后）出现丢失/改写且无法通过配置修复 → 先评估渲染侧 rehype-raw+sanitize 是否已覆盖（本设计 P0 已含）；仍不行 → 换 **Vditor 4（IR 模式）**（markdown-native、输入路径不经 ProseMirror），接受其命令式集成与瑞士风重皮成本。
2. **中文 IME 组合期缺陷在真实使用中高频出现**且上游（ProseMirror/Milkdown）无修复时间表 → 同上换 Vditor IR。
3. **Milkdown 7.x 停更或断代 breaking** 且无平滑迁移路径 → 评估 TipTap 3 + `tiptap-markdown`（转换器换维护方，保真金样例同样适用）。

### A.5 明确不选的理由（一句话版）

- **TipTap 3**：编辑器本体优秀，但 markdown 是外挂转换器（社区包年未更）——把本项目最高风险项交给了最不受控的一环。
- **Lexical 0.52**：官方把 markdown 定位为有损交换格式、推荐 JSON 存储——与"源文 markdown 是落库事实"根本冲突。
- **Vditor 4**：能力贴合但为备选——23.6MB 资产包、无 React 绑定、源↔DOM 黑盒使 §C 映射不可实现（批注高亮画不进它的渲染 DOM），其 IR 模式仅作为 Milkdown 失败时的退路。
- **BlockNote 0.55**：块模型 + 自认有损导出，与连续文本摘录卡形态错配；MPL-2.0 亦增加合规注记负担。

---

## B. WYSIWYG 编辑器与 ExtractCardFace 集成方案

### B.1 三渲染分支重组（`ExtractCardFace` 内）

| 分支 | 现状 | 新方案 |
| --- | --- | --- |
| `viewOnly`（面包屑查看态） | 纯文本 + `<mark class="extract-quote-hl">` + `hlRef.scrollIntoView` | **ReactMarkdown 渲染**（remark-gfm + remark-math + rehype-katex + rehype-raw/sanitize）+ `quoteRanges` 经偏移映射绘制（`::highlight(extract-quote-hl)`，`--hl-multi` 色，§C.5）+ 落点滚动改为「映射 Range → `getBoundingClientRect` → 滚动容器居中」（尽力而为语义不变）。**仍无任何写动作。** |
| **会话读态（新默认）** | `EditableText`（点击即出光标） | **ReactMarkdown 渲染 + 批注绘制层**（`paintBodyAnnotations` 增 map 参，§C.4）+ 划选采集（选区菜单/五动作/多段集合机制原样保留，仅内部换算换成映射实现，§C.6）+ 点击路由（§D）。 |
| 编辑态（新） | —（读态即编辑态） | **ExtractEditor**（新组件，Milkdown 实例 + 工具栏 §E）：进入时 `defaultValue = content_markdown`；提交链见 B.3。 |

渲染与编辑的**视觉同构**：读态与编辑态的 markdown 元素样式统一挂在 `.extract-face-body` 作用域（`.extract-face-body h1/h2/p/blockquote/ul/code…`，全部走既有 `--fs-*` Token，瑞士风字号阶梯；Milkdown 根 `.ProseMirror` 设 `font: inherit`），保证"退出编辑 = 同一块内容、同一字号、同一排版"，不闪版。

### B.2 EditableText 的去留

- `ExtractCardFace` 停用 `EditableText`（import 移除）。
- **组件本身保留**：CardBrowser 闪卡面（`CardBrowser.tsx` L1320 先例注释即指它）仍消费——D10 裸壳决策对闪卡依然正确，**不推翻**。
- GUIDE §6.8-12「正文是 EditableText 裸壳 ⇒ 不得往 DOM 插 mark」的契约**收窄为闪卡面**；摘录卡面读态下仍坚持绘制层原则（CSS Custom Highlight API），**本设计不往 DOM 插任何 mark**——`.extract-quote-hl` 的 DOM `<mark>` 实现退役，改绘制层（§C.5），卡面正文 DOM 回归"React 可描述"状态（ReactMarkdown 渲染），这同时解除了「ReactMarkdown 与 contentEditable 共管 DOM 导致 removeChild 崩溃」的旧约束在摘录卡上的存在。

### B.3 保存链（源文 markdown 字符串落库）

1. 编辑态**编辑过程中零写库**（每次落库即落盘；不新增 D34 式防抖例外）。
2. 提交时机＝**事件驱动**：失焦（点击卡外/别处）、Esc、点批注轨条目（先提交再开浮层）。提交即 `serialize(editor) → handlers.onEdit(text)`——**沿用既有 `readingWorkflow.updateContent` → `extracts:update` → `db.updateExtract` 链**（含 `persist()` 原子写与 `annotationRange.transformRanges` 区间重映射，§2.10），**零新写通道**。
3. 序列化结果与源文相同 → 直接退回读态，不发写请求（幂等短路）。
4. 提交后回读态；`workflow/changed` → `refresh()` 回流新内容与重映射后的区间（既有机制，改动零）。

### B.4 与两宿主的接线

- **ExtractReviewView（摘录页，P0 全量）**：读态 + 编辑态 + 点高亮浮层（§D.3）+ 字号桥（§F）。新增 `onAnnotClick` 形态的内部回调（或等价：卡面新增 handler `onHighlightClick(annotationId)`），复用组件既有 `setEditing` + `anchorForAnnotation`。
- **ReviewView 合并复习分支（P0 组件级 + P1 批注级）**：组件级能力（默认读态、WYSIWYG 编辑、字号同步）随 ExtractCardFace **自动获得**（`onEdit` 已在场）；**点高亮弹浮层该分支 P1 对齐**——理由：实测该分支无 `useSelectionActions` / `AnnotationEditor` / `bodyGroups` 任何接线（§2.4），补齐需把 ExtractReviewView 的批注编排面上提或复制，属独立最小单元，且合并复习的首要交互是评分不是批注（取舍见 §D.5）。

---

## C. 偏移锚定兼容方案（核心难点，单独成节）

### C.1 落库坐标不变式（最高技术约束）

**`quote_range_json`、`contextRef.parentRange`、面包屑 `viewRanges` 一律仍为 `content_markdown` 的源字符偏移。零数据迁移。零 schema 变更。** 写侧重映射（`electron/annotationRange.js` @ `db.updateExtract`，端点规则用户 2026-09-25 拍死）**一行不改**——编辑器序列化出什么字符串，就以它为新正文走既有重映射，WYSIWYG 的"语法规范化"（如列表符号统一）由重映射按编辑脚本自然吸收。

### C.2 问题陈述

读态/查看态从「纯文本 DOM（与源文逐字符同构）」换成「markdown 渲染 DOM」后，旧坐标系函数（`domTextOffset` / `rangeFromOffsets`，§2.1/§2.5）失效：源文里的 `**`、`#`、围栏、列表标记等语法字符不在渲染 DOM 里，块级结构也不产生 `<br>`。必须给出**源偏移 ↔ 渲染位置**的双向映射。

### C.3 双向映射算法（新纯函数模块 `src/lib/editor/markdownOffsetMap.ts`）

**输入**：`content_markdown` 字符串 + 读态渲染 DOM root（`.extract-face-body` 内的 ReactMarkdown 输出）。
**解析器**：`remark-parse ^11`（与 react-markdown 10 内部同版本、同构造选项——由直接依赖声明固定，§G）→ mdast，每个节点带 `position.start.offset / position.end.offset`（源字符偏移）。

**建表（一次构建，换卡/内容变化时重建）**：

1. `TreeWalker` 按文档序收集 root 内全部 **Text 节点**与 **`<br>` 元素**（跳过 KaTeX 输出子树 `.katex`，标记 unmappable）。
2. 按树序遍历 mdast 的**文本承载叶**：`text` / `inlineCode` 的 value、`break`（硬换行）。
3. **配对**：DOM Text 节点 ↔ mdast 文本叶（序一致；校验 `node.data === 叶.value`，不一致该段标记 unmappable 并降级，见 C.4）；DOM `<br>` ↔ mdast `break`（源占 1 字符 `\n`，DOM 0 字符）。
4. 产出段表 `segments: Array<{ sStart, sEnd, textNode, dLen }>`（源区间 ↔ DOM 文本节点）与 `brs` 表。

**两个方向**：

- **srcToDom(start, end) → Range**（高亮绘制、落点滚动、浮层锚点）：段表二分定位 + 段内对齐。
- **domToSrc(node, offset) → 源偏移**（划选取偏移、点击命中）：该 Text 节点的段记录内反查。

**段内 raw↔decoded 对齐**（关键细节）：mdast `text` 叶的 `value` 是**解码后**文本（反斜杠转义、字符引用已解），而 `position` 覆盖**原始**源区间——段内长度可能不等（源 `\*` 2 字符 → DOM `*` 1 字符）。对齐规则按 CommonMark 解码的两类构造**逐 run 扫描**原始切片：`\` + ASCII 标点（2→1）、`&…;` 字符引用（n→1），构造边界表后线性定位。纯确定性、无启发式。

**未覆盖缝隙的端点吸附**：源文中不属于任何文本叶的字符（围栏反引号、列表标记、`**`/`_`/`` ` `` 语法标点、行尾硬换行的前导双空格、标题 `#` 等）不在段表内。规则：**起点**落缝 → 吸附到所在缝隙之后的首段首；**终点**落缝 → 吸附到所在缝隙之前的首段尾。效果＝高亮恰好罩住"渲染出来的文字"（对 `**加粗**` 的旧区间 `[含星号]`，绘制成罩住「加粗」二字）。

**unmappable 段的降级**（KaTeX 输出、配对校验失败段、P0 阶段 rehype-raw 产出的原始 HTML 段）：绘制跳过该段；划选端点吸附到该段最近的已映射边界；点击命中按最近边界判。**绝不因局部不可映射丢弃整卡映射。**

**纯 node 可测**：`buildOffsetMap` / `srcToRange` / `domToSrc` 不依赖 Highlight API；DOM 侧用 jsdom（devDependencies 已有）构造。Range 生成在 node 可测（jsdom 支持 Range），`::highlight` 绘制效果由 GUI 套件在真 Chromium 断言。

### C.4 读态下既有偏移数据的高亮渲染——CSS Custom Highlight API 仍适用

**适用**。Highlight API 接受任意 `Range`（不要求 DOM 与数据同构），rangeFromOffsets 换成 `map.srcToRange` 即可；且它只画绘制层、不碰 DOM——与 ReactMarkdown 渲染的 DOM（React 全权 reconcile）兼容性反而**优于**旧方案（旧方案是因为 EditableText 裸壳才不得不用绘制层；新读态下绘制层依然是唯一正确手段：往 React 子树插 mark 会复活 removeChild 崩溃，§B.2）。不支持 Highlight API 的环境静默降级（既有行为，注释与代码已在 `paintBodyAnnotations` 实现）。

### C.5 `viewOnly` 的 `quoteRanges` 绘制迁移

`<mark class="extract-quote-hl">` 退役 → `paintQuoteRanges(root, ranges, map)`（`bodyAnnotations.ts` 增补）：注册名 `extract-quote-hl`，规则 `::highlight(extract-quote-hl){background-color:var(--hl-multi)}`（与退役类同色，§2.7）；`theme.css` L5653 类规则随零消费者删除。落点滚动改映射 Range 矩形。

### C.6 划选 → 源偏移的换算

- `ExtractCardFace` 增 `selectionOffsetsViaMap(root, map)`：与旧 `selectionOffsetsInBody` 同形返回 `Array<{start,end}>`（多段、排序、越界过滤语义不变），内部用 `map.domToSrc`。
- `onSelection` 载荷形状（`{rect, ranges, text}`）**不变** → ExtractReviewView 的 `handleFaceSelection` 集合运算（D78 replace/append/remove、D79 手势全程修饰键、`lastRawRef` 幂等守卫）**零改动**。
- 多段选区的**可见高亮**由 `multiHighlight` 直接画原生 Selection Range（§2.11）——读态渲染 DOM 下天然成立，**零改动**。
- 载荷 `text` 仍按 `content_markdown.slice(start,end)` 切（与落库文本逐字符对齐，既有纪律），双击选词/跨语法标点选择时切出的文本可能含语法字符——与现状（纯文本模式下同样切源文）语义一致，不另立文本桥。

### C.7 点击命中高亮区间的判定

读态 click → `map.domToSrc(caret)` → 对 `bodyGroups`（本设计增 `id` 字段，§C.8）逐组逐段 containment 判定（多段取第一个命中组）→ 命中＝该段锚批注，走浮层（§D.3）；未命中＝编辑入口（§D.2）。`quoteRanges`（viewOnly）P0 不接浮层（§D.4）。

### C.8 数据形状的最小增补

`BodyAnnotationGroup` 增可选 `id?: string`（ExtractReviewView 组装 `bodyGroups` 时带上 `r.id`，L293-297 一行改动）——点高亮 → `id` → `setEditing` / `anchorForAnnotation` 都已有同 id 数据路径（`rangesByIdRef`）。**纯增字段，零迁移。**

---

## D. 读/写模式状态机与点击路由

### D.1 状态机（每卡一份，随 `extract.id` 重置）

```
        ┌──────────────────────────── 换卡/挂载 ────────────────────────────┐
        │                                                                   ▼
   ┌─────────┐   点非高亮区（click，选区塌缩且不在高亮上）   ┌─────────┐
   │  READ   │ ─────────────────────────────────────────▶ │  EDIT   │
   │（默认）  │ ◀───────────────────────────────────────── │         │
   └─────────┘   Esc / 失焦（点卡外）/ 点轨条目先提交      └─────────┘
        │  ▲                                                  │ ▲
        │  └── 点高亮区 → AnnotationEditor 浮层（保持 READ）────┘ │（编辑态不可达：高亮不绘制）
        └─────── 划选（mouseup 非塌缩）→ 保持 READ，采集载荷 ──────┘（编辑态内划选＝编辑器内原生选择）
```

- `viewOnly`（查看态）恒为 READ，无 EDIT 出口（§D.4）。
- 编辑态内**不绘制**任何批注高亮（内容在变、区间映射失效，重映射在提交时由 db 完成）——编辑态没有可点的高亮，浮层入口在编辑态自然关闭。

### D.2 点非高亮 → 进入编辑（焦点落点规则）

- 判定链（READ 态 click，目标在 `.extract-face-body` 内）：① mouseup 时选区塌缩（真点击，非划选收尾）；② C.7 命中判定未命中。两者同时成立 → 切 EDIT。
- **焦点落点（P0）**：块级近似——用映射表把点击源偏移定位到**块索引**（段表所在块的序号），编辑器就绪后在 ProseMirror doc 同序块起始处放 `TextSelection`；映射不可用（点击在 unmappable 段）→ 光标落文档开头。**P1 升级**：块内字符级落点（块内 decoded 偏移 → 遍历块内 inline 节点累积 textLength 定位）。
- meta 行（`.extract-face-derived`）、底栏、头带工具栏不在 `.extract-face-body` 内，点击不触发编辑入口（既有豁免清单 L280-283 语义保留并复用）。
- 双击选词：第一次 click 先进 EDIT（选区塌缩）、第二次 click 在编辑器内形成原生双击选词——行为可接受（Typora/Notion 同类形态），不做双击豁免特判；GUI 用例以单击+显式断言锁定。

### D.3 点高亮 → AnnotationEditor 浮层（对齐阅读界面交互）

- READ 态点击命中段锚批注（§C.7）→ `setEditing({ id, kind, comment, color, quote, anchor })`——**与批注轨 `onJump` 完全同一浮层、同一落库链**（`saveAnnotationComment` / `saveAnnotationColor` / `removeAnnotation`，全部是 `useSelectionActions` 现有导出，**不改该文件**）。
- 锚点复用 `anchorForAnnotation(id, body)`（既有，L311-319），内部 `rectFromOffsets` 换 `rectFromMappedOffsets(map, …)`（有 map 用映射，无 map 回落旧函数——兼容 ReviewView 等未迁移宿主）。
- 浮层挂载位置不变（页面级，容器＝页面矩形，L982-1005）。
- 对齐目标确认：阅读器是 `markClick → setMarkEditor → AnnotationEditor`（§2.6）；本设计把摘录卡读态的「点高亮」接到**同一个** AnnotationEditor，浮层在全应用保持唯一形态（D85 原则）。

### D.4 划选不进编辑 + viewOnly 边界

- 划选（mouseup 非塌缩）→ 保持 READ，既有采集链走 `onSelection`（选区菜单/五动作/批注挂色全不变）。
- **viewOnly（面包屑查看态）P0 不开浮层**：`quoteRanges` 高亮照画（§C.5），点击不弹浮层。理由：查看态的浮层入口语义（编辑谁的批注）涉及 viewRanges/自身区间的 id 归属判定，而批注轨在该态已可用（onJump 已覆盖同一需求）；避免把「点高亮高亮谁」的第二套判定混进 P0。**P1 登记**（§G 分期）。

### D.5 Esc / 失焦 / 点浮层的去留规则

| 场景 | 行为 |
| --- | --- |
| EDIT 态按 Esc | 提交并退回 READ（与 EditableText 现行 Esc=blur=提交语义一致） |
| EDIT 态点卡外（非卡面动作面） | blur → 提交 → READ。动作面豁免清单（选区菜单/模态/dict/ai 面板/extract 工具栏，L280-283）不触发 blur 提交——其中选区菜单在编辑态不存在，模态类（制卡坞）点击**先提交**再开面板 |
| EDIT 态点批注轨条目 | 先提交（若内容有变）→ `onJump` → 浮层（READ） |
| EDIT 态点工具栏（§E） | `preventDefault` 于 mousedown（不 blur），命令直接作用编辑器，保持 EDIT |
| READ 态 Esc | 既有语义不变（清面包屑弹层/多段选区） |
| 快捷键 Space/Enter/Z（推进/撤销） | 编辑态内目标为 contentEditable，既有守卫（`t?.isContentEditable`，L520）自然放行编辑器内输入——**零改动**；READ 态行为与现状一致 |
| 换卡/推进到下一条 | 编辑态若有未提交变更 → 先提交（不丢字），再随卡切换（状态机随 `extract.id` 重置为 READ） |

### D.6 ReviewView 合并复习分支的取舍（明确）

- **P0**：随组件获得默认读态 + WYSIWYG 编辑 + 字号同步（`onEdit` 已接线，§B.4）。读态下该分支无批注数据（不传 `bodyAnnotations`），无高亮可点，交互自洽。
- **P1**：点高亮浮层对齐（需为该分支接 `bodyGroups`/`AnnotationEditor`/`selActions` 编排面，或把这套编排上提为共享 hook——第二阶段按最小单元实施，验收标准届时以 P1 设计增补为准）。
- 理由：该分支的编排缺失是**既有现状**（非本任务回归）；本批先把「点高亮弹浮层」在主战场（摘录页）做对，ReviewView 对齐作为独立最小单元排队，符合"一次只实现一个最小单元"（§7.1）。

### D.7 文案与提示

- 头带提示（`data-page-hint`，L904）：「空格＝下一条 · Z＝撤销 · 正文可直接编辑」→「空格＝下一条 · Z＝撤销 · 点正文编辑 · 点高亮批注」（既有测试如断言该文案随改，§G.3）。

---

## E. 富文本工具栏

- **位置**：编辑器**下方**（用户原话），`.extract-face-body`（编辑态）之后、meta 行之前的一行；仅 EDIT 态渲染。
- **按钮集**（依 Milkdown preset 能力定，全部走 `commandsCtx` 官方命令通道，不自改 DOM）：
  - 行内：**加粗 / 斜体 / 删除线（gfm）/ 行内代码 / 链接 / 行内公式（math）**
  - 块级：**标题（H1-H3 循环）/ 引用 / 无序列表 / 有序列表 / 任务列表（gfm）/ 代码块 / 分隔线 / 公式块（math）**
  - 历史：**撤销 / 重做**（editor history，与全局 Z 语义在编辑态内让位于编辑器内部栈）
- **设置键**：`app.extractEditorToolbar`（bool，**默认 true**）。关闭后整行不渲染（编辑功能本身不受影响——markdown 语法输入与快捷键仍在）。写侧归一（`electron/main.js` settings:set）：`value = value === true`（仅严格 true 为真，仿 `normalizeAnnotateCustomEnabled` 先例）。
- **SettingsPanel 归属**：`sec-reader`（阅读区）新行「摘录卡编辑工具栏」checkbox（该区已有字号滑杆/字体输入/布尔开关先例，§2.8）。
- **样式**：瑞士风——24px 档文字/文字+符号钮、hairline 分组、无阴影直角、单 accent 焦点色；不新造视觉语言（对齐 `.seg-rail`/`.btn-rail` 同族）。
- **data-testid 钩子**：容器 `data-testid="extract-editor-toolbar"`；按钮 `data-tb="bold|italic|strike|code|link|inlineMath|h|quote|ul|ol|task|codeBlock|hr|mathBlock|undo|redo"`；设置行 `data-testid="setting-extract-editor-toolbar"`。

---

## F. 字号/字体方案

### F.1 同步取值链

```
app.readerSettings.appearance（fontSize/fontFamily/lineHeight）
        │  settings/changed 事件（settingsStore.set 已广播）
        ▼
useExtractFaceTypography()（src/lib/extractCardSettings.ts，订阅 hook）
        │  读侧归一（仿 annotationSettings.ts 先例；reader 侧经 resolveAppearance 同一套钳制）
        ▼
document.body.style 写根级 CSS 变量（运行时注入，applyAccent 先例；D50 求值层纪律：
变量由本模块独占写入、不与主题块冲突，写在 body 上与既有运行时覆盖先例一致）
   --extract-face-fs   （px 字号）
   --extract-face-font （字体栈）
   --extract-face-lh   （行高）
        ▼
theme.css 消费：.extract-face-body { font-size: var(--extract-face-fs, var(--fs-body));
                 line-height: var(--extract-face-lh, 1.7);
                 font-family: var(--extract-face-font, inherit); }
```

- `:root` 给三变量静态默认档（`17px` / `inherit` / `1.7`），保证变量未注入时卡面有合法基线（IACVT 纪律：`var()` 带回退值，双保险）。
- **删除 26px 覆盖**：`theme.css` L5711 `.extract-page .extract-face-body { font-size: var(--fs-title-l); line-height: 1.5 }` 整条删除——"摘录卡片不用这么大"的直接修复；字号从此与阅读界面文字同源。
- 桥的挂载点＝`ExtractCardFace`（两宿主共用该组件，桥随组件挂/卸，卸载时移除三个内联变量还原基线）；`app.readerSettings` 与本批新键任一变更（`settings/changed`）即时重算——阅读器里调字号、摘录卡实时跟。

### F.2 自定义设置键（推荐方案：默认跟随 + 可独立覆盖，无总开关）

| 键 | 取值 | 默认 | 语义 |
| --- | --- | --- | --- |
| `app.extractFaceFontFollow` | bool | `true` | true＝字号/字体/行高全部跟随 `app.readerSettings.appearance`；false＝以下两键生效（行高恒跟随，不单列） |
| `app.extractFaceFontSize` | int 10–40 | `17` | follow=false 时的卡面字号（钳制同 `resolveAppearance`） |
| `app.extractFaceFontFamily` | string | `""` | follow=false 时的卡面字体；`""`＝应用默认 UI 字体栈 |

- 推荐"默认跟随"而非默认独立值：用户原话的主诉求是「和阅读界面的文字同步」，自定义是追加能力；单键 follow + 两键覆盖表达力足够，避免第三个"跟随"控件的冗余状态。
- **SettingsPanel 控件**（sec-reader，紧邻字号滑杆新组「摘录卡字号」）：checkbox「跟随阅读界面字号/字体」（`data-testid="setting-extract-font-follow"`）；取消勾选后展开：字号滑杆（10–40，同 `a.fontSize` 滑杆样式）+ 字体文本输入（placeholder「留空使用应用默认字体」）。
- 归一：写侧 `extractFaceFontFollow`＝仅严格 true；`extractFaceFontSize`＝`Math.round(Number)` 落 10–40 区间否则回落 17；`extractFaceFontFamily`＝trim 字符串。读侧同规则（`extractCardSettings.ts`）。

### F.3 theme.css 改动区域与 D92 的隔离说明

见 §H.3（对照表）：本批 theme.css 触点为 `.extract-face-body` 规则段（L5707/L5711）+ `.extract-quote-hl`（L5653）+ 新增 `.extract-face-toolbar` 与编辑器作用域段（新段追加）；D92 的 theme.css 触点为 `.dock-tabs`/收起把手（右栏坞段，现有 `.side-dock` 区域 L2429-2447 附近扩展）。**两片区域互不重叠，git 可自动合并。**

---

## G. 施工清单 / 机械验收清单 / 分期

### G.1 施工清单（文件 × 改动性质）

| # | 文件 | 改动性质 | 内容 |
| --- | --- | --- | --- |
| 1 | `src/lib/editor/markdownOffsetMap.ts` | **新文件** | §C.3 双向映射纯函数（remark-parse ^11 + unified ^11） |
| 2 | `src/lib/editor/markdownOffsetMap.test.cjs`（或并入 tests/） | **新文件** | §G.2 验收 1 金样例 |
| 3 | `src/components/editor/ExtractEditor.tsx` | **新文件** | Milkdown 编辑器封装（@milkdown/kit + @milkdown/react；commonmark+gfm+math+history+listener preset；defaultValue/serialize；块级焦点落点接口）+ §E 工具栏 |
| 4 | `src/lib/extractCardSettings.ts` | **新文件** | §E/§F 四新键读侧归一 + `useExtractFaceTypography` 桥 + 工具栏开关订阅 |
| 5 | `src/components/ExtractCardFace.tsx` | 改造 | 三分支重组（§B.1）；EditableText 停用；选区换 map（§C.6）；点击路由（§D）；typography 桥挂载；`textWithRanges`/`domTextOffset`/`selectionOffsetsInBody` 旧实现随消费者清零后移除 |
| 6 | `src/components/ExtractReviewView.tsx` | 改造 | bodyGroups 带 id（§C.8）；点高亮→setEditing 接线（§D.3）；hint 文案（§D.7）；anchorForAnnotation 走 map（§C.4）；**不碰 D92 施工点（工具栏 disabled L889 / data-dock-open L813）** |
| 7 | `src/lib/reader/bodyAnnotations.ts` | 增补 | `BodyAnnotationGroup.id?`；`paintBodyAnnotations` 增可选 map 参（旧路径保留）；`rangeFromMappedOffsets`/`rectFromMappedOffsets`/`paintQuoteRanges` |
| 8 | `src/components/SettingsPanel.tsx` | 增补 | sec-reader：工具栏开关 + 字号跟随组（§E/§F） |
| 9 | `src/theme.css` | 改造+新增 | 删 L5711 26px 覆盖；`.extract-face-body` 改三变量消费；删 `.extract-quote-hl` 类（L5653）+ 增 `::highlight(extract-quote-hl)` 规则；新增 `.extract-face-toolbar` 段 + `.extract-face-body` markdown 元素/`.ProseMirror` 作用域段（`@media (prefers-reduced-motion)` 纪律适用处遵守） |
| 10 | `electron/main.js` | 增补 | settings:set 写侧归一 4 新键（L192-198 区段追加；**D91/D92 均不触碰 main.js，无冲突**） |
| 11 | `package.json` | 依赖 | 新增 `@milkdown/kit ^7.22.2`、`@milkdown/react ^7.22.2`、`remark-gfm ^4.0.1`、`rehype-raw ^7.0.0`、`rehype-sanitize ^6.0.0`；直接声明 `remark-parse ^11.0.0`、`unified ^11.0.5`（既有传递依赖提直） |
| 12 | `tests/extract.gui.mjs` / `tests/annotations.gui.mjs` / `tests/breadcrumb.gui.mjs` / `tests/multiselect.gui.mjs` | 改造 | §G.3 受影响清单 |
| 13 | `tests/flows/f18-settings-matrix.cjs` | 增补 | `DOC_KEYS` 增 4 新键 + round-trip/非法值矩阵用例 |
| 14 | `AI_DEVELOPMENT_GUIDE.md` | 文档 | §I 登记计划（实现期执行） |

**不动的**：`useSelectionActions.ts`（D92 施工面，禁改）；`Reader.tsx`（D92 施工面，本任务零改动）；`electron/db.js` / `electron/annotationRange.js`（重映射链零改动）；DB schema；`ManualCardEditor` / `AIPanel` / 日记编辑器（范围外）；`EditableText.tsx`（保留给闪卡面）。

### G.2 机械验收清单（全部可自动断言）

**node 单测（`@runtime node`）**

1. **映射金样例（往返保真 + 映射正确性）**：代表性语料集（纯段落 / 标题层级 / 加粗斜体行内代码 / 软硬换行 / 有序无序任务列表 / 表格 / 引用 / 围栏与缩进代码块 / 行内与块级公式 / 转义与字符引用 / 行内原始 HTML）——对每例 jsdom 渲染（react-markdown 或等价 hast 渲染）后断言：① `serialize(parse(md))` **文本内容**与源一致（去语法符号比对）；② 已知区间 `srcToRange` 的 `Range.toString()` ＝ 源区间解码文本；③ `domToSrc(srcToRange(s,e))` 端点回写一致；④ 缝隙吸附用例（`**bold**` 整段区间 → 绘制文本＝"bold"）。
2. **写侧重映射零改动证明**：`tests/annotation-range.test.cjs`（25 项）与 `tests/annotation-db.test.cjs`（15 项）全绿（不改它们）；`tests/extracts.test.cjs` 137 项零回归。
3. **设置归一单测**：4 新键写侧归一（非法值矩阵：`extractEditorToolbar` 非 true→false；`extractFaceFontSize` 越界→17；字符串家族 trim；follow 非 true→false）。

**GUI 套件（`@runtime electron`，跑前 `npm run build`）**

4. **默认读态**：进摘录页，`.extract-face .review-editable` **不存在**；`.extract-face-body` 内出现渲染元素（如 `p`/`h2`）；contentEditable 元素不在卡面正文。
5. **点非高亮进编辑**：真键鼠单击正文非高亮处 → 出现 `.ProseMirror[contenteditable=true]`（编辑态）；`data-testid="extract-editor-toolbar"` 在场。
6. **划选不进编辑**：拖选一段 → 选区菜单出现、编辑器**未**出现；点色落库区间与所选一致（既有五动作回归）。
7. **点高亮出浮层**：构造带 `quoteRangeJson` 子批注 → 读态点该高亮 → `AnnotationEditor` 浮层在场；改批注文字 → 库变且显示同步；改色 → `annotation_color` 变；删除 → -1（对齐 annotations.gui 既有判据组 ③）。
8. **WYSIWYG 行为**：编辑态输入 `# 标题` 回车 → 编辑器内出现标题渲染；输入 `**粗**` → 粗体呈现；退出编辑 → 读态渲染一致；**落库的是 markdown 源文**（DB 断言 `content_markdown` 含 `# `/`**`）。
9. **往返不毁源**：对含表格+公式+代码块的既有摘录进入编辑态并退出（无修改）→ `content_markdown` 逐字节不变（幂等短路）。
10. **工具栏开关**：设置页关 `extract-editor-toolbar` → 重进编辑态工具栏不渲染；重开 → 恢复；设置值落 `settings.json` 重启不丢。
11. **字号同步**：设置阅读字号 17→22 → 摘录卡 `.extract-face-body` computed font-size 同步为 22px；关闭跟随、设 14 → computed 14px；**26px 覆盖已死**（`.extract-page .extract-face-body` 无独立字号规则，computed 恒等于桥值）。
12. **viewOnly**：面包屑点开某层 → 只读渲染 + `::highlight(extract-quote-hl)` 注册且矩形覆盖所引文字（`CSS.highlights.get` 在场 + Range 几何断言，替代旧 `.extract-quote-hl` DOM 断言）。
13. **ReviewView 合并回归**：合并复习分支卡面默认读态、可进编辑并落库（extract.gui 既有合并分支断言迁移）；评分/翻卡全绿。
14. **多段选择回归**：`tests/multiselect.gui.mjs` 全绿（选择器按 §G.3 迁移后）。
15. **受影响既有测试改法清单**：
    - `tests/extract.gui.mjs` L94「正文可编辑（EditableText 裸壳在位）」→ 改断言「默认读态 + 点击进编辑」（验收 4/5 的路径）；L96-100 直改 innerText 落库 → 改「进编辑态 → 通过 editor API/键入改文 → Esc 提交 → 落库断言」；L126-129 选择器 `.extract-face-text || .review-editable` → 读态取渲染正文 textContent。
    - `tests/annotations.gui.mjs` L407 拖选源 `.extract-face .review-editable` → 改为读态 `.extract-face-body`（拖选语义不变）。
    - `tests/breadcrumb.gui.mjs` L135/L229/L476 `.extract-face-body .extract-quote-hl` DOM 断言 → 改 Highlight API 注册与几何断言（同验收 12）。
    - 提示文案断言（如有引用「正文可直接编辑」）→ 随 §D.7 新文案。
16. **闸门**：`f11`（文档-代码漂移）/ `f18`（DOC_KEYS 含 4 新键，round-trip + 非法值矩阵）/ `f20` / `f21` / `f24` 全绿；`npm run build` 零错误；tsc 零错误。

### G.3 分期

- **P0（本稿 §A–§F 全部）**：选型引入（Milkdown）、三分支重组、映射纯函数 + 金样例、默认读态 + 点击路由 + 浮层接线、工具栏 + 开关键、字号桥 + 26px 删除 + 自定义键、viewOnly 绘制迁移、受影响测试迁移、f18/GUIDE 登记。
- **P1**：块内字符级焦点落点（§D.2）；viewOnly 点高亮浮层（§D.4）；ReviewView 合并分支批注编排对齐（§D.5）；rehype-raw 段内映射精化（§C.3 unmappable → 段内对齐）；`--extract-face-lh` 若用户反馈需要独立于阅读器行高的自定义键再议。

---

## H. 与 D91/D92 的接口与冲突面说明

> D91 施工文件：`electron/prompts.js`、`electron/db.js`（播种块）、`src/lib/cards.ts`、`AIPanel.tsx`、`src/lib/explainRouter.ts`、`src/lib/steProfiles.ts`、`electron/ste-profiles/`。
> D92 施工文件：`CardDock.tsx`、`SelectionPanels.tsx`、`useSelectionActions.ts`、`Reader.tsx`（工具栏与让位区）、`ExtractReviewView.tsx`（工具栏制卡钮与让位区）、`theme.css`（`.dock-tabs` 等新段）。

### H.1 本任务触碰的共享文件与隔离证明

| 共享文件 | D92 改动区域（实测行号） | 本任务（D93）改动区域 | 是否重叠 | 合并判定 |
| --- | --- | --- | --- | --- |
| `ExtractReviewView.tsx` | ①L889「制卡」钮去 `disabled`；②L813 `data-dock-open` 派生改挂 `dockOpen` | ①`bodyGroups` 组装段 L293-297（增 id）；②`anchorForAnnotation` L311-319；③`onJump`/`setEditing` 段 L847-859；④`faceHandlers` L767-802；⑤hint L904；⑥（可能的）AnnotationEditor 容器段 L982-1005 | **否**（D92 两点分别在工具栏行与页面根 data 属性行，D93 各触点与之相隔 ≥60 行且不改动同一行） | git 自动合并 |
| `theme.css` | `.dock-tabs` 页签变体、收起把手、手动暂态 active 指示（右栏坞段：现有 `.side-dock` L2429-2447 附近 + 追加新段） | ①删 L5711（26px 覆盖）；②改 L5707（三变量消费）；③删 L5653（`.extract-quote-hl`）+ 同区增 `::highlight` 规则；④文件末追加 `.extract-face-toolbar` + `.ProseMirror` 作用域新段 | **否**（D92 在右栏坞区域，D93 在摘录卡区域与文件尾） | git 自动合并 |
| `electron/main.js` | 无改动 | settings:set 写侧 L192-198 区段追加 4 行归一 | —（D91/D92 均不触碰） | 独占 |
| `package.json` | 无改动（两稿施工清单均无依赖项） | dependencies 增 7 行 | — | 独占 |
| `Reader.tsx` / `useSelectionActions.ts` | D92 施工面 | **本任务零改动**（仅调用现有导出） | — | 零接触 |

### H.2 与 D91 的接口

无直接接口。D91 全部改动面（STE 解读管线）与本任务（编辑器/卡面/设置）零交集；唯一共同文件类型 `electron/db.js` 中 D91 只加 `ensurePromptTemplates` 播种块（L2025-2037 范式）、本任务**不改 db.js**。

### H.3 合并顺序注记

三分支均需 bump GUIDE 版本行与 §8.1——用户已确认按合并顺序机械重排、接受该冲突（已确认决策 ⑥，§I.1）。

---

## I. GUIDE 登记计划（实现期执行，本设计稿不执行）

1. **版本行**：实现 PR 内 bump `AI_DEVELOPMENT_GUIDE.md` 标题版本 v48.50 → **v48.51**；与 D91/D92 并行分支合并时按合并顺序重排版本号与 §8.1 条目序（机械手工解，用户已接受）。
2. **§8.1 D93 条目草案**（表格行，并入时按序排）：

   > | D93 | **摘录卡 WYSIWYG 编辑器与默认读态（设计文档 `docs/design/EDITOR-EXTRACT-CARD-D93.md`）**：①编辑器选型 Milkdown 7（`@milkdown/kit`/`@milkdown/react` ^7.22.2，MIT，remark 同族解析，往返保真金样例锁定；备选判据＝Vditor 4 IR）；②摘录卡默认**读态**（ReactMarkdown + remark-gfm + rehype-raw/sanitize 渲染），点非高亮进编辑（WYSIWYG）、划选不进编辑、点高亮弹 AnnotationEditor 浮层（对齐阅读器 markClick，唯一浮层原则）；③**偏移不变式**——`quote_range_json`/`parentRange`/`viewRanges` 仍为 `content_markdown` 源字符偏移，零迁移，写侧重映射零改动，新增源↔渲染 DOM 双向映射纯函数（remark-parse position + 段内 raw↔decoded 对齐 + 缝隙吸附）；④编辑器下方富文本工具栏（`app.extractEditorToolbar` 默认开可关）；⑤摘录卡字号/字体/行高与阅读器外观同步（根级 CSS 变量桥，删 26px 覆盖），可独立自定义（`app.extractFaceFontFollow/FontSize/FontFamily`）；⑥EditableText 摘录卡退场（组件保留给闪卡面，D10 不推翻） | 用户 2026-10-04 两轮书面指令（逐字见设计稿 §0） | v48.51 |

3. **§7.4 设置键登记**：4 新键按既有条目格式补全（含 f18 DOC_KEYS 同步义务与写侧/读侧双侧归一说明）。
4. **§6.8 增补**：新小节「摘录卡编辑器与默认读态（D93）」挂 §6.8-12 之后，收窄 EditableText 裸壳契约表述至闪卡面。
5. **闸门回归**：`f11` / `f18` / `f20` / `f21` / `f24` 在实现 PR 内全绿。

---

## 开放问题（需拍板后进 P0/P1）

> **拍板记录（2026-10-04，总控裁定；五项均按本稿已写明的推荐项/默认项执行，用户事后可推翻并触发对应 P1 项）**：
> ① 原始 HTML 渲染＝**P0 引入** rehype-raw+rehype-sanitize（本稿按此编制，维持现状不改）。
> ② 焦点落点＝**P0 块级、P1 字符级**（按 §D.2 推荐）。
> ③ 子摘录 parentRange＝**维持既有边界，P1 登记**（按开放问题默认项；P0 零 db.js 改动，守住 §H 隔离证明）。
> ④ 中文 IME＝**接受「默认读态兜底 + §A.4 换备选判据」风险姿态继续**；总控运行环境无法执行真人 IME 手测，改为交付时向用户登记「编辑态中文输入 1 分钟冒烟验证」为用户验收步骤；自动化侧由第二阶段在 GUI 套件能力范围内尽力覆盖组合事件（无法真实模拟则如实注明局限）。
> ⑤ 工具栏＝**16 钮一次到位**（按 §E 推荐）。

1. **原始 HTML 渲染档位**（§C.3/C.4）：P0 即引入 `rehype-raw ^7` + `rehype-sanitize ^6` 渲染卡内原始 HTML（推荐——避免"渲染后内容静默消失"的内容丢失），还是 P0 先跳过原始 HTML（读态不渲染、映射标 unmappable）、P1 再补？本稿按 P0 引入编制；若拍板推迟，删 2 个依赖、开放问题顺延。**〔已拍板：P0 引入〕**
2. **焦点落点档位**（§D.2）：P0 块级落点 + P1 字符级落点（推荐），还是 P0 直接做字符级（映射表已具备数据，但需在 ProseMirror doc 内做 inline 累积定位，工作量 +0.5 天量级）？**〔已拍板：P0 块级〕**
3. **子摘录 parentRange 不随父卡编辑重映射**（§2.10 既有边界）：WYSIWYG 的语法规范化会让父卡编辑更频繁地移动偏移，子卡高亮漂移的概率上升——是否在本批顺带把「`db.updateExtract` 内容变更时对 `parent_id` 挂本条的子摘录 `contextRef.parentRange` 做同一脚本重映射」纳入 P0？（改 db.js 写入口一处；超出本稿施工清单，需拍板后补验收用例；**不拍板则维持既有边界并在 P1 登记**。）**〔已拍板：维持既有边界，P1 登记〕**
4. **Milkdown CJK IME 上游缺陷**（§A.2）：接受「默认读态兜底 + §A.4 判据换备选」的风险姿态继续，还是要求第二阶段开工前先做一次中文输入法实测冒烟（30 分钟，GUI 手测）再开工？推荐后者（成本极低）。**〔已拍板：风险姿态继续 + 用户侧冒烟验证登记（运行环境限制，见上方拍板记录④）〕**
5. **工具栏按钮集裁剪**（§E）：本稿 16 钮是否一次到位，还是 P0 先交付 10 钮（行内五 + 标题 + 引用 + 列表三 + 撤销）？推荐一次到位（命令通道同一，增量仅为按钮行）。**〔已拍板：16 钮一次到位〕**

---

## 修订记录

### v1.1（2026-10-04，总控拍板）

- 五项开放问题全部按本稿推荐项/默认项拍板（见「开放问题」节首部拍板记录）：①原始 HTML P0 引入；②焦点落点 P0 块级；③parentRange 维持既有边界（P0 零 db.js 改动）；④IME 采风险姿态 + 用户侧冒烟验证登记；⑤工具栏 16 钮一次到位。§G 施工清单与验收清单不变。

### v1（2026-10-04）

- 初稿：§0 用户原话留痕；§A 五候选选型调研（npm registry 2026-10-04 实测版本/许可/体积；Milkdown 7 推荐，Vditor 4 IR 为备选判据）；§B 三分支重组与保存链；§C 源偏移↔渲染位置双向映射（不变式：零迁移、重映射零改动）；§D 读/写状态机与点击路由；§E 工具栏；§F 字号桥与 26px 删除；§G 施工清单（14 项）+ 机械验收（16 项）+ P0/P1；§H 与 D91/D92 区域隔离对照；§I GUIDE 登记计划（v48.51 + D93 条目草案）；开放问题 5 项。
