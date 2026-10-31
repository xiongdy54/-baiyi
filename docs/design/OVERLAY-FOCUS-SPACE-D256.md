# 全应用聚焦界面空间、外部关闭光标与图片工具栏（D256 / v49.89）

> 状态：用户已批准并完成 v49.89 / D256 实施；合同见 `AI_DEVELOPMENT_GUIDE.md` §5.4 / §7.3 / §8.1，验收见 §11。
>
> 范围纪律：先测试、一次只派一项、每项独立复核；不改 schema、IPC、设置键、卡片数据、FSRS、阅读内核或 AI 链路。

## 0. 用户原话与已确认约束

### 0.1 原始需求

> 『图片中是我正在使用的一款软件（qoder）当中，点击图片进入聚焦预览之后的界面。可以看到图片被尽可能的放大，以清晰展示图片内容，不浪费空间。同时可以看到图片右方有一个圆形的关闭按钮，那其实是鼠标指针在移动到聚焦显示的内容以外的区域时，鼠标会变成一个关闭按钮的样式，以提醒用户此时一点击就可以退出聚焦。这是一个很棒的设计，我要把它引入到我的软件当中。也就是说，我请你盘点软件当中所有聚焦行为，包括：1. 点击图片之后进行图片挖空的聚焦行为 2. 设置界面的打开设置面板之后的聚焦行为（这也算是一种聚焦行为）3. 其他我没有列出的所有聚焦行为。对这些聚焦行为做出下面的两点改进：1. 对设置面板以外的其他面板和图片内容，在打开聚焦之后要尽可能的利用可用空间，减少空间浪费。让图片更大，更可以有更大的空间进行展示，让内容展示的更清晰。2. 鼠标移动到聚焦内容以外的区域时，同样要把鼠标的指针样式切换成一个关闭按钮的样式，点击即可退出聚焦。3. 图片挖空和图片编辑的界面顶部工具栏或者按钮栏要复刻图中的顶部工具栏样式。请你先不要进行实际修改，先列出所有聚焦行为，然后简单说明你要怎么改，我确认后再动手。』

### 0.2 后续批准

- 『很多普通面板或者内容很少的面板，不需要强行扩展尺寸，只扩大到必要的高度和宽度即可，避免出现强行扩大后出现大量空白的情况。』
- 工具栏『形状不一定是圆角的，应该设计风格与我软件整体设计风格相适配，比如瑞士皮肤应该是直角，而陶土皮肤应该是圆角』。
- 关闭光标『形状不一定是圆形的，需要与我软件皮肤的整体设计风格相匹配。比如瑞士皮肤应该是直角，陶土皮肤应该是圆角』。
- 『开始实施吧，你提到的那个复习页“查看原图”的失效入口也一并修复』。

## 1. Goals / Non-Goals

### 1.1 Goals

1. 为全部现役模态与两个图片聚焦界面提供一致、可发现且不会误关的外部关闭交互。
2. 图片在真实可用区域内尽可能大，且缩放、裁剪、遮罩与指针坐标始终对齐。
3. 普通面板按内容需要分档；设置尺寸不变；少内容面板不被强行撑大。
4. 图片工具栏统一为紧凑顶部工具条，功能、顺序、键盘可达性和测试钩子不丢。
5. 瑞士直角、陶土圆角，明暗主题均可读；颜色、间距、圆角、动效使用 Token。
6. 修复复习页「查看原图」只切换状态却不渲染 Lightbox 的失效入口。

### 1.2 Non-Goals

- 不接回旧 `ImageFocus`，不恢复「正文图片 → ImageFocus」中间层。
- 不新建统一 React Modal 巨组件，不重写各面板业务状态，不统一改变所有面板尺寸。
- 不修改 `occlusion_json`、百分比坐标、图片资产、保存链、复习队列或评分行为。
- 不给非模态 dock、选区菜单、批注浮层、卡片详情侧栏或独立 BrowserWindow 加 backdrop 关闭。
- 不处理结构全景的节点 / 相机「聚焦」；那是图内导航，不是遮挡背景的聚焦层。
- 不新增网络资源、依赖、光标下载、AI 功能或设置项。

## 2. 现状证据与完整盘点

### 2.1 已核对的共享机制

- 14 类现役界面使用 `.modal-backdrop`（含 `ImageLightbox`），面板主要使用 `.modal-panel`；没有共享 React Modal。`OcclusionEditor` 是独立全屏层；`ManualCardEditor` 属退役 ImageFocus 链路，`InsightPanel` 依赖已撤除的日记页签，二者均无现役入口，不纳入。
- `src/lib/dialogA11y.ts` 维护嵌套面板栈，栈顶响应 Esc / Tab，并负责焦点进入与归还。
- `src/lib/useDismiss.ts` 只负责部分模态的两步出场；外部关闭必须继续调用各宿主既有 `requestClose` / `onClose`，不能绕过。
- `src/components/reader/ImageFocus.tsx` 无现役入口；正文图片直进 `OcclusionEditor`。
- `ImageLightbox` 在 `CardBrowser.tsx` 正常渲染；`ReviewView.tsx` 已导入组件、持有 `lightboxOpen` 并渲染按钮，但文件末尾没有对应 `<ImageLightbox>`。
- `OcclusionEditor` 使用独立全屏层、右栏、脏数据确认和逐级 Esc；SVG 与图片共享 `.occlusion-editor-imgbox`，指针通过 SVG 实际 `getBoundingClientRect()` 换算百分比。
- 皮肤运行时已有 `body.skin-<id>`、`html[data-skin]`、`body.theme-dark` 和 `@layer base, skin`；陶土已有 `--radius-popover:12px`，瑞士基线为 0。

### 2.2 14 类现役 backdrop 与独立编辑器

| # | 界面 / 文件 | 当前形态 | D256 尺寸处置 | 外部关闭 |
| --- | --- | --- | --- | --- |
| 1 | `SettingsPanel.tsx` | 980px，max 92vh | **完全不变** | 增加 |
| 2 | `ImportFilesModal.tsx` | 紧凑单列表单 | 紧凑档，不变 | 增加，保留 `requestClose` |
| 3 | `AnswerJudgeModal.tsx` | 单列题面、答案与判定 | 紧凑档，不变 | 增加 |
| 4 | `SelfExplainDialog.tsx` | 单列短输入 | 紧凑档，不变 | 增加 |
| 5 | `RegenCardsModal.tsx` | 多张草稿审查 | 内容宽档 720px，高随内容 | 增加 |
| 6 | `CardBrowser.tsx` 的 LeechWizard | 六步处理与多步内容 | 内容宽档 720px，高随内容 | 增加，嵌套栈不变 |
| 7 | `ContextReelDialog.tsx` | 多句上下文列表 | 内容宽档 720px，高随内容 | 增加 |
| 8 | `SentenceMineDialog.tsx` | 多句采掘列表 | 内容宽档 720px，高随内容 | 增加 |
| 9 | `PlacementDialog.tsx` | 多组词项 chip | 内容宽档 720px，高随内容 | 增加 |
| 10 | `UnitReaderDialog.tsx` | 长文阅读 | 阅读宽档 880px，高随内容 | 增加 |
| 11 | `TracksDialog.tsx` | 既有 `modal-panel-wide` | 既有宽面板，不变 | 增加 |
| 12 | `DisambiguateModal.tsx` | 既有 960px 双卡辨析 | 既有宽面板，不变 | 增加，保留其 `close()` |
| 13 | `PasteMaterialModal.tsx` | 已近满窗编辑器 | 不变 | 增加，保留 `requestClose` |
| 14 | `ImageLightbox.tsx` | 920px / 86vh 固定框 | 图片专用近满窗，见 §5 | 增加 |
| 独立 | `OcclusionEditor.tsx` | 独立全屏层 + 300px 右栏 | 主区真实盒内最大化，见 §6 | 增加，先过脏数据确认 |

### 2.3 明确排除的「聚焦」词义

- `AnnotationEditor` / `SelectionMenu`：局部浮层，不是模态 backdrop。
- CardBrowser 详情侧栏、CardDock、AI dock：非模态停靠面板，不锁背景。
- 快速记录、制卡台：独立 BrowserWindow，没有主窗口外部空白可点。
- 结构全景的节点聚焦、阅读器目录定位、窗口聚焦：不是本需求的 overlay 关闭语义。
- 旧 ImageFocus：保留退役状态，本批不额外复活或删除。
- `ManualCardEditor`：旧 ImageFocus 链路的无入口弹窗；`InsightPanel`：日记页签已撤除（D159），当前无入口。二者不是现役聚焦行为。

## 3. 普通面板的内容型尺寸合同

### 3.1 四档规则

| 档位 | 宽度 | 高度 | 适用 |
| --- | --- | --- | --- |
| 紧凑 | 既有 480px；视口不足时沿用现有 max-width | 内容高，max 80vh | ImportFiles、AnswerJudge、SelfExplain |
| 内容宽 | `min(720px, calc(100vw - var(--sp-16)))` | **只写 max-height**，`calc(100vh - var(--sp-16))`；不得写 height / min-height 撑满 | Regen、Leech、ContextReel、SentenceMine、Placement（5 个） |
| 阅读宽 | `min(880px, calc(100vw - var(--sp-16)))` | 同内容宽 | UnitReader |
| 既有宽 / 特殊 | 保持现状 | 保持现状 | Settings、Tracks、Disambiguate、Paste |

实施使用显式修饰类（如 `modal-panel-content` / `modal-panel-reading`），不得直接把所有 `.modal-panel` 改成 720 / 880 / 100vw。滚动仍落在 `.modal-scroll`，header / footer 不随正文滚走。

### 3.2 反强行扩张验收

- 紧凑三面板在相同夹具下打开前后几何与基线一致。
- 设置面板宽、高、max-height、内部左右栏几何不变。
- 内容宽 / 阅读宽只增加宽度与可用 max-height，不出现固定高度；空结果、单条结果时面板高度等于内容需要，不留下近一屏空白。
- 960px 宽视口下所有面板仍在视口内；窄屏只收缩，不产生横向页面滚动。

## 4. 共享外部关闭与皮肤光标

### 4.1 共享 hook，而不是逐面板复制事件

新增 `src/lib/overlayDismiss.ts`，提供 `useOverlayBackdrop`。输入为面板 ref、`onRequestClose` 与可选 `isBlank` 谓词，输出 backdrop 的 `onPointerDown` / `onPointerUp` / `onPointerCancel`；各宿主把原来的 backdrop `onClick` / `onMouseDown` 关闭替换为该 hook。面板上的既有 `stopPropagation` 可保留，但不再依赖它判定关闭。

`dialogA11y.ts` 导出只读的 `isDialogStackTop(panel)`，复用现有 `stack`，禁止另建第二套 dialog 栈。hook 关闭前必须确认面板为栈顶。

状态机：

1. `pointerdown`：仅接受 primary、左键、`isBlank(target, currentTarget)`、栈顶；满足时记录 `pointerId`，否则清空。
2. `pointerup`：仅当 pointerId 相同，且本次 `isBlank(...)`、仍是栈顶，才调用一次 `onRequestClose`；随后无条件清空。
3. 外部按下 → 内容抬起、内容按下 → 外部抬起、外部拖出窗口、pointercancel、非左键、非栈顶均不关闭。
4. 不用 backdrop pointer capture 伪造抬起命中；不以 `click` 再关闭一次。
5. 已使用 `useDismiss` 的宿主传 `requestClose`，其余传原 `onClose` / `onCancel` / `close`；不跳过出场、确认或宿主清理。
6. 普通面板默认 `target === currentTarget`；图片 Lightbox 把 `.image-lightbox-stage`、挖空编辑器把 `.occlusion-editor-main / .occlusion-editor-stage` 也纳入空白命中，图片盒、工具条与右栏不纳入。

### 4.2 光标 Token 与真实空白

backdrop 与图片 stage 空白使用 `cursor: var(--overlay-close-cursor)`；`.modal-panel`、`.image-lightbox`、`.image-lightbox-occlusion`、`.occlusion-editor-imgbox`、`.occlusion-editor-rail` 恢复 `cursor: default`，按钮、输入、SVG 画布的既有 cursor 继续覆盖。普通模态只有真实 backdrop 显示关闭光标；图片界面则是图片外的 stage letterbox 可关闭，图片本体与工具条不显示关闭光标。

新增组件 Token `--overlay-close-cursor`，声明在 `body`，值包含本地 SVG data URI、中心 hotspot `16 16` 与回退 `pointer`。默认瑞士为直角方形；陶土在既有 `body.skin-claude` / `body.skin-claude.theme-dark` 中覆盖为圆角矩形。固定覆盖层配色 `--overlay-text` / `--overlay-ink` 明暗不反转，因此深浅两档使用同一图形配色，但 `body.theme-dark` 与陶土深色块要显式重声明同一 Token，遵守 A4 与求值层纪律。

默认可实施值：

```css
body {
  --overlay-close-cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M1 1H31V31H1Z' fill='%23f5f5f2' stroke='%230a0a0a'/%3E%3Cpath d='M10 10L22 22M22 10L10 22' stroke='%230a0a0a' stroke-width='2'/%3E%3C/svg%3E") 16 16, pointer;
}
```

陶土覆盖值：

```css
body.skin-claude {
  --overlay-close-cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Crect x='1' y='1' width='30' height='30' rx='8' fill='%23f5f5f2' stroke='%230a0a0a'/%3E%3Cpath d='M10 10L22 22M22 10L10 22' stroke='%230a0a0a' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, pointer;
}
```

约束：

- 外部 SVG 光标不能读取宿主 CSS `var()`；禁止在 data URI 内写 `var(--overlay-text)` 假装会随主题求值。颜色与形状封装在组件 Token 内，皮肤覆盖整枚 Token。
- 不新增运行时 SVG 生成器、MutationObserver 或全局 JS 光标跟随层；直接使用仓库已支持的 CSS 变量 + SkinHost 层叠。
- 光标无动画；data URI 无网络请求；加载失败仍有 `pointer` 回退。
- 若未来皮肤改变固定 overlay 配色，必须同时提供该皮肤明暗两档光标 Token，不能只改一档。

## 5. ImageLightbox：真实可用盒、缩放与工具栏

### 5.1 布局

- backdrop 内边距使用 Token，Lightbox 变为近满窗 flex 列：`width / max-width` 与 `height / max-height` 只受视口 gutter 限制，不再锁 920px / 900px。backdrop 使用不透明 `var(--paper)`，避免背后应用文字穿透打扰聚焦。
- 顶部工具栏占据自身内容高度；下方 `.image-lightbox-stage` `flex:1; min-height:0`，工具栏高度自然从图片可用高度扣除。
- 图片初始 contain 在整个 stage 内容盒内，允许小图按 contain 放大；不裁切、不拉伸、不改变宽高比。
- stage 保留滚动语义；stage 内 letterbox 是「图片外空白」，显示关闭光标并可双命中关闭；图片盒本身不关闭。

### 5.2 共享几何函数

新增 `src/lib/imageFit.mjs` + `.d.mts`，纯函数输入：

```ts
fitImage(naturalW, naturalH, availableW, availableH, zoom = 1)
  => { fitScale, width, height }
```

公式：

```text
fitScale = min(availableW / naturalW, availableH / naturalH)
width    = naturalW × fitScale × zoom
height   = naturalH × fitScale × zoom
```

自然尺寸、可用尺寸非有限或 ≤0 时返回零尺寸，不渲染放大盒；图片 decode 后再计算。`zoom` 必须 >0，调用方继续把 Lightbox 用户缩放钳制在既有 0.4–4。

Lightbox 的 availableW/H 是 stage `clientWidth / clientHeight` 减去 computed padding；工具栏已在 flex 外扣除。自然图加载与 `ResizeObserver(stage)` 时重算 fit；用户 zoom 保持，resize 不擅自重置。显示的 100% 表示「适应当前可用区域」，+ / − / 滚轮步进和 0.4–4 范围不变。

### 5.3 遮罩对齐不变量

- 不再只对 `.occlusion-stage` 做 CSS `transform:scale()` 而让滚动布局仍停留在未缩放尺寸。
- 对共享 `.occlusion-stage.image-lightbox-occlusion` 显式设置几何函数返回的 width / height；内部 `<img>` 与 `OcclusionShapes` 的 SVG 都是该盒的 100% × 100%，SVG 绝对 `inset:0`。
- `rects / shapes / regionScope / cardOrd` 原样传入，不经过第二次缩放或坐标转换；viewBox 仍为 0–100。
- 放大超出 stage 时由 stage 滚动；缩小时水平、垂直居中。任何 zoom / resize 下图片任一点与同一百分比遮罩点误差 ≤2px。

### 5.4 工具栏只换表现

保留标题「原图」、遮挡显隐（有 rects 时）、缩小、百分比、放大、关闭及原 DOM 顺序。新增共享表现类 `image-overlay-toolbar`，与现有 `image-lightbox-bar` 并存；顶部居中、单行、紧凑分组、`--surface-overlay`、hairline、`--shadow-popover`、`--radius-popover`。按钮仍用既有类与 aria-label，不新增或删除功能。

## 6. OcclusionEditor：主区扩容、工具栏与安全链

### 6.1 可用空间

- 保留全屏层、300px 右栏及主区对右栏的避让；不得通过盖图或取消右栏换取大图。图层底色使用不透明 `var(--paper)`，让背景应用文字退出焦点。
- availableW 取 `.occlusion-editor-stage` 实际内容宽；availableH 取 stage 实际高，减去 alt caption 实高与 gap。toolbar 在 flex 流外自然扣除；stage 与 caption 用 `ResizeObserver` 重算。
- 图片 onLoad 后使用同一 `fitImage(naturalW,naturalH,availableW,availableH,1)`，替换 `100vw-400px / 100vh-170px` 的估算及小图 480 / 4 倍特例。
- 图片和 `.occlusion-editor-canvas` 继续共用 `.occlusion-editor-imgbox` 的显式最终尺寸；既有 `ResizeObserver(imgBox)`、`toPct()`、像素命中、viewBox 0–100 与 `vector-effect:non-scaling-stroke` 不改。
- 裁剪产生新图后由新 natural size 重算；`remapMasks`、撤销清栈和资产保存不变。FLIP 只作用于进入时整个 stage，不作为日常尺寸 / 坐标真源。

### 6.2 工具栏

保留矩形 / 椭圆 / 多边形、裁剪及裁剪应用 / 取消、AI 挖空、撤销、清空、创建卡片、右栏、独立关闭钮和全部 `data-testid`。工具栏增加 `image-overlay-toolbar`，与 `.occlusion-editor-toolbar` 并存，消费 `--radius-popover`；瑞士直角、陶土圆角。维持 D98 的单行 nowrap；窄窗在主区内横向滚动工具条，不换行、不藏功能、不覆盖右栏。

### 6.3 外部关闭与 Esc / dialog 栈

- 外部关闭调用与现有右上关闭钮相同的 `dirty ? setConfirmOpen(true) : onClose()`；不得直接卸载。
- 确认条「继续编辑 / 丢弃并关闭」原样保留；保存失败仍保持编辑器与遮罩。
- 编辑器面板注册进现有 `useDialogA11y` 栈，以获得栈顶判定、焦点圈定与焦点归还。为该 hook 增加默认行为不变的 `escape:false` 选项，编辑器继续使用自己的 Esc 链，禁止两个 Esc 处理器重复关闭。
- 编辑器自有 Esc 处理前先检查 `isDialogStackTop`；非栈顶不处理。顺序严格保持：**裁剪草稿 → 裁剪框 → 裁剪模式 → 多边形草稿 → 关闭确认 → 脏数据确认 / 关闭**。
- 画布按下后在外部抬起由共享双命中规则天然不关闭；不得中断既有 window 级拖拽 move/up。

## 7. ReviewView 最小修复

只在 `ReviewView.tsx` 现有 `judgeOpen` / `disamb` 渲染区旁补同 CardBrowser 的渲染块：

- 条件：`lightboxOpen && current?.cardType === "imageOcclusion" && current.occlusionJson`。
- 传入当前卡的 `assetPath / rects / shapes / regionScope / cardOrd`。
- `onClose={() => setLightboxOpen(false)}`。
- 复用已存在的 import 与 state；不新增 state、effect、IPC、复习推进、评分、预取或数据重写。

验收：点击「查看原图」出现 `.image-lightbox`，图片 src 与当前卡资产一致；Esc、关闭钮、双空白外部点击均关闭；打开 / 关闭前后 current card id、showBack、队列计数和 `review_logs` 不变；焦点回到「查看原图」按钮。

## 8. 测试与实机验收

### 8.1 测试先行

T1 只新增 / 扩充测试并记录预期失败，生产代码仍为空实现或现状。所有新测试文件第 1 行写 `@runtime`；GUI 使用 `fs.mkdtempSync` / `M7_TEST_USERDATA` 隔离，不接触真实 userData。

| 套件 | 必须有的失败判据 |
| --- | --- |
| `tests/overlay-focus.test.cjs`（纯 node） | fit 公式四种图型 / 非法尺寸 / zoom；双命中四种组合；pointercancel；嵌套；自定义 stage 空白命中 |
| `tests/overlay-focus.gui.mjs`（GUI） | 复习页原图真实打开；Lightbox 近满窗 / contain / 工具栏 / 遮罩对齐 / 960×640；stage 光标与双命中；设置尺寸不变；紧凑不撑大；内容面板 720 但不撑高；瑞士 / 陶土工具栏与光标 |
| `tests/occlusion-editor.gui.mjs` 扩充 | 扩容后三形状坐标仍正确；stage 双空白无脏才直关；有脏先确认；裁剪 / 多边形 Esc 顺序与既有保存链不回归 |

### 8.2 每项机械命令

```bash
npm run build
node scripts/run-tests.mjs overlay-focus
node tests/overlay-focus.gui.mjs
node tests/occlusion-editor.gui.mjs
node scripts/run-tests.mjs m5
node tests/reader.engine.mjs
node tests/d99-review.gui.mjs
node scripts/i18n-check.mjs
node scripts/skin-audit.mjs
node scripts/consistency-check.mjs
npx tsc --noEmit
```

统一入口只发现 `*.test.cjs`；`.gui.mjs` 与 `reader.engine.mjs` 必须先 build 后直接运行。最终再跑 `node scripts/run-tests.mjs`，与 main 基线比较，不新增红项。

### 8.3 实机视觉矩阵

在 1600×1000、1280×800、960×640 三档视口下检查（`tests/overlay-focus.gui.mjs` 已用 CDP 视口覆写断言三档不出界）：

1. 瑞士 / 陶土 × 浅色 / 深色：关闭光标形状、对比度、hotspot 与工具栏圆角一致；切肤后无旧光标残留。
2. 横图 2400×800、竖图 800×2400、小图 120×80：初始尽可能大且不裁切；工具栏不盖图；遮罩始终贴合。
3. 设置与少内容面板没有新增大块空白；内容型面板长文更易读，单条内容不撑满。
4. 挖空编辑器右栏不盖图；裁剪、三形状、拖动手柄、放大镜徽章与橡皮筋对齐；动效关闭时不播新动画。
5. 复习页打开原图不推进复习，关闭后键盘评分与当前卡状态正常。
6. 测试截图与临时数据全部清理；主流程重启不丢数据，本批本不应产生任何数据差异。

## 9. 任务拆解表（严格一次一项）

> 每项完成后由独立审查角色复核；不合格只转派该项必须修复内容，不并项。除 T1 外，每项先运行对应失败测试证明有牙齿，再实施至全绿。

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T1 | 建立全部失败回归测试与隔离夹具；记录当前失败原因，不写生产实现 | test-engineer | 新建 `tests/overlay-focus.test.cjs`、`tests/overlay-focus.gui.mjs`；扩充 `tests/occlusion-editor.gui.mjs` | 新文件首行 runtime 合法；分别因缺少 fit / 关闭 hook / 分档 / Review 渲染而失败；测试无真实 userData 路径 | 无 |
| T2 | 共享 backdrop 双命中 hook、现有 dialog 栈只读顶判定、光标 Token 与全部 14 类现役 backdrop 接线；保留各宿主原 close | frontend-builder（核心交互后由核心审查复核） | 新建 `src/lib/overlayDismiss.ts`；`src/lib/dialogA11y.ts`、`src/theme.css`、`src/skins/claude/claude.css`；§2.2 的 14 个宿主组件 | `overlay-focus` 全绿；四种指针组合无误关；嵌套只关栈顶；`skin-audit` 0；无 backdrop 旧 click/mousedown 关闭双路径；typecheck 0 | T1 |
| T3 | 普通面板按 §3 分档，设置 / 紧凑 / 既有宽 / Paste 不改尺寸 | frontend-builder | `src/theme.css`；RegenCardsModal、CardBrowser、ContextReel、SentenceMine、Placement、UnitReader 的 panel class | `overlay-focus.gui` 全绿；Settings 几何差 0；紧凑几何差 0；内容面板无固定 height / min-height 撑满；build 0 | T2 |
| T4 | 共享 fit 纯函数与 ImageLightbox 近满窗、显式缩放盒、滚动和工具栏表现 | frontend-builder | 新建 `src/lib/imageFit.mjs` / `.d.mts`；`src/components/ImageLightbox.tsx`、`src/theme.css` | `overlay-focus` 与 `overlay-focus.gui` 全绿；960×640 与三图型遮罩误差 ≤2px；既有工具按钮均存在；typecheck / build 0 | T3 |
| T5 | OcclusionEditor 用真实主区 fit，接共享工具栏表现、栈顶 guard、stage 双空白外部脏数据确认；Esc 与拖拽链不变 | core-engineer | `src/components/editor/OcclusionEditor.tsx`、`src/theme.css`、`src/lib/dialogA11y.ts`（仅 escape:false 选项若 T2 未带） | `occlusion-editor` 27/27；`reader.engine` / `m5` 全绿；右栏不盖图；保存失败不丢遮罩；typecheck / build 0 | T4 |
| T6 | ReviewView 按 §7 补最小 ImageLightbox 渲染，不加业务逻辑 | bug-fixer | `src/components/ReviewView.tsx` | `overlay-focus.gui` 原图入口全绿；diff 仅一个条件渲染块（允许格式化零变化）；`d99-review` 全绿；复习数据零写入 | T5 |
| T7 | 全量回归与实机视觉矩阵，清理截图和临时数据；把实测结果追加到本稿验收记录 | frontend-builder + 实机验证角色 | 全部涉及文件、本设计稿；测试临时目录 | §8.2 全命令通过或与 main 红集完全一致；§8.3 六组逐项有结果；全量测试不新增红；临时文件清理；`git diff -- package.json electron src/lib/occlusion.ts` 为空 | T6 |
| T8 | 独立终审：对照 D256、GUIDE 不变量、diff 范围、测试证据与实机图，只做审查不扩大实现 | independent-reviewer | 全部 diff 与本设计稿 | 验收结论明确「合格 / 不合格」；核对零 schema / IPC / 设置键 / 数据契约变化，旧 ImageFocus 未接回，设置未扩张，三项安全链均有测试；不合格仅列必须修复项 | T7 |

## 10. 实施者最易误做之处（预审红线）

1. **把「外部点击」继续写成 onClick**：只看抬起目标会让内容内按下、外部抬起时误关，尤其破坏画布拖拽；必须双端真实空白 + 同 pointer + 栈顶。
2. **只放大 `<img>` 或继续 transform 缩放而不改布局盒**：会造成 SVG 遮罩、滚动范围与指针坐标分离；图片和 SVG 必须共享显式最终宽高。
3. **全局把 `.modal-panel` 改为近满窗，或给所有面板 height:90vh**：违反用户补充约束；设置必须不变，少内容面板必须保持紧凑。

## 11. 验收记录

验证日期 2026-10-31，分支 `feat/overlay-focus-space`（v49.89 / D256）。

### 11.1 自动验证

| 命令 / 套件 | 结果 |
| --- | --- |
| `npm run build` | ✓ |
| `npx tsc --noEmit` | 0 |
| `node scripts/i18n-check.mjs` | ✓ |
| `node scripts/skin-audit.mjs` | ✓ |
| `node scripts/consistency-check.mjs` | ✓ |
| `node scripts/run-tests.mjs overlay-focus` | 12 / 0 |
| `node tests/overlay-focus.gui.mjs` | 26 / 0 |
| `node tests/occlusion-editor.gui.mjs` | 31 / 31（原 27 + 新增 4） |
| `node tests/d99-review.gui.mjs` | 17 / 17 |
| `node tests/reader.engine.mjs` | 13 / 17；干净快照（D254 合并提交）同项 13 / 17，失败集完全一致：2b / 4b / 4h / 后续级联异常；D98 图片段 4c–4e 全过 |
| `node tests/flows/f11-doc-code-drift.cjs` | 14 / 16；L1（既有 `src/lib/readerActionsSettings.ts` 路径漂移）与 L6（既有 §4.1 表计数漂移）为基线上同样的两项红；D256 版本/决策号/测试头全绿 |
| `node scripts/run-tests.mjs --timeout=300` | 155 项：153 通过 / 2 失败；仅 `applog`（环境缺失启动期崩溃日志）与 `d242-reader-inertia` G1（既有环境红），其余全绿 |

`overlay-focus.gui.mjs` 覆盖：复习页原图真实打开；近满窗 contain；图片与遮罩同盒（≤2px）；缩放布局盒；1600×1000 / 1280×800 / 960×640 三档不出界；文字/图片双层光标区分；外部双命中；混向拖拽不误关；Esc 焦点归还；设置 980 上限不变；紧凑面板不撑大；内容面板 720 但不撑高；瑞士直角 / 陶土圆角与明暗档。

### 11.2 视觉与实机条件

- 截图矩阵：瑞士浅色 1600/1280/960；陶土浅色；陶土深色；瑞士深色。Lightbox 近满窗、工具栏居中、图片不裁切；挖空编辑器工具栏与关闭钮同条、右栏保留、图片按主区真实宽度放大。
- 本机原生 DPR 2.5；`Emulation` 另以 DPR 1 跑三档视口。所有 GUI 测试使用独立 `M7_TEST_USERDATA` / 临时目录，未触碰真实数据目录。
- **未在第二台物理机验证**；已排除硬编码宿主路径与外网依赖，关闭光标为内联 data URI，异机迁移无额外资源。
- 离屏 CDP 截图会因旧合成面缓存偶现页码残影；UI 不透明度由 `getComputedStyle(backgroundColor)` 为不透明 `rgb(...)` 断言，不依赖截图主观判读。

### 11.3 遗留与边界

- 本批未新增业务逻辑、schema、IPC、设置键或数据契约；旧 ImageFocus / ManualCardEditor / 无入口 InsightPanel 均未接回。
- 独立子代理终审因额度限制未能执行；由主控完成机械核对与实机验证，缺少第三方独立语义复核。
- 未做第二台物理机验收，后续发布前仍建议补一次异机 GUI 冒烟。
