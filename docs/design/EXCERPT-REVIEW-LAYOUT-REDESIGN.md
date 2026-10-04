# 摘录页 / 复习页 布局与视觉重设计（EXCERPT-REVIEW-LAYOUT-REDESIGN）

> 日期：2026-10-01 · 作者：ui-ux-architect · 状态：v11 修订稿（v2–v10 已实现；v11＝摘录页卡面接入 Ctrl 多段选择 2026-10-03）
> 范围：纯前端布局/视觉。不动调度语义、数据模型、IPC、表结构、设置键；不动 FSRS 与 review_logs 真源。
> 截图说明：摘录页两张截图（侧边栏收起/展开）被图像过滤器拦截，**未能核对**；本文对摘录页的现状结论全部来自源码机制分析（已给出文件+行号），复习页两张截图已核对并与源码机制互证。
>
> **修订记录（v2，2026-10-01）**：v1 骨架（页面 `overflow:hidden` + 内层 `.stage-scroll` 滚动）与 `tests/breadcrumb.gui.mjs` L240-254 三条断言机械冲突（`.extract-page` 必须自身可滚、`extract-page-head` 必须 computed sticky + 不透明底 + 首 token 命中、高亮以 page rect 居中）。裁决＝**方向 1**：修订骨架为「页面根本身保持真滚动容器（`overflow-y:auto`），底栏是滚动内容的**最后一个流内子节点**、`position:sticky; bottom:0` 钉底」。机制说明：overflow:hidden 元素虽可被程序化赋 scrollTop，但视觉不滚动、且与内层滚动形成双滚动，不可接受；sticky 底栏在滚动中钉在滚动口底缘、滚到底时自然落在内容末尾（不被裁、不裁内容），短内容由中间 flex-grow 子节点把栏顶到底——**底栏"流内化"的核心前提完整保留**，只是钉底手段从 fixed/负偏移 sticky 换成零偏移 sticky。两页用同一配方 ⇒ 几何构造性一致。面包屑测试三条断言因此**零改动通过**：滚动器仍是 `.extract-page`、头带仍 sticky + `--paper` 不透明底 + className 首 token 仍为 `extract-page-head`、`scrollIntoView({block:"center"})` 仍在同一 scrollport 居中。§3/§8/§9 已按此重写。
>
> **修订记录（v3，2026-10-02 / D70）**：底栏高度 56px → **72px**。用户实测两页共同缺陷（原话：「底部按钮的下沿距离整体窗口的下沿太近，应该与底部按钮最左侧距离整体窗口左侧的边缘的距离相等才对」）：56px 栏内 40px 控件垂直居中 ⇒ 按钮下缘距窗底仅 8px，而按钮左缘距窗左为 16px（`padding: 0 var(--sp-4)`），上下与左右留白不等。修法＝控件 40px 不变，栏高 72px（=8×9，仍在 8px 基线网格），`align-items:center` 给出上下各 16px，与左右 16px **构造性对称**。§3.1/§3.2/§8.1 已同步；「两页共用一条 `.stage-bar`」的契约不变。
>
> **修订记录（v4，2026-10-02 / D71）**：带缘 hairline **默认隐藏**（新 Token `--band-line: transparent`，登记为 §5.5 皮肤扩展点）。用户实测两页共同现象（原话：「底部按钮上方和顶部的『5 条待处理』『未学习 0 学习中 13 待复习 36』这些说明文字的下方有一条细线，在当前的默认皮肤下请隐藏这两条线」）：钉底栏上缘（`.stage-bar` border-top）与吸顶头带下缘（`.extract-page-head`/`.review-head` border-bottom）各有一条 1px hairline。修法＝两条 border 的**色值**改取 `var(--band-line)`，基线 `transparent`（几何不动：border 仍占 1px），皮肤层赋实色即显形（同 `--field-line` 先例，D63）；显形值须声明在 `body` 上（§5.5 深色档纪律）。§3.1/§3.2/§3.4/§8.1 已同步。
>
> **修订记录（v5，2026-10-02 / D72）**：摘录页版心对齐与批注轨重设计。用户 2026-10-02 五项指令（逐字）：①「无论是侧边栏展开还是收起的状态下，『原文›…』的面包屑都应该是与下面的摘录正文左对齐的。『5 条待处理』这个信息应该与面包屑在同一行，并与摘录正文右对齐」②「侧边栏应该是贯通到整个摘录页面的顶部」③「侧边栏左侧有异常的大片空白」④「展开收起侧边栏的按钮应该在整个摘录页面的左上角，并且请重新设计这个按钮，使其风格与底栏按钮同一并左对齐。侧边栏展开收起要有简洁优雅的滑动动画」⑤「滑动底部栏的优先级滑块时，整个摘录页面会不停闪烁」。**实测根因**（1100×750 / dpr2.5）：头带内列是收缩适应 flex 项（宽 248）在全宽带里居中（l=566）而卡面列 l=344——`data-annot-open` 的 344px 补偿按「内列=720」设计，对收缩内列无效；计数行被 `flex:1 1 100%` 挤到第二行；轨 t=119 从头带下缘才开始；轨左缘 l=64＝页面根 padding；开关钮 24×24 在 (76,115)。**修法**（§3.1/§3.4/§3.5/§4/§8.1 重写）：页面改为「全高批注轨（贴窗左缘 x=0、上至页面顶）+ 右主列（`.extract-main`，头带内嵌其中）」两列骨架——头带内列与卡面**同盒**（width:100% + max-width:720 + margin:auto）⇒ 面包屑左缘＝卡面左缘、计数右缘＝卡面右缘**构造性成立**（两态皆然，头带补偿规则删除）；计数与面包屑同一行（crumbs `flex:1` + 计数最右）；开关钮重设计为 `.bar-btn` 同族 40×40（挂双类 `annot-toggle bar-btn`）、绝对定位页面左上角 `(var(--sp-4), var(--sp-4))` 两态恒位；轨宽 0↔280 滑动动画（`--dur`/`--ease` Token，reduced-motion 降级瞬时）；滑块去闪＝本地草稿值 + 350ms 去抖提交（受控值不再被旧 prop 回拉，`run()` 全量刷新从「每刻度一次」降为「松手一次」）。
>
> **修订记录（v6，2026-10-02 / D73）**：用户三项后续指令（逐字）：①「请将侧边栏展开、收起的按钮上的图标替换为文字『高亮·摘录』，并去掉侧边栏上方的『注解2』的内容以节省空间」②「现在拖动底部的优先级滑块更改优先级时，整个底部栏会删一下，并且滑块会在一瞬间闪烁到调整前的位置在跳回调整后的位置。此外调整优先级后，右上角『5 条待处理』字样的左侧会在一瞬间显示『优先级改为...』这是个多余的信息，用户调整时自然知道优先级改成多少了，所以请去掉这个信息」③「侧边栏上方的『摘录、高亮、全部、位置、时间』按钮请放在展开收起按钮的同一行，并整体调整大小，左边沿和底栏按钮对齐即可，侧边栏的按钮大小不用再与底栏按钮相同，但也请用排版网格系统有比例地调整按钮大小」。**根因与修法**：②＝v5 的去抖提交在计时器回调里**先清草稿再提交**——写库+刷新回流前受控值回落旧 prop（滑块跳回旧位）再跳新位；且提交走 `run()`（busy 态把整排底栏按钮打成 disabled 又恢复＝整栏闪一下；note 走头带 toast＝「优先级改为…」）。修＝**草稿保留到 prop 追上再清**（`extract.priority` 追上草稿时才回落）+ **优先级专用静默提交**（不挂 busy、不发 toast、不广播 workflow/changed——优先级不涉批注与队列组成，省两次全量重取）。①③＝开关钮改**文字钮、两态变文案**（用户中途更正：**收起态显示「展开」、展开态显示「收起」**；初版「高亮·摘录」常量文案作废）——两文案同為 2 字等宽 ⇒ 定宽 48（`--sp-12`）两态无位移，尺寸 48×32（token 网格，侧栏钮不再与底栏同高——用户明示）；「注解 N」经 `showCount={false}` prop 关闭（annotations.gui 的 helper 只读不断言 count 字段，实测安全）；栏头段控（筛选 3 项/排序 2 项）与开关钮**同一行**：段控行 `margin-left: 16+80+8` 让位，按 **3:2** 比例铺满剩余宽（按钮 24 高＝8×3、32 宽＝8×4 模块），行顶与开关钮顶对齐（同 y＝顶栏下 16px）。
>
> **修订记录（v7，2026-10-02 / D74）**：用户四项后续指令（逐字）：①「摘录页面左上角的『收起/展开』按钮的大小和样式请与旁边的『全部、摘录、高亮、位置、时间』按钮对齐」②「侧边栏的条目左侧有一条与高亮同色的竖线，这条线现在由于在左侧导致它贴在窗口边沿看不清了，请把它移动到条目右侧」③「摘录页底栏上方和『5 条待处理』一栏下方的两条细线请重新显示出来」④「摘录页底栏上的推迟和优先级两个板块请重新设计……去掉外面的大框，直接将小框放大，使其大小与样式直接与其他按钮对齐。其中的『天』字和『优先级』也不应该淡化，应该与其他文字一样」。**修法**：①＝开关钮降至段控同规格 **24×40**（8×3 × 8×5）、1px `--border-subtle` 框 + helper 字色（与段控组框同族），头行让位改 `margin-left: var(--sp-16)`（16+40+8=64 恰在 token 上）、行高随降 24；②＝批注条目的 `--zline` 竖线**摘录页作用域**下从左缘移到右缘（`border-left:none; border-right:2px solid var(--zline)`，整卡 accent 竖线同步）——左线贴窗沿是 D72 轨贴左缘的连带效应，阅读器 dock 不动；③＝**撤回 D71 的隐藏**：`--band-line` 基线 `transparent` → `var(--border-subtle)`（Token 与皮肤扩展点机制保留；两页共用 ⇒ 复习页同步恢复，如需单页差异待用户再裁定）；④＝推迟/优先级去 `.bar-group` 外框：数字框/滑轨直接升 **40 高**（与底栏按钮同规格、1px `--border-strong`、`--paper` 底；滑轨 140×20→144×40＝8×18）、标签「天/优先级」升正文字色 `--text-primary` + `--fs-secondary`（不再 helper 淡化）。
>
> **修订记录（v8，2026-10-02 / D75）**：用户五项后续指令（逐字）：①「将软件的默认颜色改为我现在正在应用的这个绿色，默认不再是蓝色」——默认 accent `:root` `#002fa7` → **`#166a59`**（用户 `app.accentColor` 实值）、深色档 `#5b7fe8` → **`#3fa08a`**（同色相提亮，深底对比 ≥4.5:1，反白档纯黑不变）；同步 4 处代码兜底（SettingsPanel 色板兜底 / MindmapWorkspace / charts swiss / foliate adapter 两处 color-mix）与 accent.gui 恢复默认断言；`--annot-blue` 是批注色板语义名、不动。②「展开/收起按钮与上面的细线和下面的细线的距离应该是一致的」——开关钮 `top` 48+`--sp-4` → **48+`--sp-3`**（topbar 缘 48 与头带缘 96.8 之间垂直居中，上下各 ≈12）；段控行 margin-top 同步 `--sp-3` 与钮顶对齐。③「推迟和优先级模块看起来又太散了……优先级滑块太高了，请将优先级滑块这一处单独还原成上一版」——底栏 gap `--sp-2` → **`--sp-4`**（组间；两页共用规则同步）、组内 gap `--sp-1`（ postpones/priority 内件贴紧成簇）；**滑轨单独回退 144×40 → 140×20**（D74 该项作废，数字框/标签维持 40 高/正色）。④「展开侧边栏后，点击下一条之后，侧边栏不见了，连展开按钮都消失不见了。侧边栏的展开和收起应该有状态记忆，并且请确保我让你做的修改在每个摘录页面中生效」——**批注轨常驻化**（取代 2026-10-01「≥1 条注解才出现」裁定：推进到无批注卡后轨与开关钮整根消失＝用户实测痛点；无批注时轨内显示空列提示；查看态不再藏轨）+ **开合状态记忆入 sessionStorage `extract.annotOpen`**（跨换卡/跨查看态/跨「顶栏摘录」与「阅读器·复习摘录」两个入口持久——两入口同挂 ExtractReviewView，本轮全部改动天然双入口生效）。⑤「顶部的面包屑应该是点击可以跳转的……以后的新摘录要能够实现跳转，并且对摘录进行摘录后，面包屑的层级也要相应的增长，每个层级都要可以跳转」——**「原文」根节点升级为按钮**（`onJumpToDoc` + `documentId` 在场即可点；锚优先用当前卡自身 contextRef（anchorText/anchorRatio/cfi），子摘录无文档级锚时回退链根摘录的锚；两者皆无（较早版本创建的卡）→ 点击 flash「该摘录没有跳转位置数据」有界失败）；层节点维持 openLevel（点层＝切到该层摘录卡查看，层卡内可继续跳原文）——层级随嵌套增长由既有 `getChain`（parentId 链）承担，无需改动；选取「空格＝下一条」等会话快捷键不适用于查看态的既有语义不变。
>
> **修订记录（v9，2026-10-02 / D76）**：底栏定稿采纳 **better-layout「L1 · 一盒一功能」**（预览 `design-samples/bar-redesign/better-layout.html`，用户从三套设计 skill 的 6 版预览中选定），附一项修正：「盒子的边框请统一，目前看起来好像有的颜色深有的颜色浅」。**契约**：① 推迟、优先级各收敛为**一个 1px `--border-strong` 盒**（40 高、`--border-strong` 描边、paper 底、内距 12、组内 8）——盒内裸排：数字 mono/tabular 右对齐、单位 Meta helper、文字钮裸排（hover grey-1）；优先级盒内＝标签 Meta + 滑轨 140×20（1px `--border-strong`）+ 数字 mono。② 组间 24px（`.stage-bar` gap `--sp-4`→**`--sp-6`**，两页同步）；组内 8px。③ **边框统一**：全栏所有可见描边只有一种灰（`--border-strong`）；**主按钮（下一条/显示答案，两页同步）改为 accent 填充 + accent-on 文字**（border 同 accent 自色）——主层级由**填充**承载而非描边变色（瑞士规范「主按钮 accent 填充」），hover 走 `--accent-hover`，disabled 落灰。④ `.bar-group`/`.extract-postpone`/`.extract-priority` 旧规则随零消费者删除。**该批次为用户逐版挑选的结果**：三套设计 skill（better-layout / better-typography / swiss-international-style）各出 2 版预览（`design-samples/bar-redesign/*.html`），L1 胜出。
>
> **修订记录（v10，2026-10-03 / D77）**：用户两项收尾指令（逐字）：①「我之前要求你将摘录页中，底栏按钮距离窗口边框和距离窗口底边的间距改为相同的值，现在请将按钮之间的间距也改为这个值，这样看起来整齐一点。复习页的底栏请也做相同的间距调整」——`.stage-bar` gap `--sp-6`（24）→ **`--sp-4`**（16）：按钮间距 = 距窗缘 = 距窗底 = 16px，全栏单一间距值（两页同步）。②「请去掉摘录页的『下一条』按钮上的『空格』和复习页的『显示答案』按钮上的『空格』文字，因为这些快捷键都是可自定义的可变的，快捷键的显示方式统一改成鼠标悬停在按钮上时气泡显示」——删除两钮内嵌的 `.kbd` 快捷键角标；快捷键信息**只走 `title` 悬停气泡**：复习页沿用既有的动态 hint（随键位设置变化，`title=显示答案（快捷键：${hint || "未绑定"}，可在设置里改）`），摘录页「下一条」title 保留（其空格快捷键当前为页面内固定绑定）。`.bar-btn .kbd` / `.bar-btn.primary .kbd` 两条 CSS 规则随零消费者删除。
>
> **修订记录（v13，2026-10-04 / D88）**：批注轨几何升级与动效 Token 并轨。D88（设计稿 `docs/design/UI-CTAS-REDESIGN-D88.md`）对本文两处修订：① **v5「底栏不做补偿」（`.stage-bar { margin-inline:0 }`、按钮恒距窗缘 16px）条款由 D88 取代**——用户 2026-10-04 指令「侧边栏贯通到底部，展开侧边栏时底栏相应收缩」，轨改 `fixed`（top:48 → bottom:0 贴窗底，消除 sticky 滚动 clamp 缺陷），轨展开时 `.stage-bar` 与 `.extract-page-cols` 同步 `margin-left/padding-left 0↔280`（`--dur-panel` 同参数同步过渡，底栏控件与内距零改动）；② §6 动效规范的时长/缓动并入 **D88 动效 Token 体系**（`--dur/--ease` 管栏级、`--ease-out-soft/--dur-hover/--dur-press` 管按钮级、`--spring` 管指示/回弹，见 GUIDE §5.1），本稿基线条款继续有效。
>
> **修订记录（v12，2026-10-04 / 用户指令）：放开高级动画。** 用户指令（逐字）：「我的项目当中早期好像有『不要动画』的要求，如果现在还有这个要求的话请删掉它，现在可以有高级的动画」。**核查结论**：全仓不存在全局禁动画条款；唯一的成文禁令＝§6 第 4 条「禁止页面/栏开合位移动画、评分色条过渡、按钮 transform」。按指令删除该条，改为允许高级动效。纪律保留：动效须语义耦合、由真实数据/状态驱动（GUIDE §4.10-3 禁假动画、§4.17-7 禁庆祝动画继续生效）、`prefers-reduced-motion` 降级、时长/缓动走 `--dur`/`--ease` Token。本修订为纯文档变更，未动代码。
>
> **修订记录（v11，2026-10-03 / D78）**：用户缺陷报告（逐字）：「我之前要求了支持按住Ctrl可以分别进行多次划选来同时选中多段不相连的文字进行摘录或者高亮或者制卡或者其他后续操作，但是我刚才尝试了一下并没有支持这个功能」。**诊断**：D61 §6.8-11 的多段选择采集层只落在 `Reader.tsx`（阅读器路径 `tests/multiselect.gui.mjs` 20/20 实测通过——真键鼠 Ctrl 加选、集合、两段区间落库全链路健在）；**摘录页卡面从未接入**——`ExtractCardFace.capture()` 只采当前 window 选区（单段）、不读修饰键，`ExtractReviewView` 对 multiHighlight 恒 `update("replace")`，故在摘录页 Ctrl+拖选＝普通替换，累计不发生。**修法（同语义接入摘录页）**：①采集面扩到 `ExtractCardFace`——mouseup 载荷携带修饰位（`ctrlKey/altKey/shiftKey/metaKey`，同 Reader 的「修饰位来自指针事件本身」纪律；键盘 shift+方向键采集按无修饰＝替换）；②集合运算在渲染层以**偏移区间**完成（摘录页的锚域是 `content_markdown` 字符偏移，与阅读器的文本 span 域不同域：偏移是落库 `parentRange` 的第一事实，过文本桥会丢精度且同文段无法消歧；`updateSpanSet` 的文本代数不适用于偏移域，非复制）；语义与阅读器逐字一致——无修饰＝替换、修饰＝按边界精确切换（同段再选＝移出）、无合并；③高亮复用既有 multiHighlight（宿主文档、`theme.css` 的 `::highlight(multi-select)`，零新增）；④拼接文本 `\n\n` 与既有 capture 惯例一致，菜单与五动作（制卡/AI 制卡/AI 解释/摘录/查词）+ 批注挂色零改动自动多段化；⑤修饰键同源 `app.multiSelectKey`（读侧 `readMultiSelectKey` + `settings/changed` 订阅，与 Reader 同法）；⑥清理链路全覆盖：`onSelection(null)`（卡外落下/换卡/动作完成 `clearSelection`）/「点色完成」/Esc（经既有路径）均清集合+高亮；⑦**落库锚链**（实测补上）：菜单「摘录/高亮」的落库走 `useSelectionActions.writeExtract`，其 contextRef 原不含 `parentRange` 且 `clearSelection` 先于落库重置累计——新增配置面 `selectionRanges()`（先采后清）+ `writeExtract` 装配 `opts.parentRange`（**≥2 段才写入** `contextRef.parentRange`，单段路径逐字节不变），高亮/批注路径经 `annotateParent().contextRefPatch`（faceSel.ranges＝累计集合）本就携带；⑧**幂等守卫**（实测踩过）：松开 Ctrl 的 keyup 会以无修饰位重采同一选区，若重放 replace 将在松键瞬间抹掉累计——「无修饰位且与上次上报同界＝重复采集，不重放」；带修饰位的上报不跳过（同段再选＝移出语义保留）。

---

## 1. 用户目标

1. 修掉三个明确缺陷：(a) 两页底部按钮位置不对齐；(b) 复习页卡背面评分按钮超出画面；(c) 评分按钮颜色混进黑色杂色。
2. 摘录页布局重做（"严重不合理"）。
3. 两页布局一致——设置里闪卡与摘录可混编连续处理（§6.8-3），切卡型时不能打断连续处理体验。
4. 操作按钮固定底部。
5. 简约高级；少量高级动画，且符合瑞士风调性（`docs/swiss-international-style.md` 动效节）。

## 2. 现状结构剖析（缺陷机制，全部带出处）

### 2.1 页面骨架现状

两页都是 `.app-shell`（100vh flex 列，`overflow:hidden`，[theme.css:L470-477](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L470-L477)）下、`.topbar`（48px）之后的 flex:1 子节点，但**骨架完全不同**：

| | 摘录页 | 复习页 |
|---|---|---|
| 根 | `.extract-page`（自身是滚动容器，padding `0 64px 32px`）[theme.css:L5037-5045](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L5037-L5045) | `.review-wrap`（自身是滚动容器，padding `48px 64px 32px`）[theme.css:L2434-2443](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2434-L2443) |
| 头 | `.extract-page-head` sticky 吸顶，面包屑+计数+提示+出口全塞一行 flex-wrap [theme.css:L5048-5065](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L5048-L5065) | 无头带，`.review-count` 是滚动内容里的第一行（会滚走）[theme.css:L2453-2460](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2453-L2460) |
| 底栏 | `.extract-face-actions`：`position:sticky; bottom:-32px`，在 720px 居中的 `.extract-face` 内部 [theme.css:L5156-5168](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L5156-L5168) | `.review-bar`：`position:fixed; left:0; right:0; bottom:0; height:56px`，**满窗宽** [theme.css:L2397-2410](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2397-L2410) |

### 2.2 缺陷 A（底栏不对齐）的机制

- 复习页底栏：**fixed 贴视口底**，满窗宽，高 56px，底缘 = `window.innerHeight`。
- 摘录页底栏：sticky 在 `.extract-face` 内，`margin-top:auto` 把它推到面底；但 `.extract-page` 有 `padding-bottom: var(--sp-8)`（32px），`.extract-face` 的包含块底比滚动口底**早 32px 结束**（`bottom:-32px` 的注释自称"抵消下内边距"，实际 sticky 偏移不能突破包含块，栏底停在滚动口底上方 32px）。
- 结果：底缘差 32px、横向一个满宽一个 720px 居中、高度 57px(1+8+40+8) vs 56px。混编会话里闪卡→摘录→闪卡交替时，底部操作区每次都跳位——这正是"打断连续处理体验"的来源。
- 加剧项：侧边栏（批注栏）打开时 `.extract-page-cols.with-annot > .extract-face { flex:1; overflow-y:auto }`（[theme.css:L5033-5035](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L5033-L5035)）让**卡面自己变成滚动容器**，此时 `.extract-face` 没有 32px 下内边距可"抵消"，`bottom:-32px` 允许栏在滚动中沉到可视底缘之下最多 32px——**侧边栏展开时底栏会被自己裁掉一截**。

### 2.3 缺陷 B（评分行超出画面）的机制——铁证

- `.review-bar .grade-row`（[theme.css:L2411](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2411)）**没有复位 margin**。
- 通用规则 `.grade-row { margin-top: var(--sp-12) }`（[theme.css:L2606-2611](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2606-L2611)）的 **48px margin-top 泄漏进 56px 高的固定栏**。
- 栏是 `display:flex; align-items:center`：评分网格的 margin 盒 = 48(margin) + 40(按钮) = 88px，在 56px 里居中 → 上下各溢出 16px → 按钮下缘被推到固定栏底缘之下 16px；栏 fixed 贴视口底 ⇒ **每个评分按钮的底部 16px 在窗口外被裁掉**（到期时间那行小字整体不可见）。
- 为何只有卡背面出事：`.grade-row` 只在 `showBack=true` 时渲染（[ReviewView.tsx:L610-617](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ReviewView.tsx#L610-L617)）；正面「显示答案」按钮是栏的直接子节点、无 margin，居中正常。与截图 3/4 完全一致。

### 2.4 缺陷 C（评分色混黑杂色）的机制——两层颜色叠加 + 与合同色相冲突

同一颗按钮的左缘被**两个时代的规则**重复着色：

1. 新一代（v48.27b）：`.review-bar .grade { border-left-width:3px }` + `.review-bar .grade-good { border-left-color: var(--annot-green) }` 等四条（[theme.css:L2412-2430](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2412-L2430)）。
2. 旧一代（§5.3 合同实现）：`.grade-good::before { background: var(--accent) }` 等 4px 绝对定位色条（[theme.css:L2631-2642](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2631-L2642)）。

后果：
- `::before`（4px、不透明、绘制在 border 之上）盖住 3px border；在非整数设备像素（Windows 125%/150% 缩放）下两层色缘对不齐，产生异色细边。
- 两套色值**不同**：v48.27b 把 Good/Easy 写成 annot-green/accent，与 §5.3 合同「Again 红 / Hard 黄 / **Good 蓝 / Easy 绿**」（`--error/--warning/--accent/--success`）**正好对调**；叠加后 Good 钮左缘是蓝条+绿边、Easy 是绿条+蓝边。
- `.review-bar .grade { background: var(--paper) }`（特异性 0,2,0）压掉了 `.grade-* { background: var(--grey-1) }`（[theme.css:L2626-2630](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2626-L2630)），合同的"灰底"也没了。
- 再叠上缺陷 B：按钮下半截被裁、半截文字与色条在窗口底缘混在一起——用户看到的"混进黑色杂色"。

**修复方向＝回到 §5.3 合同**：灰底 + 左缘 4px 单层色条（`--error/--warning/--accent/--success`），删掉 v48.27b 的 3px border-left 覆写。这是**恢复合同**，不是新设计决策，不需要改 GUIDE 文字。

### 2.5 缺陷 D（摘录页布局不合理）清单

1. 底栏悬空（2.2）：栏底离窗口底 32px，下面一条空白纸面；侧边栏展开时还会被自己裁掉一截。
2. 头行拥挤：面包屑（独占一行）+ 计数 + 集中复习 header + flash + 快捷键提示 + 「返回队列」+「返回阅读」全在一个 flex-wrap 行带里（[ExtractReviewView.tsx:L583-603](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ExtractReviewView.tsx#L583-L603)）；且头带只有 720px 宽、居中，卡面滚动时正文从头带两侧的白边下穿过（无全宽不透明底遮盖）。
3. 复习页计数行在滚动区里会滚走；摘录页头带吸顶——同一"会话元信息"在两页的驻留行为不一致。
4. 侧边栏开合改变滚动上下文（2.2 加剧项），底栏几何随内容长度/栏状态漂移。

## 3. 主方案：两页共用「滚动页 + 吸顶头带 + 流内钉底栏」配方（v2）

**一句话**：两页的页面根都保持**自身为滚动容器**；头带是第一个流内子节点（`position:sticky; top:0`，全宽不透明底）；底栏是最后一个流内子节点（`position:sticky; bottom:0`，负水平边距满宽）——**不用 fixed、不用负偏移 sticky、不用双滚动**；中间内容区 flex-grow，短内容时把底栏顶到视口底。

### 3.1 统一骨架（两页逐节点同构；v5 起摘录页为「轨 + 主列」两列）

```
.page-root（flex 列，flex:1 于 app-shell，overflow-y:auto，padding: 0 var(--sp-16) 0）← 真滚动容器
├── .head-band    流内第 1 子节点；sticky top:0；z-sticky；--paper 底；        ← 复习页维持原位；
│   │             负水平边距满宽（margin-inline: calc(var(--sp-16) * -1); padding-inline: var(--sp-16)）  摘录页同一条带规则但**内嵌于 .extract-main**（见下）
│   └── .head-inner   ≤720px 居中，min-height 48px，flex 单行（面包屑允许 wrap 则头带自然长高）
├── .body         流内中间子节点；flex: 1 0 auto（短内容撑满、长内容自然高）
│   └── 卡面列（≤720px 居中）
└── .stage-bar    流内最后子节点；sticky bottom:0；负水平边距满宽；
                  高 72px（v3/D70）；上缘 hairline（色＝--band-line，基线隐藏，D71）；
                  --paper 底；padding 0 var(--sp-4)

摘录页（.extract-page）v5 骨架（D72）：
.extract-page（真滚动容器，padding: 0 —— 水平留白移交 .extract-main）
├── .extract-page-cols（flex 行；flex:1 0 auto；position:relative＝开关钮定位上下文）
│   ├── [.extract-annot-rail]（仅当 ≥1 条注解；sticky top:0；高 = 100vh−顶栏48−底栏72；
│   │     宽 280 ↔ 0 滑动（--dur/--ease）；贴窗左缘 x=0、上至页面顶；内含 .annot-side（280px 恒宽，被裁滑动））
│   ├── .annot-toggle（仅当 ≥1 条注解；absolute (16,16)；双类 annot-toggle bar-btn，40×40）
│   └── .extract-main（flex:1；min-width:0；列向；padding-inline: var(--sp-16)）
│       ├── .extract-page-head（共用带规则原样生效：main 的 64 padding 之上负边距满宽）
│       │   └── .extract-page-head-inner（width:100% + max-width:720 + margin:auto ＝ 与卡面**同盒**；
│       │         单行：crumbs flex:1 … [header][flash][hint][返回队列][返回阅读][计数最右]）
│       └── .extract-face（≤720px 居中 ＝ 与 head-inner 同一内容盒）
└── .stage-bar（margin-inline:0 覆写——页面根已无 padding，栏本身即满窗宽；按钮距窗缘仍 16px）
```

关键性质（每一条都直接对应一个缺陷或一条测试断言）：

| 性质 | 机制的为什么 |
|---|---|
| 页面根 = 真滚动容器 | `breadcrumb.gui.mjs` L251 的 `scrollHeight−clientHeight>200 && scrollTop>100` 真实成立（非 overflow:hidden 假滚动）；`scrollIntoView({block:"center"})` 的 scrollport 与现状逐像素相同 ⇒ L253-254 高亮居中零风险 |
| 底栏**流内**（非 fixed）+ `bottom:0` 零偏移 | 长内容滚动中钉在滚动口底缘（=窗口底）；滚到底时自然落在内容末尾——任何窗口高度下**自己和内容都不被裁**（缺陷 B 除根）；不需要 `padding-bottom: calc(56px+…)` 双账本（[theme.css:L2433](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2433) 删除）；也不再需要 `.extract-face { min-height:100% }` + `margin-top:auto` 的旧技巧 |
| 中间 `.body` `flex: 1 0 auto` | 短内容时撑满滚动口，把底栏顶到视口底（"固定底部"在空/短内容的每态都成立） |
| 底栏几何只由 `.stage-bar` 一条共享规则给出 | 两页底缘/高度/左右缘**构造性相等**（缺陷 A 除根）；栏在 `.body` 之外 ⇒ 侧边栏开合底栏纹丝不动 |
| 头带全宽 + `--paper` 不透明底 + sticky | 滚动正文从头带下穿过时被遮盖（修 2.5-2）；图案与 §5.3 吸顶页工具条（`.shelf-bar`）同规；`headPos==="sticky"`、底色、命中断言全保留 |
| 评分网格 `margin-top: 0`（显式复位） | 通用 `.grade-row` 的 48px 泄漏被堵死（缺陷 B 双保险） |

### 3.2 底栏契约（两页同一条 `.stage-bar`）

- 带：`position: sticky; bottom: 0; z-index: 4; height: 72px; margin-inline: calc(var(--sp-16) * -1); padding: 0 var(--sp-4); background: var(--paper); border-top: 1px solid var(--band-line); display: flex; align-items: center; gap: var(--sp-4)`。（v10/D77：栏内 gap 定格 **`--sp-4`** 16px——按钮间距 = 距窗缘 = 距窗底，全栏单一间距值，用户裁定；两页共用规则同步；带缘 hairline 已由 D74 恢复显形。）
- 内部直接子节点（**不加额外 wrapper**，与现状 DOM 同构）：主行动区 `flex:1`（grow 按钮或 grade-row）在前，工具区 `.bar-side`（`inline-flex; gap:var(--sp-2); flex:none`）在后；控件恒 40px、单行不换行。
- **功能簇（v9/D76，L1「一盒一功能」）**：推迟、优先级各收敛为**一个 `.bar-cluster` 盒**——40 高、1px `--border-strong`、paper 底、内距 12、组内 8；盒内**裸排**：数字（mono/tabular 右对齐）、单位（Meta helper「天」）、文字钮（无边框，hover `--grey-1`）；优先级盒内＝标签 Meta「优先级」+ 滑轨 140×20（1px `--border-strong`）+ 数字。**盒内不再套小框**（D74 的双框形态废除）。
- **边框统一（v9/D76 用户修正）**：全栏所有可见描边只有一种——1px `--border-strong`；**主按钮（下一条/显示答案，两页同步）升级为 accent 填充 + accent-on 文字**（border 同 accent 自色，无独立描边色）——主层级由**填充**承载而非描边变色（瑞士规范「主按钮：accent 填充 + accent-on 文字」）；hover `--accent-hover`、disabled 落灰；主钮内 kbd 文字用 accent-on（75% 透明度）。
- 垂直节奏（v3/D70）：栏高 72px = 控件 40px + 上下各 16px ⇒ **按钮下缘距窗底 = 左缘距窗左 = 16px**（`--sp-4`），四边留白构造性相等；72 = 8×9 仍吸附 8px 基线网格。
- 三态内容（DOM 槽位两页一致）：
  - 复习·正面：「显示答案」`.bar-btn.primary.grow`（v9 起填充式）；side = [跳转原文][查看原图*][更多]。*=仅图片挖空卡。
  - 复习·背面：`.grade-row`（4 等分 grid，`flex:1; margin-top:0`）；side 同上。
  - 摘录·会话：[下一条 grow][推迟 `.bar-cluster`][优先级 `.bar-cluster`][毕业]；side = [更多▲]（跳转原文/撤销在弹层，现状不动）。
  - 摘录·查看态：bar 仍在（几何不跳），内容 = 单条 meta 提示「查看态：只读 · 不推进调度 · Esc 返回队列」（原头带提示搬家，信息零丢失）。
- 「更多」弹层 `.bar-pop` 维持向上弹（`bottom: calc(100% + var(--sp-2))`）；栏非 overflow 容器，不违反"浮层不得被祖先裁剪"。

### 3.3 评分按钮色彩契约（回 §5.3 合同，缺陷 C 修复）

- 四钮统一：`background: var(--grey-1)`、`border: 1px solid var(--border-subtle)`（四边同 1px，**删** `border-left-width:3px` 与四条 `border-left-color` 覆写）。
- 语义色**唯一承载层**＝既有 `.grade-*::before` 4px 左缘色条：`Again=--error / Hard=--warning / Good=--accent / Easy=--success`（[theme.css:L2631-2642](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2631-L2642) 保留不动）。
- hover `background: var(--grey-2)`；`:focus-visible` `outline: 2px solid var(--accent); outline-offset: 2px`；disabled 文字/边框 `--grey-2`。
- 深色模式零新增工作：`--error/--warning/--accent/--success` 在 `body.theme-dark` 已各自提亮（[theme.css:L136-138](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L136-L138)）。

### 3.4 头带契约（两页同一条配方）

- 带：全宽（负边距满宽法，同 `.stage-bar`）、`position: sticky; top: 0; z-index: var(--z-sticky); background: var(--paper); border-bottom: 1px solid var(--band-line)`。（v4/D71：hairline 基线隐藏。）
- 内列：`max-width: 720px; margin: 0 auto; min-height: var(--sp-12); display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-4)`，Meta 档 12px `--text-helper`。**摘录页（v5/D72）另加 `width: 100%`**：内列不再收缩适应，而是与 `.extract-face` **同一内容盒**（同 padding 容器、同 max-width、同居中）⇒ 面包屑左缘＝卡面左缘、最右元素右缘＝卡面右缘，**构造性成立且两态（轨开/收）皆然**——v2 的 `data-annot-open` 头带 padding-left 补偿规则（344px）随之**删除**（其前提「内列=720 恒宽」自始不成立，实测内列收缩为 248px 居中于 x=566）。复习页内列不加大 width（收缩适应现状保留，本轮不动复习页）。
- 摘录页行序（v5/D72，**单行**）：`[.extract-crumbs]`（`flex:1 1 auto; min-width:0`，**不再是 `1 1 100%`** ——那会把计数挤到第二行）→ `[集中复习 header*]` → `[flash*]` → `[快捷键提示*]` → `[返回队列*]` → `[返回阅读*]` → `[计数 .review-count 恒最右]`（*＝条件出现）。「5 条待处理」与面包屑**同一行**、右缘与卡面右缘对齐（用户裁定 ①）。复习页行序不动。
- 快捷键提示（`data-page-hint` 保留）：仅摘录会话态显示「空格＝下一条 · Z＝撤销 · 正文可直接编辑」；查看态不显示（模式提示已入底栏，不重复表达）；窗口 <1150px 时整条隐藏（退让阶梯单调，只此一级）。
- **className 纪律（面包屑测试命中断言，硬性）**：带元素 className **首 token 必须是 `extract-page-head`**；内列 className 必须是 `extract-page-head-inner`（含子串命中 `/extract-page-head|extract-crumbs|review-count|extract-page-hint|crumb-/`）；带内不得新增其它首 token 不匹配该正则的包装元素。复习页头带用 `.review-head` / `.review-head-inner`（无断言约束，样式与上同规，写成一条联合选择器）。v5：带在摘录页**内嵌于 `.extract-main`**（main 有 64px 水平 padding ⇒ 负边距满宽公式原样成立），sticky 判据（`breadcrumb.gui.mjs` L252）不受嵌套影响。

### 3.5 侧边栏（批注栏）契约（v5/D72 重写）

- 宽度 280px（§6.8-12 合同）不变；`.annot-side` 的右缘 hairline / `--paper` 底 / 内部两行头 + 自滚列表样式全部不动（宽度由 AnnotationPanel `width` prop 内联给出，280 恒定 ⇒ 滑动动画期间内容不自重排，只被轨裁切）。
- **骨架位（v5）**：轨 = `.extract-page-cols` 的**首个 flex 子节点** `.extract-annot-rail`，与 `.extract-main`（头带 + 卡面所在的主列）**并排**——故轨**上至页面顶**（与头带同一 y 起点，用户裁定 ②「贯通到整个摘录页面的顶部」）、**贴窗左缘 x=0**（页面根水平 padding 移交 `.extract-main`，用户裁定 ③「左侧异常大片空白」＝原页面根 64px padding，随移交消除；与阅读器左栏「贴左缘」既有判据同规）。
- **钉位与高度（v5）**：`.extract-annot-rail { position: sticky; top: 0; align-self: flex-start; height: calc(100vh - 120px); overflow: hidden }`（120 = 顶栏 48 + 钉底栏 72，版式量度非 token；轨下缘恰止于底栏上缘）——页面滚动时轨恒在视口内，轨内列表自滚（`.annot-side-body` overflow:auto 不动）。
- **滑动动画（v5，用户裁定 ④）**：轨宽 `280 ↔ 0` + `visibility`，`transition: width var(--dur) var(--ease), visibility var(--dur) linear`，声明在 `@media (prefers-reduced-motion: no-preference)` 之下（减少动效 ⇒ 瞬时，纪律同 §3 入场动效）。收起态挂 `.is-closed`（`width:0; visibility:hidden`）——visibility 的离散步进在过渡下「关闭时停在末帧、打开时立即显形」，动画期间面板可见地滑出/滑入。
- **出现条件不变**：当前卡 ≥1 条注解才渲染（`annotPanelVisible`）；**收起后不留空轨**（用户 2026-10-01 裁定维持）——收起 = 轨宽 0，不再是「不渲染」，因为滑动动画要求面板跨两态持续在场；对「不留空轨」的语义等价性由 `width:0 + visibility:hidden`（不占布局、不可交互、不进可访问树）保证。
- **开关钮（v5 定位 / v6 文案 / v7–v8 造型，用户裁定）**：双类 `annot-toggle bar-btn`；v6 起**文字钮、两态变文案**（用户中途更正：**侧边栏未展开时显示「展开」、展开状态时显示「收起」**——状态同时由 `aria-expanded` 承载），两文案同為 2 字等宽 ⇒ 定宽两态切换零位移；v7 起尺寸与样式降至段控同规格：**24×40**（8×3 × 8×5）、1px `--border-subtle` 框、`--text-helper` 字色；v8 起**垂直居中于上下两条带缘细线之间**（用户裁定 ②）：`top: calc(48px + var(--sp-3))`——topbar 下缘（y=48）与头带下缘（≈y=96.8）之间上下各 ≈12px；**`position: fixed` 定位**（受控的轨是 sticky，钮随内容滚走就会「栏在眼前、钮在远处」）；**`z-index: calc(var(--z-sticky) + 1)`**：收起态主列满宽、吸顶头带（z=--z-sticky、不透明底）会盖住按钮（实测只露下缘 7px、真实点击不可达），故钮必须高于带一层。选择器写成双类 `.annot-toggle.bar-btn`（0,2,0）——单类与 `.bar-btn`（0,1,0）同特异性且源序在后会被其 padding/font-size 覆盖（实测踩过）。`data-annot-toggle` / `aria-expanded` / `aria-controls` 钩子全保留（`extract.gui.mjs` L348 断言在用）。
- **栏头行（v6 / v7–v8 让位更新，用户裁定 ①③）**：「注解 N」计数经 AnnotationPanel 新 prop `showCount={false}` 关闭（阅读器路径默认 true 不变）。筛选段控（全部/摘录/高亮）与排序段控（位置/时间）**仍在 AnnotationPanel 头行内**（状态与 data 钩子零迁移），摘录页作用域下头行改**单行 flex**、与 fixed 开关钮**同一行**：`margin: var(--sp-3) 0 0 var(--sp-16)`（v8：顶对齐随钮居中改 48+12；左让位 16+40+8=64）；两条段控按 **3:2** 比例铺满剩余宽（filter flex:3 / sort flex:2），段控按钮 **24 高 × 等宽**。aside 的 `padding-top` 让高由头行 margin 承担。
- **批注轨常驻 + 状态记忆（v8，用户裁定 ④）**：轨与开关钮在摘录会话**恒在场**——取代 2026-10-01「当前卡 ≥1 条注解才出现」裁定（推进到无批注卡后轨与钮整根消失＝用户实测痛点）；无批注时轨内列表显示「（筛选后无条目）」空列提示；**查看态不再藏轨**（查看卡的注解照常加载）。开合状态入 **sessionStorage `extract.annotOpen`**（"1"/"0"，缺省开）——跨换卡、跨查看态、跨「顶栏摘录」/「阅读器·复习摘录」两个入口持久（同挂 ExtractReviewView），应用重启后回到「开」。空态/加载态页面（无卡）仍无轨。
- **面包屑跳转（v8，用户裁定 ⑤）**：「原文」根节点由 span 升级为**按钮**（`onJumpToDoc` 与 `documentId` 在场即可点）：锚优先取**当前卡自身 contextRef**（anchorText/anchorRatio/cfi），子摘录（无文档级锚）回退**链根摘录**的锚；两者皆无（较早版本创建的卡）→ 点击 flash「该摘录没有跳转位置数据（较早版本创建）」有界失败。跳转语义与底栏「跳转原文」一致（`returnTo="queue"` 存现场）。**层节点维持 openLevel**（点层＝查看态切到该层摘录卡；层卡内可继续跳原文）——「每个层级都可跳转」由「层间互跳 + 原文直达」构成；层级随嵌套增长由既有 `getChain`（parentId 链）承担，零改动。
- **头带补偿规则删除**（v5）：轨与主列并排 ⇒ 头带天然在轨右侧，无需 `data-annot-open` padding-left 补偿（v2 版的补偿自 v5 起失效删除；`data-annot-open` 属性本身保留为状态钩子）。底栏不做补偿——它必须保持满宽恒定位。
- **条目竖线右移（v7，用户裁定 ②）**：批注条目的 `--zline` 竖线在**摘录页作用域**（`.extract-annot-rail .annot-side .zitem`）从左缘移到右缘（`border-left: none; border-right: 2px solid var(--zline)`；整卡条目的 accent 竖线 `border-right-color: var(--accent)` 同步）——D72 把轨贴到窗左缘后，左线贴边看不清；阅读器 dock 在右侧、无此问题，基线 `.zitem` 左线不动（两宿主各按各自边界取边）。
- **推迟/优先级去外框（v7，用户裁定 ④）**：底栏两组件卸掉 `.bar-group` 外框（含 40px 组框、helper 色标签），**内件直接升到底栏按钮规格**——数字框 64×40（8×8）、滑轨 144×40（8×18；原 140×20）、均 1px `--border-strong` + `--paper` 底；「天」「优先级」标签升 `--text-primary` + `--fs-secondary`（不再 helper 淡化）。`.bar-group` 基线规则保留（组框形态仍是皮肤/后续可用件，当前零消费者）。
- **头带补偿规则删除**（v5）：轨与主列并排 ⇒ 头带天然在轨右侧，无需 `data-annot-open` padding-left 补偿（v2 版的补偿自 v5 起失效删除；`data-annot-open` 属性本身保留为状态钩子）。底栏不做补偿——它必须保持满宽恒定位。

### 3.6 混编合并复习分支（ReviewView 里的摘录卡面）

- 与主分支同一配方：head-band（`摘录 · 合并复习` 计数行）+ `.review-session`（`ExtractCardFace`，**不再自渲染动作区**）+ `.stage-bar`（`ExtractActionsBar`）作为 `.review-wrap` 的最后子节点。
- D1 排版分界必须保持：`.extract-page .extract-face-body` = 26px/1.5（[theme.css:L5151](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L5151) 不动）；`.review-wrap .extract-face-body` = 基线 14px/1.8。`extract.gui.mjs` 有对照断言，骨架改动不得碰这两条选择器链。

### 3.7 组件拆分（唯一结构性重构）

把动作区从 `ExtractCardFace` 里**原样平移**为同文件命名导出 `<ExtractActionsBar>`：

- `ExtractCardFace`（[ExtractCardFace.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ExtractCardFace.tsx)）：保留 meta/body/derived；删除 L335-445 的 `.extract-face-actions` 渲染块；`ExtractFaceHandlers` 接口签名**一字不改**（两个宿主把同一个 handlers 对象传给 bar 组件，调用方零适配）。
- 新 `ExtractActionsBar`（同文件命名导出）：props = `{ extract, busy?, engine?, handlers }`；根节点 `<div className="stage-bar extract-face-actions" data-extract-bar>`——**类名与 data 钩子全保留**，`extract.gui.mjs` / `breadcrumb.gui.mjs` 按 `.extract-face-actions button` 文本点按钮的断言不受影响（它们用 `document.querySelector`，对 DOM 位置不敏感）。
- 复用而非新造：`.bar-btn/.bar-group/.bar-more/.bar-pop/.extract-postpone/.extract-priority` 样式零改动。

## 4. 尺寸规范表（全部引用既有 token；无新增 token）

| 项 | 值 | 来源 |
|---|---|---|
| 顶栏 / 头带内列 min-height | 48 / 48 | `--sp-12`（顶栏现状；头带与 §5.3 `.shelf-bar` 同档） |
| 底栏高 | 72（v3/D70：16 + 40 + 16，与左右 16px 对称） | `--sp-4` 基线 |
| 底栏内边距 | `0 var(--sp-4)` | 现状复习栏同值 |
| 控件高 | 40（`.bar-btn/.bar-group/.grade`） | 现状 |
| 版心列 | `max-width: 720px; margin: 0 auto` | §5.3 版心合同（现状） |
| 页面水平内边距 | `var(--sp-16)`（64）；头带/底栏负边距满宽 | 两页现状 + 本方案 |
| 内容区顶部间距 | `.extract-page-cols` / `.review-session` `padding-top: var(--sp-4)` | 统一新值（替代现状 48/32 不对称） |
| 内容间距 | 卡面内 `gap: var(--sp-4)`；bar 内 `gap: var(--sp-2)` | 现状 |
| 批注轨 | 宽 280（§6.8-12）；v5/D72：sticky `top:0`、高 `calc(100vh - 120px)`（顶栏 48 + 底栏 72）、贴窗左缘、宽 0↔280 滑动 | 合同 + v5 |
| 分隔 | 仅横向 hairline 1px `--border-subtle`（头带下缘、底栏上缘各一条） | 瑞士风 / `.shelf-bar` 同规 |
| 字号 | 头带/元信息 `--fs-meta`(12)；卡面 `--fs-title-l`(26)/1.5（D1 双域）；底栏标签 `--fs-secondary`(13)；kbd/到期 `--fs-meta` mono tabular-nums | 现状全保留 |
| 圆角/阴影 | 0 / 无（弹层唯一 `--shadow-float`） | §5.1 |
| z 层级 | 头带 `var(--z-sticky)`(200) > 底栏 4 > toggle 3 | 头带沿用现状；底栏沿用现状 |

## 5. 各状态设计

| 状态 | 规则 |
|---|---|
| 默认 | 骨架如 §3.1；底栏三态内容如 §3.2 |
| Hover | 评分钮底 `--grey-1`→`--grey-2`；`.bar-btn:hover` 边框 `--text-primary`（现状）；不位移不缩放不发光 |
| Focus（键盘） | 全部可点控件 `:focus-visible` 2px `--accent` outline offset 2px（评分钮本次显式补上；其余沿用全局） |
| Loading | 两页统一：页面根内居中「加载中…」meta 文案（摘录页补上，现状是空白页）；无头带无 bar（保持现状结构，仅摘录页加文案） |
| Empty（队列空/会话完成） | 头带（计数）+ 居中 `.empty-state`（现状装饰方块+一句话+撤销/返回按钮，不动）；无 bar；摘录空态 `.extract-page > .review-count { padding-top: var(--sp-12) }` 规则**保留** |
| Error（persist 失败/预览失败） | `.save-error` 横幅在 `.review-session` 顶部（随内容滚）；评分/动作钮 disabled（现状逻辑不动） |
| Success（操作反馈） | flash 消息在头带右簇（现状位置，搬家不改动）；1800ms 自消（现状） |
| Disabled | 文字/边框 `--grey-2`，不响应 hover（现状 `.bar-btn:disabled`） |
| 查看态（仅摘录页） | bar 显示模式提示（§3.2）；head 显示「返回队列」；空格/Z 不作用（现状逻辑不动） |

## 6. 动画规范（v12 起放开高级动效；语义耦合、可降级）

第 1–2 条为基线动效，全部走既有 `--ease: cubic-bezier(0.2,0,0.38,0.9)` / `--dur: 120ms`（瑞士风 120–240ms 区间下限，连续处理场景宁快勿拖）；**自 v12 起（用户 2026-10-04 指令）在此之上允许高级动效**，不再限于两处：

1. **换卡入场**（两页统一，"连续处理"的唯一表达）：卡面 `opacity 0→1 + translateY(4px→0)`，120ms `--ease`，`both`。
   - 触发：卡 id 变化导致的重挂载。摘录页 `ExtractCardFace` 已有 `key={current!.id}`（[ExtractReviewView.tsx:L667](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ExtractReviewView.tsx#L667)）；**复习页需给 `<CardFace>` 补 `key={current!.id}`**（[ReviewView.tsx:L586](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ReviewView.tsx#L586)，一行改动；翻面状态 `showBack` 由父持有，不受 remount 影响）。
   - 翻面揭示：`.review-back` 挂载时同一动画（答案自下方 4px 浮现，hairline 之上问题不动）。
   - 作用域选择器：`.review-wrap .review-face, .extract-page .extract-face, .review-wrap .extract-face, .review-wrap .review-back`。
2. **弹层入场**：`.bar-pop` opacity 0→1，150ms（瑞士风"浮层进 150 出 100"；出场保持瞬时，不引 JS 退场动画）。
3. **降级**：以上全部包在 `@media (prefers-reduced-motion: no-preference)` 内——减少动效时零动画（与全仓既有 reduce 块同思路，[theme.css:L1708](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L1708) 等 6 处先例）。
4. **高级动效放开（v12 用户裁定，原「禁止页面/栏开合位移动画、评分色条过渡、按钮 transform」条款作废）**：页面/栏开合、评分反馈、按钮变换等均可使用高级动效；纪律仍保留——语义耦合、由真实数据/状态驱动（GUIDE §4.10-3 禁假动画、§4.17-7 禁庆祝动画继续生效）、全部动效包在 `@media (prefers-reduced-motion: no-preference)` 内可降级、时长/缓动走 `--dur`/`--ease` Token 体系。

## 7. 窗口尺寸变化行为

- 支持域：窗口 min 1120×640（[main.js:L1492-1493](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/main.js#L1492-L1493)），默认 1100×750。
- 1120 宽：页面列 = min(720, 1120−128) = 720；批注轨开：卡面列 = min(720, 1120−280−128) = 712（仍 ≥ 表单下限）。
- 640 高：头带 48 + 底栏 56 ⇒ 滚动口 ≥ 536；卡面 `min-height:200` 完整可见，长出部分滚动；**底栏流内钉底，任何高度不被裁**。
- ≥1120 宽：列恒 720 居中，两侧留白对称增大；底栏主按钮 `grow` 随窗加宽（现状行为，Anki 式，保留）。
- <1150 宽：头带快捷键提示隐藏。
- 底栏单行不换行；摘录栏控件在最坏情况（1120 宽）占用 ≈700px < 1088px 可用宽，不会溢出。
- 面包屑深层链 wrap 时头带长为两行（`flex-wrap`），只下推内容，不遮不裁；sticky 轨 `top` 按单行 48 钉位，双行头带时轨顶上沿被头带不透明底短暂遮盖（可接受，见 §3.5）。

## 8. 逐文件改动清单（白名单：仅以下 4 个文件；tests/ 零改动）

### 8.1 `src/theme.css`

**新增（台架区，建议插在 L2391 复习页区块注释之前）：**
```css
/* ---------- 钉底栏（摘录页/复习页共用；EXCERPT-REVIEW-LAYOUT-REDESIGN v4） ---------- */
.stage-bar {
  position: sticky; bottom: 0; z-index: 4;
  height: 72px; margin-inline: calc(var(--sp-16) * -1); padding: 0 var(--sp-4);
  display: flex; align-items: center; gap: var(--sp-2);
  background: var(--paper); border-top: 1px solid var(--band-line);
}
.bar-side, .review-bar-side { display: inline-flex; align-items: center; gap: var(--sp-2); flex: none; }
.bar-hint { font-size: var(--fs-meta); color: var(--text-helper); }
/* 头带（摘录页 .extract-page-head / 复习页 .review-head 共用内列规则） */
.extract-page-head, .review-head {
  position: sticky; top: 0; z-index: var(--z-sticky);
  margin-inline: calc(var(--sp-16) * -1); padding-inline: var(--sp-16);
  background: var(--paper); border-bottom: 1px solid var(--band-line);
}
.extract-page-head-inner, .review-head-inner {
  max-width: 720px; margin: 0 auto; min-height: var(--sp-12);
  display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-4);
  font-size: var(--fs-meta); color: var(--text-helper);
}
.review-head-inner { justify-content: flex-end; }
.extract-page-head-inner { width: 100%; }  /* v5/D72：内列与卡面同盒（同为 ≤720 居中）⇒ 面包屑/计数与卡面构造性对齐 */
@media (max-width: 1150px) { .extract-page-hint { display: none; } }
/* v5/D72：摘录页「轨 + 主列」骨架（页根 padding:0 ⇒ 底栏负边距改为 0 覆写，按钮距窗缘仍 16px） */
.extract-page-cols { position: relative; display: flex; align-items: stretch; flex: 1 0 auto; min-height: 0; }
.extract-annot-rail {
  flex: none; width: 280px; position: sticky; top: 0; align-self: flex-start;
  height: calc(100vh - 120px); /* 顶栏 48 + 底栏 72 */ overflow: hidden;
}
.extract-annot-rail.is-closed { width: 0; visibility: hidden; }
.extract-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding-inline: var(--sp-16); }
.extract-page .stage-bar { margin-inline: 0; }  /* 页根已无水平 padding，无需负边距满宽 */
.annot-toggle { position: fixed; left: var(--sp-4); top: calc(48px + var(--sp-4)); z-index: calc(var(--z-sticky) + 1); width: 40px; height: 24px; padding: 0; justify-content: center; font-size: var(--fs-meta); border-color: var(--border-subtle); color: var(--text-helper); }  /* v7：与段控同规格 24×40；双类提特异性；fixed＝滚动恒位；z 高于吸顶带 */
@media (prefers-reduced-motion: no-preference) {
  .extract-annot-rail { transition: width var(--dur) var(--ease), visibility var(--dur) linear; }
}
/* v5 删除：.extract-page[data-annot-open="1"] .extract-page-head { padding-left: calc(280px + var(--sp-16)) }（前提「内列=720 恒宽」不成立，对齐改由内列同盒构造性保证） */
/* 入场动效（降级见 reduce 纪律） */
@media (prefers-reduced-motion: no-preference) {
  .review-wrap .review-face, .extract-page .extract-face, .review-wrap .extract-face, .review-wrap .review-back { animation: stage-card-in var(--dur) var(--ease) both; }
  .bar-pop { animation: stage-pop-in 150ms var(--ease) both; }
}
@keyframes stage-card-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes stage-pop-in { from { opacity: 0; } to { opacity: 1; } }
```

**修改（复习页区块 L2391-2460）：**
1. `.review-bar`（L2397-2410）：删 `position:fixed; left; right; bottom; z-index; height; padding; background; border-top`——几何移交 `.stage-bar`（元素改挂双类 `stage-bar review-bar`）；`.review-bar` 仅保留为作用域/测试钩子。
2. `.review-bar .grade-row`（L2411）：加 `margin-top: 0;`（堵 L2610 的 48px 泄漏）。
3. `.review-bar .grade`（L2412-2425）：删 `background: var(--paper)`（由 L2626 `.grade-*` 的 `--grey-1` 接管）；`border: 1px solid var(--border-subtle); border-left-width: 3px` → `border: 1px solid var(--border-subtle)`。新增 `.review-bar .grade:hover { background: var(--grey-2) }`、`.review-bar .grade:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`。
4. 删 `.review-bar .grade-again/-hard/-good/-easy` 四条 border-left-color（L2427-2430）。
5. 删 `.review-session { padding-bottom: calc(56px + var(--sp-6)) }`（L2433）。
6. `.review-wrap`（L2434-2443）：`padding: var(--sp-12) var(--sp-16) var(--sp-8)` → `padding: 0 var(--sp-16)`；其余（flex 列、`overflow-y:auto`）不动——**它仍是滚动容器**。
7. `.review-session`（L2444-2451）：加 `flex: 1 0 auto; padding-top: var(--sp-4);`；720 居中不动。
8. `.review-count` 覆写块（L2453-2460）：删 `align-self: flex-end; margin-bottom: var(--sp-6)`（计数进头带内列后由 `.review-head-inner` 的 `justify-content: flex-end` 承担）；基础 `.review-count`（L2394-2395）不动。
9. `.review-bar-side`（L2431）：选择器并入 `.bar-side` 联合规则（见新增区）。

**修改（摘录页区块 L4999-5206）：**
10. `.extract-page`（L5037-5045）：`padding: 0 var(--sp-16) var(--sp-8)` → `padding: 0 var(--sp-16)`；**`overflow-y:auto` 与 flex 列不动——它仍是滚动容器**（面包屑测试硬条件）。L5047 空态 padding 规则**保留**。
11. `.extract-page-head`（L5048-5065）：删 `width; max-width; margin; padding-top; font-size; color`（移交新增联合规则的带/内列两层）；`position:sticky; top; z-index; background` 由联合规则保持（**computed sticky 与不透明底是测试断言，必须保留**）；原 L5060-5064 的注释更新为「与 .shelf-bar 同规的全宽吸顶带」。面包屑 L5069-5118 全部不动。
12. `.extract-page-cols`（L5002-5009）：加 `flex: 1 0 auto; padding-top: var(--sp-4);`；`position: relative` 与 `display:flex` 不动。
13. 删 `.extract-page-cols.with-annot > .extract-face { flex:1; min-width:0; overflow-y:auto }`（L5033-5035）——滚动职责统一回 `.extract-page`；`.with-annot` 类与 `data-annot-cols` 钩子保留。
14. `.extract-annot-slot`（L5010）：加 `position: sticky; top: var(--sp-12); align-self: flex-start; max-height: calc(100vh - var(--sp-12) - var(--sp-12) - 57px);`，并补 `.extract-annot-slot .annot-side { max-height: inherit; }`（轨内列表自滚；`.annot-side` 其余声明与 280px 宽度来源不动）。
15. `.extract-face`（L5121-5130）：删 `min-height: 100%`（底栏钉底不再靠它）；加 `flex: 1 1 auto; min-width: 0;`；720 居中保留（在 cols 行内自动居中于剩余宽）。
16. `.extract-face-actions`（L5156-5168）：删 `position:sticky; bottom; margin-top:auto; border-top; background; padding; z-index`（几何移交 `.stage-bar`，元素挂双类 `stage-bar extract-face-actions`）；`display:flex; flex-wrap` 改单行 `nowrap`（由 `.stage-bar` 承担）。
17. `.extract-page-head .review-count { align-self: auto }`（L5116）等面包屑区小规则不动；`.extract-page-hint { margin-left: auto }`（L5118）保留（在头带内列里表示"右簇"）。

**不动**：`.grade-*::before` 色条（L2631-2642）、`.grade-row` 通用规则（L2605-2611）、`.bar-btn/.bar-group/.bar-more/.bar-pop`（L5169-5196）、优先级/推迟控件（L5197-5206）、`.annot-side` 全家（宽度/边框/内部滚动）、`.annot-toggle`（L5013-5030）与 L5032 让位规则、D1 排版（L5147-5153）、所有 token。

### 8.2 `src/components/ExtractCardFace.tsx`

- 删 L335-445 的 `.extract-face-actions` 渲染块。
- 同文件新增命名导出 `ExtractActionsBar`（承载平移的同一套 JSX；根 `<div className="stage-bar extract-face-actions" data-extract-bar>`；props `{ extract, busy?, engine?, handlers }`）。
- `ExtractFaceHandlers` 接口、组件 props、`viewOnly`/`quoteRanges`/`bodyAnnotations` 行为全部不动。

### 8.3 `src/components/ExtractReviewView.tsx`

- 主返回（L581-761）按 §3.1 重排（**`.extract-page` 仍是滚动根**；类名钩子全保留）：
  - `.extract-page` 加 `data-annot-open={annotPanelVisible && annotOpen ? "1" : undefined}`；`data-showing-extract-id`/`data-viewing` 保留；**不加 `stage-root` 之类新类**。
  - 头带：`<div className="extract-page-head"><div className="extract-page-head-inner">`——**首 token 纪律见 §3.4（测试硬条件）**；现有子节点（面包屑/计数/header/flash/hint/返回队列/返回阅读）原样搬入内列，类名与 data 钩子一字不改；hint 仅会话态渲染。
  - `.extract-page-cols`：annot-toggle、annot-slot 不动；卡面不再包任何滚动 wrapper，`<ExtractCardFace …/>` 直接作为 cols 的行内子节点。
  - 底栏（`.extract-page` 的最后子节点）：会话态 `<ExtractActionsBar extract={current} busy={busy} engine={engine} handlers={同一对象} />`；查看态 `<div className="stage-bar extract-face-actions"><span className="bar-hint">查看态：只读 · 不推进调度 · Esc 返回队列</span></div>`。
- 空态分支（L493-522）：结构不动（`.extract-page` + `.review-count` + `.empty-state`；无头带无 bar）。loading 分支（L491）：补「加载中…」meta 文案。

### 8.4 `src/components/ReviewView.tsx`

- 四个返回分支（loading L469-475 / 合并摘录 L489-516 / 完成 L518-547 / 主 L549-692）统一配方（**`.review-wrap` 仍是滚动根**）：
  - 头带（新增，wrap 的第 1 子节点）：`<div className="review-head"><div className="review-head-inner">` + `.review-count`（`data-review-counts` 保留）；合并分支计数文案「摘录 · 合并复习」不动。
  - `.review-session`：仍是 720 内容列（加 `flex: 1 0 auto`）；主分支内容顺序：save-error / previewError 横幅 → deferredPanel → `<CardFace key={current!.id} …/>`（**补 key**）→ `.review-meta` → mnemonic。
  - **底栏搬家（关键结构修订）**：`.review-bar` 从 `.review-session` 内部（[ReviewView.tsx:L598-689](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ReviewView.tsx#L598-L689)）移到 `.review-wrap` 的**最后子节点**，改 `<div className="stage-bar review-bar" data-review-bar>`——fixed 时代它藏在 session 里无所谓，sticky 时代必须直接挂在滚动根下（满宽包含块 + 正确钉底）；内部 DOM（显示答案/grade-row/`.review-bar-side`/`.bar-more`/`.bar-pop`）一字不改。
  - 合并分支：`<ExtractCardFace …/>`（无动作区）留在 `.review-session`；`<ExtractActionsBar extract={ex} handlers={…} />` 作为 wrap 最后子节点；`import ExtractCardFace, { ExtractActionsBar } from "./ExtractCardFace"`。
- 所有逻辑（grade/skip/undo/快捷键/命令矩阵/sessionStorage 现场恢复）零改动。

### 8.5 v5 修订改动清单（D72，2026-10-02）

**`src/theme.css`**：① `.extract-page` padding `0 var(--sp-16)` → `0`（水平留白移交主列；轨贴窗左缘）；`.extract-page .stage-bar { margin-inline: 0 }`（页根无 padding，负边距满宽公式改为自然满宽，按钮距窗缘 16px 不变）。② `.extract-page-cols` 重写为轨道行（`position:relative` 保留＝开关钮定位上下文）。③ `.extract-annot-slot` 整块替换为 `.extract-annot-rail`（§3.5 钉位/高度/overflow + `.is-closed` + reduced-motion 下的宽度过渡）；`.extract-annot-slot .annot-side { max-height: inherit }` 随之删除，改 `.extract-annot-rail .annot-side { height: 100%; padding-top: calc(var(--sp-4) + 40px + var(--sp-2)) }`（为左上角开关钮让高）。④ `.annot-toggle` 重写（§3.5：40×40、(16,16)、双类 `bar-btn` 族）；`padding-left: calc(12+24+8)` 栏头让位 hack 删除。⑤ `.extract-main` 新增。⑥ `.extract-page[data-annot-open="1"] .extract-page-head` 补偿规则删除；`.extract-page-head-inner { width: 100% }` 新增（仅摘录页内列）。⑦ `.extract-crumbs` `flex: 1 1 100%` → `flex: 1 1 auto`（计数同行）。⑧ 空态计数规则补水平 padding（页根 padding 归零后空态不贴边）。

**`src/components/ExtractReviewView.tsx`**：主返回按 §3.1 v5 骨架重排——`.extract-page-cols` 内顺序改为 [开关钮（absolute）][`.extract-annot-rail`（含 AnnotationPanel，`is-closed` 由 annotOpen 驱动，两态持续挂载以承载动画）][`.extract-main`（头带 + 卡面）]；头带内列行序按 §3.4（crumbs 在前 flex:1、计数恒最右、其余条件项居右簇）；类名与 data 钩子（`extract-page-cols`/`data-annot-cols`/`with-annot`/`data-annot-toggle`/`data-annot-panel`/`extract-page-head(-inner)`/`extract-crumbs`/`data-page-hint`）全保留；`aria-controls="extract-annot-panel"` 指向轨。

**`src/components/ExtractCardFace.tsx`（ExtractActionsBar）**：优先级滑块与数字输入改为**本地草稿值**（`prioDraft ?? extract.priority`）+ 350ms 去抖提交 `handlers.onPriority`——拖动全程零 IPC 写、零 `run()` 全量刷新（受控值不再被旧 prop 回拉 = 闪烁根因）；换卡（`extract.id` 变化）时草稿复位；卸载时清计时器。视觉（`.prio-track/.prio-fill` 滑块）零改动。

### 8.6 v6 修订改动清单（D73，2026-10-02）

**`src/components/reader/AnnotationPanel.tsx`**：新可选 prop `showCount = true`；为 false 时不渲染 `data-annot-count` 的「注解 N」span（阅读器路径默认不变）。

**`src/components/ExtractReviewView.tsx`**：① 开关钮内容 `«/»` → 常量文案「高亮·摘录」（`title`/`aria-expanded` 继续承载开合语义）。② `<AnnotationPanel showCount={false} …>`。③ 新增 `commitPriority`（静默提交：不 `setBusy`、不发 flash note、不 `eventBus.emit`——优先级不涉批注与队列组成；仍 `setPriority` + `refresh()` 保证投影回流），`faceHandlers.onPriority` 改指向它。

**`src/components/ExtractCardFace.tsx`（ExtractActionsBar）**：草稿生命周期修订——计时器回调**只提交不清草稿**；新增回流判据 effect：`extract.priority` 追上草稿（clamp 后相等）才 `setPrioDraft(null)`（提交期间受控值恒显示草稿 ⇒ 滑块不再「跳回旧位再跳新位」）；`extract.id` 变化仍复位。

**`src/theme.css`（摘录页作用域）**：① `.annot-toggle.bar-btn`：48×32（`width: var(--sp-12); height: var(--sp-8)`）、`font-size: var(--fs-meta)`，钮文案两态「展开/收起」（用户中途更正）。② `.extract-annot-rail .annot-side` 的 `padding-top` 让高删除（改由头行 margin 承担）。③ `.extract-annot-rail .annot-side-head` 覆写为单行 flex：`margin: var(--sp-4) 0 0 calc(var(--sp-4) + var(--sp-12) + var(--sp-2))`、`height: var(--sp-8)`、`align-items: center`、`border-bottom: none`（头行浮在钮旁，基线版整行 hairline 会从让位点起笔成断线）；`.filter { flex: 3 }` / `.sort { flex: 2 }`（3:2 有比例铺满），段控按钮 `height: 24px`（8×3）。

### 8.7 v7 修订改动清单（D74，2026-10-02）

**`src/theme.css`**：① `.annot-toggle.bar-btn`：48×32 → **24×40**（`height: 24px; width: 40px`）、`border-color: var(--border-subtle)`、`color: var(--text-helper)`（与段控同规格同族，hover 仍升 `--text-primary`）。② `.extract-annot-rail .annot-side-head`：让位 `margin-left` 改 `var(--sp-16)`（16+40+8）、`height: 24px`。③ 新增 `.extract-annot-rail .annot-side .zitem { border-left: none; border-right: 2px solid var(--zline, transparent); }` 与 `.extract-annot-rail .annot-side .zitem.whole { border-left: none; border-right-color: var(--accent); }`（竖线右移，仅摘录页作用域）。④ `--band-line` 基线 `transparent` → `var(--border-subtle)`（D71 撤回，Token 机制保留）。⑤ 推迟/优先级：`.extract-postpone { font-size: var(--fs-secondary); color: var(--text-primary); }`、新增 `.extract-postpone input[type="number"]`（64×40、`--border-strong`、mono 右对齐）、`.extract-priority { … }` + `.extract-priority .lbl { font-size: var(--fs-secondary); color: var(--text-primary); }`、`.prio-track` 140×20 → **144×40**（8×18）、`.extract-priority .prio-num` 52×26/border-subtle → **64×40/border-strong**。

**`src/components/ExtractCardFace.tsx`（ExtractActionsBar）**：`extract-postpone` 与 `extract-priority` 卸掉 `bar-group` 类（外框消失；`.bar-group` 基线规则保留为零消费者预留件）。JSX 其余（input/天/滑轨/按钮）零改动。

### 8.8 v8 修订改动清单（D75，2026-10-02）

**`src/theme.css`**：① `:root --accent` `#002fa7` → **`#166a59`**（用户 `app.accentColor` 实值；IKB 蓝退役为默认）；`body.theme-dark --accent` `#5b7fe8` → **`#3fa08a`**（同色相提亮，深底对比 ≥4.5:1，`--accent-on: #0a0a0a` 不变）。`--annot-blue`（批注色板语义名，theme.css 三处）不动。② `.stage-bar` gap `var(--sp-2)` → **`var(--sp-4)`**（组间；两页同步，§3.2 已更新）。③ `.annot-toggle.bar-btn` `top` 48+`--sp-4` → **48+`--sp-3`**（上下两条带缘细线之间垂直居中）。④ `.extract-annot-rail .annot-side-head` margin-top `--sp-4` → **`--sp-3`**（与钮同 y 对齐）。⑤ `.prio-track` **144×40 → 140×20**（用户裁定「优先级滑块这一处单独还原成上一版」；数字框/标签维持 40 高/正色）。

**`src/components/ExtractCardFace.tsx`（ExtractActionsBar）**：`.extract-postpone`/`.extract-priority` 组内 gap `--sp-2` → **`--sp-1`**（组内贴紧成簇；组间由 stage-bar 的 sp-4 分隔）。其余零改动。

**`src/components/ExtractReviewView.tsx`**：① `annotOpen` 初始化改读 `sessionStorage.getItem("extract.annotOpen")`（缺省开），变更时写回——状态记忆跨换卡/跨查看态/跨两个摘录入口；② `annotPanelVisible` 恒为 true（轨与开关钮常驻，取代「≥1 条注解才出现」；查看态不藏轨；无批注时列表显示空列提示）；③ 新增 `jumpCrumbRoot` + `canJumpRoot`：「原文」根节点按 `onJumpToDoc`+`documentId` 在场渲染为按钮——锚优先当前卡自身 contextRef（anchorText/anchorRatio/cfi），子摘录回退链根摘录的锚，皆无 → flash「该摘录没有跳转位置数据（较早版本创建）」有界失败。

**accent 默认值联动（①的余波）**：`SettingsPanel.tsx` 色板兜底、`MindmapWorkspace.tsx`/`charts/swiss.tsx` 的 `v("--accent", …)` 兜底、`foliate/adapter.ts` 两处 color-mix 兜底 → `#166a59`；`tests/accent.gui.mjs` 恢复默认断言 → `#166a59`/`#3fa08a`。

**`tests/annotations.gui.mjs`**：头注释 ⑦ 描述同步（「无批注不出现」→「栏常驻」；该组原本只有正向断言，机械断言零改动）。

### 8.9 v9 修订改动清单（D76，2026-10-02）

**`src/theme.css`**：① `.stage-bar` gap `var(--sp-4)` → **`var(--sp-6)`**（组间 24）。② 新增 `.bar-cluster` 家族：盒（40 高、1px `--border-strong`、内距 `--sp-3`、gap `--sp-2`）+ `.bare-num`（无边框 mono/tabular 右对齐）+ `.unit`（Meta helper）+ `.text-btn`（无边框 13px、hover `--grey-1`、disabled 落灰）。③ `.bar-btn.primary`：描边式 → **填充式**（`background: var(--accent); border-color: var(--accent); color: var(--accent-on)`；hover `--accent-hover`；`.primary .kbd` 用 accent-on/75%；disabled 落灰）。④ 删零消费者规则 `.bar-group` 家族与 `.extract-postpone`/`.extract-priority` 专属块（D74 形态被 L1 盒取代）。

**`src/components/ExtractCardFace.tsx`（ExtractActionsBar）**：推迟、优先级两组改挂 `.bar-cluster`（盒内 `bare-num`/`unit`/`text-btn` 裸排，滑轨维持 140×20）；「推迟」钮由 `.bar-btn` 改盒内 `.text-btn`（disabled 语义保留）。JSX 其余与草稿/去抖逻辑零改动。

**`src/components/ReviewView.tsx`**：零改动（「显示答案」挂 `.bar-btn.primary` 自动获得填充式新形态；两页同步是 D76 契约的一部分）。

### 8.10 v10 修订改动清单（D77，2026-10-03）

**`src/theme.css`**：① `.stage-bar` gap `var(--sp-6)` → **`var(--sp-4)`**（按钮间距 = 距窗缘 = 距窗底 = 16px，全栏单一间距）。② 删 `.bar-btn .kbd` 与 `.bar-btn.primary .kbd` 两条规则（内嵌快捷键角标退役，零消费者）。

**`src/components/ExtractCardFace.tsx`**：「下一条」删内嵌 `<span class="kbd">空格</span>`（title 气泡已含快捷键说明）。

**`src/components/ReviewView.tsx`**：「显示答案」删内嵌 `<span class="kbd mono">{hint}</span>`；快捷键信息只走既有动态 title（`${hint || "未绑定"}，可在设置里改`，随键位设置变化）。

## 9. 可机械检查的验收清单

> 窗口档位：min 1120×640 与 1440×900 各验一遍。GUI 套件先 `npm run build`。

**A. 构建与静态**
1. `npm run build` 退出码 0。
2. `npx tsc --noEmit` 无错误（项目无 lint/typecheck 脚本；以此补 typecheck）。
3. diff 白名单：仅 `src/theme.css`、`src/components/ExtractReviewView.tsx`、`src/components/ReviewView.tsx`、`src/components/ExtractCardFace.tsx`；`electron/`、`src/lib/`、`tests/`、`AI_DEVELOPMENT_GUIDE.md` **零改动**。
4. diff 中新增的每个 `var(--x)` 都能在 theme.css 找到 `--x:` 声明（IACVT 审查，§5.1 配方）。

**B. 既有闸门零回归（六套件全绿、测试文件零改动）**
5. `node tests/extract.gui.mjs`、`node tests/breadcrumb.gui.mjs`、`node tests/m4.gui.mjs`、`node tests/m1.gui.mjs`、`node tests/m12.gui.mjs`、`node tests/flows/f60-key-command-matrix.cjs` 全绿。
   - **breadcrumb.gui.mjs 三条敏感断言在本方案下的机制保持说明**（供总控核对，非自创验收）：
     - L251：`.extract-page` 保持 `overflow-y:auto` 真滚动容器（§8.1-10），`scrollable`/`scrollTop` 真实可读；
     - L252：`.extract-page-head` computed `position:sticky` + `--paper` 不透明底由联合规则保持（§8.1-11），className 首 token 仍为 `extract-page-head`、内列首 token 为 `extract-page-head-inner`（§3.4 纪律）；
     - L253-254：`scrollIntoView({block:"center"})` 的 scrollport 与现状逐像素相同（同一滚动根、同样的吸顶头带/钉底栏覆盖几何）。

**C. 几何断言（DevTools Console 或 CDP，允许 ±1px 舍入）**
6. 缺陷 B：复习页翻到任一卡背面，`[...document.querySelectorAll('.review-bar .grade')].every(b => { const r = b.getBoundingClientRect(); return r.height === 40 && r.bottom <= window.innerHeight; })` ⇒ `true`；每钮 `.grade-due` 的 rect.bottom ≤ innerHeight；`getComputedStyle(document.querySelector('.review-bar .grade-row')).marginTop === '0px'`。
7. 缺陷 A：同一窗口尺寸下分别打开两页，取 `.review-bar` 与 `.extract-face-actions` 的 `getBoundingClientRect()`，`top/height/left/right/bottom` 五分量两两相等；`left === 0`、`right === window.innerWidth`、`bottom === window.innerHeight`；两栏 computed `position === 'sticky'` 且 `bottom === '0px'`。
8. 侧边栏不动底栏：摘录页有注解的卡上，点 `[data-annot-toggle]` 前后各取一次 `.extract-face-actions` rect，五分量逐一相等；且开合后 `document.querySelector('.extract-page')` 仍是唯一滚动容器（`.extract-face` computed `overflow-y === 'visible'`）。
9. 头带对齐：批注栏展开时，`.extract-page-head-inner` 与 `.extract-face` 的 `getBoundingClientRect().left` 相等；两页头带 computed `position === 'sticky'`、`backgroundColor` 非透明。

**D. 色值断言（缺陷 C）**
10. 对四档钮 `.grade-again/.grade-hard/.grade-good/.grade-easy`：`getComputedStyle(b, '::before').backgroundColor` 分别等于 `--error/--warning/--accent/--success` 的解析值（深浅两主题各验一次）。
11. 四钮 `getComputedStyle(b).backgroundColor` 全部相等且等于 `--grey-1` 解析值；`getComputedStyle(b).borderLeftColor === getComputedStyle(b).borderTopColor`（无 annot 覆写残留）。

**E. 排版不变量**
12. `.extract-page .extract-face-body` computed `font-size === '26px'`；`.review-wrap .extract-face-body`（合并复习推入摘录时）computed `font-size === '14px'`（D1 分界，extract.gui.mjs 已锁）。

**F. 动效**
13. 系统开「减少动效」时，`.review-face` 与 `.bar-pop` computed `animation-name === 'none'`；关闭时 computed `animation-duration === '120ms'`（卡面）/ `'150ms'`（弹层）。

## 10. 范围外

- FSRS 算法/参数、复习队列与 SessionQueueComposer、设置项语义与键名、Electron 主进程、IPC、表结构——零触碰。
- 不新增深色皮肤；不改 token 值；不新增 token（本方案零新增 token）。
- 不重构 CardFace 卡面内部排版、AnnotationPanel、SelectionMenu/Panels。
- 不删除已死样式（如 `.grade-row .btn`、`.review-tools`）——与本缺陷无关，另案处理。
- GUIDE 无需 bump：本方案是恢复 §5.3 既有评分色彩合同 + 纯布局修复，无契约变更、无 D 号新增（如执行中发现必须动合同文字，停下升级）。

## 11. 风险与备注

- `<CardFace key={current!.id}>` 补 key 会 remount 卡面：EditableText 的无框裸壳是命令式写 innerText（§5.4），remount 语义安全；翻面态 `showBack` 由父持有，不受 remount 影响。
- `.review-bar` 去 fixed 改 sticky 后，复习现场恢复（sessionStorage reviewSession）与「跳转原文往返」不受影响（纯渲染层几何）；m4.gui 对 `.review-bar`/`.bar-pop` 的查询按类名全局选择，DOM 位置上移一层不影响。
- sticky 底栏与 `elementFromPoint` 类命中测试无交集（栏在滚动口底，头带命中点在顶）。
- 截图 1/2（摘录页）未能核对：§2.5 的"布局不合理"清单来自源码机制；若执行阶段目测发现清单外问题，按本方案骨架归位即可，不另立方案。
