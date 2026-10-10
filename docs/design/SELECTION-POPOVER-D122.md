# 选区浮条（Selection Popover）重设计 · D122（已实现，待主机 GUI 验证）

> 取代 `SELECTION-MENU-STAGE-TOOLBAR.md` v3（D83）/v4（D84）中「菜单只留批注框+色块、动作与段控留工具栏」的分工。
> 遵循：`docs/swiss-international-style.md` + `docs/design/MOTION-DESIGN-SPEC.md`（§4 hover 禁抬升、§7 展开折叠、§8.1 入场参数、附录 A reduced-motion）。
> 视觉稿：`selection-popover-mock-v4.html`（交付物，不入仓）。

## 1. 用户决定（2026-10-10，逐条留痕）
1. 「摘录」从动作按钮变为**标注选项**；形式（底色/下划线）同理。
2. 浮条为**单行横条**（原方案 B）；色点用**方块**；按钮用**无框**风格；内边距 **4px**。
3. 动作按钮**图标版（默认）+ 文字版**都做，设置里可切换（`app.selectionBarStyle`）。图标取编辑条同款（16px / 描边 1.5 / 圆角端点 / 26×24）；批注与制卡图标须明显可区分（批注＝对话气泡+两行字，制卡＝叠放双卡+加号）。
4. 默认色板换新 5 色（黄红绿蓝紫），**仍允许自定义**（设置里可从 8 色里增删，上限 8）；深色模式同步提亮。
5. 浮条默认在选区**上方**，放不下翻到下方；批注**默认折叠**（渐进披露）。
6. **退役** `app.readerActionsFloat` 及悬浮动作组。
7. 阅读器工具栏「图片挖空」→「**截图**」：截取阅读区可见内容，进入与点击正文图片相同的挖空制卡流程。

## 2. 结构
```
[色点×5] │ [批注][制卡][AI 制卡][AI 解释][查词] │ [标注选项 ▸] → 展开：│ [摘录] [底色|下划线]
           （批注点开：向下长出文本框；Ctrl+Enter＝用上次颜色保存；Esc 收起）
```
- 色点 16×16 方块，间距 6px；点色＝按当前「摘录/形式」完成标注（`createAnnotation(text, spans, color, mode, form, comment)` 不变）。
- 「标注选项」钮折叠态显示当前值：图标版为荧光笔图标（摘录开时 accent 着色），文字版为「摘录·底色」等文字；点开向右展开（`grid-template-columns 0fr→1fr`，展开 240ms／收起 200ms `--ease-out-soft`）。
- 动作与快捷键同源 `selAct.*`（Ctrl+Z/X/A/D 不变）；Ctrl+S 摘录快捷键与 `selAct.extract` 保留。
- 入场：`sel-bar-in`（150ms `--ease-enter`，translateY(`--shift-sm`)+scale(`--scale-in`)，无 spring）；reduced-motion 下展开过渡关闭。
- 定位：`placePopover({prefer:"above"})`，`ResizeObserver` 在展开批注/选项时重定位（上方时下沿固定向上长）。
- 多段选择 `byLocked`（按住修饰键 `pointer-events:none`）原样保留；根节点保留 `.menu.selection-menu` 类（宿主 mousedown 豁免、既有测试选择器）并带 `data-sel-actions`。
- 按钮 `onMouseDown preventDefault`，点击不夺走正文选区（批注 textarea 例外）。

## 3. 色板（`--annot-*`，`theme.css` 三处声明）
| id | 浅色 | 深色 |
|---|---|---|
| yellow | #f2b705 | #facc15 |
| red | #e5484d | #ff6b70 |
| green | #2fa866 | #4ade80 |
| blue | #3e7bfa | #6c9bff |
| purple | #8b5cf6 | #a78bfa |
| orange（自选） | #f28c28 | #fda04d |
| teal（自选） | #14b8a6 | #2dd4bf |
| magenta（自选） | #db4fa8 | #f472b6 |
默认色板 `["yellow","red","green","blue","purple"]`（`src/lib/annotationSettings.ts` 与 `electron/db.js` 同步）。已存的旧批注按 id 取色，自动变新色。**已手动保存过色板的设置不会被覆盖**（若想回到新默认，在设置里重选）。

## 4. 工具栏（只留不依赖选区的）
- 阅读器：`制卡`（免选区自由制卡）、`截图`（`data-sel-act="capture"`）；摘录页：`制卡`。
- 截图链路：`Reader.handleCaptureReader` → `assetsAPI.captureRegion(rect)` → 主进程 `ipcMain "reader-capture:region"`（`webContents.capturePage`，矩形夹进窗口内容区）→ `openOcclusionEditor`（同点击正文图片，来源 `engine`，图片锚点快照 alt=「页面截图」）。

## 5. 文件清单
| 动作 | 文件 |
|---|---|
| 重写 | `src/components/SelectionMenu.tsx`；新增 `src/components/selectionIcons.tsx`、`src/lib/selectionBarSettings.ts` |
| 改 | `Reader.tsx`、`ExtractReviewView.tsx`、`SettingsPanel.tsx`、`theme.css`、`annotationSettings.ts`、`electron/{main,preload,db}.js`、`src/lib/cards.ts`（类型） |
| 删 | `src/lib/readerActionsSettings.ts`、`ReaderSelActionsFloat`、`.reader-sel-actions-pop`、设置项 `readerActionsFloat` |
| 测试 | `f18-settings-matrix.cjs`（`readerActionsFloat`→`selectionBarStyle`；默认色板 6→5）、`cards.gui`/`extract-editor.gui` 两处选择器 |

## 6. 待办 / 验证
- **GUI 套件须在 Windows 主机跑并按新结构改选择器**：`marks.gui.mjs`（`[data-sel-act="extract"]` ×2）、`multiselect.gui.mjs`（工具栏 extract 钮 ×2）、`cards.gui.mjs:138`（工具栏 extract 钮测位置）、`annotations.gui.mjs`（`.selection-menu .menu-comment` 现为折叠，需先点 `[data-sel-act="note"]`）、`d91-d92.gui.mjs`（用了 `data-sel-act="occlusion"` 与 `pickOcclusionImage` 桩，按钮已改为截图）。
- 新增建议判据：浮条折叠态高度 ≤ 40px；色点 offsetWidth=16；`[data-sel-gear]` 点击后 `.sel-ext.open`；`app.selectionBarStyle=text` 时无 `svg` 于动作钮内。
- `AI_DEVELOPMENT_GUIDE.md` §8.1 登记 D122；MOTION-DESIGN-SPEC §8.4 选区菜单行以本文为准。
