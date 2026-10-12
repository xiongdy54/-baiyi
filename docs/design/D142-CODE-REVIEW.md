# D142 制卡台（CardDock）样式改版 · 终审报告（code-reviewer）

> 日期：2026-10-12 ｜ 分支：`main`（改动未提交）｜ 审查对象：`src/theme.css` 未提交 diff（+89/−27，7 个 hunk）、`AI_DEVELOPMENT_GUIDE.md` D142 行（L1471）、`docs/design/D142-CARDDOCK-RESTYLE.md`（头部）、`docs/design/D142-IMPLEMENTATION-REPORT.md`
> 对照基准：设计稿 §2 线条矩阵 / §3.1–§3.5 / §4 / §6 R1–R10 / §7 #1–#10 / §8 / §9
> 只读审查：未改代码/文档、未 commit/stash/切分支。GUI 复跑见「五、未能独立确认的风险」（在场 electron 孤儿未能清理，按任务约束跳过）
> 结论：**不合格** —— 1 条必须修复项（坞内「标签」输入聚焦无可见焦点指示，键盘焦点可见性回归）；其余全部核验通过

---

## 一、方法

1. 全量读 `git diff -- src/theme.css`（7 hunk 逐一归位 R1–R10）与 GUIDE diff；对 `src/theme.css` 现行落盘文本按行核对（含 base 段 L2880–3110 与 dock 段 L8038–8432 的层叠关系）。
2. 作用域安全：`grep` 全仓 TSX 找 `.side-dock` / `dd-btn` / `.wb-field|wb-line|wb-free|wb-composer|wb-cloze|wb-more` / `tag-input-box` / `UdcPicker` / `TagInput` 的宿主，逐一核对是否落在本次选择器范围内。
3. 机械验收：§7 #1–#10 逐条 grep/计算复跑；f11 闸门复跑；`dist/assets/theme-*.css`（17:15 构建产物）确认新规则进入产物。
4. 证据核验：`tests/tmp-d142-census-after.out.log`（改后 16 条清单）、`tests/tmp-d142-after-census.json`（44 断言）、`tests/tmp-d142-sample-metrics.log`（样张矩阵）、`tests/tmp-d142-build.log`、before/after 局部裁剪图目检。因在场 electron 孤儿，未做 GUI 复跑（见五）。

## 二、逐面核验

### 1. diff 语义（R1–R10 逐条）

| 项 | 落点 | 结论 |
| --- | --- | --- |
| R1 | L8105–8107：`.wb-ai` 上缘 strong 与 bottom 放置 `border-left` 双删，注释改 R1 口径；`.side-dock[data-placement="bottom"] .wb-manual`（L2934–2938）`border-right: subtle` 原样保留 | ✅ 唯一竖缘线在；`grep "\.wb-ai"` 仅余 `.wb-ai`/`.wb-ai-body`/`.wb-ai-head` 无边框规则，验收 #1 成立 |
| R2/R3 | L8116–8125：`border: 0; border-bottom: 1px solid var(--border-subtle)`（**是 subtle 可见线，不是透明**——V2/V3 的透明占位机制未误用到 V1）；`background: transparent`；`caret-color: accent`；旧 `:focus-within { border-color / background }` 两条随边框整体删除（无幽灵边框）；`hover:not(:focus-within)` → strong；`:focus-within` → accent + `box-shadow: 0 1px 0 0`（不在 transition 列内＝瞬时厚化，对齐 MOTION §4）。`.wb-field-inner { padding: 4px 0 }`（L8139） | ✅ 与「V1 = 静止 subtle 可见下缘 + 聚焦 accent + 瞬时厚化」逐字一致；1px 占位在流内，聚焦零位移 |
| R4 | L8195：虚线 strong → 实线 subtle；`:focus` accent 保留（L8203） | ✅ `grep dashed` 在 wb-line 上下文 0（其余 4 处均为无关组件：kind-tag/disamb/cx-empty/journal-draft） |
| R5 | L8232 + L8238–8241：坞内 dd-btn ghost（`border: 0; padding-left/right: 0; color: text-helper`；hover grey-1 + 墨字）；与样张 L144–145 逐字同构（作用域按设计 §2 #4「限 `.side-dock`」落实） | ✅ 选择领域 / 解读方式「自动」两处 dd-btn computed `0/0/0/0`（census） |
| R6 | L8256–8274、L8309–8318：两类 textarea 去四边 → 下缘 subtle + hover strong + focus accent+厚化；高度契约不变（自由材料 4+20+5+1=30；追问 5+20+6+1=32） | ✅ 实测 wbFreeTa h=30 pad「4px 0px 5px」、composerTa h=32 pad「5px 0px 6px」；32=32、底对齐 742=742 |
| R7 | L8308：composer 上缘 → subtle | ✅ computed bcTop rgb(224,224,224) |
| R8 | L8241：`.side-dock .btn-outline:disabled` → grey-1 底 + transparent 边（与 base 禁用一致） | ✅ AI 制卡钮 computed bg 240/240/238、bcTop 透明、字 212（grey-2）；且 `.btn-outline:hover` 被 (0,3,0) 规则压住，禁用态不被 hover 反色 |
| R9 | L8301–8302：两条 `::placeholder → --text-placeholder` | ✅ 验收 #5 命中 2 行，运行时样式表复读 + 像素 138 佐证 |
| R10 | L8321–8322：H1（`--accent-hover`，零阴影零位移）+ D2（`--text-placeholder` 字色；cursor 由 base `.btn:disabled` 的 default 承担，无 🚫） | ✅ hover computed `color(srgb 0.0759 0.3658 0.3071)` 与样张 H1 逐值一致；禁用 138 + default |

§2 矩阵 20 条 + §2.1 延伸：保留项（#1 标题线、#3 更多上缘、#7 13px 勾选框 strong、#8/#13 透明描边主钮、#10 AI 标题线、`.wb-check`/`.ai-kp`/`.ai-kps-head`/chip 族/`.ai-error`/`.dd-menu`/`.wb-pick`）逐一确认未动；处置项（#2/#4/#5/#6/#9/#11/#12/#14/#15/#16）与 diff 一一对应。`.wb-cloze-btn` 转文字钮（L8411–8423）；`填空输入由所属 .wb-field 承担底线机制` 事实成立——`ClozeField` 的 `.wb-cloze-input` 被 `GrowField`（`.wb-field`）包裹（ManualCardEditor.tsx L173–193），census 亦核 `input 0/0/0/0、field 0/0/0.8/0`。✅

### 2. 作用域安全（头号风险面）

- **无裸元素选择器**：新增行逐一枚举，全部以 `.wb-*` / `.wbw-*`-族 / `.side-dock` / `.wb-more` 起头（机械 grep 复核 0 命中）。
- `.side-dock` 全仓唯一宿主＝`CardDock.tsx:84`（`.wbw-body .side-dock[data-placement="window"]` 为独立窗口同源宿主，设计 §9-6 认作同一验收面）；`.dd-btn` 的其它复用点（Dropdown 常规宿主：InsightPanel / KnowledgeManager / Reader、UdcPicker 的 TracksDialog 与 ManualCardEditor modal 变体、ManualCardEditor.tsx:807）均不在 `.side-dock` 内 → 不受 `.side-dock .dd-btn` 波及。✅（UdcPicker/TagInput 在 modal 变体（L668/L675）与卡片浏览/复习页的复用同理被 `.wb-more` / `.side-dock` 挡在外。）
- `.wb-field/.wb-line/.wb-more/.wb-free/.wb-composer/.wb-cloze*` 的 JSX 只出现在 `variant="dock"` 分支（ManualCardEditor.tsx:479–574；modal 分支 L577 后零 `wb-` 类）；`variant="dock"` 全仓唯一调用点＝SelectionPanels.tsx:320（CardDock）。`.wb-free`（FreeSource）与 `.wb-composer`（ChatComposer）只在 CardDock 的页签体内渲染。✅
- 结论：**无漏出全应用的通道**；独立窗口与侧栏同源（同一 CSS 作用域），符合设计 R5/§9-6。

### 3. 残留检查

- 四边框残留：`grep -n "wb-field" -A6` 仅 L8116–8122 一处定义，`border: 0` + 单下缘；无其它 `.wb-field` border/background 规则。✅
- 旧规则双轨：base 段两条 `:focus` 残留的 `border-color: strong` 已清（L3024/L3103 仅留 outline:none，注释注明）；`.wb-free textarea:focus { border-color: accent }` 旧 dock 规则被新规则替换（非并存）。✅
- 同元素多源：`.wb-free textarea` / `.wb-composer textarea` 的 base（L3011/L3086）与 dock 覆盖（L8256/L8309）层序正常（同特异度、后者在后，逐属性胜出）；`.wb-composer` 上缘 base 与 dock 均 subtle，无冲突。✅
- 新增 `!important` 0 处（机械 grep）；无异常加权（新增最高为 `.side-dock .dd-btn:hover` (0,3,0)，无 id/多伪类堆叠）。✅

### 4. 验收对照（§7 #1–#10 独立复跑）

| # | 我的独立复跑 | 结果 |
| --- | --- | --- |
| 1 | `grep "\.wb-ai"`：无可见 border-top/left；证据 computed `0/0/0/0`（右/底/窗三处） | ✅ |
| 2 | `border: 0` + 下缘 1px subtle（L8118–8119）；无 4 边 strong 残留；census `0/0/0.8/0` | ✅ |
| 3 | `dashed` 在 wb-line 上下文 0 | ✅ |
| 4 | L8241 存在且 transparent 边 | ✅ |
| 5 | L8301–8302 两行 | ✅ |
| 6 | 高度契约：证据 `{"ta":32,"send":32}`、`align:"flex-end"`、增高后 h=52 仍底对齐 gap 0；我以「去框后 padding+border 合计＝原值」独立推验 32/30 成立 | ✅（GUI 未复跑，见五） |
| 7 | 样张矩阵：`tmp-d142-sample-metrics.log` 解析＝§2.2 V1 7/7/0、§4 五态（H1 `color(srgb 0.0759…)`、D2 138、boxShadow none 全成立）；theme.css 未改矩阵数（与样张 CSS 逐条同构，唯二偏离按 §五登记） | ✅ |
| 8 | `tmp-d142-build.log`：`✓ built in 11.38s`、0 error；dist `theme-*.css` 含新规则（构建产物与源码一致）；GUI 冒烟 44/44 见下 | ✅（静态+证据） |
| 9 | `git diff --stat`：仅 `src/theme.css` + GUIDE（任务要求的登记行）；无 TSX/electron 改动 | ✅ |
| 10 | 新增过渡全在 `no-preference` 块（L8127/L8277/L8286…）；reduce 块 `transition: none`（L8303–8306）覆盖四类输入面；证据 `fieldTd 0s`、accent+厚化仍在场 | ✅ |

44 断言 JSON 逐条审读：44/44，含零位移（90.8=90.8 / 283.6 / 710）、行裁切 29≤29、31≤31、dd ghost、标签裸排、wb-line 实底、cloze ghost、底部 `wb-manual` 右缘 subtle、独立窗口逐参数一致。数值与 GUIDE/报告表述一致。

### 5. 偏离项评估（2 条）

1. **`.wb-field-inner` 的 `position:relative; z-index:1` 未复刻 —— 成立**。样张 L171 确含该属性；产品 `.wb-pick` 为 `position:absolute` + z auto（L8150–8165），若 inner 带 z-index:1 会把内容抬到 pick 之上，破坏 D123 保留项「paper 底遮住下方文字」；该属性不在 §3.2 参数矩阵/§7 测量口径内，对全部验收数零影响（样张本身此处即为自相矛盾的演示态）。
2. **两类 textarea 补齐「出」档（`--dur-exit/--ease-exit`）—— 成立**。样张仅 `.wb-field` 写出档，但 §3.1 机制句「失焦：线色回落 rest（出 --dur-exit 100ms --ease-exit）」是对「四类输入面」的统一陈述；补值与既有 token 一致，且 reduce 下经 `transition: none` 归零。hover 线色变化走「非聚焦态＝出档」与样张完全同构（样张 `:not(:focus-within)` 分支同款），§3.2 的「hover 160ms」对应的是 background-color 那条（V1 下 inert），无口径冲突。

### 6. 文档核

- GUIDE D142 行（L1471）：4 列结构完好；**v48.99 未再 bump**（f11 L3 标题版本 48.99 = 正文最高 48.99）；无自相矛盾：预登记段与实施记录段的事实（44/44、2 偏离、文件路径）与实施报告逐条一致。
- 设计稿头部（L3）「已登记：GUIDE §8.1 … v48.99；实施记录见 D142-IMPLEMENTATION-REPORT.md」✅（未跟踪文件无基线可 diff，仅目检）。
- **f11 复跑：15/16**，唯一失败＝L1（`src/lib/readerActionsSettings.ts` 不存在——与 D143 基线同一条既有红，与本批无关）；L4 D 编号无缺号（最大 D143）✅。

## 三、必须修复项（1 条）

**【必须修复 1】坞内「标签」输入聚焦时无任何可见焦点指示（键盘焦点可见性回归）**

- 文件:行：`src/theme.css:8238`（本批新增 `.wb-more .tag-input-box input { padding: 0; border: 0; background: none; }`）叠加既有 `src/theme.css:4096`（`.tag-input-box input:focus { outline: none; border-color: var(--accent); }`）。
- 问题：该输入的焦点反馈原本只有 `border-color → accent`；border 宽被改为 0 后焦点色不可见；同时 `outline: none` 以 (0,1,1) 压掉全局 `:focus-visible` 焦点环（`src/theme.css:476–479`，(0,1,0)）。改前该输入在坞内是 1px strong 框 + focus accent（无坞内覆盖，走 base L4086–4096），**改后 Tab/点击聚焦均无任何指示**（computed 边框 `0/0/0/0`，见 `tests/tmp-d142-census-after.out.log` 16 条清单——该输入不在其中）。
- 同源症状：`.tag-input-box.expanded input { border-color: accent }`（L4097）一并实效 → D106 建议面板「top:-1px 与输入框共享边线」在坞内断线（面板 accent 描边少顶边，U 形开口）。
- 违反条款：§5.3「键盘焦点环 2px accent」+ swiss 禁止清单「❌ 移除焦点环且无替代」+ **D50 登记裁定**「框线装饰＝一律禁止；焦点指示＝键盘必须可见」（GUIDE L1504，正是同型缺陷的先例）；且本设计稿 §0/§3.4 自引该硬规则（拒绝参考稿 `outline:none` 无替代，登记 accent 底线为等价替代）——标签输入是该规则的漏网面（§3.4 等价替代只登记了字段/自由材料/追问/wb-line 四面）。
- 影响面：坞内「更多 → 标签」字段（默认开启），键盘 Tab 可达（更多区展开时 visibility 恢复）；鼠标点击聚焦同样失去视觉确认。
- 修复归属：**ui-ux-architect**（1 行口径增补，建议登记为 R11：坞内标签输入与 `.wb-line` 同依据（§2 #6「更多区行式字段没有底色，底线是『可编辑』的唯一线索」）→ rest 下缘 1px subtle + 聚焦 accent；此同时闭合 D106 面板共享边线）→ **frontend-builder** 落 1 条规则（`.wb-more .tag-input-box input { border-bottom: 1px solid var(--border-subtle) }` 及 focus/expanded 变体；等效替代方案（仅聚焦出现下划线）亦可）。
- 通过条件（可机械检查）：① `grep -n "tag-input-box" src/theme.css` 存在坞内作用域规则使标签输入聚焦时有可见指示（accent 底线或等价，且全局焦点环未被无效压掉）；② GUI/人工：焦点落入「更多 → 标签」后可见焦点指示（computed `border-bottom-color = rgb(22,106,89)` 且宽 >0，或等价）；③ 不回归 §2 #5 口径（无四边盒框）；④（采纳底线方案时）建议面板展开时顶边与输入底边共线无 1px 断口。

## 四、建议项（不阻塞）

1. [LOW·证据] `tests/tmp-d142-dock-{manual,解释,制卡}.png` 已被 17:29 的 census-after 复跑覆盖为**改后**态，而设计稿 §5 索引仍登记为「现状对照（只读）」。基线像素尚存于 `tests/tmp-d142-crop-before-*.png`（17:23 裁剪自覆盖前文件）与样张第一列——建议在实施报告/设计稿 §5 登记该覆盖更正。归属：总控/实施方登记。
2. [LOW·环境] 17:29 census-after 复跑遗留 4 个 electron 进程（含一个「增量阅读」窗口；`--remote-debugging-port=9251`、`--user-data-dir=tests/tmp-d142-userdata`、StartTime 17:29:19–20＝与复跑同刻）。现场核实为**本批探针孤儿**（非用户实例），但 PID 定向清理在本审查会话被策略拒绝，未清理；请总控按 StartTime 核实后处置。根因：`tmp-d142-dock-census.mjs` 的 `finally { electron.kill() }` 在 `spawn(npx, {shell:true})` 下只杀 shell——after-gui 探针的 PID 树清理（`taskkill /PID <pid> /T /F`）是先例，可同款加固。
3. [LOW·一致性] `.wb-more .tag-input-box input` 无 `::placeholder` token（走 UA 默认灰 ≠ 坞内 #8a8a8a），R9 的「一屏一种占位灰」在更多区未完全闭合；如需口径完全一致可补坞内一条（不阻塞）。
4. [LOW·文案] GUIDE D142 行「三页签」与实际（手工 4 页签 + AI 2 页签）不符，建议改「页签切换」（无歧义风险，改动 2 字）。
5. [INFO·登记] D123 设计稿未加 D142 指向（D143→D137 有「设计稿增补登记」先例）；现修订记录以 D142 §6.1 + GUIDE 行为准，建议在 D123 头部补一行指针或在 D142 行注明「D123 不另行增补」。
6. [INFO] `.wb-composer-send:hover:not(:disabled)` 与 base `.btn-primary:hover` 同值（冗余）；为把用户裁定 H1 落成可 grep 的显式规则（§8 #4 要求），保留合理。
7. [INFO·提交卫生] 工作树另有 10-11 的无关未跟踪文件（`.zcodeignore` / `ir-demo-mock.html` / `public/ir-demo-mock.js`）——提交须用显式路径，勿 `git add -A`。

## 五、未能独立确认的风险 / 环境备注

1. **GUI 未复跑**：在场 electron 孤儿使 `tmp-d142-after-gui.mjs` 的前置检查会自行 SKIP，且我无清理权限（见四-2）。#6/#8 的 GUI 部分依赖实施方留存产物（44 断言 JSON、截图、日志）——我已逐条审读其内部一致性、并把数值与源码层叠推导交叉核对（32=32、零位移、reduce 0s 等均可由 CSS 复算成立），但**未做机器复演**。若总控清理孤儿后可再跑一次 44 断言以完全闭环。
2. 设计稿与两份新文档均为未跟踪文件，无 git 基线，头部/正文的「仅登记性修改」无法 diff 验证（现状目检未见异常）。
3. 深色模式的实时目检未做；静态核对：全部新增颜色为既有 token（0 处 hex/rgb），深色由 token 跟随（设计附录 A 数值为设计期实测）。

## 六、证据索引（本审查引用）

- diff/落盘：`src/theme.css`（L3024、L3103、L8105–8139、L8195、L8232–8241、L8256–8322、L8411–8423）、`AI_DEVELOPMENT_GUIDE.md` L1471、GUIDE L1504（D50 裁定）、L476–479（全局焦点环）
- 机检产物：`tests/tmp-d142-census-after.out.log`（16 条）、`tests/tmp-d142-after-census.json`（44/44）、`tests/tmp-d142-sample-metrics.log`、`tests/tmp-d142-build.log`、`dist/assets/theme-*.css`（17:15 构建）
- 视觉：`tests/tmp-d142-crop-{before,after}-{mid,ai}.png`（目检确认去框/ghost/双线消除）
- 闸门：`node tests/flows/f11-doc-code-drift.cjs` → 15/16（唯一 L1 既有红，与本批无关）
- 孤儿进程证据：`tasklist`/PowerShell StartTime + CommandLine（PID 50904/28924/46092/54016，17:29:19–20，port 9251，userData=`tests/tmp-d142-userdata`）

---

## 七、复审（第二轮）——R11 必修闭环 · 2026-10-12（code-reviewer）

> 范围：仅复核 §三【必须修复 1】的闭环与登记落实（设计稿 §6.1/§6.3 R11、`src/theme.css` 修复批两处、GUIDE D142 行两处字面、实施报告 §七、设计稿 §5 覆盖注记、§四-5 建议项 3 的留收尾声明）。旁证环境：复审前 `tasklist` 残留 0；两轮套件与探针均自起自清（PID 树），结束时残留 0。
> 只读复审：未改代码/文档（除本小节）；新增独立探针与产物均为 `tests/tmp-d142-r11-review2-*`（`.gitignore` L10 `tests/tmp-*` 已覆盖，不入工作树）；未碰 `design-samples/` 与 `tmp-d142-dock-census.mjs`。
> **结论：合格** —— 终审唯一必修项闭环，四项通过条件独立复核全过；三项登记落实；f11 同基线；1 条像素口径观察（INFO，pre-D142 同态，不阻塞）。

### 7.1 通过条件逐条独立复核（终审报告 §三）

| 条件 | 独立复核方法与结果 | 结果 |
| --- | --- | --- |
| ① grep 坞内规则在场 | `grep -n "tag-input-box" src/theme.css` → L8238（`border-bottom: 1px solid var(--border-subtle)`）+ L8242–8243（`input:focus, .expanded input { border-bottom-color: var(--accent) }`）。全局焦点环：base `L4096 outline:none` 为**存量规则**（本批未动，也不应动）；「未被无效压掉」＝等价可见替代现已在场（见 ② 像素实证），符合 §5.3 / swiss / D50 | ✅ |
| ② 机器复演 + 不依赖套件的独立抽查 | `npm run build` ✓（9.23s；新规则入 `dist/assets/theme-CI2CMNHw.css`，20:38）→ `node tests/tmp-d142-after-gui.mjs` **49/49 PASS ×2（我连跑两轮，两轮全绿）**。自写独立探针 `tests/tmp-d142-r11-review2-probe.mjs`（不引用套件代码）：「更多 → 标签」实测 —— rest：`bbw 0.8px / bcBottom rgb(224,224,224) / btw·brw·blw 0px / h26`；**聚焦（终审口径主判据）**：`bcBottom rgb(22,106,89)`、`bbw 0.8px(>0，=1px@DPR2.5 吸附)`、`btw 0px`；**真键盘 Tab**（自「领域」dd-btn 起）落焦同值、`:focus-visible=true`、outline none/0px（被 base 压掉但等价指示在场）；Shift+Tab 移焦回落 subtle。**像素级实证**：聚焦态截图页内 canvas 解码，底线条带行 = `21,106,89`（accent 实绘、非仅 computed） | ✅ |
| ③ 无四边盒框回归 | 四态（rest/聚焦/展开/失焦）`btw/brw/blw` 恒 `0px`；输入盒 top/bottom 恒 206.2/232.2（底线常驻 ⇒ 零位移由构造保证）；坞内它面未回归：`field / freeTa / composerTa / wbLine` 全 = `0/0/0.8/0｜rgb(224,224,224)`，`moreDd` = `0/0/0/0` | ✅ |
| ④ 面板展开共线 | `panelTop 231.2 = inputBottom 232.2 − 1`，gap=0（≤0.5）；面板左右缘与输入左右缘对齐（772.8/1084）；`border-top: none` 保持；同刻底缘 computed 仍 accent | ✅ |

原始输出摘录（探针，自起实例 · DPR 2.5 · 内窗 1100×750）：

```text
B-JSFOCUS  {"bbw":"0.8px","bcBottom":"rgb(22, 106, 89)","btw":"0px","brw":"0px","blw":"0px","outlineStyle":"none","outlineWidth":"0px","focusVisible":true,"isActive":true,"h":26,"expanded":false}
B-PIXELS(focus,no-panel)  cols rows[6-7] = "21,106,89"（两列 x=802.8 / 892.8 同证 accent 底线可见）
C-TABFOCUS {"bbw":"0.8px","bcBottom":"rgb(22, 106, 89)","focusVisible":true,"isActive":true}
C-TABSHIFT-AWAY {"bcBottom":"rgb(224, 224, 224)","isActive":false}
D-PANEL-GEO {"panelTop":231.2,"inputBottom":232.2,"gap":0,"borderTopStyle":"none","bg":"rgb(250, 250, 248)","zIndex":"498"}
D-EXPANDED-READ {"bcBottom":"rgb(22, 106, 89)","expanded":true,"panelInDom":true}
E-MIDCLOSING(+100ms) {"bcBottom":"rgb(22, 106, 89)","expanded":true,"panelInDom":true}   ← closing 200ms 窗口内 accent 保持
E-AFTERCLOSE(+800ms) {"bcBottom":"rgb(224, 224, 224)","expanded":false,"panelInDom":false}
F-FACES {"field":"0/0/0.8/0|rgb(224,224,224)","freeTa":"…同","composerTa":"…同","wbLine":"…同","moreDd":"0/0/0/0|rgb(115,115,115)"}
```

套件复演：`node tests/tmp-d142-after-gui.mjs` → 两轮均 `===RESULT=== 49/49 PASS`（含两条曾被登记为偶发的既有 hover 断言——「发送钮 hover = H1」`{"bg":"color(srgb 0.0759216 0.365804 0.307137)"}`、「dd-btn hover 灰底」`{"bg":"rgb(240, 240, 238)","color":"rgb(10, 10, 10)"}`——本两轮均 PASS）。9 条 R11/修复批相关断言逐轮核值（#5b 修订口径 `0/0/0.8/0；rest`、聚焦 `bbw 0.8px`、面板 `gap 0`、盒高 26、失焦 subtle、深色 `rgb(63,160,138)`）均为报告登记值。

**偶发判定（47/49 首轮的 2 条 hover 断言）**：判定＝**测试基建/合成事件偶发，非真实回归**。证据：① 两条断言主体（`.wb-composer-send:hover`、`.side-dock .dd-btn:hover`）CSS 均不在本修复批 diff 内，且位于套件 R11 段**之前**、与本批无因果路径；② 断言手法＝单次 `Input.dispatchMouseEvent(mouseMoved)`，偶发未注册 hover 属该手法已知抖动类（与仓库既有 CDP 真鼠标手法备忘同类）；③ 我两轮复跑该两条恒绿，修复批记录二、三轮同样恒绿（5 轮内 1 次红，且红在未改动路径）。

### 7.2 新规则作用域/权重独立审查

- **特异性与必需性**：`.wb-more .tag-input-box input` = (0,2,1)，与 base `L4096/L4097`（focus/expanded，(0,2,1)）同权且源序更后 → 反向压掉 accent 取色成立；修复批 (0,3,1) 显式规则确实**必需且充分**，无 `!important`、无新增 transition（`.wb-line` 同为瞬时色迁且**无 hover 档**——已核 L8189/8203 无 hover 规则，R11「hover 不新增档」与族一致）。
- **作用域**：`.wb-more` 全仓唯一宿主＝`ManualCardEditor.tsx:524`（`variant==="dock"` 分支内，L479–574；modal 分支 L577+ 零 `wb-` 类）；`variant="dock"` 唯一调用点＝`SelectionPanels.tsx:318–320`（CardDock）→ **modal 变体与其余四处 TagInput 宿主（CardBrowser / ReviewView / 卡详情 / 筛选器）结构性不受波及**；独立窗口同组件同作用域（与 §9-6 口径一致）。
- **closing 动画期**：`TagInput.tsx:86` `panelMounted = panelVisible || (closing && open)` → `.expanded` 在 200ms 收回期保持；实测 +100ms 仍 accent/expanded/面板在 DOM（见上），窗口内无闪断。
- **`outline: none` 合法性**：base L4096 压掉全局 `:focus-visible`（L476–479，(0,1,0) < (0,2,1)）为存量行为；R11 后**等价可见替代在场且经像素实证**（聚焦态实绘 accent 底线），满足 §5.3 / swiss 禁止清单 / D50「焦点指示＝键盘必须可见」；未改双轨 `:focus-visible`（符合 §3.4 登记）。
- **观察（INFO，不阻塞）**：面板展开期，输入底缘 accent 条（0.8px）被面板纸底覆盖（接缝处 `elementFromPoint` = 面板 `tag-suggest-empty`；该行像素全为 `250,250,248`）——即展开态「U 形」顶边在像素上不闭合。**探针内 pre-D142 仿真（!important 注入 4 边框 + expanded accent 原状）显示同位置同为纸底** → 该现象为 pre-D142 固有（面板 `top: calc(100% - 1px)` 遮蔽几何使然），**非本修复批引入**；终审条件 ④ 为共线几何判据（gap=0，已过），② 的「可见焦点指示」指聚焦态（已像素过）。§6.3「该边为 accent」按 computed 口径成立；本条仅作口径精度记录，无需修复。

### 7.3 三项登记核对

| 登记 | 复核 | 结果 |
| --- | --- | --- |
| 设计稿 §5 覆盖注记（L183） | 字面在场：「三图已被 census-after 复跑（17:29）覆盖为改后态——『现状对照』只读语义已失效；改前基线见 `tests/tmp-d142-crop-before-*.png` 与样张第一列」 | ✅ |
| GUIDE D142 行（L1471） | 「页签切换」（替代原「三页签」，建议项 4 落字）+ 「**登记注：修订记录以设计稿 §6.1（含终审修复 R11）与本行为准；D123 不另行增补**」（建议项 5 的「注明」支路）；GUIDE 全量 diff = 仅此 1 行，4 列结构完好、v48.99 未再 bump | ✅ |
| 实施报告 §七 | 修复内容与 theme.css 逐字一致：L8238 就地修订（同选择器，加 `border-bottom: 1px solid var(--border-subtle)`）+ L8239–8243 紧随新增（注释 3 行 + (0,3,1) 规则 2 行）；「L>8238 后移 5 行」与实际行号一致；49/49、f11 15/16、深色/面板/失焦数据与我的复跑同值 | ✅ |
| 建议项 3（更多区占位灰 token）未并入 | `grep "::placeholder"` 仅 5 处存量 token 化规则，坞内标签输入未新增 ::placeholder 规则 → 与 §6.3「不并入本条，留收尾口径」声明一致（不阻塞项，登记即可） | ✅ |

### 7.4 闸门与产物

- `node tests/flows/f11-doc-code-drift.cjs` → **15/16 FAIL**（唯一失败 L1：`实际: ["src/lib/readerActionsSettings.ts"]` ——与 D143 基线同条既有红，与本批无关）✅
- 复审新增产物（gitignored）：`tests/tmp-d142-r11-review2-probe.mjs`、`tmp-d142-r11-review2-probe.log`、接缝截图 `tmp-d142-r11-review2-seam-expanded.png`（R11 态）/ `tmp-d142-r11-review2-seam-emulated-pred142.png`（pre-D142 仿真态）。
- 未决/遗留（均不阻塞，已登记）：§四-3 建议项（占位灰）按口径留收尾；§四-2 探针孤儿根因加固（census 探针 finally 只杀 shell）不在本批范围，现状残留 0。
