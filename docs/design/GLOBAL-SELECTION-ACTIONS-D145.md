# D145 · 全局选区三动作（制卡台重设计 · 机制层方案）

> 状态：**方案（诊断模式产出，未实施）**。交互规格以 ui-ux-architect 的制卡台重设计设计稿为准（撰写时该文档尚未落盘，落盘后以其实稿对齐按钮文案/选单视觉/输入框形态）。
> **状态修订（2026-10-13，用户拍板）**：整体**延后实施**，已入 GUIDE §9.5 路线图靠前位；方向待定（全局任意处制卡 vs 材料导入软件内制卡），方向调整完成后再交付实施。本稿保持方案态，P0/P1 分期不变。
> 版本锚点：基于 GUIDE v48.99（D142）；实施前 bump **v48.100** 并在 §8.1 登记 **D145**。
> D 号占用说明：**D144** 已被并行 UI 方案《D144-CARDDOCK-IA-REDESIGN.md》占用，本文档顺延为 **D145**（原稿曾自取 D144，已全文回改）。
> 范围：①跨应用选区捕获机制；②全局快捷键体系（三按钮 + 选单）；③三动作投递到制卡台宿主的 IPC 契约；④阅读页选单三入口替换的接线点；⑤设置项与安全边界。**不含**制卡台 UI/交互/样式（UI 方案负责）。

---

## 0. 需求拆解（用户原话 → 机制需求）

用户原话（逐字，见交接包）四条，拆为机制需求：

| 原话 | 机制需求 | 分期 |
| --- | --- | --- |
| 任意软件中选中文字后直接出现三按钮简洁选单 | **R-A 自动弹出**：需全局「选区完成」检测——Windows 无系统级选区事件，纯 Electron 不可达（见 §3.4） | **P1**（本方案给候选，不实施） |
| 或者按自定义快捷键使用三按钮功能 | **R-B 快捷键触发**：globalShortcut 注册三动作直快捷键 + 「呼出选单」快捷键（先捕获后弹选单，PopClip 形态） | **P0** |
| 选单功能与 AI 解释文本选单一致（AI 制卡 / 复制到手动制卡文本框 / 引用到 AI 解释输入框） | **R-C 三动作**：`aiCards`（直接触发 AI 制卡）/ `manual`（置入手动制卡文本框）/ `explain`（置入 AI 解释输入框） | P0 |
| 全局功能可在设置中关闭；三按钮功能可配置快捷键 | **R-D 设置**：总开关 + 每键独立 enabled/accelerator | P0 |
| 用三按钮功能替换阅读页选单「制卡」「AI制卡」「AI解释」 | **R-E 阅读页替换**：SelectionMenu 三动作语义统一到 R-C，应用内 M4 快捷键同步 | P0 |

P0/P1 分层依据：用户原话的触发条件本身是「选单**或者**快捷键」二选一；快捷键路径可完整交付三按钮功能，自动弹选单依赖 Windows 全局输入钩子（原生代码），属独立技术决策，硬塞进 P0 会引入原生模块依赖（违反零新依赖的保守取舍，见 §3.4）。

---

## 1. 现状盘点（机制相关全部先例）

### 1.1 全局快捷键（真源：`electron/quickCapture.js`）

- 全部 globalShortcut 由 quickCapture 独占：`applyGlobalShortcuts()` 先 `unregisterAll()` 再逐键注册（[quickCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/quickCapture.js#L164-L214)），注册失败**可见**（`shortcuts:status` 供设置页显示）。
- 既有三键：快速记录 `Ctrl+Alt+Space`、添加材料 `Ctrl+Alt+N`、制卡台 `Ctrl+Alt+K`（D123），另有 `autoLaunch`。
- 设置键 `app.globalShortcuts`（settings.json，原子写 [settingsStore.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/settingsStore.js#L34-L42)）。**读侧归一**在 `readShortcutConfig()`（[quickCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/quickCapture.js#L108-L139)）：非法值回落默认、两两相同回落默认并置 error；无写侧归一（既有口径，本方案沿用）。
- 归一器 `normalizeAccelerator()`（[quickCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/quickCapture.js#L61-L89)）：修饰键别名归一 + 固定顺序，无修饰键仅允许 F 功能键。
- 设置改动即时生效：main.js `settings:set` 对 `app.globalShortcuts` 触发重注册（[main.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/main.js#L304-L310)）。
- handler 注入模式：`ctx.sendToMain` / `ctx.toggleWorkbench`（main.js init，[main.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/main.js#L2042-L2060)）。

### 1.2 跨应用能力先例（`electron/screenCapture.js`，D123 修订 3/5 + D143）

「抓软件之外的任意内容」已有成熟时序（[screenCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/screenCapture.js#L86-L138)）：**单会话互斥**（`session` 非空即拒绝）、遮罩窗口先行显示（等待可见，D143 口径）、应用窗口临时透明避让、失败/取消 ⇒ null、40s 兜底防罩死、`finally` 恢复窗口透明度 + **恢复发起者焦点**。本方案的捕获模块照抄此骨架。

### 1.3 制卡台宿主（双宿主同一组件）

- 独立窗口：`electron/workbenchWindow.js` 单例（关闭=隐藏、置顶、`preload.js` 全量桥、`win:workbenchShown` 事件、[control()](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/workbenchWindow.js#L140-L151)）→ 渲染入口 [workbench.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/workbench.tsx#L13-L52) → `FreeWorkbenchHost standalone`。
- 主窗口内：同一 `FreeWorkbenchHost`（App 内 CardDock，D123/D142）。
- 双宿主动作编排在 `useSelectionActions`（[useSelectionActions.ts](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/lib/useSelectionActions.ts)）：`runAICards(text)`（L729，自由模式已支持无锚点文本）、`runExplain(text)`（L1180）、`startManualWith(text)`（L1701，D123「带入选区」）、`readSelectionText()`（L1615）。**三动作的渲染层能力已存在 80%**，缺 `explain` 的「置入输入框不自动发」变体（现 `actAIExplain` 是直接执行）。
- 跨窗口事实同步先例：`win:cardsChanged` → 主进程转发 `win:cardsRefresh`（[main.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/main.js#L364-L369)）——两渲染进程 eventBus 互不相通，必须主进程中转。
- 就绪握手先例：`capture:ready` 后才 show（防白闪 + 防 send 丢失），pendingShow 暂存（[quickCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/quickCapture.js#L298-L329)）。

### 1.4 阅读页选单接线点（R-E 替换目标）

- [SelectionMenu.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/SelectionMenu.tsx#L220-L229)：动作区五按钮 `note / manual / aiCards / explain / lookup`，`SelectionBarActions` 接口只有四动作（manual/aiCards/explain/lookup）。
- 宿主接线：[Reader.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Reader.tsx#L2123-L2134) `actions={{ manual: selAct.manual, aiCards: selAct.aiCards, explain: selAct.explain, lookup: selAct.lookup }}`。
- 应用内快捷键（M4 锁定表，F20 闸门解析）：`reader.makeCard`=Ctrl+Z / `reader.aiCards`=Ctrl+X / `reader.aiExplain`=Ctrl+A（[Reader.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Reader.tsx#L1586-L1590)），M4 注释明言「与选区菜单按钮完全同源」——**替换按钮语义时快捷键必须同步**（同一份事实不允许两套解释）。
- 摘录页（ExtractCard 编辑器）也复用 `SelectionMenu` 动作区（selActions 同源），替换范围含摘录页宿主（同一次组件改动自然覆盖，验收时一并断言）。

### 1.5 主进程日志（D119）

`electron/appLog.js`：`log / logError`，追加写例外已登记。捕获子进程的成败/耗时/剪贴板恢复结果记入此处（**只记元数据，绝不记剪贴板内容**，见 §7）。

---

## 2. Windows 跨应用选区捕获：候选机制对比与推荐

### 2.1 候选对比

| 候选 | 原理 | 优点 | 致命局限 | 结论 |
| --- | --- | --- | --- | --- |
| **A. 模拟复制 + 剪贴板读取**（SendKeys `^c`） | 快照剪贴板 → 向焦点窗口发送 Ctrl+C → 轮询剪贴板序列号 → 读文本 → 恢复快照 | 兼容面最广（几乎所有可选中文字的 Windows 应用都支持复制）；不依赖目标应用实现任何无障碍接口；业界主流（PopClip 类工具、Quicker、uTools 均此路线） | ①污染剪贴板（需保护/恢复，见 §2.3）；②焦点窗口复核失败/控制台类窗口时必须放弃（Ctrl+C 在终端=中断信号）；③密码管理器/DRM 内容会被复制（见 §7 风险登记）；④少数应用吞快捷键 | **推荐 P0** |
| B. UIA TextPattern | `GetFocusedElement` → TextPattern → `GetSelection()` | 不碰剪贴板、不发按键 | ①Electron 无内置，需 PowerShell 起 .NET UIAutomation 或原生模块；②支持面参差：Chromium 新版默认启用、Office/记事本可，Firefox 部分、Java/游戏/旧 Win32 不可；③部分实现返回全文而非选区；④无响应窗口查询会挂起（需超时）；⑤每次调用同样要起 PowerShell（冷启动 ~300-700ms） | P1 备选（自动弹出的轮询载体，见 §3.4） |
| C. OCR 截图 | 既有 screenCapture 抓屏 → Windows.Media.Ocr | 普适（任何像素） | **无选中语义**（不知道用户选了哪段，除非识别反色高亮区——不可靠）；中文需语言包；准确率/性能差 | 远期，不进本方案 |
| D. WM_COPY 定向消息 | `SendMessage(WM_COPY)` 给焦点窗口 | 不经键盘层 | 仅标准编辑控件响应；Chrome/自绘控件不响应 | 排除 |

### 2.2 承载方式：PowerShell 子进程 vs 原生模块

| | PowerShell（系统自带） | 原生模块（robotjs / nut-js / 自写 NAPI） |
| --- | --- | --- |
| 依赖 | **零新增**（Windows 组件） | 新增原生依赖：ABI 钉制 + 镜像 + 编译兜底（D137 为 better-sqlite3 付出整套成本先例）；robotjs/nut-js 维护状态差 |
| 能力 | SendKeys、剪贴板读写、P/Invoke（GetClipboardSequenceNumber / GetForegroundWindow / GetClassName）全覆盖 | 同样能力 + 可做全局钩子（仅 P1 需要） |
| 代价 | 每次冷启动 ~300-700ms（选单形态有「获取中」反馈可吸收；直快捷键形态端到端 <1s，AI 本身秒级流式，感知可接受） | 常驻、快 |
| 分发 | ps1 随应用走，**需 electron-builder asarUnpack**（PowerShell 无法读 asar 内文件；`electron-builder.yml` 已有 asarUnpack 先例 `**/*.node` + icon.ico） | electron-builder npmRebuild/asarUnpack 全套 |

**决策 G1**：P0 用 **PowerShell 一次性子进程承载候选 A**。理由：零新增依赖（本地优先保守口径）、能力完备、冷启动代价在交互形态上可吸收。常驻进程池与原生模块留 P1 性能优化位（§3.4）。

### 2.3 剪贴板保护/恢复协议（核心边界设计）

**关键设计：快照→复核→发送→轮询→读取→恢复全部收进同一个 PowerShell 进程内完成**，把剪贴板被污染的时间窗压到「发送 ^c 到恢复」之间的 ~50-300ms，主进程不 intermediate 触碰剪贴板（Electron clipboard API 也刻意不用——它无法做序列号轮询与类名检测）。

脚本职责序（`electron/capture-selection.ps1`，参数 `-TimeoutMs`，输出单行 JSON）：

1. `GetForegroundWindow()` + `GetClassName` 复核：类名黑名单（`ConsoleWindowClass`、`CASCADIA_HOSTING_WINDOW_CLASS` 等）→ 直接返回 `{ok:false, reason:"console-skip"}`（**绝不向终端发 ^c，那会变成 Ctrl+Break 中断信号**）。
2. 快照剪贴板：Text / Html / Rtf / FileDrop / Image 五格式逐一 try-catch 采集（缺失即 null）。
3. 记录 `GetClipboardSequenceNumber()` 基线 → `SendKeys.SendWait("^c")`。
4. 轮询序列号变化（15ms 间隔，至 TimeoutMs 上限，默认 600ms）；变化后读 `Clipboard.GetText()`。
5. 文本为空或与快照相同时（目标应用没反应/选区不可复制）→ `{ok:false, reason:"no-text"}`。
6. **恢复快照（best-effort）**：按 Text > Html > Rtf > Image > FileDrop 优先级恢复**最高优先级的一种**非空格式（`Set-Clipboard` 单次只支持单格式；完整多格式恢复需自写 Win32 SetClipboardData 逐格式代码，成本与收益不匹配——登记为已知限制：多格式剪贴板恢复后降为单格式）。恢复本身 try-catch，失败不阻断结果返回。
7. stdout 输出 `{ ok, text, reason? }`（UTF-8）。

主进程侧（`electron/selectionCapture.js`，对齐 screenCapture.js 骨架）：

- `execFile("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-STA","-File", ps1Path, "-TimeoutMs","600"], { timeout: 2500, windowsHide: true, maxBuffer: 4MB })`——**非 shell、无任何用户输入进 argv**，ps1Path 来自 `__dirname`（asarUnpack 后真实路径）。
- `-STA` 显式声明（剪贴板 API 要求 STA 线程）。
- **单会话互斥**（`session` 非空直接返回失败，screenCapture 先例）；进程级 `timeout: 2500` 兜底防挂；kill 后残留进程由 OS 回收。
- stdout JSON 解析 fail-closed（非法/超长 → `{ok:false, reason:"bad-output"}`）；文本长度上限 **64KB**（超出截断并置 `truncated:true`，防巨量文本打爆渲染层输入面与 AI 管线）。
- 全程 appLog 记元数据：耗时、reason、恢复成败、截断标志。**绝不记 text 内容**（§7）。
- `available()` 探测（PowerShell 是否可执行，供设置页显示与降级）。

### 2.4 焦点语义（本方案刻意**不做**焦点恢复）

- **触发时刻**（快捷键 handler 或选单按钮）：焦点仍在原应用（我们窗口未显示/不抢焦点），SendKeys 安全。主进程在 spawn 前不做额外焦点操作，复核在脚本内完成（步骤 1）。
- **投递时刻**：三动作交付给制卡台宿主后**有意抢焦点**（AI 制卡要看流式结果、manual/explain 要接着打字）——host 窗口 `show()+focus()`，不恢复原应用焦点。这是产品语义，非缺陷。
- **选单窗不抢焦点**（§3.2）：`showInactive()` + `focusable:false`，保证选区高亮保持、重试捕获时焦点仍在原应用。

### 2.5 失败降级矩阵

| 失败 | 用户可见行为 | 日志 |
| --- | --- | --- |
| PowerShell 不可用（ENOENT/组策略禁用） | 设置页捕获状态「不可用」；按快捷键无效并 toast（经 host 渲染层） | logError |
| console-skip（前台是终端） | 选单/直快捷键 toast「当前窗口不支持捕获」 | log |
| no-text（无可复制选区） | 选单窗显示空态 + 重试钮；直快捷键 toast | log |
| 超时 / bad-output | 同上 toast「捕获超时」 | logError |
| 剪贴板恢复失败 | **静默**（保留捕获文本在剪贴板，用户至少能粘贴刚选内容）+ 设置页提示文案说明此行为 | log（元数据） |

---

## 3. 全局快捷键体系设计

### 3.1 设置键（`app.globalShortcuts` 扩展，读侧归一沿用）

```jsonc
app.globalShortcuts = {
  quickCapture: {...}, addMaterial: {...}, workbench: {...}, autoLaunch: bool,  // 既有，不动
  // D145 新增：
  selectionActions: {
    enabled: true,                                  // 总开关（R-D：关=注销全部四键+选单永不出现）
    menu:    { enabled: true, accelerator: "Ctrl+Alt+S" },  // 呼出三按钮选单（P0 快捷键形态）
    aiCards: { enabled: true, accelerator: "Ctrl+Alt+X" },
    manual:  { enabled: true, accelerator: "Ctrl+Alt+M" },
    explain: { enabled: true, accelerator: "Ctrl+Alt+E" }
  }
}
```

- 默认键位依据：与应用内 M4 键（Ctrl+Z/X/A）形成记忆映射（X=AI制卡 同位、M=Manual、E=Explain、S=Selection 选单），全部带 Ctrl+Alt 前缀降低与常见软件全局键撞车概率；**刻意避开 Ctrl+Alt+A**（QQ/微信截图经典占用）。
- 归一口径：`readShortcutConfig()` 扩展——8 键（qc/am/wb + 新 4 键）两两比对，相同者**回落默认**并在 status 置 error「与另一个全局快捷键相同，已回落默认」（沿用 workbench 键既有口径，[quickCapture.js](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/electron/quickCapture.js#L115-L118)）。**实现提示**：现有手写两两比对在 8 键下组合爆炸（28 对），需改为键列表循环判重——这是本次改动的必要重构范围（同模块内，非无关重构）。
- 写侧不加归一（既有 globalShortcuts 口径：读侧归一即可）；§7.4 登记按 D129 先例「对象键逐字面量，子键不单列 DOC_KEYS」。

### 3.2 注册与 handler（quickCapture.js 扩展）

- `applyGlobalShortcuts()` 循环新增四键注册，handler 统一为 `ctx.onSelectionAction(action)`（action ∈ `menu|aiCards|manual|explain`；ctx 注入模式同 `ctx.toggleWorkbench`）。
- **选单窗（menu 动作）**：新主进程窗口（对齐 capture 窗参数：`frame:false, skipTaskbar:true, alwaysOnTop:true, focusable:false, resizable:false` + `show:false` 常驻单例、关闭=隐藏；`preload-gselection.js` 最小桥）。时序：
  1. 按键 → **先显示选单窗**（「获取中…」态，D143「等待可见」同款先例）于鼠标所在屏幕、光标附近（`screen.getCursorScreenPoint()`，positionCapture 同款定位逻辑）；
  2. 并行执行 §2.3 捕获；
  3. 成功 → 选单窗填充三按钮 + 字数预览；失败 → 空态 + 原因 + 重试钮；
  4. 点按钮 → 主进程 `deliver(action, text)`（§4.2）→ 关闭选单窗；
  5. 超时 8s 自动关闭（无焦点收不到 Esc 的兜底；Esc 手势因 `focusable:false` 不可用，登记为形态限制，关闭手势以 UI 方案为准——机制保底=超时+按钮）。
- **三动作直快捷键**：按键 → 捕获 → `deliver(action, text)`。若 host 窗口显示耗时，先 show 后送数据（§4.2 握手）。
- **`selectionActions.enabled=false`**：四键不注册（`tryRegister` 前的 enabled 判断，同既有键）+ menu handler 永不唤出。设置页开关即时生效（既有 `settings:set → applyGlobalShortcuts` 链路自动覆盖，零新增机制）。

### 3.3 状态可见

`shortcuts:status` 返回值扩展 `selectionActions` 段（每键 `{enabled, accelerator, registered, error}` + `captureAvailable: boolean`），设置页沿用既有展示模式。

### 3.4 P1：自动弹出选单（R-A，本方案只立项不实施）

Windows 无系统级「文本选中完成」事件，纯 Electron（无全局输入事件 API）不可检测拖选。两个候选，实施前需实测定夺：

| 候选 | 形态 | 代价 |
| --- | --- | --- |
| 原生 NAPI 小模块（`SetWindowsHookEx WH_MOUSE_LL` + `GetAsyncKeyState` 判拖选结束） | 常驻回调，事件驱动，体验最佳 | 新增原生依赖：ABI 钉制/镜像/编译兜底（D137 全套成本）+ asarUnpack |
| 常驻 PowerShell 子进程轮询 UIA（~300ms 周期 `GetFocusedElement → TextPattern.GetSelection`） | 无原生依赖 | 常驻 ~40MB 内存 + 1-2% CPU；支持面依赖目标应用实现 TextPattern（Firefox/Java/游戏不可）；无响应窗口查询需超时 |

P1 立项时另立决策号；P0 的 selectionActions.menu 键与选单窗 UI **全部复用**（自动弹出只是把「按快捷键」换成「钩子触发同一流程」），无返工风险。

---

## 4. IPC / preload 契约增量清单

### 4.1 通道（命名遵循「域:动作」既有约定）

| 通道 | 方向 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `gselection:capture` | invoke（渲染→主） | 无 → `{ok, text, reason?, truncated?}` | 渲染层主动捕获（选单窗「重试」；未来软件内复用） |
| `gselection:deliver` | 主→渲染（事件） | `{action: "aiCards"\|"manual"\|"explain", text: string}` | 三动作投递到制卡台宿主 |
| `gselection:ready` | send（渲染→主） | 无 | 宿主渲染层就绪，主进程 flush 暂存的 pending payload（`capture:ready` 同款握手；主窗口加载完成即发一次） |
| `gselection:status` | invoke | → `{available: boolean, lastError?: string}` | 设置页显示捕获子系统状态 |
| `gselection:menuAction` | send（选单窗→主） | `{action, text?}` | 选单窗按钮点击（选单窗 preload 最小桥，仅此 + 关闭/重试） |

### 4.2 投递路由（主进程编排，`electron/selectionCapture.js` 内）

```
deliver(action, text):
  1. 定宿主：独立制卡台窗口可见 → 它；否则主窗口可见 → 主窗口（CardDock 路径）；
     都不可见（托盘态）→ workbenchWindow.show()（置顶单例，全局场景最合理宿主）
  2. 宿主可见且已 ready → webContents.send("gselection:deliver", {action, text})
     未 ready（首建加载中）→ 暂存 pendingDeliver（单槽，新覆盖旧），等 gselection:ready 后 flush
     （pendingShow + capture:ready 双先例；主窗口路由时同时唤醒 CardDock 由渲染层动作自然触发 wakeDock，
      机制层不重复编排——runAICards/startManualWith 均已 wakeDock，explain 置入由 UI 方案输入框的唤起逻辑承担，
      渲染层 handler 中先 expandDock 一次作保险）
```

### 4.3 preload 桥

- `electron/preload.js`（主 preload，主窗口 + workbench 窗共用）新增：`gselectionAPI = { onDeliver(cb)（返回退订）, ready(), capture(), status() }`——与 windowAPI 既有闭包封装模式逐字同构。
- `electron/preload-gselection.js`（选单窗专用**最小桥**，对齐 preload-capture.js 最小权限先例）：仅 `gselectionMenuAPI = { onFill(cb), action(a, text), retry(), hide() }`。

### 4.4 渲染层动作映射（双宿主同一份，FreeWorkbenchHost / App 的 CardDock 宿主接线）

```ts
// 新 hook：src/lib/useGSelectionDelivery.ts
window.gselectionAPI.onDeliver(({ action, text }) => {
  if (action === "aiCards")  void selActions.runAICards(text);        // 既有：自由模式无锚点
  if (action === "manual")   selActions.startManualWith(text);        // 既有（D123）
  if (action === "explain")  selActions.fillExplainInput(text);       // 新增：置入解释输入框+聚焦+展开，不自动发送
});
```

`fillExplainInput` 是 `useSelectionActions` 唯一新增函数（+ wakeDock/expandDock + 置入文本）；「输入框」具体组件形态以 UI 方案为准，机制层只要求该函数语义 =「文本进输入面、焦点就位、不发送」。挂载点：FreeWorkbenchHost（独立窗口+主窗口 CardDock 共用组件）与 Reader 宿主各自调用一次（同一窗口多挂载点需防重：onDeliver 订阅按窗口去重，hook 内部模块级单订阅 + 广播到注册表，实现细节留给执行，验收=同窗口多宿主不重复执行）。

---

## 5. 阅读页选单三入口替换（R-E 接线点）

### 5.1 语义变化表（唯一行为变化 = explain 从「直接执行」变「置入待发」；manual 从 quote 预填变文本框置入——表单形态差异以 UI 方案为准，机制动作同源）

| 旧按钮 | 旧动作 | 新按钮（三按钮功能） | 新动作 |
| --- | --- | --- | --- |
| 制卡 | `actManualCard`（quote 预填+唤坞） | 复制到手动制卡文本框 | `startManualWith(selectionText())` |
| AI 制卡 | `actAICards`（直接跑） | AI 制卡 | `actAICards` 不变 |
| AI 解释 | `actAIExplain`（直接跑） | 引用到 AI 解释输入框 | `fillExplainInput(selectionText())` |

- 保留不动：批注（note）、查词（lookup）、色板/标注选项（色点、摘录/形式）——用户原话只点名三入口。
- 接线文件：[SelectionMenu.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/SelectionMenu.tsx#L220-L229)（`SelectionBarActions` 接口语义随按钮更新，`lookup` 保留）、[Reader.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Reader.tsx#L2123-L2134)（actions 映射换新实现）、摘录页宿主同组件自动覆盖。
- **M4 快捷键同步**（同一份事实不允许两套解释）：`reader.makeCard`(Ctrl+Z) / `reader.aiCards`(Ctrl+X) / `reader.aiExplain`(Ctrl+A) 的 run 指向同源新动作（[Reader.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Reader.tsx#L1586-L1590)）；§9.1 M4 锁定表三行描述随改（F20 闸门读该表，改表必须与代码同批落，否则闸门红）。

---

## 6. 设置项（设置页 UI 归 frontend-builder，机制契约在此）

设置页「快捷键」区块（既有 shortcuts:status 消费处）扩展：

1. **总开关**：「全局选区动作」开/关（写 `app.globalShortcuts.selectionActions.enabled`，即时生效链路已有）。
2. **四行键位配置**：menu / aiCards / manual / explain，每行 = enabled 开关 + accelerator 录入（录入组件沿用设置页既有快捷键录入模式，若 UI 方案给出新形态以其为准）+ 冲突/占用 error 展示（shortcuts:status 数据）。
3. **捕获状态行**：PowerShell 可用性（`gselection:status`）+ 剪贴板恢复 best-effort 说明文案（含「密码框场景不建议使用」提示，见 §7）。

---

## 7. 安全与边界情况（§7.5 对齐）

1. **子进程面**：`execFile`（非 exec、非 shell），argv 全静态 + 超时 + windowsHide；脚本为随包静态文件，无任何用户输入拼接路径；stdout 仅 JSON 解析（fail-closed + maxBuffer）。ps1 内容不含网络/文件写行为（只剪贴板与按键模拟），asarUnpack 后文件被篡改的风险与 `**/*.node` 同级（安装目录写权限即已沦陷，不新增攻击面）。
2. **剪贴板内容永不落日志**：appLog 只记 reason/耗时/恢复成败/长度。剪贴板可能含密码，日志纪律对齐 §7.5「Key/Cookie 不进日志」。
3. **密码框风险（如实登记）**：用户在密码管理器/网页密码框选中文字后按捕获快捷键，模拟 ^c 会把密码复制进剪贴板（随后恢复原剪贴板时清除）。无法从技术上可靠识别所有密码框（UIA IsPassword 需 UIA 路线且支持面有限）。缓解 = 设置页提示文案 + 文档登记为已知限制（与 PopClip 等同类工具一致口径）。Windows 剪贴板历史（Win+V）用户的原内容可找回，文案中提及。
4. **焦点漂移竞态**：快捷键按下到 SendKeys 之间用户切窗（<1s 窗口）——脚本内步骤 1 的前台复核只保护「发送时刻」，复核后仍可能漂移；残余风险登记（概率极低，后果=新焦点应用收到一次 ^c，多数应用无副作用）。
5. **多格式剪贴板降级**：恢复只还原单格式（§2.3），登记为已知限制。
6. **并发**：单会话互斥（捕获进行中再按快捷键直接忽略，screenCapture 先例）；两渲染进程同时 ready 不冲突（deliver 单播到路由宿主）。
7. **纯本地**：零新增网络依赖（AI 调用走既有例外通道，本方案只送文本进既有管线）。
8. **落库**：设置写入走既有 `settings:set` → 原子写；**不新增任何持久化例外**；不触碰 FSRS/review 真源。
9. **企业环境**：PowerShell 被禁用 → `available=false` → 四键不注册 + 设置页明示，功能整体降级不崩（quickCapture「不让坏设置把功能打死」同口径）。

---

## 8. GUIDE 文档先行任务（T0，先于一切代码）

1. bump 版本号 v48.99 → **v48.100**。
2. §8.1 登记新决策号 **D145**（行格式对齐既有表；理由列引用本文档路径 + 用户原话日期）。
3. § 修订清单：
   - **§4.2**（必须保留的接口/抽象）新增第 28 项：全局选区捕获与三动作投递（`electron/selectionCapture.js` + `electron/capture-selection.ps1` + `gselection:*` 通道 + `app.globalShortcuts.selectionActions` 键 + P0/P1 分层说明）；
   - **§4.2-21**（quickCapture）描述随新键组扩充（4 键 + 冲突口径）；
   - **§7.4**（提示词与配置管理）设置键登记 `app.globalShortcuts.selectionActions`（D129「对象键逐字面量」口径，子键不单列 DOC_KEYS）；
   - **§9.1 M4 用户锁定键位表**：`reader.makeCard / reader.aiCards / reader.aiExplain` 三行行为描述更新（F20 闸门判据同步）；全局四键（Ctrl+Alt+S/X/M/E）在 D145 决策行登记（对齐 `globalShortcuts.workbench` 的既有登记位置）。
4. 机器闸门核对：F18（设置键）/ F20（键位表）/ F11（文档集合并判据）随批同步，改编号为零（只增行改描述）。

---

## 9. 任务拆解表

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| T0 | GUIDE 文档先行（§8 全部内容） | core-engineer | `AI_DEVELOPMENT_GUIDE.md` | F11/F18/F20/F21/F24 闸门全绿；§4.2 含第 28 项；M4 表三行描述与代码行为一致 | - |
| T1 | 主进程捕获模块 selectionCapture.js（execFile 编排/单会话互斥/超时/JSON fail-closed/64KB 截断/appLog 元数据/available 探测） | core-engineer | `electron/selectionCapture.js`、`electron/main.js`（require+init 注入） | 新增 `tests/d144-gselection.test.cjs`：mock execFile 的 ok/no-text/console-skip/超时/bad-output/互斥/截断矩阵全绿；appLog 断言无 text 内容 | T0 |
| T2 | capture-selection.ps1 脚本 + 打包配置 | core-engineer | `electron/capture-selection.ps1`、`electron-builder.yml`（asarUnpack） | `ELECTRON_RUN_AS_NODE` 直跑脚本自测模式（-TestOnly：跳过 SendKeys，验证快照/恢复/JSON 输出）通过；`npm run dist:dir` 产物中 ps1 位于 unpacked 路径 | T0 |
| T3 | quickCapture 快捷键扩展（readShortcutConfig 8 键循环判重回落/applyGlobalShortcuts 注册/shortcuts:status 扩段/ctx.onSelectionAction 注入） | core-engineer | `electron/quickCapture.js`、`electron/main.js` | 既有 normalizeAccelerator 套件 + 新冲突矩阵（同键回落/非法回落/关=不注册）测试绿；shortcuts:status JSON 含 selectionActions 段 | T0 |
| T4 | IPC + preload 桥 + 投递路由 + ready 握手 | core-engineer | `electron/main.js`、`electron/preload.js`、`electron/workbenchWindow.js`、`electron/selectionCapture.js` | d144 测试扩展：路由三分支（workbench 可见/主窗口/托盘态 show）+ pendingDeliver flush 时序断言；tsc 0 | T1,T3 |
| T5 | 渲染层接收 hook + 三动作接线（含 useSelectionActions 新增 fillExplainInput） | frontend-builder | `src/lib/useGSelectionDelivery.ts`、`src/lib/useSelectionActions.ts`、`src/components/FreeWorkbenchHost.tsx`、App 内 CardDock 宿主 | tsc 0；GUI：经 `gselection:deliver` 注入后文本进入对应输入面/触发 AI 制卡（d144.gui.mjs 断言）；同窗口无重复执行断言 | T4 + UI 方案定稿 |
| T6 | 阅读页/摘录页选单三按钮替换 + M4 快捷键语义同步 | frontend-builder | `src/components/SelectionMenu.tsx`、`src/components/Reader.tsx` | f20 绿（M4 表已 T0 同步）；m6/annotations.gui 中旧按钮断言更新后全绿；新按钮 data-sel-act 键名不变（manual/aiCards/explain，探针兼容） | T5 |
| T7 | 选单小窗（窗口宿主 + 最小 preload + 获取中/空态/超时关闭） | core-engineer（窗口与 IPC）+ frontend-builder（窗内三按钮 UI，按 UI 方案） | `electron/gselectionMenu.js`（或并入 selectionCapture.js）、`electron/preload-gselection.js`、`src/gmenu.tsx` | GUI：快捷键呼出→选单出现在光标屏→不抢焦点（原应用选区保持）→点按钮触发投递→8s 超时关闭 | T4 + UI 方案定稿 |
| T8 | 设置页：总开关 + 四键配置 + 捕获状态行 | frontend-builder | `src/components/SettingsPanel.tsx`（快捷键区块） | m4.gui 快捷键区块断言更新（17→21 行）后绿；开关关闭后 shortcuts:status 中四键 registered=false | T3 |
| T9 | 测试套件与闸门收口（F18 键登记核对、m4/m6/d144 GUI 全量、文档集 F11） | bug-fixer | `tests/`（相关套件） | 全部新增/受影响套件两连绿；无新增未登记设置键（F18）；tsc 0 | T5-T8 |

**实施顺序**：T0 → T2 → T1 → T3 → T4 →（UI 方案定稿后）T5/T7/T8 并行 → T6 → T9。核心域（T1-T4、T7 窗口机制）由 core-engineer 实施模式承担；T5-T8 渲染层接线按本方案 §4.4/§5/§6 契约派发执行层。

---

## 10. 开放问题（需上游/UI 方案/用户拍板，不阻塞 P0 机制）

1. 选单窗视觉、按钮文案、关闭手势（Esc 不可用的替代）、字数预览形态——UI 方案。
2. 「AI 制卡」直快捷键在 AI 未配置时的行为（沿用既有「设置→AI 服务」引导 toast 即可，还是独立引导）——建议沿用既有文案（useSelectionActions 已有该错误分支），UI 方案确认。
3. 阅读页替换后，旧「AI 解释」直达路径是否保留其他入口（如工具栏）——用户原话未涉及，默认不保留额外入口（选单+快捷键已双通道）。
4. P1 自动弹出的载体选型（原生 NAPI vs UIA 轮询）——P1 立项时实测定夺（§3.4）。
5. 全局四键默认键位（Ctrl+Alt+S/X/M/E）——用户可在设置改；若用户对默认值有偏好请在实施前提出。
