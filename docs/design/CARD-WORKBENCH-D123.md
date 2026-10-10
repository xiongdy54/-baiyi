# 制卡台（Card Workbench）· D123（v48.79）

> 取代 D88/D92 的「学习坞」入口与布局语义：把**手动制卡 / AI 制卡 / AI 解释**收进同一个全局模块「制卡台」。
> 遵循：`docs/swiss-international-style.md` + `docs/design/MOTION-DESIGN-SPEC.md`。
> 预览稿（交付物，不入仓）：`制卡台-融合优化版-v3.html`（2026-10-10 用户选定「版本 1 + 版本 3」融合并经三轮修订）。

## 1. 用户决定（2026-10-10，逐条留痕）
1. 手动制卡、AI 制卡、AI 解释合成**一个模块**，共享**唯一最高优先入口**；模块内**手动制卡是常驻主角**（可展开/收成一行，永不消失；AI 工作时仍可手动制卡）。
2. **只保留一个入口**：顶栏「制卡台」文字按钮（无底色深绿框、不显示快捷键文字，快捷键仅悬停提示）。主区右上的重复标签、坞头「＋制卡」大按钮、关闭按钮、右缘把手全部退役。
3. **放置位置可选**：右侧（默认）或底部，**在设置里切换**（`app.workbenchPlacement`），不放在面板上。
4. **窗口自适应**：最大化→制卡台向内推、正文收窄；非最大化且屏幕右侧有余量→**窗口整体向右变宽**，面板紧贴标题栏下方（无空白条）；余量不足回落内推。底部放置恒为内推（压低正文高度）。
5. **简洁优先**（SuperMemo 反面教材）：不必要的信息收起/悬停才显示——无「＋」装饰、无「草稿自动保存」说明、「带入选区/来源」悬停显示、高级字段收进「更多」。
6. **必须保留**：手动制卡的卡片类型切换（问答题/翻转问答/填空题/图片挖空）；AI 制卡的「材料类型 / 默认形式 / 重跑」。
7. **无闪烁**：禁止呼吸点/脉冲动画分散注意力；状态点为静态方块。
8. AI 制卡「知识点与后续可补」：行内**勾选 · 条目名（✎ 可编辑）· 「解释」**；解释完成可展开/收起；展开内容带「制卡」；底部「制卡 (n)」批量条仅在有勾选时出现。**行内不再有「制卡」按钮**（与勾选+批量条功能重复，去重）。
9. AI 解释页签：底部**常驻单行输入框**（随输入增高、与「发送」钮同高对齐），支持自由追问；每条 AI 回复悬停出现「制卡」（以该回复为材料走 AI 制卡）。
10. **细线对齐**：制卡台（右侧）手动区标题行下缘线 与 摘录页头带（面包屑/待处理）下缘线同一 y；做法＝摘录页头带取消上方独立的「制卡」工具行（入口已全局化），头带内列高 = 48px = 制卡台标题行高（`--sp-12`）。
11. **全局可用**：书架/摘录/复习/卡片/日记/数据/阅读器任一页面按 `Ctrl+K`（App 级固定键位，**不进 §9.1 命令注册表**以免改动命令契约；可改键列入后续）或点顶栏按钮即可唤出；阅读器/摘录页带选区上下文，其余页为自由模式（无来源锚，可粘贴文字做 AI 解释/制卡，手动制卡免选区）。
12. **托盘常驻 + 独立窗口**：关闭主窗口＝隐藏到系统托盘（`app.closeToTray`，默认开；托盘菜单「退出」才真退出）；全局快捷键（`globalShortcuts.workbench`，默认 `Ctrl+Alt+K`）与托盘菜单可呼出**独立制卡台窗口**（含手动制卡、AI 制卡、AI 解释；单例、关闭=隐藏、默认置顶）。

## 2. 结构
```
右侧：[手动制卡 ▴]（标题行 48px）          底部：┌ 手动制卡 ┬ AI（解释｜制卡）┐
      [类型 问答｜翻转｜填空｜图片挖空]            │ 类型/正面/背面  │ 页签体          │
      正面 / 背面 / [更多▾] [制卡]                 └ 收成一行 → 底部单行输入条 ┘
      ─────────────
      AI  [解释｜制卡]
      页签体（滚动）
      （解释页：底部输入条）（制卡页：条件批量条）
```
- 手动区收成一行：右侧＝顶部单行输入（Enter 出问答卡）；底部＝AI 在上、手动单行条在下。
- `CardDock` 保留文件名，内部改为：手动区（常驻）+ AI 区（页签）；`manualActive` 概念在 UI 层退役（hook 内保留以免大面积改动，恒 false 不再驱动页签）。
- 手动表单 `ManualCardForm` 新增 `variant="dock"`：隐藏「取消」、高级字段（领域标签/标签/上下文前缀/助记/知识点分组/日期标记/优先级）收进「更多」（DOM 保持挂载仅 hidden，落库载荷逐字节不变）。

## 3. 接口与契约
**设置键（`app` scope）**
| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `workbenchPlacement` | `"right"\|"bottom"` | `"right"` | 写侧归一（非法回落 right）；设置页「卡面与标签」区切换 |
| `closeToTray` | boolean | `true` | 仅严格 `false` 为关；关闭时关主窗口＝退出应用 |
| `globalShortcuts.workbench` | `{enabled, accelerator}` | `{true, "Ctrl+Alt+K"}` | 与 quickCapture/addMaterial 同表、同注册失败可见机制 |

**IPC（均在既有 `win` / `shortcuts` 域，不新增域）**
- `win:dockExtend(deltaPx)` → `{mode:"extended"|"inner"}`：非最大化/非全屏且屏幕右缘有余量时把窗口宽度 +delta（记录原宽），否则 `inner`。
- `win:dockRestore()` → boolean：仅当此前为 `extended` 时还原宽度。
- `win:workbench(action)`：`"toggle"|"show"|"hide"`，独立制卡台窗口单例控制。
- `win:cardsChanged`（renderer→main）→ 主进程向主窗口推送 `win:cardsRefresh`：独立窗口建卡后让主窗口 `cards/changed`。
- `win:workbenchShown`（main→独立窗口）：每次呼出重读主题/强调色。
- 主窗口最大化时主进程清除 extended 记录并推送 `win:dockMode`（`inner`）。

**键位**：顶栏按钮与 App 级 `Ctrl+K`（设置弹窗期间不响应；已被编辑器 preventDefault 的不抢）。
**DOM 契约（测试用）**：`[data-testid="workbench-entry"]`（顶栏按钮，`aria-pressed`）；`[data-card-dock][data-placement]`；`[data-testid="wb-manual"]`、`wb-manual-toggle`；`dock-tab-explain` / `dock-tab-cards` 保留；`dock-manual` / `dock-collapse` / `dock-handle` 退役。

## 4. 架构落点
- 渲染层：`CardDock.tsx`（容器）、`SelectionPanels.tsx`（编排）、`AIPanel.tsx`（解释页聊天 + 制卡页知识点行）、`ManualCardEditor.tsx`（dock variant）、`useSelectionActions.ts`（`runAsk` 线程、`runExploration` 源键、`manualSeq`）、`src/lib/workbenchLayout.ts`（放置/外延/推让）、`App.tsx`（顶栏按钮、`.app-main` 包装、自由宿主 `FreeWorkbenchHost`）、`workbench.html` + `src/workbench.tsx`（独立窗口入口）。
- 主进程：`electron/workbenchWindow.js`（独立窗口单例）、`electron/tray.js`（托盘）、`main.js`（closeToTray、`win:dock*`、`createWindow` 防重入改按 `mainWindow`）、`quickCapture.js`（注册 `globalShortcuts.workbench`）。
- 让位：页面统一由 `html[data-wb-open][data-wb-place]` 作用于 `.app-main` 的 margin 推让；删除 `reader-body-shifted` 与摘录页 `[data-dock-open]` 的 ad-hoc 让位规则。
- 进度计时修复：摘录页 `elapsedSec={0}` 硬编码是「已等待 0 秒」的根因；AIPanel 改为按 `startedAt` 与 `elapsedTick` 自算。

## 5. 范围外
卡片类型新增、AI 提示词改动、卡片数据模型/调度（零改动）；独立窗口的「读取其他应用选区」；多显示器外延向左。

## 6. 验证与未完成边界
沙箱可跑：`tsc --noEmit`、node 单元。须主机验证：`npm run build`、GUI 套件（`d91-d92.gui.mjs`/`m1.gui.mjs`/`m4.gui.mjs` 选择器已按本契约更新但未运行）、托盘/全局快捷键/窗口外延的实机行为、F18/F20/F60 等闸门对基线对照。

## 7. 修订 2026-10-10（还原 v3 预览稿视觉）
手动制卡 dock 形态重做：题型改 hairline 分段控件（`.wb-seg`）；正/背面框以占位符代替 label；说明性长文案收进 title/placeholder；「更多」为紧凑「标签—值」行（`.wb-row`，自定义方形勾选，无横向滚动）；页脚＝灰字「更多 ▾」+ accent「制卡」（原「创建卡片」，仅 dock）；Ctrl+Enter 制卡。AI 页签改同款分段控件；阅读器收起态「展开」钮与工具行垂直对齐。样式见 theme.css 末尾「D123 修订」节。

### 7.1 修订 2（2026-10-10 晚，用户实测反馈）
- **输入法截断根因**：`MarkdownEditor` 的外部置值检测把「编辑器自己上报后经 onChange 回灌的 value」也当成外部置值 → 每敲一键重建编辑器，打断输入法组合态（中文最多 1–3 个字母）。修复：回灌值 = 最近一次上报的序列化结果时不重建。
- 标题行高改为 40px + 1px（= 阅读页工具行高）；不再显示书名 meta（顶栏已有，重复）；`CardDock` 去掉 `meta` 属性。
- 题型 / AI 页签＝整宽等分段控件；输入框默认一行，`useGrowBox`/`growTextarea`（`src/lib/autoGrow.ts`）随内容伸缩，过渡用 `--dur-panel` + `--ease`；「更多」走 `.collapse-clip` 通用折叠。
- 「带入选区」「带入 AI 回答」悬停小字（accent）：选区经 `sel.readSelectionText()`；回答取最近完成的追问回答，否则解释面板回答。无内容时按钮短暂提示「没有选区 / 暂无 AI 回答」。
- 手动制卡 dock 移除「优先级」：优先级只服务摘录推送，闪卡由 FSRS 调度；载荷仍带默认 50（数据模型零改动）。modal 形态（图片挖空）保持原样。

### 7.2 修订 3（2026-10-10 深夜）
- 两区分层：手动区 paper 底；AI 区 grey-1 淡底 + 顶部 1px ink 分界线。两区标题行同高（34px）、同款：左标题（手动制卡 / AI）+ 紧随的文字页签（选中＝accent 字 + 2px 下划线，无填充块）；手动区题型页签并入标题行，右端为收起箭头。
- 输入框一行起步（段落零外距）；伸缩动效不变。
- 「图片挖空」页签不再切表单，而是启动**整屏截图**：`electron/screenCapture.js`（desktopCapturer 抓光标所在显示器 + 全屏遮罩窗口 `captureOverlay.html` 拖框；Esc/右键取消；应用窗口截前临时透明不入镜）→ dataURL → `useSelectionActions.startWorkbenchCapture` → 图片挖空编辑器（由 SelectionPanels 渲染，`occlEditor.workbench` 标记；阅读器不重复渲染）。无归属书籍时资产落 `assets/workbench-assets/`（`createAssetForItem` 识别）。IPC：`screen-capture:start`（preload `assetsAPI.captureScreen`）；遮罩内部通道 `screen-capture:shot/ready/done`。
- 阅读器「截图」无反应的根因：`handleCaptureReader` 与点击正文图片的入口都用 `manualOpen || aiPanel` 当「弹层在场」守卫，制卡台常驻后二者几乎恒真 → 静默 return。改为只在挖空编辑器 / 挖空弹窗在场时拦截，并给出提示。
