# 手动图片挖空编辑器 · 设计方案（D98 / v48.57）

> **登记状态（2026-10-06）**：本稿自项目外预览稿（用户会话产出，含可交互示例 HTML）收编入库。
> 决策号 **D98**、版本 **v48.57**，见 `AI_DEVELOPMENT_GUIDE.md` §8.1；用户原话逐字见 §0。
> 实施批次（P0）：OcclusionEditor 组件 + 图片聚焦工具条入口改「挖空编辑」+ 落库链 + GUI 测试。
> 编辑器内「AI 挖空建议层」与 CardBrowser「编辑区域」预载为 P1；「预览复习」钮为 P1。
> 用户实测修正：示例中动作按钮窄幅文字竖排——实施一律 `white-space: nowrap` 禁换行（§7 gesture-responses）。

# 手动图片挖空编辑器 · 设计方案（预览稿）

> 状态：**设计预览稿**——本文件当前位于仓库外（本次会话约定只读仓库、不改项目）。实施时将本稿移入
> `docs/design/IMAGE-OCCLUSION-MANUAL-EDITOR.md`，并在 `AI_DEVELOPMENT_GUIDE.md` §8.1 登记决策号
> （撰写时 D96 已被 `app.readerActionsFloat` 占用，预计取 **D97**，以实施当日 §8.1 登记为准），
> 同时 bump 版本号（先文档后编码，硬不变量 3）。
> 配套可交互示例：同目录 `图片挖空-完整示例.html`。

## §0 用户原话

> 「我想优化并完善软件中的图片挖空功能，并优化图片挖空的界面操作界面。在功能上，我希望以手动挖空为主，
> 因为挖空很简单，手动框几个遮罩就可以来，但是请仍然保留AI挖空的功能。现在还没有实现手动挖空的功能，
> 请帮我设计规划好实现方法。挖空的界面请先在 dylantarre/animation-principles 这个GitHub仓库里寻找
> 相关的skill来作为设计指导，做出完整实现后的示例HTML给我看」

## §1 现状盘点（事实，file:line）

### 1.1 已有的挖空基础设施（比预期完整）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 几何库（完整） | `src/lib/occlusion.ts` | 矩形/椭圆/多边形三类形状；坐标契约＝相对图片百分比 0-100；`shapeBBox / isShapeUsable / normalizeShape / pxShapeToPct / shapeToSvg / shapesFromRects` 全部就绪 |
| 落库字段 | `cards.occlusion_json`（GUIDE §4） | `{rects:[{x,y,w,h,ord}], assetPath, shapes?, regionScope?}`；rects 恒为形状包围盒（L11 兼容层），shapes 为精确轮廓。**已支持多形状，无 schema 缺口** |
| 卡型 | `cardType:"imageOcclusion"` + `cardOrd` + `siblingKey:"img:<assetPath>"` | 同图多卡互为同源（D26/v34 §4.16） |
| 复习渲染 | `src/components/CardBrowser.tsx:1443`（CardFace） | 正面＝原图+遮挡块（`OcclusionShapes`，考察区 accent、其余 ink 仅 `regionScope:"shared"` 时）；背面＝原图无遮挡+题面+答案；`查看原图` lightbox；3D 翻卡（D88 §7.3） |
| 遮挡渲染组件 | `src/components/OcclusionShapes.tsx` | 复习端 + AI 确认面板共用；`variant:"card"|"proposal"`；v30 默认「每卡自带全 accent，同遮同答」 |
| 图片聚焦选区 | `src/components/reader/ImageFocus.tsx`（v25） | 点图上浮聚焦；矩形/椭圆/多边形**单个**选区；FLIP 飞入；`AI 制卡`/`手动制卡` 双按钮 |
| AI 挖空·资源库入口 | `src/lib/useSelectionActions.ts:582 runOcclusionCards` | 顶栏「图片挖空」→ 文件选图（`electron/main.js:663 pickOcclusionImage`）→ GLM 多模态 → 草稿进 AIPanel（occlusion 页签，D92 归 AI 制卡页）→ 逐张接受 |
| AI 挖空·选区入口 | `src/lib/cards.ts:466 generateOcclusionCards`（D26 选区即画布） | 用户手绘区域裁剪图 → 模型在裁剪图内出区域 → 映射回全图；含 D25 回退单卡 |
| AI 接受链 | `useSelectionActions.ts:641 acceptOcclusionDraft` | lint → `cardsApi.create`（generatedBy:"ai"） |
| 手动挖空（弱雏形） | `useSelectionActions.ts:362 handleManualCard` imageOcclusion 分支 | ImageFocus 单选区 → `ManualCardEditor` modal 的「图片挖空」页签（`ManualCardEditor.tsx:206-231`）→ 填问答文本 → **单形状单卡**落库 |
| 编辑器 CSS | `src/theme.css:3132-3353` | `occlusion-stage/-exam/-hidden/-proposal/drafts/rubber/vertex/ord` + `image-focus-*` 全套 |

### 1.2 关键历史决策

- **D16**（v15）：图片挖空＝GLM 多模态识别，**「不做手动遮挡编辑器」**——本方案即推翻该子决策的立项依据（AI 保留、手动为主）。
- **D26**（v29）：选区即画布（裁剪坐标→全图坐标映射公式）。
- **D28**（v30）：卡面双面化，题面正反面都显示。
- **v30 用户拍板**：遮挡呈现默认「每卡自带、全 accent、同遮同答」；`regionScope:"shared"`（全图区域共享、cardOrd 单区 accent 其余 ink）仅存量 v1 链路保留。
- **D88 §8.2 / D92**：图片挖空手动编辑**维持 modal 不入学习坞**（大图预览需要幅面）——新编辑器沿用该形态。
- D96（v48.55）：阅读器动作组悬浮键（`app.readerActionsFloat`）——「图片挖空」钮是动作组八钮之一，入口呈现可能随该键变化，编辑器不受影响。

### 1.3 缺口（=本方案范围）

1. **无多遮罩手动编辑器**：现有手动路径只能「画 1 个形状 + 填问答文本」，不能框多块、不能移动/缩放/删除/撤销、没有区域列表、没有逐块答案、没有拆卡模式选择。
2. **AI 与手动割裂**：AI 结果只能「逐张接受/拒绝」，不能把 AI 区域当作可编辑形状继续手动调整。
3. **无编辑已有挖空卡**：CardBrowser 的 onEdit 只能改文本，不能改遮挡区域。

## §3 产品设计（交互规格）

### 3.1 形态与入口

- 新组件 **`OcclusionEditor`**（全屏 modal，层级同 `image-focus-layer`，D88/D92「不入坞」语义不变）。
- 入口（收敛后）：
  1. 阅读中点图 → `ImageFocus` 聚焦 → 工具条主按钮改为 **「挖空编辑」**（携带已画形状作首块遮罩进入编辑器）；「AI 制卡」保留旧链路不动（P0 不回归）。
  2. 顶栏/摘录工具栏「图片挖空」钮 → 选图（资源库路径 `pickOcclusionImage`）→ **先进编辑器**（手动为主），编辑器内有「AI 挖空」按钮。（P1 落地；P0 该入口仍走 AIPanel 旧链路，避免一次改两处。）
  3. CardBrowser 挖空卡「编辑区域」→ 编辑器预载 `occlusion_json`（**P1**）。

### 3.2 编辑器布局（详见示例 HTML）

```
┌ 悬浮工具条（顶部居中，同 image-focus-toolbar 语言）──────────────────┐
│ [矩形][椭圆][多边形]  提示文案…        [AI 挖空] [撤销] [清空] │ [预览复习] [创建 N 张卡片] │
└──────────────────────────────────────────────────────────────┘
┌ 画布（居中，图上浮+聚焦模糊背景，FLIP 飞入）┐ ┌ 右栏 300px ──────────┐
│  图片 + SVG 覆盖层（百分比契约）            │ │ 制卡模式 段控          │
│  · 空白处按下拖动 = 画新遮罩                │ │  逐块拆卡 / 整图一卡    │
│  · 点遮罩 = 选中；拖动 = 移动               │ │  ☑ 共遮呈现（其余 ink）│
│  · 8 手柄缩放；多边形拖顶点                 │ │ 题面（共享，默认文案）  │
│  · Del 删除；Ctrl+Z 撤销                   │ │ 区域列表（序号/形状/答案/删）│
│                                            │ │ 统计：N 块 → M 张      │
└────────────────────────────────────────────┘ └───────────────────────┘
```

- 交互细节：Esc＝先取消进行中的草稿 → 有未保存改动时弹确认条（非直接关闭）；序号徽标随遮罩；区域列表行点击＝选中并高亮，行为与画布选中双向同步。
- 小图放大、百分比与显示尺寸解耦（沿用 ImageFocus 的 480px 下限策略）。

### 3.3 制卡模式（零 schema 变更的落库映射）

| 编辑器选项 | 生成 | occlusion_json 写法（复用现有字段） |
| --- | --- | --- |
| 逐块拆卡（默认）· 每卡自带 | N 张卡，卡 i 正面只遮第 i 块（全 accent，同 v30 默认语义） | 卡 i：`shapes=[shape_i]`，`rects=[bbox_i]`，无 regionScope |
| 逐块拆卡 · 共遮呈现 | N 张卡，正面全图同遮、考察区 accent 其余 ink（Anki 风格） | 每卡：`shapes=全部`，`rects=全部包围盒`，`regionScope:"shared"`，`cardOrd=i` |
| 整图一卡 | 1 张卡，全部遮罩同遮同答 | `shapes=全部`，`rects=全部包围盒`，无 regionScope |

- 每卡背面答案＝对应区域 label（区域列表里填），空则「区域 n」；题面共享（默认「图中遮挡区域对应的是什么？」，非默认才显示，同 CardBrowser `hasFrontText` 判定）。
- 落库：沿用 `handleManualCard` → `createSingleCard/createManualCard` 链（含 lint），循环 N 张；`siblingKey:"img:<assetPath>"`（同图同源，同日埋葬规则自然生效）；图片资产经 `ensureImageAsset` 落 assets 表（kind=image-occlusion）。

### 3.4 AI 挖空保留并升级为「建议层」

- 编辑器内「AI 挖空」按钮：复用 `generateOcclusionCards`（提示词模板 `card-occlusion` 不变）；
  模型返回的 regions/shapes **作为可编辑遮罩导入当前编辑器**（追加，带序号与 label），用户可增删调，确认才落库——强化「AI 非事实源」（硬不变量 2）。
- 既有 AIPanel occlusion 确认面板链路 P0 全保留（零回归）；P2 评估是否统一入口。
- 看图问答（rects 空数组挂图）不在编辑器范围，走原路径。

## §4 代码落点（实施清单）

**新增**
- `src/components/editor/OcclusionEditor.tsx`——编辑器主体（modal、画布、交互引擎、区域列表、模式与题面、保存链）。
- `src/components/editor/OcclusionEditor.test-d.tsx` 不需要；GUI 测试 `tests/occlusion-editor.gui.mjs`（`@runtime electron`，跑前 `npm run build`）：画矩形/椭圆/多边形 → 移动缩放 → 删除/撤销 → 逐块拆卡 N 张落库断言 → 共遮呈现断言（复习正面 ink/accent 类名）→ AI 导入按钮 mock。

**修改**
- `src/components/reader/ImageFocus.tsx`：`手动制卡` → `挖空编辑`（提交类型扩展 `onSubmit("editor", payload)`；原单卡手动链 P1 再退役）。
- `src/lib/useSelectionActions.ts`：新增 `submitOcclusionEditor(payload)`（多形状批量落库，复用 createSingleCard）；`runOcclusionCards` P1 改为先开编辑器。
- `src/theme.css`：新增 `occlusion-editor-*` 段（选中描边/手柄/徽标/确认条），动画全部走既有 Token。
- `AI_DEVELOPMENT_GUIDE.md`：§6.3 图片挖空小节改写（手动为主 + AI 建议层）、§8.1 登记 D97、版本 bump；`docs/HISTORY.md` 批次条目。

**不动**（兼容层）
- `src/lib/occlusion.ts`、`OcclusionShapes.tsx`、`cards.occlusion_json`、复习端渲染、`ManualCardEditor` 图片挖空页签（P1 起仅由旧数据触达，P2 决定退役）。

## §5 分期

- **P0**：OcclusionEditor（画/选/移/缩/删/撤销/列表/模式/题面/保存）+ ImageFocus 入口改「挖空编辑」+ GUI 测试 + 文档四件套。
- **P0.5**：编辑器内「AI 挖空」导入建议层（流式进度复用 AIPanel 语言）。
- **P1**：资源库入口先进编辑器；CardBrowser「编辑区域」预载已有 occlusion_json；多边形整体 bbox 缩放。
- **P2**：旧手动单卡页签退役评估；AI 面板链路与编辑器统一评估；笔/套索等更多形状。

## §6 测试义务与验收

- `npm run build` 通过；`tests/occlusion-editor.gui.mjs` 通过；既有 `tests/m1.gui.mjs`（含挖空断言）与 flows 闸门（f11 文档集、f18 设置矩阵等）不回归。
- 验收线（§7.1.4）：主流程可演示——阅读 → 点图 → 挖空编辑 → 框 3 块 → 拆 3 卡 → 重启后复习正面遮挡/背面揭示正常；共遮卡正面「考察区 accent、其余 ink」。
- 不变量核对：纯本地（AI 可选）✓；AI 仅建议、用户确认落库 ✓；先文档后编码 ✓；渲染层数据流，无新写库通道 ✓。

## §7 动效规范（dylantarre/animation-principles 映射）

选型 skill：`05-by-animation-type/universal-patterns`（基线时长/缓动/降级）、`gesture-responses`（按压/拖拽）、
`state-changes`（选中/工具切换）、`entrance-animations`（编辑器与遮罩入场/FLIP/stagger）、
`micro-interactions`（画中草稿跟手）、`feedback-indicators`（保存/错误反馈）。
与 D88 已立的动效 Token 完全同源（theme.css 已注明「skill 原则 6/9」），**不新增 Token**：

| 交互 | skill 依据 | 实现 |
| --- | --- | --- |
| 按钮按压/释放 | gesture-responses | active 60ms scale(.97)；释放 250ms `--spring` 回弹 |
| 工具段控指示条 | state-changes | 200ms ease-in-out 滑移 |
| 画中草稿 | micro-interactions | 0 延迟跟手（transform 直写） |
| 遮罩落定 | follow-through/exaggeration（<10%） | pop 240ms `--spring`，scale .9→1.03→1 |
| 选中/手柄 | state-changes | 150ms ease-out scale-in |
| 删除退场 | universal-patterns（exit < enter 20-30%） | 120ms fade+scale |
| AI 批量导入 | entrance-animations（stagger 50ms，序列 ≤500ms） | 逐块延迟入场 |
| 编辑器开启 | entrance-animations（FLIP） | 图 240ms `--ease-out-soft` 飞入 + 背景 160ms 淡入（同 image-focus 现状） |
| 复习翻卡 | 项目既有 D88 §7.3 | `--dur-flip` 500ms 双面 3D |
| 换卡入场 | 项目既有 D88 | `--dur-stage` 240ms 方向性 |
| 保存对勾/toast | feedback-indicators | stroke 描边 400ms；toast 300ms 进 3s 自灭 |
| 降级 | universal-patterns 规则 3 | `prefers-reduced-motion` 全关 |

## §8 风险

- 多边形交互复杂度（顶点拖动/闭合判定）——直接移植 ImageFocus 已验证的语义，减新风险。
- N 卡批量落库的性能/原子性——N 通常 < 20，逐张 `cardsApi.create`（每张独立 persist）即可；不做事务新增。
- 与 D96 悬浮动作组入口的呈现叠加——编辑器是 modal，不受动作组呈现位置影响。

## 修订记录

### R1（2026-10-06 同日，用户实测五项反馈 + 两张截图）

用户逐字指令：

> 1. 操作逻辑变更：原设计：点击图片出现编辑区 -> 框选区域（此时是对原始图片裁剪）-> 点击"AI 制卡"或"手动制卡"才是挖空。新需求：点击图片出现编辑窗口后，默认直接框选区域进行挖空；同时增加一个"裁剪图片"按钮，来实现原设计中第一步的裁剪功能。
> 2. 裁剪区域显示问题：框选出裁剪区域后，整片区域显示为不透明的主题色，导致完全盖住框选内容，看不到自己框选区域的内容，请修改。
> 3. 侧边栏遮挡问题：弹出右侧侧边栏后，侧边栏直接盖住了图片的一部分，导致无法选择图片右侧被盖住的部分，请修改。
> 4. 顶部选框与侧边栏覆盖问题：编辑顶部的长方形选框和右侧侧边栏之间存在覆盖关系，请处理这两个模块之间的层级或布局问题，其中顶部的那个选框请完全重新设计，我希望它上面不要出现大量空白区域被浪费的地方。不需要"空白处按住拖动框出矩形……"这段说明文字，请把按钮全部放到同一行。
> 5. 我发现你并没有实现预览文件当中设计好的动效。

修订决议（全部映射 animation-principles 选型不变）：

1. **入口一步化**：图片聚焦中间层退役（组件保留待 P1 清理）；点击正文图片直进编辑器，默认框遮罩。裁剪收编为编辑器内「裁剪图片」按钮——拖框→外部压暗 + accent 描边预览（**修问题 2：预览永不实色填充**）→「应用裁剪」＝canvas 裁 dataUrl，已有遮罩按新空间重映射（完全越界丢弃、其余 clamp），撤销栈清空（跨空间撤销无意义）。
2. **AI 保留（P0.5 提前）**：编辑器工具条新增「AI 挖空」——`requestOcclusionResult`（cards.ts 抽取的共用装配段，generateOcclusionCards 同源同语义）直读建议，**零批次创建**；regions 以 60ms stagger 导入为可编辑遮罩（entrance-animations stagger ≤500ms），AI 仅建议、用户确认落库（硬不变量 2）。
3. **布局修复（修问题 3/4）**：主区 `right: 332px` 避让右栏（原 CSS 漏避让＝右栏盖图）；工具条改**随主区在流内定位**的单行紧凑条（width fit-content、flex nowrap、无提示文案），与右栏无覆盖可能；段控加滑移指示条（state-changes 200ms ease-in-out）。
4. **动效补齐（修问题 5）**：遮罩 pop-in（entrance + follow-through：240ms `--spring` scale .88→1.03→1，React keyed 挂载触发、拖拽/撤销不重放）；手柄 12ms 级联（state-changes 150ms ease-out，按 selId 重挂触发）；删除 140ms ghost 退场（universal-patterns：exit 比 enter 快 20-30%）；AI 建议 60ms stagger；段控滑移；`prefers-reduced-motion` 全降级。
5. 测试同步：reader.engine 4c–4g2 改写为直进流程；occlusion-editor.gui 增裁剪重映射与 AI stub 导入两组断言。

### R2（2026-10-06 同日第二轮，用户实测五项反馈 + 截图）

1. **手柄重做**：SVG viewBox="0 0 100 100" + preserveAspectRatio="none" 的非均匀缩放把 `r=1.4` 的圆手柄拉成大椭圆（宽图上约 30px）且造型难看。改为 **HTML 定尺寸直角点**（`.occl-dot`，9px、paper 底 + accent 边、首点实心 accent，`pointer-events:none` 纯视觉）——命中与拖拽仍走画布的像素级 `nearHandle`（8px），悬停光标由画布按命中方位给出（gesture-responses/state-changes 级联保留）。
2. **椭圆改角到角**：原「圆心向外拖」与用户心智不符；改与矩形同语义——最终形状＝拖动经过矩形区域的**内切椭圆**。
3. **多边形首段虚线**：跟随橡皮筋渲染条件 `poly.length >= 2` → `>= 1`，自第一个点起即有虚线跟随光标。
4. **撤销按「单次点击/操作」重建模**：快照从「仅遮罩列表」扩为「遮罩列表 + 多边形草稿点」——多边形**每次点击（含加点/闭合）入栈一次**、画新遮罩（抬手提交前）入栈、移动/缩放/顶点变化入栈、删除/清空/AI 导入入栈；撤销一次＝精确回退一次点击及其触发的默认事件（例如多边形第 1 点撤销＝草稿点消失）。跨裁剪空间撤销仍清栈。
5. **顶栏导航竖排修复**（App 顶栏，非编辑器）：书名过长时 flex 收缩量分摊到导航按钮（默认 flex-shrink），两字标签被压到 min-content 以下竖排。修＝`.topbar-nav`/`.nav-item`/`.topbar-right` 均 `flex:none; white-space:nowrap`，全部收缩落在标题（`.topbar-title` 已有 min-width:0 + ellipsis）。

### R3（2026-10-06 同日第三轮，用户实测四项反馈）

1. **手柄回归为小圆点**：R2 的 9px 直角方块点被用户判为不够「手柄」且多边形起点不可辨。改 `.occl-dot`＝**9px 圆点**（paper 底 + accent 边，用户指定圆点、评分色点同族）；多边形**起点放大 12px 实心 accent + paper 内边 + accent 外圈**——闭合目标始终可辨。
2. **右键闭环**：≥3 点时画布**右键**＝从当前点直连初始点收口（`onContextMenu` preventDefault；与「点回起点」共用 `closePolygonDraft`，撤销语义一致）；起点悬停 12px 内光标转 pointer 提示可闭合。
3. **跟随虚线过粗根因**：橡皮筋 `<line>` 漏了 `vector-effect="non-scaling-stroke"`——非均匀缩放把 2px 放大到约 19px 粗虚线；补上后与草稿实线段（2px）同粗。

### R4（2026-10-06 同日第四轮，用户实测一项）

**多边形草稿段虚线消失**：点到第 3 个点后，草稿以实线形状（`.occlusion-editor-mask.drafting`）渲染，1→2 段的虚线观感被实线替代。修＝草稿阶段**所有段**（1→2、2→3……）统一按与跟随橡皮筋同规格的细虚线逐段渲染（`.occlusion-rubber` + non-scaling-stroke），闭合后才转实线遮罩——「虚线=未闭合、实线=已闭合」状态语义一致。测试补 C4a（3 点时 2 段连线 + 1 条跟随线）与 C4（右键闭环后虚线清空）断言。

### R5（2026-10-06 同日第五轮，用户实测两项）

1. **多边形工具点已有遮罩误起新草稿**：多边形分支此前任何点击都变为「加草稿点」，已闭合的遮罩无法选中调整。修＝草稿未开始（`polyRef` 为空）时点击走与矩形/椭圆相同的命中链（顶点手柄→缩放/顶点编辑、遮罩内部→选中拖动），点空白才起笔；草稿进行中点击仍为加点（可穿过已有遮罩）。
2. **矩形/椭圆拖动「挪一点就冻结」**：三个叠加根因——①拖拽依赖元素级 pointer capture，光标出画布即丢 move 事件；②`toPct` 把坐标钳制在 0-100，光标出图后 grab 被钳值污染、回移即回跳冻结；③`setMasks` updater **原地变异**上一帧对象，React 重跑 updater 时位移重复/错乱。修＝拖拽引擎重写：**move/up 挂 window**（经典拖拽模式，`beginDrag` 注册、up 自清理）、`toPct` 不再钳制（越界由 `moveMask`/`normalizeShape` 各自钳制）、`moveMask`/`applyBBox` 全改**纯函数**（返回副本，禁原地变异），撤销快照经 `masksRef` 镜像读最新值（无过期闭包）。

### R6（2026-10-06 同日第六轮，用户实测两项）

1. **已闭合多边形点选误起新草稿**：多边形分支此前任何点击都变为「加草稿点」，闭合后的遮罩无法选中调整。修＝草稿未开始（`polyRef` 为空）时点击走与矩形/椭圆相同的命中链（顶点圆点→顶点编辑、遮罩内部→选中拖动），点空白才起笔；草稿进行中点击仍为加点（可穿过已有遮罩）。
2. **矩形/椭圆拖动「挪一点就冻结」+ 撤销错位（同一族根因，拖拽引擎重写）**：①拖拽依赖元素级 pointer capture，光标出画布即丢 move 事件；②`toPct` 把坐标钳制在 0-100，光标出图后 grab 被钳值污染、回移即回跳冻结；③`setMasks` updater **原地变异**上一帧对象且 `d.grab = p` 增量式在 React 批处理下被后续事件改写——updater 实际执行时读到的 grab 已是最新值，位移全部算错（实测遮罩被反向移动 dx=-5/dy=-3）。修＝**拖拽引擎重写**：move/up 监听挂 **window**（`beginDrag` 注册、up 自清理，光标出画布不丢事件）；`toPct` 不再钳制（越界由 moveMask/normalizeShape 各自钳制）；move 改**绝对定位**（down 时快照 grab₀+原始 bbox，每次 move 从快照直接算目标位置，updater 纯函数、批处理重跑不漂移）；`moveMask`/`applyBBox` 改纯函数（返回副本，禁原地变异）；撤销快照经 `masksRef` 镜像读最新值，move/resize/vertex 以 `moved` 标记代替状态比较（up 时 masksRef 尚未随批处理队列刷新，状态比较会误判「无变化」）。

### R7（2026-10-06 同日第七轮，用户实测一项）

**多边形拖动移动比鼠标快数倍**：`applyBBox` 的多边形分支用「比例重映射」公式（假定顶点仍在原始 bbox 空间），而 move 拖拽逐事件传入的顶点已是上一次平移后的位置——每个 move 事件把整个绝对偏移再累加一遍，事件越多位移越大（矩形/椭圆为绝对赋值不受影响）。修＝move 拖拽对多边形改「**原始顶点快照 + 钳制后位移**」的绝对平移（`origPoints` 随 drag 快照），与矩形/椭圆同构；测试 C5c 断言首顶点 (70,80)→(52,59) 精确平移且撤销回位。

### R8（2026-10-06 同日第八轮，用户实测两项）

1. **复习面卡体内「显示答案」死按钮移除**：CardFace 图片挖空分支曾无条件渲染卡体内「显示答案」，而复习页自 2026-10-01 起翻面只走底栏（`onReveal` 不传）——按钮渲染却无行为。修＝渲染加 `onReveal` 在场守卫；卡片浏览详情（showBack=true）等其余调用方不受影响。
2. **底栏位置确认**：复习页 `.stage-bar` 为固定布局（D88 底栏 + D97 定高解耦），卡体内容增减不移动底栏；测试 I 断言「显示答案」全页仅一枚且位于 `.stage-bar` 内。
