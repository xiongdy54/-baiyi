# AI 解释 / AI 制卡流式链路四缺陷诊断与修复方案（D118，v48.74）

> 用户 2026-10-08 报告（原文要点）：
> 1. 「选中一段并不长的文字进行 AI 解释，然后在 AI 解释的底部点击"就此制卡"，但过了 422 秒都还没有制成卡片」；
> 2. 「直接点击 AI 制卡……用了将近半分钟……我使用的是以快速著称的 DeepSeek V4.1 Flash 模型，不应该会消耗这么长的时间」；
> 3. 「"已思考多少字"……整体在上涨，但这个数字会不断地上下起伏：变多，然后突然又变少，又变多，又变少……不过整体的字数是在增加的」；
> 4. 「"简明改写"和"多重解读"这两个本应是标题的部分……第一次是以大字号粗体的正常标题形式出现，而这次是以括号括起来的形式呈现。这是否意味着提示词对格式的界定规定不够严格？」；「上面的"歧义"相关标题不见了」；
> 5. 「两次尝试 AI 解释输出结果的最上方都存在一段代码……`<!--ste:matLang=zh-Hans--> <!--ste:points=3-->`」。

## 1. 结论一览

| # | 现象 | 根因 | 定性 |
|---|------|------|------|
| 1 | 就此制卡 422s 无结果 | 该次请求在供应商侧异常缓慢（422s 仅流出 ~3568 字 reasoning，≈8.4 字/s；同文本直跑 ~30s）——应用如实展示；但应用侧暴露两个真缺陷：**无取消手段**（IPC 层从未实现 §3 已契约的 AIGateway `cancel`）+ **无运行归属守卫**（僵尸流污染后续轮次） | 供应商侧慢 + 应用侧缺防御 |
| 2 | 直跑制卡 ~30s 偏慢 | 该模型为混合推理型，制卡前先输出 reasoning_content（思考字数在涨即证据）；30s 含思考属正常区间，非应用引入的延迟 | 非缺陷（如实展示） |
| 3 | 「已思考」字数上下起伏 | **旧请求的流仍在后台活着并写同一面板**。`ai:chat` 无 abort 通道，上一轮（422s 那次）的请求在用户放弃后仍持续推送 `{thinking}`；新旧两个请求的 onThinking 闭包都通过 `p.kind === "cards"` 检查、交替覆盖 `panel.thinking` ⇒ 大数（旧流累计）与小数（新流累计）交替出现 | 应用缺陷（本批修复③④） |
| 4 | 节标题时而是 `##` 大标题、时而是【】行内；「歧义点」节标题时有时无 | `reader-explain-ste` 提示词（electron/prompts.js `READER_EXPLAIN_STE_PROMPT`）输出契约只规定了**节顺序**（「节标题用解读语言书写」），未规定节标题的 Markdown 语法形态与独占行约束——模型自由发挥 ⇒ 每次渲染形态漂移 | 提示词契约不严（本批修复②） |
| 5 | `<!--ste:…-->` 机器标记直接显示 | 机器标记契约（D91 §4.2）假设「HTML 注释 Markdown 渲染不可见」；实测 react-markdown v10 对未挂 rehype-raw 的 raw HTML **以转义文本渲染**（本仓库 node_modules 实证：`renderToStaticMarkup(<ReactMarkdown><!--x--></ReactMarkdown>)` 输出 `&lt;!--x--&gt;`）。渲染层从未剥离标记——`stripSteMarkers` 只用于相似性判定 | 应用缺陷（本批修复①） |

## 2. 关键证据

- 主进程计数单调：`electron/ai.js` `chatStreamOnce` 内 `thinkAcc += think.length`、400ms 节流 `send({ thinking: thinkAcc })`——单请求内不可能变少 ⇒ 起伏必然来自**两个请求写同一 state**。
- 无取消：`electron/main.js` `ipcMain.on("ai:chat")` 不传 `abortSignal`（`chatStream` 形参支持但从未接入）；preload 无 `ai:abort`。
- 串台路径：`useSelectionActions.ts` `runAICards/runExplain` 的 `onProgress/onThinking` 闭包只校验 `p.kind`，不校验「是哪一轮」；`runExplain` await 之后的终态 `setAiPanel` 也无守卫——慢解释完成后会整个顶掉已经打开的制卡面板。
- Socket 看门狗（120s 无数据即断）会被 reasoning 涓流重置（设计如此，v45 补记），故 422s 的慢流不会被本地超时打断。
- `react-markdown@10.1.0` 实证渲染 HTML 注释为转义文本（见 §1#5）。

## 3. 修复方案

### ① 机器标记显示剥离（AIPanel.tsx）
两处 `<ReactMarkdown>`（解释答案、追问探索答案）渲染前 `stripSteMarkers(...)`。数据层 `panel.answer` 原样保留（`parseSteMarkers` 事后建议、`cards.ts` 材料语言回显不受影响）。

### ② STE 节标题契约收紧（prompts.js + db.js 播种升版）
`READER_EXPLAIN_STE_PROMPT` 输出契约补硬约束：节标题必须独占一行、以 `## ` 前缀、禁止用【】/粗体/行内文字代替；`## 歧义点`（points=0 时整节省略）→ `## 简明改写` → `## 多重解读`（如有）→ `## 术语`（如适用），标题文字用解读语言。
播种：存量库按 `MAX(version) < 2` 升版插 v2（沿用 card-occlusion v3 升版模式），`getPromptTemplate` 按 `is_default DESC, version DESC` 取行 ⇒ v2 自然生效；v1 留痕。

### ③ AI 运行归属守卫（useSelectionActions.ts）
模块级运行序号：`runAICards / runExplain / runOcclusionCards` 开头 `beginAIRun()` 取 seq；三者的 onProgress/onThinking/终态/异常 `setAiPanel` 一律 `seq === aiRunSeq.current` 才生效。串台写路径（含慢解释顶掉制卡面板）全部关闭。

### ④ 取消通道（AIGateway `cancel` 契约落地；§3 容器清单本就含 stream/cancel）
- `electron/main.js`：`ai:chat` 每请求建 `AbortController` 入注册表并传入 `chatStream`（形参既有，零传输层改动）；新 IPC `ai:abort(requestId)`；chatStream 结算（resolve/reject）后从注册表移除。
- `electron/preload.js`：`abortChat(requestId)`。
- `src/lib/ai.ts`：`chat(...)` 增可选第 5 参 `onCancelRegister?: (cancel: () => void) => void`（注册一次性取消闭包）；`aiAPI` 类型补 `abortChat`。
- `src/lib/cards.ts`：`generateCards` / `explain` 增可选尾参 `onCancelRegister`，透传 chat。
- `useSelectionActions.ts`：`aiCancelRef` 持有当前运行取消闭包；新运行开始即取消旧流；新增 `stopAIRun()`。
- `AIPanel.tsx` + `SelectionPanels.tsx`：等待行（explain / cards / occlusion）加「停止」按钮 → `onStop` → `stopAIRun()`；中止经 `chatStream` reject → 现有 catch 展示「已手动停止本轮 AI 生成」。中止错误不重试（无 retriable code，§3.7 纪律天然满足）。

### 范围外
- 供应商侧慢（422s）本身无法在应用内根治；本批交付的是「可见、可停、不串台」。
- 就此制卡与直跑制卡同链路同模型（`runAICards(选区文本)`），不存在「解释转制卡更慢」的应用侧分支。
- 不动 F27/m12/m4/m2 已知预存 GUI 失败。

## 4. 验收（机械判据）

1. `npx tsc --noEmit`（仓库惯例 `tsc` 脚本）0 错误；`npm run build` 成功。
2. F11 17/17（GUIDE 文档闸门，本批改 GUIDE 必跑）。
3. d91 套件回归（explainRouter 纯函数未动，防回归）。
4. 手工验收路径：AI 解释 → 答案顶部无 `<!--ste:…-->`；STE 输出节标题恒为 `##` 形态（新模板 v2 生效，卡库启动即播种）；生成中点「停止」→ 数秒内回到可操作态且无错误弹层残留；生成中直接改跑另一轮 → 旧「已思考」停止增长、新计数单调。

## 5. 实测结果（2026-10-08）

- tsc 0 错误；build 成功；F11 17/17；F21 7/7；d91 47/47；d91-prompts 18/18（断言迁移：全新库 v1→v2 两行、默认取 v2、v1 行=D91 原文冻结常量 `READER_EXPLAIN_STE_PROMPT_V1`；顺带新增 db.js 只读 `getPromptTemplateVersion(scope, version)` 供升版测试核对留痕行）。
- abort 链路探针 5/5（本地 SSE 伪服务 + electron 直调 chatStream）：中途 abort → reject 携带「已手动停止本轮 AI 生成」；reject 前 thinking 已在流（取消的是在途流）；仅 1 次上游请求（§3.7 不重试）；上游连接即断；秒级返回（不等 120s 看门狗）。探针为一次性脚本，验证后已删除。
- F18/F20 报错、F24-R3（F91/F92 零 cites）、F27-W6 失败：`git stash` 对照 main 逐字相同＝预存，非本批引入。
- 实施修订：`abortErrorOf`（electron/ai.js）只在 `reason.code` 存在时透传 reason——`ai:abort` 的中止错误因此带机读 `code=cancelled`（消息「已手动停止本轮 AI 生成」随之透传，且不落入 retriable 集）。

## 6. 二轮报告追加（用户同日实测截图，2026-10-08）

**现象 A**：修复①上线后「歧义点」上方仍露出一段代码＝`<!--ste:matLang=zh-Hans-->`（`points=3` 已被剥离消失）。
**根因⑤**：`explainRouter.ts` 标记正则的值字符集 `[^>-]*` 把连字符排除——`zh-Hans` 是 BCP-47 语言代码必含 `-` ⇒ matLang 标记剥不掉也解析不出；旧测试只用过 `matLang=en`（无连字符）故从未暴露。
**修复**：parse/strip 两处值字符集放宽为 `[^>]*`（`>` 是注释定界符，放宽不越界）；d91 补 zh-Hans 解析/剥离用例（esbuild 重打包 d91.bundle）。

**现象 B**：点「通俗解释/严格定义/举个例子/为什么」、或在「自动/通用解读/简明解读」间切换，回复几乎完全一样。
**根因⑥（双重）**：
- a) `cards.ts` `explain()` 的 **ste 分支组装 user 消息时丢掉 `question` 参数**——只有通用分支拼了【用户追问】。auto 路由进 ste 的文本（含本例）点四个追问按钮＝发出与初次解读**逐字相同**的请求，回复自然几乎一样（仅 temperature 0.7 的随机差异）；「自动」与「简明解读」同走 ste 也一样。
- b) 提示词侧：通用模板对四种追问只有一句弱指引（「按追问角度作答」），STE 模板则要求「恒定完整执行全流程」，即使追问送达也会被全流程淹没。
**修复**：
- a) ste 分支 user 消息拼入 `【用户追问】${question}`；
- b) STE v2 追加**「追问直答」条款**：用户消息含【用户追问】时全流程整体让位——不输出机器标记、不输出节标题，直接按追问角度作答（2-5 句，仍用解读语言与改写剖面）；
- c) `reader-explain` 升 **v2「追问四式」**：通俗解释（大白话+类比，面向零基础）/ 严格定义（学术口径+适用边界+相邻概念辨析）/ 举个例子（1-2 个可落地例子，可含反例）/ 为什么会这样（直接原因→深层原因分层）；追问在场时不再做全景解释。存量库 `MAX(version)<2` 升版播种，v1 原文冻结 `READER_EXPLAIN_PROMPT_V1`；D91 时期 d91-prompts P2 的「reader-explain 零改动」守卫随断言迁移退役（该守卫的语义是「D91 批不碰它」，D118 起合法变更）。

**二轮实测**：tsc 0；build 成功；d91 47/47（新增连字符用例）；d91-prompts 18/18；F11 17/17；F21 7/7。
**用户侧生效条件**：重启应用（主进程模板播种在启动时执行；渲染层需新 dist——已构建）。
